// Tracks recent action patterns and flags repetition.
// Provides warnings to the LLM so it can vary its behaviour.
//
// This is the "constraints create creativity" principle from OHMAR —
// when the agent can't fall back on repetitive patterns, it has to get creative.

export class RepetitionGuard {
    constructor(config, logger) {
        this.maxHistory = config.repetitionHistorySize || 20
        this.logger = logger
        this.history = []
        this._recentSpeech = []  // track recent speech for repetition detection
    }

    // Record an action after it's chosen
    record(action, params) {
        this.history.push({
            action,
            key: this._actionKey(action, params),
            time: Date.now(),
        })
        if (this.history.length > this.maxHistory) {
            this.history.shift()
        }
        // Track speech content separately
        if (action === 'speak' && params?.message) {
            this._recentSpeech.push(params.message.toLowerCase().trim())
            if (this._recentSpeech.length > 10) this._recentSpeech.shift()
        }
    }

    // Check for repetition patterns — returns array of warnings or null
    check() {
        if (this.history.length < 3) return null

        const warnings = []

        // 1. Same action 3+ times consecutively
        const last3 = this.history.slice(-3)
        if (last3.every(h => h.action === last3[0].action)) {
            warnings.push(`You have done "${last3[0].action}" three times in a row. Try something different.`)
        }

        // 2. One action dominates (>60% of recent history)
        const counts = {}
        for (const h of this.history) {
            counts[h.action] = (counts[h.action] || 0) + 1
        }
        const total = this.history.length
        for (const [action, count] of Object.entries(counts)) {
            if (count / total > 0.6 && total >= 5) {
                warnings.push(
                    `You have been doing "${action}" ${Math.round(count / total * 100)}% of the time recently. Explore other options.`
                )
            }
        }

        // 3. Exact same action+params repeated 3+ times in last 5
        const last5keys = this.history.slice(-5).map(h => h.key)
        const keyCounts = {}
        for (const k of last5keys) {
            keyCounts[k] = (keyCounts[k] || 0) + 1
        }
        for (const [key, count] of Object.entries(keyCounts)) {
            if (count >= 3) {
                warnings.push('You keep doing exactly the same thing with the same parameters. Break the pattern.')
                break
            }
        }

        // 4. Alternating pattern detection (A→B→A→B or A→B→C→A→B→C)
        const altWarning = this._checkAlternating()
        if (altWarning) warnings.push(altWarning)

        // 5. Speech frequency — cap at ~30% of recent actions
        if (total >= 5 && counts['speak']) {
            const speechPct = counts['speak'] / total
            if (speechPct > 0.35) {
                warnings.push(`You're talking too much (${Math.round(speechPct * 100)}% of actions are speech). Act more, talk less.`)
            }
        }

        // 6. Speech repetition — fuzzy keyword matching to catch paraphrased repeats
        if (this._recentSpeech.length >= 2) {
            const last = this._recentSpeech[this._recentSpeech.length - 1]
            const lastKw = this._extractKeywords(last)

            // Exact match
            const exactRepeats = this._recentSpeech.filter(s => s === last).length
            if (exactRepeats >= 2) {
                warnings.push(`You already said "${last}" recently. Say something completely different.`)
            }

            // Fuzzy match — 60% keyword overlap = "same idea"
            if (lastKw.size >= 2) {
                const fuzzyRepeats = this._recentSpeech.slice(0, -1).filter(s => {
                    const kw = this._extractKeywords(s)
                    if (kw.size < 2) return false
                    const overlap = [...lastKw].filter(w => kw.has(w)).length
                    return overlap / Math.min(lastKw.size, kw.size) >= 0.6
                }).length
                if (fuzzyRepeats >= 1 && exactRepeats < 2) {
                    warnings.push('Your recent speech sounds very similar to something you already said. Say something with a completely different idea and different words.')
                }
            }

            // Flag generic openings (starts with same 3+ words)
            const lastWords = last.split(/\s+/).slice(0, 3).join(' ')
            if (lastWords.length > 5) {
                const similar = this._recentSpeech.filter(s => s.startsWith(lastWords)).length
                if (similar >= 3) {
                    warnings.push(`Your recent speech keeps starting with "${lastWords}..." — vary your language.`)
                }
            }
        }

        return warnings.length > 0 ? warnings : null
    }

    // Action diversity score (0 = all same, 1 = all different) — for adaptive heartbeat
    diversityScore() {
        if (this.history.length < 2) return 1
        const unique = new Set(this.history.map(h => h.action))
        return unique.size / this.history.length
    }

    _actionKey(action, params) {
        const normalized = {}
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                normalized[k] = typeof v === 'number' ? Math.round(v) : v
            }
        }
        return `${action}:${JSON.stringify(normalized)}`
    }

    // Detect alternating/cycling patterns like A→B→A→B or A→B→C→A→B→C
    _checkAlternating() {
        if (this.history.length < 6) return null
        const recent = this.history.slice(-8).map(h => h.action)

        // Check cycle lengths 2 and 3
        for (const len of [2, 3]) {
            if (recent.length < len * 2) continue
            const tail = recent.slice(-len * 3)  // look at last 3 cycles worth
            let matches = 0
            for (let i = len; i < tail.length; i++) {
                if (tail[i] === tail[i - len]) matches++
            }
            const possible = tail.length - len
            if (possible > 0 && matches / possible >= 0.8) {
                const cycle = recent.slice(-len).join(' → ')
                return `You are stuck in a repeating cycle: ${cycle}. Break out of this loop.`
            }
        }
        return null
    }

    // Extract meaningful keywords from speech (stop-word removal)
    _extractKeywords(text) {
        const stops = new Set([
            'i', 'me', 'my', 'the', 'a', 'an', 'is', 'am', 'are', 'was', 'were',
            'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
            'will', 'would', 'could', 'should', 'shall', 'can', 'may', 'might',
            'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'up',
            'about', 'into', 'through', 'after', 'over', 'between', 'out',
            'and', 'but', 'or', 'nor', 'not', 'no', 'so', 'if', 'then',
            'that', 'this', 'it', 'its', 'what', 'which', 'who', 'whom',
            'there', 'here', 'when', 'where', 'why', 'how', 'all', 'each',
            'some', 'any', 'just', 'very', 'quite', 'really', 'now', 'well',
            'also', 'than', 'too', 'only', 'right', 'let', 'see', 'hmm',
            'going', 'got', 'get', 'like', 'know', 'think', 'look', 'come',
        ])
        const words = text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 2)
        return new Set(words.filter(w => !stops.has(w)))
    }

    clear() {
        this.history = []
        this._recentSpeech = []
    }
}
