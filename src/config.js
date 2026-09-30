import 'dotenv/config'

export function loadConfig() {
    return {
        // identity
        agentId: process.env.AGENT_ID || 'pip',
        personaPath: process.env.PERSONA_PATH || './personas/pip.json',
        // 1 = the world hands over the persona (and later rewrites of it) instead
        // of a file shipped with the agent. the file at PERSONA_PATH becomes a cache
        personaFromWorld: process.env.PERSONA_FROM_WORLD === '1',

        // connection
        serverUrl: process.env.SERVER_URL || 'ws://localhost:4001',
        reconnectIntervalMs: 5000,
        identifyTimeoutMs: 10000,
        // sent on IDENTIFY. envs with ADMIN_TOKEN set need it (3eyes sim when
        // bound to 0.0.0.0), empty is fine everywhere else
        adminToken: process.env.ADMIN_TOKEN || '',

        // heartbeat (adaptive)
        heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_MS || '8000'),
        heartbeatMinMs: parseInt(process.env.HEARTBEAT_MIN_MS || '4000'),
        heartbeatMaxMs: parseInt(process.env.HEARTBEAT_MAX_MS || '15000'),
        maxThinkTimeMs: 30000,

        // LLM
        ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
        ollamaModel: process.env.OLLAMA_MODEL || 'qwen3:4b',
        cloudApiKey: process.env.CLOUD_API_KEY || null,
        cloudApiUrl: process.env.CLOUD_API_URL || null,
        // groq defaults. 120b is bigger than llama-3.3-70b and ~75% cheaper.
        // 20b for fast, ~1000 TPS and none of the voice tics 8b llama picks up
        cloudModel: process.env.CLOUD_MODEL || 'openai/gpt-oss-120b',
        cloudModelFast: process.env.CLOUD_MODEL_FAST || 'openai/gpt-oss-20b',
        // optional decision tier, goes to anthropic. an env opts in with
        // signals.decision_pending >= 0.5 (eg a trade dossier waiting on a
        // verdict). no key = falls back to the quality chain, victor/synth dont care
        anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
        decisionModel: process.env.DECISION_MODEL || 'claude-sonnet-5',
        // gpt-oss only. low keeps ticks quick and stops the reasoning eating
        // the json (400 json_validate_failed). REASONING_EFFORT="" for other providers
        reasoningEffort: process.env.REASONING_EFFORT ?? 'low',
        temperature: 0.7,
        // this caps reasoning + output together. at 500 gpt-oss burned it all
        // thinking, sent back an empty completion and groq 400'd it
        // (json_validate_failed), about half the quality ticks ended up on
        // FallbackBrain. 1500 leaves room for both
        maxTokens: parseInt(process.env.MAX_TOKENS || '1500'),
        // a ceiling on paid calls per UTC day (llm/Budget.js). 0 = none
        dailyCallBudget: parseInt(process.env.DAILY_CALL_BUDGET || '0'),
        dailyTokenBudget: parseInt(process.env.DAILY_TOKEN_BUDGET || '0'),

        // memory
        dataDir: process.env.DATA_DIR || './data',
        workingMemorySize: 20,
        maxDailyLogAgeDays: 7,
        // data/decisions, ~1MB a day. two weeks so you can compare a week to the last one
        decisionLogDays: parseInt(process.env.DECISION_LOG_DAYS || '14'),
        // where to POST the last 24h of decisions as numbers, every 6h, with the
        // admin token. empty = off
        digestUrl: process.env.DIGEST_URL || '',

        // internal state
        stateDecayRate: parseFloat(process.env.STATE_DECAY_RATE || '0.1'),
        signalPullRate: parseFloat(process.env.SIGNAL_PULL_RATE || '0.15'),

        // repetition guard
        repetitionHistorySize: parseInt(process.env.REPETITION_HISTORY || '20'),

        // sleep cycle
        activeHoursBeforeSleep: parseFloat(process.env.ACTIVE_HOURS_BEFORE_SLEEP || '0.83'),
        sleepDurationMinutes: parseInt(process.env.SLEEP_DURATION_MINUTES || '10'),
        // a restart in the night isnt a new day, dont go straight back to sleep
        worldSleepRestartGuardMinutes: parseInt(process.env.WORLD_SLEEP_RESTART_GUARD_MINUTES || '30'),
        // longest one offering waits before he's sent to look. a backlog shortens it
        offeringAttentionMaxMinutes: parseInt(process.env.OFFERING_ATTENTION_MAX_MINUTES || '15'),

        // min gap between persona rewrites. sleep is ~50min which is fine for
        // memory but when evolution rode along with it victor got seven
        // near-identical traits in one night. defered to the next sleep, not skipped
        personaEvolutionMinHours: parseFloat(process.env.PERSONA_EVOLUTION_MIN_HOURS || '12'),

        // threads (SleepCycle._formDesire) have to be able to die or they
        // write memory and then cite it back as a reason to stay
        threadMaxRenewals: parseInt(process.env.THREAD_MAX_RENEWALS || '12'),
        threadMaxAgeDays: parseFloat(process.env.THREAD_MAX_AGE_DAYS || '2'),

        // max memory.md bullets per subject. victors had "glow"/"light" in 15
        // of 45. a number not a banned list, next months fixation wont be this ones
        memorySubjectCeiling: parseInt(process.env.MEMORY_SUBJECT_CEILING || '4'),

        // quiet hours, less going on when nobody's watching. "HH:MM-HH:MM" UTC
        quietHours: process.env.QUIET_HOURS || null,
        quietActiveMinutes: parseInt(process.env.QUIET_ACTIVE_MINUTES || '15'),
        quietSleepMinutes: parseInt(process.env.QUIET_SLEEP_MINUTES || '30'),

        // api
        apiPort: parseInt(process.env.API_PORT || '5000'),
        // loopback by default, it can swap the persona and write memories. ssh
        // tunnel in. API_HOST=0.0.0.0 only with ADMIN_TOKEN set
        apiHost: process.env.API_HOST || '127.0.0.1',

        // logging
        logLevel: process.env.LOG_LEVEL || 'info',
    }
}
