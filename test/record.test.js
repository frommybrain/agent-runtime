import { test } from 'node:test'
import assert from 'node:assert/strict'

import { bannedWords, bannedIn, filterRecord } from '../src/util/record.js'
import { sanitizeEvolvedArrays } from '../src/loop/SleepCycle.js'

const AVOID = ['flatness', 'the gnaw', 'curb', 'a clue']

test('the ban list comes from the persona, not the runtime', () => {
    assert.deepEqual(bannedWords({ voice: { avoid: ['Flatness', ' curb '] } }), ['flatness', 'curb'])
    assert.deepEqual(bannedWords({ voice: {} }), [])
    assert.deepEqual(bannedWords(null), [])
})

test('a banned word is caught through its inflections', () => {
    assert.deepEqual(bannedIn('coffee curbs the hunger', AVOID), ['curb'])
    assert.deepEqual(bannedIn('the rave broke the flatness', AVOID), ['flatness'])
})

test('a banned phrase only matches as a phrase', () => {
    assert.deepEqual(bannedIn('the needle flashes like a clue', AVOID), ['a clue'])
    assert.deepEqual(bannedIn('I had no clue what it was', AVOID), [])
})

test('substrings of ordinary words are not banned words', () => {
    // banning "light" mustn't eat "slight"
    assert.deepEqual(bannedIn('a slight disturbance in the water', ['light']), [])
    assert.deepEqual(bannedIn('the light came on', ['light']), ['light'])
})

test('banned bullets are dropped and the file structure survives', () => {
    const md = [
        "# victor's Memory",
        '',
        '## Relationships',
        "- Coffee's bitter lift eases the hunger.",
        '- The rave broke the flatness, giving me a moment of bravery.',
        '',
        '## Learned Facts',
        '- Glowworms carve caves of light in humid forests.',
    ].join('\n')

    const { text, banned } = filterRecord(md, { banned: AVOID })
    assert.equal(banned, 1)
    assert.ok(!text.includes('flatness'))
    assert.ok(text.includes('## Relationships'))
    assert.ok(text.includes('## Learned Facts'))
    assert.ok(text.includes('Glowworms'))
})

test('one subject cannot own the whole record', () => {
    // victor's real memory.md, 45 lines, "glow" in seven
    const md = ['## Important Memories',
        '- The pond showed no glow today.',
        '- The phone glinted, a hope of the glow.',
        '- Casino lights flicker like the pond glow.',
        '- The junkheap might hide a glow.',
        '- The museum held a piece about glow.',
        '- I rested in a quiet nest.',
    ].join('\n')

    const { text, crowded } = filterRecord(md, { subjectCeiling: 2 })
    assert.equal(crowded, 3)
    assert.equal((text.match(/glow/g) || []).length, 2)
    assert.ok(text.includes('quiet nest'))
})

test('the subject cap is off unless asked for', () => {
    const md = '- glow\n- glow\n- glow\n- glow'
    assert.equal(filterRecord(md, {}).crowded, 0)
})

test('a record of nothing but banned lines still validates as its file', () => {
    const md = "# victor's Memory\n\n## Learned Facts\n- everything is flatness\n"
    const { text } = filterRecord(md, { banned: AVOID })
    assert.ok(text.includes('# '))
    assert.ok(text.includes('## Learned Facts'))
})

test('the reflection cannot write a banned word onto the character sheet', () => {
    // the real one: "resourceful use of varied experiences to break flatness"
    const changes = { values: ['his own quiet', 'resourceful use of varied experiences to break flatness'] }
    const persona = { values: ['his own quiet'] }
    const baseline = { values: ['his own quiet'] }

    const dropped = sanitizeEvolvedArrays(changes, persona, baseline, null, AVOID)
    assert.equal(dropped, 1)
    assert.deepEqual(changes.values, ['his own quiet'])
})

test('an authored entry keeps its wording even when the ban would catch it', () => {
    // real authored value. ban only applies to what reflection writes
    const authored = 'something just past the edge of things'
    const changes = { values: [authored] }
    const persona = { values: [authored] }
    const baseline = { values: [authored] }

    const dropped = sanitizeEvolvedArrays(changes, persona, baseline, null, ['the edge'])
    assert.equal(dropped, 0)
    assert.deepEqual(changes.values, [authored])
})

test('a phrase ban does not eat a word that merely starts the same', () => {
    assert.deepEqual(bannedIn('a clueless bird', AVOID), [])
    assert.deepEqual(bannedIn('the needle flashes like a clue', AVOID), ['a clue'])
})

test('a phrase ban follows its own inflections', () => {
    assert.deepEqual(bannedIn('the gnawing would not stop', AVOID), ['the gnaw'])
})

test('a phrase only matches as consecutive words', () => {
    assert.deepEqual(bannedIn('a bird without the faintest clue', AVOID), [])
})

test('a fixation cannot hide behind synonyms: the idea pair is capped', () => {
    // glint/spark/glow/firefly stem apart so the word cap sat at 4-4-4-4 and
    // caught nothing, while 17 of 31 bullets were one thought. cap the pair,
    // the anchor (museum) can't be respelled
    const md = [
        '# M', '',
        '- the firefly glow at the museum case',
        '- a glow behind the museum glass again',
        '- the museum glow was there a third time',
        '- ate noodles at the takeaway',
    ].join('\n')
    const { text, crowded } = filterRecord(md, { subjectCeiling: 8, ideaCeiling: 2 })
    assert.equal(crowded, 1, 'third glow+museum line drops')
    assert.match(text, /noodles/, 'unrelated lines pass')
    assert.equal((text.match(/museum/g) || []).length, 2)
})

test('two mentions of an idea are a memory, not a monoculture', () => {
    const md = ['- the drum in the laundrette', '- that laundrette drum again'].join('\n')
    const { crowded } = filterRecord(md, { subjectCeiling: 8, ideaCeiling: 2 })
    assert.equal(crowded, 0)
})
