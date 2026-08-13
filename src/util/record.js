// what may be written down and kept.
//
// two different failures, one file, because they share a choke point.
//
// 1. banned words. the persona's voice rules already forbid a handful of
//    abstractions ("flatness", "the edge", "a clue"). the ban lived only in
//    the decision prompt, so the words kept coming back: consolidation wrote
//    them into memory.md, the desire pass wrote them into the thread, and
//    self-reflection wrote "resourceful use of varied experiences to break
//    flatness" into the character sheet. all three are read back to the model
//    every tick as its OWN memory, and nothing in a prompt outvotes that.
//    a ban you can only ask for is not a ban, so it moves to the write.
//
// 2. subject concentration. no word list at all, on purpose. a fixation is a
//    topic and next month's will not be this month's, so enumerating them is
//    the losing game the persona sanitizer already documents. instead one
//    subject may own only so many lines of a record before the rest drop.
//    victor's memory.md was 45 lines with "glow" in 7 and "light" in 8, every
//    place in town reduced to medicine for the same condition. same rule
//    sanitizeEvolvedArrays runs on the character sheet, pointed at memory.
//
// generic by construction: the ban list comes from the persona, the cap is a
// number. nothing here knows what a kiwi is.

import { stem, STOPWORDS } from './wornWords.js'

// a bullet in one of the markdown records. anything else (headers, blanks,
// prose) is structure and passes through untouched.
const BULLET = /^\s*-\s+/

/**
 * The words this persona has ruled out, lowercased. Reads voice.avoid, which
 * is authored, not evolved: nothing in the sleep cycle may add to it.
 *
 * @param {object} persona
 * @returns {string[]}
 */
export function bannedWords(persona) {
    const raw = persona?.voice?.avoid
    if (!Array.isArray(raw)) return []
    return raw
        .map((w) => String(w || '').trim().toLowerCase())
        .filter(Boolean)
}

