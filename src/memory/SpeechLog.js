// Persistent speech history — survives sleep cycles.
//
// The working memory and repetition guard both get cleared during sleep,
// so the agent forgets what it said. This buffer persists across sleep
// boundaries, giving the LLM context to avoid repeating phrases.
//
// Persisted to disk for crash recovery. Trimmed (not cleared) during sleep.

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export class SpeechLog {
    constructor(config, logger) {
        this.maxSize = config.speechLogSize || 50
        this.promptSize = config.speechLogPromptSize || 15
        this.logger = logger
        this._filePath = join(config.dataDir, 'speech-log.json')
        this._speeches = []  // { message, tick, time }
        this._dirty = false
    }

    // Load from disk (crash recovery)
    async init() {
        try {
            const raw = await readFile(this._filePath, 'utf-8')
            const data = JSON.parse(raw)
            if (Array.isArray(data)) {
                this._speeches = data.slice(-this.maxSize)
            }
            this.logger.info(`SpeechLog loaded: ${this._speeches.length} entries`)
        } catch {
            // No file yet — fresh start
        }
    }

    // Record a speech after it's sent
    record(message, tick) {
        this._speeches.push({
            message: message.trim(),
            tick,
            time: new Date().toISOString(),
        })
        if (this._speeches.length > this.maxSize) {
            this._speeches.shift()
        }
        this._dirty = true
    }

    // Get recent speeches formatted for prompt injection
    recentForPrompt() {
        if (this._speeches.length === 0) return null
        const recent = this._speeches.slice(-this.promptSize)
        return recent.map(s => `- "${s.message}"`).join('\n')
    }

    // Persist to disk (called during state checkpoint)
    async save() {
        if (!this._dirty) return
        try {
            await writeFile(this._filePath, JSON.stringify(this._speeches), 'utf-8')
            this._dirty = false
        } catch (err) {
            this.logger.warn(`SpeechLog save failed: ${err.message}`)
        }
    }

    // Trim during sleep — keep last N, don't clear entirely
    trim(keepCount) {
        const keep = keepCount || Math.floor(this.maxSize / 2)
        if (this._speeches.length > keep) {
            this._speeches = this._speeches.slice(-keep)
            this._dirty = true
        }
    }

    get length() {
        return this._speeches.length
    }
}
