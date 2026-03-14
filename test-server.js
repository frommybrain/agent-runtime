// Minimal test environment server for validating agent-runtime v0.2
//
// Speaks the agent WebSocket protocol (WELCOME/IDENTIFY/OBSERVE/ACT/WORLD_EVENT)
// Lets you inject changes via keyboard to test each cognitive capability.
//
// All messages (both directions) are logged to test-logs/YYYY-MM-DD_HH-MM-SS.jsonl
//
// Usage: node test-server.js
// Then start the agent pointing at this server: SERVER_URL=ws://<mac-ip>:4001
//
// Keyboard controls (press key + Enter):
//   o  — add a new interactive object ("terminal-01")
//   r  — remove the object
//   s  — send a speech event from a stranger
//   c  — toggle cosmology signals (resonance/vitality)
//   f  — next action will fail
//   x  — send a non-spatial observation (synth/sequencer)
//   q  — quit

import { WebSocketServer } from 'ws'
import { mkdirSync, createWriteStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { request } from 'node:http'

const PORT = 4001

// ── Logging ──────────────────────────────────────────────────────────
mkdirSync('test-logs', { recursive: true })
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const logFile = `test-logs/${timestamp}.jsonl`
const logStream = createWriteStream(logFile, { flags: 'a' })

function log(direction, type, data) {
    const entry = {
        time: new Date().toISOString(),
        dir: direction,  // 'in' (from agent) or 'out' (to agent) or 'sys' (internal)
        type,
        data,
    }
    logStream.write(JSON.stringify(entry) + '\n')
    const prefix = direction === 'in' ? '← AGENT' : direction === 'out' ? '→ AGENT' : '  SYS  '
    const summary = typeof data === 'string' ? data : JSON.stringify(data).slice(0, 120)
    console.log(`[${entry.time.split('T')[1].split('.')[0]}] ${prefix} ${type}: ${summary}`)
}

// ── World State (mutable via keyboard) ───────────────────────────────
let tickCount = 0
let agentId = null
let agentPos = { x: 0, y: 0, z: 0 }
let nextActionFails = false
let useSynthMode = false

const worldState = {
    objects: [],
    signals: null,    // null = no cosmology, object = cosmology active
    agents: [],       // other agents nearby
    pendingSpeech: [], // speech events queued for next observation
}

function buildObservation() {
    tickCount++

    if (useSynthMode) {
        return buildSynthObservation()
    }

    const obs = {
        self: {
            id: agentId,
            pos: { ...agentPos },
            action: 'IDLE',
        },
        nearbyAgents: worldState.agents,
        nearbyObjects: worldState.objects,
        available_actions: [
            { name: 'move_to', params: 'x, z', description: 'Move to a position' },
            { name: 'speak', params: 'message', description: 'Say something' },
            { name: 'wait', description: 'Do nothing this tick' },
        ],
        recentSpeech: worldState.pendingSpeech.splice(0),  // drain pending speech into observation
    }

    // Add interact action if there are interactive objects
    if (worldState.objects.some(o => o.interactive)) {
        obs.available_actions.push(
            { name: 'interact', params: 'target', description: 'Interact with a nearby object' }
        )
    }

    // Add cosmology signals if active
    if (worldState.signals) {
        obs.signals = { ...worldState.signals }
    }

    return obs
}

function buildSynthObservation() {
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

// ── WebSocket Server ─────────────────────────────────────────────────
const wss = new WebSocketServer({ port: PORT })
let activeSocket = null

wss.on('listening', () => {
    console.log(`\n🧪 Test environment server running on ws://0.0.0.0:${PORT}`)
    console.log(`📝 Logging to ${logFile}`)
    console.log(`\nKeyboard controls:`)
    console.log(`  o  — add interactive object`)
    console.log(`  r  — remove object`)
    console.log(`  s  — send speech from stranger`)
    console.log(`  c  — toggle cosmology signals`)
    console.log(`  f  — next action will fail`)
    console.log(`  x  — toggle synth/spatial mode`)
    console.log(`  q  — quit\n`)
    log('sys', 'SERVER_STARTED', { port: PORT })
})

wss.on('connection', (ws) => {
    activeSocket = ws
    log('sys', 'AGENT_CONNECTED', {})

    // Send WELCOME
    send(ws, { type: 'WELCOME', serverName: 'test-environment' })

    ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString())
        log('in', msg.type, msg)

        switch (msg.type) {
            case 'IDENTIFY':
                agentId = msg.agentId
                send(ws, {
                    type: 'IDENTIFIED',
                    agentId: msg.agentId,
                    worldBounds: { halfSize: 100 },
                })
                log('sys', 'AGENT_IDENTIFIED', { agentId: msg.agentId })
                break

            case 'OBSERVE':
                const obs = buildObservation()
                send(ws, { type: 'OBSERVATION', data: obs })
                log('sys', 'TICK', { tick: tickCount, objects: worldState.objects.length, signals: !!worldState.signals, mode: useSynthMode ? 'synth' : 'spatial' })
                // Poll agent /status every 5 ticks to log internal state
                if (tickCount % 5 === 0) pollAgentStatus()
                break

            case 'ACT':
                const success = !nextActionFails
                const result = {
                    type: 'ACTION_RESULT',
                    success,
                    message: success
                        ? `${msg.action} completed`
                        : 'Action failed: too far away',
                }
                nextActionFails = false

                // Update agent position if they moved
                if (success && msg.action === 'move_to' && msg.params) {
                    if (msg.params.x !== undefined) agentPos.x = msg.params.x
                    if (msg.params.z !== undefined) agentPos.z = msg.params.z
                }

                send(ws, result)
                log('sys', 'ACTION_PROCESSED', {
                    action: msg.action,
                    params: msg.params,
                    success,
                })
                break
        }
    })

    ws.on('close', () => {
        activeSocket = null
        log('sys', 'AGENT_DISCONNECTED', {})
    })
})

