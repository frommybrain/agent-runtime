// find words the agent has leaned on across its recent reasons, so the
// prompt can ban them for a turn. presence-based: a word counts once per
// reason, so a "motif" is "showed up in N separate decisions", not "said
// twice in one breath". this is the reason-phrase guard the Pi was missing
// — the model mirrors its own recent history ("hunger's a scream" x5,
// "the casino pulse", "new beat") with nothing pushing back. mirrors the
// sim's guard so both brains behave the same.

const STOPWORDS = new Set([
    'the', 'and', 'but', 'for', 'not', 'was', 'are', 'with', 'that', 'this',
    'have', 'from', 'just', 'need', 'want', 'get', 'got', 'gotta', 'going',
    'still', 'now', 'then', 'them', 'they', 'when', 'what', 'where', 'while',
    'something', 'someone', 'maybe', 'like', 'feel', 'feels', 'feeling', 'bit',
    'little', 'time', 'back', 'out', 'off', 'too', 'again', 'before', 'after',
    'more', 'than', 'into', 'over', 'keep', 'let', 'lets', 'see', 'one', 'can',
    'could', 'would', 'might', 'first', 'here', 'there', 'about',
])

// light stem so a motif's inflections collapse to one key: scream/screaming/
// screams -> "scream", hunger's/hunger -> "hunger", beat/beats -> "beat".
// only strips when >=4 chars survive, so short words aren't mangled.
// Words ending in s that are not plurals. Without these, "news" files under
// "new" and "focus" under "focu".
const NOT_PLURAL = new Set(['news', 'lens', 'gas', 'atlas', 'canvas', 'chess', 'bias'])

/**
 * Fold a word to its stem so one motif counts as one word.
 *
 * The old version required `length - suffix >= 4`, which is longer than most
 * of the words that actually become tics. "hum", "hums", "humming" and
 * "hummed" came out as three different stems, so the guard built to catch
 * the hum could never count it to its own threshold. Exported and shared
 * with the persona sanitizer so both use the same notion of one word.
 */
export function stem(w) {
    let s = String(w).toLowerCase().replace(/'s$/, '')
    if (NOT_PLURAL.has(s) || /(ss|us|is|os)$/.test(s)) return s

    for (const suf of ['ings', 'ing', 'edly', 'ed']) {
        if (s.endsWith(suf) && s.length - suf.length >= 3) {
            const base = s.slice(0, -suf.length)
            // humming -> humm -> hum, running -> runn -> run
            return /([bdfglmnprt])\1$/.test(base) ? base.slice(0, -1) : base
        }
    }
    // watches/boxes/buzzes lose "es"; ripples/hums lose just the "s"
    if (s.endsWith('es') && s.length >= 5) {
        return /(s|x|z|ch|sh)es$/.test(s) ? s.slice(0, -2) : s.slice(0, -1)
    }
    if (s.endsWith('s') && s.length >= 4) return s.slice(0, -1)
    return s
}

export function wornWords(reasons, { minCount = 3, max = 6 } = {}) {
    // stem -> { count, forms: Map(surface -> n) }. we count by stem but report
    // a real surface form (the shortest, usually the root) so the ban line
    // reads "scream" not "scre".
    const groups = new Map()
    for (const r of reasons || []) {
        if (!r) continue
        const seen = new Set()  // one vote per reason, per stem
        for (const raw of String(r).toLowerCase().split(/[^a-z']+/)) {
            const w = raw.replace(/^'+|'+$/g, '').replace(/'s$/, '')
            if (w.length < 3 || STOPWORDS.has(w)) continue
            const key = stem(w)
            if (seen.has(key)) continue
            seen.add(key)
            let g = groups.get(key)
            if (!g) { g = { count: 0, forms: new Map() }; groups.set(key, g) }
            g.count++
            g.forms.set(w, (g.forms.get(w) || 0) + 1)
        }
    }
    return [...groups.values()]
        .filter((g) => g.count >= minCount)
        .sort((a, b) => b.count - a.count)
        .slice(0, max)
        .map((g) => [...g.forms.keys()].sort((a, b) => a.length - b.length)[0])
}
