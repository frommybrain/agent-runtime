// the main loop. observe, diff, update mood, decide, act, log.
// interval speeds up with energy and slows down when nothing is happening

import { sanitizeReason } from '../util/sanitizeReason.js'
import { wornWords, wornOpeners, wornPhrases } from '../util/wornWords.js'
import { scoreLine, exemplars } from '../util/voiceScore.js'
import { evidenceKeys, shortHash } from '../logging/DecisionLog.js'

function targetOf(params) {
    return params?.target ?? params?.entityId ?? null
}

export function activeWork(observation) {
    const self = observation?.self || {}
    if (self.journey?.active === true) {
        return { kind: 'journey', target: self.journey.target || null }
    }
    if (self.busy === true) {
        return { kind: 'action', target: self.action || null }
    }
    // older envs without journey/busy, sniff the action string
    if (/^move toward /i.test(String(self.action || ''))) {
        return { kind: 'journey', target: null }
    }
    return null
}

function levelOf(need) {
    if (typeof need === 'number') return need <= 1 ? need * 100 : need
    return Number(need?.level || 0)
}

// is a visitor's note overdue a look? critical needs still win. backlog
// shortens the wait, floor of 2 min so he isnt just a queue worker
export function dueOfferingAttention(observation, lastAt = 0, now = Date.now(), maxMinutes = 15, previous = null) {
    const count = Number(observation?.pending_sacrifices || 0)
    if (count <= 0) return null

    const actionNames = new Set(
        (observation.available_actions || []).map((action) =>
            typeof action === 'string' ? action : action?.name),
    )
    if (!actionNames.has('inspect')) return null

    const needs = observation.self?.needs || {}
    if (['hunger', 'rest', 'safety'].some((name) => levelOf(needs[name]) >= 90)) return null

    const intervalMinutes = Math.max(2, Number(maxMinutes || 15) / Math.min(count, 6))
    if (lastAt > 0 && now - lastAt < intervalMinutes * 60_000) return null

    const objects = observation.nearby_objects || observation.nearbyObjects || []
    // world sends these oldest first
    const crystals = objects.filter((object) => object?.type === 'SACRIFICE' && object?.id)
    const shrine = objects.find((object) => object?.id === 'artifact_shrine')
    // if last time's crystal didnt get read, go to the shrine instead (world
    // opens the oldest note from there). it picked the same unreachable
    // crystal 17 times in 9 hours before this
    const stalled = previous?.kind === 'crystal' && count >= Number(previous.count || 0)
    const target = (stalled && shrine) ? shrine : (crystals[0] || shrine)
    if (!target?.id) return null
    const kind = target.type === 'SACRIFICE' ? 'crystal' : 'shrine'

    return {
        target: target.id,
        count,
        intervalMinutes,
        kind,
        waitedMin: Number.isFinite(Number(target.waited_min)) ? Number(target.waited_min) : null,
        from: target.from ? String(target.from) : null,
    }
}

function agoWords(minutes) {
    if (!Number.isFinite(minutes) || minutes < 1) return null
    if (minutes < 60) return `${Math.round(minutes)} minutes`
    const hours = Math.round(minutes / 60)
    return hours === 1 ? 'an hour' : `${hours} hours`
}

