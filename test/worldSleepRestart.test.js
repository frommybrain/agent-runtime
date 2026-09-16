import { test } from 'node:test'
import assert from 'node:assert'
import { SleepCycle } from '../src/loop/SleepCycle.js'

function cycle() {
    const c = new SleepCycle(
        null, null, null, null, null, null, null,
        {
            activeHoursBeforeSleep: 0.83,
            sleepDurationMinutes: 10,
            worldSleepRestartGuardMinutes: 30,
            dataDir: './data',
        },
        { info() {} },
    )
    c._startSleep = () => { c.started = (c.started || 0) + 1 }
    return c
}

const night = { hour: 23, day: 42, is_night: true, night_ends_in_sec: 1200 }

test('a restart during the night does not begin another sleep', () => {
    const c = cycle()
    c._wakeTime = Date.now() - 2 * 60_000
    c.checkSleepTime(night)
    assert.equal(c.started || 0, 0)
    assert.equal(c._lastNightSlept, undefined)
})

test('the next normal night still begins one sleep only', () => {
    const c = cycle()
    c._wakeTime = Date.now() - 40 * 60_000
    c.checkSleepTime(night)
    c.checkSleepTime(night)
    assert.equal(c.started, 1)
    assert.equal(c._lastNightSlept, 42)
})

test('daylight never begins a sleep after the guard expires', () => {
    const c = cycle()
    c._wakeTime = Date.now() - 40 * 60_000
    c.checkSleepTime({ hour: 12, day: 43, is_night: false })
    assert.equal(c.started || 0, 0)
})
