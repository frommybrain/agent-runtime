// observation json -> plain text for the LLM.
// the env decides the shape, not us, so dont assume (x, z) or a 3D world,
// just narrate whatever turns up

const MAX_SITUATION_CHARS = 12000
const MAX_GENERIC_FIELD_CHARS = 2400

export function perceive(observation, worldEvents) {
    const lines = []

    if (observation.self) {
        const s = observation.self
        // any coord system, or none
        if (s.pos) {
            const coords = Object.entries(s.pos)
                .map(([k, v]) => `${k}:${typeof v === 'number' ? v.toFixed(1) : v}`)
                .join(', ')
            lines.push(`My position: (${coords}).`)
        }
        if (s.action) lines.push(`I am currently ${s.action.toLowerCase()}.`)
        if (s.interacting_with) lines.push(`I am interacting with ${s.interacting_with}.`)
        // everything else on self, nested stuff too (needs, wellbeing)
        for (const [key, val] of Object.entries(s)) {
            if (['pos', 'action', 'interacting_with', 'id', 'name'].includes(key)) continue
            const narrated = _narrateValue(key, val)
            if (narrated) lines.push(...narrated)
        }
    }

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

    // name first when there is one. used to lead with the id and skip name,
    // so distance was the only thing that varied and his log filled up with
    // "X is close". id stays in brackets since actions target by id
    const nearbyObjects = observation.nearbyObjects || observation.nearby_objects || []
    if (nearbyObjects.length > 0) {
        const objects = nearbyObjects.map(o => {
            const hasName = o.name && o.name !== o.id
            const parts = [hasName ? `${o.name} [${o.id || o.type}]` : (o.id || o.name || o.type)]
            if (!hasName && o.type && o.id && o.type !== o.id) parts.push(`(${o.type})`)
            // prefer the felt distance ("a short walk away"), a raw number just
            // teaches him to pick the smallest one
            if (typeof o.away === 'string' && o.away) {
                parts.push(o.away)
            } else if (o.distance !== undefined) {
                parts.push(`${typeof o.distance === 'number' ? o.distance.toFixed(1) : o.distance} away`)
            } else if (o.pos) {
                const coords = Object.entries(o.pos)
                    .map(([k, v]) => `${k}:${typeof v === 'number' ? v.toFixed(1) : v}`)
                    .join(', ')
                parts.push(`at (${coords})`)
            }
            if (o.interactive) parts.push('[interactive]')
            // extras (state, value, level...)
            for (const [k, v] of Object.entries(o)) {
                if (['id', 'name', 'type', 'pos', 'interactive', 'distance', 'away'].includes(k)) continue
                if (typeof v === 'object' && v !== null) {
                    parts.push(`${k}:${JSON.stringify(v)}`)
                } else if (v !== undefined) {
                    parts.push(`${k}:${v}`)
                }
            }
            return _clip(parts.join(', '), 700)
        })
        lines.push(`Nearby: ${objects.join('; ')}.`)
    }

    // signals as feelings, not metric names
    if (observation.signals) {
        const desc = _describeSignals(observation.signals)
        if (desc) lines.push(`Environment: ${desc}`)
    }

    // server sends this in the observation
    const recentSpeech = observation.recentSpeech || []
    for (const speech of recentSpeech) {
        const speaker = speech.from || speech.agentId || 'someone'
        const ago = speech.secondsAgo ? ` (${speech.secondsAgo}s ago)` : ''
        lines.push(`${speaker} said: "${speech.message}"`)
    }

    // speech, terminal output, custom events
    if (worldEvents?.length > 0) {
        for (const evt of worldEvents) {
            const data = evt.data || evt
            if (data.event === 'agent_speech') {
                lines.push(`${data.agentId} said: "${data.message}"`)
            } else if (data.message || data.text) {
                lines.push(`Event [${data.event || 'unknown'}]: "${data.message || data.text}"`)
            } else {
                // no idea what it is, dump it and let the LLM work it out
                const { event, ...rest } = data
                const detail = Object.keys(rest).length > 0 ? `, ${JSON.stringify(rest)}` : ''
                lines.push(`Event: ${event || 'unknown'}${detail}`)
            }
        }
    }

    // names only. the full descriptions (~1k tokens, same every tick) live in the
    // the system prompt now, PromptBuilder renders them
    if (observation.available_actions?.length > 0) {
        const names = observation.available_actions
            .map((a) => (typeof a === 'string' ? a : a.name))
            .join(', ')
        lines.push(`Actions available right now: ${names}.`)
    }

    // anything else top level gets narrated blind. a synth env sending
    // { currentPatch: "pad", bpm: 120, activeChords: ["Cmaj7", "Dm9"] } still works
    const handled = new Set([
        'self', 'nearbyAgents', 'nearby_agents', 'nearbyObjects', 'nearby_objects',
        'available_actions', 'recentSpeech', 'signals', 'worldBounds',
        'recent_events', 'nearby_details', 'nearbyDetails',
    ])

    // scenery. no ids on purpose, nothing to target. the generic branch would
    // print it as a json array which reads like plumbing
    const details = observation.nearby_details || observation.nearbyDetails
    if (Array.isArray(details) && details.length) {
        lines.push('')
        lines.push('Close enough to look at (nothing to do with them, they are just there):')
        for (const d of details.slice(0, 6)) lines.push(`  ${String(d)}`)
        lines.push('')
    }

    // his day so far. the only cause and effect in here (won, caffeine wore
    // off, ate badly, felt heavy) so it gets a heading and a line each
    // instead of being a json array thats easy to skim past
    const events = observation.recent_events
    if (Array.isArray(events) && events.length) {
        lines.push('')
        lines.push('Earlier today:')
        for (const e of events.slice(-10)) lines.push(`  ${String(e)}`)
        lines.push('')
    }
    for (const [key, val] of Object.entries(observation)) {
        if (handled.has(key)) continue
        if (typeof val === 'object' && val !== null) {
            lines.push(`${key}: ${_clip(JSON.stringify(val), MAX_GENERIC_FIELD_CHARS)}`)
        } else if (val !== undefined) {
            lines.push(`${key}: ${val}`)
        }
    }

    return _fitSituation(lines.join('\n'))
}

