// the meaning-level dedup: verdicts from the LLM applied to a reflection's
// arrays. the word-level sanitizer can't see that "private" and
// "selectively open" are one idea; this is the half that acts once
// something can.

import { test } from 'node:test'
import assert from 'node:assert'
import { collapseSemanticTwins } from '../src/loop/SleepCycle.js'

const sheet = () => ({
    traits: ['private', 'reserved yet open', 'steps back from crowds', 'quietly proud of his nest'],
})
const original = { traits: ['private', 'steps back from crowds'] }

test('a proposed twin replaces the non-authored entry it restates', () => {
    const persona = sheet()
    const changes = { traits: [...persona.traits, 'guarded about who gets close'] }
    const n = collapseSemanticTwins(changes, persona, original, {
        proposals: [{ text: 'guarded about who gets close', restates: 'reserved yet open' }],
    })
    assert.equal(n, 1)
    assert.ok(!changes.traits.includes('reserved yet open'))
    assert.ok(changes.traits.includes('guarded about who gets close'))
})

test('a proposed twin of an AUTHORED entry drops instead', () => {
    const persona = sheet()
    const changes = { traits: [...persona.traits, 'keeps himself to himself'] }
    const n = collapseSemanticTwins(changes, persona, original, {
        proposals: [{ text: 'keeps himself to himself', restates: 'private' }],
    })
    assert.equal(n, 1)
    assert.ok(!changes.traits.includes('keeps himself to himself'))
    assert.ok(changes.traits.includes('private'))
})

test('one existing pair may merge, authored side survives', () => {
    const persona = sheet()
    const changes = { traits: [...persona.traits] }
    const n = collapseSemanticTwins(changes, persona, original, {
        existingPair: { a: 'private', b: 'reserved yet open' },
    })
    assert.equal(n, 1)
    assert.ok(changes.traits.includes('private'))
    assert.ok(!changes.traits.includes('reserved yet open'))
})

test('both sides authored means hands off', () => {
    const persona = sheet()
    const changes = { traits: [...persona.traits] }
    const n = collapseSemanticTwins(changes, persona, original, {
        existingPair: { a: 'private', b: 'steps back from crowds' },
    })
    assert.equal(n, 0)
    assert.equal(changes.traits.length, 4)
})

test('malformed verdicts change nothing', () => {
    const persona = sheet()
    const changes = { traits: [...persona.traits] }
    for (const junk of [null, {}, { proposals: 'no' }, { proposals: [{ text: 42 }] }, { existingPair: { a: 'x' } }]) {
        assert.equal(collapseSemanticTwins(changes, persona, original, junk), 0)
    }
    assert.equal(changes.traits.length, 4)
})

test('verdicts about entries not in the changes are ignored', () => {
    const persona = sheet()
    const changes = { traits: [...persona.traits] }
    const n = collapseSemanticTwins(changes, persona, original, {
        proposals: [{ text: 'not proposed at all', restates: 'private' }],
    })
    assert.equal(n, 0)
})
