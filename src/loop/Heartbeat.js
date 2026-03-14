// Core cognitive loop: SENSE → FEEL → THINK → ACT → REFLECT
//
// Adaptive heartbeat: interval adjusts based on arousal and environmental activity.
// High arousal / lots of changes → faster ticking (more engaged).
// Low arousal / nothing happening → slower ticking (conserving energy).
//
// Each tick now:
// 1. Observes the environment
// 2. Detects what changed (delta detection)
// 3. Updates internal state (valence/arousal from environment + action results)
// 4. Thinks (with full cognitive context: state, deltas, repetition, action feedback)
// 5. Acts and captures the result
// 6. Logs with salience weighting (important moments encoded more strongly)
// 7. Records action for repetition detection
// 8. Adapts heartbeat interval

export class Heartbeat {
    constructor(socket, think, workingMemory, memoryFiles, dailyLog, sleepCycle, internalState, deltaDetector, repetitionGuard, config, logger) {
        this.socket = socket
        this.think = think
        this.workingMemory = workingMemory
        this.memoryFiles = memoryFiles
        this.dailyLog = dailyLog
        this.sleepCycle = sleepCycle
        this.internalState = internalState
        this.deltaDetector = deltaDetector
        this.repetitionGuard = repetitionGuard
        this.logger = logger

        this.baseIntervalMs = config.heartbeatIntervalMs
        this.minIntervalMs = config.heartbeatMinMs || 4000
        this.maxIntervalMs = config.heartbeatMaxMs || 15000
        this.currentIntervalMs = this.baseIntervalMs

        this._timer = null
        this._ticking = false
        this.tickCount = 0
        this._startedAt = null
        this._lastActionResult = null   // feedback from previous tick
        this.api = null  // set by index.js after ApiServer is created
        this._lastCheckpointAt = 0      // for periodic state checkpoint
        this._checkpointIntervalMs = config.checkpointIntervalMs || 5 * 60 * 1000  // 5 min
        this._lastGCCheckAt = Date.now()
        this._gcCheckIntervalMs = 60 * 60 * 1000  // check GC every hour
    }

    uptimeSeconds() {
        if (!this._startedAt) return 0
        return Math.floor((Date.now() - this._startedAt) / 1000)
    }

    start() {
        this._startedAt = Date.now()
        this.logger.info(`Heartbeat started (${this.baseIntervalMs}ms base, adaptive ${this.minIntervalMs}-${this.maxIntervalMs}ms)`)
        this._scheduleNext()
        // Run first tick immediately
        this._tick()
    }

    stop() {
        if (this._timer) {
            clearTimeout(this._timer)
            this._timer = null
        }
        this.logger.info('Heartbeat stopped')
    }

