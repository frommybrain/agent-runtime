// fingerprint: 91ce0d9a46b618eb
// What a good line is, as a number.
//
// Everything built so far to control his voice is a prohibition. wornWords
// bans a word once he leans on it. RepetitionGuard blocks a repeat. The
// drift guards stop the persona collapsing. The prompt carries a growing
// list of things never to write. Prohibitions can only ever say what NOT to
// do, which is why this has been whack-a-mole all day: ban "the edge" and
// you get "the whisper", ban that and you get "the pull". Nothing in the
// system has ever said "that one was good, do more of that."
//
// So this scores a line instead of judging it. It decides which of HIS OWN
// lines get shown back to him as the examples to write like, and which get
// shown as the ones that failed. He learns his voice from his own best work
// rather than from mine, which also fixes a problem I caused: my
// hand-written examples taught a writerly tic ("badly and completely") that
// came straight back in his output.
//
// It is ALSO, since JournalGate, what decides which lines anybody reads.
// That was not the original intent ("a rejection is just another
// prohibition" is what this comment used to say) and it raises the stakes
// on every pattern below: a blind spot here is no longer a ranking
// curiosity, it selects what the diary becomes. The INVERTED pattern exists
// because of exactly that. Before it, this file scored "lay beside the
// beach photographs" at 2.3 and Sam's own plainer rewrite at 1.02, so
// publishing on score would have printed the register he keeps objecting
// to. Test any new pattern against his good and bad examples, both.
//
// Deliberately mechanical, no model call. A fitness function that needs an
// LLM to run is a fitness function nobody runs on every line.

// Standing in for a real thing rather than being one. This list is a
// starting point and the SCORE is what matters: a new one of these will be
// scored down for vagueness even before anyone adds the word.
// Matched as a bare noun with anything between it and its article, because
// the first version keyed on "a spark" and sailed straight past "a reckless
// spark", and on "the whisper" while "any whisper" scored positive.
const HOLLOW = /\b(the|a|an|any|some|that|this)\s+(\w+\s+){0,2}(edge|gnaw|flatness|pull|whisper|buzz|stillness|emptiness|void|clue|spark|sparkle|unease|ache|hum)\b/i

// Reading his own dials.
const GAUGE = /\b(curiosity|hunger|rest|social|safety|energy)\b[^.,]{0,18}\b(spike|pull|gnaw|scream|surge|climb|desperate|rising|is (high|low))/i

// Formal where a plain word exists. Sam has flagged "curb" twice.
const STIFF = /\b(curb|quell|assuage|alleviate|sate|satiate|imbibe|partake|traverse|procure)\b/i

// Hedges. A moment that happened does not need "maybe".
//
// "kind of" and "sort of" USED to be in here and should never have been.
// They are casual speech markers, not hedges about facts, and Sam's own
// preferred rewrite was "saw a silver comb next to the mirror on the salon
// bench, kind of like it". This pattern was scoring down the exact register
// it exists to encourage.
const HEDGE = /\b(maybe|perhaps|might|seems? to|somehow|something (odd|strange))\b/i

// Literary inversion. "The cracked glass still lay beside the beach
// photographs" is writing; "saw a comb next to the mirror" is speech. Sam
// flagged "lay beside" twice, and the scorer was ranking it ABOVE his own
// rewrite, which meant the fitness function was training him toward the
// register he dislikes. Now that JournalGate publishes on score, that was
// no longer a ranking curiosity, it decided what people read.
const INVERTED = /\b(lay|lays|lies)\s+(beside|by|near|against|across|among|amid|there)\b|\bstill\s+(lay|lies)\b/i

// The status report. "Went back for the rusted soda can; it still lay
// rusted" is a state check on an object, not a moment. This shape came out
// of an example in the moment prompt and took over 16% of the diary.
const STATUS_REPORT = /;\s*(it|they)\s+(still|was|were|had)\b/i