function _clip(value, maxChars) {
    const text = String(value ?? '')
    if (text.length <= maxChars) return text
    return `${text.slice(0, maxChars - 24)} [older detail omitted]`
}

function _fitSituation(text) {
    if (text.length <= MAX_SITUATION_CHARS) return text
    // state is at the front, story stuff at the back. keep both ends, dont
    // just lop off the story when the town is busy
    const marker = '\n[less relevant detail omitted]\n'
    const available = MAX_SITUATION_CHARS - marker.length
    const head = Math.floor(available * 0.68)
    return text.slice(0, head) + marker + text.slice(text.length - (available - head))
}

// lines for one self prop, or null
function _narrateValue(key, val) {
    if (val === undefined || val === null) return null

    if (typeof val !== 'object') return [`My ${key}: ${val}`]

    if (Array.isArray(val)) {
        if (val.length === 0) return null
        return [`My ${key}: ${val.join(', ')}`]
    }

    // needs: {level: 70, urgency: "strong"}
    if (val.level !== undefined && val.urgency !== undefined) {
        // word only. with the % in he talked like a dashboard ("Hunger at 87%")
        // and we were regexing it out downstream
        return [`My ${key}: ${val.urgency}`]
    }

    // wellbeing: {status: "suffering", criticalNeeds: [...]}
    if (val.status !== undefined) {
        const parts = [val.status]
        if (val.criticalNeeds?.length > 0) parts.push(`critical: ${val.criticalNeeds.join(', ')}`)
        if (val.discomfortNeeds?.length > 0) parts.push(`discomfort: ${val.discomfortNeeds.join(', ')}`)
        return [`My ${key}: ${parts.join(', ')}`]
    }

    // anything else, one level down
    const lines = []
    for (const [k, v] of Object.entries(val)) {
        if (v === undefined || v === null) continue
        if (typeof v === 'object' && !Array.isArray(v)) {
            // eg needs.hunger = {level, urgency}
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

// 0..1 signals into something he can feel
function _describeSignals(signals) {
    const parts = []

    if (signals.vitality !== undefined) {
        const v = signals.vitality
        if (v >= 0.8) parts.push('This place feels alive, buzzing with energy.')
        else if (v >= 0.6) parts.push('There is a healthy energy here, things feel vibrant.')
        else if (v >= 0.45) parts.push('The energy here feels ordinary, nothing special.')
        else if (v >= 0.3) parts.push('The energy feels low, like this place is fading.')
        else parts.push('This place feels drained, almost lifeless.')
    }

    if (signals.resonance !== undefined) {
        const r = signals.resonance
        if (r >= 0.7) parts.push('There is an intense hum in the air, everything feels deeply connected.')
        else if (r >= 0.4) parts.push('There is a gentle hum, a sense of things being in tune.')
        else if (r >= 0.2) parts.push('The atmosphere is quiet and still.')
        else parts.push('Everything feels disconnected and flat.')
    }

    if (signals.warmth !== undefined) {
        const w = signals.warmth
        if (w >= 0.7) parts.push('A comforting warmth surrounds you.')
        else if (w >= 0.45) parts.push('The air feels neutral, neither warm nor cold.')
        else if (w >= 0.25) parts.push('There is a chill in the air.')
        else parts.push('The cold is biting, unwelcoming.')
    }

    if (signals.abundance !== undefined) {
        const a = signals.abundance
        if (a >= 0.7) parts.push('This place feels rich and full of possibility.')
        else if (a >= 0.45) parts.push('Things seem adequate, enough, but nothing more.')
        else if (a >= 0.25) parts.push('There is a sense of scarcity here.')
        else parts.push('This place feels barren and empty.')
    }

    // real world / installation sensors

    if (signals.temperature !== undefined) {
        const t = signals.temperature
        if (t >= 0.8) parts.push('The heat is heavy, the air feels thick and oppressive.')
        else if (t >= 0.6) parts.push('The air is warm and soft against the skin.')
        else if (t >= 0.4) parts.push('The temperature is mild, comfortable and easy.')
        else if (t >= 0.25) parts.push('There is a cool edge to the air.')
        else if (t >= 0.12) parts.push('The cold is sharp, biting at every surface.')
        else parts.push('A deep freeze grips everything, brittle and still.')
    }

    if (signals.humidity !== undefined) {
        const h = signals.humidity
        if (h >= 0.8) parts.push('The air is thick with moisture, everything feels damp and close.')
        else if (h >= 0.6) parts.push('There is a heaviness to the air, moisture clinging to everything.')
        else if (h >= 0.4) parts.push('The air feels balanced, neither dry nor damp.')
        else if (h >= 0.2) parts.push('The air is dry and crisp, clean to breathe.')
        else parts.push('The air is parched, bone-dry, almost desert-like.')
    }

    if (signals.wind_speed !== undefined) {
        const w = signals.wind_speed
        if (w >= 0.7) parts.push('Strong gusts push through the space, everything sways and rustles.')
        else if (w >= 0.4) parts.push('A steady breeze moves through, carrying scents and sounds.')
        else if (w >= 0.15) parts.push('A gentle breath of wind, barely felt.')
        else parts.push('The air is completely still, no movement at all.')
    }

    if (signals.cloud_cover !== undefined) {
        const c = signals.cloud_cover
        if (c >= 0.85) parts.push('The sky is blanketed, heavy, enclosed, the light flat and diffuse.')
        else if (c >= 0.6) parts.push('Clouds drift overhead, softening and dimming the light.')
        else if (c >= 0.3) parts.push('Patches of cloud break the sky, shifting between light and shadow.')
        else parts.push('The sky is wide open, bright and clear.')
    }

    if (signals.crowd_energy !== undefined) {
        const e = signals.crowd_energy
        if (e >= 0.7) parts.push('The space is alive with people, energy, movement, voices overlapping.')
        else if (e >= 0.4) parts.push('People move through the space, a moderate human presence.')
        else if (e >= 0.15) parts.push('A few souls drift through, quiet but not empty.')
        else parts.push('The space is nearly deserted, deep solitude.')
    }

    // these went in as bare decimals for months, in a prompt that bans quoting
    // numbers. words now, and nothing at all when theres nothing to feel

    if (signals.danger !== undefined) {
        const d = signals.danger
        if (d >= 0.5) parts.push('Something in the air says be careful right now.')
        else if (d >= 0.25) parts.push('A thin unease about the streets.')
        else if (d >= 0.12) parts.push('The town feels a touch off tonight.')
    }

    if (signals.wetness !== undefined) {
        const w = signals.wetness
        if (w >= 0.7) parts.push('Proper rain, everything soaked and dripping.')
        else if (w >= 0.4) parts.push('Rain on and off, puddles standing about.')
        else if (w >= 0.15) parts.push('Damp underfoot from earlier rain.')
    }

    if (signals.overcast !== undefined) {
        const c = signals.overcast
        if (c >= 0.85) parts.push('The sky is one flat grey lid.')
        else if (c >= 0.5) parts.push('Grey overhead, the light dulled down.')
    }

    if (signals.makerPulse !== undefined) {
        // 0.5 is calm, the middle band says nothing so it doesnt become wallpaper
        const m = signals.makerPulse
        if (m >= 0.8) parts.push('The whole town feels flush and quick today.')
        else if (m >= 0.65) parts.push('A good current running through the streets.')
        else if (m <= 0.2) parts.push('The town feels drained, like something is being taken from it.')
        else if (m <= 0.35) parts.push('A low ebb in everything today.')
    }

    if (signals.intoxication !== undefined) {
        const i = signals.intoxication
        if (i >= 0.7) parts.push('You are properly drunk.')
        else if (i >= 0.3) parts.push('The drink is warm in you.')
    }

    if (signals.hangover !== undefined) {
        const h = signals.hangover
        if (h >= 0.5) parts.push('Your head is paying for last night.')
        else if (h >= 0.2) parts.push('A dull ache behind the eyes from last night.')
    }

    if (signals.musicPlaying === true) parts.push('Music is playing somewhere in the town.')

    // unknown signals get dumped raw. dayPhase and season are swallowed on
    // purpose, world_clock already covers it and he'd only quote the number
    const described = new Set([
        'vitality', 'resonance', 'warmth', 'abundance',
        'temperature', 'humidity', 'wind_speed', 'cloud_cover', 'crowd_energy',
        'danger', 'wetness', 'overcast', 'makerPulse', 'intoxication', 'hangover',
        'musicPlaying', 'dayPhase', 'season',
    ])
    for (const [k, v] of Object.entries(signals)) {
        if (described.has(k)) continue
        parts.push(`${k}: ${typeof v === 'number' ? v.toFixed(2) : v}`)
    }

    return parts.join(' ')
}
