// automated test suite for 3aiii v0.2.
//
// runs a WebSocket env server and drives scenarios automatically.
// polls agent /status to track internal state. logs everything.
// dumps a summary report at the end.
//
// usage:
//   1. start agent on Pi: SERVER_URL=ws://<mac-ip>:4001 node src/index.js
//   2. run this on the Mac: node test-suite.js
//
// the suite waits for the agent to connect, then runs through scenarios.

import { WebSocketServer } from 'ws'
import { mkdirSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'

const PORT = 4001
const AGENT_STATUS_URL = process.env.AGENT_STATUS_URL || 'http://victor.local:5000/status'

// scenarios
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
        expect: 'Energy and mood near 0. Heartbeat should be slow (12-15s).',
    },
    {
        name: 'Object appears',
        ticks: 8,
        setup: (world) => {
            world.objects = [{ id: 'terminal-01', type: 'terminal', interactive: true, pos: { x: 10, y: 0, z: -5 } }]
        },
        expect: 'Energy spike from novelty. Agent should investigate the object.',
    },
    {
        name: 'Action failure',
        ticks: 6,
        setup: (world) => {
            world.nextFail = true
        },
        expect: 'Mood dip on failure. Agent tries something different next tick.',
    },
    {
        name: 'Stranger speaks',
        ticks: 8,
        setup: (world) => {
            world.pendingSpeech = [{ agentId: 'stranger', message: 'have you seen the artifact?' }]
            world.speechEvent = { event: 'agent_speech', agentId: 'stranger', message: 'have you seen the artifact?' }
        },
        expect: 'Agent sees speech in observation. Energy nudge. Should respond or acknowledge.',
    },
    {
        name: 'Cosmology signals ON (low vitality)',
        ticks: 20,
        setup: (world) => {
            world.signals = { vitality: 0.3, resonance: 0.8, abundance: 0.6, warmth: 0.4 }
            world.pendingSpeech = []
        },
        expect: 'Energy should climb toward 0.8 (resonance). Mood should go NEGATIVE (low vitality). Heartbeat speeds up.',
    },
    {
        name: 'Cosmology signals OFF (decay)',
        ticks: 12,
        setup: (world) => {
            world.signals = null
        },
        expect: 'Energy and mood should decay back toward 0. Heartbeat slows.',
    },
    {
        name: 'High vitality + warmth',
        ticks: 12,
        setup: (world) => {
            world.signals = { vitality: 0.9, resonance: 0.5, abundance: 0.8, warmth: 0.9 }
        },
        expect: 'Mood should go POSITIVE (high vitality + warmth). Moderate energy.',
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

// world state
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

// results
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
                        mood: status.internalState?.mood,
                        energy: status.internalState?.energy,
                        moodLabel: status.internalState?.moodLabel,
                        energyLabel: status.internalState?.energyLabel,
                        description: status.internalState?.description,
                        heartbeatMs: status.heartbeatMs,
                    }
                    results.statusPolls.push(poll)
                    const is = status.internalState || {}
                    console.log(`    📊 tick=${tickCount} v=${is.mood?.toFixed(3)} a=${is.energy?.toFixed(3)} [${is.moodLabel}/${is.energyLabel}] hb=${status.heartbeatMs}ms`)
                    if (is.description) console.log(`       "${is.description}"`)
                    resolve(poll)
                } catch { resolve(null) }
            })
        })
        req.on('error', () => resolve(null))
        req.end()
    })
}

// WebSocket server
const wss = new WebSocketServer({ port: PORT })
let activeSocket = null
let tickResolve = null  // resolve fn for waiting on a tick

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
                // start scenarios
                runScenarios(ws)
                break

            case 'OBSERVE': {
                const obs = buildObservation()

                // inject speech world event if queued
                if (world.speechEvent) {
                    ws.send(JSON.stringify({ type: 'WORLD_EVENT', data: world.speechEvent }))
                    world.speechEvent = null
                }

                ws.send(JSON.stringify({ type: 'OBSERVATION', data: obs }))

                // poll status every 2 ticks
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

// scenario runner
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

    // let the agent boot
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

        // apply scenario setup
        scenario.setup(world)

        // capture status at start
        scenarioResult.statusBefore = await pollStatus()

        // wait for the ticks
        for (let i = 0; i < scenario.ticks; i++) {
            await waitForTick()
        }

        // capture status at end
        scenarioResult.statusAfter = await pollStatus()
        scenarioResult.endTick = tickCount
        scenarioResult.endTime = new Date().toISOString()

        // collect actions from this scenario
        scenarioResult.actions = results.actions.filter(
            a => a.tick >= scenarioResult.startTick && a.tick <= scenarioResult.endTick
        )

        results.scenarios.push(scenarioResult)

        const after = scenarioResult.statusAfter
        if (after) {
            console.log(`    Result: v=${after.mood?.toFixed(3)} a=${after.energy?.toFixed(3)} hb=${after.heartbeatMs}ms`)
        }
    }

    // done, generate report
    results.endTime = new Date().toISOString()
    currentScenario = null

    console.log(`\n${'='.repeat(60)}`)
    console.log(`  TEST SUITE COMPLETE`)
    console.log(`${'='.repeat(60)}\n`)

    generateReport()

    // keep server alive briefly for final polls, then exit
    await sleep(3000)
    process.exit(0)
}

