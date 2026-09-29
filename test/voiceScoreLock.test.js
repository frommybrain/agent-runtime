// voiceScore.js is a copy of the sim's scorer (no shared package, the pi has
// no install step). the copy carries a fingerprint of itself so an edit here
// that skips the sync fails loudly instead of drifting quietly.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { createHash } from 'crypto'

const STAMP = /^\/\/ fingerprint: ([a-f0-9]{16})$/m

test('the voice scorer matches its own fingerprint', () => {
    const src = readFileSync(new URL('../src/util/voiceScore.js', import.meta.url), 'utf-8')
    const declared = src.match(STAMP)?.[1]
    assert.ok(declared, 'no fingerprint stamped: run npm run sync:voice')

    const actual = createHash('sha256')
        .update(src.replace(STAMP, '').trim())
        .digest('hex').slice(0, 16)

    assert.equal(actual, declared,
        'the voice scorer was edited without syncing. Run `npm run sync:voice` from sim-server so both repos move together, then commit both.')
})
