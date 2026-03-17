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
//
// v0.3: checkpoint/restore for crash recovery — state persists across restarts.

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export class InternalState {
    constructor(config, logger) {
        this.valence = 0
        this.arousal = 0
        this.logger = logger

        this.decayRate = config.stateDecayRate || 0.1
        this.signalPullRate = config.signalPullRate || 0.15
        this._history = []  // track recent state for sleep reflection
        this._maxHistory = 50
        this._checkpointPath = join(config.dataDir, 'state-checkpoint.json')
        this._prevEntityIds = null    // for stability tracking
        this._stabilityStreak = 0     // how many ticks the same entities have been present
    }

    // Called each tick with context from the current cycle
    // context: { actionResult, deltas, environmentSignals, worldEvents }
    update(context) {
        const before = { valence: this.valence, arousal: this.arousal }

        // 1. Decay toward neutral — state doesn't persist forever
        this.valence *= (1 - this.decayRate)
        this.arousal *= (1 - this.decayRate)

        // 2. Action results — asymmetric: failure is sharp, success is gentle.
        //    Without this, valence decays to 0 and flatlines in signal-free environments.
        if (context.actionResult) {
            if (!context.actionResult.success) {
                this._nudgeValence(-0.15)
            } else {
                // Mild positive: keeps valence slightly above zero when acting successfully
                this._nudgeValence(0.02)
                // Exploration reward: interact is discovery, it should feel good
                if (context.actionResult.action === 'interact') {
                    this._nudgeValence(0.04)
                }
            }
        }

        // 3. Environmental changes — novelty = arousal spike (one-time per tick)
        //    Familiarity discount: if the same entities have been present for 5+ ticks,
        //    property deltas are likely noise (positional changes), not genuine novelty.
        //    Only entity appearances/disappearances break the stability streak.
        if (context.deltas?.length > 0) {
            const hasStructuralChange = context.deltas.some(
                d => d.type === 'appeared' || d.type === 'disappeared'
            )
            const familiarityDiscount = (!hasStructuralChange && this._stabilityStreak >= 5) ? 0.5 : 1.0
            const intensity = Math.min(context.deltas.length / 5, 1)
            this._nudgeArousal(intensity * 0.2 * familiarityDiscount)
        }

        // 4. Continuous signals — ATTRACTORS, not additive nudges.
        //    Signals pull state toward an equilibrium. Resonance 0.8 pulls arousal
        //    toward 0.8. When resonance drops, arousal decays naturally via decay rate.
        //    This prevents pinning to ±1.0 from sustained signals.
        if (context.environmentSignals) {
            const s = context.environmentSignals
            const pull = this.signalPullRate

            if (s.vitality !== undefined) {
                // Vitality is the primary valence driver: 0→-0.8, 0.5→0, 1→+0.8
                const target = (s.vitality - 0.5) * 1.6
                this.valence += (target - this.valence) * pull
            }
            if (s.resonance !== undefined) {
                // Resonance pulls arousal toward its value
                const target = s.resonance
                this.arousal += (target - this.arousal) * pull
            }
            if (s.warmth !== undefined) {
                // Warmth: centered like vitality. 0→-0.3, 0.5→0, 1→+0.3
                const target = (s.warmth - 0.5) * 0.6
                this.valence += (target - this.valence) * pull * 0.7
            }
            if (s.abundance !== undefined) {
                // Abundance: gentle. 0→-0.2, 0.5→0, 1→+0.2
                const target = (s.abundance - 0.5) * 0.4
                this.valence += (target - this.valence) * pull * 0.4
            }
            // Arbitrary numeric signals in 0..1 range — gently pull arousal
            // Skip large values (e.g. bpm: 120) — those are data, not affect signals
            // Gentle multiplier (0.1) to prevent arousal saturation in signal-rich environments
            for (const [key, val] of Object.entries(s)) {
                if (['vitality', 'resonance', 'warmth', 'abundance'].includes(key)) continue
                if (typeof val === 'number' && val >= 0 && val <= 1) {
                    this.arousal += (val * 0.3 - this.arousal) * pull * 0.1
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
        const v = this.valence
        const a = this.arousal
        const vLabel = v > 0.4 ? 'very positive' : v > 0.15 ? 'positive'
            : v > -0.1 ? 'neutral' : v > -0.35 ? 'negative' : 'very negative'
        const aLabel = a > 0.5 ? 'very high' : a > 0.2 ? 'elevated'
            : a > -0.2 ? 'moderate' : a > -0.5 ? 'low' : 'very low'

        // Evocative descriptions — give the LLM something to act on
        // Granular grid to minimise the "neutral catch-all" bucket
        let description
        if (v > 0.3 && a > 0.5) description = 'A rush of excitement — everything is clicking'
        else if (v > 0.3 && a > 0.2) description = 'A surge of energy and satisfaction — things are going well'
        else if (v > 0.3) description = 'A quiet contentment — things feel right'
        else if (v > 0.1 && a > 0.4) description = 'Feeling alert and engaged — something has your attention'
        else if (v > 0.1 && a > 0.15) description = 'A comfortable focus — present and attentive'
        else if (v > 0.1) description = 'A gentle ease — nothing wrong, mildly pleasant'
        else if (v > -0.05 && a > 0.4) description = 'Buzzing with energy — the environment is stimulating'
        else if (v > -0.05 && a > 0.15) description = 'Feeling awake and aware — taking things in'
        else if (v > -0.05 && a > -0.15) description = 'Feeling steady — calm, present, unremarkable'
        else if (v > -0.05) description = 'Everything is quiet and still — understimulated'
        else if (v > -0.2 && a > 0.3) description = 'A nagging discomfort — restless, things could be better'
        else if (v > -0.2 && a > 0) description = 'A subtle unease — something is slightly off'
        else if (v > -0.2) description = 'Feeling flat and disengaged — low energy, mild discontent'
        else if (v <= -0.2 && a > 0.3) description = 'Something feels wrong — uneasy, on edge'
        else if (v <= -0.2 && a > -0.2) description = 'A growing frustration — things are not going well'
        else description = 'Feeling drained and discouraged — nothing is working'

        return {
            valence: this.valence,
            arousal: this.arousal,
            valenceLabel: vLabel,
            arousalLabel: aLabel,
            description,
        }
    }

    // Track entity stability — how many consecutive ticks the same entities are present.
    // Called each tick with the set of nearby entity IDs.
    updateStability(entityIds) {
        const currentSet = new Set(entityIds || [])
        if (this._prevEntityIds && this._setsEqual(currentSet, this._prevEntityIds)) {
            this._stabilityStreak++
        } else {
            this._stabilityStreak = 0
        }
        this._prevEntityIds = currentSet
    }

    _setsEqual(a, b) {
        if (a.size !== b.size) return false
        for (const item of a) {
            if (!b.has(item)) return false
        }
        return true
    }

    // Apply creativity feedback from speech scoring.
    // Repetition makes the world feel duller (valence drops).
    // Novelty is mildly rewarding (valence nudges up).
    // The agent never knows why — it just feels the shift.
    applySpeechCreativity(score) {
        if (score < 0.4) {
            // Repetitive speech — sharp penalty (asymmetric, like failure)
            this._nudgeValence(-0.08)
        } else if (score > 0.8) {
            // Creative speech — mild reward
            this._nudgeValence(0.03)
        }
        // 0.4-0.8: neutral — no effect
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

    // Save current state to disk (crash recovery)
    // extra: optional fields to persist alongside valence/arousal (e.g. tickCount)
    async checkpoint(extra = {}) {
        try {
            const data = {
                valence: this.valence,
                arousal: this.arousal,
                timestamp: Date.now(),
                ...extra,
            }
            await writeFile(this._checkpointPath, JSON.stringify(data), 'utf-8')
        } catch (err) {
            this.logger.error(`State checkpoint failed: ${err.message}`)
        }
    }

    // Restore state from last checkpoint (called on startup)
    // Returns the full checkpoint data (including extra fields like tickCount) or null
    async restore() {
        try {
            const raw = await readFile(this._checkpointPath, 'utf-8')
            const data = JSON.parse(raw)
            // Only restore if checkpoint is less than 1 hour old
            const ageMs = Date.now() - (data.timestamp || 0)
            if (ageMs < 60 * 60 * 1000) {
                this.valence = this._clamp(data.valence || 0)
                this.arousal = this._clamp(data.arousal || 0)
                this.logger.info(`State restored from checkpoint (age: ${Math.round(ageMs / 1000)}s) — v=${this.valence.toFixed(2)} a=${this.arousal.toFixed(2)}`)
                return data
            }
            this.logger.info(`State checkpoint too old (${Math.round(ageMs / 60000)}min), starting fresh`)
        } catch {
            // No checkpoint file — first run
        }
        return null
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
