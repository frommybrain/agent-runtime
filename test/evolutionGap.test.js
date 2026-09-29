// sheet is meant to evolve ~twice a day, it was going every sleep.
// fixtures from the pi evolution log, 11 Aug: 13 runs in 21h, nine proposing
// the same trait with an identical list since nothing ever landed

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { lastEvolutionAt } from '../src/loop/SleepCycle.js'
import { MemoryFiles } from '../src/memory/MemoryFiles.js'

const quiet = { info() {}, warn() {}, error() {}, debug() {} }

test('the gap check can read the timestamp it actually writes', () => {
    // _selfReflect writes `date`, we were reading `at` for months
    const persona = { evolution: [{ date: '2026-08-11T11:14:39.467Z', reason: 'x' }] }
    assert.equal(lastEvolutionAt(persona), Date.parse('2026-08-11T11:14:39.467Z'))
})

test('an older log spelled `at` still counts', () => {
    assert.equal(
        lastEvolutionAt({ evolution: [{ at: '2026-08-10T14:09:01.357Z' }] }),
        Date.parse('2026-08-10T14:09:01.357Z'),
    )
})

test('the newest usable timestamp wins, junk entries are skipped', () => {
    const persona = {
        evolution: [
            { date: '2026-08-10T14:09:01.357Z' },
            { date: '2026-08-11T11:14:39.467Z' },
            { reason: 'no timestamp at all' },
        ],
    }
    assert.equal(lastEvolutionAt(persona), Date.parse('2026-08-11T11:14:39.467Z'))
})

test('a sheet that has never evolved reports null, not NaN', () => {
    assert.equal(lastEvolutionAt({}), null)
    assert.equal(lastEvolutionAt({ evolution: [] }), null)
    assert.equal(lastEvolutionAt(null), null)
})

test('a headerless bullet list is repaired rather than thrown away', () => {
    // 12 extractions on 11 Aug, 12 rejected. prompt asks for a plain bullet
    // list, validator wanted a header
    const files = new MemoryFiles({ dataDir: '/tmp', agentId: 'victor' }, quiet)
    const raw = '- I can forage apples from the apple tree.\n- I can rest in a nest.'

    assert.equal(files.validateSkillsContent(raw), false)
    const repaired = files.normaliseSkills(raw)
    assert.equal(files.validateSkillsContent(repaired), true)
    assert.ok(repaired.startsWith("# victor's Skills"))
    assert.ok(repaired.includes('forage apples'))
})

test('output that already has its header is left exactly alone', () => {
    const files = new MemoryFiles({ dataDir: '/tmp', agentId: 'victor' }, quiet)
    const raw = "# victor's Skills\n\n- I can rest in a nest."
    assert.equal(files.normaliseSkills(raw), raw)
})

test('genuinely broken output is still refused', () => {
    const files = new MemoryFiles({ dataDir: '/tmp', agentId: 'victor' }, quiet)
    assert.equal(files.validateSkillsContent(files.normaliseSkills('sorry, I cannot help')), false)
    assert.equal(files.validateSkillsContent(files.normaliseSkills('')), false)
})
