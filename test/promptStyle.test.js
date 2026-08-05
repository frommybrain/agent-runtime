// We were teaching him the habit we kept telling him to drop.
//
// Sam's rule is no em dashes, anywhere. His output kept producing them, and
// the reason turned out to be embarrassing: every instruction we hand the
// model was written in them. "Vary your actions — don't repeat the same
// thing endlessly", 88 of those across the prompt builders. An example
// teaches shape, not just content, which is the same way one seed line
// taught him "badly and completely".
//
// So this fails the build if an em dash gets back into anything the model
// reads. Comments are fine, they are for us. Regexes that MATCH on em
// dashes are not just fine but necessary, since they are the guards that
// strip the character out of his output.

import { test } from 'node:test'
import assert from 'node:assert'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

function walk(dir) {
    const out = []
    for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) out.push(...walk(p))
        else if (name.endsWith('.js')) out.push(p)
    }
    return out
}

const isComment = (s) => {
    const t = s.trimStart()
    return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
}

// A line that matches or strips em dashes has to contain one to do its job.
const isMatcher = (s) => s.includes('.replace(/') || s.includes('RegExp(') || /\/\[[^\]]*—/.test(s)

// Console output is for us, not for him, and reads in a terminal not a prompt.
const isLog = (s) => /\b(logger|console|log)\.(debug|info|warn|error)\(/.test(s)

test('no em dash reaches the model', () => {
    const offenders = []
    for (const file of walk(SRC)) {
        const lines = readFileSync(file, 'utf-8').split('\n')
        lines.forEach((line, i) => {
            if (!line.includes('—')) return
            if (isComment(line) || isMatcher(line) || isLog(line)) return
            offenders.push(`${file.slice(SRC.length + 1)}:${i + 1}  ${line.trim().slice(0, 100)}`)
        })
    }
    assert.deepStrictEqual(
        offenders, [],
        `Em dash in prompt text. Use a comma, a full stop, or a colon before a list.\n  ${offenders.join('\n  ')}`,
    )
})

test('the guards that strip em dashes still have one to match', () => {
    // If someone "helpfully" scrubs these, his output stops being cleaned and
    // the failure is invisible, so assert they are intact.
    const sanitize = readFileSync(join(SRC, 'util', 'sanitizeReason.js'), 'utf-8')
    assert.ok(sanitize.includes('—'), 'sanitizeReason no longer strips em dashes')
})
