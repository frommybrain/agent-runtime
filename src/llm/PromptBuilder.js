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

    buildSystemPrompt(memoryContent, skillsContent, toolsContent) {
        const p = this.persona
        const traits = p.traits?.join(', ') || 'curious'
        const values = p.values?.join(', ') || 'discovery'
        const fears = p.fears?.join(', ') || 'the unknown'
        const quirks = p.quirks?.join('; ') || ''
        const voice = p.voice?.style || 'natural'
        const vocab = p.voice?.vocabulary?.join(', ') || ''

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
- If another agent speaks to you, consider responding
- When you learn something new, include a "remember" field
- Your internal state describes how you feel — let it influence your choices naturally
- Pay attention to changes in your environment — they may be worth investigating
- ONLY choose from the actions listed under "Available actions" — never use actions from a previous context
- Every time you speak, say something NEW and specific to what is happening — never repeat a phrase you have used before

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

        // Internal state — sensation, not instruction
        if (extras.internalState) {
            const s = extras.internalState
            parts.push(`INTERNAL STATE:\n${s.description} (valence: ${s.valence.toFixed(2)}, arousal: ${s.arousal.toFixed(2)})`)
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

        // Repetition warnings
        if (extras.repetitionWarnings) {
            parts.push('NOTICE:\n' + extras.repetitionWarnings.join('\n'))
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
