import { readFile, writeFile, readdir, unlink, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// Append-only daily log files (YYYY-MM-DD.md)
// Used for: LLM context (today's log), sleep consolidation review, garbage collection

export class DailyLog {
    constructor(config, logger) {
        this.logsDir = join(config.dataDir, 'logs')
        this.maxAgeDays = config.maxDailyLogAgeDays || 7
        this.logger = logger
    }

    async init() {
        await mkdir(this.logsDir, { recursive: true })
    }

    // Append a line to today's log
    async append(entry) {
        const file = this._todayFile()
        const time = new Date().toLocaleTimeString('en-US', { hour12: false })
        const line = `[${time}] ${entry}\n`

        try {
            const existing = await readFile(file, 'utf-8').catch(() => '')
            await writeFile(file, existing + line, 'utf-8')
        } catch (err) {
            this.logger.error(`DailyLog write failed: ${err.message}`)
        }
    }

    // Read today's log (for LLM context)
    async readToday() {
        try {
            return await readFile(this._todayFile(), 'utf-8')
        } catch {
            return ''
        }
    }

    // Read last N lines from today's log
    async readRecentLines(n = 5) {
        const content = await this.readToday()
        if (!content) return []
        const lines = content.trim().split('\n').filter(Boolean)
        return lines.slice(-n)
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
        return deleted
    }

    _todayFile() {
        const date = new Date().toISOString().split('T')[0]
        return join(this.logsDir, `${date}.md`)
    }
}
