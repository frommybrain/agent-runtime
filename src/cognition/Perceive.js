// Converts raw observation JSON into natural language for the LLM

export function perceive(observation, worldEvents) {
    const lines = []

    // Agent's own state
    if (observation.self) {
        const s = observation.self
        lines.push(`I am at position (${s.pos?.x?.toFixed(1)}, ${s.pos?.z?.toFixed(1)}).`)
        if (s.action) lines.push(`I am currently ${s.action.toLowerCase()}.`)
        if (s.interacting_with) lines.push(`I am interacting with ${s.interacting_with}.`)
    }

    // Nearby agents
    const nearbyAgents = observation.nearbyAgents || observation.nearby_agents || []
    if (nearbyAgents.length > 0) {
        const agents = nearbyAgents.map(a => {
            const dist = a.distance?.toFixed(1) || '?'
            const doing = a.action ? `, ${a.action.toLowerCase()}` : ''
            return `${a.id} (${dist} units away${doing})`
        })
        lines.push(`Nearby agents: ${agents.join(', ')}.`)
    } else {
        lines.push('No other agents nearby.')
    }

    // Nearby objects
    const nearbyObjects = observation.nearbyObjects || observation.nearby_objects || []
    if (nearbyObjects.length > 0) {
        const objects = nearbyObjects.map(o => {
            const interactive = o.interactive ? ' [interactive]' : ''
            return `${o.id} (${o.type}${interactive})`
        })
        lines.push(`Nearby objects: ${objects.join(', ')}.`)
    }

    // Recent speech from observation (server-included)
    const recentSpeech = observation.recentSpeech || []
    for (const speech of recentSpeech) {
        lines.push(`${speech.from} said: "${speech.message}" (${speech.secondsAgo}s ago)`)
    }

    // Recent world events (speech, terminal output via WebSocket push)
    if (worldEvents?.length > 0) {
        for (const evt of worldEvents) {
            const data = evt.data || evt
            if (data.event === 'agent_speech') {
                lines.push(`${data.agentId} said: "${data.message}"`)
            } else if (data.event === 'terminal_output') {
                lines.push(`Terminal output: "${data.text}"`)
            }
        }
    }

    // Available actions
    if (observation.available_actions?.length > 0) {
        const actionDescs = observation.available_actions.map(a => {
            if (typeof a === 'string') return a
            return `${a.name}(${a.params || ''}) — ${a.description || ''}`
        })
        lines.push(`Available actions:\n${actionDescs.map(d => `  - ${d}`).join('\n')}`)
    }

    return lines.join('\n')
}
