// scrub a decision reason before it's logged/broadcast.
// the prompt tells the model not to quote stats or need-names, but the
// weaker/faster tiers slip ("Hunger at 100%, need something fresh"). this is
// the last gate: a number or a raw entity id must never reach the feed,
// whatever produced it. pure + exported so it can be tested on its own.

// "hunger at 100%", "curiosity's at 100", "rest is 42%", "safety level 80"
const STAT_CLAUSE = /\b(hunger|rest|curiosity|social|safety|energy|mood|arousal|valence)('s|s)?\s*(is|at|level|sits at|sitting at)?\s*(at\s*)?\d{1,3}\s*%?/gi
// a bare "80%" / "at 100 %" with no need-name in front
const BARE_PCT = /\b(at\s*)?\d{1,3}\s*%/gi
// entity ids that should have been spoken as names (food_apple_tree)
const ENTITY_ID = /\b(?:food|activity|nest|artifact|npc|poi|rest)_[a-z0-9_]+/gi

// a plain in-voice line for when scrubbing leaves nothing usable — better a
// quiet honest beat than a number. varied by the need in play if we can spot
// one, else generic.
const FALLBACKS = {
    hunger: 'I could eat',
    rest: 'I need to sit a while',
    curiosity: 'something out there is pulling at me',
    social: 'I could do with a bit of company',
    safety: 'I want somewhere that feels safe',
}

export function sanitizeReason(reason, { need } = {}) {
    if (typeof reason !== 'string') return reason
    let out = reason

    // which need was named before we strip it, for a graceful fallback
    let spotted = need
    if (!spotted) {
        const m = reason.match(/\b(hunger|rest|curiosity|social|safety)\b/i)
        if (m) spotted = m[1].toLowerCase()
    }

    out = out.replace(STAT_CLAUSE, ' ')
    out = out.replace(BARE_PCT, ' ')
    out = out.replace(ENTITY_ID, (id) => id.split('_').slice(1).join(' '))

    // tidy: collapse spaces, strip orphaned leading/trailing punctuation and
    // dangling connectors a removed clause left behind ("  , need a bite")
    out = out
        .replace(/\s+/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        .replace(/^[\s,;:.\-–—]+/, '')
        .replace(/[,;:\-–—\s]+$/, '')
        .replace(/^(and|but|so|because|,)\s+/i, '')
        .trim()

    // capitalise the first letter if the original read like a sentence
    if (out && /^[a-z]/.test(out) && /^[A-Z]/.test(reason.trim())) {
        out = out[0].toUpperCase() + out.slice(1)
    }

    // nothing meaningful survived (was basically just a stat quote)
    if (out.replace(/[^a-z]/gi, '').length < 3) {
        return FALLBACKS[spotted] || 'getting on with it'
    }
    return out
}
