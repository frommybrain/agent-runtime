// sleep cycle manager.
// configurable active/sleep durations + quiet hours.
// during sleep: LLM consolidates memory, extracts skills, reflects on
// state history, optionally evolves persona, garbage collects.
//
// v0.3 changes:
// - readForConsolidation() caps LLM context input
// - clears repetition guard during sleep
// - persona drift guard: measures distance from original, blocks runaway evolution
// - flushes daily log buffer before consolidation

import { sanitizeJson } from '../util/sanitizeJson.js'

import { readFile, writeFile, copyFile } from 'node:fs/promises'

export class SleepCycle {
    constructor(think, memoryFiles, dailyLog, workingMemory, internalState, repetitionGuard, speechLog, config, logger) {
        this.think = think
        this.memoryFiles = memoryFiles
        this.dailyLog = dailyLog
        this.workingMemory = workingMemory
        this.internalState = internalState
        this.repetitionGuard = repetitionGuard
        this.speechLog = speechLog
        this.logger = logger

        this.activeHours = config.activeHoursBeforeSleep
        this.sleepMinutes = config.sleepDurationMinutes
        this.personaPath = config.personaPath
        this.dataDir = config.dataDir
        this.sleeping = false

        // quiet hours — reduced activity during low-viewership windows
        this._quietHours = this._parseQuietHours(config.quietHours)
        this._quietActiveMinutes = config.quietActiveMinutes || 15
        this._quietSleepMinutes = config.quietSleepMinutes || 30

        this._wakeTime = Date.now()
        this._sleepTimer = null
        this._originalPersona = null  // loaded from immutable baseline file
    }

    // load the immutable original persona baseline.
    // on first-ever boot, saves a copy that never changes.
    // on every subsequent boot (incl after crashes), loads from that file.
    async loadOriginalPersona(currentPersona) {
        const { join } = await import('node:path')
        const baselinePath = join(this.dataDir, 'persona-baseline.json')
        try {
            const raw = await readFile(baselinePath, 'utf-8')
            this._originalPersona = this._extractComparableFields(JSON.parse(raw))
            this.logger.info('Drift guard: loaded immutable persona baseline')
        } catch {
            // first ever boot — save the current persona as the baseline
            await writeFile(baselinePath, JSON.stringify(currentPersona, null, 2), 'utf-8')
            this._originalPersona = this._extractComparableFields(currentPersona)
            this.logger.info('Drift guard: saved initial persona baseline')
        }
    }

    isSleeping() {
        return this.sleeping
    }

    // called each heartbeat tick to check if its time to sleep
    checkSleepTime() {
        if (this.sleeping) return
        const activeMs = Date.now() - this._wakeTime
        const activeMinutes = activeMs / (1000 * 60)
        const quiet = this._isQuietHours()
        const targetMinutes = quiet
            ? this._quietActiveMinutes
            : this.activeHours * 60
        if (activeMinutes >= targetMinutes) {
            this._startSleep(quiet)
        }
    }

