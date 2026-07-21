// core cognitive loop: SENSE → FEEL → THINK → ACT → REFLECT.
//
// adaptive heartbeat: interval adjusts based on energy and env activity.
// high energy / lots of changes → faster ticking (more engaged).
// low energy / nothing happening → slower ticking (saving compute).
//
// each tick:
// 1. observe the environment
// 2. detect whats changed (delta detection)
// 3. update internal state (mood/energy from env + action results)
// 4. think (with full cognitive context: state, deltas, repetition, feedback)
// 5. act and capture the result
// 6. log with salience weighting (important moments hit harder)
// 7. record action for repetition detection
// 8. adapt heartbeat interval

export class Heartbeat {
    constructor(socket, think, workingMemory, memoryFiles, dailyLog, sleepCycle, internalState, deltaDetector, repetitionGuard, speechLog, config, logger) {
        this.socket = socket
        this.think = think
        this.workingMemory = workingMemory
        this.memoryFiles = memoryFiles
        this.dailyLog = dailyLog
        this.sleepCycle = sleepCycle
        this.internalState = internalState
        this.deltaDetector = deltaDetector
        this.repetitionGuard = repetitionGuard
        this.speechLog = speechLog
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
        this._lastCheckpointAt = 0      // periodic state checkpoint
        this._checkpointIntervalMs = config.checkpointIntervalMs || 5 * 60 * 1000  // 5 min
        this._lastGCCheckAt = Date.now()
        this._gcCheckIntervalMs = 60 * 60 * 1000  // check GC every hour
        this._recentlyDisappeared = []  // objects gone in the last few ticks
    }

    uptimeSeconds() {
        if (!this._startedAt) return 0
        return Math.floor((Date.now() - this._startedAt) / 1000)
    }

