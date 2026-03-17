// Heuristic fallback when LLM is unavailable
// Simple rules: wander randomly, interact with nearby objects, occasionally speak

export function fallbackDecision(observation) {
    const self = observation.self || {}
    const nearbyObjects = observation.nearbyObjects || observation.nearby_objects || []
    const nearbyAgents = observation.nearbyAgents || observation.nearby_agents || []
    const actions = observation.available_actions || ['move_to', 'wait']

    const roll = Math.random()

    // If we're interacting with terminal, send a random command
    if (self.interacting_with && actions.includes('terminal_input')) {
        const commands = ['status', 'help', 'draw 16 16 GREEN', 'read 16 16', 'clear']
        return {
            action: 'terminal_input',
            params: { text: commands[Math.floor(Math.random() * commands.length)] },
            reason: 'trying terminal commands',
            source: 'fallback',
        }
    }

    // 20% chance to interact with a nearby interactive object
    const interactives = nearbyObjects.filter(o => o.interactive)
    if (roll < 0.2 && interactives.length > 0 && actions.includes('interact')) {
        const target = interactives[Math.floor(Math.random() * interactives.length)]
        return {
            action: 'interact',
            params: { target: target.id },
            reason: `exploring ${target.id}`,
            source: 'fallback',
        }
    }

    // 15% chance to speak if other agents nearby
    if (roll < 0.35 && nearbyAgents.length > 0 && actions.includes('speak')) {
        const phrases = [
            'hello there',
            'what are you doing?',
            'this place is interesting',
            'have you found anything?',
            'hmm...',
        ]
        return {
            action: 'speak',
            params: { message: phrases[Math.floor(Math.random() * phrases.length)] },
            reason: 'being social',
            source: 'fallback',
        }
    }

    // 10% chance to wait
    if (roll < 0.45) {
        return {
            action: 'wait',
            params: {},
            reason: 'taking a moment',
            source: 'fallback',
        }
    }

    // Default: move toward a nearby object or wander randomly
    const moveTarget = nearbyObjects.length > 0
        ? nearbyObjects[Math.floor(Math.random() * nearbyObjects.length)].id
        : 'wander'
    return {
        action: 'move_to',
        params: { target: moveTarget, reason: 'exploring' },
        reason: 'exploring',
        source: 'fallback',
    }
}
