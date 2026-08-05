import 'dotenv/config'

export function loadConfig() {
    return {
        // identity
        agentId: process.env.AGENT_ID || 'pip',
        personaPath: process.env.PERSONA_PATH || './personas/pip.json',

        // connection
        serverUrl: process.env.SERVER_URL || 'ws://localhost:4001',
        reconnectIntervalMs: 5000,
        identifyTimeoutMs: 10000,
        // optional auth token sent on IDENTIFY. required by envs that have
        // ADMIN_TOKEN set (eg 3eyes sim-server when bound to 0.0.0.0).
        // empty string = no token, accepted by envs that dont require auth.
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
        // default models on Groq:
        //   quality = openai/gpt-oss-120b. bigger AND ~75% cheaper than
        //             llama-3.3-70b on Groq's pricing
        //   fast    = openai/gpt-oss-20b. same family as quality, 1000 TPS
        //             (vs 840 for llama-3.1-8b). avoids the voice tics 8B
        //             llama produces under sustained use
        cloudModel: process.env.CLOUD_MODEL || 'openai/gpt-oss-120b',
        cloudModelFast: process.env.CLOUD_MODEL_FAST || 'openai/gpt-oss-20b',
        // decision tier (optional). anthropic for high-stakes ticks — an env
        // opts in by sending signals.decision_pending >= 0.5 (eg a trade
        // dossier waiting on a verdict). no key set = tier quietly routes to
        // the normal quality chain, so victor/synth deployments are untouched.
        anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
        decisionModel: process.env.DECISION_MODEL || 'claude-sonnet-5',
        // reasoning_effort for gpt-oss models. 'low' keeps per-tick action
        // decisions fast + cheap and stops unbounded reasoning from
        // starving the JSON output (the 400 json_validate_failed cause).
        // Set REASONING_EFFORT="" to disable for non-gpt-oss providers.
        reasoningEffort: process.env.REASONING_EFFORT ?? 'low',
        temperature: 0.7,
        // max_tokens caps TOTAL completion tokens — and gpt-oss is a
        // reasoning model that spends a large, variable budget on internal
        // chain-of-thought BEFORE it emits the JSON action. At 500 the
        // reasoning routinely consumed the whole budget, the model emitted
        // an empty completion, and Groq's json_object validator returned
        // 400 json_validate_failed (failed_generation: ""). In production
        // this fired on ~half of all quality-tier ticks, collapsing the
        // bird onto the heuristic FallbackBrain. 1500 gives reasoning +
        // the (small) JSON output room to coexist. Env-overridable so a
        // deployment can tune without a code change.
        maxTokens: parseInt(process.env.MAX_TOKENS || '1500'),

        // memory
        dataDir: process.env.DATA_DIR || './data',
        workingMemorySize: 20,
        maxDailyLogAgeDays: 7,

        // internal state
        stateDecayRate: parseFloat(process.env.STATE_DECAY_RATE || '0.1'),
        signalPullRate: parseFloat(process.env.SIGNAL_PULL_RATE || '0.15'),

        // repetition guard
        repetitionHistorySize: parseInt(process.env.REPETITION_HISTORY || '20'),

        // sleep cycle
        activeHoursBeforeSleep: parseFloat(process.env.ACTIVE_HOURS_BEFORE_SLEEP || '0.83'),
        sleepDurationMinutes: parseInt(process.env.SLEEP_DURATION_MINUTES || '10'),

        // How often self-reflection may actually rewrite the persona.
        //
        // Sleep runs about every 50 minutes, which is right for memory: he
        // consolidates what just happened while it is still fresh. It is
        // badly wrong for identity. Persona evolution rode the same cadence,
        // so who he is was up for revision roughly 24 times a day, and
        // Victor picked up seven near-identical traits in a single night,
        // one per sleep, each justified with the same sentence about
        // visiting "many varied locations".
        //
        // Decoupled rather than slowed: consolidation stays hourly, the
        // character sheet changes about twice a day. Nothing is skipped,
        // only deferred to the next eligible sleep.
        personaEvolutionMinHours: parseFloat(process.env.PERSONA_EVOLUTION_MIN_HOURS || '12'),

        // A thread is what pulls at him across days; see SleepCycle
        // _formDesire. It has to be able to die, or it writes his memory
        // and then cites it back as proof it should stay.
        threadMaxRenewals: parseInt(process.env.THREAD_MAX_RENEWALS || '12'),
        threadMaxAgeDays: parseFloat(process.env.THREAD_MAX_AGE_DAYS || '2'),

        // quiet hours. reduced activity during low-viewership windows.
        // format: "HH:MM-HH:MM" in UTC (eg "02:00-10:00")
        quietHours: process.env.QUIET_HOURS || null,
        quietActiveMinutes: parseInt(process.env.QUIET_ACTIVE_MINUTES || '15'),
        quietSleepMinutes: parseInt(process.env.QUIET_SLEEP_MINUTES || '30'),

        // API server
        apiPort: parseInt(process.env.API_PORT || '5000'),
        // The local control API can hot-swap the persona, inject memories,
        // and force sleep — so it binds to loopback by default (reach it via
        // an SSH tunnel). Set API_HOST=0.0.0.0 to expose it on the LAN, but
        // ONLY together with ADMIN_TOKEN — mutating routes require it.
        apiHost: process.env.API_HOST || '127.0.0.1',

        // logging
        logLevel: process.env.LOG_LEVEL || 'info',
    }
}
