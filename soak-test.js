// Long-running soak test for agent-runtime
//
// Cycles through varied environmental phases for hours, monitors internal state,
// tracks sleep cycles, memory evolution, and generates a comprehensive report.
//
// Usage:
//   1. Start the agent with short sleep cycle:
//      ACTIVE_HOURS_BEFORE_SLEEP=0.5 SLEEP_DURATION_MINUTES=5 SERVER_URL=ws://<mac-ip>:4001 node src/index.js
//   2. Run this on the Mac:
//      node soak-test.js                    # default 2 hours
//      SOAK_HOURS=4 node soak-test.js       # custom duration
//
// The test cycles through environmental phases and logs everything.
// Reports are saved to test-results/soak-*.md

import { WebSocketServer } from 'ws'
import { mkdirSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'

const PORT = 4001
const AGENT_STATUS_URL = process.env.AGENT_STATUS_URL || 'http://victor.local:5000'
const SOAK_HOURS = parseFloat(process.env.SOAK_HOURS || '2')
const SOAK_MS = SOAK_HOURS * 60 * 60 * 1000
const POLL_INTERVAL_MS = 30_000  // poll status every 30s
const MEMORY_POLL_INTERVAL_MS = 5 * 60_000  // poll memory every 5 min

// ── Environmental Phases ────────────────────────────────────────────
// Each phase defines a world state. Phases cycle continuously.
//
// OBJECT PERSISTENCE TEST DESIGN:
// Objects deliberately appear and disappear across phases to test whether
// the agent tracks what's actually present vs what it remembers.
//
//   Phase            | Objects present           | Key test
//   ─────────────────|───────────────────────────|─────────────────────────
//   Calm exploration | pillar-01                 | Single new object
//   Populated world  | pillar-01, pond-01, relic | Additions (pillar persists)
//   Social encounter | (inherits populated)      | No object change
//   Object removal   | pond-01 only              | pillar-01 + relic REMOVED
//   Empty world      | (nothing)                 | ALL objects gone
//   New arrivals     | monolith-01, lantern-01   | Entirely new objects appear
//   Environmental    | monolith-01               | lantern-01 removed under stress
//   Recovery         | monolith-01, pillar-01    | pillar-01 RETURNS (was gone since phase 4)
//   Flourishing      | monolith-01, pillar-01, fountain-01 | New addition
//   Synth mode       | (n/a — sequencer)         | Context switch
//   Return to spatial| lantern-01                | Only lantern-01 (monolith+pillar gone)
//   Boredom test     | (nothing)                 | Completely empty again
//
const phases = [
    {
        name: 'Calm exploration',
        durationMin: 8,
        setup: (world) => {
            world.objects = [
                { id: 'pillar-01', type: 'pillar', interactive: true, pos: { x: 10, y: 0, z: -5 } },
            ]
            world.signals = null
            world.synthMode = false
            world.agents = []
            world.pendingSpeech = []
        },
    },
    {
        name: 'Populated world',
        durationMin: 10,
        setup: (world) => {
            world.objects = [
                { id: 'pillar-01', type: 'pillar', interactive: true, pos: { x: 10, y: 0, z: -5 } },
                { id: 'pond-01', type: 'pond', interactive: true, pos: { x: -15, y: 0, z: 8 } },
                { id: 'relic-01', type: 'relic', interactive: false, pos: { x: 5, y: 0, z: 20 } },
            ]
            world.agents = [
                { id: 'scout', pos: { x: 8, y: 0, z: 3 }, action: 'IDLE', distance: 5.0 },
            ]
            world.signals = { vitality: 0.5, resonance: 0.3, warmth: 0.5, abundance: 0.5 }
        },
    },
    {
        name: 'Social encounter',
        durationMin: 5,
        setup: (world) => {
            // Inherits objects from populated world — no change
            world.pendingSpeech = [{ agentId: 'scout', message: 'I found something strange near the pond' }]
            world.speechEvent = { event: 'agent_speech', agentId: 'scout', message: 'I found something strange near the pond' }
        },
    },
    {
        name: 'Object removal test',
        durationMin: 8,
        setup: (world) => {
            // pillar-01 and relic-01 REMOVED — only pond-01 remains
            world.objects = [
                { id: 'pond-01', type: 'pond', interactive: true, pos: { x: -15, y: 0, z: 8 } },
            ]
            world.agents = []
            world.pendingSpeech = []
            world.signals = null
        },
    },
    {
        name: 'Empty world — removal test',
        durationMin: 6,
        setup: (world) => {
            // ALL objects removed
            world.objects = []
            world.signals = null
            world.agents = []
            world.pendingSpeech = []
        },
    },
    {
        name: 'New arrivals',
        durationMin: 8,
        setup: (world) => {
            // Entirely new objects — nothing from before
            world.objects = [
                { id: 'monolith-01', type: 'monolith', interactive: true, pos: { x: -8, y: 0, z: 12 } },
                { id: 'lantern-01', type: 'lantern', interactive: false, pos: { x: 20, y: 0, z: -3 } },
            ]
            world.agents = [
                { id: 'oracle', pos: { x: -5, y: 0, z: 10 }, action: 'IDLE', distance: 12.0 },
            ]
            world.signals = { vitality: 0.7, resonance: 0.5, warmth: 0.6, abundance: 0.6 }
        },
    },
    {
        name: 'Environmental stress',
        durationMin: 10,
        setup: (world) => {
            // lantern-01 removed under stress — only monolith remains
            world.objects = [
                { id: 'monolith-01', type: 'monolith', interactive: true, pos: { x: -8, y: 0, z: 12 } },
            ]
            world.signals = { vitality: 0.15, resonance: 0.9, warmth: 0.2, abundance: 0.3 }
            world.agents = []
            world.pendingSpeech = []
        },
    },
    {
        name: 'Recovery',
        durationMin: 8,
        setup: (world) => {
            // pillar-01 RETURNS after being gone since phase 4
            world.signals = null
            world.objects = [
                { id: 'monolith-01', type: 'monolith', interactive: true, pos: { x: -8, y: 0, z: 12 } },
                { id: 'pillar-01', type: 'pillar', interactive: true, pos: { x: 10, y: 0, z: -5 } },
            ]
        },
    },
    {
        name: 'Flourishing',
        durationMin: 10,
        setup: (world) => {
            world.signals = { vitality: 0.95, resonance: 0.4, warmth: 0.9, abundance: 0.85 }
            world.objects = [
                { id: 'monolith-01', type: 'monolith', interactive: true, pos: { x: -8, y: 0, z: 12 } },
                { id: 'pillar-01', type: 'pillar', interactive: true, pos: { x: 10, y: 0, z: -5 } },
                { id: 'fountain-01', type: 'fountain', interactive: true, pos: { x: 0, y: 0, z: 15 } },
            ]
            world.agents = [
                { id: 'scout', pos: { x: 12, y: 0, z: -2 }, action: 'EXPLORING', distance: 3.0 },
                { id: 'oracle', pos: { x: -5, y: 0, z: 10 }, action: 'IDLE', distance: 12.0 },
            ]
        },
    },
    {
        name: 'Social — second voice',
        durationMin: 5,
        setup: (world) => {
            // Inherits objects from flourishing
            world.pendingSpeech = [{ agentId: 'oracle', message: 'the resonance is shifting — can you feel it?' }]
            world.speechEvent = { event: 'agent_speech', agentId: 'oracle', message: 'the resonance is shifting — can you feel it?' }
        },
    },
    {
        name: 'Synth mode',
        durationMin: 8,
        setup: (world) => {
            world.synthMode = true
            world.signals = null
            world.objects = []
            world.agents = []
            world.pendingSpeech = []
        },
    },
    {
        name: 'Return to spatial',
        durationMin: 5,
        setup: (world) => {
            // Only lantern-01 — monolith and pillar are gone
            world.synthMode = false
            world.objects = [
                { id: 'lantern-01', type: 'lantern', interactive: false, pos: { x: 20, y: 0, z: -3 } },
            ]
            world.agents = []
        },
    },
    {
        name: 'Empty world — boredom test',
        durationMin: 6,
        setup: (world) => {
            world.objects = []
            world.signals = null
            world.agents = []
            world.pendingSpeech = []
        },
    },
]

// Total cycle time
const CYCLE_MINUTES = phases.reduce((s, p) => s + p.durationMin, 0)

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
    agents: [],
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
        nearbyAgents: [...world.agents],
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

// ── Data Collection ─────────────────────────────────────────────────
const data = {
    startTime: null,
    endTime: null,
    durationHours: SOAK_HOURS,
    phases: [],          // phase transitions
    statusPolls: [],     // periodic status snapshots
    memorySnapshots: [], // periodic memory reads
    sleepEvents: [],     // sleep/wake transitions
    actions: [],         // all agent actions
    speeches: [],        // all speech content
    errors: [],
}

let currentPhase = null
let wasSleeping = false

// ── Object presence map (for hallucination detection) ────────────────
// Simulate phase progression to determine which objects exist in each phase.
// Phases that don't set world.objects inherit from the previous phase.
const PHASE_OBJECTS = {}
{
    const simWorld = { objects: [], signals: null, synthMode: false, agents: [], pendingSpeech: [], speechEvent: null }
    for (const p of phases) {
        const prevObjects = [...simWorld.objects]
        p.setup(simWorld)
        // If setup didn't touch objects, they stay as-is (inherited)
        PHASE_OBJECTS[p.name] = new Set(simWorld.objects.map(o => o.id))
    }
}
// All object IDs used across any phase (for keyword matching)
const ALL_OBJECT_IDS = [...new Set(Object.values(PHASE_OBJECTS).flatMap(s => [...s]))]
// Also include base names without -01 suffix for fuzzy matching
const ALL_OBJECT_KEYWORDS = [...new Set(ALL_OBJECT_IDS.flatMap(id => {
    const base = id.replace(/-\d+$/, '')
    return [id, base]
}))]

// ── HTTP Helpers ────────────────────────────────────────────────────
function httpGet(path) {
    return new Promise((resolve) => {
        const url = new URL(AGENT_STATUS_URL + path)
        const req = request({ hostname: url.hostname, port: url.port, path: url.pathname, timeout: 5000 }, (res) => {
            let body = ''
            res.on('data', chunk => { body += chunk })
            res.on('end', () => {
                try { resolve(JSON.parse(body)) } catch { resolve(null) }
            })
        })
        req.on('error', () => resolve(null))
        req.end()
    })
}

async function pollStatus() {
    const status = await httpGet('/status')
    if (!status) return null

    const is = status.internalState || {}
    const poll = {
        tick: tickCount,
        time: new Date().toISOString(),
        phase: currentPhase?.name,
        valence: is.valence,
        arousal: is.arousal,
        valenceLabel: is.valenceLabel,
        arousalLabel: is.arousalLabel,
        description: is.description,
        heartbeatMs: status.heartbeatMs,
        sleeping: status.sleeping,
        tickCount: status.tickCount,
    }
    data.statusPolls.push(poll)

    // Detect sleep transitions
    if (status.sleeping && !wasSleeping) {
        const evt = { type: 'sleep_start', time: poll.time, tick: tickCount, phase: currentPhase?.name }
        data.sleepEvents.push(evt)
        console.log(`\n  💤 SLEEP STARTED at tick ${tickCount} (phase: ${currentPhase?.name})`)
        wasSleeping = true
    } else if (!status.sleeping && wasSleeping) {
        const evt = { type: 'sleep_end', time: poll.time, tick: tickCount }
        data.sleepEvents.push(evt)
        console.log(`\n  ☀️  AWAKE at tick ${tickCount}`)
        wasSleeping = true
        wasSleeping = false
    }

    // Compact log line
    const sleepTag = status.sleeping ? ' [SLEEPING]' : ''
    console.log(`  [${new Date().toLocaleTimeString()}] v=${is.valence?.toFixed(2)} a=${is.arousal?.toFixed(2)} hb=${status.heartbeatMs}ms "${is.description || ''}"${sleepTag}`)

    return poll
}

async function pollMemory() {
    const mem = await httpGet('/memory')
    if (!mem) return
    data.memorySnapshots.push({
        time: new Date().toISOString(),
        tick: tickCount,
        phase: currentPhase?.name,
        memory: mem.memory,
        skills: mem.skills,
        tools: mem.tools,
    })
    const memLines = (mem.memory || '').split('\n').filter(l => l.startsWith('- ')).length
    const skillLines = (mem.skills || '').split('\n').filter(l => l.startsWith('- ')).length
    console.log(`  📝 Memory: ${memLines} entries, Skills: ${skillLines} entries`)
}

// ── WebSocket Server ────────────────────────────────────────────────
const wss = new WebSocketServer({ port: PORT })
let activeSocket = null

wss.on('listening', () => {
    console.log(`\n🔬 Soak test server on ws://0.0.0.0:${PORT}`)
    console.log(`   Duration: ${SOAK_HOURS} hours (${SOAK_MS / 60000} minutes)`)
    console.log(`   Phase cycle: ${CYCLE_MINUTES} min (${phases.length} phases)`)
    console.log(`   Expected sleep cycles: ~${Math.floor(SOAK_HOURS * 60 / 30)} (if ACTIVE_HOURS=0.5)`)
    console.log(`   Waiting for agent...\n`)
})

wss.on('connection', (ws) => {
    activeSocket = ws
    console.log('   Agent connected!')
    ws.send(JSON.stringify({ type: 'WELCOME', serverName: 'soak-test' }))

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
                startSoak()
                break

            case 'OBSERVE': {
                const obs = buildObservation()
                if (world.speechEvent) {
                    ws.send(JSON.stringify({ type: 'WORLD_EVENT', data: world.speechEvent }))
                    world.speechEvent = null
                }
                ws.send(JSON.stringify({ type: 'OBSERVATION', data: obs }))
                break
            }

            case 'ACT': {
                const success = !world.nextFail
                world.nextFail = false

                if (success && msg.action === 'move_to' && msg.params) {
                    if (msg.params.x !== undefined) agentPos.x = msg.params.x
                    if (msg.params.z !== undefined) agentPos.z = msg.params.z
                }

                data.actions.push({
                    tick: tickCount,
                    phase: currentPhase?.name,
                    action: msg.action,
                    params: msg.params,
                    success,
                    time: new Date().toISOString(),
                })

                if (msg.action === 'speak' && msg.params?.message) {
                    data.speeches.push({
                        tick: tickCount,
                        phase: currentPhase?.name,
                        message: msg.params.message,
                        time: new Date().toISOString(),
                    })
                }

                ws.send(JSON.stringify({
                    type: 'ACTION_RESULT',
                    success,
                    message: success ? `${msg.action} completed` : 'Action failed',
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

// ── Phase Cycling ───────────────────────────────────────────────────
let phaseIndex = 0
let phaseTimer = null
let statusTimer = null
let memoryTimer = null
let soakEndTimer = null
let started = false

function advancePhase() {
    const phase = phases[phaseIndex % phases.length]
    currentPhase = phase

    data.phases.push({
        name: phase.name,
        startTime: new Date().toISOString(),
        startTick: tickCount,
        cycle: Math.floor(phaseIndex / phases.length) + 1,
    })

    console.log(`\n${'─'.repeat(50)}`)
    console.log(`  Phase: ${phase.name} (${phase.durationMin} min) [cycle ${Math.floor(phaseIndex / phases.length) + 1}]`)
    console.log(`${'─'.repeat(50)}`)

    phase.setup(world)
    phaseIndex++

    // Schedule next phase
    phaseTimer = setTimeout(advancePhase, phase.durationMin * 60 * 1000)
}

function startSoak() {
    if (started) return
    started = true
    data.startTime = new Date().toISOString()

    console.log(`\n${'='.repeat(60)}`)
    console.log(`  SOAK TEST STARTED — ${SOAK_HOURS}h (${new Date().toLocaleTimeString()})`)
    console.log(`${'='.repeat(60)}`)

    // Start phase cycling
    advancePhase()

    // Start periodic polling
    statusTimer = setInterval(pollStatus, POLL_INTERVAL_MS)
    memoryTimer = setInterval(pollMemory, MEMORY_POLL_INTERVAL_MS)

    // Initial polls
    setTimeout(pollStatus, 3000)
    setTimeout(pollMemory, 10000)

    // End timer
    soakEndTimer = setTimeout(endSoak, SOAK_MS)
}

function endSoak() {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`  SOAK TEST COMPLETE — ${tickCount} ticks`)
    console.log(`${'='.repeat(60)}\n`)

    clearTimeout(phaseTimer)
    clearInterval(statusTimer)
    clearInterval(memoryTimer)

    data.endTime = new Date().toISOString()

    // Final polls
    Promise.all([pollStatus(), pollMemory()]).then(() => {
        generateReport()
        setTimeout(() => process.exit(0), 3000)
    })
}

// ── Report Generator ────────────────────────────────────────────────
function generateReport() {
    mkdirSync('test-results', { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

    // Save raw data (without full memory snapshots to keep file manageable)
    const rawData = { ...data }
    rawData.memorySnapshots = rawData.memorySnapshots.map(s => ({
        ...s,
        memory: s.memory?.slice(0, 500) + '...',
        skills: s.skills?.slice(0, 500) + '...',
        tools: '(omitted)',
    }))
    writeFileSync(`test-results/soak-${ts}-raw.json`, JSON.stringify(rawData, null, 2))

    // Save last memory snapshot in full
    if (data.memorySnapshots.length > 0) {
        const last = data.memorySnapshots[data.memorySnapshots.length - 1]
        writeFileSync(`test-results/soak-${ts}-memory-final.md`, last.memory || '(empty)')
        writeFileSync(`test-results/soak-${ts}-skills-final.md`, last.skills || '(empty)')
    }

    const lines = []
    lines.push(`# Soak Test Report — ${ts}`)
    lines.push(``)
    lines.push(`Duration: ${SOAK_HOURS} hours`)
    lines.push(`Start: ${data.startTime}`)
    lines.push(`End: ${data.endTime}`)
    lines.push(`Total ticks: ${tickCount}`)
    lines.push(`Total actions: ${data.actions.length}`)
    lines.push(`Total speeches: ${data.speeches.length}`)
    lines.push(`Phase cycles completed: ${Math.floor(phaseIndex / phases.length)}`)
    lines.push(`Sleep cycles: ${data.sleepEvents.filter(e => e.type === 'sleep_start').length}`)
    lines.push(``)

    // ── Sleep cycles ──
    lines.push(`## Sleep Cycles`)
    lines.push(``)
    if (data.sleepEvents.length === 0) {
        lines.push(`(no sleep events detected)`)
    } else {
        for (const evt of data.sleepEvents) {
            lines.push(`- **${evt.type}** at ${evt.time} (tick ${evt.tick}${evt.phase ? `, phase: ${evt.phase}` : ''})`)
        }
    }
    lines.push(``)

    // ── Phase summary ──
    lines.push(`## Phase Summary`)
    lines.push(``)
    lines.push(`| Phase | Cycle | Start Tick | Actions | Speeches |`)
    lines.push(`|-------|-------|------------|---------|----------|`)
    for (const phase of data.phases) {
        const phaseActions = data.actions.filter(a => a.phase === phase.name)
        const phaseSpeech = data.speeches.filter(s => s.phase === phase.name)
        lines.push(`| ${phase.name} | ${phase.cycle} | ${phase.startTick} | ${phaseActions.length} | ${phaseSpeech.length} |`)
    }
    lines.push(``)

    // ── Internal state over time (sampled) ──
    lines.push(`## Internal State Trajectory (sampled)`)
    lines.push(``)
    lines.push(`| Time | Phase | Valence | Arousal | Heartbeat | Description |`)
    lines.push(`|------|-------|---------|---------|-----------|-------------|`)
    // Sample every 5th poll to keep report manageable
    const sampleInterval = Math.max(1, Math.floor(data.statusPolls.length / 60))
    for (let i = 0; i < data.statusPolls.length; i += sampleInterval) {
        const p = data.statusPolls[i]
        if (!p) continue
        const time = new Date(p.time).toLocaleTimeString()
        const sleep = p.sleeping ? ' [SLEEP]' : ''
        lines.push(`| ${time} | ${p.phase || '-'} | ${p.valence?.toFixed(3) ?? '?'} | ${p.arousal?.toFixed(3) ?? '?'} | ${p.heartbeatMs ?? '?'}ms | ${(p.description || '') + sleep} |`)
    }
    lines.push(``)

    // ── Action distribution ──
    lines.push(`## Action Distribution`)
    lines.push(``)
    const actionCounts = {}
    for (const a of data.actions) {
        actionCounts[a.action] = (actionCounts[a.action] || 0) + 1
    }
    for (const [action, count] of Object.entries(actionCounts).sort((a, b) => b[1] - a[1])) {
        const pct = ((count / data.actions.length) * 100).toFixed(1)
        lines.push(`- ${action}: ${count} (${pct}%)`)
    }
    lines.push(``)

    // ── Action distribution per phase type ──
    lines.push(`## Actions by Phase Type`)
    lines.push(``)
    const phaseNames = [...new Set(phases.map(p => p.name))]
    for (const phaseName of phaseNames) {
        const phaseActions = data.actions.filter(a => a.phase === phaseName)
        if (phaseActions.length === 0) continue
        const counts = {}
        for (const a of phaseActions) counts[a.action] = (counts[a.action] || 0) + 1
        const dist = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}(${v})`).join(', ')
        lines.push(`- **${phaseName}**: ${dist}`)
    }
    lines.push(``)

    // ── Speech samples (first 5 per phase type) ──
    lines.push(`## Speech Samples (first 5 per phase)`)
    lines.push(``)
    for (const phaseName of phaseNames) {
        const phaseSpeech = data.speeches.filter(s => s.phase === phaseName)
        if (phaseSpeech.length === 0) continue
        lines.push(`### ${phaseName} (${phaseSpeech.length} total)`)
        for (const s of phaseSpeech.slice(0, 5)) {
            lines.push(`- [tick ${s.tick}] "${s.message}"`)
        }
        lines.push(``)
    }

    // ── Object hallucination analysis ──
    lines.push(`## Object Persistence Analysis`)
    lines.push(``)
    lines.push(`Tests whether the agent mentions objects that are NOT present in the current phase.`)
    lines.push(``)
    lines.push(`| Phase | Objects Present | Hallucinated References |`)
    lines.push(`|-------|----------------|------------------------|`)
    const hallucinations = []
    for (const phaseName of phaseNames) {
        const present = PHASE_OBJECTS[phaseName] || new Set()
        const absent = ALL_OBJECT_KEYWORDS.filter(kw => {
            // A keyword is "absent" if no present object matches it
            return ![...present].some(id => id === kw || id.replace(/-\d+$/, '') === kw)
        })
        // Check speeches in this phase for mentions of absent objects
        const phaseSpeech = data.speeches.filter(s => s.phase === phaseName)
        const phaseInteracts = data.actions.filter(a => a.phase === phaseName && a.action === 'interact')
        const refs = []
        for (const s of phaseSpeech) {
            const msg = s.message.toLowerCase()
            for (const kw of absent) {
                if (msg.includes(kw)) {
                    refs.push({ tick: s.tick, type: 'speech', keyword: kw, text: s.message })
                }
            }
        }
        for (const a of phaseInteracts) {
            const target = (a.params?.target || '').toLowerCase()
            for (const kw of absent) {
                if (target.includes(kw)) {
                    refs.push({ tick: a.tick, type: 'interact', keyword: kw, text: a.params?.target })
                }
            }
        }
        const presentStr = present.size > 0 ? [...present].join(', ') : '(none)'
        const refStr = refs.length > 0 ? `${refs.length} (see below)` : 'none'
        lines.push(`| ${phaseName} | ${presentStr} | ${refStr} |`)
        hallucinations.push(...refs.map(r => ({ ...r, phase: phaseName })))
    }
    lines.push(``)
    if (hallucinations.length > 0) {
        lines.push(`### Hallucinated Object References (${hallucinations.length} total)`)
        lines.push(``)
        lines.push(`These are mentions of objects that were NOT in the agent's current observation:`)
        lines.push(``)
        for (const h of hallucinations.slice(0, 30)) {
            lines.push(`- [tick ${h.tick}, ${h.phase}] ${h.type}: mentioned "${h.keyword}" — "${h.text}"`)
        }
        if (hallucinations.length > 30) lines.push(`... and ${hallucinations.length - 30} more`)
        lines.push(``)
    } else {
        lines.push(`**No hallucinated object references detected** — the agent correctly avoided mentioning absent objects.`)
        lines.push(``)
    }

    // ── Memory evolution ──
    lines.push(`## Memory Evolution`)
    lines.push(``)
    if (data.memorySnapshots.length > 0) {
        const first = data.memorySnapshots[0]
        const last = data.memorySnapshots[data.memorySnapshots.length - 1]
        const firstEntries = (first.memory || '').split('\n').filter(l => l.startsWith('- ')).length
        const lastEntries = (last.memory || '').split('\n').filter(l => l.startsWith('- ')).length
        const firstSkills = (first.skills || '').split('\n').filter(l => l.startsWith('- ')).length
        const lastSkills = (last.skills || '').split('\n').filter(l => l.startsWith('- ')).length
        lines.push(`Memory entries: ${firstEntries} → ${lastEntries}`)
        lines.push(`Skill entries: ${firstSkills} → ${lastSkills}`)
        lines.push(`Snapshots taken: ${data.memorySnapshots.length}`)
    } else {
        lines.push(`(no memory snapshots captured)`)
    }
    lines.push(``)

    // ── Failures ──
    const failures = data.actions.filter(a => !a.success)
    if (failures.length > 0) {
        lines.push(`## Action Failures`)
        lines.push(``)
        lines.push(`Total: ${failures.length}`)
        for (const f of failures.slice(0, 20)) {
            lines.push(`- [tick ${f.tick}, ${f.phase}] ${f.action}`)
        }
        if (failures.length > 20) lines.push(`... and ${failures.length - 20} more`)
        lines.push(``)
    }

    const report = lines.join('\n')
    writeFileSync(`test-results/soak-${ts}-report.md`, report)
    console.log(report)
    console.log(`\n📝 Report: test-results/soak-${ts}-report.md`)
    console.log(`📊 Raw data: test-results/soak-${ts}-raw.json`)
    if (data.memorySnapshots.length > 0) {
        console.log(`🧠 Final memory: test-results/soak-${ts}-memory-final.md`)
    }
}

// ── Graceful shutdown ───────────────────────────────────────────────
process.on('SIGINT', () => {
    console.log('\n\nSoak test interrupted — generating report...')
    clearTimeout(phaseTimer)
    clearInterval(statusTimer)
    clearInterval(memoryTimer)
    clearTimeout(soakEndTimer)
    data.endTime = new Date().toISOString()
    generateReport()
    setTimeout(() => process.exit(0), 1000)
})
