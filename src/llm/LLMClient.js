import { Ollama } from 'ollama'

// LLM client — Cloud primary (Groq), Ollama local fallback
// v0.3.7: 429 rate limit backoff, periodic Ollama re-check

export class LLMClient {
    constructor(config, logger) {
        this.logger = logger
        this.temperature = config.temperature
        this.maxTokens = config.maxTokens

        // Primary: local Ollama
        this.ollama = new Ollama({ host: config.ollamaHost })
        this.ollamaModel = config.ollamaModel

        // Fallback: cloud API (Groq, Together, etc.)
        this.cloudApiKey = config.cloudApiKey
        this.cloudApiUrl = config.cloudApiUrl
        this.cloudModel = config.cloudModel

        this.ollamaAvailable = false
        this._cloudCooldownUntil = 0         // skip cloud until this timestamp
        this._lastOllamaCheck = 0            // when we last checked Ollama
        this._ollamaRecheckMs = 5 * 60 * 1000  // re-check every 5 min
    }

    async init() {
        // Check if Ollama is running
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

    // Generate a response from the LLM
    // Returns: { text: string, source: 'ollama' | 'cloud' | null }
    // Cloud first (much faster on Pi), Ollama as fallback
    async generate(systemPrompt, userPrompt, timeoutMs = 30000) {
        // Periodically re-check Ollama if it was unavailable
        if (!this.ollamaAvailable && Date.now() - this._lastOllamaCheck > this._ollamaRecheckMs) {
            await this._recheckOllama()
        }

        // Try cloud first, but respect cooldown
        if (this.cloudApiKey && this.cloudApiUrl) {
            if (Date.now() >= this._cloudCooldownUntil) {
                try {
                    const result = await this._cloudGenerate(systemPrompt, userPrompt, timeoutMs)
                    return { text: result, source: 'cloud' }
                } catch (err) {
                    this.logger.warn(`Cloud LLM failed: ${err.message}`)
                    // Fall through to Ollama
                }
            } else {
                const remaining = Math.round((this._cloudCooldownUntil - Date.now()) / 1000)
                this.logger.debug(`Cloud API cooling down (${remaining}s remaining)`)
            }
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
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), timeoutMs)

        try {
            const response = await this.ollama.chat({
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
            return response.message.content
        } finally {
            clearTimeout(timeout)
        }
    }

    async _cloudGenerate(systemPrompt, userPrompt, timeoutMs) {
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
                    model: this.cloudModel,
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

    // Re-check Ollama availability (called periodically if it was down)
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
