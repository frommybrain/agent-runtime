// The character sheet was meant to change about twice a day and was being
// reconsidered every sleep. Fixtures are the real evolution log off the Pi
// on 11 Aug: thirteen runs in twenty-one hours, nine of them proposing the
// same trait with a byte-identical list because nothing ever landed.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { lastEvolutionAt } from '../src/loop/SleepCycle.js'
import { MemoryFiles } from '../src/memory/MemoryFiles.js'

const quiet = { info() {}, warn() {}, error() {}, debug() {} }

test('the gap check can read the timestamp it actually writes', () => {
    // written as `date` by _selfReflect, and read as `at` for months
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
    // twelve extractions on 11 Aug, twelve rejections: the prompt asked for
    // "a simple markdown bullet list" and the validator demanded a header
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
