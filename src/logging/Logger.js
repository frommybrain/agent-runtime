const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }

export class Logger {
    constructor(config) {
        this.level = LEVELS[config.logLevel] ?? LEVELS.info
        this.agentId = config.agentId
    }

    _log(level, msg) {
        if (LEVELS[level] < this.level) return
        const time = new Date().toLocaleTimeString('en-US', { hour12: false })
        const prefix = `[${time}] [${this.agentId}]`
        if (level === 'error') console.error(`${prefix} ERROR: ${msg}`)
        else if (level === 'warn') console.warn(`${prefix} WARN: ${msg}`)
        else console.log(`${prefix} ${msg}`)
    }

    debug(msg) { this._log('debug', msg) }
    info(msg) { this._log('info', msg) }
    warn(msg) { this._log('warn', msg) }
    error(msg) { this._log('error', msg) }
}
