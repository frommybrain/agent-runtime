import WebSocket from 'ws'

export class EnvironmentSocket {
    constructor(config, logger) {
        this.url = config.serverUrl
        this.agentId = config.agentId
        this.adminToken = config.adminToken || ''
        this.reconnectMs = config.reconnectIntervalMs
        this.logger = logger

        this.ws = null
        this.identified = false
        this.worldMeta = null
        this.connected = false

        this._pendingObserve = null
        this._pendingAction = null
        this._reconnectTimer = null
        this._worldEvents = []
        this._reconnectAttempts = 0
    }

    connect() {
        // drop the old socket first or listeners pile up on every reconnect
        if (this.ws) {
            this.ws.removeAllListeners()
            try { this.ws.close() } catch {}
            this.ws = null
        }

        return new Promise((resolve, reject) => {
            this.logger.info(`Connecting to ${this.url}`)
            this.ws = new WebSocket(this.url)
            this._identifyResolve = resolve

            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'))
            }, 10000)

            this.ws.on('open', () => {
                clearTimeout(timeout)
                this.connected = true
                this._reconnectAttempts = 0
                this.logger.info('Connected')
                // museum wifi leaves half open sockets: still "connected", every
                // observe times out, victor alive but brain dead. ping every 20s,
                // no pong since the last one = kill it and let reconnect happen
                this._pongAlive = true
                clearInterval(this._pingInterval)
                this._pingInterval = setInterval(() => {
                    if (!this._pongAlive) {
                        this.logger.warn('No pong since last ping - connection is half-open, terminating')
                        try { this.ws.terminate() } catch {}
                        return
                    }
                    this._pongAlive = false
                    try { this.ws.ping() } catch {}
                }, 20000)
            })

            this.ws.on('pong', () => { this._pongAlive = true })

            this.ws.on('message', (raw, isBinary) => {
                // one bad frame used to throw straight out of the emit and kill
                // the process, taking working memory with it
                if (isBinary) return
                let msg
                try {
                    msg = JSON.parse(raw.toString())
                } catch (err) {
                    this.logger.warn(`Ignoring unparseable frame: ${err.message}`)
                    return
                }
                try {
                    this._handleMessage(msg)
                } catch (err) {
                    this.logger.error(`Message handler threw: ${err.message}`)
                }
            })

            this.ws.on('close', () => {
                this.connected = false
                this.identified = false
                clearInterval(this._pingInterval)
                this.logger.warn('Disconnected')
                // fail them now rather than sit out the 5s timeout
                if (this._pendingObserve) {
                    clearTimeout(this._pendingObserve.timer)
                    this._pendingObserve.reject(new Error('Disconnected'))
                    this._pendingObserve = null
                }
                if (this._pendingAction) {
                    clearTimeout(this._pendingAction.timer)
                    this._pendingAction.reject(new Error('Disconnected'))
                    this._pendingAction = null
                }
                this._scheduleReconnect()
            })

            this.ws.on('error', (err) => {
                this.logger.error(`Socket error: ${err.message}`)
                clearTimeout(timeout)
                if (!this.connected) reject(err)
            })
        })
    }

    _handleMessage(msg) {
        switch (msg.type) {
            case 'WELCOME': {
                // envs without ADMIN_TOKEN ignore the token, prod sim checks it
                const identifyMsg = { type: 'IDENTIFY', agentId: this.agentId }
                if (this.adminToken) identifyMsg.token = this.adminToken
                else if (msg.requiresToken) {
                    this.logger.warn('Server requires a token but ADMIN_TOKEN env is unset - IDENTIFY will be rejected')
                }
                this._send(identifyMsg)
                break
            }

            case 'IDENTIFIED':
                this.identified = true
                this.worldMeta = {
                    worldBounds: msg.worldBounds,
                    terminalGridSize: msg.terminalGridSize,
                }
                this.logger.info(`Identified. World bounds: ±${msg.worldBounds?.halfSize}`)
                if (this._identifyResolve) {
                    this._identifyResolve()
                    this._identifyResolve = null
                }
                // the sim's persona is stuck at its last deploy, ours changes
                // twice a day. resend on every connect so a sim restart catches
                // up, index.js also repushes on a slow timer
                this.pushPersona()
                break

            case 'OBSERVATION':
                if (this._pendingObserve) {
                    clearTimeout(this._pendingObserve.timer)
                    this._pendingObserve.resolve(msg.data)
                    this._pendingObserve = null
                }
                break

            case 'ACTION_RESULT':
                if (this._pendingAction) {
                    clearTimeout(this._pendingAction.timer)
                    this._pendingAction.resolve(msg)
                    this._pendingAction = null
                }
                break

            case 'WORLD_EVENT':
                this._worldEvents.push(msg)
                if (this._worldEvents.length > 20) this._worldEvents.shift()
                this._onWorldEvent?.(msg)
                break

            // an env that owns the persona sends it after IDENTIFIED, and again
            // whenever it changes. null means it hasnt got one for us yet
            case 'PERSONA':
                this._onPersona?.(msg.persona || null)
                break

            case 'ERROR':
                this.logger.error(`Server error: ${msg.message}`)
                if (this._pendingObserve) {
                    this._pendingObserve.reject(new Error(msg.message))
                    this._pendingObserve = null
                }
                if (this._pendingAction) {
                    this._pendingAction.reject(new Error(msg.message))
                    this._pendingAction = null
                }
                break
        }
    }

    async observe() {
        if (!this.isConnected()) throw new Error('Not connected')

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this._pendingObserve) {
                    this._pendingObserve.reject(new Error('Observe timeout'))
                    this._pendingObserve = null
                }
            }, 5000)
            this._pendingObserve = { resolve, reject, timer }
            this._send({ type: 'OBSERVE' })
        })
    }

    async act(action, params) {
        if (!this.isConnected()) throw new Error('Not connected')

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this._pendingAction) {
                    this._pendingAction.reject(new Error('Action timeout'))
                    this._pendingAction = null
                }
            }, 5000)
            this._pendingAction = { resolve, reject, timer }
            this._send({ type: 'ACT', action, params })
        })
    }

    // speech, agent_joined etc since last drain
    drainWorldEvents() {
        const events = this._worldEvents.slice()
        this._worldEvents.length = 0
        return events
    }

    isConnected() {
        return this.connected && this.identified && this.ws?.readyState === WebSocket.OPEN
    }

    onWorldEvent(fn) { this._onWorldEvent = fn }
    onPersona(fn) { this._onPersona = fn }

    // index.js passes a fn that rereads the persona file, so the sim always
    // gets whatever SleepCycle wrote last
    setPersonaProvider(fn) {
        this._personaProvider = fn
    }

    async pushPersona() {
        if (!this._personaProvider || !this.identified) return
        try {
            const persona = await this._personaProvider()
            if (persona) this._send({ type: 'PERSONA_SYNC', persona })
        } catch (err) {
            this.logger.warn(`Persona push failed: ${err.message}`)
        }
    }

    _send(data) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data))
        }
    }

    _scheduleReconnect() {
        if (this._reconnectTimer) return
        // doubles each time, capped at 5 min
        const backoff = Math.min(
            this.reconnectMs * Math.pow(2, this._reconnectAttempts),
            5 * 60 * 1000
        )
        this._reconnectAttempts++
        this.logger.info(`Reconnecting in ${Math.round(backoff / 1000)}s (attempt ${this._reconnectAttempts})...`)
        this._reconnectTimer = setTimeout(async () => {
            this._reconnectTimer = null
            try {
                await this.connect()
            } catch {
                this._scheduleReconnect()
            }
        }, backoff)
    }

    close() {
        if (this._reconnectTimer) clearTimeout(this._reconnectTimer)
        if (this.ws) this.ws.close()
    }
}
