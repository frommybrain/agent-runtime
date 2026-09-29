import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadConfig } from './config.js'
import { Logger } from './logging/Logger.js'
import { DecisionLog } from './logging/DecisionLog.js'
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

// commit sha for the decision log (prompts live in code so its the prompt
// version too). +dirty if someone hand patched the pi
function codeVersion() {
    const cwd = dirname(fileURLToPath(import.meta.url))
    const run = (args) => execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    try {
        const sha = run(['rev-parse', '--short', 'HEAD'])
        let dirty = false
        try { run(['diff', '--quiet', 'HEAD']) } catch { dirty = true }
        return dirty ? `${sha}+dirty` : sha
    } catch {
        return null
    }
}

async function main() {
    const config = loadConfig()
    const logger = new Logger(config)

    // dont die on a stray throw from some fire-and-forget path (sleep, socket
    // callbacks, api). systemd would restart us but we'd lose working memory
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
    memoryFiles.setPersona(persona)  // the ban list is the persona's, not the runtime's
    const dailyLog = new DailyLog(config, logger)
    const code = codeVersion()
    logger.info(`Code: ${code || 'unknown (not a git checkout)'}`)
    const decisionLog = new DecisionLog(config, logger, { code })
    const llmClient = new LLMClient(config, logger)
    const promptBuilder = new PromptBuilder(persona)

    const internalState = new InternalState(config, logger)
    const deltaDetector = new DeltaDetector(logger)
    const repetitionGuard = new RepetitionGuard(config, logger)

    const speechLog = new SpeechLog(config, logger)

    await memoryFiles.init()
    await dailyLog.init()
    await decisionLog.init()
    await llmClient.init()
    await speechLog.init()
    const checkpoint = await internalState.restore()  // last mood/energy from before a crash

    const think = new Think(llmClient, promptBuilder, memoryFiles, dailyLog, workingMemory, logger)
    const sleepCycle = new SleepCycle(think, memoryFiles, dailyLog, workingMemory, internalState, repetitionGuard, speechLog, config, logger)
    await sleepCycle.loadOriginalPersona(persona)  // drift baseline, never changes
    const heartbeat = new Heartbeat(
        socket, think, workingMemory, memoryFiles, dailyLog, sleepCycle,
        internalState, deltaDetector, repetitionGuard, speechLog,
        config, logger
    )

    // otherwise tick count resets to 0 every restart
    if (checkpoint?.tickCount) {
        heartbeat.tickCount = checkpoint.tickCount
        logger.info(`Tick counter restored: ${checkpoint.tickCount}`)
    }

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

    // so ticks go out over SSE
    heartbeat.api = api
    heartbeat.decisionLog = decisionLog

    // bit hacky, wraps sleepCycle so sleep/wake hit SSE too
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

    try {
        await socket.connect()
        logger.info('Connected and identified with environment server')
    } catch (err) {
        logger.error(`Failed to connect: ${err.message}`)
        logger.info('Will keep trying via reconnect...')
    }

    await dailyLog.append(`=== AGENT STARTED === (${persona.name})`)
    api.emit('started', { agent: persona.name, timestamp: Date.now() })

    // hourly persona push to the sim. read off disk each time so it has
    // whatever SleepCycle evolved, not the boot copy
    socket.setPersonaProvider(async () => JSON.parse(await readFile(config.personaPath, 'utf-8')))
    const personaPush = setInterval(() => socket.pushPersona(), 60 * 60 * 1000)

    heartbeat.start()

    // second ctrl-c shouldnt run this twice
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
        await dailyLog.stop()  // flushes
        await decisionLog.stop()
        clearInterval(personaPush)
        socket.close()
        process.exit(0)
    }

    process.on('SIGINT', () => shutdown('SIGINT'))
    process.on('SIGTERM', () => shutdown('SIGTERM'))

    logger.info(`3aiii running - API on http://localhost:${config.apiPort}`)
}

main().catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
})
