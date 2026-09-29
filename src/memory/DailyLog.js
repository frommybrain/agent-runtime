import { appendFile, readFile, readdir, unlink, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// daily log, buffered in RAM and flushed every flushIntervalMs.
// writing every tick was 21,600 writes a day and cooking the Pi's SD card.
// each entry is tagged with its file when appended (v0.3.7), otherwise a
// flush just after midnight put yesterdays lines in the wrong day

export class DailyLog {
    constructor(config, logger) {
        this.logsDir = join(config.dataDir, 'logs')
        this.maxAgeDays = config.maxDailyLogAgeDays || 7
        this.flushIntervalMs = config.logFlushIntervalMs || 5 * 60 * 1000  // 5 min default
        this.logger = logger

        this._buffer = []  // { line, file }
        this._bufferMaxSize = 500  // safety cap
        this._flushTimer = null
        this._lastGC = Date.now()
    }

    async init() {
        await mkdir(this.logsDir, { recursive: true })
        this._startFlushTimer()
    }

    // buffer only, no disk. file is picked now, not at flush time
    async append(entry) {
        const time = new Date().toLocaleTimeString('en-US', { hour12: false })
        const line = `[${time}] ${entry}`
        const file = this._todayFile()

        this._buffer.push({ line, file })

        if (this._buffer.length >= this._bufferMaxSize) {
            await this.flush()
        }
    }

    // grouped by file, a flush can straddle midnight
    async flush() {
        if (this._buffer.length === 0) return

        const entries = this._buffer.splice(0)

        const byFile = new Map()
        for (const { line, file } of entries) {
            if (!byFile.has(file)) byFile.set(file, [])
            byFile.get(file).push(line)
        }

        for (const [file, lines] of byFile) {
            const content = lines.join('\n') + '\n'
            try {
                await appendFile(file, content, 'utf-8')
            } catch (err) {
                this.logger.error(`DailyLog flush failed: ${err.message}`)
                // put them back so theyre not lost, next flush tries again
                for (const line of lines) {
                    this._buffer.unshift({ line, file })
                }
            }
        }
    }

    // disk + whatever's still in the buffer
    async readToday() {
        let disk = ''
        try {
            disk = await readFile(this._todayFile(), 'utf-8')
        } catch {
            // no file yet
        }
        // unflushed lines, today's only
        const todayFile = this._todayFile()
        const bufferLines = this._buffer
            .filter(e => e.file === todayFile)
            .map(e => e.line)
        if (bufferLines.length > 0) {
            disk += (disk && !disk.endsWith('\n') ? '\n' : '') + bufferLines.join('\n') + '\n'
        }
        return disk
    }

    // buffer first, only hits disk if the buffer is short
    async readRecentLines(n = 5) {
        const bufferLines = this._buffer.map(e => e.line)
        if (bufferLines.length >= n) {
            return bufferLines.slice(-n)
        }

        const content = await this.readToday()
        if (!content) return bufferLines.slice(-n)
        const lines = content.trim().split('\n').filter(Boolean)
        return lines.slice(-n)
    }

    // capped, a whole day blows the context
    async readForConsolidation(maxLines = 200) {
        const content = await this.readToday()
        if (!content) return ''
        const lines = content.trim().split('\n').filter(Boolean)
        if (lines.length <= maxLines) return content
        const truncated = lines.slice(-maxLines)
        return `[... ${lines.length - maxLines} earlier entries omitted ...]\n` + truncated.join('\n')
    }

    async readDay(dateStr) {
        try {
            return await readFile(join(this.logsDir, `${dateStr}.md`), 'utf-8')
        } catch {
            return ''
        }
    }

    async listLogFiles() {
        try {
            const files = await readdir(this.logsDir)
            return files.filter(f => f.endsWith('.md')).sort()
        } catch {
            return []
        }
    }

    // delete logs older than maxAgeDays
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

    // heartbeat checks this in case sleep hasn't run gc for a while
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
        // dont prevent process exit
        if (this._flushTimer.unref) this._flushTimer.unref()
    }

    // shutdown
    async stop() {
        if (this._flushTimer) {
            clearInterval(this._flushTimer)
            this._flushTimer = null
        }
        await this.flush()
    }
}
