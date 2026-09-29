// fingerprint: 715a8546c06d0456
// copied from the 3eyes sim by its sync:voice script. dont edit here, edit it there and re-sync.
const HOLLOW = /\b(the|a|an|any|some|that|this)\s+(\w+\s+){0,2}(edge|gnaw|flatness|pull|whisper|buzz|stillness|emptiness|void|clue|spark|sparkle|unease|ache|hum)\b/i

const GAUGE = /\b(curiosity|hunger|rest|social|safety|energy)\b[^.,]{0,18}\b(spike|pull|gnaw|scream|surge|climb|desperate|rising|is (high|low))/i

const DIAL = /\b(?:my|his|the)\s+(?:tilt|levels?|gauge|meter|readings?)\b/i

const NUMBERED = /\b\d{4,}\b/

const STIFF = /\b(curb|quell|assuage|alleviate|sate|satiate|imbibe|partake|traverse|procure)\b/i

const HEDGE = /\b(maybe|perhaps|might|seems? to|somehow|something (odd|strange))\b/i

const INVERTED = /\b(lay|lays|lies)\s+(beside|by|near|against|across|among|amid|there)\b|\bstill\s+(lay|lies)\b/i

const STATUS_REPORT = /;\s*(it|they)\s+(still|was|were|had)\b|\bstill\s+\w+,\s*(i|it|they)\b|\b(i'?(ll)? ?(left|leave|noted|note) it|it stayed)\b|\b(was|were)\s+still\b(?![^.;!?]*\bi\b)[^.;!?]*[.!?]?\s*$/i

const SHRUG = /[,;]\s*(i\s+)?(\w+ed(\s+again)?|(will|ll|d)\s+\w+(\s+it)?|\w+\s+it)\s*[.!]?$|\bi\s+(noted|stared|shrugged|blinked|watched|looked)\b/i

const NOTE_TO_SELF = /\b(i'?(ll|d)?\s+(mind|note|remember|keep|watch))\s+(it|its|that|the)\b|\b(noting|minding)\s+(it|its)\b|,\s*(a|another)\s+(reminder|sign|proof)\s+that\b|\bwhich\s+reminds?\s+me\b/i

const PAIRED_ADVERB = /\b(\w+ly)\s+and\s+(\w+ly)\b/i

const SCENE = /\b(as|while)\s+(the|a|an|its|his|her|their)\s+[a-z']+\s+[a-z']+\s+[a-z']|,\s*(its|his|her|their)\s+[a-z' ]{0,24}[a-z]ing\b|\b(stood|sat|paused|lingered)\s+before\b/i

const QUALITY = 'flicker|hum|ripple|chord|glow|glint|shimmer|buzz|beat|pulse|drift|murmur|thrum|breath|song|rhythm|note'
const EMANATION = new RegExp(
  `\\b(?:[a-z]+'s|the\\s+[a-z]+)\\s+(?:${QUALITY})\\b[^.]{0,40}?\\b(could|would|might)\\b`
  + `|\\bneed\\b[^.]{0,30}?\\b(?:[a-z]+'s|the\\s+[a-z]+)\\s+(?:${QUALITY})\\b`
  + `|\\b(is|are|was|were|feels?|felt|sounds?)\\s+(a|an|the)\\s+(?:[a-z]+\\s+){0,2}(?:${QUALITY})\\b`

  + `|\\b(?:the\\s+)?[a-z]+(?:\\s+[a-z]+)?'s\\s+[a-z]+(?:\\s+[a-z]+)?\\b[^.]{0,24}?\\b(could|would|might)\\b`,
  'i',
)

const MORAL = /\b(remind(s|ed)?\s+me\s+that|a\s+reminder\s+that|turns?\s+out\s+(that\s+)?|goes?\s+to\s+show|which\s+is\s+what\s+happens\s+when)\b/i

const CONCRETE = /\b(sock|shoe|drum|machine|glass|bottle|leaf|coin|bag|door|window|wall|sign|light|lamp|bench|step|rail|paper|card|box|tin|lid|cup|plate|fruit|apple|chip|crumb|feather|wing|beak|claw|puddle|reed|gravel|kerb|gutter|receipt|ticket|button|lace|wrist|arm|hand|coat|hat|bandage|needle|ink|screen|keyboard|phone|receiver|beep|speaker|towel|comb|brush|mirror|chair|table|clock|plaque|case|rock|water|rain|wind|dust|smoke)\b/i

const IDEAL_WORDS = 14

function words(s) { return String(s).trim().split(/\s+/).filter(Boolean) }

function stems(s) {
  return new Set(
    String(s).toLowerCase().split(/[^a-z']+/)
      .filter((w) => w.length > 3)
      .map((w) => w.replace(/(ing|ed|s)$/, '')),
  )
}

function sameness(a, b) {
  const A = stems(a); const B = stems(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / Math.min(A.size, B.size)
}

export function scoreLine(line, recent = [], opts = {}) {
  const text = String(line || '').trim()
  const notes = []
  if (!text) return { score: -5, notes: ['empty'] }

  let score = 0
  const w = words(text)

  if (CONCRETE.test(text)) { score += 1.5; notes.push('concrete') }

  if (/\b\d/.test(text)) { score += 0.8; notes.push('specific') }
  else if (/\s[A-Z][a-zA-Z']{1,}/.test(text)) { score += 0.6; notes.push('named') }

  const ideal = opts.idealWords || IDEAL_WORDS
  if (w.length > ideal) {
    score += Math.max(-1.5, 0.8 - (w.length - ideal) * 0.10)
    if (w.length > ideal + 6) notes.push('long')
  } else {
    score += 0.8
  }

  if (HOLLOW.test(text)) { score -= 2.5; notes.push('hollow') }

  if (GAUGE.test(text)) { score -= 2; notes.push('gauge') }
  if (DIAL.test(text)) { score -= 2; notes.push('dial') }

  if (NUMBERED.test(text)) { score -= 1.5; notes.push('numbered') }

  if (HEDGE.test(text)) { score -= 0.8; notes.push('hedged') }

  if (PAIRED_ADVERB.test(text)) { score -= 1.2; notes.push('paired-adverb') }

  if (STIFF.test(text)) { score -= 2.5; notes.push('stiff') }

  if (INVERTED.test(text)) { score -= 2; notes.push('inverted') }

  if (STATUS_REPORT.test(text)) { score -= 1.5; notes.push('status-report') }

  if (SCENE.test(text)) { score -= 2; notes.push('scene') }

  if (SHRUG.test(text)) { score -= 2; notes.push('shrug') }

  if (NOTE_TO_SELF.test(text)) { score -= 2; notes.push('note-to-self') }

  const joint = /,\s*and the\b/i
  if (joint.test(text)) {
    const runs = (recent || []).filter((r) => joint.test(r)).length
    if (runs >= 2) { score -= 1.6; notes.push('same-joint-again') }
    else if (runs === 1) { score -= 0.6; notes.push('joint-repeat') }
  }

  if (EMANATION.test(text)) { score -= 2; notes.push('emanation') }

  if (MORAL.test(text)) { score -= 2; notes.push('moral') }

  let worst = 0
  for (const r of recent) worst = Math.max(worst, sameness(text, r))
  if (worst >= 0.5) { score -= 2 * worst; notes.push('repeat') }

  return { score: Number(score.toFixed(2)), notes }
}

export function exemplars(history, { best = 4, worst = 3 } = {}) {
  const scored = history
    .filter((h) => h && h.line)
    .map((h) => ({ line: h.line, score: typeof h.score === 'number' ? h.score : scoreLine(h.line).score }))
  if (scored.length < 6) return { best: [], worst: [] }

  const byScore = [...scored].sort((a, b) => b.score - a.score)
  return {
    best: byScore.slice(0, best).map((s) => s.line),
    worst: byScore.slice(-worst).filter((s) => s.score < 0).map((s) => s.line),
  }
}

export const _patterns = { HOLLOW, GAUGE, DIAL, NUMBERED, HEDGE, PAIRED_ADVERB, CONCRETE, INVERTED, STATUS_REPORT, SHRUG, NOTE_TO_SELF, SCENE, EMANATION, MORAL }