    start() {
        this._startedAt = Date.now()
        this.logger.info(`Heartbeat started (${this.baseIntervalMs}ms base, adaptive ${this.minIntervalMs}-${this.maxIntervalMs}ms)`)
        this._scheduleNext()
        // first tick immediately
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
        // guard against overlapping ticks
        if (this._ticking) return

        // sleeping?
        if (this.sleepCycle?.isSleeping()) return

        // connected?
        if (!this.socket.isConnected()) return

        this._ticking = true
        this.tickCount++

        try {
            // 1. SENSE
            const observation = await this.socket.observe()
            if (!observation) {
                this.logger.warn('Empty observation')
                return
            }

            // drain buffered world events (speech, etc)
            const worldEvents = this.socket.drainWorldEvents()

            // log heard speech to working memory (with salience from current energy)
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

            // update tools.md from observation (auto-discover objects/actions)
            await this.memoryFiles.updateToolsFromObservation(observation)

            // 2. DETECT CHANGE
            const deltas = this.deltaDetector.detect(observation)
            const deltaNarrative = this.deltaDetector.narrate(deltas)

            // track recently disappeared objects (fade after 30 ticks)
            for (const d of deltas) {
                if (d.type === 'disappeared' && d.category === 'object') {
                    this._recentlyDisappeared.push({ id: d.id, tick: this.tickCount })
                }
            }
            this._recentlyDisappeared = this._recentlyDisappeared.filter(
                d => this.tickCount - d.tick < 30
            )

            // 3. FEEL
            // collect nearby entity IDs (stability tracking + exploration context)
            const nearbyIds = [
                ...(observation.nearbyObjects || observation.nearby_objects || []).map(o => o.id || o.name),
                ...(observation.nearbyAgents || observation.nearby_agents || []).map(a => a.id || a.name),
            ].filter(Boolean)
            this.internalState.updateStability(nearbyIds)

            this.internalState.update({
                actionResult: this._lastActionResult,
                deltas,
                environmentSignals: observation.signals || this._normalizeSignals(observation.world),
                worldEvents,
            })

            // 3b. CLASSIFY TICK
            // route to the right model tier based on tick complexity.
            // quality (70B) for important moments, fast (Ollama/8B) for
            // routine, skip (no LLM) when nothing is happening.
            const stateDesc = this.internalState.describe()
            const repetitionWarnings = this.repetitionGuard.check()
            const tier = this._classifyTick(deltas, worldEvents, {
                internalState: stateDesc,
                lastActionResult: this._lastActionResult,
                recentlyDisappeared: this._recentlyDisappeared,
                repetitionWarnings,
            }, observation)

            // 3c. EXPLORATION CONTEXT
            const explorationHint = this.repetitionGuard.explorationContext(nearbyIds)

            // 4. THINK
            const decision = await this.think.decide(observation, worldEvents, {
                internalState: stateDesc,
                deltaNarrative: deltaNarrative || undefined,
                lastActionResult: this._lastActionResult,
                repetitionWarnings: repetitionWarnings || undefined,
                explorationHint: explorationHint || undefined,
                recentlyDisappeared: this._recentlyDisappeared.length > 0
                    ? this._recentlyDisappeared.map(d => d.id) : undefined,
                recentSpeeches: this.speechLog?.recentForPrompt() || undefined,
                tickCount: this.tickCount,
                uptimeMinutes: Math.floor(this.uptimeSeconds() / 60),
                salience,
                tier,
            })

            // 4b. VALIDATE ACTION
            // hard constraint: if env specifies available_actions, the agent
            // MUST use one of them. LLMs sometimes hallucinate actions from
            // previous contexts (eg move_to in synth mode).
            if (observation.available_actions?.length > 0) {
                const validActions = new Set(
                    observation.available_actions.map(a => typeof a === 'string' ? a : a.name)
                )
                if (!validActions.has(decision.action)) {
                    const fallback = validActions.has('wait') ? 'wait'
                        : validActions.has('hold') ? 'hold'
                        : (typeof observation.available_actions[0] === 'string' ? observation.available_actions[0] : observation.available_actions[0].name)
                    this.logger.warn(`Action "${decision.action}" not available — correcting to ${fallback}`)
                    decision.action = fallback
                    decision.params = { reason: '(corrected: original action not in available_actions)' }
                    decision.reason = `(corrected: original action not in available_actions)`
                }
            }

            // 4b2. ANTI-FIXATION BLOCK
            // env-agnostic: if the same action+target dominates the recent
            // window (40%+), force a redirect to break the loop.
            // works for anything: inspect(shiny_01), set_step(step_5), etc.
            const fixationTarget = decision.params?.target || decision.params?.entityId
            if (fixationTarget && this.repetitionGuard.isFixated(decision.action, fixationTarget)) {
                const count = this.repetitionGuard.comboCount(decision.action, fixationTarget)
                const blocked = decision.action
                const redirect = this._fixationRedirect(observation)
                if (redirect) {
                    this.logger.warn(`Hard block: ${blocked}("${fixationTarget}") fixated (${count}x) — forcing ${redirect.action}`)
                    decision.action = redirect.action
                    decision.params = { ...redirect.params, reason: `(blocked: ${blocked} ${fixationTarget} fixated after ${count}x)` }
                    decision.reason = `(blocked: fixation on ${fixationTarget})`
                }
            }
            // 4b3. TARGET-ONLY ANTI-FIXATION BLOCK
            // The combo block above misses fixation that's spread across
            // multiple actions on ONE target (camera stare = inspect + move_to
            // + wait on the same spot — the target dominates but no single
            // combo crosses 40%). Catch that here. Runs on the FINAL decision
            // including fallback decisions, so it survives the heuristic path.
            else if (fixationTarget && this.repetitionGuard.isTargetFixated(fixationTarget)) {
                const count = this.repetitionGuard.targetCount(fixationTarget)
                const redirect = this._fixationRedirect(observation)
                if (redirect) {
                    this.logger.warn(`Hard block: target "${fixationTarget}" fixated (${count}x across actions) — forcing ${redirect.action}`)
                    decision.action = redirect.action
                    decision.params = { ...redirect.params, reason: `(blocked: target ${fixationTarget} fixated ${count}x across actions)` }
                    decision.reason = `(blocked: target fixation on ${fixationTarget})`
                }
            }

            // 4c. VALIDATE SPEECH PARAMS
            // LLMs sometimes return speak with no valid message string
            if (decision.action === 'speak') {
                if (!decision.params?.message || typeof decision.params.message !== 'string' || !decision.params.message.trim()) {
                    this.logger.warn('Speak action with empty/invalid message — converting to wait')
                    decision.action = 'wait'
                    decision.params = {}
                    decision.reason = '(corrected: speak had no valid message)'
                }
            }

            this.logger.info(`[tick ${this.tickCount}] ${decision.action} (${decision.source}/${tier}) — ${decision.reason} [v=${stateDesc.mood.toFixed(2)} a=${stateDesc.energy.toFixed(2)}]`)

            // 5. ACT
            const result = await this.socket.act(decision.action, decision.params)

            // store action result for next tick's feedback loop
            this._lastActionResult = {
                action: decision.action,
                params: decision.params,
                success: result?.success !== false,
                message: result?.message || result?.error || result?.result?.effect || '',
            }

            // 6. REFLECT (log with salience)
            //
            // Plumbing reasons — "(corrected: …)" / "(blocked: fixation …)"
            // — are firewall artefacts, not lived experience. Logged with
            // full salience the consolidator promoted them into permanent
            // MEMORY.md (Victor "remembering" being anti-fixation-blocked).
            // Neutralise them: minimal salience so they're not encoded, and
            // a clean daily-log line with no plumbing annotation.
            const isPlumbing = /^\((corrected|blocked)/.test(decision.reason || '')
            const reflectSalience = isPlumbing ? Math.min(salience, 0.05) : salience
            const cleanReason = isPlumbing ? 'moving on' : decision.reason

            this.workingMemory.push({
                type: 'action',
                action: `${decision.action}(${JSON.stringify(decision.params)})`,
                reason: cleanReason,
            }, reflectSalience)

            // log the action result too
            this.workingMemory.push({
                type: 'action_result',
                success: this._lastActionResult.success,
                message: this._lastActionResult.message,
            }, reflectSalience)

            const logLine = `${decision.action}(${JSON.stringify(decision.params)}) — ${cleanReason} [${decision.source}] → ${this._lastActionResult.success ? 'ok' : 'failed'}`
            await this.dailyLog.append(logLine)

            // log speech separately for clarity
            if (decision.action === 'speak') {
                this.workingMemory.push({
                    type: 'speech_sent',
                    message: decision.params.message,
                }, salience)
                this.speechLog?.record(decision.params.message, this.tickCount)
            }

            // 7. CREATIVITY FEEDBACK + RECORD
            // score speech creativity BEFORE recording so it compares against
            // previous speeches, not itself. score nudges mood: repetition
            // feels bad, novelty feels good. agent never sees the score.
            let speechCreativity = null
            if (decision.action === 'speak' && decision.params?.message) {
                speechCreativity = this.repetitionGuard.scoreSpeech(decision.params.message)
                this.internalState.applySpeechCreativity(speechCreativity)
                this.logger.debug(`Speech creativity: ${speechCreativity.toFixed(2)}`)
            }
            this.repetitionGuard.record(decision.action, decision.params)

            // 8. EMIT
            this.api?.emit('tick', {
                tick: this.tickCount,
                action: decision.action,
                params: decision.params,
                reason: decision.reason,
                source: decision.source,
                tier,
                result: result?.message,
                internalState: stateDesc,
                speechCreativity,
                deltas: deltas.length,
                intervalMs: this.currentIntervalMs,
                timestamp: Date.now(),
            })

            // 9. ADAPT HEARTBEAT
            this._adaptInterval()

            // time to sleep?
            if (this.sleepCycle) {
                this.sleepCycle.checkSleepTime()
            }

            // 10. MAINTENANCE
            // fallback GC: if sleep hasnt fired and GC is overdue, run it now
            if (Date.now() - this._lastGCCheckAt > this._gcCheckIntervalMs) {
                this._lastGCCheckAt = Date.now()
                if (this.dailyLog.isGCOverdue(24)) {
                    this.logger.info('Fallback GC: sleep cycle missed, running GC now')
                    this.dailyLog.garbageCollect().catch(() => {})
                }
            }

            // periodic state checkpoint (crash recovery, incl tickCount)
            if (Date.now() - this._lastCheckpointAt > this._checkpointIntervalMs) {
                this._lastCheckpointAt = Date.now()
                this.internalState.checkpoint({ tickCount: this.tickCount }).catch(() => {})
                this.speechLog?.save().catch(() => {})
            }

        } catch (err) {
            this.logger.error(`Tick ${this.tickCount} failed: ${err.message}`)
            this.api?.emit('error', { tick: this.tickCount, message: err.message })
        } finally {
            this._ticking = false
        }
    }

    // where to send a fixated agent. spatial envs get the classic wander;
    // non-spatial envs (markets, synth) redirect to wait/hold instead of
    // being handed a move_to they can't execute. null = no safe redirect,
    // let the original decision through rather than invent an action.
    _fixationRedirect(observation) {
        const names = new Set(
            (observation.available_actions || []).map(a => typeof a === 'string' ? a : a.name)
        )
        if (names.size === 0 || names.has('move_to')) return { action: 'move_to', params: { target: 'wander' } }
        if (names.has('wait')) return { action: 'wait', params: {} }
        if (names.has('hold')) return { action: 'hold', params: {} }
        return null
    }

    // adapt heartbeat interval based on energy and activity.
    // high energy → faster ticks (engaged, responsive).
    // low energy → slower ticks (resting).
    _adaptInterval() {
        const energy = Math.abs(this.internalState.energy)
        // map energy 0..1 to interval max..min
        const range = this.maxIntervalMs - this.minIntervalMs
        const target = this.maxIntervalMs - (energy * range)
        // smooth transition (dont jump instantly)
        this.currentIntervalMs = Math.round(this.currentIntervalMs * 0.7 + target * 0.3)
        this.currentIntervalMs = Math.max(this.minIntervalMs, Math.min(this.maxIntervalMs, this.currentIntervalMs))
    }

    // classify tick complexity → route to the right model tier.
    // 'decision' = anthropic (env-flagged money moments)
    // 'quality' = 70B cloud (expensive, high stakes)
    // 'fast'    = Ollama/8B cloud (routine)
    // 'skip'    = FallbackBrain (nothing happening, no LLM)
    _classifyTick(deltas, worldEvents, context, observation) {
        // decision tier: the env is flagging a moment where being wrong
        // costs money (trade dossier awaiting a verdict, etc). LLMClient
        // aliases this to quality when no anthropic key is configured.
        if ((observation?.signals?.decision_pending || 0) >= 0.5) return 'decision'

        // quality tier: genuinely high-stakes ticks that need the big model.
        // Kept DELIBERATELY narrow — the quality (120B) path is the slowest
        // and most failure-prone, so over-routing to it (a) maximises
        // exposure to transient cloud failures and (b) wastes latency/cost.
        if (worldEvents.length > 0) return 'quality'                  // someone spoke to us
        if (context.repetitionWarnings?.length > 0) return 'quality'  // needs a creative escape

        // fast tier: routine activity — appeared/disappeared deltas, the
        // post-disappearance hallucination window, heightened arousal, and
        // any minor delta or action feedback. The 20B fast model handles
        // these fine and is far more reliable per call. (Previously these
        // all forced quality; a single object disappearance pinned ~6min of
        // ticks to the failing model via the recentlyDisappeared window.)
        if (deltas.some(d => d.type === 'appeared' || d.type === 'disappeared')) return 'fast'
        if (context.recentlyDisappeared?.length > 0) return 'fast'
        if (Math.abs(context.internalState?.energy || 0) > 0.5) return 'fast'

        // skip tier: nothing happening at all → no LLM call, heuristic only.
        if (deltas.length === 0 && !context.lastActionResult?.message) return 'skip'

        return 'fast'
    }

    // normalize env signals from alternative formats.
    // some envs send `world: {vitality: 70, resonance: 50}` (0-100 scale)
    // instead of `signals: {vitality: 0.7}` (0-1 scale). detect and normalize.
    _normalizeSignals(world) {
        if (!world || typeof world !== 'object') return null
        const signals = {}
        let needsScale = false
        for (const [k, v] of Object.entries(world)) {
            if (typeof v === 'number') {
                if (v > 1) needsScale = true
                signals[k] = v
            }
        }
        if (Object.keys(signals).length === 0) return null
        if (needsScale) {
            for (const k of Object.keys(signals)) signals[k] /= 100
        }
        return signals
    }

    _scheduleNext() {
        this._timer = setTimeout(() => {
            this._tick().catch(err => this.logger.error(`Uncaught tick error: ${err.message}`))
            if (this._timer !== null) {
                this._scheduleNext()
            }
        }, this.currentIntervalMs)
    }
}
