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

export function wornWords(reasons, { minCount = 3, max = 6 } = {}) {
    const counts = new Map()
    for (const r of reasons || []) {
        if (!r) continue
        const seen = new Set()
        for (const raw of String(r).toLowerCase().split(/[^a-z']+/)) {
            // strip wrapping quotes and the possessive 's so "hunger's" and
            // "hunger" count as one word (else a motif splits under threshold)
            const w = raw.replace(/^'+|'+$/g, '').replace(/'s$/, '')
            if (w.length < 3 || STOPWORDS.has(w) || seen.has(w)) continue
            seen.add(w)
            counts.set(w, (counts.get(w) || 0) + 1)
        }
    }
    return [...counts.entries()]
        .filter(([, n]) => n >= minCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, max)
        .map(([w]) => w)
}
