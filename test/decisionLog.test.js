import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DecisionLog, evidenceKeys } from '../src/logging/DecisionLog.js'
import { Heartbeat } from '../src/loop/Heartbeat.js'
import { RepetitionGuard } from '../src/cognition/RepetitionGuard.js'
import { LLMClient } from '../src/llm/LLMClient.js'
import { Think } from '../src/cognition/Think.js'

const logger = { info() {}, warn() {}, error() {}, debug() {} }

test('a recorded decision lands in that day\'s file with the build that wrote it, and old days are cleared', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'decisions-'))
    try {
        const log = new DecisionLog({ dataDir, decisionLogDays: 14 }, logger, { code: 'abc1234' })
        await log.init()
        log.record({ tick: 7, tier: 'fast', why: 'default' })
        await log.flush()

        const today = new Date().toISOString().slice(0, 10)
        const lines = (await readFile(join(dataDir, 'decisions', `${today}.jsonl`), 'utf-8')).trim().split('\n')
        assert.equal(lines.length, 1)
        const row = JSON.parse(lines[0])
        assert.equal(row.code, 'abc1234')
        assert.equal(row.tick, 7)
        assert.equal(row.why, 'default')
        assert.match(row.t, /^\d{4}-\d{2}-\d{2}T/)

        await writeFile(join(dataDir, 'decisions', '2020-01-01.jsonl'), '{}\n')
        assert.equal(await log.garbageCollect(), 1)
        assert.deepEqual(await readdir(join(dataDir, 'decisions')), [`${today}.jsonl`])
        await log.stop()
    } finally {
        await rm(dataDir, { recursive: true, force: true })
    }
})

test('the evidence keys ignore the clock and exact distances, and notice what changes the question', () => {
    const base = () => ({
        self: { pos: { x: 10, z: 20 }, needs: { hunger: { level: 30, urgency: 'low' } } },
        world_clock: { hour: 13.25, is_night: false },
        available_actions: [{ name: 'forage' }, { name: 'wait' }],
        pending_sacrifices: 1,
        nearby_objects: [{ id: 'food_1', name: 'the apple tree (open)', away: 'a short walk', distance: 12.3 }],
        environment: 'A grey afternoon.',
        recent_events: ['ate an apple'],
    })
    const last = { action: 'forage', success: true }
    const keys = evidenceKeys(base(), [], last)
    assert.match(keys.scene, /^[0-9a-f]{10}$/)

    const same = base()
    same.world_clock.hour = 14.9
    same.nearby_objects[0].distance = 12.9
    same.recent_events = ['something else he wrote']
    same.available_actions.reverse()
    assert.deepEqual(evidenceKeys(same, [], last), keys, 'clock, exact distance, his own lines and menu order are not new evidence')

    const relabelled = base()
    relabelled.nearby_objects[0].name = 'the apple tree (closed until morning)'
    const r = evidenceKeys(relabelled, [], last)
    assert.equal(r.scene, keys.scene, 'a new label is detail, not a new scene')
    assert.notEqual(r.detail, keys.detail)

    const changes = {
        'felt distance': (o) => { o.nearby_objects[0].away = 'right here' },
        'need urgency': (o) => { o.self.needs.hunger.urgency = 'high' },
        'waiting notes': (o) => { o.pending_sacrifices = 2 },
        'menu': (o) => { o.available_actions.push({ name: 'inspect' }) },
        'night': (o) => { o.world_clock.is_night = true },
    }
    for (const [what, change] of Object.entries(changes)) {
        const o = base()
        change(o)
        assert.notEqual(evidenceKeys(o, [], last).scene, keys.scene, what)
    }
    assert.notEqual(evidenceKeys(base(), [], { action: 'forage', success: false }).scene, keys.scene, 'how the last action went')
    assert.notEqual(evidenceKeys(base(), [{ data: { event: 'agent_speech' } }], last).scene, keys.scene, 'a world event')
})

test('every repetition warning carries its kind, and check() still hands the prompt the same text', () => {
    const guard = new RepetitionGuard({}, logger)
    for (const reason of ['hungry again', 'still hungry', 'hungry, the tree']) {
        guard.record('forage', { target: 'food_1', reason })
    }
    const detailed = guard.checkDetailed()
    assert.ok(detailed.every((w) => typeof w.kind === 'string' && typeof w.text === 'string'))
    assert.ok(detailed.some((w) => w.kind === 'same_action_x3'))
    assert.deepEqual(guard.check(), detailed.map((w) => w.text))
    assert.equal(new RepetitionGuard({}, logger).checkDetailed(), null)
})

