import { Ollama } from 'ollama'
import { Budget } from './Budget.js'

// llm client, routes by tier to keep cost down.
// quality = big cloud model, fast = small cloud model, decision = anthropic
// (optional), skip = no call at all, caller uses FallbackBrain. ollama is the
// last rung under the others

export class LLMClient {
    constructor(config, logger) {
        this.logger = logger
        this.temperature = config.temperature
        this.maxTokens = config.maxTokens

        this.ollama = new Ollama({ host: config.ollamaHost })
        this.ollamaModel = config.ollamaModel

        // groq, together, anything openai-shaped
        this.cloudApiKey = config.cloudApiKey
        this.cloudApiUrl = config.cloudApiUrl
        this.cloudModel = config.cloudModel
        this.cloudModelFast = config.cloudModelFast

        // decision tier, anthropic. only for ticks where money is on the line
        this.anthropicApiKey = config.anthropicApiKey || null
        this.decisionModel = config.decisionModel
        // gpt-oss only. 'low' stops the reasoning eating the whole max_tokens
        // before the json comes out (that was the json_validate_failed 400s).
        // empty = dont send it, some providers reject the param
        this.reasoningEffort = config.reasoningEffort || ''

        this.ollamaAvailable = false
        this._cloudCooldownUntil = 0
        this._lastOllamaCheck = 0
        this._ollamaRecheckMs = 5 * 60 * 1000

        // breaker for ollama. on the pi qwen3 times out every call once the box
        // is busy, and without this every tick paid 8-30s for nothing. 3 timeouts
        // in a row = leave it alone for 5 min and go straight to the heuristic
        this.ollamaTimeoutMs = config.ollamaTimeoutMs || 8000  // well under the heartbeat
        this._ollamaTimeoutStreak = 0
        this._ollamaBreakerUntil = 0
        this._ollamaBreakerThreshold = 3
        this._ollamaBreakerCooldownMs = 5 * 60 * 1000

        // short backoff after a non-429 cloud failure. 429 gets its own 60s
        this._cloudSoftCooldownMs = 8000

        this.budget = new Budget(config, logger)

        this.tierCounts = { skip: 0, fast: 0, quality: 0, decision: 0 }
        // last 50 calls, true if a model answered. quickest way to tell if
        // the brain is actually alive or running on the heuristic
        this._outcomeWindow = []
        this._outcomeWindowMax = 50
    }

    _recordOutcome(ok) {
        this._outcomeWindow.push(ok)
        if (this._outcomeWindow.length > this._outcomeWindowMax) this._outcomeWindow.shift()
    }

    // 1.0 = healthy. low means hes mostly on the fallback brain
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

    // tier: 'quality' (default) | 'fast' | 'decision'
    // -> { text, source, model, usage: { in, out, reasoning } | null, ms }
    // model is whoever actually answered (not always what the tier asked for
    // after a demotion), ms covers every rung tried.
    // markdown prompts (sleep consolidation) have to pass jsonMode=false or groq 400s
    async generate(systemPrompt, userPrompt, timeoutMs = 30000, tier = 'quality', jsonMode = true) {
        if (!this.ollamaAvailable && Date.now() - this._lastOllamaCheck > this._ollamaRecheckMs) {
            await this._recheckOllama()
        }

        this.tierCounts[tier] = (this.tierCounts[tier] || 0) + 1

        const startedAt = Date.now()
        // spent for the day: the free local model if its there, else nothing
        if (!this.budget.allows()) {
            this.tierCounts.budget = (this.tierCounts.budget || 0) + 1
            const local = await this._tryOllama(systemPrompt, userPrompt, 'budget spent')
            this._recordOutcome(!!local.text)
            return { ...local, ms: Date.now() - startedAt }
        }
        const result = tier === 'fast'
            ? await this._generateFast(systemPrompt, userPrompt, timeoutMs, jsonMode)
            : tier === 'decision'
                ? await this._generateDecision(systemPrompt, userPrompt, timeoutMs, jsonMode)
                : await this._generateQuality(systemPrompt, userPrompt, timeoutMs, jsonMode)

        if (result.source && result.source !== 'ollama' && (result.text || result.usage)) {
            this.budget.record(result.usage, String(systemPrompt || '').length + String(userPrompt || '').length)
        }
        this._recordOutcome(!!result.text)
        return { ...result, ms: Date.now() - startedAt }
    }

    // anthropic first, then the whole quality chain. with no anthropic key
    // this is just quality under another name
    async _generateDecision(systemPrompt, userPrompt, timeoutMs, jsonMode) {
        if (this.anthropicApiKey) {
            try {
                const { content, usage } = await this._anthropicGenerate(systemPrompt, userPrompt, timeoutMs)
                return { text: content, source: 'decision', model: this.decisionModel, usage }
            } catch (err) {
                this.logger.warn(`Anthropic decision failed: ${err.message} - demoting to quality chain`)
            }
        }
        return this._generateQuality(systemPrompt, userPrompt, timeoutMs, jsonMode)
    }

