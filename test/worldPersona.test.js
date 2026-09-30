import { test } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EnvironmentSocket } from '../src/connection/EnvironmentSocket.js'
import { Heartbeat } from '../src/loop/Heartbeat.js'
import { SleepCycle } from '../src/loop/SleepCycle.js'

const quiet = { info() {}, warn() {}, error() {}, debug() {} }

function socket() {
    return new EnvironmentSocket({ serverUrl: 'ws://nowhere', agentId: 'a', reconnectIntervalMs: 1000 }, quiet)
}

test('a PERSONA from the world reaches whoever is listening, null included', () => {
    const s = socket()
    const got = []
    s.onPersona((p) => got.push(p))
    s._handleMessage({ type: 'PERSONA', persona: { name: 'moss', worldVersion: 1 } })
    s._handleMessage({ type: 'PERSONA', persona: null })
    assert.deepEqual(got, [{ name: 'moss', worldVersion: 1 }, null])
})

test('world events are still queued, and the listener hears them as they come', () => {
    const s = socket()
    const heard = []
    s.onWorldEvent((e) => heard.push(e.data.event))
    s._handleMessage({ type: 'WORLD_EVENT', data: { event: 'agent_speech', message: 'hello' } })
    assert.deepEqual(heard, ['agent_speech'])
    assert.equal(s.drainWorldEvents().length, 1)
})

// nudge on a stub, the real constructor wants the whole agent
function beat() {
    const hb = Object.create(Heartbeat.prototype)
    hb._timer = setTimeout(() => {}, 60_000)
    hb._ticking = false
    hb.ticks = 0
    hb._tick = async () => { hb.ticks++ }
    hb._scheduleNext = () => { hb._timer = setTimeout(() => {}, 60_000) }
    hb.logger = quiet
    return hb
}

test('being spoken to brings the next tick forward', async () => {
    const hb = beat()
    hb.nudge(10)
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(hb.ticks, 1)
    clearTimeout(hb._timer)
})

test('a nudge during a tick waits for it to finish, and a stopped heartbeat stays stopped', () => {
    const hb = beat()
    hb._ticking = true
    hb.nudge(10)
    assert.equal(hb._nudged, true)
    clearTimeout(hb._timer)
    const stopped = beat()
    clearTimeout(stopped._timer)
    stopped._timer = null
    stopped.nudge(10)
    assert.equal(stopped._timer, null)
})

test('a rewrite from the world becomes the baseline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'baseline-'))
    const c = new SleepCycle(null, null, null, null, null, null, null, { dataDir: dir }, quiet)
    const next = { name: 'moss', traits: ['shy', 'bright'], values: [], fears: ['the dark'], quirks: [], voice: { style: 'short' }, worldVersion: 2 }
    await c.replaceBaseline(next)
    assert.equal(JSON.parse(readFileSync(join(dir, 'persona-baseline.json'), 'utf-8')).worldVersion, 2)
    assert.deepEqual(c._originalPersona.traits, ['shy', 'bright'])
})
