import { appendFile, readdir, unlink, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

// one json line per decision so "why did he do that" has an answer. tier +
// the rule that picked it, model and cost, what was asked vs what got sent,
// which guards fired, and evidence hashes so repeat situations can be counted.
// buffered like DailyLog (sd card). one file per UTC day in data/decisions
export class DecisionLog {
    constructor(config, logger, { code = null } = {}) {
        this.dir = join(config.dataDir, 'decisions')
        this.maxAgeDays = config.decisionLogDays || 14
        this.flushIntervalMs = config.logFlushIntervalMs || 5 * 60 * 1000
        this.code = code  // git sha, doubles as prompt version
        this.logger = logger
        this._buffer = []
        this._bufferMaxSize = 200
        this._flushTimer = null
        this._lastGC = 0
    }

    async init() {
        await mkdir(this.dir, { recursive: true })
        this._flushTimer = setInterval(() => {
            this.flush().catch((err) => this.logger.error(`DecisionLog flush failed: ${err.message}`))
        }, this.flushIntervalMs)
        this._flushTimer.unref?.()
        await this.garbageCollect().catch((err) => this.logger.warn(`DecisionLog GC failed: ${err.message}`))
    }

    // pick the file now, so 23:59 lands in the right day even if the flush is after midnight
    record(entry) {
        const at = new Date()
        const line = JSON.stringify({ t: at.toISOString(), code: this.code, ...entry })
        this._buffer.push({ line, file: this._fileFor(at) })
        if (this._buffer.length >= this._bufferMaxSize) {
            this.flush().catch((err) => this.logger.error(`DecisionLog flush failed: ${err.message}`))
        }
    }

    async flush() {
        if (this._buffer.length === 0) return
        const entries = this._buffer.splice(0)
        const byFile = new Map()
        for (const { line, file } of entries) {
            if (!byFile.has(file)) byFile.set(file, [])
            byFile.get(file).push(line)
        }
        for (const [file, lines] of byFile) {
            try {
                await appendFile(file, lines.join('\n') + '\n', 'utf-8')
            } catch (err) {
                this.logger.error(`DecisionLog write failed: ${err.message}`)
                // retry next flush, but capped. a dead card shouldnt eat the ram too
                this._buffer.unshift(...lines.map((line) => ({ line, file })))
                if (this._buffer.length > this._bufferMaxSize * 5) {
                    this._buffer.splice(0, this._buffer.length - this._bufferMaxSize * 5)
                }
            }
        }
        if (Date.now() - this._lastGC > 24 * 60 * 60 * 1000) {
            await this.garbageCollect().catch((err) => this.logger.warn(`DecisionLog GC failed: ${err.message}`))
        }
    }

    async garbageCollect() {
        this._lastGC = Date.now()
        let files = []
        try {
            files = (await readdir(this.dir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
        } catch {
            return 0
        }
        const cutoff = new Date(Date.now() - this.maxAgeDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        let deleted = 0
        for (const file of files) {
            if (file.slice(0, 10) < cutoff) {
                await unlink(join(this.dir, file))
                deleted++
            }
        }
        if (deleted > 0) this.logger.info(`DecisionLog GC: deleted ${deleted} old file(s)`)
        return deleted
    }

    async stop() {
        if (this._flushTimer) {
            clearInterval(this._flushTimer)
            this._flushTimer = null
        }
        await this.flush()
    }

    _fileFor(date) {
        return join(this.dir, `${date.toISOString().slice(0, 10)}.jsonl`)
    }
}

export function shortHash(value) {
    return createHash('sha1').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 10)
}

function actionName(action) {
    return typeof action === 'string' ? action : action?.name
}

// use the worlds own urgency word if it sends one (3eyes does), else level in quarters
function needBand(need) {
    if (need && typeof need === 'object' && typeof need.urgency === 'string') return need.urgency
    const raw = typeof need === 'number' ? need : Number(need?.level || 0)
    const level = raw <= 1 ? raw * 100 : raw
    return Math.min(3, Math.floor(level / 25))
}

// two hashes of what a decision could see.
// scene = coarse facts (rough position, need bands, night, menu, places by
// felt distance, drives, events, last result). same scene = same question.
// detail = scene + place labels and the environment prose.
// no clock, exact distances or his own lines on purpose, the clock changes
// every tick and his lines arent evidence
export function evidenceKeys(observation, worldEvents = [], lastActionResult = null) {
    const o = observation || {}
    const self = o.self || {}
    const objects = o.nearby_objects || o.nearbyObjects || []
    const pos = self.pos && Number.isFinite(self.pos.x) && Number.isFinite(self.pos.z)
        ? [Math.round(self.pos.x / 5), Math.round(self.pos.z / 5)]
        : null
    const needs = Object.fromEntries(
        Object.entries(self.needs || {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, needBand(v)]),
    )
    const scene = {
        pos,
        needs,
        night: o.world_clock?.is_night ?? null,
        menu: (o.available_actions || []).map(actionName).filter(Boolean).sort(),
        pending: Number(o.pending_sacrifices || 0),
        places: objects.map((x) => `${x?.id || x?.name}:${x?.away || ''}`).sort(),
        drives: (o.drives || []).map((d) => `${d?.id || d?.kind || ''}:${d?.tool || ''}`).sort(),
        events: (worldEvents || []).map((e) => (e?.data || e)?.event || e?.type || 'event').sort(),
        last: lastActionResult ? `${lastActionResult.action}:${lastActionResult.success === false ? 'failed' : 'ok'}` : null,
    }
    const detail = {
        scene,
        labels: objects.map((x) => `${x?.id || ''}:${x?.name || ''}`).sort(),
        environment: typeof o.environment === 'string' ? o.environment : null,
    }
    return { scene: shortHash(scene), detail: shortHash(detail) }
}
