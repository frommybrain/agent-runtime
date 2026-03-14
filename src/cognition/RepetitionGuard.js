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

    clear() {
        this.history = []
    }
}