    async _anthropicGenerate(systemPrompt, userPrompt, timeoutMs) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), timeoutMs)

        // no response_format on this api. Think's parser copes with fences anyway
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
                throw new Error(`Anthropic API ${response.status}: ${response.statusText}${body ? `, ${body.slice(0, 300)}` : ''}`)
            }

            const data = await response.json()
            const usage = data.usage
                ? { in: data.usage.input_tokens ?? null, out: data.usage.output_tokens ?? null, reasoning: null }
                : null
            return { content: data.content?.[0]?.text || '', usage }
        } finally {
            clearTimeout(timeout)
        }
    }

    // cloud, one retry, then ollama.
    // the retry is for groq's 400 json_validate_failed: gpt-oss sometimes runs
    // out of budget mid reasoning and the json never closes. its random, asking
    // again works (1419 of 1420 in the logs). without it the tick fell to ollama,
    // which times out on the pi, and that was most of the accidental fallbacks
    async _generateFast(systemPrompt, userPrompt, timeoutMs, jsonMode) {
        if (this.cloudApiKey && this.cloudApiUrl && Date.now() >= this._cloudCooldownUntil) {
            try {
                const { content, usage } = await this._cloudGenerate(systemPrompt, userPrompt, timeoutMs, this.cloudModelFast, jsonMode)
                return { text: content, source: 'cloud-fast', model: this.cloudModelFast, usage }
            } catch (err) {
                this.logger.warn(`Cloud fast failed: ${err.message}`)
                this._noteCloudFailure(err)
                try {
                    const { content, usage } = await this._cloudGenerate(systemPrompt, userPrompt, timeoutMs, this.cloudModelFast, jsonMode)
                    this.logger.info('Fast tier recovered on retry')
                    return { text: content, source: 'cloud-fast', model: this.cloudModelFast, usage }
                } catch (err2) {
                    this.logger.warn(`Cloud fast retry also failed: ${err2.message}`)
                }
            }
        }
        return this._tryOllama(systemPrompt, userPrompt, 'fast tier')
    }

    // 120B, then 20B, then ollama. when the 120B chokes the 20B usually
    // answers fine, better than a doomed ollama call
    async _generateQuality(systemPrompt, userPrompt, timeoutMs, jsonMode) {
        if (this.cloudApiKey && this.cloudApiUrl && Date.now() >= this._cloudCooldownUntil) {
            try {
                const { content, usage } = await this._cloudGenerate(systemPrompt, userPrompt, timeoutMs, this.cloudModel, jsonMode)
                return { text: content, source: 'cloud', model: this.cloudModel, usage }
            } catch (err) {
                this.logger.warn(`Cloud LLM failed: ${err.message}`)
                this._noteCloudFailure(err)
                try {
                    const { content, usage } = await this._cloudGenerate(systemPrompt, userPrompt, timeoutMs, this.cloudModelFast, jsonMode)
                    this.logger.info(`Quality demoted to ${this.cloudModelFast} after 120B failure`)
                    return { text: content, source: 'cloud-fast', model: this.cloudModelFast, usage }
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

    async _tryOllama(systemPrompt, userPrompt, label) {
        if (!this._ollamaUsable()) {
            return { text: null, source: null, model: null, usage: null }
        }
        try {
            const { content, usage } = await this._ollamaGenerate(systemPrompt, userPrompt)
            this._ollamaTimeoutStreak = 0
            return { text: content, source: 'ollama', model: this.ollamaModel, usage }
        } catch (err) {
            this.logger.warn(`Ollama failed (${label}): ${err.message}`)
            if (/timeout/i.test(err.message)) {
                this._ollamaTimeoutStreak++
                if (this._ollamaTimeoutStreak >= this._ollamaBreakerThreshold) {
                    this._ollamaBreakerUntil = Date.now() + this._ollamaBreakerCooldownMs
                    this.logger.warn(`Ollama circuit breaker tripped (${this._ollamaTimeoutStreak} consecutive timeouts) - skipping local model for ${Math.round(this._ollamaBreakerCooldownMs / 60000)}min`)
                    this._ollamaTimeoutStreak = 0
                }
            }
            return { text: null, source: null, model: null, usage: null }
        }
    }

    // dont hit a grumpy model again next tick. 429 already set its own 60s
    _noteCloudFailure(err) {
        if (!/\b429\b/.test(err.message)) {
            this._cloudCooldownUntil = Math.max(this._cloudCooldownUntil, Date.now() + this._cloudSoftCooldownMs)
        }
    }

    async _ollamaGenerate(systemPrompt, userPrompt) {
        // not the caller's timeout, a slow local run would freeze him for 30s
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
        const usage = Number.isFinite(response.prompt_eval_count)
            ? { in: response.prompt_eval_count, out: response.eval_count ?? null, reasoning: null }
            : null
        return { content: response.message.content, usage }
    }

    async _cloudGenerate(systemPrompt, userPrompt, timeoutMs, model, jsonMode = true) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), timeoutMs)

        // groq 400s a json_object request if the messages never say "json", so
        // markdown prompts (consolidation) go without it. that was the silent
        // memory=false bug
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
                    ...(this.reasoningEffort ? { reasoning_effort: this.reasoningEffort } : {}),
                }),
                signal: controller.signal,
            })

            if (!response.ok) {
                if (response.status === 429) {
                    this._cloudCooldownUntil = Date.now() + 60000
                    this.logger.warn('Cloud API rate limited (429) - cooling down for 60s')
                }
                // keep the body, a bare "400: Bad Request" hid json_validate_failed for ages
                let body = ''
                try { body = await response.text() } catch { /* ignore */ }
                throw new Error(`Cloud API ${response.status}: ${response.statusText}${body ? `, ${body.slice(0, 300)}` : ''}`)
            }

            const data = await response.json()
            // gpt-oss bills hidden reasoning as completion tokens, so out includes it
            const usage = data.usage
                ? {
                    in: data.usage.prompt_tokens ?? null,
                    out: data.usage.completion_tokens ?? null,
                    reasoning: data.usage.completion_tokens_details?.reasoning_tokens ?? null,
                }
                : null
            return { content: data.choices?.[0]?.message?.content || '', usage }
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
            // still down
        }
    }

    isAvailable() {
        return this.ollamaAvailable || !!(this.cloudApiKey && this.cloudApiUrl)
    }
}
