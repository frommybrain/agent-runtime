// what gets written into memory.md, the thread and the character sheet.
// banned words are enforced on the write, asking in the prompt never worked:
// consolidation kept writing "flatness" back and he reads that as his own
// memory every tick. plus caps on how many lines one subject can own

import { stem, STOPWORDS } from './wornWords.js'

// only bullets get filtered, headers and prose pass through
const BULLET = /^\s*-\s+/

// voice.avoid, authored only. sleep cycle must never add to it
export function bannedWords(persona) {
    const raw = persona?.voice?.avoid
    if (!Array.isArray(raw)) return []
    return raw
        .map((w) => String(w || '').trim().toLowerCase())
        .filter(Boolean)
}

function tokens(text) {
    return String(text).toLowerCase()
        .split(/[^a-z']+/)
        .filter(Boolean)
        .map((w) => stem(w.replace(/^'+|'+$/g, '')))
}

// stems, so "glow" catches "glowing". phrases must be consecutive words.
// never substring match, "light" would eat "slight" and nobody would notice
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

// a set, so "glow" twice in one line only counts once. the desire layer uses
// this too, to check a new thread isnt the retired one again
export function subjectTokens(line) {
    const out = new Set()
    for (const raw of String(line).toLowerCase().split(/[^a-z']+/)) {
        const w = raw.replace(/^'+|'+$/g, '')
        if (w.length < 3 || STOPWORDS.has(w)) continue
        out.add(stem(w))
    }
    return out
}

export function isBanned(text, banned) {
    return bannedIn(text, banned).length > 0
}

// "some object holds a message from elsewhere". the fixation keeps changing
// host (shrine token, glow, green stone, payphone) so stems never catch it,
// but the shape stays. needs a carrier AND an elsewhere marker, so "left a
// message for the walker" is fine and "a voice from beyond the streets" isnt.
// third rewrite of this (21 aug), it moved into verbs ("hints at", "what the
// glow hides"). "hidden" and bare "know" kept out of the carrier on purpose,
// "a hidden path behind the dumpsters" is just a path.
// if it needs a fourth go, its the wrong kind of guard, dont just add words
const FRAME_CARRIER = /\b(voices?|messages?|signals?|whispers?|secrets?|meanings?|signs?|words?|calls?|calling|hints?|hinted|hinting|hides?|hiding|conceal\w*|reveal\w*|promis\w*)\b/i
const FRAME_ELSEWHERE = /\b(beyond|elsewhere|another (?:place|world|side)|the other side|far away|from (?:outside|beneath|under|underneath|behind|below|somewhere)|not from here|hidden (?:in|inside|under|within|behind)|meant for me|for me to find|trying to (?:tell|reach|speak)|speaking to me|talking to me|waiting for me|something (?:new|odd|strange|more|else|hidden|unseen)|something (?:i|he|you) haven'?t (?:seen|found)|haven'?t (?:seen|found) (?:it )?yet|elusive|as if (?:it|they) knows?|what (?:it|they|the \w+) (?:hides?|holds?|knows?|means?)|waiting to be (?:seen|found)|yet to (?:see|find))\b/i
export function isMessageFrame(text) {
    const t = String(text || '')
    return FRAME_CARRIER.test(t) && FRAME_ELSEWHERE.test(t)
}

/**
 * Drops bullets, never headers or prose, so the file still parses even if
 * every bullet goes. banned words checked first so a dropped line doesnt use
 * up a subject slot.
 *
 * subjectCeiling caps one stem. ideaCeiling caps a PAIR of stems, becuase a
 * fixation that learned synonyms sits under the word cap: victor's memory was
 * glint 4, spark 4, glow 4, firefly 4, all right on the ceiling, 17 of 31
 * bullets the same thought. the anchor words keep turning up together though.
 * (ported from the sim's MemoryEcology.) frameCeiling caps isMessageFrame
 * lines, first N in file order win so new ones cant rotate old ones out.
 * 0 turns any of them off.
 */
export function filterRecord(markdown, { banned = [], subjectCeiling = 0, ideaCeiling = 0, frameCeiling = 0, logger = null, what = 'record' } = {}) {
    const lines = String(markdown ?? '').split('\n')
    const counts = new Map()
    const pairCounts = new Map()
    const out = []
    let bannedDropped = 0
    let crowdedDropped = 0
    let frameKept = 0

    const pairKey = (a, b) => (a < b ? `${a} ${b}` : `${b} ${a}`)

    for (const line of lines) {
        if (!BULLET.test(line)) { out.push(line); continue }

        const hits = bannedIn(line, banned)
        if (hits.length > 0) {
            bannedDropped++
            logger?.info?.(`${what}: dropped a line for "${hits[0]}" (${line.trim().slice(0, 70)})`)
            continue
        }

        // only counted further down, once the line actually survives
        const framey = frameCeiling > 0 && isMessageFrame(line)
        if (framey && frameKept >= frameCeiling) {
            crowdedDropped++
            logger?.info?.(`${what}: dropped a line, the message-frame already holds ${frameCeiling} (${line.trim().slice(0, 70)})`)
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
        if (framey) frameKept++

        out.push(line)
    }

    return { text: out.join('\n'), banned: bannedDropped, crowded: crowdedDropped }
}
