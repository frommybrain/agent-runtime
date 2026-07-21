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

/**
 * Re-seed pruned baseline entries for any evolvable array field that fell
 * below 60% of its original richness. The self-reflection merge replaces an
 * array field wholesale, so a small model returning a too-short list (e.g.
 * the one trait it meant to "modify") would hollow the personality out —
 * exactly how Victor collapsed from nine traits to one. Pure + exported so
 * it can be unit-tested in isolation.
 *
 * @param {object} persona          - persona being evolved (mutated in place)
 * @param {object} originalPersona  - immutable baseline (comparable fields)
 * @param {object} [logger]         - optional logger with .info()
 * @returns {object} the same persona, for chaining
 */
export function enforceRichnessFloor(persona, originalPersona, logger = null) {
    if (!originalPersona) return persona
    for (const field of ['traits', 'values', 'fears', 'quirks']) {
        const baseline = originalPersona[field] || []
        if (baseline.length === 0) continue
        const floor = Math.ceil(baseline.length * 0.6)
        const current = Array.isArray(persona[field]) ? persona[field] : []
        if (current.length >= floor) continue
        const have = new Set(current.map((s) => String(s).toLowerCase()))
        const reseeded = [...current]
        for (const item of baseline) {
            if (reseeded.length >= floor) break
            if (!have.has(String(item).toLowerCase())) {
                reseeded.push(item)
                logger?.info?.(`Drift guard: re-seeded ${field} "${item}" (richness floor ${reseeded.length}/${floor})`)
            }
        }
        persona[field] = reseeded
    }
    return persona
}

// --- evolution sanitizer helpers ---------------------------------------

const MOTIF_STOPWORDS = new Set([
    'the', 'and', 'but', 'for', 'not', 'was', 'are', 'with', 'that', 'this',
    'his', 'him', 'her', 'its', 'own', 'has', 'have', 'had', 'can', 'may',
    'when', 'than', 'then', 'them', 'they', 'from', 'into', 'over', 'out',
    'about', 'after', 'before', 'while', 'more', 'most', 'some', 'only',
    'often', 'sometimes', 'occasionally', 'small', 'things', 'himself',
])

