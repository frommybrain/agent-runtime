// no-LLM brain. on the pi this runs a lot more than youd think so it has
// to look like him, not a random walk: most pressing need first, using
// whatever actions and objects the world is offering.
// needs come in as { level: 0-100, urgency: word }, higher = more urgent

export function fallbackDecision(observation) {
    const self = observation.self || {}

    // asleep ticks skip the LLM and land here, and this used to forage at the
    // nest all night (120 failures a day). env only takes wait while asleep
    if (self.asleep === true) {
        return { action: 'wait', params: {}, reason: 'asleep, staying put', source: 'fallback' }
    }

    const needs = self.needs || {}
    const nearby = observation.nearbyObjects || observation.nearby_objects || []
    const nearbyAgents = observation.nearbyAgents || observation.nearby_agents || []
    const actions = (observation.available_actions || []).map(a => (typeof a === 'string' ? a : a.name))
    const has = (name) => actions.includes(name)

    // RepetitionGuard only talks to the LLM, so do our own: anything targeted
    // 3+ times in recent_actions gets avoided if theres another option
    const recent = observation.recent_actions || observation.recentActions || []
    const targetCounts = {}
    for (const a of recent) {
        const t = a && a.target
        if (t && t !== 'wander') targetCounts[t] = (targetCounts[t] || 0) + 1
    }
    const avoid = new Set(Object.keys(targetCounts).filter((t) => targetCounts[t] >= 3))

    // {level} objects or raw 0..1
    const lvl = (n) => {
        const v = needs[n]
        if (v == null) return 0
        return typeof v === 'object' ? (v.level ?? 0) : v * 100
    }
    const urg = (n) => {
        const v = needs[n]
        return v && typeof v === 'object' ? v.urgency || '' : ''
    }

    // nearest of these types, not avoided if possible
    const pick = (types) => {
        const want = new Set(types)
        const matches = nearby.filter((o) => want.has(o.type))
        if (matches.length === 0) return null
        const fresh = matches.filter((o) => !avoid.has(o.id))
        const pool = fresh.length > 0 ? fresh : matches
        return pool.reduce((best, o) => (o.distance < (best?.distance ?? Infinity) ? o : best), null)
    }

    // terminal worlds (synth / console installs)
    if (self.interacting_with && has('terminal_input')) {
        const commands = ['status', 'help', 'draw 16 16 GREEN', 'read 16 16', 'clear']
        return { action: 'terminal_input', params: { text: commands[Math.floor(Math.random() * commands.length)] }, reason: 'trying terminal commands', source: 'fallback' }
    }

    // needs at 50+, worst first, if theres an action and a target for it.
    // forage/rest/inspect walk there themselves via the bridge
    const plan = [
        { need: 'hunger',    types: ['FOOD_SPOT'],                         action: 'forage' },
        { need: 'rest',      types: ['NEST'],                              action: 'rest' },
        { need: 'curiosity', types: ['ARTIFACT', 'SHINY', 'WATCH_POINT'],  action: 'inspect' },
        { need: 'safety',    types: ['NEST'],                              action: 'rest' },
    ]
    const ranked = plan
        .map((p) => ({ ...p, level: lvl(p.need) }))
        .filter((p) => p.level >= 50 && has(p.action))
        .sort((a, b) => b.level - a.level)
    for (const p of ranked) {
        const target = pick(p.types)
        if (target) {
            return { action: p.action, params: { target: target.id }, reason: `${urg(p.need) || 'rising'} ${p.need}, ${p.action} ${target.name || target.id}`, source: 'fallback' }
        }
    }

    // rare, single bird worlds mostly
    if (nearbyAgents.length > 0 && has('socialise')) {
        const a = nearbyAgents[0]
        return { action: 'socialise', params: { target: a.id || a.name, style: 'curious' }, reason: 'someone is near', source: 'fallback' }
    }

    // nothing urgent, go look at something
    if (has('inspect')) {
        const t = pick(['ARTIFACT', 'SHINY', 'WATCH_POINT'])
        if (t) return { action: 'inspect', params: { target: t.id }, reason: `curious about ${t.name || t.id}`, source: 'fallback' }
    }

    // wander is a real move on the bridge side, not a no-op
    if (has('move_to')) {
        const fresh = nearby.filter((o) => !avoid.has(o.id))
        const pool = fresh.length > 0 ? fresh : nearby
        const target = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)].id : 'wander'
        return { action: 'move_to', params: { target }, reason: target === 'wander' ? 'nothing close, wandering to find something' : `heading to ${target}`, source: 'fallback' }
    }

    const idle = has('wait') ? 'wait' : has('hold') ? 'hold' : null
    if (idle) return { action: idle, params: {}, reason: 'nothing to do', source: 'fallback' }
    if (actions.length > 0) return { action: actions[0], params: {}, reason: 'nothing to do', source: 'fallback' }
    return { action: 'wait', params: {}, reason: 'nothing to do', source: 'fallback' }
}
