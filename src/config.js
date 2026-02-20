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

        // Heartbeat
        heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_MS || '8000'),
        maxThinkTimeMs: 30000,

        // LLM
        ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
        ollamaModel: process.env.OLLAMA_MODEL || 'qwen2.5:3b',
        cloudApiKey: process.env.CLOUD_API_KEY || null,
        cloudApiUrl: process.env.CLOUD_API_URL || null,
        cloudModel: process.env.CLOUD_MODEL || 'llama-3.1-8b-instant',
        temperature: 0.7,
        maxTokens: 200,

        // Memory
        dataDir: process.env.DATA_DIR || './data',
        workingMemorySize: 12,
        maxDailyLogAgeDays: 7,

        // Sleep cycle
        activeHoursBeforeSleep: parseFloat(process.env.ACTIVE_HOURS_BEFORE_SLEEP || '4'),
        sleepDurationMinutes: parseInt(process.env.SLEEP_DURATION_MINUTES || '60'),

        // API server
        apiPort: parseInt(process.env.API_PORT || '5000'),

        // Logging
        logLevel: process.env.LOG_LEVEL || 'info',
    }
}
