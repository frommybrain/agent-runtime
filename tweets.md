# Agent Runtime — Build in Public Tweets

## Thread 1: The Cognitive Pipeline (v0.2 launch)

### Tweet 1 — The Hook
Building an autonomous AI agent that *feels* before it thinks.

Not a chatbot. Not a tool-user. An agent with internal states, adaptive rhythms, and emergent personality — running on a Raspberry Pi.

Here's how the cognitive pipeline works 🧵

### Tweet 2 — The Loop
Every 4-15 seconds, Victor (our agent) runs a cognitive loop:

SENSE → FEEL → THINK → ACT → REFLECT

The heartbeat is adaptive — high arousal = faster ticking. Calm environment = slower. The agent literally speeds up when excited.

```js
// Map arousal 0..1 to interval max..min
const range = this.maxIntervalMs - this.minIntervalMs
const target = this.maxIntervalMs - (arousal * range)
this.currentIntervalMs = Math.round(
  this.currentIntervalMs * 0.7 + target * 0.3
)
```

### Tweet 3 — Internal State
The agent has two emotional axes:
- **Valence** (-1 to +1): bad ↔ good
- **Arousal** (-1 to +1): calm ↔ excited

These aren't instructions — they're *sensations*. The environment shifts them. The LLM decides what to do about it.

Low vitality? Valence dips negative. The agent feels uneasy and changes its behaviour. No one told it to — it just does.

### Tweet 4 — The Attractor Model
Continuous signals use an *attractor model*, not additive nudges.

Vitality 0.8 doesn't keep adding +0.8 each tick — it *pulls* valence toward a target. When vitality drops, valence naturally decays back.

This prevents emotional pinning and creates smooth, natural state transitions.

```js
// Vitality pulls valence toward target
const target = (s.vitality - 0.5) * 1.6
this.valence += (target - this.valence) * pullRate
```

### Tweet 5 — What We Proved (Test Data)
We ran 107 ticks across 10 scenarios. Results:

- Stress test: valence dropped to -0.12 (agent described "subtle unease")
- Flourishing: valence peaked at +0.35 ("quiet contentment")
- Social encounters: arousal spiked +0.1 per speech event
- Empty world: arousal decayed to near-zero ("understimulated")

The agent's internal state tracked the environment perfectly. No scripting.

### Tweet 6 — Hard Constraints
LLMs ignore soft prompt rules. "Only use available actions" in the prompt? Ignored 3 times in 107 ticks.

So we added hard validation in code:

```js
if (!validActions.has(decision.action)) {
  decision.action = fallback
  decision.params = {}
  decision.reason = '(corrected: not in available_actions)'
}
```

Soft guidance for creativity. Hard constraints for correctness.

### Tweet 7 — The Hallucination Bug
The agent kept talking about a "terminal" that didn't exist in the world.

Root cause: `tools.md` was append-only. Objects written were never removed. Even after clearing memory, the ghost object persisted in the tools file.

Fix: rebuild the nearby objects section from the *current* observation every tick. No stale data = no hallucination.

### Tweet 8 — Sleep Cycle
Every 4 hours, the agent sleeps. During sleep:
1. Memory consolidation (LLM merges redundant entries)
2. Skill extraction (procedural knowledge separated out)
3. Self-reflection (can evolve its own personality)
4. Garbage collection (old logs pruned)

The agent wakes up sharper, not just rested.

### Tweet 9 — What's Next
- Multi-agent deployment (agents talking to each other)
- Long-term memory hierarchy (core memories vs. working context)
- Persona drift protection (anchor traits that resist evolution)
- Months-long soak testing

The goal: agents that develop genuine behavioural depth over weeks and months of continuous operation.

This is v0.2. We're just getting started.

---

## Thread 2: Long-Term Stability Audit

### Tweet 10 — The Question
Can an autonomous agent run for *months* without degrading?

We audited every system that accumulates state. Found 13 potential failure modes. Some would break within days. Here's what we found 🧵

### Tweet 11 — The DailyLog Time Bomb
Every 8-second tick wrote to a log file. Each write read the *entire file* then rewrote it.

- 21,600 read+rewrite cycles per day
- By end of day: rewriting 200KB per append
- On a Pi's SD card: weeks before wear kills it

Fix: in-memory buffer with periodic batch flush. Disk I/O drops from 21,600/day to ~288.

### Tweet 12 — Sleep Is the Only GC
Memory consolidation, log cleanup, state reset — ALL happen during sleep. If the agent crashes before sleeping? Everything grows unbounded.

This is like having garbage collection only run on Tuesdays.

Fix: background maintenance timer, independent of sleep. GC runs no matter what.

### Tweet 13 — The Context Window Trap
During sleep, the entire day's log gets passed to the LLM for consolidation.

After 4 hours active: ~400KB of log = ~100K tokens.
LLM context window: 8K tokens.

The consolidation silently produces garbage. Memories stop being properly formed.

Fix: cap consolidation input to last 200 lines + salient events. The LLM only sees what it can actually process.

### Tweet 14 — Emotional Amnesia
When the process restarts, internal state resets to zero. The agent wakes up with the emotional affect of a newborn — no memory of what it was feeling or doing.

Fix: checkpoint valence/arousal to disk periodically. On restart, reload the last checkpoint. Log the crash as a significant event.

### Tweet 15 — Persona Drift
The agent can evolve its own personality during sleep — traits, quirks, values, fears. The only guard is a soft prompt saying "be subtle."

Over 180 sleep cycles per month with an 8B model? The persona drifts into something unrecognizable.

Fix: immutable anchor traits, drift scoring against original persona, evolution blocked when divergence exceeds threshold.

### Tweet 16 — The 50-Entry Memory Cap
memory.md is capped at ~50 entries. After 6 months of operation with 6 sleep cycles/day, that's 1,000+ consolidation passes.

