import 'dotenv/config'

export function loadConfig() {
    return {
        // Identity
        agentId: process.env.AGENT_ID || 'pip',
        personaPath: process.env.PERSONA_PATH || './personas/pip.json',

        // Connection
        serverUrl: process.env.SERVER_URL || 'ws://localhost:4001',
        reconnectIntervalMs: 5000,
        identifyTimeoutMs: 10000,

        // Heartbeat (adaptive)
        heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_MS || '8000'),
        heartbeatMinMs: parseInt(process.env.HEARTBEAT_MIN_MS || '4000'),
        heartbeatMaxMs: parseInt(process.env.HEARTBEAT_MAX_MS || '15000'),
        maxThinkTimeMs: 30000,

        // LLM
        ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
        ollamaModel: process.env.OLLAMA_MODEL || 'qwen3:4b',
        cloudApiKey: process.env.CLOUD_API_KEY || null,
        cloudApiUrl: process.env.CLOUD_API_URL || null,
        cloudModel: process.env.CLOUD_MODEL || 'llama-3.1-8b-instant',
        temperature: 0.7,
        maxTokens: 200,

        // Memory
        dataDir: process.env.DATA_DIR || './data',
        workingMemorySize: 20,
        maxDailyLogAgeDays: 7,

        // Internal state
        stateDecayRate: parseFloat(process.env.STATE_DECAY_RATE || '0.1'),
        signalPullRate: parseFloat(process.env.SIGNAL_PULL_RATE || '0.15'),

        // Repetition guard
        repetitionHistorySize: parseInt(process.env.REPETITION_HISTORY || '20'),

        // Sleep cycle
        activeHoursBeforeSleep: parseFloat(process.env.ACTIVE_HOURS_BEFORE_SLEEP || '4'),
        sleepDurationMinutes: parseInt(process.env.SLEEP_DURATION_MINUTES || '60'),

        // API server
        apiPort: parseInt(process.env.API_PORT || '5000'),

        // Logging
        logLevel: process.env.LOG_LEVEL || 'info',
    }
}
