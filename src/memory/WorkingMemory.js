// RAM ring buffer. keeps last N events for quick LLM context.
// salience-weighted: high-energy moments get tagged so sleep
// consolidation can prioritise them.

export class WorkingMemory {
    constructor(config) {
        this.maxSize = config.workingMemorySize || 20
        this.events = []
    }

    // push an event, optionally with a salience score (0..1).
    // default 0.5 (neutral). high-energy moments get higher salience.
    push(event, salience = 0.5) {
        // merge action_result into the preceding action event to save slots
        if (event.type === 'action_result' && this.events.length > 0) {
            const prev = this.events[this.events.length - 1]
            if (prev.type === 'action') {
                prev.resultSuccess = event.success
                prev.resultMessage = event.message || ''
                prev.salience = Math.max(prev.salience, Math.max(0, Math.min(1, salience)))
                return
            }
        }

        this.events.push({
            time: new Date().toISOString(),
            salience: Math.max(0, Math.min(1, salience)),
            ...event,
        })
        if (this.events.length > this.maxSize) {
            this.events.shift()
        }
    }

    // get recent events formatted for prompt context
    recent(n) {
        const slice = n ? this.events.slice(-n) : this.events
        return slice.map(e => {
            const t = e.time.split('T')[1].split('.')[0]
            const star = e.salience > 0.7 ? ' *' : ''  // mark salient moments
            if (e.type === 'action') {
                const result = e.resultSuccess !== undefined
                    ? ` → ${e.resultSuccess ? 'ok' : 'FAILED'}${e.resultMessage ? ': ' + e.resultMessage : ''}`
                    : ''
                return `[${t}] I did: ${e.action} ${e.reason || ''}${result}${star}`
            }
            if (e.type === 'action_result') return `[${t}] Result: ${e.success ? 'succeeded' : 'failed'}${e.message ? ' — ' + e.message : ''}${star}`
            if (e.type === 'observation') return `[${t}] I saw: ${e.summary}${star}`
            if (e.type === 'speech_heard') return `[${t}] ${e.speaker} said: "${e.message}"${star}`
            if (e.type === 'speech_sent') return `[${t}] I said: "${e.message}"${star}`
            if (e.type === 'sleep') return `[${t}] === ${e.message} ===`
            return `[${t}] ${e.type}: ${JSON.stringify(e)}${star}`
        })
    }

    // last n non-empty action reasons, oldest first. feeds the worn-words
    // guard: what he's been saying to himself lately.
    recentReasons(n = 10) {
        const out = []
        for (let i = this.events.length - 1; i >= 0 && out.length < n; i--) {
            const e = this.events[i]
            if (e.type === 'action' && e.reason && String(e.reason).trim()) {
                out.push(String(e.reason))
            }
        }
        return out.reverse()
    }

    // get salient events (for sleep consolidation, prioritises important memories)
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
