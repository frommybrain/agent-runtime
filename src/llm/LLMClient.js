import { Ollama } from 'ollama'

// LLM client. tiered model routing for cost.
//
// three tiers:
//   'quality' — 70B cloud first, Ollama fallback (complex decisions)
//   'fast'    — Ollama first (free), 8B cloud fallback (routine ticks)
//   'skip'    — no LLM call (caller should use FallbackBrain)
//
// v0.3.8: tiered routing. v0.3.7: 429 backoff, periodic Ollama re-check.

export class LLMClient {
    constructor(config, logger) {
        this.logger = logger
        this.temperature = config.temperature
        this.maxTokens = config.maxTokens

        // local Ollama
        this.ollama = new Ollama({ host: config.ollamaHost })
        this.ollamaModel = config.ollamaModel

        // cloud API (Groq, Together, etc)
        this.cloudApiKey = config.cloudApiKey
        this.cloudApiUrl = config.cloudApiUrl
        this.cloudModel = config.cloudModel              // 70B quality
        this.cloudModelFast = config.cloudModelFast      // 8B fast

        // decision tier (optional). anthropic, for money/high-stakes ticks.
        this.anthropicApiKey = config.anthropicApiKey || null
        this.decisionModel = config.decisionModel
        // reasoning_effort for gpt-oss reasoning models. 'low' caps the
        // internal chain-of-thought so it cannot consume the whole
        // max_tokens budget before emitting the JSON action (the
        // json_validate_failed 400 root cause). Also faster + cheaper
        // per tick. Empty string omits the param for providers/models
        // that don't support it.
        this.reasoningEffort = config.reasoningEffort || ''

        this.ollamaAvailable = false
        this._cloudCooldownUntil = 0
        this._lastOllamaCheck = 0
        this._ollamaRecheckMs = 5 * 60 * 1000

        // Ollama circuit breaker. On a saturated host qwen3 times out every
        // call; without a breaker the loop pays the full timeout per tick
        // forever. After N consecutive timeouts we trip the breaker and stop
        // attempting Ollama for a cooldown, so cognition degrades straight to
        // the heuristic instead of stalling 8-30s every tick.
        this.ollamaTimeoutMs = config.ollamaTimeoutMs || 8000  // hard cap, well under the heartbeat
        this._ollamaTimeoutStreak = 0
        this._ollamaBreakerUntil = 0
        this._ollamaBreakerThreshold = 3
        this._ollamaBreakerCooldownMs = 5 * 60 * 1000

        // Short cooldown after a cloud failure that is NOT a 429 (e.g. a 400
        // or network error) so we don't re-hammer a momentarily-unhappy model
        // every tick. 429 keeps its longer 60s cooldown set in _cloudGenerate.
        this._cloudSoftCooldownMs = 8000

        // observability counters
        this.tierCounts = { skip: 0, fast: 0, quality: 0, decision: 0 }
        // rolling outcome window for a live LLM-success / fallback-rate metric
        // (the single number that tells you the brain is alive). Each entry is
        // true (an LLM produced text) or false (fell through to null/heuristic).
        this._outcomeWindow = []
        this._outcomeWindowMax = 50
    }

    _recordOutcome(ok) {
        this._outcomeWindow.push(ok)
        if (this._outcomeWindow.length > this._outcomeWindowMax) this._outcomeWindow.shift()
    }

    // Rolling fraction of recent generate() calls that an LLM actually
    // answered (vs fell through to the heuristic). 1.0 = healthy, low =
    // the bird is mostly running on the fallback brain.
    recentSuccessRate() {
        if (this._outcomeWindow.length === 0) return 1
        const ok = this._outcomeWindow.filter(Boolean).length
        return ok / this._outcomeWindow.length
    }

    _ollamaUsable() {
        return this.ollamaAvailable && Date.now() >= this._ollamaBreakerUntil
    }

    async init() {
        try {
            await this.ollama.list()
            this.ollamaAvailable = true
            this._lastOllamaCheck = Date.now()
            this.logger.info(`Ollama connected (model: ${this.ollamaModel})`)
        } catch {
            this.ollamaAvailable = false
            this._lastOllamaCheck = Date.now()
            if (this.cloudApiKey) {
                this.logger.warn('Ollama unavailable, will use cloud fallback')
            } else {
                this.logger.warn('Ollama unavailable and no cloud API configured')
            }
        }
    }

