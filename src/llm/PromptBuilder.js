// Assembles system + user prompts for the LLM from persona + knowledge files + observations

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
VOICE STYLE: ${voice}
TYPICAL WORDS: ${vocab}
BACKSTORY: ${p.backstory || ''}

RULES:
- You must choose exactly ONE action to perform
- Respond with valid JSON only, no other text
- Stay in character as ${p.name}
- Vary your actions — don't repeat the same thing endlessly
- Be curious about your environment, explore, interact with things
- If another agent speaks to you, consider responding
- When you learn something new, include a "remember" field

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

    buildUserPrompt(perceivedSituation, recentLogLines, workingMemoryLines) {
        const parts = []

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
