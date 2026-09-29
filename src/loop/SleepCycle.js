// sleep cycle. active/sleep timing + quiet hours, and the night passes:
// consolidate memory, pull out skills, self-reflect (maybe evolve the
// persona), form a thread, gc old logs.

import { sanitizeJson } from '../util/sanitizeJson.js'

// LIGHT_MOTIF is the whole light family, only used on evolved dispositions
// where one entry does more damage than a hundred diary lines.
// REASON_TIC is the reason channel's own coinages. HOLLOW catches the
// mystery nouns but not these ("the glow room" 24x in a day). widened 21 Aug
// after "the glowing pond" and "subtle light cues" got past. consolidation
// view only, the diary scorer never reads it so the green stone's real glow
// is still sayable
const LIGHT_MOTIF = /\b(glow\w*|glint\w*|shimmer\w*|lumin\w*|light|lights|lit|flicker\w*|gleam\w*|glimmer\w*|radian\w*|puls(?:e|es|ing)|beacon\w*|neon)\b/i
const REASON_TIC = /\b(glow\w*|glint\w*)\s+(room|thread|trail|hunt|chase)\b|\bthe\s+glow\w*\b|\b(subtle )?light cues\b|\bvisual rhythms?\b/i
import { stem } from '../util/wornWords.js'
import { bannedIn, bannedWords, subjectTokens, isMessageFrame } from '../util/record.js'
import { _patterns as voicePatterns } from '../util/voiceScore.js'

import { readFile, writeFile, copyFile } from 'node:fs/promises'

// every authored entry has to still be there after an evolution.
// the merge replaces arrays wholesale, so a model that just leaves a quirk
// out deletes it, one a cycle, under the drift guard (it dropped the
// coin-flip one, the one that makes him fun). the sanitizer only sees what
// comes back, an omission never reaches it, so canon is enforced here on the
// merged sheet. evolved entries can still go. mutates persona and returns it
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
        // restoring onto a full list can't go over the cap (shipped 12 traits
        // once, three of them the same fixation). authored always stay, the
        // newest evolved ones give way first
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

/** epoch ms of the last real sheet change, or null. entries are written with
 * `date` but the caller used to read `at`, so it was always NaN and the min-gap
 * check never kicked in. reads both, old logs are still on disk */
export function lastEvolutionAt(persona) {
    const found = [...(persona?.evolution || [])].reverse()
        .map((e) => Date.parse(e?.date || e?.at || ''))
        .find((t) => Number.isFinite(t))
    return found ?? null
}

// evolution sanitizer bits