test('the tier comes with the rule that chose it', () => {
    const hb = Object.create(Heartbeat.prototype)
    assert.deepEqual(hb._classifyTick([], [], {}, { self: { asleep: true } }), { tier: 'skip', why: 'asleep' })
    assert.deepEqual(
        hb._classifyTick([], [], { repetitionWarnings: ['a', 'b'], repetitionKinds: ['wording_rut', 'same_action_x3'] }, {}),
        { tier: 'quality', why: 'repetition:same_action_x3+wording_rut' },
    )
    assert.deepEqual(
        hb._classifyTick([], [{ data: { event: 'agent_speech' } }], {}, {}),
        { tier: 'quality', why: 'world_event:agent_speech' },
    )
    assert.deepEqual(hb._classifyTick([{ type: 'appeared' }], [], {}, {}), { tier: 'fast', why: 'appeared_or_gone' })
    assert.deepEqual(hb._classifyTick([], [], {}, {}), { tier: 'skip', why: 'nothing_new' })
    assert.deepEqual(hb._classifyTick([{ type: 'modified' }], [], {}, {}), { tier: 'fast', why: 'default' })
})

test('the client says which model answered after a demotion, what it cost and how long the chain took', async () => {
    const client = new LLMClient({
        cloudApiKey: 'k', cloudApiUrl: 'https://llm.example/v1/chat/completions',
        cloudModel: 'big', cloudModelFast: 'small', temperature: 0.7, maxTokens: 100,
        ollamaHost: 'http://127.0.0.1:9', ollamaModel: 'local',
    }, logger)
    client._lastOllamaCheck = Date.now()
    const realFetch = globalThis.fetch
    const asked = []
    globalThis.fetch = async (url, init) => {
        const body = JSON.parse(init.body)
        asked.push(body.model)
        if (body.model === 'big') {
            return { ok: false, status: 400, statusText: 'Bad Request', text: async () => 'json_validate_failed' }
        }
        return {
            ok: true,
            json: async () => ({
                choices: [{ message: { content: '{"action":"wait"}' } }],
                usage: { prompt_tokens: 1200, completion_tokens: 80, completion_tokens_details: { reasoning_tokens: 30 } },
            }),
        }
    }
    try {
        const out = await client.generate('sys', 'user', 5000, 'quality')
        assert.deepEqual(asked, ['big', 'small'])
        assert.equal(out.text, '{"action":"wait"}')
        assert.equal(out.source, 'cloud-fast')
        assert.equal(out.model, 'small')
        assert.deepEqual(out.usage, { in: 1200, out: 80, reasoning: 30 })
        assert.equal(typeof out.ms, 'number')
    } finally {
        globalThis.fetch = realFetch
    }
})

function thinkWith(generate) {
    return new Think(
        { generate },
        { buildSystemPrompt: () => 'SYS', buildUserPrompt: () => 'USER', persona: {} },
        {
            readMemory: async () => '', readSkills: async () => '', readTools: async () => '',
            readCurrentThread: async () => null, appendToMemory: async () => {},
        },
        { readRecentLines: async () => [] },
        { recent: () => [] },
        logger,
    )
}

test('Think hands up the model, the prompt size, and why it fell back when it did', async () => {
    const observation = { self: { name: 'Pino' }, available_actions: [{ name: 'forage' }, { name: 'wait' }] }
    const answered = await thinkWith(async () => ({
        text: '{"action":"forage","params":{"target":"food_1"},"reason":"the tree is close"}',
        source: 'cloud', model: 'big', usage: { in: 10, out: 5, reasoning: 1 }, ms: 12,
    })).decide(observation, [], { tier: 'fast' })
    assert.equal(answered.action, 'forage')
    assert.deepEqual(answered.llm, { model: 'big', ms: 12, usage: { in: 10, out: 5, reasoning: 1 } })
    assert.equal(answered.promptChars, 'SYS'.length + 'USER'.length)
    assert.equal(answered.fallback, undefined)

    const silent = await thinkWith(async () => ({ text: '', source: null })).decide(observation, [], { tier: 'fast' })
    assert.equal(silent.source, 'fallback')
    assert.equal(silent.fallback, 'no_answer')

    const garbled = await thinkWith(async () => ({ text: 'I think I will forage', source: 'cloud' })).decide(observation, [], { tier: 'fast' })
    assert.equal(garbled.fallback, 'unparseable')
    assert.equal(garbled.raw, 'I think I will forage')

    const skipped = await thinkWith(async () => { throw new Error('not called') }).decide(observation, [], { tier: 'skip' })
    assert.equal(skipped.fallback, 'skip')
})

