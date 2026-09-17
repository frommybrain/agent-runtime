import { test } from 'node:test'
import assert from 'node:assert/strict'

import { activeWork, dueOfferingAttention, attentionReason } from '../src/loop/Heartbeat.js'
import { perceive } from '../src/cognition/Perceive.js'
import { Think } from '../src/cognition/Think.js'
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

test('an overdue offering receives a bounded inspection slot', () => {
    const observation = {
        pending_sacrifices: 12,
        self: { needs: { hunger: { level: 40 }, rest: { level: 20 }, safety: { level: 10 } } },
        available_actions: [{ name: 'inspect' }, { name: 'forage' }],
        nearby_objects: [
            { id: 'artifact_shrine', type: 'ARTIFACT' },
            { id: 'sacrifice_oldest', type: 'SACRIFICE' },
        ],
    }
    const due = dueOfferingAttention(observation, 0, 1_000_000, 15)
    assert.equal(due.target, 'sacrifice_oldest')
    assert.equal(due.intervalMinutes, 2.5)
})

test('critical needs and recent attention keep their priority', () => {
    const observation = {
        pending_sacrifices: 1,
        self: { needs: { hunger: { level: 95 } } },
        available_actions: [{ name: 'inspect' }, { name: 'forage' }],
        nearby_objects: [{ id: 'artifact_shrine', type: 'ARTIFACT' }],
    }
    assert.equal(dueOfferingAttention(observation, 0, 1_000_000, 15), null)

    observation.self.needs.hunger.level = 20
    assert.equal(dueOfferingAttention(observation, 200_000, 1_000_000, 15), null)
    assert.equal(dueOfferingAttention(observation, 0, 1_000_000, 15)?.target, 'artifact_shrine')
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

test('the final user-prompt fitter preserves current state and the response instruction', () => {
    const think = Object.create(Think.prototype)
    const prompt = `TIME AND STATE\n${'old context '.repeat(2000)}\nCURRENT SITUATION: shrine\nWhat do you do? Respond with JSON only.`
    const fitted = think._trimUserPrompt(prompt, 1200)
    assert.equal(fitted.length, 1200)
    assert.match(fitted, /^TIME AND STATE/)
    assert.match(fitted, /CURRENT SITUATION: shrine/)
    assert.match(fitted, /Respond with JSON only\.$/)
})


test('a crystal that read nothing hands the next slot to the shrine, and a moving queue hands it back', () => {
    const observation = {
        pending_sacrifices: 8,
        self: { needs: { hunger: { level: 30 } } },
        available_actions: [{ name: 'inspect' }, { name: 'forage' }],
        nearby_objects: [
            { id: 'artifact_shrine', type: 'ARTIFACT' },
            { id: 'sacrifice_oldest', type: 'SACRIFICE', waited_min: 720, from: 'Cocoepi' },
            { id: 'sacrifice_newer', type: 'SACRIFICE', waited_min: 40, from: 'J' },
        ],
    }
    const first = dueOfferingAttention(observation, 0, 1_000_000, 15, null)
    assert.equal(first.target, 'sacrifice_oldest', 'the world lists the oldest first and it goes first')
    assert.equal(first.kind, 'crystal')
    assert.equal(first.waitedMin, 720)
    assert.equal(first.from, 'Cocoepi')
    // Nothing was read: same count, so the shrine takes the slot.
    const second = dueOfferingAttention(observation, 0, 1_000_000, 15, { kind: 'crystal', target: 'sacrifice_oldest', count: 8 })
    assert.equal(second.target, 'artifact_shrine')
    assert.equal(second.kind, 'shrine')
    // The queue moved after that: back to the crystals.
    observation.pending_sacrifices = 7
    const third = dueOfferingAttention(observation, 0, 1_000_000, 15, { kind: 'crystal', target: 'sacrifice_oldest', count: 8 })
    assert.equal(third.target, 'sacrifice_oldest')
    // A shrine attempt that read nothing is not repeated either.
    observation.pending_sacrifices = 8
    const fourth = dueOfferingAttention(observation, 0, 1_000_000, 15, { kind: 'shrine', target: 'artifact_shrine', count: 8 })
    assert.equal(fourth.target, 'sacrifice_oldest')
})

test('the reason is his own line from the facts, never the same one twice, and the facts stand when the model is silent', async () => {
    const seen = []
    const think = {
        promptBuilder: { persona: { name: 'Pino', voice: { style: 'Sparse, dry.' } } },
        llm: {
            async generate(system, user, timeoutMs, tier, jsonMode) {
                seen.push({ system, tier, jsonMode })
                return { text: JSON.stringify({ reason: 'Cocoepi left something twelve hours ago and I keep walking past it.' }) }
            },
        },
    }
    const due = { kind: 'crystal', target: 'sacrifice_oldest', count: 8, waitedMin: 720, from: 'Cocoepi' }
    const line = await attentionReason(think, due, ['Starving', 'Need a bite to calm the twitch'])
    assert.equal(line, 'Cocoepi left something twelve hours ago and I keep walking past it.')
    assert.equal(seen[0].tier, 'fast', 'a line, not a decision: the fast tier')
    assert.match(seen[0].system, /it was left by Cocoepi/, 'the facts go in')
    assert.match(seen[0].system, /it has waited 12 hours/, 'in words a bird would use')
    assert.match(seen[0].system, /7 more notes are waiting behind it/)
    assert.match(seen[0].system, /Starving/, 'and his recent reasons are ground to avoid')
    assert.ok(!/sitting long enough/.test(seen[0].system), 'no authored sentence anywhere in the prompt')

    // The model repeating a recent reason word for word is refused, and the facts stand.
    const echo = { ...think, llm: { async generate() { return { text: JSON.stringify({ reason: 'Starving' }) } } } }
    const held = await attentionReason(echo, due, ['Starving'])
    assert.equal(held, "Cocoepi's note has waited 12 hours, 7 more notes are waiting behind it")

    // Silence from the model: the facts, which at least change with the facts.
    const quiet = { ...think, llm: { async generate() { return { text: null } } } }
    assert.equal(await attentionReason(quiet, { kind: 'shrine', count: 1, waitedMin: 50, from: null }, []), 'a note has waited 50 minutes')
    assert.equal(await attentionReason(null, { kind: 'crystal', count: 2, waitedMin: 3, from: 'J' }, []), "J's note has waited 3 minutes, 1 more note is waiting behind it")
})
