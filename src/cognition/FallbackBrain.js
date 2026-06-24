// Heuristic fallback when the LLM is unavailable.
//
// On hardware where the cloud/local LLM frequently fails (e.g. a shared
// Pi), this is not a rare edge case — it can be the steady state. So it
// must produce COHERENT, needs-appropriate, in-character behaviour, not
// a random walk. It is needs-driven and affordance-aware: it reads the
// bird's needs and the world's advertised actions + nearby objects and
// picks the action that actually addresses the most pressing need.
//
// It also self-derives an anti-fixation avoid-set from observation
// .recent_actions (the world surfaces the last few committed actions),
// so even without the LLM the heuristic won't hammer the same target.
//
// Need semantics (sim-server): value is 0..1 where HIGH = MORE URGENT
// (hunger 0.9 = "desperate"). The observation sends each need as
// { level: 0-100, urgency: word }.

export function fallbackDecision(observation) {
    const self = observation.self || {}
    const needs = self.needs || {}
    const nearby = observation.nearbyObjects || observation.nearby_objects || []
    const nearbyAgents = observation.nearbyAgents || observation.nearby_agents || []
    const actions = (observation.available_actions || []).map(a => (typeof a === 'string' ? a : a.name))
    const has = (name) => actions.includes(name)

    // Anti-fixation avoid-set: any target chosen >= 3 times in the recent
    // action trail is "overused" — steer away from it if there's an
    // alternative. Self-contained so the heuristic path gets anti-fixation
    // even though the RepetitionGuard's prose hints only reach the LLM.
    const recent = observation.recent_actions || observation.recentActions || []
    const targetCounts = {}
    for (const a of recent) {
        const t = a && a.target
        if (t && t !== 'wander') targetCounts[t] = (targetCounts[t] || 0) + 1
    }
    const avoid = new Set(Object.keys(targetCounts).filter((t) => targetCounts[t] >= 3))

    // Need level accessor — tolerates {level} objects or raw 0..1 numbers.
    const lvl = (n) => {
        const v = needs[n]
        if (v == null) return 0
        return typeof v === 'object' ? (v.level ?? 0) : v * 100
    }
    const urg = (n) => {
        const v = needs[n]
        return v && typeof v === 'object' ? v.urgency || '' : ''
    }

    // Nearest object of the given type(s), preferring fresh (non-avoided).
    const pick = (types) => {
        const want = new Set(types)
        const matches = nearby.filter((o) => want.has(o.type))
        if (matches.length === 0) return null
        const fresh = matches.filter((o) => !avoid.has(o.id))
        const pool = fresh.length > 0 ? fresh : matches
        return pool.reduce((best, o) => (o.distance < (best?.distance ?? Infinity) ? o : best), null)
    }

    // Environment-specific: terminal worlds (synth/console installs).
    if (self.interacting_with && has('terminal_input')) {
        const commands = ['status', 'help', 'draw 16 16 GREEN', 'read 16 16', 'clear']
        return { action: 'terminal_input', params: { text: commands[Math.floor(Math.random() * commands.length)] }, reason: 'trying terminal commands', source: 'fallback' }
    }

    // 1. URGENT NEEDS — act on the most pressing need (level >= 50) that
    //    has both an advertised action and a usable nearby target. The
    //    semantic action (forage/rest/inspect) auto-moves via the bridge
    //    if not in range, so this actually COMPLETES journeys.
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

    // 2. Social, if anyone's actually nearby (rare in single-bird worlds).
    if (nearbyAgents.length > 0 && has('socialise')) {
        const a = nearbyAgents[0]
        return { action: 'socialise', params: { target: a.id || a.name, style: 'curious' }, reason: 'someone is near', source: 'fallback' }
    }

    // 3. Mild curiosity / variety — inspect something FRESH nearby.
    if (has('inspect')) {
        const t = pick(['ARTIFACT', 'SHINY', 'WATCH_POINT'])
        if (t) return { action: 'inspect', params: { target: t.id }, reason: `curious about ${t.name || t.id}`, source: 'fallback' }
    }

    // 4. Explore — move toward a fresh nearby object, else wander. (Wander
    //    is now a real server-owned MOVE on the bridge side, not a no-op.)
    if (has('move_to')) {
        const fresh = nearby.filter((o) => !avoid.has(o.id))
        const pool = fresh.length > 0 ? fresh : nearby
        const target = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)].id : 'wander'
        return { action: 'move_to', params: { target }, reason: target === 'wander' ? 'nothing close, wandering to find something' : `heading to ${target}`, source: 'fallback' }
    }

    // 5. Last resort.
    const idle = has('wait') ? 'wait' : has('hold') ? 'hold' : null
    if (idle) return { action: idle, params: {}, reason: 'nothing to do', source: 'fallback' }
    if (actions.length > 0) return { action: actions[0], params: {}, reason: 'nothing to do', source: 'fallback' }
    return { action: 'wait', params: {}, reason: 'nothing to do', source: 'fallback' }
}
