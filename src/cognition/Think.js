// perceive -> prompt -> LLM -> parse. the extras (state, deltas, warnings)
// just get passed through to the prompt builder

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

        // ~4 chars a token. was 7800 from the 8k context days, both models
        // have way more now so this is a cost dial not a wall. real peaks were
        // ~8050 (22 Aug) so 7800 was chopping real content, bumped a bit past that
        this._maxInputChars = 8400 * 4
        this._lastPromptChars = 0       // metrics
    }

    // extras: { internalState, deltaNarrative, lastActionResult, repetitionWarnings, tickCount, uptimeMinutes, salience, tier }
    async decide(observation, worldEvents, extras = {}) {
        const tier = extras.tier || 'quality'

        // skip tier never touches the LLM
        if (tier === 'skip') {
            this.logger.debug('Tick classified as skip, using fallback brain')
            return { ...this._wrapFallback(observation), fallback: 'skip' }
        }

        let situation = perceive(observation, worldEvents)
        this.logger.debug(`Perceived: ${situation.split('\n')[0]}...`)

        const [memory, skills, tools] = await Promise.all([
            this.memoryFiles.readMemory(),
            this.memoryFiles.readSkills(),
            this.memoryFiles.readTools(),
        ])

        const recentLog = await this.dailyLog.readRecentLines(5)
        const recentMemory = this.workingMemory.recent(5)

        // current thread (made during sleep), 30% of ticks only. every tick
        // and 46% of a days decisions ran the same query, the "you dont have
        // to serve it" hedge in the prompt did nothing
        try {
            const thread = await this.memoryFiles.readCurrentThread()
            if (thread?.text && Math.random() < 0.3) extras.currentThread = thread.text
        } catch { /* threadless is fine */ }

        const systemPrompt = this.promptBuilder.buildSystemPrompt(memory, skills, tools, observation.available_actions)
        let userPrompt = this.promptBuilder.buildUserPrompt(situation, recentLog, recentMemory, extras)

        // over budget: trim the situation first, then the user prompt, then
        // Learned Facts as a last resort
        let finalSystemPrompt = systemPrompt
        let totalChars = systemPrompt.length + userPrompt.length
        if (totalChars > this._maxInputChars && situation.length > 3500) {
            const overBy = totalChars - this._maxInputChars
            const keep = Math.max(3500, situation.length - overBy - 200)
            if (keep < situation.length) {
                this.logger.warn(`Live situation is ${situation.length} chars; trimming it to ${keep} before touching memory`)
                situation = this._trimSituation(situation, keep)
                userPrompt = this.promptBuilder.buildUserPrompt(situation, recentLog, recentMemory, extras)
                totalChars = systemPrompt.length + userPrompt.length
            }
        }
        // situation isnt the only big thing in the user prompt (deltas, exploration,
        // voice examples) so fit the whole thing too, keeping both ends
        const maxUserChars = Math.max(6000, this._maxInputChars - systemPrompt.length - 200)
        if (userPrompt.length > maxUserChars) {
            this.logger.warn(`Assembled user prompt is ${userPrompt.length} chars; fitting it to ${maxUserChars}`)
            userPrompt = this._trimUserPrompt(userPrompt, maxUserChars)
            totalChars = systemPrompt.length + userPrompt.length
        }
        if (totalChars > this._maxInputChars) {
            const overBy = totalChars - this._maxInputChars
            // log the breakdown. this once blamed Learned Facts for a day when it
            // was 717 chars of an 8700 overage
            this.logger.warn(`Prompt over budget by ~${Math.round(overBy / 4)} tokens (system ${systemPrompt.length}, user ${userPrompt.length}; memory ${memory.length}, skills ${skills.length}, tools ${tools.length}, situation ${situation.length}), truncating Learned Facts`)
            const truncatedMemory = this._truncateLearnedFacts(memory, overBy)
            finalSystemPrompt = this.promptBuilder.buildSystemPrompt(truncatedMemory, skills, tools, observation.available_actions)
            const stillOver = finalSystemPrompt.length + userPrompt.length - this._maxInputChars
            if (stillOver > 0) {
                this.logger.warn(`Still over by ~${Math.round(stillOver / 4)} tokens after the chop; the fat is not in Learned Facts`)
            }
        }
        this._lastPromptChars = finalSystemPrompt.length + userPrompt.length

        const { text, source, model, usage, ms } = await this.llm.generate(finalSystemPrompt, userPrompt, 30000, tier)
        // for the decision log, fallback or not
        const receipt = { llm: { model: model || null, ms: ms ?? null, usage: usage || null }, promptChars: this._lastPromptChars }

        if (!text) {
            this.logger.warn('LLM returned nothing, using fallback')
            return { ...this._wrapFallback(observation), ...receipt, fallback: 'no_answer' }
        }

        this.logger.debug(`LLM response (${source}): ${text.slice(0, 120)}`)

        const parsed = this._parseResponse(text)
        if (!parsed) {
            this.logger.warn('Failed to parse LLM response, using fallback')
            return { ...this._wrapFallback(observation), ...receipt, fallback: 'unparseable', raw: text.slice(0, 300) }
        }

        // capped, or it writes essays into memory.md
        if (parsed.remember && typeof parsed.remember.content === 'string' && parsed.remember.content.trim()) {
            const salience = extras.salience || 0.5
            let content = parsed.remember.content.trim().slice(0, 120)
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
            // the env keeps its own memory + diary and never heard about these,
            // they just went into a file on the pi
            remember: parsed.remember?.content ? parsed.remember : undefined,
            ...receipt,
        }
    }

    // sleep consolidation. jsonMode has to be false for the markdown ones
    // (memory.md, skills.md) or groq 400s, json_object mode wants the word
    // "json" in the messages. silently killed every pass for a while
    async consolidate(systemPrompt, userPrompt, timeoutMs = 60000, jsonMode = true) {
        const { text, source } = await this.llm.generate(systemPrompt, userPrompt, timeoutMs, 'quality', jsonMode)
        return text
    }

    _parseResponse(text) {
        let jsonStr = text.trim()

        // models love wrapping it in ```json
        const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
        if (fenceMatch) jsonStr = fenceMatch[1].trim()

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

    // Learned Facts is the biggest and least important section. slicing off
    // teh end would take Important Memories first
    _truncateLearnedFacts(memory, overBy) {
        const marker = '## Learned Facts'
        const idx = memory.indexOf(marker)
        if (idx === -1) {
            // no section, just cut the end
            return memory.slice(0, Math.max(200, memory.length - overBy))
        }

        const afterMarker = idx + marker.length
        const nextSection = memory.indexOf('\n## ', afterMarker)
        const sectionEnd = nextSection === -1 ? memory.length : nextSection

        const before = memory.slice(0, afterMarker)
        const section = memory.slice(afterMarker, sectionEnd)
        const after = memory.slice(sectionEnd)

        // oldest non-salient first, [salient] only if thats not enough.
        // plain oldest-first threw away the stuff that mattered and kept routine
        const lines = section.split('\n')
        const isFact = (l) => l.startsWith('- ')
        const isSalient = (l) => /\[salient\]\s*$/.test(l)
        const removeSet = new Set()
        let removed = 0
        for (const salientPass of [false, true]) {
            if (removed >= overBy) break
            for (let i = 0; i < lines.length; i++) {
                if (removed >= overBy) break
                const line = lines[i]
                if (!isFact(line) || removeSet.has(i)) continue
                if (isSalient(line) !== salientPass) continue
                removeSet.add(i)
                removed += line.length + 1
            }
        }

        const totalFacts = lines.filter(isFact).length
        const kept = lines.filter((line, i) => !removeSet.has(i))
        const omitted = totalFacts - kept.filter(isFact).length
        const truncNote = omitted > 0 ? `\n(${omitted} older facts omitted for context budget)\n` : ''
        return before + truncNote + kept.join('\n') + after
    }

    _trimSituation(situation, maxChars) {
        if (situation.length <= maxChars) return situation
        const marker = '\n[less relevant live detail omitted]\n'
        const available = Math.max(0, maxChars - marker.length)
        const head = Math.floor(available * 0.68)
        return situation.slice(0, head) + marker + situation.slice(situation.length - (available - head))
    }

    _trimUserPrompt(prompt, maxChars) {
        if (prompt.length <= maxChars) return prompt
        const marker = '\n\n[older decision context omitted]\n\n'
        const available = Math.max(0, maxChars - marker.length)
        const head = Math.floor(available * 0.35)
        return prompt.slice(0, head) + marker + prompt.slice(prompt.length - (available - head))
    }

    _wrapFallback(observation) {
        const decision = fallbackDecision(observation)
        return { ...decision, source: 'fallback' }
    }
}
