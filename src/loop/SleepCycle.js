// Sleep cycle manager
// 4 hours active → 1 hour sleep (configurable)
// During sleep: LLM consolidates memory, extracts skills, refreshes tools,
// reflects on internal state history, optionally evolves persona, garbage collects.

import { readFile, writeFile } from 'node:fs/promises'

export class SleepCycle {
    constructor(think, memoryFiles, dailyLog, workingMemory, internalState, config, logger) {
        this.think = think
        this.memoryFiles = memoryFiles
        this.dailyLog = dailyLog
        this.workingMemory = workingMemory
        this.internalState = internalState
        this.logger = logger

        this.activeHours = config.activeHoursBeforeSleep
        this.sleepMinutes = config.sleepDurationMinutes
        this.personaPath = config.personaPath
        this.sleeping = false

        this._wakeTime = Date.now()
        this._sleepTimer = null
    }

    isSleeping() {
        return this.sleeping
    }

    // Called each heartbeat tick to check if it's time to sleep
    checkSleepTime() {
        if (this.sleeping) return
        const activeMs = Date.now() - this._wakeTime
        const activeHours = activeMs / (1000 * 60 * 60)
        if (activeHours >= this.activeHours) {
            this._startSleep()
        }
    }

    async _startSleep() {
        if (this.sleeping) return
        this.sleeping = true

        const activeDuration = ((Date.now() - this._wakeTime) / (1000 * 60)).toFixed(1)
        this.logger.info(`=== SLEEP STARTED === (active for ${activeDuration} min)`)
        await this.dailyLog.append(`=== SLEEP STARTED === (active for ${activeDuration} min)`)

        this.workingMemory.push({ type: 'sleep', message: 'SLEEP STARTED' })

        try {
            const stats = {
                memoryConsolidated: false,
                skillsExtracted: false,
                toolsRefreshed: false,
                selfReflected: false,
                logsDeleted: 0,
            }

            // Pass 1: Consolidate memory.md
            stats.memoryConsolidated = await this._consolidateMemory()

            // Pass 2: Extract skills from memory → skills.md
            stats.skillsExtracted = await this._extractSkills()

            // Pass 3: Refresh tools.md (clean up duplicates)
            stats.toolsRefreshed = await this._refreshTools()

            // Pass 4: Self-reflection — review behaviour and optionally evolve persona
            stats.selfReflected = await this._selfReflect()

            // Pass 5: Garbage collect old daily logs
            stats.logsDeleted = await this.dailyLog.garbageCollect()

            // Pass 6: Clear working memory + internal state history
            this.workingMemory.clear()
            this.internalState.clearHistory()

            const summary = `Consolidation complete: memory=${stats.memoryConsolidated}, skills=${stats.skillsExtracted}, tools=${stats.toolsRefreshed}, reflected=${stats.selfReflected}, logs_deleted=${stats.logsDeleted}`
            this.logger.info(summary)
            await this.dailyLog.append(summary)

        } catch (err) {
            this.logger.error(`Sleep consolidation error: ${err.message}`)
            await this.dailyLog.append(`Sleep consolidation error: ${err.message}`)
        }

        // Schedule wake-up
        this.logger.info(`Sleeping for ${this.sleepMinutes} minutes...`)
        this._sleepTimer = setTimeout(() => this._wake(), this.sleepMinutes * 60 * 1000)
    }

    _wake() {
        this.sleeping = false
        this._wakeTime = Date.now()
        this._sleepTimer = null
        this.logger.info('=== SLEEP ENDED ===')
        this.dailyLog.append('=== SLEEP ENDED ===')
        this.workingMemory.push({ type: 'sleep', message: 'SLEEP ENDED — feeling refreshed' })
    }

    async _consolidateMemory() {
        const memory = await this.memoryFiles.readMemory()
        const todayLog = await this.dailyLog.readToday()

        if (!todayLog.trim()) return false

        // Include salient events — high-arousal moments should be prioritised
        const salientEvents = this.workingMemory.salientEvents(0.6)
        const salientNote = salientEvents.length > 0
            ? `\n\nIMPORTANT MOMENTS (high salience — encode these more strongly):\n${salientEvents.map(e => `- [${e.time}] ${e.type}: ${e.action || e.message || JSON.stringify(e)}`).join('\n')}`
            : ''

        const prompt = `You are a memory consolidation system. Review this agent's memory file and today's activity log.
Your job:
1. Merge redundant entries
2. Remove stale or irrelevant entries
3. Add important new facts from today's log that aren't already in memory
4. Pay special attention to high-salience moments — these were emotionally significant and should be remembered
5. Keep the same markdown format with sections: ## Relationships, ## Learned Facts, ## Important Memories
6. Cap total entries at ~50
7. Move any procedural knowledge ("how to do X") to a separate note — don't include it here

Return ONLY the updated memory.md content, nothing else.`

        const userPrompt = `CURRENT MEMORY:\n${memory}\n\nTODAY'S LOG:\n${todayLog}${salientNote}`

        const result = await this.think.consolidate(prompt, userPrompt)
        if (result && result.trim().length > 10) {
            await this.memoryFiles.writeMemory(result.trim())
            this.logger.info('Memory consolidated')
            return true
        }
        return false
    }