The agent forgets its first month by month three. No distinction between "the day I first met Bob" and "I was just at the fountain."

Fix: memory hierarchy — core memories (rarely pruned), knowledge (updated when corrected), recent (aggressively pruned).

### Tweet 17 — Building for Months
These aren't theoretical bugs. They're the difference between a demo and a thesis.

We're fixing all 13 failure modes. The goal: an agent that runs for an entire summer, developing genuine behavioural depth through accumulated experience.

Building in public. More updates soon.

---

## Milestone Tweets (append as work progresses)

<!-- New milestone tweets go below this line -->

### Milestone 1 — v0.3: Long-Term Stability Overhaul (2026-03-14)

Shipped 11 fixes to make the agent runtime survive weeks/months of continuous operation:

**Disk I/O: -99%**
DailyLog was doing 21,600 read+rewrite cycles/day. Now uses an in-memory buffer with periodic batch flush via appendFile. SD card says thanks.

**Sleep is no longer the only GC**
Memory consolidation, log cleanup, state reset — all used to run ONLY during sleep. If the agent crashed before sleeping, everything grew unbounded. Added a fallback maintenance timer that runs regardless.

**Context window protection**
Sleep consolidation was passing the entire day's log (~400KB) to an 8K token model. Now capped at 200 lines + salient events. The LLM can actually process what it's given.

**Crash recovery**
Emotional state now checkpoints to disk every 5 min. On restart, the agent picks up where it left off instead of waking up as a blank slate.

**Persona drift guard**
The agent evolves its own personality during sleep. Now we measure drift from the original persona — if it diverges >60%, evolution is blocked. Identity anchored.

```js
_measureDrift(currentPersona) {
  // Compare array fields: what fraction of original items survived?
  for (const field of ['traits', 'values', 'fears', 'quirks']) {
    const orig = new Set(original[field])
    const curr = new Set(current[field])
    surviving = [...orig].filter(x => curr.has(x)).length
    totalDrift += (1 - surviving / orig.size)
  }
  return totalDrift / fieldCount
}
```

Also: token budget for prompts, exponential backoff on WebSocket reconnect, SSE stale client cleanup, tools.md hash-based write skipping, /metrics endpoint for observability.

v0.2 was "does it work?" v0.3 is "will it still work in August?"

### Milestone 2 — First 2-Hour Soak Test Results (2026-03-14)

Ran our first long-duration soak test: 2 hours, 514 ticks, 10 environmental phases, 3 sleep/wake cycles.

The good news first 🧵

### Tweet M2-1 — Sleep Cycles Work
3 sleep/wake transitions fired exactly on schedule. 30 minutes active → 5 min sleep → 30 min active.

During each sleep: memory consolidation, skill extraction, self-reflection, garbage collection, state clear. All 6 passes completed successfully.

Memory grew from 11 → 22 entries. Skills from 0 → 10. The agent is actually learning.

### Tweet M2-2 — Emotional State Tracking
The affect system tracked environment perfectly across 2 hours:

- Stress phase: valence -0.262, arousal 0.574 → "Something feels wrong — restless, uneasy, on edge"
- Recovery: climbed back to -0.019 in 8 minutes
- Flourishing: valence +0.345 → "A quiet contentment — things feel right"
- Empty world: arousal decayed to 0.055 → agent slowed its heartbeat to 14s

The adaptive heartbeat responded correctly: 8.7s during stress, 15s during calm. The agent literally speeds up when anxious.

### Tweet M2-3 — The Synth Mode Test
Synth mode gives the agent music-making actions instead of spatial ones. Zero spatial action leaks across 43 synth ticks.

Actions: change_bpm(14), set_step(14), add_chord(14), remove_chord(1). The hard action validation from v0.2 held up perfectly over the full soak.

### Tweet M2-4 — The Bad News: Memory Duplicates
The 8B model's consolidation pass can't deduplicate. After 2 hours, memory.md had:

```
- Adding new chords can break the repetition
- Adding a new chord to the pool can keep the rhythm going
- Changing tempo can break the repetition
- Adding new chords can break the repetition  ← duplicate
- Adding a new chord to the pool can keep the rhythm going  ← duplicate
- Changing tempo can break the repetition  ← duplicate
```

8 near-identical entries. The LLM prompt says "merge redundant entries" but an 8B model just... keeps everything.

### Tweet M2-5 — Fix: Keyword-Based Fuzzy Dedup
Can't trust the LLM to deduplicate. Added a code-level pre-consolidation pass:

1. Extract keywords from each memory entry (strip stop words)
2. Compare keyword overlap between entries
3. If 70%+ keyword similarity → drop the duplicate

```js
const overlap = keywords.filter(k => existing.keywords.includes(k)).length
const similarity = overlap / Math.max(keywords.length, existing.keywords.length)
if (similarity >= 0.7) isDuplicate = true
```

Runs before the LLM even sees the memory. Hard constraints > soft prompts. Again.

### Tweet M2-6 — Action Distribution
514 ticks over 2 hours:

- move_to: 232 (45%)
- interact: 154 (30%)
- speak: 80 (15.6%)
- synth actions: 43 (8.4%)
- wait: 5 (1%)

Speech at 15.6% — well under the 35% cap. The agent prefers action over narration. Good balance.

### Tweet M2-7 — What the Soak Test Validated
The soak test ran on v0.2 code. Everything from v0.3 (DailyLog buffer, crash recovery, drift guard, token budget, metrics endpoint) ships next.

But even on v0.2: sleep cycles, emotional tracking, adaptive heartbeat, action validation, and phase transitions all held up across 514 ticks. The foundation is solid.

Next: deploy v0.3, run another soak, see if memory dedup and the stability fixes make a difference.