    // generate a response with tier-aware routing.
    // tier: 'quality' (default) | 'fast' | 'decision'
    // returns: { text: string, source: 'decision'|'cloud'|'cloud-fast'|'ollama'|null }
    // jsonMode (default true) controls whether response_format:json_object
    // is sent — markdown-output prompts (sleep consolidation) MUST pass
    // false or Groq 400s the request.
    async generate(systemPrompt, userPrompt, timeoutMs = 30000, tier = 'quality', jsonMode = true) {
        // periodically re-check Ollama if it was unavailable
        if (!this.ollamaAvailable && Date.now() - this._lastOllamaCheck > this._ollamaRecheckMs) {
            await this._recheckOllama()
        }

        // track tier usage
        this.tierCounts[tier] = (this.tierCounts[tier] || 0) + 1

        const result = tier === 'fast'
            ? await this._generateFast(systemPrompt, userPrompt, timeoutMs, jsonMode)
            : tier === 'decision'
                ? await this._generateDecision(systemPrompt, userPrompt, timeoutMs, jsonMode)
                : await this._generateQuality(systemPrompt, userPrompt, timeoutMs, jsonMode)

        this._recordOutcome(!!result.text)
        return result
    }

    // decision tier: anthropic first, then the whole quality chain. an env
    // asks for this on ticks where being wrong costs money; if no anthropic
    // key is configured the tier is just a quality alias.
    async _generateDecision(systemPrompt, userPrompt, timeoutMs, jsonMode) {
        if (this.anthropicApiKey) {
            try {
                const result = await this._anthropicGenerate(systemPrompt, userPrompt, timeoutMs)
                return { text: result, source: 'decision' }
            } catch (err) {
                this.logger.warn(`Anthropic decision failed: ${err.message} — demoting to quality chain`)
            }
        }
        return this._generateQuality(systemPrompt, userPrompt, timeoutMs, jsonMode)
    }

