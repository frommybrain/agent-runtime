// Internal state: valence (-1..1) and arousal (-1..1)
// These are NOT instructions — they are sensations the agent feels.
// The environment shifts them. The agent's persona + LLM decide what to do about it.
//
// valence: negative ←→ positive (bad ←→ good)
// arousal: calm/low-energy ←→ excited/high-energy
//
// Environmental signals, action outcomes, social events, and novelty all nudge these values.
// High arousal moments are encoded more strongly in memory (salience).
// The LLM receives these as context, not directives.

export class InternalState {
    constructor(config, logger) {
        this.valence = 0
        this.arousal = 0
        this.logger = logger

        this.decayRate = config.stateDecayRate || 0.1
        this.signalPullRate = config.signalPullRate || 0.15
        this._history = []  // track recent state for sleep reflection
        this._maxHistory = 50
    }

    // Called each tick with context from the current cycle
    // context: { actionResult, deltas, environmentSignals, worldEvents }
    update(context) {
        const before = { valence: this.valence, arousal: this.arousal }

        // 1. Decay toward neutral — state doesn't persist forever
        this.valence *= (1 - this.decayRate)
        this.arousal *= (1 - this.decayRate)

        // 2. Action results — one-time nudges (events, not continuous)
        //    Success is routine and should barely register.
        //    Failure is noteworthy and should dip valence.
        if (context.actionResult) {
            if (context.actionResult.success) {
                this._nudgeValence(0.03)
            } else {
                this._nudgeValence(-0.1)
            }
        }

        // 3. Environmental changes — novelty = arousal spike (one-time per tick)
        if (context.deltas?.length > 0) {
            const intensity = Math.min(context.deltas.length / 5, 1)
            this._nudgeArousal(intensity * 0.2)
        }

        // 4. Continuous signals — ATTRACTORS, not additive nudges.
        //    Signals pull state toward an equilibrium. Resonance 0.8 pulls arousal
        //    toward 0.8. When resonance drops, arousal decays naturally via decay rate.
        //    This prevents pinning to ±1.0 from sustained signals.
        if (context.environmentSignals) {
            const s = context.environmentSignals
            const pull = this.signalPullRate

            if (s.vitality !== undefined) {
                // Vitality maps to valence: 0→-0.5, 0.5→0, 1→+0.5
                const target = (s.vitality - 0.5)
                this.valence += (target - this.valence) * pull
            }
            if (s.resonance !== undefined) {
                // Resonance pulls arousal toward its value
                const target = s.resonance
                this.arousal += (target - this.arousal) * pull
            }
            if (s.warmth !== undefined) {
                // Warmth pulls valence positive (0→0, 1→+0.5)
                const target = s.warmth * 0.5
                this.valence += (target - this.valence) * pull * 0.5
            }
            if (s.abundance !== undefined) {
                // Abundance gently pulls valence (0→-0.2, 0.5→0, 1→+0.2)
                const target = (s.abundance - 0.5) * 0.4
                this.valence += (target - this.valence) * pull * 0.3
            }
            // Arbitrary numeric signals — gently pull arousal up
            for (const [key, val] of Object.entries(s)) {
                if (['vitality', 'resonance', 'warmth', 'abundance'].includes(key)) continue
                if (typeof val === 'number') {
                    this.arousal += (Math.abs(val) * 0.3 - this.arousal) * pull * 0.2
                }
            }
        }

        // 5. Social events — one-time nudges (events, not continuous)
        if (context.worldEvents?.length > 0) {
            for (const evt of context.worldEvents) {
                const data = evt.data || evt
                if (data.event === 'agent_speech') {
                    this._nudgeArousal(0.1)
                    this._nudgeValence(0.03)
                } else if (data.event === 'agent_joined') {
                    this._nudgeArousal(0.08)
                } else if (data.event === 'agent_left') {
                    this._nudgeValence(-0.03)
                }
            }
        }

        // Clamp
        this.valence = this._clamp(this.valence)
        this.arousal = this._clamp(this.arousal)

        // Record history for reflection
        this._history.push({
            time: Date.now(),
            valence: this.valence,
            arousal: this.arousal,
        })
        if (this._history.length > this._maxHistory) this._history.shift()

        // Log significant shifts
        const vDelta = Math.abs(this.valence - before.valence)
        const aDelta = Math.abs(this.arousal - before.arousal)
        if (vDelta > 0.1 || aDelta > 0.1) {
            this.logger.debug(`State shift: v=${this.valence.toFixed(2)} a=${this.arousal.toFixed(2)}`)
        }
    }

    // Describe internal state for the LLM — sensation, not instruction
    describe() {
        const vLabel = this.valence > 0.3 ? 'positive'
            : this.valence < -0.3 ? 'negative' : 'neutral'
        const aLabel = this.arousal > 0.3 ? 'high'
            : this.arousal < -0.3 ? 'low' : 'moderate'

        return {
            valence: this.valence,
            arousal: this.arousal,
            valenceLabel: vLabel,
            arousalLabel: aLabel,
            description: `Feeling ${vLabel} with ${aLabel} energy`,
        }
    }

    // Salience multiplier — high arousal moments are remembered more strongly
    // Returns 0.5 (calm, low salience) to 1.0 (peak arousal, full salience)
    salience() {
        return 0.5 + Math.abs(this.arousal) * 0.5
    }

    // Summary for sleep reflection
    historySummary() {
        if (this._history.length === 0) return 'No state history recorded.'
        const avgV = this._history.reduce((s, h) => s + h.valence, 0) / this._history.length
        const avgA = this._history.reduce((s, h) => s + h.arousal, 0) / this._history.length
        const peakA = Math.max(...this._history.map(h => Math.abs(h.arousal)))
        const lowestV = Math.min(...this._history.map(h => h.valence))
        const highestV = Math.max(...this._history.map(h => h.valence))
        return `Average valence: ${avgV.toFixed(2)}, average arousal: ${avgA.toFixed(2)}. Peak arousal: ${peakA.toFixed(2)}. Valence range: ${lowestV.toFixed(2)} to ${highestV.toFixed(2)}.`
    }

    clearHistory() {
        this._history = []
    }

    _nudgeValence(delta) {
        this.valence = this._clamp(this.valence + delta)
    }

    _nudgeArousal(delta) {
        this.arousal = this._clamp(this.arousal + delta)
    }

    _clamp(v) {
        return Math.max(-1, Math.min(1, v))
    }
}
