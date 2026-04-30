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
        // Optional auth token sent on IDENTIFY. Required by environments
        // that have ADMIN_TOKEN set (e.g. 3eyes sim-server when bound to
        // 0.0.0.0). Empty string = no token, accepted by environments
        // that don't require auth.
        adminToken: process.env.ADMIN_TOKEN || '',

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
        // Default models on Groq:
        //   quality = openai/gpt-oss-120b — bigger AND ~75% cheaper than
        //             llama-3.3-70b on Groq's pricing
        //   fast    = openai/gpt-oss-20b  — same family as quality, 1000 TPS
        //             (vs 840 for llama-3.1-8b), avoids the voice tics 8B
        //             llama produces under sustained use
        cloudModel: process.env.CLOUD_MODEL || 'openai/gpt-oss-120b',
        cloudModelFast: process.env.CLOUD_MODEL_FAST || 'openai/gpt-oss-20b',
        temperature: 0.7,
        // 200 was tight for reasoning models — gpt-oss-120b often produces
        // a brief "reasoning" preamble inside the JSON before the action,
        // and 200 was occasionally truncating mid-string.
        maxTokens: 500,

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
        activeHoursBeforeSleep: parseFloat(process.env.ACTIVE_HOURS_BEFORE_SLEEP || '0.83'),
        sleepDurationMinutes: parseInt(process.env.SLEEP_DURATION_MINUTES || '10'),

        // Quiet hours — reduced activity during low-viewership windows
        // Format: "HH:MM-HH:MM" in UTC (e.g., "02:00-10:00")
        quietHours: process.env.QUIET_HOURS || null,
        quietActiveMinutes: parseInt(process.env.QUIET_ACTIVE_MINUTES || '15'),
        quietSleepMinutes: parseInt(process.env.QUIET_SLEEP_MINUTES || '30'),

        // API server
        apiPort: parseInt(process.env.API_PORT || '5000'),

        // Logging
        logLevel: process.env.LOG_LEVEL || 'info',
    }
}