// report generator
function generateReport() {
    mkdirSync('test-results', { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

    // save raw data
    writeFileSync(`test-results/${ts}-raw.json`, JSON.stringify(results, null, 2))

    // generate human-readable report
    const lines = []
    lines.push(`# Test Suite Report — ${ts}`)
    lines.push(``)
    lines.push(`Total ticks: ${tickCount}`)
    lines.push(`Duration: ${results.startTime} to ${results.endTime}`)
    lines.push(`Total actions: ${results.actions.length}`)
    lines.push(``)

    // scenario summaries
    lines.push(`## Scenario Results`)
    lines.push(``)

    for (const s of results.scenarios) {
        lines.push(`### ${s.name}`)
        lines.push(`Ticks: ${s.startTick}–${s.endTick} | Expected: ${s.expect}`)

        if (s.statusBefore && s.statusAfter) {
            const bv = s.statusBefore.mood?.toFixed(3) ?? '?'
            const ba = s.statusBefore.energy?.toFixed(3) ?? '?'
            const av = s.statusAfter.mood?.toFixed(3) ?? '?'
            const aa = s.statusAfter.energy?.toFixed(3) ?? '?'
            const bh = s.statusBefore.heartbeatMs ?? '?'
            const ah = s.statusAfter.heartbeatMs ?? '?'
            lines.push(`Mood: ${bv} → ${av} | Energy: ${ba} → ${aa} | Heartbeat: ${bh}ms → ${ah}ms`)
            lines.push(`State: "${s.statusAfter.description}"`)
        }

        // action breakdown
        const actionCounts = {}
        for (const a of s.actions) {
            actionCounts[a.action] = (actionCounts[a.action] || 0) + 1
        }
        lines.push(`Actions: ${Object.entries(actionCounts).map(([k, v]) => `${k}(${v})`).join(', ') || 'none'}`)

        // check for spatial actions in synth mode
        if (s.name.includes('Synth')) {
            const spatialLeaks = s.actions.filter(a => ['move_to', 'speak', 'interact'].includes(a.action))
            if (spatialLeaks.length > 0) {
                lines.push(`⚠ SPATIAL LEAK: ${spatialLeaks.length} spatial action(s) in synth mode`)
            } else {
                lines.push(`✓ No spatial action leaks`)
            }
        }

        // check for synth actions in spatial mode
        if (s.name.includes('Return to spatial')) {
            const synthLeaks = s.actions.filter(a => ['set_step', 'change_bpm', 'add_chord', 'remove_chord'].includes(a.action))
            if (synthLeaks.length > 0) {
                lines.push(`⚠ SYNTH LEAK: ${synthLeaks.length} synth action(s) in spatial mode`)
            } else {
                lines.push(`✓ No synth action leaks`)
            }
        }

        // check for speech response
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

    // mood/energy trajectory
    lines.push(`## Internal State Trajectory`)
    lines.push(``)
    lines.push(`| Tick | Scenario | Mood | Energy | Heartbeat | Description |`)
    lines.push(`|------|----------|---------|---------|-----------|-------------|`)
    for (const p of results.statusPolls) {
        if (p) {
            lines.push(`| ${p.tick} | ${p.scenario || '-'} | ${p.mood?.toFixed(3) ?? '?'} | ${p.energy?.toFixed(3) ?? '?'} | ${p.heartbeatMs ?? '?'}ms | ${p.description || ''} |`)
        }
    }
    lines.push(``)

    // action diversity
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

    // speech content analysis
    lines.push(`## Speech Content`)
    lines.push(``)
    const speeches = results.actions.filter(a => a.action === 'speak')
    for (const s of speeches) {
        lines.push(`- [tick ${s.tick}, ${s.scenario}] "${s.params?.message}"`)
    }
    if (speeches.length === 0) lines.push(`(no speech actions recorded)`)
    lines.push(``)

    // failures
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
