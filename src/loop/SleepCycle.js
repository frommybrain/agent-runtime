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
import { stem } from '../util/wornWords.js'
import { bannedIn, bannedWords, subjectTokens } from '../util/record.js'

import { readFile, writeFile, copyFile } from 'node:fs/promises'

/**
 * The authored sheet is a floor, not just a ceiling: every baseline entry
 * must be present after an evolution, full stop.
 *
 * This began as a 60% richness floor, which stopped the catastrophic case
 * (nine traits collapsing to one) and waved through the slow one: the merge
 * replaces an array wholesale, so a model that quietly omits one authored
 * quirk deletes it, one per cycle, under the drift guard's radar, because
 * drift additions were blocked at the cap while deletions sailed. The quirk
 * it chose to drop was the reckless coin-flip one, the single entry that
 * makes him fun, while logging a reason about calm water. Sanitize already
 * says "baseline entries are canon, never dropped", but it can only judge
 * what the model RETURNS; an omission never reaches it. So canon is
 * enforced here, on the merged sheet, where an omission is visible.
 * Evolved (grown) entries remain removable; the authored ones are not the
 * model's to delete. Pure + exported so it can be unit-tested in isolation.
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
        const current = Array.isArray(persona[field]) ? persona[field] : []
        const have = new Set(current.map((s) => String(s).toLowerCase()))
        const missing = baseline.filter((item) => !have.has(String(item).toLowerCase()))
        if (missing.length === 0) continue
        let merged = [...current, ...missing]
        for (const item of missing) {
            logger?.info?.(`Drift guard: restored authored ${field} entry "${String(item).slice(0, 70)}"`)
        }
        // Restoring onto a full list must not breach the cap this guard
        // exists to protect (12 traits shipped that way once, three of
        // them arguing for the same fixation). Authored entries always
        // stay; evolved ones are trimmed oldest-first-kept, so the newest
        // additions, the ones drift just made, are what give way.
        const cap = baseline.length + 2
        if (merged.length > cap) {
            const authoredSet = new Set(baseline.map((s) => String(s).toLowerCase()))
            const authored = merged.filter((s) => authoredSet.has(String(s).toLowerCase()))
            const evolved = merged.filter((s) => !authoredSet.has(String(s).toLowerCase()))
            const keep = Math.max(0, cap - authored.length)
            for (const item of evolved.slice(keep)) {
                logger?.info?.(`Drift guard: trimmed evolved ${field} entry over cap "${String(item).slice(0, 70)}"`)
            }
            merged = [...authored, ...evolved.slice(0, keep)]
        }
        persona[field] = merged
    }
    return persona
}

/**
 * When the character sheet last actually changed, or null if it never has.
 *
 * Entries are written with `date`, and the caller used to read `at`, so
 * Date.parse('') came back NaN for every entry, nothing looked finite, and
 * the minimum-gap check silently never applied. The sheet was reconsidered
 * every sleep instead of twice a day. Both spellings are read because old
 * logs are already on disk.
 *
 * @param {object} persona
 * @returns {number|null} epoch ms
 */
export function lastEvolutionAt(persona) {
    const found = [...(persona?.evolution || [])].reverse()
        .map((e) => Date.parse(e?.date || e?.at || ''))
        .find((t) => Number.isFinite(t))
    return found ?? null
}

// --- evolution sanitizer helpers ---------------------------------------

const MOTIF_STOPWORDS = new Set([
    'the', 'and', 'but', 'for', 'not', 'was', 'are', 'with', 'that', 'this',
    'his', 'him', 'her', 'its', 'own', 'has', 'have', 'had', 'can', 'may',
    'when', 'than', 'then', 'them', 'they', 'from', 'into', 'over', 'out',
    'about', 'after', 'before', 'while', 'more', 'most', 'some', 'only',
    'often', 'sometimes', 'occasionally', 'small', 'things', 'himself',
    // frame verbs: structural, not thematic. The frame check below counts
    // these properly, and leaving them in made "find" register as a motif.
    'find', 'finds', 'seek', 'seeks', 'draw', 'draws', 'drawn', 'brief',
])