const MOTIF_STOPWORDS = new Set([
    'the', 'and', 'but', 'for', 'not', 'was', 'are', 'with', 'that', 'this',
    'his', 'him', 'her', 'its', 'own', 'has', 'have', 'had', 'can', 'may',
    'when', 'than', 'then', 'them', 'they', 'from', 'into', 'over', 'out',
    'about', 'after', 'before', 'while', 'more', 'most', 'some', 'only',
    'often', 'sometimes', 'occasionally', 'small', 'things', 'himself',
    // frame verbs, structure not theme. the frame check counts them, and
    // left in here "find" showed up as a motif
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

// shape of an entry, not its words. "finds calm in water's ripple", "finds
// brief lift in warm air", "seeks fleeting sparks in mundane environments"
// share almost no words (jaccard ~0.1) but its one idea written again and
// again: <verb> <sensation> in <ambient thing>. a diary entry wearing a
// trait's clothes. max twice per frame among the additions
const FRAME_VERBS = /^(finds?|seeks?|draws?|drawn|attuned|soothed|comforted|calmed|steadied|settled|lifted|grounded|takes? comfort|likes? the)\b/i
const FRAME_TAIL = /\b(in|by|when|among|through|from)\b/

// one frame whatever the verb, per-verb buckets were useless.
// a couple of sensory affinities is character, five is a tic
function entryFrame(entry) {
    const e = String(entry).trim().toLowerCase()
    if (!FRAME_VERBS.test(e)) return null
    return FRAME_TAIL.test(e) ? 'sensory-affinity' : 'sensory-affinity-bare'
}

// intersection over the SMALLER set. jaccard let "private yet attuned to
// rhythmic cues" past "private" (0.25) and the sheet ended up with three
// restatements of one authored trait. same fix as memory dedup
function tokenContainment(a, b) {
    if (a.size === 0 || b.size === 0) return 0
    let inter = 0
    for (const t of a) if (b.has(t)) inter++
    return inter / Math.min(a.size, b.size)
}

// log-observation dressed as personality ("recognizes that X", "notes Y").
// real traits read like "steps back when...", "quietly proud of..."
const OBSERVATION_RE = /^(recognizes|notes|realizes|understands|learns|acknowledges|accepts|observes|notices)\b/i

// per stemmed word and per sentence shape, counted accross the whole sheet
const MOTIF_CEILING = 2
const FRAME_CEILING = 2

/**
 * scrub a reflection's proposed arrays before the merge. the floor above stops
 * the sheet hollowing out, this stops it silting up (the hum spiral was 46
 * "recognizes that X eases the hum" entries, each one passing drift, since
 * drift only notices loss).
 * baseline is canon. otherwise drop: observation-shaped, over 90 chars, banned
 * words, restatements (containment >= 0.6), anything over the motif/frame
 * ceilings. then cap at baseline + 2 (8 with no baseline). the cap is what
 * really holds, the rest is lexical and the model rewords faster than we can list
 * @param {string[]} [banned] voice-rule words, baseline entries exempt
 * @returns {number} entries dropped. mutates changes
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
        // headroom over the authored sheet. was +5 and let seven wordings of
        // one trait onto Victor's ("finds calm in water's ripple", "feels a
        // spark from neon lights", "uses sensory spikes to reset focus"...).
        // the frame check got two of them. widening FRAME_VERBS is the same
        // losing game as banning "the edge" and getting "the whisper", the
        // cap doesn't care how it's phrased. 2 is room to grow, not enough for
        // a monoculture
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
                // content, not just count. 21 Aug the fixation wrote itself
                // in as "attuned to subtle light cues" and nothing read what
                // it said. a trait is the worst place for that, it goes in
                // every prompt after and makes its own evidence.
                // bare "light" is in the family on purpose here, losing the
                // odd "light-hearted" is fine
                if (isMessageFrame(entry)) { drop(field, entry, 'message-frame shaped'); continue }
                if (LIGHT_MOTIF.test(entry)) { drop(field, entry, 'light-fixation motif'); continue }
                // a retired subject cant come back as a disposition. the glow
                // was retired and scrubbed from memory on 13 Aug and was back
                // as a quirk by the next morning
                const retired = _retiredHit(entry, barredStems)
                if (retired) { drop(field, entry, `retired subject "${retired}"`); continue }
            }

            const tokens = motifTokens(entry)

            if (!isCanon) {
                // mostly inside an existing entry (or swallowing one) is a
                // restatement eating a cap slot, however it's padded.
                // extensions should be revisions, not neighbours
                let nearDup = false
                for (const kt of keptTokens) {
                    if (tokenContainment(tokens, kt) >= 0.6) { nearDup = true; break }
                }
                if (nearDup) { drop(field, entry, 'restates an existing entry'); continue }

                // was 3 against the old +5 cap, one motif owned most of what he grew
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

// applies what _semanticTwinPass got back. containment only catches
// restatements that share words, "private" and "selectively open" share none
// and three of eleven trait slots ended up one idea. authored always wins:
// - a proposal that restates a current entry replaces it (drops instead if
//   the current one is authored)
// - at most ONE existing pair merges per night, the non-authored one goes.
//   tight on purpose after the 2026-06 drift wipe
// anything malformed = no change
export function collapseSemanticTwins(changes, persona, originalPersona, result, logger = null) {
    if (!result || typeof result !== 'object') return 0
    const fields = ['traits', 'values', 'fears', 'quirks']
    let applied = 0

    const authored = (field, text) => Array.isArray(originalPersona?.[field]) && originalPersona[field].includes(text)
    const fieldOf = (text) => fields.find((f) => Array.isArray(changes[f]) && changes[f].includes(text))

    const proposals = Array.isArray(result.proposals) ? result.proposals.slice(0, 6) : []
    for (const v of proposals) {
        if (applied >= 3) break
        const proposal = typeof v?.text === 'string' ? v.text : null
        const restates = typeof v?.restates === 'string' ? v.restates : null
        if (!proposal || !restates || proposal === restates) continue
        const field = fieldOf(proposal)
        if (!field || !changes[field].includes(restates)) continue
        // proposals only: an entry already on the sheet is handled by the
        // existing-pair path below, one per night
        if (Array.isArray(persona[field]) && persona[field].includes(proposal)) continue
        if (authored(field, restates)) {
            changes[field] = changes[field].filter((x) => x !== proposal)
            logger?.info?.(`Semantic twins: dropped proposed ${field} entry "${proposal.slice(0, 60)}" (restates authored "${restates.slice(0, 60)}")`)
        } else {
            changes[field] = changes[field].filter((x) => x !== restates)
            logger?.info?.(`Semantic twins: "${proposal.slice(0, 60)}" replaces ${field} entry "${restates.slice(0, 60)}"`)
        }
        applied++
    }

    const pair = result.existingPair
    if (pair && typeof pair.a === 'string' && typeof pair.b === 'string' && pair.a !== pair.b) {
        const field = fieldOf(pair.a)
        if (field && changes[field].includes(pair.b)) {
            // drop the non-authored side; both authored means i wrote
            // both on purpose and the machine keeps its hands off
            const drop = authored(field, pair.a) ? (authored(field, pair.b) ? null : pair.b)
                : pair.a === pair.b ? null : (authored(field, pair.b) ? pair.a : pair.b)
            if (drop) {
                changes[field] = changes[field].filter((x) => x !== drop)
                logger?.info?.(`Semantic twins: merged existing ${field} pair, dropped "${drop.slice(0, 60)}"`)
                applied++
            }
        }
    }

    return applied
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

        // keep the whole config, newer settings (evolution interval, thread
        // expiry) read through it. it wasn't stored at first and every sleep
        // threw on undefined and took consolidation down with it
        this.config = config || {}

        this.activeHours = config.activeHoursBeforeSleep
        this.sleepMinutes = config.sleepDurationMinutes
        this.worldSleepRestartGuardMinutes = Math.max(
            1,
            Number(config.worldSleepRestartGuardMinutes ?? 30),
        )
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

    // immutable persona baseline. written once on the first ever boot, read
    // back from that file every boot after (crashes included)
    async loadOriginalPersona(currentPersona) {
        const { join } = await import('node:path')
        const baselinePath = join(this.dataDir, 'persona-baseline.json')
        try {
            const raw = await readFile(baselinePath, 'utf-8')
            this._originalPersona = this._extractComparableFields(JSON.parse(raw))
            this.logger.info('Drift guard: loaded immutable persona baseline')
            // canon repair at boot too, or anything lost before the floor
            // existed stays lost until the next evolution. written back
            // because the hourly persona sync reads the file, not us
            const before = JSON.stringify(currentPersona)
            enforceRichnessFloor(currentPersona, this._originalPersona, this.logger)
            if (this.personaPath && JSON.stringify(currentPersona) !== before) {
                try { await writeFile(this.personaPath, JSON.stringify(currentPersona, null, 2), 'utf-8') } catch { /* next evolution writes it */ }
            }
        } catch {
            // first ever boot, current persona becomes the baseline
            await writeFile(baselinePath, JSON.stringify(currentPersona, null, 2), 'utf-8')
            this._originalPersona = this._extractComparableFields(currentPersona)
            this.logger.info('Drift guard: saved initial persona baseline')
        }
    }

    isSleeping() {
        return this.sleeping
    }

    // every tick. worldClock is { hour, is_night, day } if the host sends one,
    // otherwise it's the old real-time timer.
    // the timer was 50 min up / 10 down, and a 3eyes day is one real hour, so
    // it was phase-locked and he fell asleep mid afternoon every single day.
    // the actual work is ~15s. so: once a night, awake all day. the sim puts
    // him in the nest while the brain is away (advanceSleepCycle)
    checkSleepTime(worldClock = null) {
        if (this.sleeping) return

        if (worldClock && typeof worldClock.hour === 'number') {
            this._lastWorldClock = worldClock
            if (!worldClock.is_night) return
            // once a night, one that straddles midnight is still one night
            const nightId = worldClock.hour < 12 ? worldClock.day - 1 : worldClock.day
            if (this._lastNightSlept === nightId) return
            // a restart isnt a new day. every deploy reset _lastNightSlept and a
            // restart at night slept again after a minute awake. the world's
            // night is shorter than this window so it only skips the night
            // already in progress
            const restartGuardMs = this.worldSleepRestartGuardMinutes * 60_000
            if (Date.now() - this._wakeTime < restartGuardMs) return
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

            // pass 0: strip near-dupes before the LLM sees them
            const dedupRemoved = await this.memoryFiles.deduplicateMemory()
            if (dedupRemoved > 0) {
                await this.dailyLog.append(`Pre-consolidation dedup: removed ${dedupRemoved} near-duplicates`)
            }

            // pass 1: memory.md
            stats.memoryConsolidated = await this._consolidateMemory()
            await this._sleepDelay(5000)  // spread the rate limit load

            // pass 2: skills.md
            stats.skillsExtracted = await this._extractSkills()
            await this._sleepDelay(5000)

            // (the old tools cleanup pass was cut in v0.3.1, it could wreck the
            // ground truth header and tools.md gets rebuilt every tick anyway)

            // pass 3: self-reflection, maybe evolve the persona
            stats.selfReflected = await this._selfReflect()

            // pass 4: the desire layer, the one thread pulling at him across
            // days. needs with no wants reads as a tamagotchi
            stats.desireFormed = await this._formDesire()

            stats.logsDeleted = await this.dailyLog.garbageCollect()

            // volatile state
            this.workingMemory.clear()
            this.internalState.clearHistory()
            if (this.repetitionGuard) this.repetitionGuard.clear()
            // speech log is trimmed not cleared, it's meant to outlive sleep
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

        // with a world clock, sleep till his morning. only the host knows how
        // much real time is left of his night so it sends it. clamped both
        // ways so a bad clock can't strand him
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

    // retired thread subjects as stems, barred for 6 days. every sleep writer
    // has to agree on this or letting go just moves it: the glow went thread,
    // then quirk, then a Learned Fact in memory.md
    async _barredStems() {
        try {
            const retired = (await this.memoryFiles.readRetiredThreads())
                .filter((r) => (Date.now() - new Date(r.at).getTime()) / 86400000 < 6)
            if (!retired.length) return { stems: null, texts: [] }
            const stems = new Set()
            for (const r of retired) for (const t of subjectTokens(r.text)) stems.add(t)
            return { stems, texts: retired.map((r) => r.text) }
        } catch {
            return { stems: null, texts: [] }
        }
    }

    // LLM half of the semantic twin check, collapseSemanticTwins applies it.
    // one small json call a sleep. any failure leaves the proposal as the
    // word-level sanitizer left it
    async _semanticTwinPass(changes, persona) {
        const fields = ['traits', 'values', 'fears', 'quirks']
        const sections = []
        let anyProposals = false
        for (const field of fields) {
            if (!Array.isArray(changes[field])) continue
            const current = Array.isArray(persona[field]) ? persona[field] : []
            const proposed = changes[field].filter((x) => typeof x === 'string' && !current.includes(x))
            const kept = changes[field].filter((x) => typeof x === 'string' && current.includes(x))
            if (!kept.length && !proposed.length) continue
            if (proposed.length) anyProposals = true
            sections.push(`${field.toUpperCase()}\ncurrent: ${JSON.stringify(kept)}\nproposed additions: ${JSON.stringify(proposed)}`)
        }
        if (!sections.length) return 0
        // no additions and nothing stacked worth asking about: the
        // existing-pair check still runs so a stacked axis heals over a
        // few nights even when a sleep proposes nothing new
        const sys = 'You check a character sheet for restatements. Two entries restate each other when they describe substantially the same disposition, even with no words in common ("private" and "selectively open" are one idea; so are two intensities of one leaning). Entries about genuinely different things are NOT restatements however similar the wording. When unsure, say null. Respond with valid JSON only: {"proposals":[{"text":"<a proposed addition>","restates":"<the current entry it restates, verbatim, or null>"}],"existingPair":{"a":"<current entry>","b":"<current entry>"}|null}. existingPair names at most ONE pair of CURRENT entries (same section) that restate one idea; null if none do.'
        const user = sections.join('\n\n') + (anyProposals ? '' : '\n\n(no proposed additions this sleep; only check current entries for one restated pair)')
        const result = await this.think.consolidate(sys, user, 20000)
        if (!result) return 0
        let parsed = null
        try { parsed = typeof result === 'string' ? JSON.parse(sanitizeJson(result)) : result } catch { return 0 }
        return collapseSemanticTwins(changes, persona, this._originalPersona, parsed, this.logger)
    }

    // the reasons are soaked in the hollow register (one day: glint 166, pull
    // 100, glow 94, hum 56) and nobody reads them, but they flow through the
    // log into memory and the persona. thats how the drum fixation got three
    // persona slots. sleep reads a cleaned view, the file on disk stays whole
    _stripHollowReasons(text) {
        const HOLLOW = voicePatterns?.HOLLOW
        if (!HOLLOW || !text) return text
        return String(text).split('\n').map((line) => {
            const m = /"reason":"([^"]*)"/.exec(line)
            if (!m || !(HOLLOW.test(m[1]) || REASON_TIC.test(m[1]))) return line
            return line
                .replace(/"reason":"[^"]*"/, '"reason":""')
                // the echoed copy between the call and the tier tag
                .replace(/\):\s.*?\s\[([\w-]+)\]/, '): [$1]')
        }).join('\n')
    }

    async _consolidateMemory() {
        const rawMemory = await this.memoryFiles.readMemory()
        // capped at 200 lines or the day blows the context
        const rawTodayLog = this._stripHollowReasons(await this.dailyLog.readForConsolidation(200))

        if (!rawTodayLog.trim()) return false

        // the loop that kept the glow alive: memory has it, the log mentions
        // it, the rewrite keeps it. barred subjects get cut from both inputs,
        // told to the model and stripped from the output. the instruction on
        // its own is only advisory
        const bar = await this._barredStems()
        const circlesBarred = (line) => {
            if (!bar.stems?.size) return false
            for (const t of subjectTokens(line)) if (bar.stems.has(t)) return true
            return false
        }
        const memory = bar.stems
            ? rawMemory.split('\n').filter((l) => !(l.trim().startsWith('- ') && circlesBarred(l))).join('\n')
            : rawMemory
        const todayLog = bar.stems
            ? rawTodayLog.split('\n').filter((l) => !circlesBarred(l)).join('\n')
            : rawTodayLog

        // the big moments get their own block
        const salientEvents = this.workingMemory.salientEvents(0.6)
            .filter((e) => !circlesBarred(`${e.action || ''} ${e.message || ''}`))
        const salientNote = salientEvents.length > 0
            ? `\n\nWHAT HIT HARDEST TODAY (these landed with real feeling, let them shape what you keep):\n${salientEvents.map(e => `- [${e.time}] ${e.type}: ${e.action || e.message || JSON.stringify(e)}`).join('\n')}`
            : ''

        // in his voice. "you are a memory consolidation system" gave a strategy
        // wiki full of entity ids ("food_apple_tree reduces hunger")
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
- Keep the three markdown sections: ## Relationships, ## Learned Facts, ## Important Memories. Cap around 40 entries total. Keep procedural how-to OUT of here.${bar.texts.length ? `\n- Some wants have run their course and are FINISHED: ${bar.texts.map((t) => `"${t}"`).join(', ')}. Nothing about those subjects goes in this file, not as a fact, not as a memory, not reworded. Let them fade like anything else you were once briefly into.` : ''}

Return ONLY the updated memory.md content (or the single token NO_CHANGE), nothing else.`

        const userPrompt = `MY MEMORY SO FAR:\n${memory}\n\nTODAY:\n${todayLog}${salientNote}`

        const result = await this.think.consolidate(prompt, userPrompt, 60000, false) // markdown output

        // quiet day: NO_CHANGE instead of paraphrasing the file into slop.
        // short exact token so a memory that says "no change" cant trip it
        const trimmedResult = (result || '').trim()
        if (trimmedResult.length <= 12 && /^no[_\s-]?change$/i.test(trimmedResult)) {
            this.logger.info('Memory consolidation: quiet day, left memory unchanged')
            await this.dailyLog.append('Memory consolidation: quiet day, left memory unchanged')
            return false
        }

        if (result && result.trim().length > 10) {
            // the write is the choke point: whatever the model kept anyway
            // gets cut here, bullets only, structure untouched
            const cleaned = bar.stems
                ? result.trim().split('\n').filter((l) => !(l.trim().startsWith('- ') && circlesBarred(l))).join('\n')
                : result.trim()
            const written = await this.memoryFiles.safeWriteMemory(cleaned)
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
        const todayLog = this._stripHollowReasons(await this.dailyLog.readForConsolidation(100))

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

    // look back over behaviour + state history and maybe evolve the persona.
    // the drift guard blocks it if he's wandered too far from the baseline
    async _selfReflect() {
        const memory = await this.memoryFiles.readMemory()
        const todayLog = this._stripHollowReasons(await this.dailyLog.readForConsolidation(150))
        const stateHistory = this.internalState.historySummary()

        if (!todayLog.trim()) return false

        let persona
        try {
            const raw = await readFile(this.personaPath, 'utf-8')
            persona = JSON.parse(raw)
        } catch {
            this.logger.warn('Could not load persona for self-reflection')
            return false
        }

        // the sheet runs on its own clock, not the sleep clock. hourly sleeps
        // gave 24 chances a day to rewrite him (seven versions of one trait in
        // a night). defers, doesn't skip. read off the evolution log so a
        // restart doesnt hand out a free reflection
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

        // should already be loaded by loadOriginalPersona() at startup
        if (!this._originalPersona) {
            this.logger.warn('Drift guard: no baseline loaded, using current persona (unsafe)')
            this._originalPersona = this._extractComparableFields(persona)
        }

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
- An entry that says an existing entry again in other words is not growth, it is the same disposition twice. If what changed is really a deepening of something already on the sheet, leave the sheet alone.
- If nothing warrants change, respond with {"evolve": false}.
- If change is warranted, respond with {"evolve": true, "changes": {...}, "reason": "why"}.

The "changes" object contains the FULL fields to update, using the same structure as the persona.
For example, to add one quirk you still return ALL quirks: {"changes": {"quirks": ["speaks slowly when uncertain", "goes quiet near water", "hums when exploring"]}, "reason": "started humming while exploring, kept the rest"}

Respond with JSON only.`

        // evolution log stays out of the prompt. it used to ride along and 9
        // of 12 entries were the same "subtle addition of a resourceful trait",
        // the model was just re-making its own old proposals
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
            // dig the json out, it comes back fenced half the time
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

            if (reflection.changes && typeof reflection.changes === 'object') {
                // name, id and backstory are off limits
                delete reflection.changes.name
                delete reflection.changes.id
                delete reflection.changes.backstory

                // wrong types here would corrupt the persona file
                const arrayFields = new Set(['traits', 'values', 'fears', 'quirks'])
                for (const [key, val] of Object.entries(reflection.changes)) {
                    if (arrayFields.has(key) && !Array.isArray(val)) {
                        this.logger.warn(`Persona evolution rejected: "${key}" must be array, got ${typeof val}`)
                        await this.dailyLog.append(`Persona evolution REJECTED, "${key}" had wrong type (${typeof val})`)
                        return false
                    }
                    // voice.style isnt his to rewrite. it was the one field
                    // evolution could edit freely and it drifted from "plain,
                    // dry, short complete sentences" to "sparse, fragmentary...
                    // plays loose with grammar", and every plain-speech rule
                    // was arguing with it and losing. how he sounds is authored,
                    // what he notices is his
                    if (key === 'voice') {
                        this.logger.info('Persona evolution: ignoring a proposed voice change, voice.style is authored')
                        delete reflection.changes.voice
                        continue
                    }
                }

                // scrub silt before the merge (observations, dupes, motif
                // pile-ups, over cap). the floor below covers the opposite.
                // retired thread subjects are barred here too, same window
                // TODO: this is _barredStems() again, just call that
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

                // meaning-level pass after the word-level ones. fail soft, and
                // only a few moves a night
                let twins = 0
                try {
                    twins = await this._semanticTwinPass(reflection.changes, persona)
                } catch { /* the proposal stands, as it always did */ }
                if (twins > 0) {
                    await this.dailyLog.append(`Self-reflection: semantic twin pass collapsed ${twins} entries`)
                }

                // to tell a real change from a proposal the guards ate
                const before = JSON.stringify(this._extractComparableFields(persona))

                try {
                    await copyFile(this.personaPath, this.personaPath + '.bak')
                } catch { /* first run, no file to back up */ }

                for (const [key, val] of Object.entries(reflection.changes)) {
                    persona[key] = val
                }

                // the merge replaces arrays wholesale, a short list from the
                // model hollows him out (nine traits to one once). puts any
                // missing authored entries back
                enforceRichnessFloor(persona, this._originalPersona, this.logger)

                // nothing actually moved. at the cap the sanitizer drops every
                // new entry and the merge puts back what was there, but this
                // still logged "evolved" and wrote an entry (9 of 12 on 11 Aug).
                // keep the reason for next time and leave the file alone
                if (JSON.stringify(this._extractComparableFields(persona)) === before) {
                    const why = reflection.reason || 'no reason given'
                    this._declinedProposals.push(why)
                    if (this._declinedProposals.length > 5) this._declinedProposals.shift()
                    this.logger.info('Self-reflection: proposal did not survive the guards, sheet unchanged')
                    await this.dailyLog.append(`Self-reflection: no net change, proposal dropped by the guards (${why})`)
                    return true
                }

                if (!persona.evolution) persona.evolution = []
                persona.evolution.push({
                    date: new Date().toISOString(),
                    reason: reflection.reason || 'self-reflection',
                    changes: reflection.changes,
                    driftScore: this._measureDrift(persona),
                })
                if (persona.evolution.length > 20) {
                    persona.evolution = persona.evolution.slice(-20)
                }

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

    // the desire layer: ONE thread, a want with direction, first person, one
    // sentence, carried in the decision prompt across days. the model can
    // keep, replace or retire it each sleep.
    //
    // threads expire now. "I want to hear what the shrine whispers" ran for
    // over a day (the shrine cant whisper, he made that up). it sits on top
    // of every prompt so he went there constantly, the log filled up with it
    // (217 "stone", 216 "whisper" in a day) and then "does it still pull?"
    // got asked against that log. it made its own evidence, nothing could
    // retire it. wanting something unreachable is fine, a want that survives
    // this many sleeps has just become the personality
    async _formDesire() {
        const rawTodayLog = this._stripHollowReasons(await this.dailyLog.readForConsolidation(80))
        if (!rawTodayLog.trim()) return false

        const existing = await this.memoryFiles.readCurrentThread()
        const memory = await this.memoryFiles.readMemory()

        // recently retired subjects are off the table. retirement worked but
        // the replacement came back as the same fixation reworded within the
        // hour, picked from evidence the old thread wrote. bar the subject
        // (stems), not the phrasing
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

        // and dont show it the barred lines either, or "grounded in the day"
        // just means grounded in the rut
        const todayLog = barredStems.size
            ? rawTodayLog.split('\n').filter((l) => !circlesRetired(l)).join('\n')
            : rawTodayLog
        const memTail = memory.split('\n')
            .filter(l => l.startsWith('- '))
            .filter((l) => !circlesRetired(l))
            .slice(-8).join('\n')

        // run its course? two limits, they fail differently. renewals catches
        // one renewed hard and often, age catches one that just never lets go
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

            // top of every decision prompt all day, the most-read string he
            // has. "I want to find the pond's glow, hoping its light lifts the
            // flatness" sat there eight hours. refuse and go threadless, a
            // quiet night costs nothing and a bad thread costs a day
            const hits = bannedIn(text, banned)
            if (hits.length > 0) {
                this.logger.info(`Desire rejected for "${hits[0]}": "${text}"`)
                await this.dailyLog.append(`Thread rejected: it leaned on "${hits[0]}"`)
                if (existing) await this.memoryFiles.writeCurrentThread(null)
                return true
            }

            // the prompt bar is advisory, this is the gate. the model won't
            // notice it's offering the rut back in new words
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
                // told it couldnt keep it and kept it anyway, or handed the same
                // sentence back as a "replacement". retire it here
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

    // just the fields that can evolve
    _extractComparableFields(persona) {
        return {
            traits: [...(persona.traits || [])],
            values: [...(persona.values || [])],
            fears: [...(persona.fears || [])],
            quirks: [...(persona.quirks || [])],
            voiceStyle: persona.voice?.style || '',
        }
    }

    // 0 = same as the baseline, 1 = nothing in common
    _measureDrift(currentPersona) {
        if (!this._originalPersona) return 0

        const original = this._originalPersona
        const current = this._extractComparableFields(currentPersona)

        let totalDrift = 0
        let fieldCount = 0

        // jaccard against the baseline so additions move the dial too, not
        // just losses. the old one only counted surviving originals, 25 aug
        // had twenty entries all at driftScore 0 while traits went 9 to 11.
        // additive drift is exactly what a fixation does
        for (const field of ['traits', 'values', 'fears', 'quirks']) {
            const orig = new Set(original[field].map(s => s.toLowerCase()))
            const curr = new Set(current[field].map(s => s.toLowerCase()))

            if (orig.size === 0) continue
            fieldCount++

            let shared = 0
            for (const item of orig) {
                if (curr.has(item)) shared++
            }
            const union = orig.size + curr.size - shared
            totalDrift += union > 0 ? 1 - shared / union : 0
        }

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
