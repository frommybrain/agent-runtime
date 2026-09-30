import { test } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Budget } from '../src/llm/Budget.js'
import { LLMClient } from '../src/llm/LLMClient.js'
import { SleepCycle } from '../src/loop/SleepCycle.js'

const quiet = { info() {}, warn() {}, error() {}, debug() {} }
const DAY = 86400e3

test('no ceiling set means no ceiling', () => {
    const b = new Budget({}, quiet)
    for (let i = 0; i < 500; i++) b.record({ in: 4000, out: 500 })
    assert.equal(b.allows(), true)
})

test('calls and tokens both stop it, and a new UTC day starts again', () => {
    const now = Date.parse('2026-10-01T12:00:00Z')
    const calls = new Budget({ dailyCallBudget: 2 }, quiet)
    calls.record({ in: 10, out: 10 }, 0, now)
    assert.equal(calls.allows(now), true)
    calls.record({ in: 10, out: 10 }, 0, now)
    assert.equal(calls.allows(now), false)
    assert.equal(calls.snapshot(now).refused, 1)
    assert.equal(calls.allows(now + DAY), true, 'tomorrow')

    const tokens = new Budget({ dailyTokenBudget: 1000 }, quiet)
    tokens.record({ in: 900, out: 50 }, 0, now)
    assert.equal(tokens.allows(now), true)
    tokens.record(null, 400, now)
    assert.equal(tokens.allows(now), false, 'no usage from the provider, guessed from the prompt')
})

test('the day is kept on disk, a restart doesnt get a fresh one', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'budget-'))
    const a = new Budget({ dataDir, dailyCallBudget: 3 }, quiet)
    a.record({ in: 5, out: 5 })
    a.record({ in: 5, out: 5 })
    a.record({ in: 5, out: 5 })
    a.flush()
    assert.equal(JSON.parse(readFileSync(join(dataDir, 'usage.json'), 'utf-8')).calls, 3)
    const b = new Budget({ dataDir, dailyCallBudget: 3 }, quiet)
    assert.equal(b.allows(), false)
})

test('spent: the door makes no paid call, and with no local model the tick gets nothing', async () => {
    const llm = new LLMClient({ cloudApiKey: 'k', cloudApiUrl: 'http://nowhere', cloudModel: 'm', cloudModelFast: 'm', dailyCallBudget: 1 }, quiet)
    llm.ollamaAvailable = false
    llm._lastOllamaCheck = Date.now()
    let paid = 0
    llm._cloudGenerate = async () => { paid++; return { content: '{"action":"wait"}', usage: { in: 100, out: 10 } } }
    const first = await llm.generate('sys', 'user', 1000, 'fast')
    assert.equal(first.text, '{"action":"wait"}')
    const second = await llm.generate('sys', 'user', 1000, 'fast')
    assert.equal(second.text, null)
    assert.equal(paid, 1)
    assert.equal(llm.tierCounts.budget, 1)
    assert.equal(llm.budget.snapshot().calls, 1)
})

test('local calls are free and dont count', async () => {
    const llm = new LLMClient({ dailyCallBudget: 1 }, quiet)
    llm.ollamaAvailable = true
    llm._lastOllamaCheck = Date.now()
    llm._ollamaGenerate = async () => ({ content: '{"action":"wait"}', usage: { in: 50, out: 5 } })
    await llm.generate('sys', 'user', 1000, 'quality')
    await llm.generate('sys', 'user', 1000, 'quality')
    assert.equal(llm.budget.snapshot().calls, 0)
})

function sleeper() {
    const passes = []
    const log = []
    const c = new SleepCycle(null, null, null, null, null, null, null, { dataDir: mkdtempSync(join(tmpdir(), 'sleep-')) }, quiet)
    c.dailyLog = { append: async (l) => log.push(l), flush: async () => {}, garbageCollect: async () => 0 }
    c.memoryFiles = { deduplicateMemory: async () => { passes.push('dedup'); return 0 } }
    c.workingMemory = { clear() {}, push() {} }
    c.internalState = { clearHistory() {} }
    c._consolidateMemory = async () => { passes.push('memory'); return true }
    c._extractSkills = async () => { passes.push('skills'); return true }
    c._selfReflect = async () => { passes.push('reflect'); return true }
    c._formDesire = async () => { passes.push('desire'); return true }
    c._sleepDelay = async () => {}
    c.sleepMinutes = 1
    return { c, passes, log }
}

test('a sleep after nothing was decided costs nothing', async () => {
    const { c, passes, log } = sleeper()
    await c._startSleep(false)
    clearTimeout(c._sleepTimer)
    assert.deepEqual(passes, [])
    assert.ok(log.some((l) => /no consolidation/.test(l)))
})

test('a sleep after real decisions consolidates as before, and waking starts the count again', async () => {
    const { c, passes } = sleeper()
    c.noteDecision()
    await c._startSleep(false)
    clearTimeout(c._sleepTimer)
    assert.deepEqual(passes, ['dedup', 'memory', 'skills', 'reflect', 'desire'])
    c._wake()
    assert.equal(c._decisionsSinceWake, 0)
})

test('the wiring: the door holds the budget, heartbeat counts real decisions, a wake event nudges, shutdown writes the day', () => {
    const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8')
    assert.match(src('../src/llm/LLMClient.js'), /this\.budget = new Budget\(config, logger\)/)
    assert.match(src('../src/llm/LLMClient.js'), /if \(!this\.budget\.allows\(\)\)/)
    assert.match(src('../src/loop/Heartbeat.js'), /if \(decision\.source !== 'fallback'\) this\.sleepCycle\?\.noteDecision\?\.\(\)/)
    assert.match(src('../src/index.js'), /e\?\.data\?\.event === 'agent_speech' \|\| e\?\.data\?\.wake === true\) heartbeat\.nudge\(\)/)
    assert.match(src('../src/index.js'), /llmClient\.budget\?\.flush\(\)/)
    assert.match(src('../src/config.js'), /dailyCallBudget: parseInt\(process\.env\.DAILY_CALL_BUDGET \|\| '0'\)/)
})