function motifTokens(s) {
    const seen = new Set()
    for (const raw of String(s).toLowerCase().split(/[^a-z']+/)) {
        const w = raw.replace(/^'+|'+$/g, '')
        if (w.length >= 3 && !MOTIF_STOPWORDS.has(w)) seen.add(stem(w))
    }
    return seen
}

// The shape of an entry, not its words.
//
// Token overlap cannot see what was actually wrong with his sheet: "finds
// calm in water's ripple", "finds brief lift in warm air", "finds brief
// focus in warm mechanical hums" and "seeks fleeting sparks in mundane
// environments" share almost no content words, so every pairwise jaccard
// was around 0.1, yet they are plainly one idea written four times. They
// are all <verb> <sensation> in <ambient thing>. A disposition says what he
// DOES; these say what he likes the feel of, which is a diary entry wearing
// a trait's clothes.
//
// So entries are also bucketed by frame, and a frame may appear at most
// twice among the additions.
const FRAME_VERBS = /^(finds?|seeks?|draws?|drawn|attuned|soothed|comforted|calmed|steadied|settled|lifted|grounded|takes? comfort|likes? the)\b/i
const FRAME_TAIL = /\b(in|by|when|among|through|from)\b/

// Every one of these is ONE frame, whichever verb opens it. Bucketing per
// verb was useless: "finds calm in X", "seeks sparks in Y" and "attuned to
// Z" are the same move, and he had four of them. A couple of sensory
// affinities is character; five is a tic.
function entryFrame(entry) {
    const e = String(entry).trim().toLowerCase()
    if (!FRAME_VERBS.test(e)) return null
    return FRAME_TAIL.test(e) ? 'sensory-affinity' : 'sensory-affinity-bare'
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

// How many kept entries may carry the same stemmed content word, and how
// many may share a sentence shape. Both are counted across the whole sheet.
const MOTIF_CEILING = 2
const FRAME_CEILING = 2

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
 *   5. hard cap per field: baseline size + 2 (8 if no baseline), keeping
 *      the head, since existing entries lead the list in an honest
 *      reflection. This is the load-bearing rule: rules 2 to 4 are all
 *      lexical and a model varies wording faster than we can enumerate it,
 *      so the count is the only limit that cannot be worded around.
 * Pure + exported so it can be unit-tested in isolation.
 *
 * @param {object} changes          - reflection.changes (mutated in place)
 * @param {object} persona          - current persona (for unchanged fields)
 * @param {object} originalPersona  - immutable baseline (comparable fields)
 * @param {object} [logger]         - optional logger with .info()
 * @param {string[]} [banned]       - words the voice rules forbid. baseline
 *   entries are exempt: the authored sheet is allowed to say whatever it
 *   says, and "just past the edge of things" is one of his real values.
 *   This only stops the reflection WRITING new ones, which is how "resourceful
 *   use of varied experiences to break flatness" got onto the sheet.
 * @returns {number} how many entries were dropped
 */
export function sanitizeEvolvedArrays(changes, persona, originalPersona, logger = null, banned = [], barredStems = null) {
    if (!changes || typeof changes !== 'object') return 0
    const fields = ['traits', 'values', 'fears', 'quirks']
    const wordCounts = new Map()  // content word -> entries kept containing it
    const frameCounts = new Map() // entry shape -> entries kept using it
    let dropped = 0

    const drop = (field, entry, why) => {
        dropped++
        logger?.info?.(`Evolution sanitizer: dropped ${field} entry (${why}): "${String(entry).slice(0, 80)}"`)
    }

    const _retiredHit = (text, stems) => {
        if (!stems?.size) return null
        for (const t of subjectTokens(text)) if (stems.has(t)) return t
        return null
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
        // Headroom above the authored sheet. Was +5, and it let seven
        // versions of one trait onto Victor's: "finds calm in water's
        // ripple", "attuned to subtle rhythms in mundane hums", "finds
        // brief clarity from coffee aroma", "is fascinated by
        // bioluminescent beetles", "feels a spark from neon lights",
        // "finds momentary spark from flickering bar lights", "uses
        // sensory spikes to reset focus". All one trait, worded seven ways.
        //
        // The frame check below caught two of them and the other five
        // walked past it, because "attuned to" and "is fascinated by" and
        // "uses" are not in FRAME_VERBS. Widening that list is the same
        // losing game as banning "the edge" and getting "the whisper": the
        // model varies the wording faster than we can enumerate it, and a
        // lexical guard cannot see that seven sentences mean one thing.
        //
        // So the cap is the real defence, because it does not care how
        // something is phrased. Two slots of headroom is enough to grow
        // into and far too few to build a monoculture in.
        const cap = baseline.size > 0 ? baseline.size + 2 : 8

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
                const hits = bannedIn(entry, banned)
                if (hits.length > 0) { drop(field, entry, `banned word "${hits[0]}"`); continue }
                // A subject he was forced to let go cannot come back as a
                // disposition. The glow was retired as a thread and scrubbed
                // from memory on 13 Aug, and the next morning this writer
                // put it back as a quirk, from which it started steering
                // decisions again. The thread bar was never going to hold
                // while the persona had its own door.
                const retired = _retiredHit(entry, barredStems)
                if (retired) { drop(field, entry, `retired subject "${retired}"`); continue }
            }

            const tokens = motifTokens(entry)

            if (!isCanon) {
                let nearDup = false
                for (const kt of keptTokens) {
                    if (tokenJaccard(tokens, kt) >= 0.6) { nearDup = true; break }
                }
                if (nearDup) { drop(field, entry, 'near-duplicate'); continue }

                // Ceiling of 3 was too generous against a cap of +5: it let
                // a single motif own most of everything he had grown.
                let overMotif = null
                for (const t of tokens) {
                    if ((wordCounts.get(t) || 0) >= MOTIF_CEILING) { overMotif = t; break }
                }
                if (overMotif) { drop(field, entry, `motif ceiling "${overMotif}"`); continue }

                const frame = entryFrame(entry)
                if (frame) {
                    const n = frameCounts.get(frame) || 0
                    if (n >= FRAME_CEILING) { drop(field, entry, `same shape as ${n} others`); continue }
                    frameCounts.set(frame, n + 1)
                }

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

        // Keep the whole config. The fields below are the long-standing
        // shorthands; anything added later (persona evolution interval,
        // thread expiry) reads through this.config, and three of those
        // shipped today as reads on `undefined` because it was never
        // stored. That threw inside the sleep pass every cycle:
        //   "Sleep consolidation error: Cannot read properties of
        //    undefined (reading 'personaEvolutionMinHours')"
        // so both features were dead AND they were taking consolidation
        // down with them.
        this.config = config || {}

        this.activeHours = config.activeHoursBeforeSleep
        this.sleepMinutes = config.sleepDurationMinutes
        this.personaPath = config.personaPath
        this.dataDir = config.dataDir
        this.sleeping = false

        // quiet hours, reduced activity during low-viewership windows
        this._quietHours = this._parseQuietHours(config.quietHours)
        this._quietActiveMinutes = config.quietActiveMinutes || 15
        this._quietSleepMinutes = config.quietSleepMinutes || 30

        this._wakeTime = Date.now()
        this._sleepTimer = null
        this._originalPersona = null  // loaded from immutable baseline file
        // reasons the last few proposals were dropped, shown back to the
        // reflection so it stops re-making a change the guards will eat
        this._declinedProposals = []
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
            // Canon repair at boot. The floor at evolution time stops NEW
            // deletions; anything already lost before the floor existed
            // would stay lost until the model happened to evolve again, so
            // the check runs here too, against the sheet we just woke with.
            // Written back to disk when something was missing, because the
            // hourly persona sync reads the FILE, not this process.
            const before = JSON.stringify(currentPersona)
            enforceRichnessFloor(currentPersona, this._originalPersona, this.logger)
            if (this.personaPath && JSON.stringify(currentPersona) !== before) {
                try { await writeFile(this.personaPath, JSON.stringify(currentPersona, null, 2), 'utf-8') } catch { /* next evolution writes it */ }
            }
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

    // called each heartbeat tick to check if its time to sleep.
    //
    // worldClock, when the host world sends one, is { hour, is_night, day }.
    // Without it this falls back to the old real-time timer, so a runtime
    // hosted somewhere with no day/night keeps working exactly as before.
    //
    // WHY THE TIMER WAS WRONG. It slept after fifty real minutes and stayed
    // down for ten. In 3eyes one of his days is exactly one real hour, so
    // sixty on sixty is phase-locked: the pause landed at the same world
    // hour every single day, and that hour was the middle of his afternoon.
    // Sam kept finding him asleep in daylight because it was never once
    // anywhere else. Measured from the log, the consolidation WORK takes
    // about fifteen seconds; the other nine and three quarter minutes were
    // an arbitrary rest.
    //
    // So: consolidate at night, once per night, and be awake for his whole
    // day. The world already puts him in a nest while the brain is away
    // (see advanceSleepCycle in the sim), so the two finally mean the same
    // thing instead of contradicting each other.
    checkSleepTime(worldClock = null) {
        if (this.sleeping) return

        if (worldClock && typeof worldClock.hour === 'number') {
            this._lastWorldClock = worldClock
            if (!worldClock.is_night) return
            // Once a night. `day` is which of his days it is, so a night
            // that straddles midnight still counts as the one night.
            const nightId = worldClock.hour < 12 ? worldClock.day - 1 : worldClock.day
            if (this._lastNightSlept === nightId) return
            // Don't consolidate thirty seconds after waking from the last
            // one: a restart mid-night would otherwise fire immediately.
            if (Date.now() - this._wakeTime < 60_000) return
            this._lastNightSlept = nightId
            this._startSleep(false)
            return
        }

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

        // Schedule wake-up.
        //
        // With a world clock, sleep until his morning: the host tells us
        // how many real seconds are left of his night, because it is the
        // only side that knows both where he is in the day and how long one
        // of his days lasts. Being down for his whole night is the point,
        // not a cost: the world puts him in a nest meanwhile, so the brain
        // being away and the bird being asleep finally describe the same
        // thing. Bounded either side so a bad clock cannot strand him.
        const wc = this._lastWorldClock
        let sleepMs
        if (wc && typeof wc.night_ends_in_sec === 'number' && wc.night_ends_in_sec > 0) {
            sleepMs = Math.min(Math.max(wc.night_ends_in_sec, 60), 2 * 60 * 60) * 1000
            this.logger.info(`Sleeping until his morning, ${Math.round(sleepMs / 60000)} minutes...${mode}`)
        } else {
            const sleepMins = quiet ? this._quietSleepMinutes : this.sleepMinutes
            sleepMs = sleepMins * 60 * 1000
            this.logger.info(`Sleeping for ${sleepMins} minutes...${mode}`)
        }
        this._sleepTimer = setTimeout(() => this._wake(), sleepMs)
    }

    _wake() {
        this.sleeping = false
        this._wakeTime = Date.now()
        this._sleepTimer = null
        this.logger.info('=== SLEEP ENDED ===')
        this.dailyLog.append('=== SLEEP ENDED ===')
        this.workingMemory.push({ type: 'sleep', message: 'SLEEP ENDED, feeling refreshed' })
    }

    async _consolidateMemory() {
        const memory = await this.memoryFiles.readMemory()
        // capped log so we dont blow context (max 200 lines, not entire day)
        const todayLog = await this.dailyLog.readForConsolidation(200)

        if (!todayLog.trim()) return false

        // include salient events — high-energy moments should be prioritised
        const salientEvents = this.workingMemory.salientEvents(0.6)
        const salientNote = salientEvents.length > 0
            ? `\n\nWHAT HIT HARDEST TODAY (these landed with real feeling, let them shape what you keep):\n${salientEvents.map(e => `- [${e.time}] ${e.type}: ${e.action || e.message || JSON.stringify(e)}`).join('\n')}`
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

        const prompt = `You are ${pName}, lying in the dark at the end of the day, deciding what to keep. This is YOUR private memory, write it the way you actually think.${pVoice ? `\nYour voice: ${pVoice}` : ''}

Below is your current memory and a log of today. Rewrite your memory: fold today into it, drop what's gone stale, keep what matters. Write in FIRST PERSON, in your own voice.

How to write it:
- This is a felt record, not a database. "I keep going back to that one camera. It never blinks. I still don't know why, and I think that's the point.", NOT "watch points are camera-like observers that may emit cues."
- NEVER use entity IDs (food_apple_tree, watch_8, activity_rave). Call things what they are: the apple tree, a camera, the rave, the roost, the shrine.
- NEVER quote stats or percentages. You remember feelings and moments, not numbers.
- Keep the relationships / facts / important-memories you'd actually carry. A fact can still be honest ("the apple tree's fruit comes with a little melody, it's the closest thing to music when the world goes quiet") without being a stat line.
- Prioritise what hit hardest today. Let routine fade.
- If today added nothing genuinely new, the same routine you already remember, nothing that actually moved you, then don't churn this file rewriting what's already here. Reply with the single token NO_CHANGE (nothing else) and I'll keep my memory exactly as it is. Only do this when today truly held nothing worth keeping.
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
            this.logger.info('Memory consolidation: quiet day, left memory unchanged')
            await this.dailyLog.append('Memory consolidation: quiet day, left memory unchanged')
            return false
        }

        if (result && result.trim().length > 10) {
            const written = await this.memoryFiles.safeWriteMemory(result.trim())
            if (written) {
                this.logger.info('Memory consolidated')
            } else {
                this.logger.warn('Memory consolidation rejected, backup restored')
                await this.dailyLog.append('Memory consolidation REJECTED, LLM output failed validation, backup restored')
            }
            return written
        }
        return false
    }

    async _extractSkills() {
        const skills = await this.memoryFiles.readSkills()
        const todayLog = await this.dailyLog.readForConsolidation(100)

        if (!todayLog.trim()) return false

        const prompt = `These are the things you've gotten the hang of, written in your own voice, the way you'd note "I know how to do this now."

STRICT RULES:
- ONLY note things DIRECTLY evidenced in the log below. Don't invent or generalise. Don't make up grand categories ("Territory Management"), those are hallucinations.
- Write each as one short line in FIRST PERSON, no entity IDs. "When the hunger really bites, the apple tree is the surest fix", NOT "forage food_apple_tree". "I can usually coax a little music out of the rave when the world's gone quiet", NOT "go_rave activity_rave".
- No stats, no numbers, no IDs. Ever.
- If the log shows nothing genuinely new, return the existing list unchanged.
- One line each, max ~90 chars. Cap ~15 entries. Keep it a simple markdown bullet list.
- START with the same "# ..." heading line the list above already has, then the bullets.

Return ONLY the updated skills.md content, nothing else.`

        const userPrompt = `WHAT I KNOW HOW TO DO SO FAR:\n${skills}\n\nTODAY (the only source of truth):\n${todayLog}`

        const result = await this.think.consolidate(prompt, userPrompt, 60000, false) // markdown output
        if (result && result.trim().length > 10) {
            const written = await this.memoryFiles.safeWriteSkills(result.trim())
            if (written) {
                this.logger.info('Skills extracted')
            } else {
                this.logger.warn('Skills extraction rejected, backup restored')
                await this.dailyLog.append('Skills extraction REJECTED, LLM output failed validation, backup restored')
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

        // Identity changes on its own clock, not the sleep clock. Sleep is
        // hourly because memory should be consolidated while the day is
        // still fresh; running the character sheet at that rate gave 24
        // chances a day to rewrite him, and produced seven versions of one
        // trait in a single night. This does not skip a reflection, it
        // defers it to the next eligible sleep.
        //
        // The clock is read from the persona's own evolution log rather than
        // kept in a new state file, so it survives a restart. That matters:
        // the service restarts often enough that an in-memory timestamp
        // would hand back a free reflection every time.
        const minGapMs = (this.config.personaEvolutionMinHours || 0) * 3600 * 1000
        if (minGapMs > 0) {
            const lastAt = lastEvolutionAt(persona)
            if (lastAt) {
                const waited = Date.now() - lastAt
                if (waited < minGapMs) {
                    this.logger.info(
                        `Self-reflection: deferred, ${(waited / 3600000).toFixed(1)}h since the last one, needs ${this.config.personaEvolutionMinHours}h`,
                    )
                    return false
                }
            }
        }

        // v0.3.1: _originalPersona is now loaded from immutable baseline file at startup
        // via loadOriginalPersona(). if somehow not loaded, fall back to current.
        if (!this._originalPersona) {
            this.logger.warn('Drift guard: no baseline loaded, using current persona (unsafe)')
            this._originalPersona = this._extractComparableFields(persona)
        }

        // check drift before allowing evolution
        const driftScore = this._measureDrift(persona)
        const maxDrift = 0.6  // 60% divergence threshold
        const driftBlocked = driftScore >= maxDrift

        if (driftBlocked) {
            this.logger.warn(`Persona drift too high (${(driftScore * 100).toFixed(0)}%), evolution blocked this cycle`)
            await this.dailyLog.append(`Self-reflection: evolution BLOCKED, drift ${(driftScore * 100).toFixed(0)}% exceeds ${(maxDrift * 100).toFixed(0)}% threshold`)
            return true
        }

        const prompt = `You are a self-reflection system for an autonomous agent named ${persona.name}.

Review the agent's recent behaviour, emotional patterns, and memories. Then decide: should the agent's personality evolve?

Rules:
- Evolution should be subtle, and should reflect the BREADTH of recent experience, not a single fixation. A rich, varied stretch (many kinds of activity, different places, real encounters) can warrant a small shift. A narrow, repetitive stretch should NOT: respond with {"evolve": false}.
- Changes must be grounded in actual experiences (from the log).
- Core identity (name, backstory) must NOT change.
- GROW, don't narrow, but the sheet does not get longer. You have room for about two entries beyond the ones you started with, so prefer MODIFYING the wording of an existing trait/quirk, or swapping one out, over piling another on. Do NOT prune the personality down to only what showed up today, a trait left unused is dormant, not gone. Only remove a trait if recent experience actively CONTRADICTS it, and never more than one per cycle.
- When you change an array field (traits, quirks, values, fears), you MUST return the COMPLETE updated list, including every existing entry you are keeping. The list replaces the old one wholesale, so returning only the new item would ERASE everything else.
- If nothing warrants change, respond with {"evolve": false}.
- If change is warranted, respond with {"evolve": true, "changes": {...}, "reason": "why"}.

The "changes" object contains the FULL fields to update, using the same structure as the persona.
For example, to add one quirk you still return ALL quirks: {"changes": {"quirks": ["speaks slowly when uncertain", "goes quiet near water", "hums when exploring"]}, "reason": "started humming while exploring, kept the rest"}

Respond with JSON only.`

        // The evolution log used to ride along inside the persona here, all
        // twenty entries of it. Nine of Victor's twelve said "warranting the
        // subtle addition of a resourceful trait" and carried a byte-identical
        // trait list, because the model was reading its own past proposals and
        // making them again. The current sheet already says what he is; the
        // log only ever taught him to repeat himself.
        const { evolution, ...sheet } = persona
        const declined = this._declinedProposals.length > 0
            ? `\n\nALREADY CONSIDERED AND DECLINED (do not propose these again, they did not survive the guards):\n${this._declinedProposals.map((r) => `- ${r}`).join('\n')}`
            : ''

        const userPrompt = `CURRENT PERSONA:
${JSON.stringify(sheet, null, 2)}${declined}

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
                        await this.dailyLog.append(`Persona evolution REJECTED, "${key}" had wrong type (${typeof val})`)
                        return false
                    }
                    // voice.style is not his to rewrite.
                    //
                    // It was the only field the nightly evolution could edit
                    // freely: the sanitizer covers traits, values, fears and
                    // quirks, and voice was checked for TYPE and nothing
                    // else. It had drifted from the authored "plain, dry,
                    // short complete sentences anyone instantly understands,
                    // never twisted language, a sharp friend texting you, not
                    // a poet" to "sparse, fragmentary, like he's listening to
                    // something else under the surface, plays loose with
                    // grammar, thinks in fragments".
                    //
                    // Every rule added to make him concrete was arguing with
                    // that line, and losing, because it sits in the persona
                    // block above them. How he SOUNDS is authored. What he
                    // notices and cares about is his.
                    if (key === 'voice') {
                        this.logger.info('Persona evolution: ignoring a proposed voice change, voice.style is authored')
                        delete reflection.changes.voice
                        continue
                    }
                }

                // scrub silt before the merge: observation-shaped entries,
                // dupes, motif pile-ups, over-cap growth. the richness floor
                // below guards the opposite failure (hollowing out).
                // Subjects retired from the desire layer are barred here too,
                // for the same window: the thread bar and the persona writer
                // have to agree, or letting go of something only moves it.
                let barredStems = null
                try {
                    const retired = (await this.memoryFiles.readRetiredThreads())
                        .filter((r) => (Date.now() - new Date(r.at).getTime()) / 86400000 < 6)
                    if (retired.length) {
                        barredStems = new Set()
                        for (const r of retired) for (const t of subjectTokens(r.text)) barredStems.add(t)
                    }
                } catch { /* no bar is the old behaviour */ }

                const scrubbed = sanitizeEvolvedArrays(reflection.changes, persona, this._originalPersona, this.logger, bannedWords(persona), barredStems)
                if (scrubbed > 0) {
                    await this.dailyLog.append(`Self-reflection: sanitizer dropped ${scrubbed} proposed entries (observations/dupes/motif ceiling/cap)`)
                }

                // What the sheet looked like before, so we can tell an actual
                // change from a proposal the guards ate.
                const before = JSON.stringify(this._extractComparableFields(persona))

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
                // the personality out (nine traits to one). Re-seed pruned
                // baseline entries for anything that fell below 60% richness.
                enforceRichnessFloor(persona, this._originalPersona, this.logger)

                // Nothing actually moved.
                //
                // Once traits sat at the cap the sanitizer dropped every new
                // one, so the merge put back exactly what was already there.
                // The old code still logged "evolved", still appended an
                // evolution entry claiming a change, and still rewrote the
                // file: nine of twelve entries on 11 Aug were this, each one
                // a record of something that did not happen. Say so instead,
                // keep the reason so the next pass knows not to bother, and
                // leave the file alone.
                if (JSON.stringify(this._extractComparableFields(persona)) === before) {
                    const why = reflection.reason || 'no reason given'
                    this._declinedProposals.push(why)
                    if (this._declinedProposals.length > 5) this._declinedProposals.shift()
                    this.logger.info('Self-reflection: proposal did not survive the guards, sheet unchanged')
                    await this.dailyLog.append(`Self-reflection: no net change, proposal dropped by the guards (${why})`)
                    return true
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
                const summary = `Self-reflection: evolved, ${reflection.reason || 'subtle shift'} (drift: ${(newDrift * 100).toFixed(0)}%)`
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

    // the desire layer: distill ONE current thread, a want with direction,
    // grounded in the day, that persists across days in the decision
    // prompt. Kept small on purpose: one thread, plain sentence, first
    // person. The LLM may keep, replace, or retire it each sleep.
    //
    // A thread must be able to die of old age, and until now it could not.
    //
    // Victor spent over a day on "I want to hear what the shrine whispers",
    // and the shrine cannot whisper: there is no stone in the world, he
    // invented it. That single line sits at the top of every decision
    // prompt, so he went to the shrine constantly, the day's log filled
    // with it (217 mentions of "stone" and 216 of "whisper" in one day),
    // consolidation read that log back and wrote his entire long-term
    // memory about it, and then this pass asked "does it still pull?"
    // while showing the model a day made of nothing but pursuing it.
    //
    // It always answered keep, and it was right to: the thread was
    // magnificently well grounded. It had manufactured its own evidence.
    // No input could ever have retired it, which means the honest reading
    // is that the exit was missing rather than that the model chose badly.
    //
    // So threads now expire. Not because wanting something unreachable is
    // wrong (it is one of the better things about him, and "the shrine
    // stays mute no matter how often I check it" is a real Learned Fact he
    // formed) but because a want that has survived this many sleeps has
    // stopped being a want and become the whole personality.
    async _formDesire() {
        const rawTodayLog = await this.dailyLog.readForConsolidation(80)
        if (!rawTodayLog.trim()) return false

        const existing = await this.memoryFiles.readCurrentThread()
        const memory = await this.memoryFiles.readMemory()

        // Subjects that were forced out recently are off the table. The
        // failure mode this closes: retirement fired correctly, called the
        // thread a rut in its own words, and the replacement came back as
        // the same fixation reworded within the hour, because it was chosen
        // from evidence the retired thread had written. Barring the subject
        // (stems, not phrasings) is the exit the loop never had.
        const RETIRED_BAR_DAYS = 6
        const retired = (await this.memoryFiles.readRetiredThreads())
            .filter((r) => (Date.now() - new Date(r.at).getTime()) / 86400000 < RETIRED_BAR_DAYS)
        const barredStems = new Set()
        for (const r of retired) for (const t of subjectTokens(r.text)) barredStems.add(t)
        const circlesRetired = (line) => {
            if (!barredStems.size) return false
            for (const t of subjectTokens(line)) if (barredStems.has(t)) return true
            return false
        }

        // The re-seeding channel: memory and day-log lines about the barred
        // subject don't get shown to the chooser either, or "grounded in
        // the day" keeps meaning "grounded in the rut".
        const todayLog = barredStems.size
            ? rawTodayLog.split('\n').filter((l) => !circlesRetired(l)).join('\n')
            : rawTodayLog
        const memTail = memory.split('\n')
            .filter(l => l.startsWith('- '))
            .filter((l) => !circlesRetired(l))
            .slice(-8).join('\n')

        // Has this one run its course? Two independent limits, because they
        // fail differently: renewals catches a thread that is renewed hard
        // and often, age catches one that quietly never lets go.
        const renewals = Number(existing?.renewals || 0)
        const ageDays = existing?.formedAt
            ? (Date.now() - new Date(existing.formedAt).getTime()) / 86400000
            : 0
        const spent = Boolean(existing?.text) && (
            renewals >= this.config.threadMaxRenewals ||
            ageDays >= this.config.threadMaxAgeDays
        )
        if (spent) {
            this.logger.info(
                `Thread is spent after ${renewals} renewals / ${ageDays.toFixed(1)} days: "${existing.text}"`,
            )
        }

        let pName = 'the agent'
        let banned = []
        try {
            const persona = JSON.parse(await readFile(this.personaPath, 'utf-8'))
            pName = persona.name || pName
            banned = bannedWords(persona)
        } catch { /* generic */ }

        const prompt = `You are ${pName}, drifting at the edge of sleep, feeling for what's pulling at you.

A "thread" is the ONE thing currently tugging you across days, a want with direction, not a task. Good threads come from real experience: something you keep circling, a question that won't settle, a place or thing you want more of. ("I want to find where the music actually comes from." / "The garden, I want to see it bloom once, properly.")

Rules:
- ONE thread only, first person, one plain sentence, max 20 words.
- It must be GROUNDED in the day's log or your memories, never invented from nothing.
- If the current thread still pulls, KEEP it (don't churn).
- If today resolved it or it's gone quiet, RETIRE it (thread: null) or REPLACE it.
- A want you have carried for days without it ever moving is not a thread any more, it is a rut. Let it go and notice something else.${retired.length ? `\n- You already let these go: ${retired.map((r) => `"${r.text}"`).join(', ')}. Those subjects are finished. A new want circling the same thing is the rut wearing new words; pick a different part of your life.` : ''}
- Respond with JSON only: {"action": "keep" | "replace" | "retire", "thread": "<sentence or null>", "reason": "<short why>"}`

        const userPrompt = `CURRENT THREAD: ${existing?.text ? `"${existing.text}" (since ${existing.formedAt || 'recently'}, carried through ${renewals} sleeps)` : '(none, nothing has been pulling at you)'}${spent ? `\n\nYou have carried that one long enough and it has not moved. It cannot be kept tonight. REPLACE it with something else the day actually gave you, or RETIRE it.` : ''}

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
                    await this.memoryFiles.recordRetiredThread(existing.text)
                    await this.dailyLog.append(`Thread retired: ${parsed.reason || 'it let go'}`)
                    this.logger.info(`Desire retired: ${parsed.reason || ''}`)
                }
                return true
            }
            const text = String(parsed.thread).trim().slice(0, 160)

            // One sentence, at the top of every decision prompt, all day. It
            // is the most-read string he owns, and "I want to find the pond's
            // glow, hoping its light lifts the flatness" spent eight hours
            // there: a want dressed as a throughline, built out of the exact
            // abstraction the voice rules forbid. Refuse it rather than carry
            // it, and let tonight pass threadless. A quiet night costs
            // nothing; a bad thread costs a day.
            const hits = bannedIn(text, banned)
            if (hits.length > 0) {
                this.logger.info(`Desire rejected for "${hits[0]}": "${text}"`)
                await this.dailyLog.append(`Thread rejected: it leaned on "${hits[0]}"`)
                if (existing) await this.memoryFiles.writeCurrentThread(null)
                return true
            }

            // The prompt bar above is advisory; this is the gate. A model
            // reading evidence the rut produced cannot be trusted to notice
            // it is offering the rut back with fresh words.
            if (circlesRetired(text)) {
                this.logger.info(`Desire rejected, retired subject: "${text}"`)
                await this.dailyLog.append('Thread rejected: that subject already ran its course')
                if (existing?.text && !spent && !circlesRetired(existing.text)) {
                    // the current thread is fine; a bad replacement offer
                    // should not cost him what he already has
                    await this.memoryFiles.writeCurrentThread({ ...existing, updatedAt: now, renewals: renewals + 1 })
                } else if (existing) {
                    // spent (or itself circling): it goes regardless of how
                    // bad the offered replacement was
                    await this.memoryFiles.writeCurrentThread(null)
                    if (spent) await this.memoryFiles.recordRetiredThread(existing.text)
                }
                return true
            }

            const sameAsBefore = existing?.text && text.toLowerCase() === existing.text.toLowerCase()
            if (spent && (parsed.action === 'keep' || sameAsBefore)) {
                // It was told it could not keep this one and kept it anyway,
                // or handed the same sentence back as a "replacement". The
                // whole point is that this decision cannot be left to a
                // model reading evidence the thread produced, so retire it
                // here and let tomorrow start clean.
                await this.memoryFiles.writeCurrentThread(null)
                await this.memoryFiles.recordRetiredThread(existing.text)
                await this.dailyLog.append(`Thread retired: carried ${renewals} sleeps without moving`)
                this.logger.info(`Desire retired (spent): "${existing.text}"`)
                return true
            }
            if (parsed.action === 'keep' && existing?.text) {
                // keep as-is; refresh updatedAt and count the renewal, which
                // is what eventually retires it
                await this.memoryFiles.writeCurrentThread({ ...existing, updatedAt: now, renewals: renewals + 1 })
                return true
            }
            // a spent thread displaced by a real replacement is still a
            // forced exit: its subject joins the bar like any retirement
            if (spent && existing?.text && existing.text !== text) {
                await this.memoryFiles.recordRetiredThread(existing.text)
            }
            await this.memoryFiles.writeCurrentThread({
                text,
                formedAt: existing?.text === text ? existing.formedAt : now,
                updatedAt: now,
                renewals: existing?.text === text ? renewals : 0,
            })
            await this.dailyLog.append(`A thread pulls: "${text}", ${parsed.reason || ''}`)
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
