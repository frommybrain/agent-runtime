// Automated test suite for agent-runtime v0.2
//
// Runs a WebSocket environment server and drives scenarios automatically.
// Polls agent /status to track internal state. Logs everything.
// Produces a summary report at the end.
//
// Usage:
//   1. Start the agent on the Pi: SERVER_URL=ws://<mac-ip>:4001 node src/index.js
//   2. Run this on the Mac: node test-suite.js
//
// The suite waits for the agent to connect, then runs through scenarios.

import { WebSocketServer } from 'ws'
import { mkdirSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'

const PORT = 4001
const AGENT_STATUS_URL = process.env.AGENT_STATUS_URL || 'http://victor.local:5000/status'

// ── Test Scenarios ──────────────────────────────────────────────────
const scenarios = [
    {
        name: 'Baseline (empty world)',
        ticks: 12,
        setup: (world) => {
            world.objects = []
            world.signals = null
            world.pendingSpeech = []
            world.synthMode = false
            world.nextFail = false
        },
        expect: 'Arousal and valence near 0. Heartbeat should be slow (12-15s).',
    },
    {
        name: 'Object appears',
        ticks: 8,
        setup: (world) => {
            world.objects = [{ id: 'terminal-01', type: 'terminal', interactive: true, pos: { x: 10, y: 0, z: -5 } }]
        },
        expect: 'Arousal spike from novelty. Agent should investigate the object.',
    },
    {
        name: 'Action failure',
        ticks: 6,
        setup: (world) => {
            world.nextFail = true
        },
        expect: 'Valence dip on failure. Agent tries something different next tick.',
    },
    {
        name: 'Stranger speaks',
        ticks: 8,
        setup: (world) => {
            world.pendingSpeech = [{ agentId: 'stranger', message: 'have you seen the artifact?' }]
            world.speechEvent = { event: 'agent_speech', agentId: 'stranger', message: 'have you seen the artifact?' }
        },
        expect: 'Agent sees speech in observation. Arousal nudge. Should respond or acknowledge.',
    },
    {
        name: 'Cosmology signals ON (low vitality)',
        ticks: 20,
        setup: (world) => {
            world.signals = { vitality: 0.3, resonance: 0.8, abundance: 0.6, warmth: 0.4 }
            world.pendingSpeech = []
        },
        expect: 'Arousal should climb toward 0.8 (resonance). Valence should go NEGATIVE (low vitality). Heartbeat speeds up.',
    },
    {
        name: 'Cosmology signals OFF (decay)',
        ticks: 12,
        setup: (world) => {
            world.signals = null
        },
        expect: 'Arousal and valence should decay back toward 0. Heartbeat slows.',
    },
    {
        name: 'High vitality + warmth',
        ticks: 12,
        setup: (world) => {
            world.signals = { vitality: 0.9, resonance: 0.5, abundance: 0.8, warmth: 0.9 }
        },
        expect: 'Valence should go POSITIVE (high vitality + warmth). Moderate arousal.',
    },
    {
        name: 'Second stranger speech',
        ticks: 6,
        setup: (world) => {
            world.pendingSpeech = [{ agentId: 'wanderer', message: 'something feels different today' }]
            world.speechEvent = { event: 'agent_speech', agentId: 'wanderer', message: 'something feels different today' }
        },
        expect: 'Agent should respond to wanderer. Check for contextual awareness.',
    },
    {
        name: 'Synth mode',
        ticks: 15,
        setup: (world) => {
            world.synthMode = true
            world.signals = null
            world.objects = []
        },
        expect: 'Agent handles non-spatial observations. No move_to or speak actions. Uses set_step, change_bpm, add_chord.',
    },
    {
        name: 'Return to spatial',
        ticks: 8,
        setup: (world) => {
            world.synthMode = false
            world.objects = [{ id: 'terminal-01', type: 'terminal', interactive: true, pos: { x: 10, y: 0, z: -5 } }]
        },
        expect: 'Clean transition back. No synth actions in spatial mode.',
    },
]

// ── World State ─────────────────────────────────────────────────────
let tickCount = 0
let agentId = null
let agentPos = { x: 0, y: 0, z: 0 }

const world = {
    objects: [],
    signals: null,
    pendingSpeech: [],
    speechEvent: null,
    synthMode: false,
    nextFail: false,
}

function buildObservation() {
    tickCount++

    if (world.synthMode) {
        return {
            self: { role: 'sequencer' },
            signals: { bpm: 120, energy: 0.7 },
            activeChords: ['Cmaj7', 'Dm9', 'G7'],
            availableSteps: 16,
            currentStep: tickCount % 16,
            available_actions: [
                { name: 'set_step', params: 'step, note', description: 'Set a note on a sequencer step' },
                { name: 'change_bpm', params: 'bpm', description: 'Change tempo' },
                { name: 'add_chord', params: 'chord', description: 'Add a chord to the pool' },
                { name: 'remove_chord', params: 'chord', description: 'Remove a chord from the pool' },
                { name: 'wait', description: 'Do nothing this tick' },
            ],
        }
    }

    const obs = {
        self: { id: agentId, pos: { ...agentPos }, action: 'IDLE' },
        nearbyAgents: [],
        nearbyObjects: [...world.objects],
        available_actions: [
            { name: 'move_to', params: 'x, z', description: 'Move to a position' },
            { name: 'speak', params: 'message', description: 'Say something' },
            { name: 'wait', description: 'Do nothing this tick' },
        ],
        recentSpeech: world.pendingSpeech.splice(0),
    }

    if (world.objects.some(o => o.interactive)) {
        obs.available_actions.push({ name: 'interact', params: 'target', description: 'Interact with a nearby object' })
    }
    if (world.signals) {
        obs.signals = { ...world.signals }
    }

    return obs
}

// ── Results Collection ──────────────────────────────────────────────
const results = {
    startTime: null,
    endTime: null,
    scenarios: [],
    statusPolls: [],
    actions: [],
    errors: [],
}

let currentScenario = null

function pollStatus() {
    return new Promise((resolve) => {
        const url = new URL(AGENT_STATUS_URL)
        const req = request({ hostname: url.hostname, port: url.port, path: url.pathname, timeout: 3000 }, (res) => {
            let data = ''
            res.on('data', chunk => { data += chunk })
            res.on('end', () => {
                try {
                    const status = JSON.parse(data)
                    const poll = {
                        tick: tickCount,
                        scenario: currentScenario?.name,
                        time: new Date().toISOString(),
                        valence: status.internalState?.valence,
                        arousal: status.internalState?.arousal,
                        valenceLabel: status.internalState?.valenceLabel,
                        arousalLabel: status.internalState?.arousalLabel,
                        description: status.internalState?.description,
                        heartbeatMs: status.heartbeatMs,
                    }
                    results.statusPolls.push(poll)
                    const is = status.internalState || {}
                    console.log(`    📊 tick=${tickCount} v=${is.valence?.toFixed(3)} a=${is.arousal?.toFixed(3)} [${is.valenceLabel}/${is.arousalLabel}] hb=${status.heartbeatMs}ms`)
                    if (is.description) console.log(`       "${is.description}"`)
                    resolve(poll)
                } catch { resolve(null) }
            })
        })
        req.on('error', () => resolve(null))
        req.end()
    })
}

// ── WebSocket Server ────────────────────────────────────────────────
const wss = new WebSocketServer({ port: PORT })
let activeSocket = null
let tickResolve = null  // resolve function for waiting on a tick

wss.on('listening', () => {
    console.log(`\n🧪 Test suite server running on ws://0.0.0.0:${PORT}`)
    console.log(`   Waiting for agent to connect...\n`)
})

wss.on('connection', (ws) => {
    activeSocket = ws
    console.log('   Agent connected!')

    ws.send(JSON.stringify({ type: 'WELCOME', serverName: 'test-suite' }))

    ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString())

        switch (msg.type) {
            case 'IDENTIFY':
                agentId = msg.agentId
                ws.send(JSON.stringify({
                    type: 'IDENTIFIED',
                    agentId: msg.agentId,
                    worldBounds: { halfSize: 100 },
                }))
                console.log(`   Agent identified: ${msg.agentId}`)
                // Start the test scenarios
                runScenarios(ws)
                break

            case 'OBSERVE': {
                const obs = buildObservation()

                // Inject speech world event if queued
                if (world.speechEvent) {
                    ws.send(JSON.stringify({ type: 'WORLD_EVENT', data: world.speechEvent }))
                    world.speechEvent = null
                }

                ws.send(JSON.stringify({ type: 'OBSERVATION', data: obs }))

                // Poll status every 2 ticks
                if (tickCount % 2 === 0) pollStatus()

                if (tickResolve) {
                    tickResolve()
                    tickResolve = null
                }
                break
            }

            case 'ACT': {
                const success = !world.nextFail
                world.nextFail = false

                if (success && msg.action === 'move_to' && msg.params) {
                    if (msg.params.x !== undefined) agentPos.x = msg.params.x
                    if (msg.params.z !== undefined) agentPos.z = msg.params.z
                }

                results.actions.push({
                    tick: tickCount,
                    scenario: currentScenario?.name,
                    action: msg.action,
                    params: msg.params,
                    success,
                    time: new Date().toISOString(),
                })

                ws.send(JSON.stringify({
                    type: 'ACTION_RESULT',
                    success,
                    message: success ? `${msg.action} completed` : 'Action failed: too far away',
                }))
                break
            }
        }
    })

    ws.on('close', () => {
        activeSocket = null
        console.log('   Agent disconnected')
    })
})

