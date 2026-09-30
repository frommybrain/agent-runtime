import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

// what the paid model calls cost today, and a ceiling if you want one.
// DAILY_CALL_BUDGET and DAILY_TOKEN_BUDGET, 0 or unset = no ceiling.
// counted per UTC day and kept on disk so a restart doesnt hand out a fresh
// day. local ollama calls are free and dont count. once its spent the agent
// only gets ollama (if its up) or FallbackBrain, which never speaks, so a
// spent agent goes quiet rather than strange

export class Budget {
    constructor(config = {}, logger = null) {
        this.maxCalls = Math.max(0, Number(config.dailyCallBudget) || 0)
        this.maxTokens = Math.max(0, Number(config.dailyTokenBudget) || 0)
        this.file = config.dataDir ? join(config.dataDir, 'usage.json') : null
        this.logger = logger
        this.today = this._load()
        this._dirty = false
        this._saidSpent = null
        this._timer = null
    }

    _day(now = Date.now()) {
        return new Date(now).toISOString().slice(0, 10)
    }

    _blank(now = Date.now()) {
        return { day: this._day(now), calls: 0, in: 0, out: 0, refused: 0 }
    }

    _load() {
        if (!this.file) return this._blank()
        try {
            const u = JSON.parse(readFileSync(this.file, 'utf-8'))
            if (u?.day === this._day()) return { ...this._blank(), ...u }
        } catch { /* first run */ }
        return this._blank()
    }

    _roll(now) {
        if (this.today.day !== this._day(now)) {
            this.today = this._blank(now)
            this._dirty = true
        }
    }

    spent(now = Date.now()) {
        this._roll(now)
        const t = this.today
        return (this.maxCalls > 0 && t.calls >= this.maxCalls) || (this.maxTokens > 0 && t.in + t.out >= this.maxTokens)
    }

    // true if a paid call may go out now
    allows(now = Date.now()) {
        if (!this.spent(now)) return true
        const t = this.today
        t.refused++
        this._dirty = true
        this._schedule()
        if (this._saidSpent !== t.day) {
            this._saidSpent = t.day
            this.logger?.warn(`Budget spent for ${t.day} (${t.calls} calls, ${t.in + t.out} tokens), no paid calls until tomorrow UTC`)
        }
        return false
    }

    // usage is null from some providers, guess from the prompt then (4 chars a token)
    record(usage, promptChars = 0, now = Date.now()) {
        this._roll(now)
        const t = this.today
        t.calls++
        t.in += Number(usage?.in) || Math.ceil(promptChars / 4)
        t.out += Number(usage?.out) || 0
        this._dirty = true
        this._schedule()
    }

    snapshot(now = Date.now()) {
        this._roll(now)
        return { ...this.today, maxCalls: this.maxCalls || null, maxTokens: this.maxTokens || null, spent: this.spent(now) }
    }

    // a write a minute at most, the sd card again (see DailyLog)
    _schedule() {
        if (this._timer || !this.file) return
        this._timer = setTimeout(() => {
            this._timer = null
            this.flush()
        }, 60_000)
        this._timer.unref?.()
    }

    flush() {
        if (!this._dirty || !this.file) return
        try {
            mkdirSync(dirname(this.file), { recursive: true })
            writeFileSync(this.file, JSON.stringify(this.today))
            this._dirty = false
        } catch (err) {
            this.logger?.warn(`usage.json not written: ${err.message}`)
        }
    }
}
