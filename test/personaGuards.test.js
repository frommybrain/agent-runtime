// persona has silted up twice, so the guards get pinned here.
// real case: victor's sheet on the pi went from 9 traits to 14, five of them
// the same sentence with the nouns swapped ("finds calm in water's ripple",
// "finds brief lift in warm air" etc). old guard let every one through,
// they barely share any content words

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

test('restoring onto a full sheet does not breach the cap', () => {
    // 12 Aug: drift swapped spontaneous for focused and added two more,
    // restore appended spontaneous back and we shipped 12 against a cap of 11
    const evolvedFull = [
        ...BASELINE.filter((t) => t !== 'spontaneous'),
        'focused', 'patient', 'methodical',
    ]
    const changes = { traits: [...evolvedFull] }
    enforceRichnessFloor(changes, { traits: BASELINE }, { traits: BASELINE })
    assert.equal(changes.traits.length, BASELINE.length + 2, 'cap holds after restore')
    assert.ok(changes.traits.includes('spontaneous'), 'the authored trait is back')
    for (const t of BASELINE) assert.ok(changes.traits.includes(t), `authored "${t}" survives the trim`)
    assert.ok(!changes.traits.includes('methodical'), 'the newest evolved addition gives way')
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
    // nothing to fall back on, odd beats empty
    assert.equal(sanitizeReason('Curiosity spikes'), 'Curiosity spikes')
})

test('lines that were already fine are untouched', () => {
    for (const good of [
        "There was a thing about squirrels I didn't finish",
        'Feeling twitchy, want to rawdog it and loosen up at the bar',
    ]) assert.equal(sanitizeReason(good), good)
})

test('one quietly omitted authored quirk comes back', () => {
    // model hands back the list minus one, sanitizer never notices, quirk
    // gone. authored entries are a floor
    const persona = { quirks: BASELINE.slice(0, -1) }
    enforceRichnessFloor(persona, { quirks: BASELINE })
    assert.equal(persona.quirks.length, BASELINE.length)
    assert.ok(persona.quirks.includes(BASELINE[BASELINE.length - 1]))
})

test('grown entries survive a canon restore', () => {
    const persona = { quirks: [...BASELINE.slice(0, -1), 'collects bottle caps'] }
    enforceRichnessFloor(persona, { quirks: BASELINE })
    assert.ok(persona.quirks.includes('collects bottle caps'), 'evolution is kept')
    assert.ok(persona.quirks.includes(BASELINE[BASELINE.length - 1]), 'canon is restored')
})

// 16 Aug: count guard held but the sheet still rotted. jaccard punishes size
// difference, "private yet attuned to rhythmic cues" vs "private" is 1/4 so
// it got in, three ways of saying private under the cap. containment is the
// right question. entries are off the pi
test('a padded restatement of an existing trait is dropped', () => {
    const { kept, dropped } = run([...BASELINE, 'private yet attuned to rhythmic cues'])
    assert.ok(!kept.includes('private yet attuned to rhythmic cues'), 'the private restatement is out')
    assert.ok(dropped >= 1)
})

test('a padded restatement of an existing value is dropped', () => {
    const quietBaseline = [...BASELINE, 'his own quiet']
    const { kept } = run([...quietBaseline, 'appreciation for quiet, steady moments'], quietBaseline)
    assert.ok(!kept.includes('appreciation for quiet, steady moments'), 'the quiet restatement is out')
})

test('a genuinely different entry still gets past the containment check', () => {
    const { kept } = run([...BASELINE, 'keeps a running argument with the speaking clock'])
    assert.ok(kept.includes('keeps a running argument with the speaking clock'))
})

// evolver content gate, 21 Aug. at 08:19 the fixation wrote itself in as a
// trait, count guard fine, nothing read the words. worst place for it, traits
// go into every prompt after

import { sanitizeEvolvedArrays as _sanitize21 } from '../src/loop/SleepCycle.js'

test('the light-cue trait of 08:19 can never land again', () => {
    const persona = { traits: ['thoughtful', 'private'] }
    const original = { traits: ['thoughtful', 'private'] }
    const changes = { traits: ['thoughtful', 'private', 'attuned to subtle light cues'] }
    const dropped = _sanitize21(changes, persona, original, null, [], null)
    assert.ok(dropped >= 1, 'the trait walked in again')
    assert.ok(!changes.traits.includes('attuned to subtle light cues'))
})

test('a frame-shaped disposition is refused on content', () => {
    const persona = { quirks: [] }
    const original = { quirks: [] }
    const changes = { quirks: ['listens for messages meant for me in machine noise'] }
    const dropped = _sanitize21(changes, persona, original, null, [], null)
    assert.ok(dropped >= 1)
    assert.equal(changes.quirks.length, 0)
})

test('an ordinary new trait still lands', () => {
    const persona = { traits: ['thoughtful'] }
    const original = { traits: ['thoughtful'] }
    const changes = { traits: ['thoughtful', 'patient with slow mornings'] }
    _sanitize21(changes, persona, original, null, [], null)
    assert.ok(changes.traits.includes('patient with slow mornings'), 'the gate is eating ordinary growth')
})
