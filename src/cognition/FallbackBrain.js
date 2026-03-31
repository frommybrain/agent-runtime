// Heuristic fallback when LLM is unavailable
// Respects available_actions — only uses actions the environment supports

export function fallbackDecision(observation) {
    const self = observation.self || {}
    const nearbyObjects = observation.nearbyObjects || observation.nearby_objects || []
    const nearbyAgents = observation.nearbyAgents || observation.nearby_agents || []
    const actions = (observation.available_actions || []).map(a => typeof a === 'string' ? a : a.name)

    const has = name => actions.includes(name)
    const roll = Math.random()

    // If we're interacting with terminal, send a random command
    if (self.interacting_with && has('terminal_input')) {
        const commands = ['status', 'help', 'draw 16 16 GREEN', 'read 16 16', 'clear']
        return {
            action: 'terminal_input',
            params: { text: commands[Math.floor(Math.random() * commands.length)] },
            reason: 'trying terminal commands',
            source: 'fallback',
        }
    }

    // 20% chance to interact with a nearby object
    const interactives = nearbyObjects.filter(o => o.interactive)
    if (roll < 0.2 && interactives.length > 0) {
        const target = interactives[Math.floor(Math.random() * interactives.length)]
        // Pick the right action for this object type
        if (has('inspect')) {
            return { action: 'inspect', params: { target: target.id }, reason: `exploring ${target.id}`, source: 'fallback' }
        }
        if (has('interact')) {
            return { action: 'interact', params: { target: target.id }, reason: `exploring ${target.id}`, source: 'fallback' }
        }
    }

    // 15% chance to socialise/speak if other agents nearby
    if (roll < 0.35 && nearbyAgents.length > 0) {
        const agent = nearbyAgents[Math.floor(Math.random() * nearbyAgents.length)]
        if (has('socialise')) {
            return { action: 'socialise', params: { target: agent.id || agent.name, style: 'curious' }, reason: 'being social', source: 'fallback' }
        }
        if (has('speak')) {
            const phrases = ['hello there', 'what are you doing?', 'this place is interesting', 'have you found anything?', 'hmm...']
            return { action: 'speak', params: { message: phrases[Math.floor(Math.random() * phrases.length)] }, reason: 'being social', source: 'fallback' }
        }
    }

    // 10% chance to do nothing
    if (roll < 0.45) {
        const idle = has('wait') ? 'wait' : has('hold') ? 'hold' : null
        if (idle) return { action: idle, params: {}, reason: 'taking a moment', source: 'fallback' }
    }

    // Default: move toward a nearby object or wander randomly
    if (has('move_to')) {
        const moveTarget = nearbyObjects.length > 0
            ? nearbyObjects[Math.floor(Math.random() * nearbyObjects.length)].id
            : 'wander'
        return { action: 'move_to', params: { target: moveTarget }, reason: 'exploring', source: 'fallback' }
    }

    // Absolute fallback: idle action or first available
    const idle = has('wait') ? 'wait' : has('hold') ? 'hold' : null
    if (idle) return { action: idle, params: {}, reason: 'nothing to do', source: 'fallback' }
    // Last resort: first available action with empty params
    if (actions.length > 0) return { action: actions[0], params: {}, reason: 'nothing to do', source: 'fallback' }
    return { action: 'wait', params: {}, reason: 'nothing to do', source: 'fallback' }
}