// A Heartbeat with every collaborator stubbed, so a whole tick can run.
function harness({ observation, decide, act }) {
    const acts = []
    const recorded = []
    const calls = { decide: 0 }
    const socket = {
        isConnected: () => true,
        observe: async () => observation,
        drainWorldEvents: () => [],
        act: async (action, params) => {
            acts.push({ action, params })
            return act ? act(action, params) : { success: true, message: 'done' }
        },
    }
    const think = {
        promptBuilder: { persona: { name: 'Pino', traits: ['watchful'] } },
        llm: { async generate() { return { text: JSON.stringify({ reason: 'Somebody left a note by the wall and it has sat there a while.' }) } } },
        async decide(...args) {
            calls.decide++
            return decide(...args)
        },
    }
    const hb = new Heartbeat(
        socket,
        think,
        { push() {}, recentReasons: () => [], recent: () => [] },
        { updateToolsFromObservation: async () => {} },
        { append: async () => {}, isGCOverdue: () => false },
        { isSleeping: () => false, checkSleepTime() {} },
        {
            salience: () => 0.5, updateStability() {}, update() {},
            describe: () => ({ mood: 0.1, energy: 0.2 }),
            applySpeechCreativity() {}, checkpoint: async () => {},
        },
        { detect: () => [{ type: 'modified', id: 'food_1' }], narrate: () => '' },
        new RepetitionGuard({}, logger),
        { recentForPrompt: () => null, record() {}, save: async () => {} },
        { heartbeatIntervalMs: 8000 },
        logger,
    )
    hb.decisionLog = { record: (row) => recorded.push(row) }
    return { hb, acts, recorded, calls }
}

const town = () => ({
    self: { pos: { x: 0, z: 0 }, needs: { hunger: { level: 20, urgency: 'low' } } },
    available_actions: [{ name: 'wait' }, { name: 'inspect' }, { name: 'forage' }],
    nearby_objects: [{ id: 'food_1', name: 'the apple tree', away: 'close', type: 'FOOD_SPOT' }],
    pending_sacrifices: 0,
})

test('a tick writes one line: what the brain asked for, what the guards sent instead, and how it went', async () => {
    const { hb, acts, recorded } = harness({
        observation: town(),
        decide: async () => ({
            action: 'fly_away', params: { target: 'moon' }, reason: 'the moon looks close tonight',
            source: 'cloud-fast', llm: { model: 'small', ms: 420, usage: { in: 7000, out: 180, reasoning: 90 } }, promptChars: 28000,
        }),
    })
    await hb._tick()
    assert.equal(recorded.length, 1)
    const row = recorded[0]
    assert.equal(row.tier, 'fast')
    assert.equal(row.why, 'default')
    assert.deepEqual(row.asked, { action: 'fly_away', target: 'moon' })
    assert.deepEqual(row.took, { action: 'wait', target: null })
    assert.ok(row.overrides.includes('not_on_menu'))
    assert.equal(row.source, 'cloud-fast')
    assert.equal(row.model, 'small')
    assert.equal(row.ms, 420)
    assert.deepEqual(row.tokens, { in: 7000, out: 180, reasoning: 90 })
    assert.equal(row.promptChars, 28000)
    assert.equal(row.menu, 3)
    assert.match(row.scene, /^[0-9a-f]{10}$/)
    assert.match(row.persona, /^[0-9a-f]{10}$/)
    assert.deepEqual(row.result, { ok: true, msg: 'done' })
    assert.deepEqual(acts.map((a) => a.action), ['wait'])
})

test('an overdue note is read without asking the model, so no discarded decision leaves a memory behind', async () => {
    const observation = town()
    observation.pending_sacrifices = 3
    observation.nearby_objects.push({ id: 'sacrifice_1', type: 'SACRIFICE', name: 'an offering', away: 'close', waited_min: 90, from: 'J' })
    const { hb, acts, recorded, calls } = harness({
        observation,
        decide: async () => ({
            action: 'forage', params: { target: 'food_1' }, reason: 'hungry', source: 'cloud',
            remember: { section: 'Learned Facts', content: 'a choice he never made' },
        }),
    })
    hb._lastOfferingAttentionAt = 0
    await hb._tick()
    assert.equal(calls.decide, 0, 'the model is not asked for a decision the slot would throw away')
    assert.deepEqual(acts.map((a) => a.action), ['inspect'], 'and nothing is sent as remember')
    assert.equal(acts[0].params.target, 'sacrifice_1')
    const row = recorded[0]
    assert.equal(row.source, 'visitor-attention')
    assert.equal(row.asked, null)
    assert.deepEqual(row.took, { action: 'inspect', target: 'sacrifice_1' })
    assert.equal(row.remember, undefined)
})

test('a tick that throws half way still leaves its line, with the error on it', async () => {
    const { hb, recorded } = harness({
        observation: town(),
        decide: async () => ({ action: 'forage', params: { target: 'food_1' }, reason: 'the tree is close', source: 'cloud' }),
        act: () => { throw new Error('socket closed') },
    })
    await hb._tick()
    assert.equal(recorded.length, 1)
    assert.equal(recorded[0].error, 'socket closed')
    assert.deepEqual(recorded[0].took, { action: 'forage', target: 'food_1' })
})

test('the runtime builds the decision log, hands it to the heartbeat and flushes it on shutdown', () => {
    const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
    assert.match(source, /import \{ DecisionLog \} from '\.\/logging\/DecisionLog\.js'/)
    assert.match(source, /new DecisionLog\(config, logger, \{ code \}\)/)
    assert.match(source, /await decisionLog\.init\(\)/)
    assert.match(source, /heartbeat\.decisionLog = decisionLog/)
    assert.match(source, /await decisionLog\.stop\(\)/)
})
