import { test } from 'node:test'
import assert from 'node:assert/strict'

import { activeWork } from '../src/loop/Heartbeat.js'
import { perceive } from '../src/cognition/Perceive.js'
import { readFileSync } from 'node:fs'

test('structured execution state blocks a new decision', () => {
    assert.deepEqual(
        activeWork({ self: { busy: true, action: 'inspect (30%)' } }),
        { kind: 'action', target: 'inspect (30%)' },
    )
    assert.deepEqual(
        activeWork({ self: { journey: { active: true, target: 'artifact_shrine' } } }),
        { kind: 'journey', target: 'artifact_shrine' },
    )
    assert.equal(activeWork({ self: { busy: false, action: 'idle' } }), null)
})

test('legacy movement prose remains compatible', () => {
    assert.deepEqual(
        activeWork({ self: { action: 'move toward the shrine for inspect' } }),
        { kind: 'journey', target: null },
    )
})

test('large observations keep immediate state and narrative within a fixed bound', () => {
    const observation = {
        self: { name: 'Pino', pos: { x: 1, z: 2 }, action: 'idle', busy: false },
        nearby_objects: Array.from({ length: 40 }, (_, i) => ({
            id: `place_${i}`,
            name: `Place ${i}`,
            state: { description: 'x'.repeat(1200) },
        })),
        environment: 'A wet evening. '.repeat(400),
        narrative: { open_threads: Array.from({ length: 30 }, (_, i) => `thread ${i} ${'y'.repeat(300)}`) },
        drives: [{ tool: 'inspect', question: 'What is waiting at the shrine?' }],
    }
    const text = perceive(observation, [])
    assert.ok(text.length <= 12000, `perception was ${text.length} chars`)
    assert.match(text, /My position/)
    assert.match(text, /What is waiting at the shrine/)
    assert.match(text, /less relevant detail omitted/)
})

test('a genuinely stuck heartbeat exits so systemd can recover it', () => {
    const source = readFileSync(new URL('../src/loop/Heartbeat.js', import.meta.url), 'utf8')
    assert.match(source, /Heartbeat stalled[\s\S]*process\.exit\(1\)/)
    assert.match(source, /clearInterval\(this\._watchdog\)/)
})
