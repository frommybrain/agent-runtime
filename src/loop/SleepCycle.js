// Sleep cycle manager
// 4 hours active → 1 hour sleep (configurable)
// During sleep: LLM consolidates memory, extracts skills, refreshes tools, garbage collects

export class SleepCycle {
    constructor(think, memoryFiles, dailyLog, workingMemory, config, logger) {
        this.think = think
        this.memoryFiles = memoryFiles
        this.dailyLog = dailyLog
        this.workingMemory = workingMemory
        this.logger = logger

        this.activeHours = config.activeHoursBeforeSleep
        this.sleepMinutes = config.sleepDurationMinutes
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
            // Run consolidation passes
            const stats = {
                memoryConsolidated: false,
                skillsExtracted: false,
                toolsRefreshed: false,
                logsDeleted: 0,
            }

            // Pass 1: Consolidate memory.md
            stats.memoryConsolidated = await this._consolidateMemory()

            // Pass 2: Extract skills from memory → skills.md
            stats.skillsExtracted = await this._extractSkills()

            // Pass 3: Refresh tools.md (clean up duplicates)
            stats.toolsRefreshed = await this._refreshTools()

            // Pass 4: Garbage collect old daily logs
            stats.logsDeleted = await this.dailyLog.garbageCollect()

            // Pass 5: Clear working memory
            this.workingMemory.clear()

            const summary = `Consolidation complete: memory=${stats.memoryConsolidated}, skills=${stats.skillsExtracted}, tools=${stats.toolsRefreshed}, logs_deleted=${stats.logsDeleted}`
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

        const prompt = `You are a memory consolidation system. Review this agent's memory file and today's activity log.
Your job:
1. Merge redundant entries
2. Remove stale or irrelevant entries
3. Add important new facts from today's log that aren't already in memory
4. Keep the same markdown format with sections: ## Relationships, ## Learned Facts, ## Important Memories
5. Cap total entries at ~50
6. Move any procedural knowledge ("how to do X") to a separate note — don't include it here

Return ONLY the updated memory.md content, nothing else.`

        const userPrompt = `CURRENT MEMORY:\n${memory}\n\nTODAY'S LOG:\n${todayLog}`

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

    stop() {
        if (this._sleepTimer) {
            clearTimeout(this._sleepTimer)
            this._sleepTimer = null
        }
    }
}
