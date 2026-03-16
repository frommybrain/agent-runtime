import { Ollama } from 'ollama'

// LLM client — Tiered model routing for cost optimization
//
// Three tiers:
//   'quality' — 70B cloud first, Ollama fallback (complex decisions)
//   'fast'    — Ollama first (free), 8B cloud fallback (routine ticks)
//   'skip'    — no LLM call (caller should use FallbackBrain)
//
// v0.3.8: Tiered routing. v0.3.7: 429 backoff, periodic Ollama re-check

export class LLMClient {
    constructor(config, logger) {
        this.logger = logger
        this.temperature = config.temperature
        this.maxTokens = config.maxTokens

        // Local Ollama
        this.ollama = new Ollama({ host: config.ollamaHost })
        this.ollamaModel = config.ollamaModel

        // Cloud API (Groq, Together, etc.)
        this.cloudApiKey = config.cloudApiKey
        this.cloudApiUrl = config.cloudApiUrl
        this.cloudModel = config.cloudModel              // 70B quality
        this.cloudModelFast = config.cloudModelFast      // 8B fast

        this.ollamaAvailable = false
        this._cloudCooldownUntil = 0
        this._lastOllamaCheck = 0
        this._ollamaRecheckMs = 5 * 60 * 1000

        // Observability counters
        this.tierCounts = { skip: 0, fast: 0, quality: 0 }
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

    // Generate a response with tier-aware routing
    // tier: 'quality' (default) | 'fast'
    // Returns: { text: string, source: 'cloud'|'cloud-fast'|'ollama'|null }
    async generate(systemPrompt, userPrompt, timeoutMs = 30000, tier = 'quality') {
        // Periodically re-check Ollama if it was unavailable
        if (!this.ollamaAvailable && Date.now() - this._lastOllamaCheck > this._ollamaRecheckMs) {
            await this._recheckOllama()
        }

        // Track tier usage
        this.tierCounts[tier] = (this.tierCounts[tier] || 0) + 1

        if (tier === 'fast') {
            return this._generateFast(systemPrompt, userPrompt, timeoutMs)
        }

        return this._generateQuality(systemPrompt, userPrompt, timeoutMs)
    }

    // Fast tier: 8B cloud first (fast + cheap), Ollama fallback (free but slow)
    // v0.3.8.1: Swapped priority — Ollama on Pi causes tick skipping due to
    // generation time exceeding heartbeat interval. 8B cloud is fast enough
    // to avoid missed ticks and cheap enough for routine use.
    async _generateFast(systemPrompt, userPrompt, timeoutMs) {
        // Try cheap cloud model first (fast, avoids tick skipping)
        if (this.cloudApiKey && this.cloudApiUrl && Date.now() >= this._cloudCooldownUntil) {
            try {
                const result = await this._cloudGenerate(systemPrompt, userPrompt, timeoutMs, this.cloudModelFast)
                return { text: result, source: 'cloud-fast' }
            } catch (err) {
                this.logger.warn(`Cloud fast failed: ${err.message}`)
            }
        }

        // Fall back to free local model (slow but free — only when cloud is down)
        if (this.ollamaAvailable) {
            try {
                const result = await this._ollamaGenerate(systemPrompt, userPrompt, timeoutMs)
                return { text: result, source: 'ollama' }
            } catch (err) {
                this.logger.warn(`Ollama failed (fast tier): ${err.message}`)
            }
        }

        return { text: null, source: null }
    }

    // Quality tier: 70B cloud first, Ollama fallback
    async _generateQuality(systemPrompt, userPrompt, timeoutMs) {
        // Try 70B cloud first (faster on Pi than local)
        if (this.cloudApiKey && this.cloudApiUrl && Date.now() >= this._cloudCooldownUntil) {
            try {
                const result = await this._cloudGenerate(systemPrompt, userPrompt, timeoutMs, this.cloudModel)
                return { text: result, source: 'cloud' }
            } catch (err) {
                this.logger.warn(`Cloud LLM failed: ${err.message}`)
            }
        } else if (this.cloudApiKey && Date.now() < this._cloudCooldownUntil) {
            const remaining = Math.round((this._cloudCooldownUntil - Date.now()) / 1000)
            this.logger.debug(`Cloud API cooling down (${remaining}s remaining)`)
        }

        // Fall back to local Ollama
        if (this.ollamaAvailable) {
            try {
                const result = await this._ollamaGenerate(systemPrompt, userPrompt, timeoutMs)
                return { text: result, source: 'ollama' }
            } catch (err) {
                this.logger.warn(`Ollama failed: ${err.message}`)
            }
        }

        return { text: null, source: null }
    }

    async _ollamaGenerate(systemPrompt, userPrompt, timeoutMs) {
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

    async _cloudGenerate(systemPrompt, userPrompt, timeoutMs, model) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), timeoutMs)

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
                }),
                signal: controller.signal,
            })

            if (!response.ok) {
                if (response.status === 429) {
                    this._cloudCooldownUntil = Date.now() + 60000
                    this.logger.warn('Cloud API rate limited (429) — cooling down for 60s')
                }
                throw new Error(`Cloud API ${response.status}: ${response.statusText}`)
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
            // Still unavailable
        }
    }

    isAvailable() {
        return this.ollamaAvailable || !!(this.cloudApiKey && this.cloudApiUrl)
    }
}
