// Prune a persona that has already silted up.
//
// The evolution sanitizer only guards what a reflection is about to write, so
// tightening it does nothing about traits that already got in. Victor's sheet
// had grown from 9 traits to 14, five of them the same sentence with
// different nouns, and that is what he was still being prompted with every
// tick.
//
// Runs the CURRENT rules over an existing persona using its own recorded
// baseline, so this stays honest as the rules change: no hand-picking.
//
//   node scripts/prune-persona.mjs <persona.json> <persona-baseline.json>
//   node scripts/prune-persona.mjs <persona.json> <baseline.json> --write
//
// Without --write it only reports. Always writes a .bak next to the file.

import { readFile, writeFile, copyFile } from 'node:fs/promises'
import { sanitizeEvolvedArrays } from '../src/loop/SleepCycle.js'

const [personaPath, baselinePath] = process.argv.slice(2)
const write = process.argv.includes('--write')

if (!personaPath || !baselinePath) {
    console.error('usage: node scripts/prune-persona.mjs <persona.json> <persona-baseline.json> [--write]')
    process.exit(1)
}

const persona = JSON.parse(await readFile(personaPath, 'utf-8'))
const baseline = JSON.parse(await readFile(baselinePath, 'utf-8'))

const changes = {}
for (const f of ['traits', 'values', 'fears', 'quirks']) {
    if (Array.isArray(persona[f])) changes[f] = [...persona[f]]
}

const dropped = sanitizeEvolvedArrays(changes, persona, baseline, {
    info: (m) => console.log('  ' + m.replace('Evolution sanitizer: ', '')),
})

console.log(`\ndropped ${dropped} entr${dropped === 1 ? 'y' : 'ies'}`)
for (const f of Object.keys(changes)) {
    const before = persona[f].length
    const after = changes[f].length
    if (before !== after) console.log(`  ${f}: ${before} -> ${after}`)
}

if (!write) {
    console.log('\nreport only. pass --write to apply.')
    process.exit(0)
}

if (dropped === 0) {
    console.log('nothing to do.')
    process.exit(0)
}

await copyFile(personaPath, personaPath + '.bak')
await writeFile(personaPath, JSON.stringify({ ...persona, ...changes }, null, 2) + '\n', 'utf-8')
console.log(`\nwritten. previous version kept at ${personaPath}.bak`)
console.log('restart the agent for it to take effect.')