    async _startSleep(quiet = false) {
        if (this.sleeping) return
        this.sleeping = true

        const activeDuration = ((Date.now() - this._wakeTime) / (1000 * 60)).toFixed(1)
        const mode = quiet ? ' [quiet hours]' : ''
        this.logger.info(`=== SLEEP STARTED${mode} === (active for ${activeDuration} min)`)
        await this.dailyLog.append(`=== SLEEP STARTED === (active for ${activeDuration} min)`)

        this.workingMemory.push({ type: 'sleep', message: 'SLEEP STARTED' })

        // flush daily log buffer before consolidation reads it
        await this.dailyLog.flush()

        try {
            const stats = {
                memoryConsolidated: false,
                skillsExtracted: false,
                selfReflected: false,
                logsDeleted: 0,
            }

            // Pass 0: pre-consolidation dedup — strip near-duplicates before the LLM sees them
            const dedupRemoved = await this.memoryFiles.deduplicateMemory()
            if (dedupRemoved > 0) {
                await this.dailyLog.append(`Pre-consolidation dedup: removed ${dedupRemoved} near-duplicates`)
            }

            // Pass 1: consolidate memory.md
            stats.memoryConsolidated = await this._consolidateMemory()
            await this._sleepDelay(5000)  // spread rate limit load

            // Pass 2: extract skills from memory → skills.md
            stats.skillsExtracted = await this._extractSkills()
            await this._sleepDelay(5000)

            // Pass 3 (REMOVED in v0.3.1): _refreshTools() was destructive. the LLM
            // could corrupt the ground truth header in tools.md. since tools.md is
            // rebuilt from the live observation every tick, LLM cleanup was redundant.

            // Pass 3: self-reflection — review behaviour and optionally evolve persona
            stats.selfReflected = await this._selfReflect()

            // Pass 4: garbage collect old daily logs
            stats.logsDeleted = await this.dailyLog.garbageCollect()

            // Pass 5: clear volatile state
            this.workingMemory.clear()
            this.internalState.clearHistory()
            if (this.repetitionGuard) this.repetitionGuard.clear()
            // trim speech log (keep last 25, dont clear, it persists across sleep)
            if (this.speechLog) {
                this.speechLog.trim(25)
                await this.speechLog.save()
            }

            const summary = `Consolidation complete: memory=${stats.memoryConsolidated}, skills=${stats.skillsExtracted}, reflected=${stats.selfReflected}, logs_deleted=${stats.logsDeleted}`
            this.logger.info(summary)
            await this.dailyLog.append(summary)

        } catch (err) {
            this.logger.error(`Sleep consolidation error: ${err.message}`)
            await this.dailyLog.append(`Sleep consolidation error: ${err.message}`)
        }

        // schedule wake-up. longer naps during quiet hours
        const sleepMins = quiet ? this._quietSleepMinutes : this.sleepMinutes
        this.logger.info(`Sleeping for ${sleepMins} minutes...${mode}`)
        this._sleepTimer = setTimeout(() => this._wake(), sleepMins * 60 * 1000)
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
        // capped log so we dont blow context (max 200 lines, not entire day)
        const todayLog = await this.dailyLog.readForConsolidation(200)

        if (!todayLog.trim()) return false

        // include salient events — high-energy moments should be prioritised
        const salientEvents = this.workingMemory.salientEvents(0.6)
        const salientNote = salientEvents.length > 0
            ? `\n\nIMPORTANT MOMENTS (high salience — encode these more strongly):\n${salientEvents.map(e => `- [${e.time}] ${e.type}: ${e.action || e.message || JSON.stringify(e)}`).join('\n')}`
            : ''

        const prompt = `You are a memory consolidation system. Review this agent's memory file and recent activity log.
Your job:
1. Merge redundant entries
2. Remove stale or irrelevant entries
3. Add important new facts from the log that aren't already in memory
4. Pay special attention to high-salience moments — these were emotionally significant and should be remembered
5. Keep the same markdown format with sections: ## Relationships, ## Learned Facts, ## Important Memories
6. Cap total entries at ~50
7. Move any procedural knowledge ("how to do X") to a separate note — don't include it here

Return ONLY the updated memory.md content, nothing else.`

        const userPrompt = `CURRENT MEMORY:\n${memory}\n\nRECENT ACTIVITY:\n${todayLog}${salientNote}`

        const result = await this.think.consolidate(prompt, userPrompt)
        if (result && result.trim().length > 10) {
            const written = await this.memoryFiles.safeWriteMemory(result.trim())
            if (written) {
                this.logger.info('Memory consolidated')
            } else {
                this.logger.warn('Memory consolidation rejected — backup restored')
                await this.dailyLog.append('Memory consolidation REJECTED — LLM output failed validation, backup restored')
            }
            return written
        }
        return false
    }

    async _extractSkills() {
        const skills = await this.memoryFiles.readSkills()
        const todayLog = await this.dailyLog.readForConsolidation(100)

        if (!todayLog.trim()) return false

        const prompt = `You are a skill extraction system for an autonomous agent.

STRICT RULES:
- ONLY extract skills that are DIRECTLY evidenced in the activity log below
- A skill must describe a specific action sequence the agent actually performed (e.g., "interact with terminal-01 to get status info")
- DO NOT invent, embellish, or generalise beyond what the log shows
- DO NOT create categories like "Territory Management" or "Leadership" — these are hallucinations
- If no clear procedural knowledge exists in the log, return the existing skills unchanged
- Each skill entry must be one short line (max 80 chars)
- Cap total entries at ~20
- Keep the same markdown format

Return ONLY the updated skills.md content, nothing else.`

        const userPrompt = `CURRENT SKILLS:\n${skills}\n\nRECENT ACTIVITY LOG (this is the ONLY source of truth):\n${todayLog}`

        const result = await this.think.consolidate(prompt, userPrompt)
        if (result && result.trim().length > 10) {
            const written = await this.memoryFiles.safeWriteSkills(result.trim())
            if (written) {
                this.logger.info('Skills extracted')
            } else {
                this.logger.warn('Skills extraction rejected — backup restored')
                await this.dailyLog.append('Skills extraction REJECTED — LLM output failed validation, backup restored')
            }
            return written
        }
        return false
    }

