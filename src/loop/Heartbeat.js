// Core OBSERVE → THINK → ACT loop
// Runs every heartbeatIntervalMs, guards against overlapping ticks

export class Heartbeat {
    constructor(socket, think, workingMemory, memoryFiles, dailyLog, sleepCycle, config, logger) {
        this.socket = socket
        this.think = think
        this.workingMemory = workingMemory
        this.memoryFiles = memoryFiles
        this.dailyLog = dailyLog
        this.sleepCycle = sleepCycle
        this.intervalMs = config.heartbeatIntervalMs
        this.logger = logger

        this._timer = null
        this._ticking = false
        this.tickCount = 0
        this._startedAt = null
        this.api = null  // set by index.js after ApiServer is created
    }

    uptimeSeconds() {
        if (!this._startedAt) return 0
        return Math.floor((Date.now() - this._startedAt) / 1000)
    }

    start() {
        this._startedAt = Date.now()
        this.logger.info(`Heartbeat started (${this.intervalMs}ms interval)`)
        this._timer = setInterval(() => this._tick(), this.intervalMs)
        // Run first tick immediately
        this._tick()
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer)
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
            // 1. OBSERVE
            const observation = await this.socket.observe()
            if (!observation) {
                this.logger.warn('Empty observation')
                return
            }

            // Drain any buffered world events (speech, etc.)
            const worldEvents = this.socket.drainWorldEvents()

            // Log heard speech to working memory
            for (const evt of worldEvents) {
                const data = evt.data || evt
                if (data.event === 'agent_speech') {
                    this.workingMemory.push({
                        type: 'speech_heard',
                        speaker: data.agentId,
                        message: data.message,
                    })
                    await this.dailyLog.append(`Heard ${data.agentId} say: "${data.message}"`)
                }
            }

            // Update tools.md from observation (auto-discover objects/actions)
            await this.memoryFiles.updateToolsFromObservation(observation)

            // 2. THINK
            const decision = await this.think.decide(observation, worldEvents)

            this.logger.info(`[tick ${this.tickCount}] ${decision.action} (${decision.source}) — ${decision.reason}`)

            // 3. ACT
            const result = await this.socket.act(decision.action, decision.params)

            // 4. LOG
            this.workingMemory.push({
                type: 'action',
                action: `${decision.action}(${JSON.stringify(decision.params)})`,
                reason: decision.reason,
            })

            const logLine = `${decision.action}(${JSON.stringify(decision.params)}) — ${decision.reason} [${decision.source}]`
            await this.dailyLog.append(logLine)

            // Log speech separately for clarity
            if (decision.action === 'speak') {
                this.workingMemory.push({
                    type: 'speech_sent',
                    message: decision.params.message,
                })
            }

            // Emit tick event to SSE clients
            this.api?.emit('tick', {
                tick: this.tickCount,
                action: decision.action,
                params: decision.params,
                reason: decision.reason,
                source: decision.source,
                result: result?.message,
                timestamp: Date.now(),
            })

            // Check if it's time to sleep
            if (this.sleepCycle) {
                this.sleepCycle.checkSleepTime()
            }

        } catch (err) {
            this.logger.error(`Tick ${this.tickCount} failed: ${err.message}`)
            this.api?.emit('error', { tick: this.tickCount, message: err.message })
        } finally {
            this._ticking = false
        }
    }
}