// ── Scenario Runner ─────────────────────────────────────────────────
function waitForTick() {
    return new Promise(resolve => { tickResolve = resolve })
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function runScenarios(ws) {
    results.startTime = new Date().toISOString()
    console.log(`\n${'='.repeat(60)}`)
    console.log(`  STARTING TEST SUITE — ${scenarios.length} scenarios`)
    console.log(`${'='.repeat(60)}\n`)

    // Give agent a moment to boot up
    await sleep(2000)

    for (const scenario of scenarios) {
        currentScenario = scenario
        const scenarioResult = {
            name: scenario.name,
            ticks: scenario.ticks,
            expect: scenario.expect,
            startTick: tickCount + 1,
            startTime: new Date().toISOString(),
            statusBefore: null,
            statusAfter: null,
            actions: [],
        }

        console.log(`\n--- ${scenario.name} (${scenario.ticks} ticks) ---`)
        console.log(`    Expected: ${scenario.expect}`)

        // Apply scenario setup
        scenario.setup(world)

        // Capture status at start
        scenarioResult.statusBefore = await pollStatus()

        // Wait for the required number of ticks
        for (let i = 0; i < scenario.ticks; i++) {
            await waitForTick()
        }

        // Capture status at end
        scenarioResult.statusAfter = await pollStatus()
        scenarioResult.endTick = tickCount
        scenarioResult.endTime = new Date().toISOString()

        // Collect actions from this scenario
        scenarioResult.actions = results.actions.filter(
            a => a.tick >= scenarioResult.startTick && a.tick <= scenarioResult.endTick
        )

        results.scenarios.push(scenarioResult)

        const after = scenarioResult.statusAfter
        if (after) {
            console.log(`    Result: v=${after.valence?.toFixed(3)} a=${after.arousal?.toFixed(3)} hb=${after.heartbeatMs}ms`)
        }
    }

    // Done — generate report
    results.endTime = new Date().toISOString()
    currentScenario = null

    console.log(`\n${'='.repeat(60)}`)
    console.log(`  TEST SUITE COMPLETE`)
    console.log(`${'='.repeat(60)}\n`)

    generateReport()

    // Keep server alive briefly for final polls, then exit
    await sleep(3000)
    process.exit(0)
}

// ── Report Generator ────────────────────────────────────────────────
function generateReport() {
    mkdirSync('test-results', { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

    // Save raw data
    writeFileSync(`test-results/${ts}-raw.json`, JSON.stringify(results, null, 2))

    // Generate human-readable report
    const lines = []
    lines.push(`# Test Suite Report — ${ts}`)
    lines.push(``)
    lines.push(`Total ticks: ${tickCount}`)
    lines.push(`Duration: ${results.startTime} to ${results.endTime}`)
    lines.push(`Total actions: ${results.actions.length}`)
    lines.push(``)

    // Scenario summaries
    lines.push(`## Scenario Results`)
    lines.push(``)

    for (const s of results.scenarios) {
        lines.push(`### ${s.name}`)
        lines.push(`Ticks: ${s.startTick}–${s.endTick} | Expected: ${s.expect}`)

        if (s.statusBefore && s.statusAfter) {
            const bv = s.statusBefore.valence?.toFixed(3) ?? '?'
            const ba = s.statusBefore.arousal?.toFixed(3) ?? '?'
            const av = s.statusAfter.valence?.toFixed(3) ?? '?'
            const aa = s.statusAfter.arousal?.toFixed(3) ?? '?'
            const bh = s.statusBefore.heartbeatMs ?? '?'
            const ah = s.statusAfter.heartbeatMs ?? '?'
            lines.push(`Valence: ${bv} → ${av} | Arousal: ${ba} → ${aa} | Heartbeat: ${bh}ms → ${ah}ms`)
            lines.push(`State: "${s.statusAfter.description}"`)
        }

        // Action breakdown
        const actionCounts = {}
        for (const a of s.actions) {
            actionCounts[a.action] = (actionCounts[a.action] || 0) + 1
        }
        lines.push(`Actions: ${Object.entries(actionCounts).map(([k, v]) => `${k}(${v})`).join(', ') || 'none'}`)

        // Check for spatial actions in synth mode
        if (s.name.includes('Synth')) {
            const spatialLeaks = s.actions.filter(a => ['move_to', 'speak', 'interact'].includes(a.action))
            if (spatialLeaks.length > 0) {
                lines.push(`⚠ SPATIAL LEAK: ${spatialLeaks.length} spatial action(s) in synth mode`)
            } else {
                lines.push(`✓ No spatial action leaks`)
            }
        }

        // Check for synth actions in spatial mode
        if (s.name.includes('Return to spatial')) {
            const synthLeaks = s.actions.filter(a => ['set_step', 'change_bpm', 'add_chord', 'remove_chord'].includes(a.action))
            if (synthLeaks.length > 0) {
                lines.push(`⚠ SYNTH LEAK: ${synthLeaks.length} synth action(s) in spatial mode`)
            } else {
                lines.push(`✓ No synth action leaks`)
            }
        }

        // Check for speech response
        if (s.name.includes('speaks') || s.name.includes('speech')) {
            const speechActions = s.actions.filter(a => a.action === 'speak')
            if (speechActions.length > 0) {
                lines.push(`✓ Agent spoke ${speechActions.length} time(s) (potential response)`)
            } else {
                lines.push(`⚠ Agent did not speak — may not have responded to speech`)
            }
        }

        lines.push(``)
    }

    // Valence/Arousal trajectory
    lines.push(`## Internal State Trajectory`)
    lines.push(``)
    lines.push(`| Tick | Scenario | Valence | Arousal | Heartbeat | Description |`)
    lines.push(`|------|----------|---------|---------|-----------|-------------|`)
    for (const p of results.statusPolls) {
        if (p) {
            lines.push(`| ${p.tick} | ${p.scenario || '-'} | ${p.valence?.toFixed(3) ?? '?'} | ${p.arousal?.toFixed(3) ?? '?'} | ${p.heartbeatMs ?? '?'}ms | ${p.description || ''} |`)
        }
    }
    lines.push(``)

    // Action diversity
    lines.push(`## Action Distribution`)
    lines.push(``)
    const totalActions = {}
    for (const a of results.actions) {
        totalActions[a.action] = (totalActions[a.action] || 0) + 1
    }
    for (const [action, count] of Object.entries(totalActions).sort((a, b) => b[1] - a[1])) {
        const pct = ((count / results.actions.length) * 100).toFixed(1)
        lines.push(`- ${action}: ${count} (${pct}%)`)
    }
    lines.push(``)

    // Speech content analysis
    lines.push(`## Speech Content`)
    lines.push(``)
    const speeches = results.actions.filter(a => a.action === 'speak')
    for (const s of speeches) {
        lines.push(`- [tick ${s.tick}, ${s.scenario}] "${s.params?.message}"`)
    }
    if (speeches.length === 0) lines.push(`(no speech actions recorded)`)
    lines.push(``)

    // Failures
    const failures = results.actions.filter(a => !a.success)
    if (failures.length > 0) {
        lines.push(`## Action Failures`)
        lines.push(``)
        for (const f of failures) {
            lines.push(`- [tick ${f.tick}] ${f.action} — failed`)
        }
        lines.push(``)
    }

    const report = lines.join('\n')
    writeFileSync(`test-results/${ts}-report.md`, report)
    console.log(report)
    console.log(`\n📝 Report saved to test-results/${ts}-report.md`)
    console.log(`📊 Raw data saved to test-results/${ts}-raw.json`)
}

process.on('SIGINT', () => {
    console.log('\nTest suite interrupted')
    if (results.startTime) {
        results.endTime = new Date().toISOString()
        generateReport()
    }
    process.exit(0)
})