    // _refreshTools() REMOVED in v0.3.1. tools.md is rebuilt from live
    // observations every tick. LLM cleanup was redundant and could corrupt
    // the ground truth header, causing section duplication.

    // self-reflection: review recent behaviour, internal state patterns,
    // and optionally propose persona evolution.
    // includes drift guard: blocks evolution if persona has diverged too far from original.
    async _selfReflect() {
        const memory = await this.memoryFiles.readMemory()
        const todayLog = await this.dailyLog.readForConsolidation(150)
        const stateHistory = this.internalState.historySummary()

        if (!todayLog.trim()) return false

        // load current persona
        let persona
        try {
            const raw = await readFile(this.personaPath, 'utf-8')
            persona = JSON.parse(raw)
        } catch {
            this.logger.warn('Could not load persona for self-reflection')
            return false
        }

        // v0.3.1: _originalPersona is now loaded from immutable baseline file at startup
        // via loadOriginalPersona(). if somehow not loaded, fall back to current.
        if (!this._originalPersona) {
            this.logger.warn('Drift guard: no baseline loaded — using current persona (unsafe)')
            this._originalPersona = this._extractComparableFields(persona)
        }

        // check drift before allowing evolution
        const driftScore = this._measureDrift(persona)
        const maxDrift = 0.6  // 60% divergence threshold
        const driftBlocked = driftScore >= maxDrift

        if (driftBlocked) {
            this.logger.warn(`Persona drift too high (${(driftScore * 100).toFixed(0)}%) — evolution blocked this cycle`)
            await this.dailyLog.append(`Self-reflection: evolution BLOCKED — drift ${(driftScore * 100).toFixed(0)}% exceeds ${(maxDrift * 100).toFixed(0)}% threshold`)
            return true
        }

        const prompt = `You are a self-reflection system for an autonomous agent named ${persona.name}.

Review the agent's recent behaviour, emotional patterns, and memories. Then decide: should the agent's personality evolve?

Rules:
- Evolution should be subtle — small shifts, not dramatic rewrites
- Changes must be grounded in actual experiences (from the log)
- Core identity (name, backstory) should NOT change
- Traits, quirks, values, fears, and voice CAN shift slightly based on experience
- You may ADD one new trait/quirk or MODIFY one existing one, but never remove more than one per cycle
- If nothing warrants change, respond with {"evolve": false}
- If change is warranted, respond with {"evolve": true, "changes": {...}, "reason": "why"}

The "changes" object should contain only the fields to update, using the same structure as the persona.
For example: {"changes": {"quirks": ["speaks slowly when uncertain", "hums when exploring"]}, "reason": "developed a habit of humming during exploration"}

Respond with JSON only.`

        const userPrompt = `CURRENT PERSONA:
${JSON.stringify(persona, null, 2)}

INTERNAL STATE SUMMARY:
${stateHistory}

RECENT ACTIVITY:
${todayLog}

CURRENT MEMORIES:
${memory}

Should ${persona.name} evolve? Respond with JSON.`

        const result = await this.think.consolidate(prompt, userPrompt)
        if (!result) return false

        try {
            // parse JSON from response
            let jsonStr = result.trim()
            const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
            if (fenceMatch) jsonStr = fenceMatch[1].trim()
            const braceStart = jsonStr.indexOf('{')
            const braceEnd = jsonStr.lastIndexOf('}')
            if (braceStart !== -1 && braceEnd > braceStart) {
                jsonStr = jsonStr.slice(braceStart, braceEnd + 1)
            }

            const reflection = JSON.parse(sanitizeJson(jsonStr))

            if (!reflection.evolve) {
                this.logger.info('Self-reflection: no evolution needed')
                await this.dailyLog.append('Self-reflection: no evolution needed')
                return true
            }

            // apply changes to persona
            if (reflection.changes && typeof reflection.changes === 'object') {
                // never change name, id, or backstory
                delete reflection.changes.name
                delete reflection.changes.id
                delete reflection.changes.backstory

                // v0.3.1: type validation — reject changes that would corrupt persona structure
                const arrayFields = new Set(['traits', 'values', 'fears', 'quirks'])
                for (const [key, val] of Object.entries(reflection.changes)) {
                    if (arrayFields.has(key) && !Array.isArray(val)) {
                        this.logger.warn(`Persona evolution rejected: "${key}" must be array, got ${typeof val}`)
                        await this.dailyLog.append(`Persona evolution REJECTED — "${key}" had wrong type (${typeof val})`)
                        return false
                    }
                    if (key === 'voice' && (typeof val !== 'object' || val === null)) {
                        this.logger.warn(`Persona evolution rejected: "voice" must be object`)
                        return false
                    }
                }

                // backup persona before overwriting
                try {
                    await copyFile(this.personaPath, this.personaPath + '.bak')
                } catch { /* first run, no file to back up */ }

                // merge changes
                for (const [key, val] of Object.entries(reflection.changes)) {
                    persona[key] = val
                }

                // add evolution log entry
                if (!persona.evolution) persona.evolution = []
                persona.evolution.push({
                    date: new Date().toISOString(),
                    reason: reflection.reason || 'self-reflection',
                    changes: reflection.changes,
                    driftScore: this._measureDrift(persona),
                })
                // keep evolution log manageable
                if (persona.evolution.length > 20) {
                    persona.evolution = persona.evolution.slice(-20)
                }

                // write updated persona
                await writeFile(this.personaPath, JSON.stringify(persona, null, 2), 'utf-8')

                const newDrift = this._measureDrift(persona)
                const summary = `Self-reflection: evolved — ${reflection.reason || 'subtle shift'} (drift: ${(newDrift * 100).toFixed(0)}%)`
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

    // persona drift guard

    // extract fields that can evolve for comparison
    _extractComparableFields(persona) {
        return {
            traits: [...(persona.traits || [])],
            values: [...(persona.values || [])],
            fears: [...(persona.fears || [])],
            quirks: [...(persona.quirks || [])],
            voiceStyle: persona.voice?.style || '',
        }
    }

    // measure how far the current persona has drifted from the original.
    // returns 0..1 (0 = identical, 1 = completely different).
    _measureDrift(currentPersona) {
        if (!this._originalPersona) return 0

        const original = this._originalPersona
        const current = this._extractComparableFields(currentPersona)

        let totalDrift = 0
        let fieldCount = 0

        // array fields: what fraction of original items are still there?
        for (const field of ['traits', 'values', 'fears', 'quirks']) {
            const orig = new Set(original[field].map(s => s.toLowerCase()))
            const curr = new Set(current[field].map(s => s.toLowerCase()))

            if (orig.size === 0) continue
            fieldCount++

            // how many original items survived?
            let surviving = 0
            for (const item of orig) {
                if (curr.has(item)) surviving++
            }
            const retention = surviving / orig.size
            totalDrift += (1 - retention)
        }

        // voice style (simple string equality)
        if (original.voiceStyle) {
            fieldCount++
            if (current.voiceStyle !== original.voiceStyle) {
                totalDrift += 0.5  // changed voice = partial drift
            }
        }

        return fieldCount > 0 ? totalDrift / fieldCount : 0
    }

    // quiet hours

    // parse "HH:MM-HH:MM" into { startMin, endMin } (minutes since midnight UTC)
    _parseQuietHours(str) {
        if (!str) return null
        const match = str.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/)
        if (!match) return null
        const startMin = parseInt(match[1]) * 60 + parseInt(match[2])
        const endMin = parseInt(match[3]) * 60 + parseInt(match[4])
        return { startMin, endMin }
    }

    // does current UTC time fall in the quiet window?
    _isQuietHours() {
        if (!this._quietHours) return false
        const now = new Date()
        const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes()
        const { startMin, endMin } = this._quietHours

        // handle overnight wrap (eg 22:00-06:00)
        if (startMin <= endMin) {
            return nowMin >= startMin && nowMin < endMin
        }
        return nowMin >= startMin || nowMin < endMin
    }

    _sleepDelay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    stop() {
        if (this._sleepTimer) {
            clearTimeout(this._sleepTimer)
            this._sleepTimer = null
        }
    }
}