    async _anthropicGenerate(systemPrompt, userPrompt, timeoutMs) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), timeoutMs)

        // no response_format equivalent here — Think's parser already
        // handles fences/preamble, and the system prompt demands raw JSON.
        try {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.anthropicApiKey,
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                    model: this.decisionModel,
                    max_tokens: this.maxTokens,
                    temperature: this.temperature,
                    system: systemPrompt,
                    messages: [
                        { role: 'user', content: userPrompt },
                    ],
                }),
                signal: controller.signal,
            })

            if (!response.ok) {
                let body = ''
                try { body = await response.text() } catch { /* ignore */ }
                throw new Error(`Anthropic API ${response.status}: ${response.statusText}${body ? ` — ${body.slice(0, 300)}` : ''}`)
            }

            const data = await response.json()
            return data.content?.[0]?.text || ''
        } finally {
            clearTimeout(timeout)
        }
    }

    // fast tier: 20B cloud first (fast + cheap), Ollama fallback.
    async _generateFast(systemPrompt, userPrompt, timeoutMs, jsonMode) {
        if (this.cloudApiKey && this.cloudApiUrl && Date.now() >= this._cloudCooldownUntil) {
            try {
                const result = await this._cloudGenerate(systemPrompt, userPrompt, timeoutMs, this.cloudModelFast, jsonMode)
                return { text: result, source: 'cloud-fast' }
            } catch (err) {
                this.logger.warn(`Cloud fast failed: ${err.message}`)
                this._noteCloudFailure(err)
            }
        }
        return this._tryOllama(systemPrompt, userPrompt, 'fast tier')
    }

    // quality tier: 120B cloud → (on cloud failure) 20B cloud → Ollama.
    // The 20B demotion is the crucial new rung: when the 120B reasoning
    // model chokes (e.g. a transient json_validate_failed), the faster 20B
    // usually answers cleanly, keeping cognition on the cloud instead of
    // collapsing to the heuristic via a doomed Ollama attempt.
    async _generateQuality(systemPrompt, userPrompt, timeoutMs, jsonMode) {
        if (this.cloudApiKey && this.cloudApiUrl && Date.now() >= this._cloudCooldownUntil) {
            try {
                const result = await this._cloudGenerate(systemPrompt, userPrompt, timeoutMs, this.cloudModel, jsonMode)
                return { text: result, source: 'cloud' }
            } catch (err) {
                this.logger.warn(`Cloud LLM failed: ${err.message}`)
                this._noteCloudFailure(err)
                // Demote to the fast model before giving up on the cloud.
                try {
                    const result = await this._cloudGenerate(systemPrompt, userPrompt, timeoutMs, this.cloudModelFast, jsonMode)
                    this.logger.info(`Quality demoted to ${this.cloudModelFast} after 120B failure`)
                    return { text: result, source: 'cloud-fast' }
                } catch (err2) {
                    this.logger.warn(`Cloud demote also failed: ${err2.message}`)
                }
            }
        } else if (this.cloudApiKey && Date.now() < this._cloudCooldownUntil) {
            const remaining = Math.round((this._cloudCooldownUntil - Date.now()) / 1000)
            this.logger.debug(`Cloud API cooling down (${remaining}s remaining)`)
        }
        return this._tryOllama(systemPrompt, userPrompt, 'quality tier')
    }

    // Shared Ollama path with circuit breaker. Returns {text, source}.
    async _tryOllama(systemPrompt, userPrompt, label) {
        if (!this._ollamaUsable()) {
            return { text: null, source: null }
        }
        try {
            const result = await this._ollamaGenerate(systemPrompt, userPrompt)
            this._ollamaTimeoutStreak = 0   // recovered
            return { text: result, source: 'ollama' }
        } catch (err) {
            this.logger.warn(`Ollama failed (${label}): ${err.message}`)
            if (/timeout/i.test(err.message)) {
                this._ollamaTimeoutStreak++
                if (this._ollamaTimeoutStreak >= this._ollamaBreakerThreshold) {
                    this._ollamaBreakerUntil = Date.now() + this._ollamaBreakerCooldownMs
                    this.logger.warn(`Ollama circuit breaker tripped (${this._ollamaTimeoutStreak} consecutive timeouts) — skipping local model for ${Math.round(this._ollamaBreakerCooldownMs / 60000)}min`)
                    this._ollamaTimeoutStreak = 0
                }
            }
            return { text: null, source: null }
        }
    }

    // Soft-cooldown the cloud after a non-429 failure so we don't re-hammer
    // a momentarily-unhappy model every tick. (429 sets its own 60s cooldown.)
    _noteCloudFailure(err) {
        if (!/\b429\b/.test(err.message)) {
            this._cloudCooldownUntil = Math.max(this._cloudCooldownUntil, Date.now() + this._cloudSoftCooldownMs)
        }
    }

    async _ollamaGenerate(systemPrompt, userPrompt) {
        // Hard-cap the Ollama timeout well under the heartbeat so a slow
        // local generation can't freeze the body for 30s.
        const timeoutMs = this.ollamaTimeoutMs
        const chatPromise = this.ollama.chat({
            model: this.ollamaModel,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            options: {
                temperature: this.temperature,
                num_predict: this.maxTokens,
            },
            stream: false,
        })
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Ollama timeout')), timeoutMs)
        )
        const response = await Promise.race([chatPromise, timeoutPromise])
        return response.message.content
    }

    async _cloudGenerate(systemPrompt, userPrompt, timeoutMs, model, jsonMode = true) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), timeoutMs)

        // response_format:json_object constrains the model to a single valid
        // JSON object (no fences/preamble) for the action loop. But Groq
        // 400s any json_object request whose messages lack the word "json"
        // — so MARKDOWN-output prompts (sleep consolidation) MUST pass
        // jsonMode=false or every consolidation fails. That was the silent
        // "memory=false" bug. We only attach response_format when jsonMode.
        try {
            const response = await fetch(this.cloudApiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.cloudApiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt },
                    ],
                    temperature: this.temperature,
                    max_tokens: this.maxTokens,
                    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
                    // Only included when configured (Groq gpt-oss). Caps
                    // reasoning so it can't starve the JSON output.
                    ...(this.reasoningEffort ? { reasoning_effort: this.reasoningEffort } : {}),
                }),
                signal: controller.signal,
            })

            if (!response.ok) {
                if (response.status === 429) {
                    this._cloudCooldownUntil = Date.now() + 60000
                    this.logger.warn('Cloud API rate limited (429) — cooling down for 60s')
                }
                // Surface the provider's error BODY, not just statusText.
                // A bare "400: Bad Request" masked a json_validate_failed
                // root cause for a long time. The body is the diagnosis.
                let body = ''
                try { body = await response.text() } catch { /* ignore */ }
                throw new Error(`Cloud API ${response.status}: ${response.statusText}${body ? ` — ${body.slice(0, 300)}` : ''}`)
            }

            const data = await response.json()
            return data.choices?.[0]?.message?.content || ''
        } finally {
            clearTimeout(timeout)
        }
    }

    async _recheckOllama() {
        this._lastOllamaCheck = Date.now()
        try {
            await this.ollama.list()
            this.ollamaAvailable = true
            this.logger.info('Ollama re-check: available again')
        } catch {
            // still unavailable
        }
    }

    isAvailable() {
        return this.ollamaAvailable || !!(this.cloudApiKey && this.cloudApiUrl)
    }
}
