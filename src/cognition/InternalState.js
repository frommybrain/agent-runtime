// mood and energy, both -1..1. sensations not instructions, the world
// nudges them and the persona + LLM decide what to do about it.
// high energy moments get remembered harder (salience).
// checkpointed to disk so a crash doesnt reset him

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'

export class InternalState {
    constructor(config, logger) {
        this.mood = 0
        this.energy = 0
        this.logger = logger

        this.decayRate = config.stateDecayRate || 0.1
        this.signalPullRate = config.signalPullRate || 0.15
        this._history = []  // for sleep reflection
        this._maxHistory = 50
        this._checkpointPath = join(config.dataDir, 'state-checkpoint.json')
        this._prevEntityIds = null
        this._stabilityStreak = 0     // ticks the same entities have been around
    }

    // context: { actionResult, deltas, environmentSignals, worldEvents }
    update(context) {
        const before = { mood: this.mood, energy: this.energy }

        // decay toward neutral
        this.mood *= (1 - this.decayRate)
        this.energy *= (1 - this.decayRate)

        // asymmetric on purpose, failure stings and success barely registers.
        // without it mood decays to 0 and flatlines when theres no signals
        if (context.actionResult) {
            if (!context.actionResult.success) {
                this._nudgeMood(-0.15)
            } else {
                this._nudgeMood(0.02)
                // interacting is discovery, little extra for that
                if (context.actionResult.action === 'interact') {
                    this._nudgeMood(0.04)
                }
            }
        }

        // novelty bumps energy, once per tick. if the same things have been
        // around 5+ ticks the deltas are mostly position noise so halve it,
        // unless something actually came or went
        if (context.deltas?.length > 0) {
            const hasStructuralChange = context.deltas.some(
                d => d.type === 'appeared' || d.type === 'disappeared'
            )
            const familiarityDiscount = (!hasStructuralChange && this._stabilityStreak >= 5) ? 0.5 : 1.0
            const intensity = Math.min(context.deltas.length / 5, 1)
            this._nudgeEnergy(intensity * 0.2 * familiarityDiscount)
        }

        // signals pull toward a target rather than adding. additive nudges
        // pinned him at +/-1 whenever a signal stayed high
        if (context.environmentSignals) {
            const s = context.environmentSignals
            const pull = this.signalPullRate

            if (s.vitality !== undefined) {
                // 0 -> -0.8, 0.5 -> 0, 1 -> +0.8
                const target = (s.vitality - 0.5) * 1.6
                this.mood += (target - this.mood) * pull
            }
            if (s.resonance !== undefined) {
                const target = s.resonance
                this.energy += (target - this.energy) * pull
            }
            if (s.warmth !== undefined) {
                // same shape, +/-0.3
                const target = (s.warmth - 0.5) * 0.6
                this.mood += (target - this.mood) * pull * 0.7
            }
            if (s.abundance !== undefined) {
                // gentler again
                const target = (s.abundance - 0.5) * 0.4
                this.mood += (target - this.mood) * pull * 0.4
            }
            // any other 0..1 number nudges energy a little. bpm: 120 etc is data, skip.
            // 0.1 or energy saturates in envs with lots of signals
            for (const [key, val] of Object.entries(s)) {
                if (['vitality', 'resonance', 'warmth', 'abundance'].includes(key)) continue
                if (typeof val === 'number' && val >= 0 && val <= 1) {
                    this.energy += (val * 0.3 - this.energy) * pull * 0.1
                }
            }
        }

        // social, one off nudges
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

        this.mood = this._clamp(this.mood)
        this.energy = this._clamp(this.energy)

        this._history.push({
            time: Date.now(),
            mood: this.mood,
            energy: this.energy,
        })
        if (this._history.length > this._maxHistory) this._history.shift()

        const vDelta = Math.abs(this.mood - before.mood)
        const aDelta = Math.abs(this.energy - before.energy)
        if (vDelta > 0.1 || aDelta > 0.1) {
            this.logger.debug(`State shift: v=${this.mood.toFixed(2)} a=${this.energy.toFixed(2)}`)
        }
    }

