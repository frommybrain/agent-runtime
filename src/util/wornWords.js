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
function stem(w) {
    let s = w.replace(/'s$/, '')
    for (const suf of ['ings', 'ing', 'edly', 'ed', 'es', 's']) {
        if (s.length - suf.length >= 4 && s.endsWith(suf)) return s.slice(0, -suf.length)
    }
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
