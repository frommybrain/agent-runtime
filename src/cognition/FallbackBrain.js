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

    // Default: wander to a random position
    const bounds = observation.worldBounds?.halfSize || 100
    const x = (Math.random() - 0.5) * bounds * 1.5
    const z = (Math.random() - 0.5) * bounds * 1.5
    return {
        action: 'move_to',
        params: { x: Math.round(x), z: Math.round(z) },
        reason: 'exploring',
        source: 'fallback',
    }
}
