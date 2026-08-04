// The persona has silted up twice now, so the rules that stop it are pinned
// here. Run with `npm test`. No framework, node's own runner.
//
// The case that matters is real: Victor's sheet on the Pi had grown from 9
// baseline traits to 14, and five of the additions were the same sentence
// with different nouns ("finds calm in water's ripple", "finds brief lift in
// warm air", "finds brief focus in warm mechanical hums", ...). Every one of
// them passed the old guard, because they shared almost no content words.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeEvolvedArrays, enforceRichnessFloor } from '../src/loop/SleepCycle.js'
import { wornOpeners } from '../src/util/wornWords.js'
import { sanitizeReason } from '../src/util/sanitizeReason.js'

const BASELINE = [
    'thoughtful', 'watchful', 'private', 'stubborn', 'tender about small things',
    'spontaneous', 'creative', 'quick-witted', 'an omnivert — sometimes bold, sometimes shy',
]

const run = (proposed, baseline = BASELINE) => {
    const changes = { traits: [...proposed] }
    const dropped = sanitizeEvolvedArrays(changes, { traits: changes.traits }, { traits: baseline })
    return { kept: changes.traits, dropped }
}

test('the sheet that actually accreted on the Pi gets pruned', () => {
    const { kept } = run([...BASELINE,
        'finds calm in water’s ripple',
        'attuned to subtle rhythms in mundane hums',
        'finds brief lift in warm air',
        'finds brief focus in warm mechanical hums',
        'seeks fleeting sparks in mundane environments',
    ])
    const added = kept.filter((t) => !BASELINE.includes(t))
    assert.ok(added.length <= 2, `five variations on one idea should not all survive, kept ${added.length}`)
})

test('baseline traits are canon and never dropped', () => {
    const { kept } = run([...BASELINE, 'finds calm in X in Y', 'seeks calm in Z'])
    for (const b of BASELINE) assert.ok(kept.includes(b), `dropped baseline trait: ${b}`)
})

test('growth is still allowed when it is genuinely different', () => {
    const { kept } = run([...BASELINE, 'keeps a grudge against the one crow that startled him'])
    assert.equal(kept.length, BASELINE.length + 1)
})

test('inflections fold, so hum and hums are one motif', () => {
    const { kept } = run([...BASELINE,
        'wary of the hum',
        'counts the hums at night',
        'the humming follows him home',
    ])
    const added = kept.filter((t) => !BASELINE.includes(t))
    assert.ok(added.length <= 2, `hum/hums/humming is one motif, kept ${added.length}`)
})

test('diary lines dressed as traits are dropped', () => {
    const { kept } = run([...BASELINE, 'recognizes that the laundrette eases the noise'])
    assert.equal(kept.length, BASELINE.length)
})

test('an essay is not a disposition', () => {
    const { kept } = run([...BASELINE, 'x'.repeat(120)])
    assert.equal(kept.length, BASELINE.length)
})

test('richness floor still stops the sheet hollowing out', () => {
    const changes = { traits: ['thoughtful'] }
    enforceRichnessFloor(changes, { traits: BASELINE }, { traits: BASELINE })
    assert.ok(changes.traits.length > 1, 'nine traits must not collapse to one')
})

test('a repeated sentence opener is caught even when the words vary', () => {
    const reasons = [
        'need a quick bite to silence the gnaw',
        'need the pond’s ripple to cut through this silent night',
        'need that needle buzz, hoping for a fresh spark',
        'starving, and the tree is bare',
    ]
    assert.deepEqual(wornOpeners(reasons), ['need'])
})

test('varied openers are left alone', () => {
    assert.deepEqual(wornOpeners(['the rain again', 'a slow walk', 'hungry now', 'nothing doing']), [])
})

test('a clause that only reports a dial is dropped', () => {
    assert.equal(sanitizeReason('Curiosity spikes, need to chase that sparkle online'), 'Need to chase that sparkle online')
    assert.equal(sanitizeReason('I need to sleep, rest is desperate'), 'I need to sleep')
    assert.equal(sanitizeReason("Hunger's gnawing, heading for the apple tree."), 'Heading for the apple tree.')
})

test('a line with nothing left over is left alone rather than gutted', () => {
    // no second clause to fall back on, so keep it: odd beats empty
    assert.equal(sanitizeReason('Curiosity spikes'), 'Curiosity spikes')
})

test('lines that were already fine are untouched', () => {
    for (const good of [
        "There was a thing about squirrels I didn't finish",
        'Feeling twitchy, want to rawdog it and loosen up at the bar',
    ]) assert.equal(sanitizeReason(good), good)
})
