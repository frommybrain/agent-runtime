import WebSocket from 'ws'

export class EnvironmentSocket {
    constructor(config, logger) {
        this.url = config.serverUrl
        this.agentId = config.agentId
        this.reconnectMs = config.reconnectIntervalMs
        this.logger = logger

        this.ws = null
        this.identified = false
        this.worldMeta = null
        this.connected = false

        this._pendingObserve = null
        this._pendingAction = null
        this._reconnectTimer = null
        this._worldEvents = []  // buffer for incoming WORLD_EVENT messages
        this._reconnectAttempts = 0  // for exponential backoff
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.logger.info(`Connecting to ${this.url}`)
            this.ws = new WebSocket(this.url)

            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'))
            }, 10000)

            this.ws.on('open', () => {
                clearTimeout(timeout)
                this.connected = true
                this._reconnectAttempts = 0  // reset backoff on successful connection
                this.logger.info('Connected')
            })

            this.ws.on('message', (raw) => {
                const msg = JSON.parse(raw.toString())
                this._handleMessage(msg, resolve)
            })

            this.ws.on('close', () => {
                this.connected = false
                this.identified = false
                this.logger.warn('Disconnected')
                this._scheduleReconnect()
            })

            this.ws.on('error', (err) => {
                this.logger.error(`Socket error: ${err.message}`)
                clearTimeout(timeout)
                if (!this.connected) reject(err)
            })
        })
    }

    _handleMessage(msg, identifyResolve) {
        switch (msg.type) {
            case 'WELCOME':
                // Send IDENTIFY
                this._send({ type: 'IDENTIFY', agentId: this.agentId })
                break

            case 'IDENTIFIED':
                this.identified = true
                this.worldMeta = {
                    worldBounds: msg.worldBounds,
                    terminalGridSize: msg.terminalGridSize,
                }
                this.logger.info(`Identified. World bounds: ±${msg.worldBounds?.halfSize}`)
                if (identifyResolve) identifyResolve()
                break

            case 'OBSERVATION':
                if (this._pendingObserve) {
                    this._pendingObserve.resolve(msg.data)
                    this._pendingObserve = null
                }
                break

            case 'ACTION_RESULT':
                if (this._pendingAction) {
                    this._pendingAction.resolve(msg)
                    this._pendingAction = null
                }
                break

            case 'WORLD_EVENT':
                this._worldEvents.push(msg)
                if (this._worldEvents.length > 20) this._worldEvents.shift()
                break

            case 'ERROR':
                this.logger.error(`Server error: ${msg.message}`)
                // Reject pending requests
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
            this._pendingObserve = { resolve, reject }
            this._send({ type: 'OBSERVE' })
            setTimeout(() => {
                if (this._pendingObserve) {
                    this._pendingObserve.reject(new Error('Observe timeout'))
                    this._pendingObserve = null
                }
            }, 5000)
        })
    }

    async act(action, params) {
        if (!this.isConnected()) throw new Error('Not connected')

        return new Promise((resolve, reject) => {
            this._pendingAction = { resolve, reject }
            this._send({ type: 'ACT', action, params })
            setTimeout(() => {
                if (this._pendingAction) {
                    this._pendingAction.reject(new Error('Action timeout'))
                    this._pendingAction = null
                }
            }, 5000)
        })
    }

    // Get and clear buffered world events (speech, agent_joined, etc.)
    drainWorldEvents() {
        const events = this._worldEvents.slice()
        this._worldEvents.length = 0
        return events
    }

    isConnected() {
        return this.connected && this.identified && this.ws?.readyState === WebSocket.OPEN
    }

    _send(data) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data))
        }
    }

    _scheduleReconnect() {
        if (this._reconnectTimer) return
        // Exponential backoff: 5s → 10s → 20s → 40s → 60s → ... cap at 5 min
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
