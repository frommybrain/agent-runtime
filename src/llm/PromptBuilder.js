// Assembles system + user prompts for the LLM.
// Now includes: internal state, delta narrative, action results,
// repetition warnings, and time awareness.

export class PromptBuilder {
    constructor(persona) {
        this.persona = persona
    }

    // Hot-swap persona (called by API server on PUT /persona)
    setPersona(persona) {
        this.persona = persona
    }

    buildSystemPrompt(memoryContent, skillsContent, toolsContent, availableActions) {
        const p = this.persona
        const traits = p.traits?.join(', ') || 'curious'
        const values = p.values?.join(', ') || 'discovery'
        const fears = p.fears?.join(', ') || 'the unknown'
        const quirks = p.quirks?.join('; ') || ''
        const voice = p.voice?.style || 'natural'
        const vocab = p.voice?.vocabulary?.join(', ') || ''

        // Extract action names for conditional rules
        const actionNames = new Set(
            (availableActions || []).map(a => typeof a === 'string' ? a : a.name)
        )

        // Build interaction rules based on what actions exist
        const interactionRules = []
        if (actionNames.has('speak')) {
            interactionRules.push('- If another agent speaks to you, consider responding')
            interactionRules.push('- When you speak, say something SHORT, FRESH, and in your own voice — react to what you feel and see, don\'t analyze or explain')
            interactionRules.push('- Never repeat the same sentence structure — vary your language')
            interactionRules.push('- Speaking is for reacting to something notable or talking to others — don\'t narrate your own actions')
            interactionRules.push('- Prefer action over speech — move, interact, explore. Only speak when you have something worth saying')
        }
        if (actionNames.has('socialise')) {
            interactionRules.push('- You can socialise with nearby agents — approach them when you feel social or curious about them')
            interactionRules.push('- Vary who you socialise with — don\'t fixate on one agent')
        }
        if (actionNames.has('forage')) {
            interactionRules.push('- When your hunger is high, prioritise foraging at a food spot')
        }
        if (actionNames.has('rest')) {
            interactionRules.push('- When your rest need is high, find a nest to rest in')
        }
        if (actionNames.has('emit')) {
            interactionRules.push('- When you emit, your reason must name the SPECIFIC environmental change driving the decision — not generic statements like "maintain the atmosphere"')
            interactionRules.push('- Use the full output range: deep indigos and violets for cold/night, warm ambers and golds for warmth/crowds, muted greys for overcast stillness — don\'t settle into one palette')
            interactionRules.push('- Your text fragment should describe the SHIFT you feel, not a single word label — "the crowd thins and the air cools" not just "drift"')
            interactionRules.push('- BPM should vary widely: near 30 in solitude, 80-120 for moderate presence, 150+ for surges of energy')
            interactionRules.push('- When you hold, name what HASN\'T changed — don\'t repeat the same hold reason')
        }

        return `You are ${p.name}.
PERSONALITY: ${traits}
VALUES: ${values}
FEARS: ${fears}
QUIRKS: ${quirks}
VOICE: ${voice}${vocab ? ` (flavor words: ${vocab} — use sparingly and never repeat the same phrase)` : ''}
BACKSTORY: ${p.backstory || ''}

RULES:
- You must choose exactly ONE action to perform
- Respond with valid JSON only, no other text
- Stay in character as ${p.name}
- Vary your actions — don't repeat the same thing endlessly
- Be curious about your environment, explore, interact with things
- When you learn something new, include a "remember" field
- Your internal state describes how you feel — let it influence your choices naturally
- Pay attention to your own needs (hunger, rest, social, curiosity) — they tell you what your body wants
- Pay attention to changes in your environment — they may be worth investigating
- ONLY choose from the actions listed under "Available actions" — never use actions from a previous context
- ONLY interact with objects listed under "Nearby Objects" RIGHT NOW — never try to interact with, move toward, or address an object that isn't listed
- You may REMEMBER past experiences — reflecting on things you've seen before is natural. But always make it clear they are MEMORIES, not current reality. Say "I remember the pond" not "the pond is interesting." If it's not in Nearby Objects right now, it is NOT HERE
${interactionRules.join('\n')}

RESPONSE FORMAT:
{"action": "action_name", "params": {...}, "reason": "why you chose this"}

With optional memory:
{"action": "action_name", "params": {...}, "reason": "why", "remember": {"section": "Learned Facts", "content": "what you learned"}}

Valid remember sections: "Relationships", "Learned Facts", "Important Memories"

MY MEMORIES:
${memoryContent || '(none yet)'}

MY SKILLS:
${skillsContent || '(none yet)'}

THINGS I CAN DO:
${toolsContent || '(none yet)'}`
    }

    // extras: { internalState, deltaNarrative, lastActionResult, repetitionWarnings, tickCount, uptimeMinutes }
    buildUserPrompt(perceivedSituation, recentLogLines, workingMemoryLines, extras = {}) {
        const parts = []

        // Time awareness
        if (extras.tickCount !== undefined || extras.uptimeMinutes !== undefined) {
            const time = new Date().toLocaleTimeString()
            const uptime = extras.uptimeMinutes !== undefined ? `${extras.uptimeMinutes} minutes` : 'unknown'
            parts.push(`TIME: ${time} (awake for ${uptime}, tick #${extras.tickCount || '?'})`)
        }

        // Internal state — sensation only, no raw numbers
        if (extras.internalState) {
            const s = extras.internalState
            parts.push(`HOW YOU FEEL:\n${s.description}`)
        }

        // What changed since last tick
        if (extras.deltaNarrative) {
            parts.push(extras.deltaNarrative)
        }

        // Result of last action — consequence feedback
        if (extras.lastActionResult) {
            const r = extras.lastActionResult
            const status = r.success ? 'succeeded' : 'failed'
            parts.push(`LAST ACTION RESULT:\n${r.action || 'unknown'} ${status}${r.message ? ': ' + r.message : ''}`)
        }

        // Recently disappeared objects — hard warning to prevent hallucination
        if (extras.recentlyDisappeared?.length > 0) {
            parts.push(`GONE: The following objects have DISAPPEARED and are NO LONGER HERE: ${extras.recentlyDisappeared.join(', ')}. Do NOT interact with or move toward them. If you mention them, use past tense only ("I remember when..." / "there used to be...").`)
        }

        // Repetition warnings
        if (extras.repetitionWarnings) {
            parts.push('NOTICE:\n' + extras.repetitionWarnings.join('\n'))
        }

        // Exploration context — what you've explored vs what's new
        if (extras.explorationHint) {
            parts.push('EXPLORATION:\n' + extras.explorationHint)
        }

        // Persistent speech history — survives sleep cycles
        if (extras.recentSpeeches) {
            parts.push('YOUR RECENT SPEECHES (do NOT repeat these — say something fresh each time):\n' + extras.recentSpeeches)
        }

        if (workingMemoryLines?.length > 0) {
            parts.push('RECENT ACTIONS:\n' + workingMemoryLines.join('\n'))
        }

        if (recentLogLines?.length > 0) {
            parts.push('TODAY SO FAR:\n' + recentLogLines.join('\n'))
        }

        parts.push('CURRENT SITUATION:\n' + perceivedSituation)
        parts.push('What do you do? Respond with JSON only.')

        return parts.join('\n\n')
    }
}
