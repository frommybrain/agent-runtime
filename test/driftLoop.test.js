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

// The fourth exit, added after the glow recurrence of 08-13: retirement
// fired correctly and the replacement was the same fixation reworded
// within the hour, because nothing barred the subject. These are the two
// real pairs from the Pi's log.
import { subjectTokens } from '../src/util/record.js'

const circles = (a, b) => {
    const bar = subjectTokens(a)
    for (const t of subjectTokens(b)) if (bar.has(t)) return true
    return false
}

test('a reworded rut shares stems with the thread it replaced', () => {
    assert.ok(circles(
        'follow the firefly glow thread to its source',
        'discover where the mysterious glow is coming from',
    ))
    assert.ok(circles(
        'I want to hear what the shrine whispers',
        'listen again at the shrine for that whisper',
    ))
})

test('a genuinely new want does not trip the subject bar', () => {
    assert.ok(!circles(
        'follow the firefly glow thread to its source',
        'see the pond freeze over once, properly',
    ))
    assert.ok(!circles(
        'follow the firefly glow thread to its source',
        'learn what the arcade machine does when nobody feeds it',
    ))
})

// The persona had its own door. On 13 Aug the glow was retired as a thread
// and scrubbed from memory; the next morning the persona consolidator wrote
// "occasionally seeks patterns in the glow thread online" as a quirk, and it
// was steering decision reasons again by lunchtime. Letting go of a subject
// has to mean both writers let go of it.
test('a retired subject cannot come back as a disposition', () => {
    const barred = new Set()
    for (const t of subjectTokens('follow the firefly glow thread to its source')) barred.add(t)

    const changes = { quirks: ['hums when exploring', 'occasionally seeks patterns in the glow thread online'] }
    const dropped = sanitizeEvolvedArrays(changes, { quirks: [] }, { quirks: ['hums when exploring'] }, null, [], barred)

    assert.ok(dropped >= 1, 'the glow quirk is dropped')
    assert.ok(!changes.quirks.some((q) => /glow/i.test(q)), 'no glow entry survives')
    assert.ok(changes.quirks.includes('hums when exploring'), 'unrelated entries are untouched')
})

test('the authored sheet is never judged against the bar', () => {
    // baseline entries are canon even if they happen to share a stem
    const barred = new Set(subjectTokens('follow the firefly glow thread to its source'))
    const changes = { quirks: ['chases the glow'] }
    sanitizeEvolvedArrays(changes, { quirks: [] }, { quirks: ['chases the glow'] }, null, [], barred)
    assert.deepEqual(changes.quirks, ['chases the glow'], 'an authored quirk survives its own subject being retired')
})

// The reasons funnel: hollow-register reasons flow through the daily log
// into every sleep-pass reader, which is the pipe that put the drum
// fixation into three persona slots. The cleaned view keeps the fact and
// loses the reason; plain reasons pass untouched.
import { SleepCycle } from '../src/loop/SleepCycle.js'
const stripHollow = (t) => SleepCycle.prototype._stripHollowReasons.call(null, t)

test('a hollow reason loses its words but keeps its fact', () => {
    const line = '[12:30:13] scavenge({"target":"activity_junkheap","reason":"Saw a glint near the dumpster, chasing the pull"}): Saw a glint near the dumpster, chasing the pull [cloud] → ok'
    const out = stripHollow(line)
    assert.ok(!/glint|the pull/.test(out), 'hollow vocabulary gone')
    assert.ok(/scavenge/.test(out) && /activity_junkheap/.test(out) && /→ ok/.test(out), 'the fact survives')
})

test('a plain reason is left exactly alone', () => {
    const line = '[12:31:02] forage({"target":"food_apple_tree","reason":"Stomach growls, heading for a quick bite"}): Stomach growls, heading for a quick bite [cloud] → ok'
    assert.equal(stripHollow(line), line)
})

test('non-action lines pass through whole', () => {
    const felt = 'FELT: a faint heaviness from the junk food'
    assert.equal(stripHollow(felt), felt)
})
