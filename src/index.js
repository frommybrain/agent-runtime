import 'dotenv/config'
import { readFile } from 'node:fs/promises'

import { loadConfig } from './config.js'
import { Logger } from './logging/Logger.js'
import { EnvironmentSocket } from './connection/EnvironmentSocket.js'
import { WorkingMemory } from './memory/WorkingMemory.js'
import { MemoryFiles } from './memory/MemoryFiles.js'
import { DailyLog } from './memory/DailyLog.js'
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

    logger.info(`=== Agent Runtime v0.3.7 ===`)
    logger.info(`Agent: ${config.agentId}`)
    logger.info(`Server: ${config.serverUrl}`)
    logger.info(`LLM: ${config.ollamaModel} @ ${config.ollamaHost}`)
    logger.info(`Heartbeat: ${config.heartbeatIntervalMs}ms base (adaptive ${config.heartbeatMinMs}-${config.heartbeatMaxMs}ms)`)

    // Load persona
    let persona
    try {
        const raw = await readFile(config.personaPath, 'utf-8')
        persona = JSON.parse(raw)
        logger.info(`Persona loaded: ${persona.name} (${persona.traits?.join(', ')})`)
    } catch (err) {
        logger.error(`Failed to load persona from ${config.personaPath}: ${err.message}`)
        process.exit(1)
    }

    // Init modules
    const socket = new EnvironmentSocket(config, logger)
    const workingMemory = new WorkingMemory(config)
    const memoryFiles = new MemoryFiles(config, logger)
    const dailyLog = new DailyLog(config, logger)
    const llmClient = new LLMClient(config, logger)
    const promptBuilder = new PromptBuilder(persona)

    // New cognitive modules
    const internalState = new InternalState(config, logger)
    const deltaDetector = new DeltaDetector(logger)
    const repetitionGuard = new RepetitionGuard(config, logger)

    await memoryFiles.init()
    await dailyLog.init()
    await llmClient.init()
    const checkpoint = await internalState.restore()  // crash recovery: reload last emotional state

    const think = new Think(llmClient, promptBuilder, memoryFiles, dailyLog, workingMemory, logger)
    const sleepCycle = new SleepCycle(think, memoryFiles, dailyLog, workingMemory, internalState, repetitionGuard, config, logger)
    await sleepCycle.loadOriginalPersona(persona)  // immutable drift baseline
    const heartbeat = new Heartbeat(
        socket, think, workingMemory, memoryFiles, dailyLog, sleepCycle,
        internalState, deltaDetector, repetitionGuard,
        config, logger
    )

    // Restore tick counter from checkpoint (prevents reset on restart)
    if (checkpoint?.tickCount) {
        heartbeat.tickCount = checkpoint.tickCount
        logger.info(`Tick counter restored: ${checkpoint.tickCount}`)
    }

    // Start API server — shared state object passed in
    const apiState = {
        persona, heartbeat, sleepCycle, memoryFiles, dailyLog,
        workingMemory, socket, promptBuilder, internalState,
        deltaDetector, repetitionGuard, think,
    }
    const api = new ApiServer(config.apiPort, apiState, logger)
    api.start()

    // Wire API emitter into heartbeat so tick/sleep events flow to SSE clients
    heartbeat.api = api

    // Also emit sleep/wake events from sleepCycle
    const origStart = sleepCycle._startSleep.bind(sleepCycle)
    sleepCycle._startSleep = async () => {
        await origStart()
        api.emit('sleep', { agent: persona.name, timestamp: Date.now() })
    }
    const origWake = sleepCycle._wake.bind(sleepCycle)
    sleepCycle._wake = () => {
        origWake()
        api.emit('wake', { agent: persona.name, timestamp: Date.now() })
    }

    // Connect to environment server
    try {
        await socket.connect()
        logger.info('Connected and identified with environment server')
    } catch (err) {
        logger.error(`Failed to connect: ${err.message}`)
        logger.info('Will keep trying via reconnect...')
    }

    // Log startup
    await dailyLog.append(`=== AGENT STARTED === (${persona.name})`)
    api.emit('started', { agent: persona.name, timestamp: Date.now() })

    // Start the heartbeat loop
    heartbeat.start()

    // Graceful shutdown
    const shutdown = async (signal) => {
        logger.info(`${signal} received, shutting down...`)
        heartbeat.stop()
        sleepCycle.stop()
        api.stop()
        await dailyLog.append('=== AGENT STOPPED ===')
        await dailyLog.stop()  // flush buffer to disk
        socket.close()
        process.exit(0)
    }

    process.on('SIGINT', () => shutdown('SIGINT'))
    process.on('SIGTERM', () => shutdown('SIGTERM'))

    logger.info(`Agent runtime running — API on http://localhost:${config.apiPort}`)
}

main().catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
})
