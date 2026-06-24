import 'dotenv/config'
import { readFile } from 'node:fs/promises'

import { loadConfig } from './config.js'
import { Logger } from './logging/Logger.js'
import { EnvironmentSocket } from './connection/EnvironmentSocket.js'
import { WorkingMemory } from './memory/WorkingMemory.js'
import { MemoryFiles } from './memory/MemoryFiles.js'
import { DailyLog } from './memory/DailyLog.js'
import { SpeechLog } from './memory/SpeechLog.js'
import { LLMClient } from './llm/LLMClient.js'
import { PromptBuilder } from './llm/PromptBuilder.js'
import { Think } from './cognition/Think.js'
import { InternalState } from './cognition/InternalState.js'
import { DeltaDetector } from './cognition/DeltaDetector.js'
import { RepetitionGuard } from './cognition/RepetitionGuard.js'
import { Heartbeat } from './loop/Heartbeat.js'
import { SleepCycle } from './loop/SleepCycle.js'
import { ApiServer } from './api/ApiServer.js'

async function main() {
    const config = loadConfig()
    const logger = new Logger(config)

    // Last-resort safety net for an unattended installation: a stray throw
    // or rejected promise in any fire-and-forget path (sleep consolidation,
    // a socket callback, an API handler) must NOT take the whole agent
    // down. Log loudly and keep running — systemd is the backstop, but an
    // in-process survivor preserves working memory and avoids reconnect
    // churn. (Paired with the guarded socket parse in EnvironmentSocket.)
    process.on('uncaughtException', (err) => {
        logger.error(`uncaughtException: ${err?.stack || err}`)
    })
    process.on('unhandledRejection', (reason) => {
        logger.error(`unhandledRejection: ${reason?.stack || reason}`)
    })

    logger.info(`=== 3aiii v0.3.10 ===`)
    logger.info(`Agent: ${config.agentId}`)
    logger.info(`Server: ${config.serverUrl}`)
    logger.info(`LLM: quality=${config.cloudModel}, fast=${config.cloudModelFast}, local=${config.ollamaModel}`)
    logger.info(`Heartbeat: ${config.heartbeatIntervalMs}ms base (adaptive ${config.heartbeatMinMs}-${config.heartbeatMaxMs}ms)`)
    logger.info(`Sleep: ${config.activeHoursBeforeSleep}h active / ${config.sleepDurationMinutes}m sleep`)
    if (config.quietHours) {
        logger.info(`Quiet hours: ${config.quietHours} UTC (${config.quietActiveMinutes}m active / ${config.quietSleepMinutes}m sleep)`)
    }

    // load persona
    let persona
    try {
        const raw = await readFile(config.personaPath, 'utf-8')
        persona = JSON.parse(raw)
        logger.info(`Persona loaded: ${persona.name} (${persona.traits?.join(', ')})`)
    } catch (err) {
        logger.error(`Failed to load persona from ${config.personaPath}: ${err.message}`)
        process.exit(1)
    }

    // init modules
    const socket = new EnvironmentSocket(config, logger)
    const workingMemory = new WorkingMemory(config)
    const memoryFiles = new MemoryFiles(config, logger)
    const dailyLog = new DailyLog(config, logger)
    const llmClient = new LLMClient(config, logger)
    const promptBuilder = new PromptBuilder(persona)

    // new cognitive modules
    const internalState = new InternalState(config, logger)
    const deltaDetector = new DeltaDetector(logger)
    const repetitionGuard = new RepetitionGuard(config, logger)

    const speechLog = new SpeechLog(config, logger)

    await memoryFiles.init()
    await dailyLog.init()
    await llmClient.init()
    await speechLog.init()
    const checkpoint = await internalState.restore()  // crash recovery: reload last emotional state

    const think = new Think(llmClient, promptBuilder, memoryFiles, dailyLog, workingMemory, logger)
    const sleepCycle = new SleepCycle(think, memoryFiles, dailyLog, workingMemory, internalState, repetitionGuard, speechLog, config, logger)
    await sleepCycle.loadOriginalPersona(persona)  // immutable drift baseline
    const heartbeat = new Heartbeat(
        socket, think, workingMemory, memoryFiles, dailyLog, sleepCycle,
        internalState, deltaDetector, repetitionGuard, speechLog,
        config, logger
    )

    // restore tick counter from checkpoint (prevents reset on restart)
    if (checkpoint?.tickCount) {
        heartbeat.tickCount = checkpoint.tickCount
        logger.info(`Tick counter restored: ${checkpoint.tickCount}`)
    }

    // start API server. shared state object passed in
    const apiState = {
        persona, heartbeat, sleepCycle, memoryFiles, dailyLog,
        workingMemory, socket, promptBuilder, internalState,
        deltaDetector, repetitionGuard, think,
    }
    const api = new ApiServer(config.apiPort, apiState, logger, {
        host: config.apiHost,
        adminToken: config.adminToken,
    })
    api.start()

    // wire API emitter into heartbeat so tick/sleep events flow to SSE clients
    heartbeat.api = api

    // also emit sleep/wake events from sleepCycle
    const origStart = sleepCycle._startSleep.bind(sleepCycle)
    sleepCycle._startSleep = async (quiet) => {
        await origStart(quiet)
        api.emit('sleep', { agent: persona.name, quiet: !!quiet, timestamp: Date.now() })
    }
    const origWake = sleepCycle._wake.bind(sleepCycle)
    sleepCycle._wake = () => {
        origWake()
        api.emit('wake', { agent: persona.name, timestamp: Date.now() })
    }

    // connect to environment server
    try {
        await socket.connect()
        logger.info('Connected and identified with environment server')
    } catch (err) {
        logger.error(`Failed to connect: ${err.message}`)
        logger.info('Will keep trying via reconnect...')
    }

    // log startup
    await dailyLog.append(`=== AGENT STARTED === (${persona.name})`)
    api.emit('started', { agent: persona.name, timestamp: Date.now() })

    // start the heartbeat loop
    heartbeat.start()

    // graceful shutdown (guarded against double-signal)
    let shuttingDown = false
    const shutdown = async (signal) => {
        if (shuttingDown) return
        shuttingDown = true
        logger.info(`${signal} received, shutting down...`)
        heartbeat.stop()
        sleepCycle.stop()
        api.stop()
        await dailyLog.append('=== AGENT STOPPED ===')
        await speechLog.save()
        await dailyLog.stop()  // flush buffer to disk
        socket.close()
        process.exit(0)
    }

    process.on('SIGINT', () => shutdown('SIGINT'))
    process.on('SIGTERM', () => shutdown('SIGTERM'))

    logger.info(`3aiii running — API on http://localhost:${config.apiPort}`)
}

main().catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
})
