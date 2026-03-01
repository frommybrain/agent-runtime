import { createServer } from 'node:http'

// HTTP API + SSE event stream
// No dependencies — pure Node built-ins
//
// Endpoints:
//   GET  /status           — agent state snapshot
//   GET  /memory           — all three memory files
//   POST /memory/remember  — inject a memory entry
//   GET  /logs/today       — today's daily log
//   POST /sleep            — trigger sleep cycle now
//   POST /wake             — wake from sleep early
//   PUT  /persona          — hot-swap persona (JSON body)
//   GET  /events           — SSE stream of all runtime events

export class ApiServer {
    constructor(port, state, logger) {
        this.port = port
        this.state = state   // { persona, heartbeat, sleepCycle, memoryFiles, dailyLog, workingMemory, socket }
        this.logger = logger
        this._sseClients = new Set()
        this._server = null
    }

    start() {
        this._server = createServer((req, res) => this._route(req, res))
        this._server.listen(this.port, () => {
            this.logger.info(`API listening on http://localhost:${this.port}`)
        })
        this._server.on('error', err => {
            this.logger.error(`API server error: ${err.message}`)
        })
    }

    stop() {
        for (const client of this._sseClients) {
            try { client.end() } catch {}
        }
        this._sseClients.clear()
        this._server?.close()
    }

    // Broadcast an event to all SSE clients
    emit(eventName, data) {
        const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`
        for (const client of this._sseClients) {
            try { client.write(payload) } catch { this._sseClients.delete(client) }
        }
    }

    // ---- Router ----

    async _route(req, res) {
        // CORS for local dashboard access
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

        if (req.method === 'OPTIONS') {
            res.writeHead(204)
            return res.end()
        }

        const url = new URL(req.url, `http://localhost:${this.port}`)
        const path = url.pathname

        try {
            if (req.method === 'GET' && path === '/status') return await this._getStatus(req, res)
            if (req.method === 'GET' && path === '/memory') return await this._getMemory(req, res)
            if (req.method === 'POST' && path === '/memory/remember') return await this._postRemember(req, res)
            if (req.method === 'GET' && path === '/logs/today') return await this._getLogsToday(req, res)
            if (req.method === 'POST' && path === '/sleep') return await this._postSleep(req, res)
            if (req.method === 'POST' && path === '/wake') return await this._postWake(req, res)
            if (req.method === 'PUT' && path === '/persona') return await this._putPersona(req, res)
            if (req.method === 'GET' && path === '/events') return this._getEvents(req, res)

            this._json(res, 404, { error: 'Not found' })
        } catch (err) {
            this.logger.error(`API error: ${err.message}`)
            this._json(res, 500, { error: err.message })
        }
    }

    // ---- Handlers ----

    async _getStatus(req, res) {
        const { persona, heartbeat, sleepCycle, workingMemory, socket } = this.state
        this._json(res, 200, {
            agent: persona?.name || 'unknown',
            id: persona?.id || 'unknown',
            sleeping: sleepCycle?.isSleeping() || false,
            connected: socket?.isConnected() || false,
            tickCount: heartbeat?.tickCount || 0,
            uptime: heartbeat?.uptimeSeconds() || 0,
            recentActions: workingMemory?.events?.filter(e => e.type === 'action').slice(-5) || [],
        })
    }

    async _getMemory(req, res) {
        const { memoryFiles } = this.state
        const [memory, skills, tools] = await Promise.all([
            memoryFiles.readMemory(),
            memoryFiles.readSkills(),
            memoryFiles.readTools(),
        ])
        this._json(res, 200, { memory, skills, tools })
    }

    async _postRemember(req, res) {
        const body = await this._readBody(req)
        const { section, content } = body

        if (!section || !content) {
            return this._json(res, 400, { error: 'requires { section, content }' })
        }

        const valid = ['Relationships', 'Learned Facts', 'Important Memories']
        if (!valid.includes(section)) {
            return this._json(res, 400, { error: `section must be one of: ${valid.join(', ')}` })
        }

        await this.state.memoryFiles.appendToMemory(section, content)
        this.emit('memory', { section, content, injected: true })
        this._json(res, 200, { ok: true })
    }

    async _getLogsToday(req, res) {
        const log = await this.state.dailyLog.readToday()
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(log)
    }

    async _postSleep(req, res) {
        const { sleepCycle } = this.state
        if (sleepCycle.isSleeping()) {
            return this._json(res, 409, { error: 'Already sleeping' })
        }
        sleepCycle._startSleep()
        this.emit('sleep', { trigger: 'api', timestamp: Date.now() })
        this._json(res, 200, { ok: true, message: 'Sleep cycle started' })
    }

    async _postWake(req, res) {
        const { sleepCycle } = this.state
        if (!sleepCycle.isSleeping()) {
            return this._json(res, 409, { error: 'Not sleeping' })
        }
        sleepCycle._wake()
        this.emit('wake', { trigger: 'api', timestamp: Date.now() })
        this._json(res, 200, { ok: true, message: 'Agent woken' })
    }

    async _putPersona(req, res) {
        const body = await this._readBody(req)
        if (!body.name || !body.id) {
            return this._json(res, 400, { error: 'Persona requires at least { id, name }' })
        }
        this.state.persona = body
        // Rebuild prompt builder with new persona
        this.state.promptBuilder?.setPersona(body)
        this.emit('persona', { name: body.name, id: body.id })
        this.logger.info(`Persona hot-swapped to: ${body.name}`)
        this._json(res, 200, { ok: true, persona: body.name })
    }

    _getEvents(req, res) {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        })

        // Send current status on connect
        const { persona, sleepCycle } = this.state
        res.write(`event: connected\ndata: ${JSON.stringify({ agent: persona?.name, sleeping: sleepCycle?.isSleeping() })}\n\n`)

        this._sseClients.add(res)
        this.logger.info(`SSE client connected (total: ${this._sseClients.size})`)

        // Heartbeat ping every 15s to keep connection alive
        const ping = setInterval(() => {
            try { res.write(': ping\n\n') } catch { clearInterval(ping) }
        }, 15000)

        req.on('close', () => {
            clearInterval(ping)
            this._sseClients.delete(res)
            this.logger.info(`SSE client disconnected (total: ${this._sseClients.size})`)
        })
    }

    // ---- Helpers ----

    _json(res, status, body) {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(body, null, 2))
    }

    async _readBody(req) {
        return new Promise((resolve, reject) => {
            let data = ''
            req.on('data', chunk => { data += chunk })
            req.on('end', () => {
                try { resolve(JSON.parse(data || '{}')) }
                catch { reject(new Error('Invalid JSON body')) }
            })
            req.on('error', reject)
        })
    }
}
