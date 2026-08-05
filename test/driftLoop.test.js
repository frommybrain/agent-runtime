// The three exits that were missing from the loop that produced the stone.
//
// Fixtures are the real thing off the Pi, not invented: seven traits that
// arrived one per sleep, and the thread "I want to hear what the shrine
// whispers" that wrote his entire long-term memory and then cited it back
// as evidence it should stay.

import { test } from 'node:test'
import assert from 'node:assert'
import { sanitizeEvolvedArrays } from '../src/loop/SleepCycle.js'

const AUTHORED = [
    'thoughtful', 'watchful', 'private', 'stubborn', 'tender about small things',
    'spontaneous', 'creative', 'quick-witted', 'an omnivert, sometimes bold, sometimes shy',
]

// Verbatim from personas/victor.json on the Pi. All one trait, worded seven
// ways, which is exactly why a lexical guard could not hold the line.
const REAL_DRIFT = [
    "finds calm in water's ripple",
    'attuned to subtle rhythms in mundane hums',
    'finds brief clarity from coffee aroma',
    'is fascinated by bioluminescent beetles',
    'feels a spark from neon lights',
    'finds momentary spark from flickering bar lights',
    'uses sensory spikes to reset focus',
]

/** One sleep: the model returns the whole sheet plus one new trait. */
function oneSleep(traits, addition) {
    const original = { traits: AUTHORED, values: [], fears: [], quirks: [] }
    const persona = { traits: [...traits], values: [], fears: [], quirks: [] }
    const changes = { traits: [...traits, addition] }
    sanitizeEvolvedArrays(changes, persona, original, null)
    return changes.traits
}

test('the real drift, dripped one per sleep, stays bounded', () => {
    let traits = [...AUTHORED]
    for (const t of REAL_DRIFT) traits = oneSleep(traits, t)

    // Before the cap change this reached 14 and production reached 16.
    assert.ok(
        traits.length <= AUTHORED.length + 2,
        `ended at ${traits.length} traits, cap is ${AUTHORED.length + 2}: ${JSON.stringify(traits.slice(AUTHORED.length))}`,
    )
})

test('the authored sheet is never eaten by the additions', () => {
    let traits = [...AUTHORED]
    for (const t of REAL_DRIFT) traits = oneSleep(traits, t)
    for (const canon of AUTHORED) {
        assert.ok(traits.includes(canon), `lost authored trait "${canon}"`)
    }
})

test('a genuinely different trait can still get in', () => {
    // The cap must bound a monoculture without freezing him solid.
    const traits = oneSleep(AUTHORED, 'keeps a running argument with the speaking clock')
    assert.ok(traits.length === AUTHORED.length + 1)
    assert.ok(traits.includes('keeps a running argument with the speaking clock'))
})

test('sustained drift cannot outlast the cap however it is worded', () => {
    // Forty attempts, each phrased differently, none using a frame verb the
    // lexical checks know about.
    let traits = [...AUTHORED]
    for (let i = 0; i < 40; i++) {
        traits = oneSleep(traits, `is quietly gripped by thing number ${i} and what it does to him`)
    }
    assert.ok(traits.length <= AUTHORED.length + 2, `ended at ${traits.length}`)
})