function send(ws, msg) {
    ws.send(JSON.stringify(msg))
    log('out', msg.type, msg)
}

function sendWorldEvent(event) {
    if (!activeSocket) {
        console.log('  (no agent connected)')
        return
    }
    const msg = { type: 'WORLD_EVENT', data: event }
    activeSocket.send(JSON.stringify(msg))
    log('out', 'WORLD_EVENT', event)
}

// ── Status Polling ───────────────────────────────────────────────────
const AGENT_STATUS_URL = process.env.AGENT_STATUS_URL || 'http://victor.local:5000/status'

function pollAgentStatus() {
    const url = new URL(AGENT_STATUS_URL)
    const req = request({ hostname: url.hostname, port: url.port, path: url.pathname, timeout: 3000 }, (res) => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
            try {
                const status = JSON.parse(data)
                const is = status.internalState || {}
                console.log(`  📊 v=${is.valence?.toFixed(2)} a=${is.arousal?.toFixed(2)} [${is.valenceLabel}/${is.arousalLabel}] hb=${status.heartbeatMs}ms`)
                log('sys', 'AGENT_STATUS', {
                    tick: tickCount,
                    valence: is.valence,
                    arousal: is.arousal,
                    valenceLabel: is.valenceLabel,
                    arousalLabel: is.arousalLabel,
                    heartbeatMs: status.heartbeatMs,
                    tickCount: status.tickCount,
                })
            } catch {}
        })
    })
    req.on('error', () => {})  // silently ignore if agent unreachable
    req.end()
}

// ── Keyboard Controls ────────────────────────────────────────────────
const rl = createInterface({ input: process.stdin, output: process.stdout })

rl.on('line', (input) => {
    const cmd = input.trim().toLowerCase()

    switch (cmd) {
        case 'o':
            if (!worldState.objects.find(o => o.id === 'terminal-01')) {
                worldState.objects.push({
                    id: 'terminal-01',
                    type: 'terminal',
                    interactive: true,
                    pos: { x: 10, y: 0, z: -5 },
                })
                console.log('  ✓ Added terminal-01 (interactive)')
                log('sys', 'WORLD_CHANGE', { action: 'add_object', id: 'terminal-01' })
            } else {
                // Add a second object
                const id = `shiny-${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`
                worldState.objects.push({
                    id,
                    type: 'artifact',
                    interactive: true,
                    pos: { x: Math.round(Math.random() * 40 - 20), y: 0, z: Math.round(Math.random() * 40 - 20) },
                })
                console.log(`  ✓ Added ${id} (artifact)`)
                log('sys', 'WORLD_CHANGE', { action: 'add_object', id })
            }
            break

        case 'r':
            if (worldState.objects.length > 0) {
                const removed = worldState.objects.pop()
                console.log(`  ✓ Removed ${removed.id}`)
                log('sys', 'WORLD_CHANGE', { action: 'remove_object', id: removed.id })
            } else {
                console.log('  (no objects to remove)')
            }
            break

        case 's': {
            const speechMsg = ['hello there', 'what are you doing?', 'have you seen the artifact?', 'something feels different today'][Math.floor(Math.random() * 4)]
            // Queue into observation so agent can see it
            worldState.pendingSpeech.push({ agentId: 'stranger', message: speechMsg })
            // Also send as world event for the arousal/social nudge
            sendWorldEvent({
                event: 'agent_speech',
                agentId: 'stranger',
                message: speechMsg,
            })
            console.log(`  ✓ Speech: "${speechMsg}"`)
            break
        }

        case 'c':
            if (worldState.signals) {
                worldState.signals = null
                console.log('  ✓ Cosmology signals OFF')
            } else {
                worldState.signals = {
                    vitality: 0.3,
                    resonance: 0.8,
                    abundance: 0.6,
                    warmth: 0.4,
                }
                console.log('  ✓ Cosmology signals ON (resonance: 0.8, vitality: 0.3)')
            }
            log('sys', 'WORLD_CHANGE', { action: 'toggle_signals', signals: worldState.signals })
            break

        case 'f':
            nextActionFails = true
            console.log('  ✓ Next action will FAIL')
            log('sys', 'WORLD_CHANGE', { action: 'set_next_fail' })
            break

        case 'x':
            useSynthMode = !useSynthMode
            console.log(`  ✓ Mode: ${useSynthMode ? 'SYNTH (non-spatial)' : 'SPATIAL (3D world)'}`)
            log('sys', 'WORLD_CHANGE', { action: 'toggle_mode', mode: useSynthMode ? 'synth' : 'spatial' })
            break

        case 'q':
            console.log('  Shutting down...')
            log('sys', 'SERVER_STOPPED', {})
            logStream.end()
            process.exit(0)
            break

        default:
            console.log('  Unknown command. Use: o r s c f x q')
    }
})

process.on('SIGINT', () => {
    log('sys', 'SERVER_STOPPED', { reason: 'SIGINT' })
    logStream.end()
    process.exit(0)
})
