// RAM ring buffer — keeps last N events for quick LLM context.
// Supports salience-weighted encoding: high-arousal moments are tagged
// so sleep consolidation can prioritise them.

export class WorkingMemory {
    constructor(config) {
        this.maxSize = config.workingMemorySize || 12
        this.events = []
    }

    // Push an event, optionally with a salience score (0..1)
    // salience defaults to 0.5 (neutral). High arousal moments get higher salience.
    push(event, salience = 0.5) {
        this.events.push({
            time: new Date().toISOString(),
            salience: Math.max(0, Math.min(1, salience)),
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
            const star = e.salience > 0.7 ? ' *' : ''  // mark salient moments
            if (e.type === 'action') return `[${t}] I did: ${e.action} ${e.reason || ''}${star}`
            if (e.type === 'action_result') return `[${t}] Result: ${e.success ? 'succeeded' : 'failed'}${e.message ? ' — ' + e.message : ''}${star}`
            if (e.type === 'observation') return `[${t}] I saw: ${e.summary}${star}`
            if (e.type === 'speech_heard') return `[${t}] ${e.speaker} said: "${e.message}"${star}`
            if (e.type === 'speech_sent') return `[${t}] I said: "${e.message}"${star}`
            if (e.type === 'sleep') return `[${t}] === ${e.message} ===`
            return `[${t}] ${e.type}: ${JSON.stringify(e)}${star}`
        })
    }

    // Get salient events (for sleep consolidation — prioritise important memories)
    salientEvents(threshold = 0.6) {
        return this.events.filter(e => (e.salience || 0.5) >= threshold)
    }

    clear() {
        this.events = []
    }

    get length() {
        return this.events.length
    }
}
