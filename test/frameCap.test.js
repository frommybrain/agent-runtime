// message frame guard. the fixation got past a wipe, the stem bar and the
// twin pass by swapping objects and keeping the shape ("X holds a message
// from elsewhere"). real lines from the 19 Aug review

import { test } from 'node:test'
import assert from 'node:assert'
import { isMessageFrame, filterRecord } from '../src/util/record.js'

test('frame detector catches the hosts it has already worn', () => {
    for (const line of [
        'the payphone carries a voice from beyond the streets',
        'a message hidden in the dryer, meant for me',
        'the octopus holds words from somewhere else, waiting for me',
        'the stone is a sign from the other side',
    ]) {
        assert.ok(isMessageFrame(line), `should catch: ${line}`)
    }
})

test('frame detector leaves ordinary lines alone', () => {
    for (const line of [
        'the green stone counts visitors, the number is carved in',
        'left a message for the walker at the laundrette sill',
        'paddled at the pond edge until my legs went numb',
        'the payphone rang back once, nobody there',
        'a voice on the radio said rain tomorrow',
    ]) {
        assert.ok(!isMessageFrame(line), `should pass: ${line}`)
    }
})

test('the cap keeps the first N frame lines and drops the rest', () => {
    const md = [
        '## Important Memories',
        '- the payphone carries a voice from beyond the streets',
        '- paddled at the pond edge until my legs went numb',
        '- a message hidden in the dryer, meant for me',
        '- the octopus holds words from somewhere else, waiting for me',
        '- the stone is a sign from the other side',
    ].join('\n')
    const { text, crowded } = filterRecord(md, { frameCeiling: 2 })
    assert.equal(crowded, 2, 'two over the cap')
    assert.ok(text.includes('voice from beyond'), 'first frame line stays')
    assert.ok(text.includes('hidden in the dryer'), 'second frame line stays')
    assert.ok(!text.includes('words from somewhere else'), 'third drops')
    assert.ok(!text.includes('sign from the other side'), 'fourth drops')
    assert.ok(text.includes('pond edge'), 'ordinary line untouched')
})

test('a frame line eaten by the subject cap does not spend a frame slot', () => {
    const md = [
        '## Important Memories',
        '- the dryer hums in the laundrette',
        '- the dryer sits in the laundrette all day',
        '- the dryer carries a voice from beyond the streets of the laundrette',
        '- a message hidden under the bench, meant for me',
        '- a whisper from somewhere far away, waiting for me',
    ].join('\n')
    // subject cap eats the 3rd dryer line first, so both frame slots are
    // still free for the other two
    const { text } = filterRecord(md, { subjectCeiling: 2, frameCeiling: 2 })
    assert.ok(!text.includes('voice from beyond'), 'subject cap ate it')
    assert.ok(text.includes('hidden under the bench'), 'frame slot one')
    assert.ok(text.includes('whisper from somewhere'), 'frame slot two')
})

test('ceiling 0 disables the frame rule', () => {
    const md = '- a voice from beyond the streets\n- a message meant for me from somewhere far away'
    const { text, crowded } = filterRecord(md, { frameCeiling: 0 })
    assert.equal(crowded, 0)
    assert.ok(text.includes('voice from beyond'))
})

// 21 Aug, third re-key. it dropped the nouns and moved into verbs, detector
// passed all 28 live bullets when at least 4 were the frame. real lines

test('the verb forms are caught (21 Aug live corpus)', () => {
    for (const line of [
        "The pond's green glow sometimes hints at something I haven't seen yet.",
        "The octopus may mirror the lake's flicker, as if it knows what the glow hides.",
        'I paddled on the lake when my legs itched, chasing that elusive hint.',
        "I want to see if the lake's glow reveals something new.",
        "The junkheap's spray cans glint and promise something odd.",
    ]) {
        assert.ok(isMessageFrame(line), `should catch: ${line}`)
    }
})

test('the 21 Aug ordinary lines still pass', () => {
    for (const line of [
        'The glowing pond clears my head at night.',
        'The shrine sits quiet; I never know when a new offering appears.',
        'The phone line feels like a thin thread to reach out.',
        'Trades tick along on it by themselves and the balance moves.',
        'a hidden path behind the dumpsters',
        // actual museum glass, not a hidden meaning
        "I want to see what's under the glass in the Small Gods exhibit.",
    ]) {
        assert.ok(!isMessageFrame(line), `should pass: ${line}`)
    }
})
