// no em dashes in anything the model reads. his output kept coming out full
// of them and it was our own fault, 88 of them across the prompt builders.
// the model copies the shape of the instructions, not just what they say.
//
// comments are fine, they're for us. regexes that match on the dash have to
// stay, they're what strips it out of his output

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

// a matcher has to contain the dash to do its job
const isMatcher = (s) => s.includes('.replace(/') || s.includes('RegExp(') || /\/\[[^\]]*—/.test(s)

// log lines go to a terminal, not a prompt
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
    // if these get "tidied" away his output stops being cleaned and nobody
    // would notice
    const sanitize = readFileSync(join(SRC, 'util', 'sanitizeReason.js'), 'utf-8')
    assert.ok(sanitize.includes('—'), 'sanitizeReason no longer strips em dashes')
})
