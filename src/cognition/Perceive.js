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
        // Narrate any other self properties — including nested objects (needs, wellbeing, etc.)
        for (const [key, val] of Object.entries(s)) {
            if (['pos', 'action', 'interacting_with', 'id', 'name'].includes(key)) continue
            const narrated = _narrateValue(key, val)
            if (narrated) lines.push(...narrated)
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
            // Include extra properties (state, value, level, description, etc.)
            for (const [k, v] of Object.entries(o)) {
                if (['id', 'name', 'type', 'pos', 'interactive', 'distance'].includes(k)) continue
                if (typeof v === 'object' && v !== null) {
                    parts.push(`${k}:${JSON.stringify(v)}`)
                } else if (v !== undefined) {
                    parts.push(`${k}:${v}`)
                }
            }
            return parts.join(' ')
        })
        lines.push(`Nearby: ${objects.join('; ')}.`)
    }

    // --- Environment signals → felt descriptions ---
    // Translate raw metrics into experiential language so the agent
    // describes what it feels, not the metric names themselves.
    if (observation.signals) {
        const desc = _describeSignals(observation.signals)
        if (desc) lines.push(`Environment: ${desc}`)
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

// Narrate a self property — handles primitives, nested objects, and arrays.
// Returns an array of narration lines, or null if nothing to narrate.
function _narrateValue(key, val) {
    if (val === undefined || val === null) return null

    // Primitives — simple narration
    if (typeof val !== 'object') return [`My ${key}: ${val}`]

    // Arrays — join with commas
    if (Array.isArray(val)) {
        if (val.length === 0) return null
        return [`My ${key}: ${val.join(', ')}`]
    }

    // Object with level + urgency (needs pattern: {level: 70, urgency: "strong"})
    if (val.level !== undefined && val.urgency !== undefined) {
        return [`My ${key}: ${val.urgency} (${val.level}%)`]
    }

    // Object with status (wellbeing pattern: {status: "suffering", criticalNeeds: [...], ...})
    if (val.status !== undefined) {
        const parts = [val.status]
        if (val.criticalNeeds?.length > 0) parts.push(`critical: ${val.criticalNeeds.join(', ')}`)
        if (val.discomfortNeeds?.length > 0) parts.push(`discomfort: ${val.discomfortNeeds.join(', ')}`)
        return [`My ${key}: ${parts.join(' — ')}`]
    }

    // Generic object — recurse one level for readable narration
    const lines = []
    for (const [k, v] of Object.entries(val)) {
        if (v === undefined || v === null) continue
        if (typeof v === 'object' && !Array.isArray(v)) {
            // Nested object (e.g. needs.hunger = {level, urgency}) — use pattern matching
            const sub = _narrateValue(k, v)
            if (sub) lines.push(...sub)
        } else if (Array.isArray(v)) {
            if (v.length > 0) lines.push(`My ${k}: ${v.join(', ')}`)
        } else {
            lines.push(`My ${k}: ${v}`)
        }
    }
    return lines.length > 0 ? lines : null
}

// Translate raw signal values into natural, felt descriptions.
// The agent should describe experience, not echo metric names.
function _describeSignals(signals) {
    const parts = []

    if (signals.vitality !== undefined) {
        const v = signals.vitality
        if (v >= 0.8) parts.push('This place feels alive — buzzing with energy.')
        else if (v >= 0.6) parts.push('There is a healthy energy here, things feel vibrant.')
        else if (v >= 0.45) parts.push('The energy here feels ordinary — nothing special.')
        else if (v >= 0.3) parts.push('The energy feels low, like this place is fading.')
        else parts.push('This place feels drained, almost lifeless.')
    }

    if (signals.resonance !== undefined) {
        const r = signals.resonance
        if (r >= 0.7) parts.push('There is an intense hum in the air — everything feels deeply connected.')
        else if (r >= 0.4) parts.push('There is a gentle hum, a sense of things being in tune.')
        else if (r >= 0.2) parts.push('The atmosphere is quiet and still.')
        else parts.push('Everything feels disconnected and flat.')
    }

    if (signals.warmth !== undefined) {
        const w = signals.warmth
        if (w >= 0.7) parts.push('A comforting warmth surrounds you.')
        else if (w >= 0.45) parts.push('The air feels neutral — neither warm nor cold.')
        else if (w >= 0.25) parts.push('There is a chill in the air.')
        else parts.push('The cold is biting — unwelcoming.')
    }

    if (signals.abundance !== undefined) {
        const a = signals.abundance
        if (a >= 0.7) parts.push('This place feels rich and full of possibility.')
        else if (a >= 0.45) parts.push('Things seem adequate — enough, but nothing more.')
        else if (a >= 0.25) parts.push('There is a sense of scarcity here.')
        else parts.push('This place feels barren and empty.')
    }

    // --- Real-world / installation signals ---

    if (signals.temperature !== undefined) {
        const t = signals.temperature
        if (t >= 0.8) parts.push('The heat is heavy — the air feels thick and oppressive.')
        else if (t >= 0.6) parts.push('The air is warm and soft against the skin.')
        else if (t >= 0.4) parts.push('The temperature is mild — comfortable and easy.')
        else if (t >= 0.25) parts.push('There is a cool edge to the air.')
        else if (t >= 0.12) parts.push('The cold is sharp — biting at every surface.')
        else parts.push('A deep freeze grips everything — brittle and still.')
    }

    if (signals.humidity !== undefined) {
        const h = signals.humidity
        if (h >= 0.8) parts.push('The air is thick with moisture — everything feels damp and close.')
        else if (h >= 0.6) parts.push('There is a heaviness to the air, moisture clinging to everything.')
        else if (h >= 0.4) parts.push('The air feels balanced — neither dry nor damp.')
        else if (h >= 0.2) parts.push('The air is dry and crisp, clean to breathe.')
        else parts.push('The air is parched — bone-dry, almost desert-like.')
    }

    if (signals.wind_speed !== undefined) {
        const w = signals.wind_speed
        if (w >= 0.7) parts.push('Strong gusts push through the space — everything sways and rustles.')
        else if (w >= 0.4) parts.push('A steady breeze moves through, carrying scents and sounds.')
        else if (w >= 0.15) parts.push('A gentle breath of wind, barely felt.')
        else parts.push('The air is completely still — no movement at all.')
    }

    if (signals.cloud_cover !== undefined) {
        const c = signals.cloud_cover
        if (c >= 0.85) parts.push('The sky is blanketed — heavy, enclosed, the light flat and diffuse.')
        else if (c >= 0.6) parts.push('Clouds drift overhead, softening and dimming the light.')
        else if (c >= 0.3) parts.push('Patches of cloud break the sky, shifting between light and shadow.')
        else parts.push('The sky is wide open — bright and clear.')
    }

    if (signals.crowd_energy !== undefined) {
        const e = signals.crowd_energy
        if (e >= 0.7) parts.push('The space is alive with people — energy, movement, voices overlapping.')
        else if (e >= 0.4) parts.push('People move through the space — a moderate human presence.')
        else if (e >= 0.15) parts.push('A few souls drift through — quiet but not empty.')
        else parts.push('The space is nearly deserted — deep solitude.')
    }

    // Fall through for any unknown signals — narrate them generically
    const described = new Set([
        'vitality', 'resonance', 'warmth', 'abundance',
        'temperature', 'humidity', 'wind_speed', 'cloud_cover', 'crowd_energy',
    ])
    for (const [k, v] of Object.entries(signals)) {
        if (described.has(k)) continue
        parts.push(`${k}: ${typeof v === 'number' ? v.toFixed(2) : v}`)
    }

    return parts.join(' ')
}