    async _tick() {
        // Guard against overlapping ticks
        if (this._ticking) return

        // Check if sleeping
        if (this.sleepCycle?.isSleeping()) return

        // Check connection
        if (!this.socket.isConnected()) return

        this._ticking = true
        this.tickCount++

        try {
            // ── 1. SENSE ──────────────────────────────────────────────
            const observation = await this.socket.observe()
            if (!observation) {
                this.logger.warn('Empty observation')
                return
            }

            // Drain any buffered world events (speech, etc.)
            const worldEvents = this.socket.drainWorldEvents()

            // Log heard speech to working memory (with salience from current arousal)
            const salience = this.internalState.salience()
            for (const evt of worldEvents) {
                const data = evt.data || evt
                if (data.event === 'agent_speech') {
                    this.workingMemory.push({
                        type: 'speech_heard',
                        speaker: data.agentId,
                        message: data.message,
                    }, salience)
                    await this.dailyLog.append(`Heard ${data.agentId} say: "${data.message}"`)
                }
            }

            // Update tools.md from observation (auto-discover objects/actions)
            await this.memoryFiles.updateToolsFromObservation(observation)

            // ── 2. DETECT CHANGE ──────────────────────────────────────
            const deltas = this.deltaDetector.detect(observation)
            const deltaNarrative = this.deltaDetector.narrate(deltas)

            // ── 3. FEEL ───────────────────────────────────────────────
            this.internalState.update({
                actionResult: this._lastActionResult,
                deltas,
                environmentSignals: observation.signals,
                worldEvents,
            })

            // ── 4. THINK ──────────────────────────────────────────────
            const stateDesc = this.internalState.describe()
            const repetitionWarnings = this.repetitionGuard.check()

            const decision = await this.think.decide(observation, worldEvents, {
                internalState: stateDesc,
                deltaNarrative: deltaNarrative || undefined,
                lastActionResult: this._lastActionResult,
                repetitionWarnings: repetitionWarnings || undefined,
                tickCount: this.tickCount,
                uptimeMinutes: Math.floor(this.uptimeSeconds() / 60),
                salience,
            })

            // ── 4b. VALIDATE ACTION ─────────────────────────────────
            // Hard constraint: if the environment specifies available_actions,
            // the agent MUST use one of them. LLMs sometimes hallucinate actions
            // from previous contexts (e.g. move_to in synth mode).
            if (observation.available_actions?.length > 0) {
                const validActions = new Set(
                    observation.available_actions.map(a => typeof a === 'string' ? a : a.name)
                )
                if (!validActions.has(decision.action)) {
                    this.logger.warn(`Action "${decision.action}" not available — correcting to valid action`)
                    // Pick first available action as safe fallback
                    const fallback = observation.available_actions[0]
                    decision.action = typeof fallback === 'string' ? fallback : fallback.name
                    decision.params = {}
                    decision.reason = `(corrected: original action not in available_actions)`
                }
            }

            // ── 4c. VALIDATE SPEECH PARAMS ──────────────────────────
            // LLMs sometimes return speak without a valid message string.
            if (decision.action === 'speak') {
                if (!decision.params?.message || typeof decision.params.message !== 'string' || !decision.params.message.trim()) {
                    this.logger.warn('Speak action with empty/invalid message — converting to wait')
                    decision.action = 'wait'
                    decision.params = {}
                    decision.reason = '(corrected: speak had no valid message)'
                }
            }

            this.logger.info(`[tick ${this.tickCount}] ${decision.action} (${decision.source}) — ${decision.reason} [v=${stateDesc.valence.toFixed(2)} a=${stateDesc.arousal.toFixed(2)}]`)

            // ── 5. ACT ───────────────────────────────────────────────
            const result = await this.socket.act(decision.action, decision.params)

            // Store action result for next tick's feedback loop
            this._lastActionResult = {
                action: decision.action,
                params: decision.params,
                success: result?.success !== false,
                message: result?.message || '',
            }

            // ── 6. REFLECT (log with salience) ───────────────────────
            this.workingMemory.push({
                type: 'action',
                action: `${decision.action}(${JSON.stringify(decision.params)})`,
                reason: decision.reason,
            }, salience)

            // Log the action result too
            this.workingMemory.push({
                type: 'action_result',
                success: this._lastActionResult.success,
                message: this._lastActionResult.message,
            }, salience)

            const logLine = `${decision.action}(${JSON.stringify(decision.params)}) — ${decision.reason} [${decision.source}] → ${this._lastActionResult.success ? 'ok' : 'failed'}`
            await this.dailyLog.append(logLine)

            // Log speech separately for clarity
            if (decision.action === 'speak') {
                this.workingMemory.push({
                    type: 'speech_sent',
                    message: decision.params.message,
                }, salience)
            }

            // ── 7. RECORD (repetition tracking) ─────────────────────
            this.repetitionGuard.record(decision.action, decision.params)

            // ── 8. EMIT ──────────────────────────────────────────────
            this.api?.emit('tick', {
                tick: this.tickCount,
                action: decision.action,
                params: decision.params,
                reason: decision.reason,
                source: decision.source,
                result: result?.message,
                internalState: stateDesc,
                deltas: deltas.length,
                intervalMs: this.currentIntervalMs,
                timestamp: Date.now(),
            })

            // ── 9. ADAPT HEARTBEAT ───────────────────────────────────
            this._adaptInterval()

            // Check if it's time to sleep
            if (this.sleepCycle) {
                this.sleepCycle.checkSleepTime()
            }

            // ── 10. MAINTENANCE ─────────────────────────────────────
            // Fallback GC: if sleep hasn't fired and GC is overdue, run it now
            if (Date.now() - this._lastGCCheckAt > this._gcCheckIntervalMs) {
                this._lastGCCheckAt = Date.now()
                if (this.dailyLog.isGCOverdue(24)) {
                    this.logger.info('Fallback GC: sleep cycle missed, running GC now')
                    this.dailyLog.garbageCollect().catch(() => {})
                }
            }

            // Periodic state checkpoint (crash recovery)
            if (Date.now() - this._lastCheckpointAt > this._checkpointIntervalMs) {
                this._lastCheckpointAt = Date.now()
                this.internalState.checkpoint().catch(() => {})
            }

        } catch (err) {
            this.logger.error(`Tick ${this.tickCount} failed: ${err.message}`)
            this.api?.emit('error', { tick: this.tickCount, message: err.message })
        } finally {
            this._ticking = false
        }
    }

    // Adapt heartbeat interval based on arousal and activity
    // High arousal → faster ticks (more engaged, responsive)
    // Low arousal → slower ticks (conserving, resting)
    _adaptInterval() {
        const arousal = Math.abs(this.internalState.arousal)
        // Map arousal 0..1 to interval max..min
        const range = this.maxIntervalMs - this.minIntervalMs
        const target = this.maxIntervalMs - (arousal * range)
        // Smooth transition (don't jump instantly)
        this.currentIntervalMs = Math.round(this.currentIntervalMs * 0.7 + target * 0.3)
        this.currentIntervalMs = Math.max(this.minIntervalMs, Math.min(this.maxIntervalMs, this.currentIntervalMs))
    }

    _scheduleNext() {
        this._timer = setTimeout(() => {
            this._tick()
            if (this._timer !== null) {
                this._scheduleNext()
            }
        }, this.currentIntervalMs)
    }
}
