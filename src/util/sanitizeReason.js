// last scrub on a reason before its logged or broadcast. the prompt already
// says no stats, the smaller models ignore it ("Hunger at 100%, need
// something fresh"). no numbers or entity ids reach the feed, whoever wrote it

// "hunger at 100%", "rest is 42%", and the mood floats ("valence -0.21 so I
// want the pond"), which is why the -? and decimals. keep in step with
// sim-server bridge/BridgeAction.js
const STAT_CLAUSE = /\b(hunger|rest|curiosity|social|safety|energy|mood|arousal|valence)('s|s)?\s*(is|at|level|sits at|sitting at)?\s*(at\s*)?-?\d{1,3}(\.\d+)?\s*%?/gi
const BARE_PCT = /\b(at\s*)?\d{1,3}\s*%/gi
// food_apple_tree -> apple tree
const ENTITY_ID = /\b(?:food|activity|nest|artifact|npc|poi|rest)_[a-z0-9_]+/gi

// when the scrub leaves nothing. a dull line beats a number
const FALLBACKS = {
    hunger: 'I could eat',
    rest: 'I need to sit a while',
    curiosity: 'something out there is pulling at me',
    social: 'I could do with a bit of company',
    safety: 'I want somewhere that feels safe',
}

// clauses that just read out a dial: "Curiosity spikes, need to chase that
// sparkle online" -> "Need to chase that sparkle online". the prompt rule
// alone got routed round twice in one day
const DRIVE = /\b(curiosity|hunger|rest|social|safety|energy|tiredness)\b/i
const GAUGE = /\b(spike[sd]?|pull[sing]*|gnaw\w*|scream\w*|desperate|surg\w+|climb\w*|rising|is (high|low|up|at)|'s (high|low|gnawing|screaming))\b/i

function dropGaugeClauses(text) {
  const parts = String(text).split(/,\s*/)
  if (parts.length < 2) return text
  const kept = parts.filter((c) => !(DRIVE.test(c) && GAUGE.test(c)))
  // under 3 words left, leave it. slightly odd beats empty
  if (kept.length === 0 || kept.length === parts.length) return text
  const out = kept.join(', ').trim()
  if (out.split(/\s+/).length < 3) return text
  return out.charAt(0).toUpperCase() + out.slice(1)
}

export function sanitizeReason(reason, { need } = {}) {
    if (typeof reason !== 'string') return reason
    let out = dropGaugeClauses(reason)

    // grab the need before its stripped, picks the fallback line
    let spotted = need
    if (!spotted) {
        const m = reason.match(/\b(hunger|rest|curiosity|social|safety)\b/i)
        if (m) spotted = m[1].toLowerCase()
    }

    out = out.replace(STAT_CLAUSE, ' ')
    out = out.replace(BARE_PCT, ' ')
    out = out.replace(ENTITY_ID, (id) => id.split('_').slice(1).join(' '))

    // clean up what a removed clause leaves behind ("  , need a bite")
    out = out
        .replace(/\s+/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        .replace(/^[\s,;:.\-–—]+/, '')
        .replace(/[,;:\-–—\s]+$/, '')
        .replace(/^(and|but|so|because|,)\s+/i, '')
        .trim()

    if (out && /^[a-z]/.test(out) && /^[A-Z]/.test(reason.trim())) {
        out = out[0].toUpperCase() + out.slice(1)
    }

    // it was only ever a stat
    if (out.replace(/[^a-z]/gi, '').length < 3) {
        return FALLBACKS[spotted] || 'getting on with it'
    }
    return out
}
