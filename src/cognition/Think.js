// Orchestrates: perceive → build prompt → call LLM → parse response
// Now accepts cognitive context (internal state, deltas, action results, repetition)
// and passes it through to the prompt builder.

import { perceive } from './Perceive.js'
import { fallbackDecision } from './FallbackBrain.js'

export class Think {
    constructor(llmClient, promptBuilder, memoryFiles, dailyLog, workingMemory, logger) {
        this.llm = llmClient
        this.promptBuilder = promptBuilder
        this.memoryFiles = memoryFiles
        this.dailyLog = dailyLog
        this.workingMemory = workingMemory
        this.logger = logger

        // Token budget: ~4 chars per token, 8k context with 200 reserved for output
        this._maxInputChars = 7800 * 4  // ~7800 tokens for input
        this._lastPromptChars = 0       // tracked for metrics
    }

    // extras: { internalState, deltaNarrative, lastActionResult, repetitionWarnings, tickCount, uptimeMinutes, salience }
    async decide(observation, worldEvents, extras = {}) {
        // 1. Perceive — turn raw observation into natural language
        const situation = perceive(observation, worldEvents)
        this.logger.debug(`Perceived: ${situation.split('\n')[0]}...`)

        // 2. Build prompts
        const [memory, skills, tools] = await Promise.all([
            this.memoryFiles.readMemory(),
            this.memoryFiles.readSkills(),
            this.memoryFiles.readTools(),
        ])

        const recentLog = await this.dailyLog.readRecentLines(5)
        const recentMemory = this.workingMemory.recent(5)

        const systemPrompt = this.promptBuilder.buildSystemPrompt(memory, skills, tools)
        const userPrompt = this.promptBuilder.buildUserPrompt(situation, recentLog, recentMemory, extras)

        // 2b. Token budget check — truncate memory files if over budget
        let finalSystemPrompt = systemPrompt
        const totalChars = systemPrompt.length + userPrompt.length
        this._lastPromptChars = totalChars
        if (totalChars > this._maxInputChars) {
            const overBy = totalChars - this._maxInputChars
            this.logger.warn(`Prompt over budget by ~${Math.round(overBy / 4)} tokens — truncating memory context`)
            // Rebuild with truncated memory (skills and tools take priority over old memories)
            const truncatedMemory = memory.slice(0, Math.max(200, memory.length - overBy))
            finalSystemPrompt = this.promptBuilder.buildSystemPrompt(truncatedMemory, skills, tools)
        }

        // 3. Call LLM
        const { text, source } = await this.llm.generate(finalSystemPrompt, userPrompt)

        if (!text) {
            this.logger.warn('LLM returned nothing, using fallback')
            return this._wrapFallback(observation)
        }

        this.logger.debug(`LLM response (${source}): ${text.slice(0, 120)}`)

        // 4. Parse response
        const parsed = this._parseResponse(text)
        if (!parsed) {
            this.logger.warn('Failed to parse LLM response, using fallback')
            return this._wrapFallback(observation)
        }

        // 5. Handle memory write if present — use salience for encoding strength
        if (parsed.remember && typeof parsed.remember.content === 'string' && parsed.remember.content.trim()) {
            const salience = extras.salience || 0.5
            const content = salience > 0.7
                ? `${parsed.remember.content} [salient]`
                : parsed.remember.content
            await this.memoryFiles.appendToMemory(
                parsed.remember.section || 'Learned Facts',
                content
            )
            this.logger.info(`Remembered: [${parsed.remember.section}] ${parsed.remember.content}`)
        }

        return {
            action: parsed.action,
            params: parsed.params || {},
            reason: parsed.reason || '',
            source: source,
        }
    }

    // For sleep consolidation — direct LLM call with custom prompts
    async consolidate(systemPrompt, userPrompt, timeoutMs = 60000) {
        const { text, source } = await this.llm.generate(systemPrompt, userPrompt, timeoutMs)
        return text
    }

    _parseResponse(text) {
        // Try to extract JSON from the response
        // LLMs sometimes wrap JSON in markdown code blocks
        let jsonStr = text.trim()

        // Strip markdown code fences
        const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
        if (fenceMatch) jsonStr = fenceMatch[1].trim()

        // Try to find JSON object
        const braceStart = jsonStr.indexOf('{')
        const braceEnd = jsonStr.lastIndexOf('}')
        if (braceStart !== -1 && braceEnd > braceStart) {
            jsonStr = jsonStr.slice(braceStart, braceEnd + 1)
        }

        try {
            const parsed = JSON.parse(jsonStr)
            if (!parsed.action) return null
            return parsed
        } catch {
            this.logger.debug(`JSON parse failed: ${jsonStr.slice(0, 80)}`)
            return null
        }
    }

    _wrapFallback(observation) {
        const decision = fallbackDecision(observation)
        return { ...decision, source: 'fallback' }
    }
}
