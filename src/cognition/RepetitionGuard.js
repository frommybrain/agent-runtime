// tracks recent action patterns and flags fixation.
// the warning goes INTO the next prompt as a constraint so the agent
// cant fall back on whatever it just did. constraints not instructions:
// telling an LLM "be creative" does nothing. telling it "you cant do that
// again" actually works.

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
        this._recentSpeech = []  // last 20 things he said or reasoned
        this._targetInteractions = new Map()  // targetId -> { count, lastTime }
    }

    // record an action after its chosen
    record(action, params) {
        let target = this._extractTarget(params)
        // wander is the escape hatch, not a place. counting it made wander a
        // "dominant target" and the guard told him to stop wandering
        if (target === 'wander') target = null
        this.history.push({
            action,
            target,
            key: this._actionKey(action, params),
            time: Date.now(),
        })
        if (this.history.length > this.maxHistory) {
            this.history.shift()
        }
        // for explorationContext()
        if (target) {
            const entry = this._targetInteractions.get(target)
            if (entry) {
                entry.count++
                entry.lastTime = Date.now()
            } else {
                this._targetInteractions.set(target, { count: 1, lastTime: Date.now() })
            }
        }
        // reasons count as speech. was speak-only, and he's done zero speak
        // actions in 210k ticks, so the language checks below never once fired
        // while the diary is made entirely of reasons
        const said = action === 'speak' ? params?.message : params?.reason
        if (said && String(said).trim()) {
            this._recentSpeech.push(String(said).toLowerCase().trim())
            if (this._recentSpeech.length > 20) this._recentSpeech.shift()
        }
    }

    // warning strings, or null
    check() {
        const found = this.checkDetailed()
        return found ? found.map(w => w.text) : null
    }

    // same warnings with a kind on each, for the decision log. any warning
    // bumps the tick to the quality tier (2/3 of decisions on 25 Sep)
    checkDetailed() {
        if (this.history.length < 3) return null

        const warnings = []
        const warn = (kind, text) => warnings.push({ kind, text })

        // same action 3x running
        const last3 = this.history.slice(-3)
        if (last3.every(h => h.action === last3[0].action)) {
            warn('same_action_x3', `You have done "${last3[0].action}" three times in a row. Try something different.`)
        }

        // one action over 60% of history
        const counts = {}
        for (const h of this.history) {
            counts[h.action] = (counts[h.action] || 0) + 1
        }
        const total = this.history.length
        for (const [action, count] of Object.entries(counts)) {
            if (count / total > 0.6 && total >= 5) {
                warn('action_dominates',
                    `You have been doing "${action}" ${Math.round(count / total * 100)}% of the time recently. Explore other options.`
                )
            }
        }

        // action+target combo over 30%. inspect(shiny_01), set_step(step_5), whatever
        const comboCounts = {}
        for (const h of this.history) {
            if (h.target) {
                const combo = `${h.action}:${h.target}`
                comboCounts[combo] = (comboCounts[combo] || 0) + 1
            }
        }
        for (const [combo, count] of Object.entries(comboCounts)) {
            if (count / total > 0.3 && total >= 8) {
                const pct = Math.round(count / total * 100)
                const [action, target] = combo.split(':')
                warn('combo_dominates',
                    `You have done ${action}("${target}") ${count} times (${pct}% of recent actions). Try a different approach or target.`
                )
            }
        }

        // same target 3 of last 5, the spread out version
        const last5targets = this.history.slice(-5).map(h => h.target).filter(Boolean)
        const target5counts = {}
        for (const t of last5targets) target5counts[t] = (target5counts[t] || 0) + 1
        for (const [target, count] of Object.entries(target5counts)) {
            if (count >= 3) {
                warn('target_3_of_5', `You targeted "${target}" ${count} out of your last 5 actions. Try something different.`)
                break
            }
        }

        // identical action+params 3 of last 5
        const last5keys = this.history.slice(-5).map(h => h.key)
        const keyCounts = {}
        for (const k of last5keys) {
            keyCounts[k] = (keyCounts[k] || 0) + 1
        }
        for (const [key, count] of Object.entries(keyCounts)) {
            if (count >= 3) {
                warn('same_params', 'You keep doing exactly the same thing with the same parameters. Break the pattern.')
                break
            }
        }

        // A,B,A,B or A,B,C,A,B,C
        const altWarning = this._checkAlternating()
        if (altWarning) warn('cycle', altWarning)

        // same on targets, shiny/food/shiny/food whatever the action
        const targetAltWarning = this._checkTargetCycling()
        if (targetAltWarning) warn('target_cycling', targetAltWarning)

        // talking too much
        if (total >= 5 && counts['speak']) {
            const speechPct = counts['speak'] / total
            if (speechPct > 0.35) {
                warn('talking_too_much', `You're talking too much (${Math.round(speechPct * 100)}% of actions are speech). Act more, talk less.`)
            }
        }

        // repeats, keyword overlap catches the paraphrased ones
        if (this._recentSpeech.length >= 2) {
            const last = this._recentSpeech[this._recentSpeech.length - 1]
            const lastKw = this._extractKeywords(last)

            const exactRepeats = this._recentSpeech.filter(s => s === last).length
            if (exactRepeats >= 2) {
                warn('said_before', `You already said "${last}" recently. Say something completely different.`)
            }

            // 60% keyword overlap = same idea
            if (lastKw.size >= 2) {
                const fuzzyRepeats = this._recentSpeech.slice(0, -1).filter(s => {
                    const kw = this._extractKeywords(s)
                    if (kw.size < 2) return false
                    const overlap = [...lastKw].filter(w => kw.has(w)).length
                    return overlap / Math.min(lastKw.size, kw.size) >= 0.6
                }).length
                if (fuzzyRepeats >= 1 && exactRepeats < 2) {
                    warn('said_similar', 'Your recent speech sounds very similar to something you already said. Say something with a completely different idea and different words.')
                }
            }

            // same first 3 words
            const lastWords = last.split(/\s+/).slice(0, 3).join(' ')
            if (lastWords.length > 5) {
                const similar = this._recentSpeech.filter(s => s.startsWith(lastWords)).length
                if (similar >= 3) {
                    warn('same_opening', `Your recent lines keep starting with "${lastWords}..." Start somewhere else entirely.`)
                }
            }
        }

        // vocab rut. one word turning up in a quarter of recent lines (gnaws,
        // pulse, dare, hum) reads stuck even when every line is new. not checked
        // against the persona vocab, the worst ruts are words he picked up himself
        if (this._recentSpeech.length >= 6) {
            const rutThreshold = Math.max(3, Math.ceil(this._recentSpeech.length * 0.25))
            const speechFreq = new Map()
            for (const s of this._recentSpeech) {
                for (const w of this._extractKeywords(s)) {  // Set, so once per line
                    speechFreq.set(w, (speechFreq.get(w) || 0) + 1)
                }
            }
            const overused = [...speechFreq.entries()]
                .filter(([, c]) => c >= rutThreshold)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4)
                .map(([w, c]) => `"${w}" (${c}×)`)
            if (overused.length > 0) {
                warn('wording_rut', `Your wording is narrowing. You keep reaching for ${overused.join(', ')}. Drop those words and find fresh ones.`)
            }
        }

        return warnings.length > 0 ? warnings : null
    }

    // 0 = exact repeat, 1 = new. call before record() or it gets compared
    // against itself
    scoreSpeech(message) {
        if (this._recentSpeech.length === 0) return 1.0

        const msgLower = message.toLowerCase().trim()
        const keywords = this._extractKeywords(msgLower)

        // too short to judge
        if (keywords.size < 2) return 0.5

        let maxOverlap = 0
        for (const prev of this._recentSpeech) {
            if (prev === msgLower) return 0.0

            const prevKw = this._extractKeywords(prev)
            if (prevKw.size < 2) continue
            const overlap = [...keywords].filter(w => prevKw.has(w)).length
            const similarity = overlap / Math.min(keywords.size, prevKw.size)
            maxOverlap = Math.max(maxOverlap, similarity)
        }

        return Math.max(0, 1.0 - maxOverlap)
    }

    // 0 = all same, 1 = all different. adaptive heartbeat reads this
    diversityScore() {
        if (this.history.length < 2) return 1
        const unique = new Set(this.history.map(h => h.action))
        return unique.size / this.history.length
    }

    // whichever id field the env happens to use
    _extractTarget(params) {
        if (!params) return null
        return params.target || params.entityId || params.npcId || params.spotId || params.nestId || null
    }

    targetDiversityScore() {
        const targets = this.history.map(h => h.target).filter(Boolean)
        if (targets.length < 2) return 1
        const unique = new Set(targets)
        return unique.size / targets.length
    }

    // for PromptBuilder: whats been hammered vs barely touched.
    // advisory only, he still decides
    explorationContext(currentNearbyIds) {
        if (this._targetInteractions.size === 0) return null

        const heavilyUsed = []
        const wellExplored = []
        const barelyExplored = []

        const nearbySet = new Set(currentNearbyIds || [])

        for (const [target, data] of this._targetInteractions) {
            if (data.count >= 15) heavilyUsed.push(`${target} (${data.count}x)`)
            else if (data.count >= 5) wellExplored.push(`${target} (${data.count}x)`)
        }

        // find nearby stuff that hasnt been explored much
        for (const id of nearbySet) {
            const data = this._targetInteractions.get(id)
            if (!data || data.count <= 2) barelyExplored.push(id)
        }

        if (heavilyUsed.length === 0 && wellExplored.length === 0 && barelyExplored.length === 0) return null

        const parts = []
        if (heavilyUsed.length > 0) {
            parts.push(`Heavily used: ${heavilyUsed.join(', ')}. Consider varying your approach. Try different targets or actions.`)
        }
        if (wellExplored.length > 0) {
            parts.push(`Well explored: ${wellExplored.join(', ')}.`)
        }
        if (barelyExplored.length > 0) {
            parts.push(`Barely explored: ${barelyExplored.join(', ')}. Prioritise these.`)
        }
        return parts.join('\n')
    }

    // action+target combo at 40%+ of the window
    isFixated(action, target) {
        if (this.history.length < 10) return false
        const combo = `${action}:${target}`
        const recent = this.history.slice(-this.maxHistory)
        const count = recent.filter(h => `${h.action}:${h.target}` === combo).length
        return count / recent.length >= 0.4
    }

    // same target accross any action. inspect(spot) + move_to(spot) + wait
    // never gets one combo to 40%, which was the "only stares at cameras" bug
    isTargetFixated(target) {
        if (!target || target === 'wander') return false
        if (this.history.length < 10) return false
        const recent = this.history.slice(-this.maxHistory)
        const count = recent.filter(h => h.target === target).length
        return count / recent.length >= 0.4
    }

    targetCount(target) {
        const recent = this.history.slice(-this.maxHistory)
        return recent.filter(h => h.target === target).length
    }

    comboCount(action, target) {
        const combo = `${action}:${target}`
        return this.history.filter(h => `${h.action}:${h.target}` === combo).length
    }

    // on sleep
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

    _checkAlternating() {
        if (this.history.length < 6) return null
        const recent = this.history.slice(-8).map(h => h.action)

        // cycles of 2 and 3
        for (const len of [2, 3]) {
            if (recent.length < len * 2) continue
            const tail = recent.slice(-len * 3)  // last 3 cycles worth
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

    // keeps coming back to one target in between other things,
    // eg shiny_02, food_01, shiny_02, wander, shiny_02
    _checkTargetCycling() {
        if (this.history.length < 6) return null
        const recentTargets = this.history.slice(-10).map(h => h.target).filter(Boolean)
        if (recentTargets.length < 5) return null

        const counts = {}
        for (const t of recentTargets) counts[t] = (counts[t] || 0) + 1
        const [topTarget, topCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]

        // 40%+ of the last 10 targeted actions
        if (topCount >= Math.ceil(recentTargets.length * 0.4)) {
            return `You keep returning to "${topTarget}" between other actions. This is a fixation loop. STOP targeting it entirely and do something unrelated.`
        }
        return null
    }

    // no stop words, nothing under 3 chars
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
