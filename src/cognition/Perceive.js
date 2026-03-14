// Converts raw observation JSON into natural language for the LLM.
// Environment-agnostic: handles spatial worlds, data streams, audio, or anything.
//
// The observation format is defined by the environment, not by us.
// This perceiver narrates whatever it finds without assuming (x, z) coordinates,
// 3D worlds, or any specific structure.

export function perceive(observation, worldEvents) {
    const lines = []

    // --- Agent's own state (describe whatever is present) ---
    if (observation.self) {
        const s = observation.self
        // Position — handle any coordinate system or none
        if (s.pos) {
            const coords = Object.entries(s.pos)
                .map(([k, v]) => `${k}:${typeof v === 'number' ? v.toFixed(1) : v}`)
                .join(', ')
            lines.push(`My position: (${coords}).`)
        }
        if (s.action) lines.push(`I am currently ${s.action.toLowerCase()}.`)
        if (s.interacting_with) lines.push(`I am interacting with ${s.interacting_with}.`)
        // Narrate any other self properties we haven't handled
        for (const [key, val] of Object.entries(s)) {
            if (['pos', 'action', 'interacting_with', 'id', 'name'].includes(key)) continue
            if (typeof val === 'object' && val !== null) continue
            lines.push(`My ${key}: ${val}`)
        }
    }

    // --- Nearby agents ---
    const nearbyAgents = observation.nearbyAgents || observation.nearby_agents || []
    if (nearbyAgents.length > 0) {
        const agents = nearbyAgents.map(a => {
            const parts = [a.id || a.name]
            if (a.distance !== undefined) {
                parts.push(`${typeof a.distance === 'number' ? a.distance.toFixed(1) : a.distance} away`)
            }
            if (a.action) parts.push(a.action.toLowerCase())
            return parts.join(', ')
        })
        lines.push(`Nearby agents: ${agents.join('; ')}.`)
    } else {
        lines.push('No other agents nearby.')
    }

    // --- Nearby objects/entities ---
    const nearbyObjects = observation.nearbyObjects || observation.nearby_objects || []
    if (nearbyObjects.length > 0) {
        const objects = nearbyObjects.map(o => {
            const parts = [o.id || o.name || o.type]
            if (o.type && o.id && o.type !== o.id) parts.push(`(${o.type})`)
            if (o.distance !== undefined) {
                parts.push(`${typeof o.distance === 'number' ? o.distance.toFixed(1) : o.distance} away`)
            } else if (o.pos) {
                const coords = Object.entries(o.pos)
                    .map(([k, v]) => `${k}:${typeof v === 'number' ? v.toFixed(1) : v}`)
                    .join(', ')
                parts.push(`at (${coords})`)
            }
            if (o.interactive) parts.push('[interactive]')
            // Include extra properties (state, value, level, etc.)
            for (const [k, v] of Object.entries(o)) {
                if (['id', 'name', 'type', 'pos', 'interactive', 'distance'].includes(k)) continue
                if (typeof v !== 'object') parts.push(`${k}:${v}`)
            }
            return parts.join(' ')
        })
        lines.push(`Nearby: ${objects.join('; ')}.`)
    }

    // --- Environment signals (cosmology, sensor data, field values, etc.) ---
    if (observation.signals) {
        const signalLines = Object.entries(observation.signals)
            .map(([k, v]) => `${k}: ${typeof v === 'number' ? v.toFixed(2) : v}`)
        lines.push(`Environment: ${signalLines.join(', ')}.`)
    }

    // --- Recent speech from observation (server-included) ---
    const recentSpeech = observation.recentSpeech || []
    for (const speech of recentSpeech) {
        const speaker = speech.from || speech.agentId || 'someone'
        const ago = speech.secondsAgo ? ` (${speech.secondsAgo}s ago)` : ''
        lines.push(`${speaker} said: "${speech.message}"`)
    }

    // --- World events (speech, terminal output, custom events) ---
    if (worldEvents?.length > 0) {
        for (const evt of worldEvents) {
            const data = evt.data || evt
            if (data.event === 'agent_speech') {
                lines.push(`${data.agentId} said: "${data.message}"`)
            } else if (data.message || data.text) {
                lines.push(`Event [${data.event || 'unknown'}]: "${data.message || data.text}"`)
            } else {
                // Generic event narration — let the LLM make sense of it
                const { event, ...rest } = data
                const detail = Object.keys(rest).length > 0 ? ` — ${JSON.stringify(rest)}` : ''
                lines.push(`Event: ${event || 'unknown'}${detail}`)
            }
        }
    }

    // --- Available actions ---
    if (observation.available_actions?.length > 0) {
        const actionDescs = observation.available_actions.map(a => {
            if (typeof a === 'string') return a
            return `${a.name}(${a.params || ''}) — ${a.description || ''}`
        })
        lines.push(`Available actions:\n${actionDescs.map(d => `  - ${d}`).join('\n')}`)
    }

    // --- Anything else at the top level we haven't handled ---
    // This is key for environment-agnosticism: if a synth environment sends
    // { currentPatch: "pad", bpm: 120, activeChords: ["Cmaj7", "Dm9"] }
    // the perceiver will narrate it without needing to know what it means.
    const handled = new Set([
        'self', 'nearbyAgents', 'nearby_agents', 'nearbyObjects', 'nearby_objects',
        'available_actions', 'recentSpeech', 'signals', 'worldBounds',
    ])
    for (const [key, val] of Object.entries(observation)) {
        if (handled.has(key)) continue
        if (typeof val === 'object' && val !== null) {
            lines.push(`${key}: ${JSON.stringify(val)}`)
        } else if (val !== undefined) {
            lines.push(`${key}: ${val}`)
        }
    }

    return lines.join('\n')
}