function motifTokens(s) {
    const seen = new Set()
    for (const raw of String(s).toLowerCase().split(/[^a-z']+/)) {
        const w = raw.replace(/^'+|'+$/g, '')
        if (w.length >= 3 && !MOTIF_STOPWORDS.has(w)) seen.add(w)
    }
    return seen
}

function tokenJaccard(a, b) {
    if (a.size === 0 || b.size === 0) return 0
    let inter = 0
    for (const t of a) if (b.has(t)) inter++
    return inter / (a.size + b.size - inter)
}

// log-observation dressed as personality: "recognizes that X", "notes Y".
// anything OPENING with an epistemic verb is a diary line, not a
// disposition — real traits read "steps back when...", "quietly proud of..."
const OBSERVATION_RE = /^(recognizes|notes|realizes|understands|learns|acknowledges|accepts|observes|notices)\b/i

/**
 * Scrub a self-reflection's proposed array fields before they merge.
 * enforceRichnessFloor stops the persona hollowing OUT; this stops it
 * silting UP. Victor's hum spiral arrived as 46 separate "recognizes that
 * X eases the hum" entries — each an observation dressed as a trait, each
 * individually passing the drift check (drift measures loss of baseline,
 * so pure additions never trip it), until the character sheet WAS the
 * motif. Rules, per array field (traits/values/fears/quirks):
 *   1. baseline entries are canon — never dropped
 *   2. drop observation-shaped entries (see OBSERVATION_RE) and anything
 *      over 90 chars: traits are dispositions, short by nature
 *   3. drop exact and near duplicates (token jaccard >= 0.6 within field)
 *   4. motif ceiling: one content word may appear in at most 3 entries
 *      across the whole sheet; later entries carrying it drop
 *   5. hard cap per field: baseline size + 5 (8 if no baseline), keeping
 *      the head — existing entries lead the list in a honest reflection
 * Pure + exported so it can be unit-tested in isolation.
 *
 * @param {object} changes          - reflection.changes (mutated in place)
 * @param {object} persona          - current persona (for unchanged fields)
 * @param {object} originalPersona  - immutable baseline (comparable fields)
 * @param {object} [logger]         - optional logger with .info()
 * @returns {number} how many entries were dropped
 */
export function sanitizeEvolvedArrays(changes, persona, originalPersona, logger = null) {
    if (!changes || typeof changes !== 'object') return 0
    const fields = ['traits', 'values', 'fears', 'quirks']
    const wordCounts = new Map()  // content word -> entries kept containing it
    let dropped = 0

    const drop = (field, entry, why) => {
        dropped++
        logger?.info?.(`Evolution sanitizer: dropped ${field} entry (${why}): "${String(entry).slice(0, 80)}"`)
    }

    for (const field of fields) {
        const isProposed = Array.isArray(changes[field])
        // unchanged fields still walk through so their words seed the motif
        // counts, but nothing is judged or written back for them
        const proposed = isProposed
            ? changes[field]
            : Array.isArray(persona?.[field]) ? persona[field] : []
        const baseline = new Set(
            (originalPersona?.[field] || []).map((s) => String(s).trim().toLowerCase())
        )
        const cap = baseline.size > 0 ? baseline.size + 5 : 8

        const kept = []
        const keptTokens = []
        const seenExact = new Set()

        for (const rawEntry of proposed) {
            if (typeof rawEntry !== 'string' || !rawEntry.trim()) { if (isProposed) dropped++; continue }
            const entry = rawEntry.trim()
            const lower = entry.toLowerCase()
            const isCanon = baseline.has(lower) || !isProposed

            if (seenExact.has(lower)) { if (isProposed) drop(field, entry, 'duplicate'); continue }

            if (!isCanon) {
                if (OBSERVATION_RE.test(entry)) { drop(field, entry, 'observation-shaped'); continue }
                if (entry.length > 90) { drop(field, entry, 'over 90 chars'); continue }
            }

            const tokens = motifTokens(entry)

            if (!isCanon) {
                let nearDup = false
                for (const kt of keptTokens) {
                    if (tokenJaccard(tokens, kt) >= 0.6) { nearDup = true; break }
                }
                if (nearDup) { drop(field, entry, 'near-duplicate'); continue }

                let overMotif = null
                for (const t of tokens) {
                    if ((wordCounts.get(t) || 0) >= 3) { overMotif = t; break }
                }
                if (overMotif) { drop(field, entry, `motif ceiling "${overMotif}"`); continue }

                if (kept.length >= cap) { drop(field, entry, `field cap ${cap}`); continue }
            }

            kept.push(entry)
            keptTokens.push(tokens)
            seenExact.add(lower)
            for (const t of tokens) wordCounts.set(t, (wordCounts.get(t) || 0) + 1)
        }

        // only write back fields the reflection actually proposed
        if (Array.isArray(changes[field])) changes[field] = kept
    }
    return dropped
}

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

            // Pass 4: the desire layer — form, keep, or retire the ONE
            // thread that pulls at the agent across days. Needs but no
            // desires reads as a Tamagotchi; this is where wanting lives.
            stats.desireFormed = await this._formDesire()

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
            ? `\n\nWHAT HIT HARDEST TODAY (these landed with real feeling — let them shape what you keep):\n${salientEvents.map(e => `- [${e.time}] ${e.type}: ${e.action || e.message || JSON.stringify(e)}`).join('\n')}`
            : ''

        // Load persona so the consolidation is IN VOICE, not clinical. The
        // old "you are a memory consolidation system" framing produced a
        // strategy-wiki ("watch points are camera-like observers; food_apple
        // _tree reduces hunger") — accurate, lifeless, and full of entity
        // IDs. Memory should read like the bird's own private record.
        let pName = 'the agent', pVoice = ''
        try {
            const persona = JSON.parse(await readFile(this.personaPath, 'utf-8'))
            pName = persona.name || pName
            pVoice = persona.voice?.style || ''
        } catch { /* fall back to generic */ }

        const prompt = `You are ${pName}, lying in the dark at the end of the day, deciding what to keep. This is YOUR private memory — write it the way you actually think.${pVoice ? `\nYour voice: ${pVoice}` : ''}

Below is your current memory and a log of today. Rewrite your memory: fold today into it, drop what's gone stale, keep what matters. Write in FIRST PERSON, in your own voice.

How to write it:
- This is a felt record, not a database. "I keep going back to that one camera. It never blinks. I still don't know why, and I think that's the point." — NOT "watch points are camera-like observers that may emit cues."
- NEVER use entity IDs (food_apple_tree, watch_8, activity_rave). Call things what they are: the apple tree, a camera, the rave, the roost, the shrine.
- NEVER quote stats or percentages. You remember feelings and moments, not numbers.
- Keep the relationships / facts / important-memories you'd actually carry. A fact can still be honest ("the apple tree's fruit comes with a little melody — it's the closest thing to music when the world goes quiet") without being a stat line.
- Prioritise what hit hardest today. Let routine fade.
- If today added nothing genuinely new — the same routine you already remember, nothing that actually moved you — then don't churn this file rewriting what's already here. Reply with the single token NO_CHANGE (nothing else) and I'll keep my memory exactly as it is. Only do this when today truly held nothing worth keeping.
- Keep the three markdown sections: ## Relationships, ## Learned Facts, ## Important Memories. Cap around 40 entries total. Keep procedural how-to OUT of here.

Return ONLY the updated memory.md content (or the single token NO_CHANGE), nothing else.`

        const userPrompt = `MY MEMORY SO FAR:\n${memory}\n\nTODAY:\n${todayLog}${salientNote}`

        const result = await this.think.consolidate(prompt, userPrompt, 60000, false) // markdown output

        // Quiet-day escape: if nothing new happened, the model can decline to
        // rewrite rather than churn the file into paraphrased slop. Precise
        // match on a short standalone token so a real memory that mentions
        // "no change" in passing can't trip it.
        const trimmedResult = (result || '').trim()
        if (trimmedResult.length <= 12 && /^no[_\s-]?change$/i.test(trimmedResult)) {
            this.logger.info('Memory consolidation: quiet day — left memory unchanged')
            await this.dailyLog.append('Memory consolidation: quiet day, left memory unchanged')
            return false
        }

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

        const prompt = `These are the things you've gotten the hang of — written in your own voice, the way you'd note "I know how to do this now."

STRICT RULES:
- ONLY note things DIRECTLY evidenced in the log below. Don't invent or generalise. Don't make up grand categories ("Territory Management") — those are hallucinations.
- Write each as one short line in FIRST PERSON, no entity IDs. "When the hunger really bites, the apple tree is the surest fix" — NOT "forage food_apple_tree". "I can usually coax a little music out of the rave when the world's gone quiet" — NOT "go_rave activity_rave".
- No stats, no numbers, no IDs. Ever.
- If the log shows nothing genuinely new, return the existing list unchanged.
- One line each, max ~90 chars. Cap ~15 entries. Keep it a simple markdown bullet list.

Return ONLY the updated skills.md content, nothing else.`

        const userPrompt = `WHAT I KNOW HOW TO DO SO FAR:\n${skills}\n\nTODAY (the only source of truth):\n${todayLog}`

        const result = await this.think.consolidate(prompt, userPrompt, 60000, false) // markdown output
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
- Evolution should be subtle, and should reflect the BREADTH of recent experience — not a single fixation. A rich, varied stretch (many kinds of activity, different places, real encounters) can warrant a small shift. A narrow, repetitive stretch should NOT: respond with {"evolve": false}.
- Changes must be grounded in actual experiences (from the log).
- Core identity (name, backstory) must NOT change.
- GROW, don't narrow. You may ADD a trait/quirk, or MODIFY the wording of an existing one. Do NOT prune the personality down to only what showed up today — a trait left unused is dormant, not gone. Only remove a trait if recent experience actively CONTRADICTS it, and never more than one per cycle.
- When you change an array field (traits, quirks, values, fears), you MUST return the COMPLETE updated list, including every existing entry you are keeping. The list replaces the old one wholesale, so returning only the new item would ERASE everything else.
- If nothing warrants change, respond with {"evolve": false}.
- If change is warranted, respond with {"evolve": true, "changes": {...}, "reason": "why"}.

The "changes" object contains the FULL fields to update, using the same structure as the persona.
For example, to add one quirk you still return ALL quirks: {"changes": {"quirks": ["speaks slowly when uncertain", "goes quiet near water", "hums when exploring"]}, "reason": "started humming while exploring — kept the rest"}

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

                // scrub silt before the merge: observation-shaped entries,
                // dupes, motif pile-ups, over-cap growth. the richness floor
                // below guards the opposite failure (hollowing out).
                const scrubbed = sanitizeEvolvedArrays(reflection.changes, persona, this._originalPersona, this.logger)
                if (scrubbed > 0) {
                    await this.dailyLog.append(`Self-reflection: sanitizer dropped ${scrubbed} proposed entries (observations/dupes/motif ceiling/cap)`)
                }

                // backup persona before overwriting
                try {
                    await copyFile(this.personaPath, this.personaPath + '.bak')
                } catch { /* first run, no file to back up */ }

                // merge changes
                for (const [key, val] of Object.entries(reflection.changes)) {
                    persona[key] = val
                }

                // RICHNESS FLOOR: the merge above replaces an array field
                // wholesale, so a too-short list from the model would hollow
                // the personality out (nine traits → one). Re-seed pruned
                // baseline entries for anything that fell below 60% richness.
                enforceRichnessFloor(persona, this._originalPersona, this.logger)

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

    // the desire layer: distill ONE current thread — a want with direction,
    // grounded in the day — that persists across days in the decision
    // prompt. Kept small on purpose: one thread, plain sentence, first
    // person. The LLM may keep, replace, or retire it each sleep.
    async _formDesire() {
        const todayLog = await this.dailyLog.readForConsolidation(80)
        if (!todayLog.trim()) return false

        const existing = await this.memoryFiles.readCurrentThread()
        const memory = await this.memoryFiles.readMemory()
        const memTail = memory.split('\n').filter(l => l.startsWith('- ')).slice(-8).join('\n')

        let pName = 'the agent'
        try {
            const persona = JSON.parse(await readFile(this.personaPath, 'utf-8'))
            pName = persona.name || pName
        } catch { /* generic */ }

        const prompt = `You are ${pName}, drifting at the edge of sleep, feeling for what's pulling at you.

A "thread" is the ONE thing currently tugging you across days — a want with direction, not a task. Good threads come from real experience: something you keep circling, a question that won't settle, a place or thing you want more of. ("I want to find where the music actually comes from." / "The garden — I want to see it bloom once, properly.")

Rules:
- ONE thread only, first person, one plain sentence, max 20 words.
- It must be GROUNDED in the day's log or your memories — never invented from nothing.
- If the current thread still pulls, KEEP it (don't churn).
- If today resolved it or it's gone quiet, RETIRE it (thread: null) or REPLACE it.
- Respond with JSON only: {"action": "keep" | "replace" | "retire", "thread": "<sentence or null>", "reason": "<short why>"}`

        const userPrompt = `CURRENT THREAD: ${existing?.text ? `"${existing.text}" (since ${existing.formedAt || 'recently'})` : '(none — nothing has been pulling at you)'}

TODAY:
${todayLog}

RECENT MEMORY:
${memTail || '(little so far)'}

What pulls at ${pName} now? JSON only.`

        const result = await this.think.consolidate(prompt, userPrompt, 45000)
        if (!result) return false

        try {
            let jsonStr = result.trim()
            const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
            if (fence) jsonStr = fence[1].trim()
            const s = jsonStr.indexOf('{'); const e = jsonStr.lastIndexOf('}')
            if (s !== -1 && e > s) jsonStr = jsonStr.slice(s, e + 1)
            const parsed = JSON.parse(sanitizeJson(jsonStr))

            const now = new Date().toISOString()
            if (parsed.action === 'retire' || !parsed.thread) {
                if (existing) {
                    await this.memoryFiles.writeCurrentThread(null)
                    await this.dailyLog.append(`Thread retired: ${parsed.reason || 'it let go'}`)
                    this.logger.info(`Desire retired: ${parsed.reason || ''}`)
                }
                return true
            }
            const text = String(parsed.thread).trim().slice(0, 160)
            if (parsed.action === 'keep' && existing?.text) {
                // keep as-is; refresh updatedAt so we can see it's alive
                await this.memoryFiles.writeCurrentThread({ ...existing, updatedAt: now })
                return true
            }
            await this.memoryFiles.writeCurrentThread({ text, formedAt: existing?.text === text ? existing.formedAt : now, updatedAt: now })
            await this.dailyLog.append(`A thread pulls: "${text}" — ${parsed.reason || ''}`)
            this.logger.info(`Desire formed: "${text}"`)
            return true
        } catch (err) {
            this.logger.warn(`Desire parse error: ${err.message}`)
            return false
        }
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