    async _extractSkills() {
        const memory = await this.memoryFiles.readMemory()
        const skills = await this.memoryFiles.readSkills()
        const todayLog = await this.dailyLog.readToday()

        const prompt = `You are a skill extraction system. Review this agent's memory and today's activity log.
Your job:
1. Find procedural knowledge — things the agent learned HOW to do (e.g., "to use the terminal, first interact then type commands")
2. Merge these into the skills file, organized by category
3. Keep existing skills that are still relevant
4. Remove outdated or incorrect skills
5. Keep the same markdown format

Return ONLY the updated skills.md content, nothing else.`

        const userPrompt = `CURRENT SKILLS:\n${skills}\n\nMEMORY:\n${memory}\n\nTODAY'S LOG:\n${todayLog}`

        const result = await this.think.consolidate(prompt, userPrompt)
        if (result && result.trim().length > 10) {
            await this.memoryFiles.writeSkills(result.trim())
            this.logger.info('Skills extracted')
            return true
        }
        return false
    }

    async _refreshTools() {
        const tools = await this.memoryFiles.readTools()

        const prompt = `You are a tools cleanup system. Review this tools file and clean it up:
1. Remove duplicate entries in "Discovered Objects"
2. Ensure "Available Actions" is clean and well-formatted
3. Remove any entries that look like errors or garbage
4. Keep the markdown format with sections: # Available Actions, # Discovered Objects

Return ONLY the updated tools.md content, nothing else.`

        const result = await this.think.consolidate(prompt, `CURRENT TOOLS:\n${tools}`)
        if (result && result.trim().length > 10) {
            await this.memoryFiles.writeTools(result.trim())
            this.logger.info('Tools refreshed')
            return true
        }
        return false
    }

    // Self-reflection: review recent behaviour, internal state patterns,
    // and optionally propose persona evolution.
    // This is the OHMAR Part 4 insight: "Should I evolve?"
    async _selfReflect() {
        const memory = await this.memoryFiles.readMemory()
        const todayLog = await this.dailyLog.readToday()
        const stateHistory = this.internalState.historySummary()

        if (!todayLog.trim()) return false

        // Load current persona
        let persona
        try {
            const raw = await readFile(this.personaPath, 'utf-8')
            persona = JSON.parse(raw)
        } catch {
            this.logger.warn('Could not load persona for self-reflection')
            return false
        }

        const prompt = `You are a self-reflection system for an autonomous agent named ${persona.name}.

Review the agent's recent behaviour, emotional patterns, and memories. Then decide: should the agent's personality evolve?

Rules:
- Evolution should be subtle — small shifts, not dramatic rewrites
- Changes must be grounded in actual experiences (from the log)
- Core identity (name, backstory) should NOT change
- Traits, quirks, values, fears, and voice CAN shift slightly based on experience
- If nothing warrants change, respond with {"evolve": false}
- If change is warranted, respond with {"evolve": true, "changes": {...}, "reason": "why"}

The "changes" object should contain only the fields to update, using the same structure as the persona.
For example: {"changes": {"quirks": ["speaks slowly when uncertain", "hums when exploring"]}, "reason": "developed a habit of humming during exploration"}

Respond with JSON only.`

        const userPrompt = `CURRENT PERSONA:
${JSON.stringify(persona, null, 2)}

INTERNAL STATE SUMMARY:
${stateHistory}

TODAY'S ACTIVITY:
${todayLog}

CURRENT MEMORIES:
${memory}

Should ${persona.name} evolve? Respond with JSON.`

        const result = await this.think.consolidate(prompt, userPrompt)
        if (!result) return false

        try {
            // Parse JSON from response
            let jsonStr = result.trim()
            const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
            if (fenceMatch) jsonStr = fenceMatch[1].trim()
            const braceStart = jsonStr.indexOf('{')
            const braceEnd = jsonStr.lastIndexOf('}')
            if (braceStart !== -1 && braceEnd > braceStart) {
                jsonStr = jsonStr.slice(braceStart, braceEnd + 1)
            }

            const reflection = JSON.parse(jsonStr)

            if (!reflection.evolve) {
                this.logger.info('Self-reflection: no evolution needed')
                await this.dailyLog.append('Self-reflection: no evolution needed')
                return true
            }

            // Apply changes to persona
            if (reflection.changes && typeof reflection.changes === 'object') {
                const before = JSON.stringify(persona)

                // Never change name, id, or backstory
                delete reflection.changes.name
                delete reflection.changes.id
                delete reflection.changes.backstory

                // Merge changes
                for (const [key, val] of Object.entries(reflection.changes)) {
                    persona[key] = val
                }

                // Add evolution log entry
                if (!persona.evolution) persona.evolution = []
                persona.evolution.push({
                    date: new Date().toISOString(),
                    reason: reflection.reason || 'self-reflection',
                    changes: reflection.changes,
                })
                // Keep evolution log manageable
                if (persona.evolution.length > 20) {
                    persona.evolution = persona.evolution.slice(-20)
                }

                // Write updated persona
                await writeFile(this.personaPath, JSON.stringify(persona, null, 2), 'utf-8')

                const summary = `Self-reflection: evolved — ${reflection.reason || 'subtle shift'}`
                this.logger.info(summary)
                await this.dailyLog.append(summary)
                await this.dailyLog.append(`Evolution changes: ${JSON.stringify(reflection.changes)}`)

                return true
            }
        } catch (err) {
            this.logger.warn(`Self-reflection parse error: ${err.message}`)
        }

        return false
    }

    stop() {
        if (this._sleepTimer) {
            clearTimeout(this._sleepTimer)
            this._sleepTimer = null
        }
    }
}