// words of a line, stemmed, in order. one pass, reused for both checks.
function tokens(text) {
    return String(text).toLowerCase()
        .split(/[^a-z']+/)
        .filter(Boolean)
        .map((w) => stem(w.replace(/^'+|'+$/g, '')))
}

/**
 * Which banned words a line uses.
 *
 * Everything matches on stems, single words and phrases alike, so a ban on
 * "glow" also catches "glowing" and "the gnaw" catches "the gnawing". A
 * phrase has to appear as consecutive words.
 *
 * Never substrings. Matching "a clue" against the raw text flags "a clueless
 * bird", and matching "light" would flag "slight": that is how a guard like
 * this starts quietly eating good lines, and it would do it in a file nobody
 * reads until the character has gone thin.
 *
 * @param {string} text
 * @param {string[]} banned
 * @returns {string[]} the banned entries found, in the order given
 */
export function bannedIn(text, banned) {
    if (!text || !banned?.length) return []
    const words = tokens(text)
    if (words.length === 0) return []

    const hits = []
    for (const entry of banned) {
        const want = tokens(entry)
        if (want.length === 0) continue
        for (let i = 0; i + want.length <= words.length; i++) {
            let all = true
            for (let j = 0; j < want.length; j++) {
                if (words[i + j] !== want[j]) { all = false; break }
            }
            if (all) { hits.push(entry); break }
        }
    }
    return hits
}

// content words of a line, folded to stems and counted once each, so a line
// saying "glow" twice does not count double toward the subject cap.
// Exported for the desire layer: the subject of a retired thread is these
// same tokens, and the replacement gets checked against them.
export function subjectTokens(line) {
    const out = new Set()
    for (const raw of String(line).toLowerCase().split(/[^a-z']+/)) {
        const w = raw.replace(/^'+|'+$/g, '')
        if (w.length < 3 || STOPWORDS.has(w)) continue
        out.add(stem(w))
    }
    return out
}

/** Is this single line one the record should refuse outright? */
export function isBanned(text, banned) {
    return bannedIn(text, banned).length > 0
}

/**
 * Filter the bullets of a markdown record.
 *
 * Order matters. Banned words go first so a line dropped for saying
 * "flatness" does not spend one of a subject's slots on its way out.
 *
 * Structure is never touched: headers, blank lines and any non-bullet prose
 * survive whatever happens to the bullets, so the result still validates as
 * the file it came from even if every bullet were dropped.
 *
 * Two concentration rules, because they catch different things. A single
 * stem is a TOPIC, and the subject ceiling caps it. A PAIR of stems
 * appearing together is an IDEA, and the same idea in six sentences is what
 * a fixation actually looks like once it has learned synonyms: victor's
 * live memory sat at glint 4, spark 4, glow 4, firefly 4, every count
 * exactly at the ceiling and none over it, seventeen of thirty-one bullets
 * one thought. The word rule cannot see that, because the fixation spreads
 * itself across words that stem apart. The pair rule can, because the
 * anchor words (the museum, the flash, the light) keep co-occurring however
 * the shiny noun is spelled today. Ported from the sim's MemoryEcology,
 * which learned this against the shrine-pulse spiral.
 *
 * @param {string} markdown
 * @param {object} opts
 * @param {string[]} [opts.banned]          words the persona has ruled out
 * @param {number}   [opts.subjectCeiling]  max bullets sharing one content
 *                                          word; 0 or absent disables it
 * @param {number}   [opts.ideaCeiling]     max bullets sharing one PAIR of
 *                                          content words; 0 disables it
 * @param {object}   [opts.logger]
 * @param {string}   [opts.what]            label for the log line
 * @returns {{ text: string, banned: number, crowded: number }}
 */
export function filterRecord(markdown, { banned = [], subjectCeiling = 0, ideaCeiling = 0, logger = null, what = 'record' } = {}) {
    const lines = String(markdown ?? '').split('\n')
    const counts = new Map()
    const pairCounts = new Map()
    const out = []
    let bannedDropped = 0
    let crowdedDropped = 0

    const pairKey = (a, b) => (a < b ? `${a} ${b}` : `${b} ${a}`)

    for (const line of lines) {
        if (!BULLET.test(line)) { out.push(line); continue }

        const hits = bannedIn(line, banned)
        if (hits.length > 0) {
            bannedDropped++
            logger?.info?.(`${what}: dropped a line for "${hits[0]}" (${line.trim().slice(0, 70)})`)
            continue
        }

        const tokens = subjectTokens(line)

        if (subjectCeiling > 0) {
            let over = null
            for (const t of tokens) {
                if ((counts.get(t) || 0) >= subjectCeiling) { over = t; break }
            }
            if (over) {
                crowdedDropped++
                logger?.info?.(`${what}: dropped a line, "${over}" already owns ${subjectCeiling} (${line.trim().slice(0, 70)})`)
                continue
            }
        }

        if (ideaCeiling > 0) {
            const toks = [...tokens]
            let overPair = null
            for (let i = 0; i < toks.length && !overPair; i++) {
                for (let j = i + 1; j < toks.length; j++) {
                    if ((pairCounts.get(pairKey(toks[i], toks[j])) || 0) >= ideaCeiling) {
                        overPair = pairKey(toks[i], toks[j])
                        break
                    }
                }
            }
            if (overPair) {
                crowdedDropped++
                logger?.info?.(`${what}: dropped a line, "${overPair}" is already ${ideaCeiling} bullets (${line.trim().slice(0, 70)})`)
                continue
            }
        }

        if (subjectCeiling > 0) {
            for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1)
        }
        if (ideaCeiling > 0) {
            const toks = [...tokens]
            for (let i = 0; i < toks.length; i++) {
                for (let j = i + 1; j < toks.length; j++) {
                    const k = pairKey(toks[i], toks[j])
                    pairCounts.set(k, (pairCounts.get(k) || 0) + 1)
                }
            }
        }

        out.push(line)
    }

    return { text: out.join('\n'), banned: bannedDropped, crowded: crowdedDropped }
}
