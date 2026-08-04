// The voice scorer exists in this repo and in agent-runtime, because they
// are two codebases with two deploy targets and the Pi's service has no
// install step for a shared package.
//
// That duplication is exactly what cost hours this morning: wornWords lived
// in both, one copy had a stemming bug, and nothing complained. So each copy
// carries a fingerprint of its own contents and this test recomputes it.
// Edit the file without running `npm run sync:voice` and this fails, which
// is the alarm that was missing.

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
