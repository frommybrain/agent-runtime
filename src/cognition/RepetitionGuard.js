// Tracks recent action patterns and flags repetition.
// Provides warnings to the LLM so it can vary its behaviour.
//
// This is the "constraints create creativity" principle from OHMAR —
// when the agent can't fall back on repetitive patterns, it has to get creative.

const STOP_WORDS = new Set([
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

export class RepetitionGuard {
    constructor(config, logger) {
        this.maxHistory = config.repetitionHistorySize || 30
        this.logger = logger
        this.history = []
        this._recentSpeech = []  // track recent speech for repetition detection
        this._targetInteractions = new Map()  // targetId → { count, lastTime }
    }

    // Record an action after it's chosen
    record(action, params) {
        const target = this._extractTarget(params)
        this.history.push({
            action,
            target,
            key: this._actionKey(action, params),
            time: Date.now(),
        })
        if (this.history.length > this.maxHistory) {
            this.history.shift()
        }
        // Track target interactions for exploration context
        if (target) {
            const entry = this._targetInteractions.get(target)
            if (entry) {
                entry.count++
                entry.lastTime = Date.now()
            } else {
                this._targetInteractions.set(target, { count: 1, lastTime: Date.now() })
            }
        }
        // Track speech content separately
        if (action === 'speak' && params?.message) {
            this._recentSpeech.push(params.message.toLowerCase().trim())
            if (this._recentSpeech.length > 20) this._recentSpeech.shift()
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

        // 2b. One TARGET dominates (>25% of recent history, any action)
        // Skip survival targets (food, nests, NPCs) — the agent needs to revisit these
        const targetCounts = {}
        for (const h of this.history) {
            if (h.target && !this._isSurvivalTarget(h.target)) {
                targetCounts[h.target] = (targetCounts[h.target] || 0) + 1
            }
        }
        for (const [target, count] of Object.entries(targetCounts)) {
            if (count / total > 0.25 && total >= 8) {
                const pct = Math.round(count / total * 100)
                const totalInteractions = this._targetInteractions.get(target)?.count || count
                if (totalInteractions >= 15) {
                    warnings.push(
                        `STOP. You have targeted "${target}" ${totalInteractions} times total and ${pct}% of recent actions. It is EXHAUSTED. There is NOTHING left to learn. You MUST choose a completely different target.`
                    )
                } else {
                    warnings.push(
                        `You have targeted "${target}" in ${count} of your last ${total} actions (${pct}%). It has nothing new to offer. Pick a DIFFERENT target.`
                    )
                }
            }
        }

        // 2c. Same target in 3+ of last 5 actions (catches spread-out fixation)
        // Skip survival targets
        const last5targets = this.history.slice(-5).map(h => h.target).filter(Boolean)
        const target5counts = {}
        for (const t of last5targets) {
            if (!this._isSurvivalTarget(t)) target5counts[t] = (target5counts[t] || 0) + 1
        }
        for (const [target, count] of Object.entries(target5counts)) {
            if (count >= 3) {
                warnings.push(`You targeted "${target}" ${count} out of your last 5 actions. Do something ELSE with a DIFFERENT target.`)
                break
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

        // 4b. Target-level cycling — catches "shiny→food→shiny→food" regardless of action
        const targetAltWarning = this._checkTargetCycling()
        if (targetAltWarning) warnings.push(targetAltWarning)

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

    // Score how creative/unique a speech message is compared to recent speech.
    // Returns 0.0 (exact repeat) to 1.0 (completely novel).
    // Call BEFORE record() so the message isn't compared against itself.
    scoreSpeech(message) {
        if (this._recentSpeech.length === 0) return 1.0

        const msgLower = message.toLowerCase().trim()
        const keywords = this._extractKeywords(msgLower)

        // Too short to judge meaningfully
        if (keywords.size < 2) return 0.5

        let maxOverlap = 0
        for (const prev of this._recentSpeech) {
            // Check exact match first
            if (prev === msgLower) return 0.0

            const prevKw = this._extractKeywords(prev)
            if (prevKw.size < 2) continue
            const overlap = [...keywords].filter(w => prevKw.has(w)).length
            const similarity = overlap / Math.min(keywords.size, prevKw.size)
            maxOverlap = Math.max(maxOverlap, similarity)
        }

        return Math.max(0, 1.0 - maxOverlap)
    }

    // Action diversity score (0 = all same, 1 = all different) — for adaptive heartbeat
    diversityScore() {
        if (this.history.length < 2) return 1
        const unique = new Set(this.history.map(h => h.action))
        return unique.size / this.history.length
    }

    // Extract target from action params (works across any environment)
    _extractTarget(params) {
        if (!params) return null
        return params.target || params.entityId || params.npcId || params.spotId || params.nestId || null
    }

    // Target diversity score (0 = all same target, 1 = all different)
    targetDiversityScore() {
        const targets = this.history.map(h => h.target).filter(Boolean)
        if (targets.length < 2) return 1
        const unique = new Set(targets)
        return unique.size / targets.length
    }

    // Build exploration context string for PromptBuilder
    // Shows what has been explored a lot vs barely touched.
    // Only flags non-essential targets (shiny objects) as exhausted.
    // Food spots, nests, and NPCs are survival targets — the agent
    // legitimately needs to keep visiting them.
    explorationContext(currentNearbyIds) {
        if (this._targetInteractions.size === 0) return null

        const exhausted = []
        const wellExplored = []
        const barelyExplored = []

        // Check nearby entities against interaction counts
        const nearbySet = new Set(currentNearbyIds || [])

        for (const [target, data] of this._targetInteractions) {
            // Skip survival targets — agent needs to keep using food/nest/NPCs
            if (this._isSurvivalTarget(target)) continue
            if (data.count >= 15) exhausted.push(`${target} (${data.count}x)`)
            else if (data.count >= 5) wellExplored.push(`${target} (${data.count}x)`)
        }

        // Find nearby things that haven't been explored much
        for (const id of nearbySet) {
            const data = this._targetInteractions.get(id)
            if (!data || data.count <= 2) barelyExplored.push(id)
        }

        if (exhausted.length === 0 && wellExplored.length === 0 && barelyExplored.length === 0) return null

        const parts = []
        if (exhausted.length > 0) {
            parts.push(`EXHAUSTED — DO NOT INSPECT: ${exhausted.join(', ')}. These have NOTHING left to learn from inspecting. Do something else.`)
        }
        if (wellExplored.length > 0) {
            parts.push(`Already explored: ${wellExplored.join(', ')}. Avoid inspecting unless you have a specific NEW reason.`)
        }
        if (barelyExplored.length > 0) {
            parts.push(`Barely explored: ${barelyExplored.join(', ')}. Prioritise these.`)
        }
        return parts.join('\n')
    }

    // Targets that the agent legitimately needs to re-use (food, nests, NPCs)
    _isSurvivalTarget(target) {
        if (!target) return false
        const id = target.toLowerCase()
        return id.startsWith('food_') || id.startsWith('nest_') ||
               // NPC names don't have underscores in the prefix (e.g. "Bean", "Pip")
               (!id.includes('_') && id !== 'wander')
    }

    // Check if a target has been interacted with too many times (hard block threshold)
    isExhausted(target) {
        const entry = this._targetInteractions.get(target)
        return entry ? entry.count >= 20 : false
    }

    // Get the interaction count for a target
    targetCount(target) {
        return this._targetInteractions.get(target)?.count || 0
    }

    // Reset exploration counts (called on sleep cycle)
    resetExploration() {
        this._targetInteractions.clear()
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

    // Detect target-level cycling: agent keeps returning to the same target
    // between other actions. E.g. shiny_02 → food_01 → shiny_02 → wander → shiny_02
    _checkTargetCycling() {
        if (this.history.length < 6) return null
        const recentTargets = this.history.slice(-10).map(h => h.target).filter(Boolean)
        if (recentTargets.length < 5) return null

        // Count how many times the most common target appears
        const counts = {}
        for (const t of recentTargets) counts[t] = (counts[t] || 0) + 1
        const [topTarget, topCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]

        // If one target appears in 40%+ of the last 10 targeted actions, it's a cycle
        if (topCount >= Math.ceil(recentTargets.length * 0.4)) {
            return `You keep returning to "${topTarget}" between other actions. This is a fixation loop. STOP targeting it entirely and do something unrelated.`
        }
        return null
    }

    // Extract meaningful keywords from speech (stop-word removal)
    _extractKeywords(text) {
        const words = text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 2)
        return new Set(words.filter(w => !STOP_WORDS.has(w)))
    }

    clear() {
        this.history = []
        this._recentSpeech = []
        this._targetInteractions.clear()
    }
}
