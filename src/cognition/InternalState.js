// internal state. mood and energy, both -1..1.
// these arent instructions, theyre sensations. environment shifts them,
// the persona + LLM decide what to do with it.
//
// mood:   neg ↔ pos  (bad ↔ good)
// energy: low ↔ high (calm ↔ activated)
//
// nudged by signals, action outcomes, social events, novelty.
// high energy moments get encoded harder in memory (salience).
// LLM sees these as vibes, not commands.
//
// v0.3: checkpoints to disk so state survives a crash.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'

export class InternalState {
    constructor(config, logger) {
        this.mood = 0
        this.energy = 0
        this.logger = logger

        this.decayRate = config.stateDecayRate || 0.1
        this.signalPullRate = config.signalPullRate || 0.15
        this._history = []  // recent state for sleep reflection
        this._maxHistory = 50
        this._checkpointPath = join(config.dataDir, 'state-checkpoint.json')
        this._prevEntityIds = null    // stability tracking
        this._stabilityStreak = 0     // how many ticks the same entities have been around
    }

    // called each tick with context from the cycle
    // context: { actionResult, deltas, environmentSignals, worldEvents }
    update(context) {
        const before = { mood: this.mood, energy: this.energy }

        // 1. decay toward neutral. nothing lasts forever
        this.mood *= (1 - this.decayRate)
        this.energy *= (1 - this.decayRate)

        // 2. action results. asymmetric on purpose: failure stings, success is mild.
        //    without this, mood decays to 0 and flatlines when theres no signals.
        if (context.actionResult) {
            if (!context.actionResult.success) {
                this._nudgeMood(-0.15)
            } else {
                // mild positive nudge keeps mood slightly above zero when youre acting
                this._nudgeMood(0.02)
                // exploration reward — interact = discovery, should feel good
                if (context.actionResult.action === 'interact') {
                    this._nudgeMood(0.04)
                }
            }
        }

        // 3. environmental changes. novelty = energy spike, once per tick.
        //    familiarity discount: if the same entities have been around for 5+ ticks
        //    delta noise is mostly positional. only appearances/disappearances reset streak.
        if (context.deltas?.length > 0) {
            const hasStructuralChange = context.deltas.some(
                d => d.type === 'appeared' || d.type === 'disappeared'
            )
            const familiarityDiscount = (!hasStructuralChange && this._stabilityStreak >= 5) ? 0.5 : 1.0
            const intensity = Math.min(context.deltas.length / 5, 1)
            this._nudgeEnergy(intensity * 0.2 * familiarityDiscount)
        }

        // 4. continuous signals. ATTRACTORS not additive nudges.
        //    signals pull state toward a target. resonance 0.8 pulls energy to 0.8.
        //    when resonance drops, energy decays naturally via decay rate.
        //    stops pinning to ±1.0 from sustained signals.
        if (context.environmentSignals) {
            const s = context.environmentSignals
            const pull = this.signalPullRate

            if (s.vitality !== undefined) {
                // vitality drives mood: 0→-0.8, 0.5→0, 1→+0.8
                const target = (s.vitality - 0.5) * 1.6
                this.mood += (target - this.mood) * pull
            }
            if (s.resonance !== undefined) {
                // resonance pulls energy toward its value
                const target = s.resonance
                this.energy += (target - this.energy) * pull
            }
            if (s.warmth !== undefined) {
                // warmth: centered like vitality. 0→-0.3, 0.5→0, 1→+0.3
                const target = (s.warmth - 0.5) * 0.6
                this.mood += (target - this.mood) * pull * 0.7
            }
            if (s.abundance !== undefined) {
                // abundance: gentle. 0→-0.2, 0.5→0, 1→+0.2
                const target = (s.abundance - 0.5) * 0.4
                this.mood += (target - this.mood) * pull * 0.4
            }
            // arbitrary numeric signals in 0..1 — gently pull energy.
            // skip large values (eg bpm: 120) since those are data not vibes.
            // gentle multiplier (0.1) so energy doesnt saturate in signal-rich envs.
            for (const [key, val] of Object.entries(s)) {
                if (['vitality', 'resonance', 'warmth', 'abundance'].includes(key)) continue
                if (typeof val === 'number' && val >= 0 && val <= 1) {
                    this.energy += (val * 0.3 - this.energy) * pull * 0.1
                }
            }
        }

        // 5. social events. one-time nudges (events, not continuous)
        if (context.worldEvents?.length > 0) {
            for (const evt of context.worldEvents) {
                const data = evt.data || evt
                if (data.event === 'agent_speech') {
                    this._nudgeEnergy(0.1)
                    this._nudgeMood(0.03)
                } else if (data.event === 'agent_joined') {
                    this._nudgeEnergy(0.08)
                } else if (data.event === 'agent_left') {
                    this._nudgeMood(-0.03)
                }
            }
        }

        // clamp
        this.mood = this._clamp(this.mood)
        this.energy = this._clamp(this.energy)

        // record history for reflection
        this._history.push({
            time: Date.now(),
            mood: this.mood,
            energy: this.energy,
        })
        if (this._history.length > this._maxHistory) this._history.shift()

        // log significant shifts
        const vDelta = Math.abs(this.mood - before.mood)
        const aDelta = Math.abs(this.energy - before.energy)
        if (vDelta > 0.1 || aDelta > 0.1) {
            this.logger.debug(`State shift: v=${this.mood.toFixed(2)} a=${this.energy.toFixed(2)}`)
        }
    }

