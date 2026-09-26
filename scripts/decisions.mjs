// What his decisions looked like, read from data/decisions.
//
//   node scripts/decisions.mjs                 today (UTC)
//   node scripts/decisions.mjs 2026-09-27      one day
//   node scripts/decisions.mjs --days 7        the last seven days together
//   node scripts/decisions.mjs --dir <path>    somewhere other than ./data/decisions
//
// Read-only. The questions it exists for: why a tick went to the tier it
// did, which model answered and what that cost, how often the brain asked
// for something a guard then changed, and how often he was asked the same
// question on the same evidence as the time before.

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`)
    return i > -1 ? args[i + 1] : fallback
}
const dir = flag('dir', './data/decisions')
const days = Number(flag('days', 1))
const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))

const available = (await readdir(dir).catch(() => []))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .sort()
const wanted = dateArg
    ? available.filter((f) => f.startsWith(dateArg))
    : available.slice(-Math.max(1, days))
if (wanted.length === 0) {
    console.error(`no decision files in ${dir}${dateArg ? ` for ${dateArg}` : ''}`)
    process.exit(1)
}

const rows = []
for (const file of wanted) {
    for (const line of (await readFile(join(dir, file), 'utf-8')).split('\n')) {
        if (!line.trim()) continue
        try { rows.push(JSON.parse(line)) } catch { /* a torn last line from a hard stop */ }
    }
}

const n = rows.length
const pct = (k, of = n) => (of ? `${Math.round((k / of) * 100)}%` : '0%')
const count = (items) => {
    const m = new Map()
    for (const x of items) m.set(x, (m.get(x) || 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
}
const quantile = (xs, q) => {
    if (xs.length === 0) return null
    const s = [...xs].sort((a, b) => a - b)
    return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}
const table = (pairs, of = n, limit = 12) => pairs.slice(0, limit)
    .map(([k, v]) => `    ${String(v).padStart(6)}  ${pct(v, of).padStart(4)}  ${k}`).join('\n')

console.log(`\n${n} decisions, ${wanted[0].slice(0, 10)}${wanted.length > 1 ? ` to ${wanted.at(-1).slice(0, 10)}` : ''}`)
console.log(`  first ${rows[0]?.t}  last ${rows.at(-1)?.t}`)
console.log(`  code ${count(rows.map((r) => r.code || 'unknown')).map(([k, v]) => `${k} x${v}`).join(', ')}`)
console.log(`  persona ${count(rows.map((r) => r.persona || 'unknown')).map(([k, v]) => `${k} x${v}`).join(', ')}`)

console.log('\ntiers')
console.log(table(count(rows.map((r) => r.tier))))
// A tick routed by repetition can carry several kinds; count each.
const repetition = rows.filter((r) => String(r.why || '').startsWith('repetition:'))
console.log(`\n  why quality: ${repetition.length} by repetition warning, ${rows.filter((r) => String(r.why || '').startsWith('world_event:')).length} by world event`)
console.log(table(count(repetition.flatMap((r) => r.why.slice('repetition:'.length).split('+'))), repetition.length))
console.log('\n  every why')
console.log(table(count(rows.map((r) => String(r.why || '').split(':')[0]))))

console.log('\nwho answered')
console.log(table(count(rows.map((r) => `${r.source || 'none'}${r.model ? ` (${r.model})` : ''}`))))
for (const [model] of count(rows.filter((r) => r.model).map((r) => r.model))) {
    const mine = rows.filter((r) => r.model === model)
    const ms = mine.map((r) => r.ms).filter(Number.isFinite)
    const tin = mine.map((r) => r.tokens?.in).filter(Number.isFinite)
    const tout = mine.map((r) => r.tokens?.out).filter(Number.isFinite)
    const sum = (xs) => xs.reduce((a, b) => a + b, 0)
    console.log(`    ${model}: p50 ${quantile(ms, 0.5)}ms, p90 ${quantile(ms, 0.9)}ms; tokens in ${sum(tin)} (median ${quantile(tin, 0.5)}), out ${sum(tout)} (median ${quantile(tout, 0.5)})`)
}
const fallbacks = rows.filter((r) => r.fallback)
if (fallbacks.length) {
    console.log('\n  fell back to the heuristic')
    console.log(table(count(fallbacks.map((r) => r.fallback))))
}

console.log('\nguards that stepped in')
const overridden = rows.filter((r) => (r.overrides || []).length)
console.log(`    ${overridden.length} decisions (${pct(overridden.length)}) had at least one`)
if (overridden.length) console.log(table(count(rows.flatMap((r) => r.overrides || []))))
const offMenu = rows.filter((r) => (r.overrides || []).includes('not_on_menu'))
if (offMenu.length) {
    console.log('\n  asked for, not on the menu')
    console.log(table(count(offMenu.map((r) => r.asked?.action || '(none)')), offMenu.length, 10))
}

// The same evidence again. scene is the coarse situation, detail adds the
// place labels and the environment line; see evidenceKeys in DecisionLog.
console.log('\nsame evidence again')
let sameScene = 0
let sameDetail = 0
let sameAnswer = 0
let longest = 0
let run = 0
const seenScenes = new Set()
let seenBefore = 0
for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const prev = rows[i - 1]
    if (seenScenes.has(r.scene)) seenBefore++
    seenScenes.add(r.scene)
    if (prev && r.scene && r.scene === prev.scene) {
        sameScene++
        run++
        longest = Math.max(longest, run)
        if (r.detail === prev.detail) sameDetail++
        if (r.asked?.action && r.asked.action === prev.asked?.action && r.asked.target === prev.asked?.target) sameAnswer++
    } else {
        run = 0
    }
}
console.log(`    ${sameScene} (${pct(sameScene)}) saw the same scene as the decision before; ${sameDetail} of them the same detail too`)
console.log(`    ${sameAnswer} of those asked for the same action and target again`)
console.log(`    ${seenBefore} (${pct(seenBefore)}) saw a scene already seen earlier in the window; longest unbroken run ${longest + (sameScene ? 1 : 0)}`)

console.log('\nresults')
const failed = rows.filter((r) => r.result && r.result.ok === false)
console.log(`    ${failed.length} failed (${pct(failed.length)}), ${rows.filter((r) => r.error).length} ticks threw`)
if (failed.length) console.log(table(count(failed.map((r) => `${r.took?.action}: ${String(r.result.msg || '').slice(0, 60)}`)), failed.length, 8))

console.log('\nreasons')
const reasons = rows.map((r) => String(r.reason || '').trim()).filter(Boolean)
const words = reasons.map((s) => s.split(/\s+/).length)
console.log(`    ${reasons.length} written, median ${quantile(words, 0.5)} words, ${rows.filter((r) => r.remember).length} with a remember`)
const repeated = count(reasons.map((s) => s.toLowerCase())).filter(([, v]) => v >= 3)
if (repeated.length) {
    console.log('  said three times or more')
    console.log(table(repeated, reasons.length, 8))
}
console.log('')
