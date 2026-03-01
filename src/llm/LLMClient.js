import { Ollama } from 'ollama'

// LLM client — Ollama primary, optional cloud API fallback
// Designed for Pi 5 running llama3.2:3b locally

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
    }

    async init() {
        // Check if Ollama is running
        try {
            await this.ollama.list()
            this.ollamaAvailable = true
            this.logger.info(`Ollama connected (model: ${this.ollamaModel})`)
        } catch {
            this.ollamaAvailable = false
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
        // Try cloud first (Groq etc. — sub-second responses)
        if (this.cloudApiKey && this.cloudApiUrl) {
            try {
                const result = await this._cloudGenerate(systemPrompt, userPrompt, timeoutMs)
                return { text: result, source: 'cloud' }
            } catch (err) {
                this.logger.warn(`Cloud LLM failed: ${err.message}`)
                // Fall through to Ollama
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
                throw new Error(`Cloud API ${response.status}: ${response.statusText}`)
            }

            const data = await response.json()
            return data.choices?.[0]?.message?.content || ''
        } finally {
            clearTimeout(timeout)
        }
    }

    isAvailable() {
        return this.ollamaAvailable || !!(this.cloudApiKey && this.cloudApiUrl)
    }
}
