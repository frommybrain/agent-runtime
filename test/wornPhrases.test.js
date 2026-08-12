// A phrase coming back whole is a stuck record, and the word-level guard
// could not see it: "settle my legs" eleven times in an afternoon only
// nudged "settle" and "leg" toward their separate thresholds.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wornPhrases } from '../src/util/wornWords.js'

test('a phrase said twice is a tic even when its words pass alone', () => {
    const reasons = [
        'Pond water might settle my legs',
        'Need the pond, it should settle my legs again',
        'Hungry, grabbing a quick bite',
    ]
    const worn = wornPhrases(reasons)
    assert.ok(worn.includes('settle my legs'), `got: ${worn.join(', ')}`)
})

test('the shorter gram inside a reported phrase is not reported twice', () => {
    const reasons = ['settle my legs', 'settle my legs']
    const worn = wornPhrases(reasons)
    assert.equal(worn.filter((w) => w.includes('legs')).length, 1)
})

test('an inflection shift still gets caught through the stable words', () => {
    // "settling" and "settle" stem apart (the shared stem does not fold
    // e-final verbs), but the phrase is still caught by the part that
    // holds still. What matters is that SOMETHING flags, not which slice.
    const worn = wornPhrases(['settling my legs by the pond', 'need to settle my legs'])
    assert.ok(worn.some((w) => w.includes('legs')), `got: ${worn.join(', ')}`)
})

test('a phrase of nothing but stopwords never flags', () => {
    const worn = wornPhrases(['need to get out', 'need to get moving'])
    assert.ok(!worn.includes('need to'), `got: ${worn.join(', ')}`)
})

test('once is not a tic', () => {
    assert.deepEqual(wornPhrases(['a red glove under the drum']), [])
})