// his line for why he's off to read a note. was one fixed sentence at first
// and it went out 16 times in a day. falls back to the bare facts, which at
// least vary
export async function attentionReason(think, due, recentReasons = [], { timeoutMs = 8000 } = {}) {
    const waited = agoWords(due?.waitedMin)
    const who = due?.from ? `${due.from}` : null
    const others = due?.count > 1 ? `${due.count - 1} more ${due.count - 1 === 1 ? 'note is' : 'notes are'} waiting behind it` : null
    const facts = [
        due?.kind === 'shrine'
            ? 'you are going to the shrine now to read the note that has waited longest, because the one you set out for last time could not be reached'
            : 'you are going now to read a note somebody left for you, where it lies',
        who ? `it was left by ${who}` : null,
        waited ? `it has waited ${waited}` : null,
        others,
    ].filter(Boolean).join('. ') + '.'
    const fallback = `${who ? `${who}'s note` : 'a note'} has waited ${waited || 'long enough'}${others ? `, ${others}` : ''}`

    const llm = think?.llm
    if (!llm?.generate) return fallback
    const persona = think?.promptBuilder?.persona || {}
    const recent = (recentReasons || []).map((r) => String(r).trim()).filter(Boolean).slice(0, 8)
    const system = [
        `You are ${persona.name || 'Pino'}, a small kiwi bird who lives alone in a town watched by cameras.`,
        persona.voice?.style || 'Sparse, dry, plain-spoken.',
        '',
        `What is true right now: ${facts}`,
        '',
        'Say ONE line, in your own words, for why you are going now, as a thought rather than a report. Do not thank anybody and do not ask anyone for anything.',
        'Plain English, no more than 18 words. No em dash.',
        recent.length ? `You have said these lately, so come at it from somewhere new:\n${recent.map((r) => `- ${r}`).join('\n')}` : '',
        'Reply as JSON: {"reason": "..."}',
    ].filter(Boolean).join('\n')
    const said = new Set(recent.map((r) => r.toLowerCase()))
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const { text } = await llm.generate(system, 'Your line.', timeoutMs, 'fast', true)
            if (!text) continue
            let line = ''
            try { line = String(JSON.parse(text).reason || '').trim() } catch { continue }
            line = line.replace(/\s*[\u2014\u2013]\s*/g, ', ').replace(/\s+/g, ' ').trim()
            const words = line.split(' ').length
            if (!line || words < 3 || words > 24) continue
            if (said.has(line.toLowerCase())) continue
            return line
        } catch {
            return fallback
        }
    }
    return fallback
}

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
        this._voiceHistory = []  // scored lines, best/worst go back in as examples
        this.logger = logger

        this.baseIntervalMs = config.heartbeatIntervalMs
        this.minIntervalMs = config.heartbeatMinMs || 4000
        this.maxIntervalMs = config.heartbeatMaxMs || 15000
        this.currentIntervalMs = this.baseIntervalMs

        this._timer = null
        this._watchdog = null
        this._ticking = false
        this._lastTickSettledAt = Date.now()
        this._stuckTickMs = Math.max(120000, (config.maxThinkTimeMs || 30000) * 3)
        this.tickCount = 0
        this._startedAt = null
        this._lastActionResult = null
        this.api = null  // index.js sets these two
        this.decisionLog = null
        this._lastCheckpointAt = 0
        this._checkpointIntervalMs = config.checkpointIntervalMs || 5 * 60 * 1000
        this._lastGCCheckAt = Date.now()
        this._gcCheckIntervalMs = 60 * 60 * 1000
        this._recentlyDisappeared = []
        // not 0, or every boot with a note waiting goes straight to it
        this._lastOfferingAttentionAt = Date.now()
        this._offeringAttentionMaxMinutes = Math.max(2, Number(config.offeringAttentionMaxMinutes || 15))
        // so a crystal that read nothing hands the next go to the shrine
        this._lastOfferingAttention = null
    }

    uptimeSeconds() {
        if (!this._startedAt) return 0
        return Math.floor((Date.now() - this._startedAt) / 1000)
    }

    start() {
        this._startedAt = Date.now()
        this.logger.info(`Heartbeat started (${this.baseIntervalMs}ms base, adaptive ${this.minIntervalMs}-${this.maxIntervalMs}ms)`)
        this._scheduleNext()
        this._watchdog = setInterval(() => {
            if (!this._ticking || !this.socket.isConnected() || this.sleepCycle?.isSleeping()) return
            const stalledFor = Date.now() - this._lastTickSettledAt
            if (stalledFor < this._stuckTickMs) return
            this.logger.error(`Heartbeat stalled for ${Math.round(stalledFor / 1000)}s, exiting for service restart`)
            process.exit(1)
        }, 30000)
        this._watchdog.unref?.()
        this._tick()
    }

    stop() {
        if (this._timer) {
            clearTimeout(this._timer)
            this._timer = null
        }
        if (this._watchdog) {
            clearInterval(this._watchdog)
            this._watchdog = null
        }
        this.logger.info('Heartbeat stopped')
    }

    async _tick() {
        if (this._ticking) return

        if (this.sleepCycle?.isSleeping()) return

        if (!this.socket.isConnected()) return

        this._ticking = true
        this._lastTickSettledAt = Date.now()
        this.tickCount++
        // decision log line, filled as we go and written in finally so a
        // throw halfway still shows how far it got. null if nothing decided
        let receipt = null

        try {
            const observation = await this.socket.observe()
            if (!observation) {
                this.logger.warn('Empty observation')
                return
            }

            // dont decide while walking somewhere, same as the sim's own
            // LLMBrain. at 1.5u/s on a 290u map he'd change his mind before
            // getting anywhere, 12 trips announced in 120 entries and he
            // arrived at none. saves an llm call per tick of the walk too
            const doing = String(observation.self?.action || '')
            const work = activeWork(observation)
            if (work) {
                // info not debug, a silent skip looks like a dead tick in the log
                const eta = doing.match(/~(\d+)u away/)
                const label = work.kind === 'journey'
                    ? `walking${work.target ? ` to ${work.target}` : ''}${eta ? ` (${eta[1]}u to go)` : ''}`
                    : `finishing ${work.target || 'the current action'}`
                this.logger.info(`[tick ${this.tickCount}] ${label}, not deciding`)
                return
            }

            const worldEvents = this.socket.drainWorldEvents()

            // anything he heard goes into working memory
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

            await this.memoryFiles.updateToolsFromObservation(observation)

            const deltas = this.deltaDetector.detect(observation)
            const deltaNarrative = this.deltaDetector.narrate(deltas)

            // remember what vanished for 30 ticks
            for (const d of deltas) {
                if (d.type === 'disappeared' && d.category === 'object') {
                    this._recentlyDisappeared.push({ id: d.id, tick: this.tickCount })
                }
            }
            this._recentlyDisappeared = this._recentlyDisappeared.filter(
                d => this.tickCount - d.tick < 30
            )

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

            // pick a model tier, see _classifyTick
            const stateDesc = this.internalState.describe()
            const repetition = this.repetitionGuard.checkDetailed()
            const repetitionWarnings = repetition ? repetition.map(w => w.text) : null
            const { tier, why: tierWhy } = this._classifyTick(deltas, worldEvents, {
                internalState: stateDesc,
                lastActionResult: this._lastActionResult,
                recentlyDisappeared: this._recentlyDisappeared,
                repetitionWarnings,
                repetitionKinds: repetition ? repetition.map(w => w.kind) : null,
            }, observation)
            receipt = {
                tick: this.tickCount,
                tier,
                why: tierWhy,
                ...evidenceKeys(observation, worldEvents, this._lastActionResult),
                menu: (observation.available_actions || []).length,
                // hashed every tick, not cached, so an in place edit shows up
                persona: this.think?.promptBuilder?.persona ? shortHash(this.think.promptBuilder.persona) : null,
            }

            const explorationHint = this.repetitionGuard.explorationContext(nearbyIds)

            // think, unless a note is overdue a look. has to be checked before
            // asking the model: it used to overwrite the answer after, and the
            // thrown away decision's remember still got saved. he remembered
            // choices he never made
            const visitorAttention = dueOfferingAttention(
                observation,
                this._lastOfferingAttentionAt,
                Date.now(),
                this._offeringAttentionMaxMinutes,
                this._lastOfferingAttention,
            )
            let decision
            if (visitorAttention) {
                const reason = await attentionReason(this.think, visitorAttention, this.workingMemory.recentReasons(10))
                decision = {
                    action: 'inspect',
                    params: { target: visitorAttention.target, reason },
                    reason,
                    source: 'visitor-attention',
                }
                this._lastOfferingAttention = {
                    target: visitorAttention.target,
                    kind: visitorAttention.kind,
                    count: visitorAttention.count,
                    at: Date.now(),
                }
            } else {
                decision = await this.think.decide(observation, worldEvents, {
                    internalState: stateDesc,
                    deltaNarrative: deltaNarrative || undefined,
                    lastActionResult: this._lastActionResult,
                    repetitionWarnings: repetitionWarnings || undefined,
                    explorationHint: explorationHint || undefined,
                    recentlyDisappeared: this._recentlyDisappeared.length > 0
                        ? this._recentlyDisappeared.map(d => d.id) : undefined,
                    recentSpeeches: this.speechLog?.recentForPrompt() || undefined,
                    // words hes leaned on in the last ~10 reasons, banned this turn
                    // so a motif ("scream", "beat") cant feed itself
                    wornWords: wornWords(this.workingMemory.recentReasons(10)),
                    wornOpeners: wornOpeners(this.workingMemory.recentReasons(10)),
                    wornPhrases: wornPhrases(this.workingMemory.recentReasons(10)),
                    ownVoice: exemplars(this._voiceHistory),
                    tickCount: this.tickCount,
                    uptimeMinutes: Math.floor(this.uptimeSeconds() / 60),
                    salience,
                    tier,
                })
            }

            receipt.source = decision.source
            receipt.model = decision.llm?.model ?? null
            receipt.ms = decision.llm?.ms ?? null
            receipt.tokens = decision.llm?.usage ?? null
            receipt.promptChars = decision.promptChars ?? null
            if (decision.fallback) receipt.fallback = decision.fallback
            if (decision.raw) receipt.raw = decision.raw
            // what the model wanted, before the guards below get at it
            receipt.asked = decision.source === 'visitor-attention'
                ? null
                : { action: decision.action ?? null, target: targetOf(decision.params) }
            const overrides = []
            receipt.overrides = overrides

            // must be on the menu. models make up actions from other envs
            // sometimes (move_to in synth)
            if (observation.available_actions?.length > 0) {
                const validActions = new Set(
                    observation.available_actions.map(a => typeof a === 'string' ? a : a.name)
                )
                if (!validActions.has(decision.action)) {
                    const fallback = validActions.has('wait') ? 'wait'
                        : validActions.has('hold') ? 'hold'
                        : (typeof observation.available_actions[0] === 'string' ? observation.available_actions[0] : observation.available_actions[0].name)
                    this.logger.warn(`Action "${decision.action}" not available - correcting to ${fallback}`)
                    overrides.push('not_on_menu')
                    decision.action = fallback
                    decision.params = { reason: '(corrected: original action not in available_actions)' }
                    decision.reason = `(corrected: original action not in available_actions)`
                }
            }

            // same action+target over 40% of recent history, break it up
            const fixationTarget = decision.params?.target || decision.params?.entityId
            if (fixationTarget && this.repetitionGuard.isFixated(decision.action, fixationTarget)) {
                const count = this.repetitionGuard.comboCount(decision.action, fixationTarget)
                const blocked = decision.action
                const redirect = this._fixationRedirect(observation)
                if (redirect) {
                    this.logger.warn(`Hard block: ${blocked}("${fixationTarget}") fixated (${count}x) - forcing ${redirect.action}`)
                    overrides.push('fixation')
                    decision.action = redirect.action
                    decision.params = { ...redirect.params, reason: `(blocked: ${blocked} ${fixationTarget} fixated after ${count}x)` }
                    decision.reason = `(blocked: fixation on ${fixationTarget})`
                }
            }
            // same target spread over several actions (the camera stare was
            // inspect + move_to + wait on one spot, no single combo hit 40%).
            // runs on fallback decisions too
            else if (fixationTarget && this.repetitionGuard.isTargetFixated(fixationTarget)) {
                const count = this.repetitionGuard.targetCount(fixationTarget)
                const redirect = this._fixationRedirect(observation)
                if (redirect) {
                    this.logger.warn(`Hard block: target "${fixationTarget}" fixated (${count}x across actions) - forcing ${redirect.action}`)
                    overrides.push('target_fixation')
                    decision.action = redirect.action
                    decision.params = { ...redirect.params, reason: `(blocked: target ${fixationTarget} fixated ${count}x across actions)` }
                    decision.reason = `(blocked: target fixation on ${fixationTarget})`
                }
            }

            // env advertises speak(text) but this used to only accept message,
            // 21 of 21 speaks in a day got binned. fold the aliases in first
            if (decision.action === 'speak') {
                const p = decision.params || {}
                const said = [p.message, p.text, p.say, p.content, p.words]
                    .find(v => typeof v === 'string' && v.trim())
                if (said) {
                    decision.params = { ...p, message: said.trim() }
                } else {
                    this.logger.warn('Speak action with empty/invalid message - converting to wait')
                    overrides.push('speak_empty')
                    decision.action = 'wait'
                    decision.params = {}
                    decision.reason = '(corrected: speak had no valid message)'
                }
            }

            // these kept comming with no target ("Unknown activity: undefined").
            // theres only one of each host so just fill it in
            const hostFor = { browse_internet: /internet|cafe/i, use_phone: /phone/i, watch_tattoos: /tattoo/i }
            if (hostFor[decision.action] && !decision.params?.target) {
                const pool = observation.nearby_objects || observation.nearbyObjects || []
                const host = pool.find(o => o?.type === 'ACTIVITY' && hostFor[decision.action].test(o.name || ''))
                if (host) {
                    this.logger.debug(`${decision.action} had no target - resolved to ${host.id}`)
                    overrides.push('target_filled')
                    decision.params = { ...(decision.params || {}), target: host.id }
                } else {
                    const wanted = decision.action
                    this.logger.warn(`${wanted} with no target and no host in sight - converting to wait`)
                    overrides.push('no_host')
                    decision.action = 'wait'
                    decision.params = {}
                    decision.reason = `(corrected: ${wanted} had no target)`
                }
            }

            // scrub stats and ids out of the reason before it hits the journal.
            // the prompt says not to but the fast tier still does
            // ("Hunger at 100%, need something fresh")
            const need = decision.params?.target && /food|hunger/i.test(decision.params.target) ? 'hunger' : undefined
            const beforeScrub = decision.reason || decision.params?.reason || ''
            if (decision.reason) decision.reason = sanitizeReason(decision.reason, { need })
            if (decision.params?.reason) decision.params.reason = sanitizeReason(decision.params.reason, { need })
            if ((decision.reason || decision.params?.reason || '') !== beforeScrub) overrides.push('reason_scrubbed')

            // env only gets params, and 3eyes drops reasonless decisions from
            // the journal. models put reason top level or in params, depends
            // on the model, so copy it both ways
            decision.params = decision.params || {}
            if (decision.reason && !decision.params.reason) decision.params.reason = decision.reason
            if (!decision.reason && decision.params.reason) decision.reason = decision.params.reason

            // no reason at all, or the scrub ate all of it
            if (!decision.reason) {
                this.logger.warn(
                    beforeScrub
                        ? `Reason lost in scrub (${decision.source}/${tier}): "${beforeScrub.slice(0, 60)}"`
                        : `No reason returned (${decision.source}/${tier}) for ${decision.action}`
                )
            }

            receipt.took = { action: decision.action, target: targetOf(decision.params) }
            receipt.reason = String(decision.reason || '').slice(0, 200)
            if (decision.remember?.content) receipt.remember = true

            this.logger.info(`[tick ${this.tickCount}] ${decision.action} (${decision.source}/${tier}) - ${decision.reason} [v=${stateDesc.mood.toFixed(2)} a=${stateDesc.energy.toFixed(2)}]`)
            if (decision.source !== 'fallback') this.sleepCycle?.noteDecision?.()

            const result = await this.socket.act(decision.action, decision.params)

            if (decision.action === 'inspect' &&
                (/^sacrifice_/.test(String(decision.params?.target || '')) || decision.params?.target === 'artifact_shrine')) {
                this._lastOfferingAttentionAt = Date.now()
            }

            // remember is a field not an action, so it only ever went to
            // memory.md on the pi and the the diary never saw it. send it to the
            // world as well, a second act() is safe, it doesnt touch action state
            if (decision.remember?.content) {
                try {
                    await this.socket.act('remember', {
                        category: decision.remember.section || 'Learned Facts',
                        memory: String(decision.remember.content).slice(0, 200),
                    })
                } catch (err) {
                    // his copy is already saved, not worth failing the tick
                    this.logger.warn(`Could not send memory to the world: ${err.message}`)
                }
            }

            // fed back in next tick
            this._lastActionResult = {
                action: decision.action,
                params: decision.params,
                success: result?.success !== false,
                message: result?.message || result?.error || result?.result?.effect || '',
            }
            receipt.result = {
                ok: this._lastActionResult.success,
                msg: String(this._lastActionResult.message || '').slice(0, 160),
            }

            // (corrected: ...) / (blocked: ...) reasons are ours, not his. at full
            // salience the consolidator put them in MEMORY.md and victor
            // "remembered" being fixation blocked. keep them out
            const isPlumbing = /^\((corrected|blocked)/.test(decision.reason || '')
            const reflectSalience = isPlumbing ? Math.min(salience, 0.05) : salience
            const cleanReason = isPlumbing ? 'moving on' : decision.reason

            this.workingMemory.push({
                type: 'action',
                action: `${decision.action}(${JSON.stringify(decision.params)})`,
                reason: cleanReason,
            }, reflectSalience)

            this.workingMemory.push({
                type: 'action_result',
                success: this._lastActionResult.success,
                message: this._lastActionResult.message,
            }, reflectSalience)

            // put the failure message in, a third were failing with no clue why
            const why = !this._lastActionResult.success && this._lastActionResult.message
                ? ` (${String(this._lastActionResult.message).slice(0, 90)})`
                : ''
            const logLine = `${decision.action}(${JSON.stringify(decision.params)}): ${cleanReason} [${decision.source}] → ${this._lastActionResult.success ? 'ok' : `failed${why}`}`
            await this.dailyLog.append(logLine)

            if (decision.action === 'speak') {
                this.workingMemory.push({
                    type: 'speech_sent',
                    message: decision.params.message,
                }, salience)
                this.speechLog?.record(decision.params.message, this.tickCount)
            }

            // score before record() or it compares against itself. nudges mood,
            // he never sees the number
            let speechCreativity = null
            if (decision.action === 'speak' && decision.params?.message) {
                speechCreativity = this.repetitionGuard.scoreSpeech(decision.params.message)
                this.internalState.applySpeechCreativity(speechCreativity)
                this.logger.debug(`Speech creativity: ${speechCreativity.toFixed(2)}`)
            }
            this.repetitionGuard.record(decision.action, decision.params)

            // everything else on his voice is a ban list, this is the only bit
            // that can tell him "that one worked"
            if (decision.reason) {
                const { score } = scoreLine(decision.reason, this._voiceHistory.map((h) => h.line))
                this._voiceHistory.push({ line: decision.reason, score })
                if (this._voiceHistory.length > 60) this._voiceHistory.shift()
            }

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

            this._adaptInterval()

            // pass the world clock so he sleeps at night, the real time timer
            // was phase locked to the same world hour every day
            if (this.sleepCycle) {
                this.sleepCycle.checkSleepTime(observation.world_clock || null)
            }

            // GC normally runs in sleep, this catches it if sleep hasnt happened
            if (Date.now() - this._lastGCCheckAt > this._gcCheckIntervalMs) {
                this._lastGCCheckAt = Date.now()
                if (this.dailyLog.isGCOverdue(24)) {
                    this.logger.info('Fallback GC: sleep cycle missed, running GC now')
                    this.dailyLog.garbageCollect().catch(() => {})
                }
            }

            // checkpoint for crash recovery
            if (Date.now() - this._lastCheckpointAt > this._checkpointIntervalMs) {
                this._lastCheckpointAt = Date.now()
                this.internalState.checkpoint({ tickCount: this.tickCount }).catch(() => {})
                this.speechLog?.save().catch(() => {})
            }

        } catch (err) {
            if (receipt) receipt.error = String(err.message || err).slice(0, 200)
            this.logger.error(`Tick ${this.tickCount} failed: ${err.message}`)
            this.api?.emit('error', { tick: this.tickCount, message: err.message })
        } finally {
            if (receipt) {
                try {
                    this.decisionLog?.record(receipt)
                } catch (err) {
                    this.logger.warn(`Decision log record failed: ${err.message}`)
                }
            }
            this._ticking = false
            this._lastTickSettledAt = Date.now()
            if (this._nudged) {
                this._nudged = false
                this.nudge(500)
            }
        }
    }

    // wander if the env has move_to, else wait/hold (markets, synth).
    // null = nothing safe, let the original through
    _fixationRedirect(observation) {
        const names = new Set(
            (observation.available_actions || []).map(a => typeof a === 'string' ? a : a.name)
        )
        if (names.size === 0 || names.has('move_to')) return { action: 'move_to', params: { target: 'wander' } }
        if (names.has('wait')) return { action: 'wait', params: {} }
        if (names.has('hold')) return { action: 'hold', params: {} }
        return null
    }

    // more energy = faster ticks
    _adaptInterval() {
        const energy = Math.abs(this.internalState.energy)
        const range = this.maxIntervalMs - this.minIntervalMs
        const target = this.maxIntervalMs - (energy * range)
        // ease towards it
        this.currentIntervalMs = Math.round(this.currentIntervalMs * 0.7 + target * 0.3)
        this.currentIntervalMs = Math.max(this.minIntervalMs, Math.min(this.maxIntervalMs, this.currentIntervalMs))
    }

    // which model tier this tick gets:
    //   decision  anthropic, env flags a money moment
    //   quality   120b, big and slow
    //   fast      20b / ollama
    //   skip      FallbackBrain, no llm
    // why is the rule that fired, goes in the decision log
    _classifyTick(deltas, worldEvents, context, observation) {
        // env refuses anything but wait while he's asleep, 46 of 256 failures
        // in a day were "Asleep at the nest". waking is SleepCycle's job
        if (observation?.self?.asleep === true) return { tier: 'skip', why: 'asleep' }

        // being wrong costs money here (trade dossier etc). LLMClient drops
        // this to quality if theres no anthropic key
        if ((observation?.signals?.decision_pending || 0) >= 0.5) return { tier: 'decision', why: 'decision_pending' }

        // keep quality narrow, 120b is the slowest and fails the most
        if (worldEvents.length > 0) {                                 // someone spoke to us
            const kinds = [...new Set(worldEvents.map(e => (e?.data || e)?.event || 'event'))].sort()
            return { tier: 'quality', why: `world_event:${kinds.join('+')}` }
        }
        if (context.repetitionWarnings?.length > 0) {                 // stuck in a rut
            const kinds = [...new Set(context.repetitionKinds || ['unknown'])].sort()
            return { tier: 'quality', why: `repetition:${kinds.join('+')}` }
        }

        // 20b copes with all this fine. these used to go to quality and one
        // thing vanishing pinned ~6 min of ticks to the failing model
        if (deltas.some(d => d.type === 'appeared' || d.type === 'disappeared')) return { tier: 'fast', why: 'appeared_or_gone' }
        if (context.recentlyDisappeared?.length > 0) return { tier: 'fast', why: 'recently_gone' }
        if (Math.abs(context.internalState?.energy || 0) > 0.5) return { tier: 'fast', why: 'energy' }

        // nothing going on, dont bother the llm
        if (deltas.length === 0 && !context.lastActionResult?.message) return { tier: 'skip', why: 'nothing_new' }

        return { tier: 'fast', why: 'default' }
    }

    // some envs send world: {vitality: 70} on 0-100 instead of signals on 0-1
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

    // somebody spoke to us. tick soon rather than whenever the interval says,
    // or a reply lands 15s after the question. if a tick is running, go again
    // straight after it
    nudge(delayMs = 1500) {
        if (this._timer === null) return
        if (this._ticking) {
            this._nudged = true
            return
        }
        clearTimeout(this._timer)
        this._timer = setTimeout(() => {
            this._tick().catch(err => this.logger.error(`Uncaught tick error: ${err.message}`))
            if (this._timer !== null) this._scheduleNext()
        }, delayMs)
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