// Paired adverbs that cancel each other out.
const PAIRED_ADVERB = /\b(\w+ly)\s+and\s+(\w+ly)\b/i

// Things a reader can see, hear or hold. Not exhaustive and not meant to be:
// it rewards the SHAPE of naming an object, and any concrete noun outside
// this list still earns through the proper-noun and number checks below.
const CONCRETE = /\b(sock|shoe|drum|machine|glass|bottle|leaf|coin|bag|door|window|wall|sign|light|lamp|bench|step|rail|paper|card|box|tin|lid|cup|plate|fruit|apple|chip|crumb|feather|wing|beak|claw|puddle|reed|gravel|kerb|gutter|receipt|ticket|button|lace|wrist|arm|hand|coat|hat|bandage|needle|ink|screen|keyboard|phone|receiver|beep|speaker|towel|comb|brush|mirror|chair|table|clock|plaque|case|rock|water|rain|wind|dust|smoke)\b/i

const IDEAL_WORDS = 10

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

/**
 * Score one line. Positive is good. Roughly -3 to +4 in practice.
 *
 * @param {string} line
 * @param {string[]} [recent] lines he has written lately, for the repetition penalty
 * @returns {{ score:number, notes:string[] }}
 */
export function scoreLine(line, recent = []) {
  const text = String(line || '').trim()
  const notes = []
  if (!text) return { score: -5, notes: ['empty'] }

  let score = 0
  const w = words(text)

  // Names something a reader can picture.
  if (CONCRETE.test(text)) { score += 1.5; notes.push('concrete') }

  // A specific detail: a number, or a capitalised name mid-sentence.
  if (/\b\d/.test(text)) { score += 0.8; notes.push('specific') }
  else if (/\s[A-Z][a-zA-Z']{1,}/.test(text)) { score += 0.6; notes.push('named') }

  // Length. His best run from 4 words ("Starving, heading to McDonald's")
  // to 17, so short is not a fault and long is. A symmetric curve scored
  // his own favourite line at 0.08, which would have taught exactly the
  // wrong thing.
  if (w.length > IDEAL_WORDS) {
    score += Math.max(-1.5, 0.8 - (w.length - IDEAL_WORDS) * 0.18)
    if (w.length > 20) notes.push('long')
  } else {
    score += 0.8
  }

  // An abstraction standing where a thing should be.
  if (HOLLOW.test(text)) { score -= 2.5; notes.push('hollow') }

  // Reporting his own state as a measurement.
  if (GAUGE.test(text)) { score -= 2; notes.push('gauge') }

  // Hedging about something that already happened.
  if (HEDGE.test(text)) { score -= 0.8; notes.push('hedged') }

  if (PAIRED_ADVERB.test(text)) { score -= 1.2; notes.push('paired-adverb') }

  if (STIFF.test(text)) { score -= 1.5; notes.push('stiff') }

  // Sized to beat the +1.5 a concrete noun earns: "lay beside the beach
  // photographs" names a photograph and was riding that bonus to 2.3.
  if (INVERTED.test(text)) { score -= 2; notes.push('inverted') }

  if (STATUS_REPORT.test(text)) { score -= 1.5; notes.push('status-report') }

  // Saying it again. Compared against the shorter line so a long paraphrase
  // cannot hide behind its own extra words.
  let worst = 0
  for (const r of recent) worst = Math.max(worst, sameness(text, r))
  if (worst >= 0.5) { score -= 2 * worst; notes.push('repeat') }

  return { score: Number(score.toFixed(2)), notes }
}

/**
 * His own best and worst recent lines, to be shown back to him.
 *
 * This is the point of the whole file. Instead of a longer list of rules,
 * he gets his own proven work as the target and his own failures as the
 * warning, so the examples stop being mine and start being his.
 */
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

export const _patterns = { HOLLOW, GAUGE, HEDGE, PAIRED_ADVERB, CONCRETE, INVERTED, STATUS_REPORT }