    // for the prompt
    describe() {
        const v = this.mood
        const a = this.energy
        const vLabel = v > 0.4 ? 'very positive' : v > 0.15 ? 'positive'
            : v > -0.1 ? 'neutral' : v > -0.35 ? 'negative' : 'very negative'
        const aLabel = a > 0.5 ? 'very high' : a > 0.2 ? 'elevated'
            : a > -0.2 ? 'moderate' : a > -0.5 ? 'low' : 'very low'

        // conditions, not moods. this used to say "a subtle unease" and he'd
        // write "calm this odd unease" straight back, paraphrasing the prompt.
        // give him things he can point at instead (quiet street, feathers wont
        // sit right). a few per cell so it doesnt repeat
        const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

        let description
        if (v > 0.3 && a > 0.5) description = pick([
            'Light on his feet. Could go anywhere from here',
            'Everything looks worth a closer look this morning',
        ])
        else if (v > 0.3 && a > 0.2) description = pick([
            'Fed, warm, and after something to do',
            'Good day so far. It would take a lot to spoil it',
        ])
        else if (v > 0.3) description = pick([
            'Settled. Nothing needs doing for once',
            'Full and unhurried, in no rush at all',
        ])
        else if (v > 0.1 && a > 0.4) description = pick([
            'Head up, checking everything twice',
            'Alert. Every small noise is getting his attention',
        ])
        else if (v > 0.1 && a > 0.15) description = pick([
            'Awake and steady, taking things in',
            'Comfortable enough, watching the street',
        ])
        else if (v > 0.1) description = pick([
            'Fine. The day is neither one thing nor the other',
            'Quiet and easy, nothing pressing',
        ])
        else if (v > -0.05 && a > 0.4) description = pick([
            'Restless legs and nowhere particular to be',
            'Cannot settle. Keeps standing up and sitting down',
        ])
        else if (v > -0.05 && a > 0.15) description = pick([
            'Awake, unhurried, waiting for something to happen',
            'Standing about, watching what goes past',
        ])
        else if (v > -0.05) description = pick([
            'Steady. Nothing much either way',
            'A slow one. Nothing has happened for a while',
        ])
        else if (a < -0.2) description = pick([
            'Slow and heavy. Everything is an effort today',
            'Tired in the legs. Would rather be sitting',
        ])
        else if (v > -0.35 && a > 0.35) description = pick([
            'Twitchy. Keeps looking behind him for no reason',
            'Cannot get comfortable. Feathers will not sit right',
        ])
        else if (v > -0.35) description = pick([
            'The street is quieter than it should be',
            'Nothing has been interesting for a long stretch',
            'Been in the same spot too long and he knows it',
        ])
        else if (a > 0.3) description = pick([
            'Three things in a row have not worked',
            'Hungry, tired of walking, and the day is not helping',
        ])
        else description = pick([
            'Worn out and nothing has gone right',
            'Flat on his feet. Even the good bits are not landing',
        ])

        const regime = this._regime(v, a)
        if (regime) {
            description += ` You're in a ${regime.name}: ${regime.directive}`
        }

        return {
            mood: this.mood,
            energy: this.energy,
            moodLabel: vLabel,
            energyLabel: aLabel,
            regime,
            description,
        }
    }

    // named regime at the corners, null in the middle
    _regime(v, a) {
        if (v > 0.3 && a > 0.45) return {
            name: 'MANIC BRIGHT',
            directive: 'everything glitters. Say yes to the wilder option, talk quicker, chase the thing. You\'ll regret nothing until later.',
        }
        if (v > 0.25 && a < -0.2) return {
            name: 'TENDER LULL',
            directive: 'small things hit hard today. Linger on them. Speak softer, notice textures, let one detail matter more than it should.',
        }
        if (v < -0.25 && a < -0.1) return {
            name: 'SULK',
            directive: 'unimpressed by default. Short answers. Things have to EARN your attention today, and mostly they won\'t.',
        }
        if (v < -0.2 && a > 0.35) return {
            name: 'RATTLED HOUR',
            // used to say "on edge", which is where "the edge" in his reasons
            // came from. describe the behaviour, dont give him the noun
            directive: 'startle easily today. Keep near safe ground, snap at small provocations, double-check things that were fine yesterday.',
        }
        if (a < -0.5) return {
            name: 'FOG',
            directive: 'thoughts arrive slow and half-finished. Drift. It\'s allowed.',
        }
        return null
    }

    // called each tick with nearby ids, feeds the familiarity discount
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

    // score from RepetitionGuard.scoreSpeech. repeating himself makes the world
    // feel duller, he never knows why
    applySpeechCreativity(score) {
        if (score < 0.4) {
            // asymmetric again, like failure
            this._nudgeMood(-0.08)
        } else if (score > 0.8) {
            this._nudgeMood(0.03)
        }
        // 0.4-0.8 does nothing
    }

    // 0.5 calm to 1.0 at peak energy
    salience() {
        return 0.5 + Math.abs(this.energy) * 0.5
    }

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

    // extra: anything else worth keeping across a restart (tickCount)
    async checkpoint(extra = {}) {
        try {
            const data = {
                mood: this.mood,
                energy: this.energy,
                timestamp: Date.now(),
                ...extra,
            }
            // tmp + rename so a power cut mid write cant leave it truncated
            const tmp = `${this._checkpointPath}.tmp`
            await writeFile(tmp, JSON.stringify(data), 'utf-8')
            await rename(tmp, this._checkpointPath)
        } catch (err) {
            this.logger.error(`State checkpoint failed: ${err.message}`)
        }
    }

    // on startup. returns the whole checkpoint incl extras, or null
    async restore() {
        try {
            const raw = await readFile(this._checkpointPath, 'utf-8')
            const data = JSON.parse(raw)
            // older than an hour isnt worth restoring
            const ageMs = Date.now() - (data.timestamp || 0)
            if (ageMs < 60 * 60 * 1000) {
                this.mood = this._clamp(data.mood || 0)
                this.energy = this._clamp(data.energy || 0)
                this.logger.info(`State restored from checkpoint (age: ${Math.round(ageMs / 1000)}s), v=${this.mood.toFixed(2)} a=${this.energy.toFixed(2)}`)
                return data
            }
            this.logger.info(`State checkpoint too old (${Math.round(ageMs / 60000)}min), starting fresh`)
        } catch {
            // first run, no file
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
