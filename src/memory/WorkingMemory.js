// RAM ring buffer — keeps last N events for quick LLM context

export class WorkingMemory {
    constructor(config) {
        this.maxSize = config.workingMemorySize || 12
        this.events = []
    }

    push(event) {
        this.events.push({
            time: new Date().toISOString(),
            ...event,
        })
        if (this.events.length > this.maxSize) {
            this.events.shift()
        }
    }

    // Get recent events formatted for prompt context
    recent(n) {
        const slice = n ? this.events.slice(-n) : this.events
        return slice.map(e => {
            const t = e.time.split('T')[1].split('.')[0]
            if (e.type === 'action') return `[${t}] I did: ${e.action} ${e.reason || ''}`
            if (e.type === 'observation') return `[${t}] I saw: ${e.summary}`
            if (e.type === 'speech_heard') return `[${t}] ${e.speaker} said: "${e.message}"`
            if (e.type === 'speech_sent') return `[${t}] I said: "${e.message}"`
            if (e.type === 'sleep') return `[${t}] === ${e.message} ===`
            return `[${t}] ${e.type}: ${JSON.stringify(e)}`
        })
    }

    clear() {
        this.events = []
    }

    get length() {
        return this.events.length
    }
}