    // describe state for the LLM — sensation, not instruction
    describe() {
        const v = this.mood
        const a = this.energy
        const vLabel = v > 0.4 ? 'very positive' : v > 0.15 ? 'positive'
            : v > -0.1 ? 'neutral' : v > -0.35 ? 'negative' : 'very negative'
        const aLabel = a > 0.5 ? 'very high' : a > 0.2 ? 'elevated'
            : a > -0.2 ? 'moderate' : a > -0.5 ? 'low' : 'very low'

        // evocative descriptions so the LLM has something to act on.
        // granular grid to avoid the neutral-catchall bucket
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
            mood: this.mood,
            energy: this.energy,
            moodLabel: vLabel,
            energyLabel: aLabel,
            description,
        }
    }

    // track entity stability. how many consecutive ticks the same entities are present.
    // called each tick with the nearby entity IDs.
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

    // creativity feedback from speech scoring.
    // repetition makes the world feel duller (mood drops).
    // novelty is mildly rewarding (mood nudges up).
    // the agent never knows why, it just feels the shift.
    applySpeechCreativity(score) {
        if (score < 0.4) {
            // repetitive — sharp penalty (asymmetric, like failure)
            this._nudgeMood(-0.08)
        } else if (score > 0.8) {
            // creative — mild reward
            this._nudgeMood(0.03)
        }
        // 0.4-0.8: neutral, no effect
    }

    // salience multiplier. high-energy moments are remembered more strongly.
    // returns 0.5 (calm, low salience) to 1.0 (peak energy, full salience)
    salience() {
        return 0.5 + Math.abs(this.energy) * 0.5
    }

    // summary for sleep reflection
    historySummary() {
        if (this._history.length === 0) return 'No state history recorded.'
        const avgV = this._history.reduce((s, h) => s + h.mood, 0) / this._history.length
        const avgA = this._history.reduce((s, h) => s + h.energy, 0) / this._history.length
        const peakA = Math.max(...this._history.map(h => Math.abs(h.energy)))
        const lowestV = Math.min(...this._history.map(h => h.mood))
        const highestV = Math.max(...this._history.map(h => h.mood))
        return `Average mood: ${avgV.toFixed(2)}, average energy: ${avgA.toFixed(2)}. Peak energy: ${peakA.toFixed(2)}. Mood range: ${lowestV.toFixed(2)} to ${highestV.toFixed(2)}.`
    }

    clearHistory() {
        this._history = []
    }

    // save state to disk (crash recovery)
    // extra: other fields to persist alongside mood/energy (eg tickCount)
    async checkpoint(extra = {}) {
        try {
            const data = {
                mood: this.mood,
                energy: this.energy,
                timestamp: Date.now(),
                ...extra,
            }
            // Atomic write: a crash or power loss mid-write would otherwise
            // truncate the checkpoint and lose the bird's state on restart.
            // Write to a temp file then rename (atomic on the same fs).
            const tmp = `${this._checkpointPath}.tmp`
            await writeFile(tmp, JSON.stringify(data), 'utf-8')
            await rename(tmp, this._checkpointPath)
        } catch (err) {
            this.logger.error(`State checkpoint failed: ${err.message}`)
        }
    }

    // restore from last checkpoint (called on startup).
    // returns full checkpoint data (incl extras like tickCount) or null
    async restore() {
        try {
            const raw = await readFile(this._checkpointPath, 'utf-8')
            const data = JSON.parse(raw)
            // only restore if checkpoint is less than 1hr old
            const ageMs = Date.now() - (data.timestamp || 0)
            if (ageMs < 60 * 60 * 1000) {
                this.mood = this._clamp(data.mood || 0)
                this.energy = this._clamp(data.energy || 0)
                this.logger.info(`State restored from checkpoint (age: ${Math.round(ageMs / 1000)}s) — v=${this.mood.toFixed(2)} a=${this.energy.toFixed(2)}`)
                return data
            }
            this.logger.info(`State checkpoint too old (${Math.round(ageMs / 60000)}min), starting fresh`)
        } catch {
            // no checkpoint file, first run
        }
        return null
    }

    _nudgeMood(delta) {
        this.mood = this._clamp(this.mood + delta)
    }

    _nudgeEnergy(delta) {
        this.energy = this._clamp(this.energy + delta)
    }

    _clamp(v) {
        return Math.max(-1, Math.min(1, v))
    }
}
