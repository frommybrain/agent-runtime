import { appendFile, readdir, unlink, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

// One line per decision, so "why did he do that" can be answered from a
// file instead of guessed at.
//
// 25 Sep: 836 of 1,384 decisions ran on the 120B, although the classifier
// keeps the quality tier narrow on purpose, and victor.log had no way to say
// why. 19 more were turned into wait because the model named an action that
// was not on offer, and nothing recorded what it had asked for. Each line
// here carries the tier and the rule that chose it, the model that answered
// and what it cost, what the model asked for next to what was sent, every
// guard that stepped in, and two keys for the evidence the decision saw, so
// a situation that comes round again unchanged can be counted.
//
// Buffered and flushed like DailyLog, for the same SD card. One file per
// UTC day under data/decisions, kept decisionLogDays days.
export class DecisionLog {
    constructor(config, logger, { code = null } = {}) {
        this.dir = join(config.dataDir, 'decisions')
        this.maxAgeDays = config.decisionLogDays || 14
        this.flushIntervalMs = config.logFlushIntervalMs || 5 * 60 * 1000
        // Which build wrote the line: the prompts live in the code, so this
        // is the prompt version too.
        this.code = code
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

    // No disk I/O here; the file is chosen now so a line written at 23:59
    // lands in that day even if it is flushed after midnight.
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
                // Kept for the next flush, but not without limit: a card
                // that has stopped taking writes must not also eat the RAM.
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

// The world's own word for how much a need is pressing when it sends one
// (the 3eyes bridge does), otherwise the level in quarters.
function needBand(need) {
    if (need && typeof need === 'object' && typeof need.urgency === 'string') return need.urgency
    const raw = typeof need === 'number' ? need : Number(need?.level || 0)
    const level = raw <= 1 ? raw * 100 : raw
    return Math.min(3, Math.floor(level / 25))
}

/**
 * Two keys for what a decision could see.
 *
 * `scene` is the situation in coarse facts: roughly where he is, how
 * pressing each need is, day or night, the menu, what is waiting, what each
 * place is to him (its felt distance, not its exact one), the drives on
 * offer, any world events, and how the last action went. Two decisions with
 * the same scene were asked the same question on the same evidence.
 *
 * `detail` adds the prose: every place's label and the environment line.
 * A label carries opening hours and "you were there not long ago", so a
 * scene that repeats with a new detail did learn something.
 *
 * Deliberately left out: the clock, exact distances and his own recent
 * lines. The first changes every tick and the last is his conclusions, not
 * evidence about the world.
 */
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
