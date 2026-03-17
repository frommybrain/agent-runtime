// Orchestrates: perceive → build prompt → call LLM → parse response
// Now accepts cognitive context (internal state, deltas, action results, repetition)
// and passes it through to the prompt builder.

import { perceive } from './Perceive.js'
import { fallbackDecision } from './FallbackBrain.js'
import { sanitizeJson } from '../util/sanitizeJson.js'

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

    // extras: { internalState, deltaNarrative, lastActionResult, repetitionWarnings, tickCount, uptimeMinutes, salience, tier }
    async decide(observation, worldEvents, extras = {}) {
        const tier = extras.tier || 'quality'

        // Tier 'skip': no LLM call — use fallback brain directly
        if (tier === 'skip') {
            this.logger.debug('Tick classified as skip — using fallback brain')
            return this._wrapFallback(observation)
        }

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

        const systemPrompt = this.promptBuilder.buildSystemPrompt(memory, skills, tools, observation.available_actions)
        const userPrompt = this.promptBuilder.buildUserPrompt(situation, recentLog, recentMemory, extras)

        // 2b. Token budget check — truncate memory if over budget.
        // v0.3.1: Truncate "Learned Facts" (middle section, largest) rather than
        // slicing from the end, which would cut "Important Memories" first.
        let finalSystemPrompt = systemPrompt
        const totalChars = systemPrompt.length + userPrompt.length
        this._lastPromptChars = totalChars
        if (totalChars > this._maxInputChars) {
            const overBy = totalChars - this._maxInputChars
            this.logger.warn(`Prompt over budget by ~${Math.round(overBy / 4)} tokens — truncating Learned Facts`)
            const truncatedMemory = this._truncateLearnedFacts(memory, overBy)
            finalSystemPrompt = this.promptBuilder.buildSystemPrompt(truncatedMemory, skills, tools, observation.available_actions)
        }

        // 3. Call LLM with tier routing
        const { text, source } = await this.llm.generate(finalSystemPrompt, userPrompt, 30000, tier)

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
        // v0.3.1: Cap entry length to prevent LLM from writing novels into memory
        if (parsed.remember && typeof parsed.remember.content === 'string' && parsed.remember.content.trim()) {
            const salience = extras.salience || 0.5
            let content = parsed.remember.content.trim().slice(0, 120)  // hard cap: 120 chars
            if (salience > 0.7) content += ' [salient]'
            await this.memoryFiles.appendToMemory(
                parsed.remember.section || 'Learned Facts',
                content
            )
            this.logger.info(`Remembered: [${parsed.remember.section}] ${content}`)
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
            const parsed = JSON.parse(sanitizeJson(jsonStr))
            if (!parsed.action) return null
            return parsed
        } catch {
            this.logger.debug(`JSON parse failed: ${jsonStr.slice(0, 80)}`)
            return null
        }
    }

    // Truncate memory by removing entries from "Learned Facts" (the largest,
    // least critical section) rather than slicing from the end which would
    // destroy "Important Memories" first.
    _truncateLearnedFacts(memory, overBy) {
        const marker = '## Learned Facts'
        const idx = memory.indexOf(marker)
        if (idx === -1) {
            // No Learned Facts section — fall back to end truncation
            return memory.slice(0, Math.max(200, memory.length - overBy))
        }

        // Find the next section after Learned Facts
        const afterMarker = idx + marker.length
        const nextSection = memory.indexOf('\n## ', afterMarker)
        const sectionEnd = nextSection === -1 ? memory.length : nextSection

        // Extract the section's entries
        const before = memory.slice(0, afterMarker)
        const section = memory.slice(afterMarker, sectionEnd)
        const after = memory.slice(sectionEnd)

        // Remove entries from the START of Learned Facts (oldest first)
        const lines = section.split('\n')
        let removed = 0
        const kept = []
        for (const line of lines) {
            if (removed < overBy && line.startsWith('- ')) {
                removed += line.length + 1
            } else {
                kept.push(line)
            }
        }

        const truncNote = removed > 0 ? `\n(${lines.filter(l => l.startsWith('- ')).length - kept.filter(l => l.startsWith('- ')).length} older facts omitted for context budget)\n` : ''
        return before + truncNote + kept.join('\n') + after
    }

    _wrapFallback(observation) {
        const decision = fallbackDecision(observation)
        return { ...decision, source: 'fallback' }
    }
}
