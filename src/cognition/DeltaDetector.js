// diff this tick's observation against the last one. any shape of observation.
// the point is he notices "whats different" (someone put a terminal down,
// a chord got added, the light changed) not just "here is the world"

export class DeltaDetector {
    constructor(logger) {
        this.logger = logger
        this.previousObservation = null
    }

    detect(observation) {
        const deltas = []

        if (!this.previousObservation) {
            this.previousObservation = this._snapshot(observation)
            return deltas  // first tick, nothing to diff
        }

        const prev = this.previousObservation

        const prevAgents = this._idSet(prev.nearbyAgents || prev.nearby_agents)
        const currAgents = this._idSet(observation.nearbyAgents || observation.nearby_agents)
        this._diffSets(prevAgents, currAgents, 'agent', deltas)

        const prevObjects = this._idSet(prev.nearbyObjects || prev.nearby_objects)
        const currObjects = this._idSet(observation.nearbyObjects || observation.nearby_objects)
        this._diffSets(prevObjects, currObjects, 'object', deltas)

        // property changes. skip the ones that churn every tick just from him
        // moving, 'away' is the felt distance word so same thing
        const noiseProps = new Set([
            'id', 'name', 'pos', 'distance', 'away',
            'direction', 'heading', 'facing', 'angle',
        ])
        const prevObjMap = this._objectMap(prev.nearbyObjects || prev.nearby_objects)
        const currObjMap = this._objectMap(observation.nearbyObjects || observation.nearby_objects)
        for (const [id, currObj] of currObjMap) {
            const prevObj = prevObjMap.get(id)
            if (!prevObj) continue  // already an 'appeared'
            for (const [key, val] of Object.entries(currObj)) {
                if (noiseProps.has(key)) continue
                if (JSON.stringify(val) !== JSON.stringify(prevObj[key])) {
                    deltas.push({
                        type: 'changed', category: 'object_property',
                        id, property: key, from: prevObj[key], to: val,
                    })
                }
            }
        }

        // verb only. the world sends "move toward X (~30u away, ETA ~20s)" and the
        // numbers change every tick, so diffing the whole string meant a delta
        // every tick and the skip tier never happened
        const verb = (s) => String(s || '').trim().split(/[\s(]/)[0].toLowerCase()
        if (verb(observation.self?.action) !== verb(prev.self?.action)) {
            deltas.push({
                type: 'changed', category: 'self_action',
                from: prev.self?.action, to: observation.self?.action,
            })
        }

        const prevActions = this._actionSet(prev.available_actions)
        const currActions = this._actionSet(observation.available_actions)
        this._diffSets(prevActions, currActions, 'available_action', deltas)

        // signals, only if they moved more than 0.1
        if (observation.signals && prev.signals) {
            for (const [key, val] of Object.entries(observation.signals)) {
                const prevVal = prev.signals[key]
                if (prevVal !== undefined && typeof val === 'number' && typeof prevVal === 'number') {
                    if (Math.abs(val - prevVal) > 0.1) {
                        deltas.push({
                            type: 'changed', category: 'signal',
                            id: key, from: prevVal, to: val,
                        })
                    }
                }
            }
            for (const key of Object.keys(prev.signals)) {
                if (observation.signals[key] === undefined) {
                    deltas.push({ type: 'disappeared', category: 'signal', id: key })
                }
            }
            for (const key of Object.keys(observation.signals)) {
                if (prev.signals[key] === undefined) {
                    deltas.push({ type: 'appeared', category: 'signal', id: key })
                }
            }
        } else if (observation.signals && !prev.signals) {
            for (const key of Object.keys(observation.signals)) {
                deltas.push({ type: 'appeared', category: 'signal', id: key })
            }
        }

        // anything else top level
        const skip = new Set([
            'self', 'nearbyAgents', 'nearby_agents', 'nearbyObjects', 'nearby_objects',
            'available_actions', 'recentSpeech', 'signals', 'worldBounds',
            // these have seconds_ago etc in them so they change every tick,
            // which meant no tick was ever quiet enough to skip the LLM
            'recent_actions', 'recentActions', 'recent_tweets', 'pending_sacrifices',
        ])
        for (const key of Object.keys(observation)) {
            if (skip.has(key)) continue
            if (JSON.stringify(observation[key]) !== JSON.stringify(prev[key])) {
                deltas.push({
                    type: 'changed', category: 'environment',
                    id: key, from: prev[key], to: observation[key],
                })
            }
        }

        this.previousObservation = this._snapshot(observation)

        if (deltas.length > 0) {
            this.logger.debug(`Delta: ${deltas.length} change(s) detected`)
        }

        return deltas
    }

    // plain text for the prompt
    narrate(deltas) {
        if (!deltas || deltas.length === 0) return ''

        const lines = deltas.map(d => {
            if (d.type === 'appeared') {
                return `New ${d.category}: "${d.id}" appeared`
            }
            if (d.type === 'disappeared') {
                return `${d.category} "${d.id}" is no longer present`
            }
            if (d.type === 'changed' && d.category === 'object_property') {
                return `${d.id}'s ${d.property} changed from ${this._fmt(d.from)} to ${this._fmt(d.to)}`
            }
            if (d.type === 'changed' && d.category === 'signal') {
                const dir = d.to > d.from ? 'increased' : 'decreased'
                return `${d.id} ${dir} (${this._fmt(d.from)} → ${this._fmt(d.to)})`
            }
            if (d.type === 'changed' && d.category === 'self_action') {
                return `Your state changed from "${d.from || 'idle'}" to "${d.to || 'idle'}"`
            }
            if (d.type === 'changed') {
                return `${d.id} changed: ${this._fmt(d.from)} → ${this._fmt(d.to)}`
            }
            return `${d.type}: ${d.category} ${d.id}`
        })

        return 'CHANGES SINCE LAST TICK:\n' + lines.map(l => `- ${l}`).join('\n')
    }

    reset() {
        this.previousObservation = null
    }

    _snapshot(observation) {
        return JSON.parse(JSON.stringify(observation))
    }

    _idSet(arr) {
        return new Set((arr || []).map(item => item.id || item.name || JSON.stringify(item)))
    }

    _objectMap(arr) {
        const map = new Map()
        for (const obj of (arr || [])) {
            const id = obj.id || obj.name || obj.type
            if (id) map.set(id, obj)
        }
        return map
    }

    _actionSet(actions) {
        return new Set((actions || []).map(a => typeof a === 'string' ? a : a.name))
    }

    _diffSets(prevSet, currSet, category, deltas) {
        for (const id of currSet) {
            if (!prevSet.has(id)) deltas.push({ type: 'appeared', category, id })
        }
        for (const id of prevSet) {
            if (!currSet.has(id)) deltas.push({ type: 'disappeared', category, id })
        }
    }

    _fmt(val) {
        if (val === undefined || val === null) return 'none'
        if (typeof val === 'number') return val.toFixed(2)
        if (typeof val === 'string') return val
        return JSON.stringify(val)
    }
}
