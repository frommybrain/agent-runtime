import { appendFile, readFile, readdir, unlink, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// Daily log with in-memory buffer and periodic disk flush.
//
// Instead of writing to disk on every tick (21,600 writes/day),
// entries accumulate in a RAM buffer and flush every flushIntervalMs.
// This drops disk I/O by ~99% and prevents SD card wear on the Pi.
//
// readRecentLines() reads from the buffer first (fast, no I/O).
// The full day's log on disk is an audit trail for thesis records.

export class DailyLog {
    constructor(config, logger) {
        this.logsDir = join(config.dataDir, 'logs')
        this.maxAgeDays = config.maxDailyLogAgeDays || 7
        this.flushIntervalMs = config.logFlushIntervalMs || 5 * 60 * 1000  // 5 min default
        this.logger = logger

        // In-memory buffer — entries accumulate here between flushes
        this._buffer = []
        this._bufferMaxSize = 500  // safety cap
        this._flushTimer = null
        this._lastGC = Date.now()
    }

    async init() {
        await mkdir(this.logsDir, { recursive: true })
        this._startFlushTimer()
    }

    // Append a line — writes to buffer only, no disk I/O
    async append(entry) {
        const time = new Date().toLocaleTimeString('en-US', { hour12: false })
        const line = `[${time}] ${entry}`

        this._buffer.push(line)

        // Safety: if buffer exceeds max, force flush
        if (this._buffer.length >= this._bufferMaxSize) {
            await this.flush()
        }
    }

    // Flush buffer to disk — batched appendFile (no read-then-rewrite)
    async flush() {
        if (this._buffer.length === 0) return

        const lines = this._buffer.splice(0)  // drain buffer
        const content = lines.join('\n') + '\n'

        try {
            await appendFile(this._todayFile(), content, 'utf-8')
        } catch (err) {
            this.logger.error(`DailyLog flush failed: ${err.message}`)
            // Re-add lines to buffer so they're not lost
            this._buffer.unshift(...lines)
        }
    }

    // Read today's log (buffer + disk combined)
    async readToday() {
        let disk = ''
        try {
            disk = await readFile(this._todayFile(), 'utf-8')
        } catch {
            // File doesn't exist yet
        }
        // Append unflushed buffer entries
        if (this._buffer.length > 0) {
            disk += (disk && !disk.endsWith('\n') ? '\n' : '') + this._buffer.join('\n') + '\n'
        }
        return disk
    }

    // Read last N lines — pulls from buffer first (fast), then disk if needed
    async readRecentLines(n = 5) {
        // Buffer has enough recent lines
        if (this._buffer.length >= n) {
            return this._buffer.slice(-n)
        }

        // Need some from disk too
        const content = await this.readToday()
        if (!content) return this._buffer.slice(-n)
        const lines = content.trim().split('\n').filter(Boolean)
        return lines.slice(-n)
    }

    // Read last N lines for consolidation (capped to prevent context overflow)
    async readForConsolidation(maxLines = 200) {
        const content = await this.readToday()
        if (!content) return ''
        const lines = content.trim().split('\n').filter(Boolean)
        if (lines.length <= maxLines) return content
        // Return only the last maxLines with a note
        const truncated = lines.slice(-maxLines)
        return `[... ${lines.length - maxLines} earlier entries omitted ...]\n` + truncated.join('\n')
    }

    // Read a specific day's log (for sleep consolidation)
    async readDay(dateStr) {
        try {
            return await readFile(join(this.logsDir, `${dateStr}.md`), 'utf-8')
        } catch {
            return ''
        }
    }

    // List all log files
    async listLogFiles() {
        try {
            const files = await readdir(this.logsDir)
            return files.filter(f => f.endsWith('.md')).sort()
        } catch {
            return []
        }
    }

    // Delete logs older than maxAgeDays
    async garbageCollect() {
        const files = await this.listLogFiles()
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - this.maxAgeDays)
        const cutoffStr = cutoff.toISOString().split('T')[0]

        let deleted = 0
        for (const file of files) {
            const dateStr = file.replace('.md', '')
            if (dateStr < cutoffStr) {
                await unlink(join(this.logsDir, file))
                deleted++
            }
        }

        if (deleted > 0) {
            this.logger.info(`GC: deleted ${deleted} old log file(s)`)
        }
        this._lastGC = Date.now()
        return deleted
    }

    // Check if GC is overdue (called by heartbeat as fallback)
    isGCOverdue(maxHours = 24) {
        return (Date.now() - this._lastGC) > maxHours * 60 * 60 * 1000
    }

    _todayFile() {
        const date = new Date().toISOString().split('T')[0]
        return join(this.logsDir, `${date}.md`)
    }

    _startFlushTimer() {
        this._flushTimer = setInterval(() => {
            this.flush().catch(err => {
                this.logger.error(`DailyLog auto-flush failed: ${err.message}`)
            })
        }, this.flushIntervalMs)
        // Don't prevent process exit
        if (this._flushTimer.unref) this._flushTimer.unref()
    }

    // Flush and stop timer — called during shutdown
    async stop() {
        if (this._flushTimer) {
            clearInterval(this._flushTimer)
            this._flushTimer = null
        }
        await this.flush()
    }
}
