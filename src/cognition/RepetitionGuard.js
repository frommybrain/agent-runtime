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

        // 5. Speech repetition — flag repeated phrases
        if (this._recentSpeech.length >= 2) {
            const last = this._recentSpeech[this._recentSpeech.length - 1]
            const repeated = this._recentSpeech.filter(s => s === last).length
            if (repeated >= 2) {
                warnings.push(`You already said "${last}" recently. Say something completely different.`)
            }
            // Also flag generic/similar phrases (starts with same 3+ words)
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

    clear() {
        this.history = []
        this._recentSpeech = []
    }
}
