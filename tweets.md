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

### Milestone 3 — Object Persistence: The Ghost Terminal (2026-03-14)

The agent kept talking about "terminal-01" even in phases where it didn't exist.

Root cause: two sources of truth, one stale.

`tools.md` is rebuilt every tick from the current observation. When terminal-01 disappears, tools says "(nothing nearby)" — correct.

But `memory.md` permanently stores facts: "Terminal-01 is an interactive device." The LLM sees both. An 8B model can't reconcile the contradiction. It trusts the memory and hallucinates the object.

This is the memory persistence paradox: the agent needs long-term memory to learn, but stale facts become hallucination fuel.

### Tweet M3-1 — The Fix: Ground Truth Annotations

Two changes:

1. Nearby Objects section now explicitly says "GROUND TRUTH — if something is not listed here, it is not present"
2. New prompt rule: "ONLY interact with objects listed under Nearby Objects RIGHT NOW — your memories may reference objects that no longer exist"

Soft prompts fail with 8B models. But when the ground truth is labeled as ground truth, even small models can distinguish "I remember this" from "I see this right now."

### Tweet M3-2 — Test Design: The Object Gauntlet

Redesigned the soak test with an object persistence gauntlet. 6 unique objects that appear, disappear, and return across 13 phases:

- Phase 1: pillar appears
- Phase 4: pillar removed, only pond remains
- Phase 5: everything gone
- Phase 6: entirely new objects (monolith, lantern)
- Phase 8: pillar RETURNS after 4 phases away
- Phase 12: only lantern remains

The report now tracks every speech and interact that mentions an absent object. If the agent says "pillar" when pillar isn't there — that's a counted hallucination.

Hard measurement > vibes.

### Milestone 4 — v0.3.1: The 3-Month Readiness Audit (2026-03-14)

Audited every source file for a thesis-level installation: one agent running continuously for 3 months.

Found 20 issues. 7 were no-ship blockers. Fixed all 7 in one session. Here's the thread 🧵

### Tweet M4-1 — The Memory Corruption Bug

Sleep consolidation passes the entire memory.md to an 8B LLM and writes back whatever it returns. The only guard: `result.length > 10`.

If the LLM returns garbled markdown? Memory is permanently gone. No backup. No validation. No rollback.

Over 3 months with 6 sleep cycles/day: 540 chances to corrupt memory.

Fix: backup → validate → write. If the output doesn't have markdown headers and list entries, restore from backup. Every consolidation write is now atomic.

### Tweet M4-2 — The Tools.md Time Bomb

During sleep, `_refreshTools()` asked the LLM to "clean up" tools.md. But tools.md is rebuilt from the live observation every tick.

The LLM would reformat the header `# Nearby Objects (GROUND TRUTH...)` to something like `## Objects Nearby`. The regex match fails. A second Nearby Objects section gets appended. Then a third. Forever.

Fix: deleted the entire method. If it's rebuilt every tick, don't let the LLM touch it during sleep. Redundant cleanup that was actively destructive.

### Tweet M4-3 — Persona Corruption

The agent evolves its personality during sleep. The LLM returns JSON changes that get merged into the persona file.

What if the LLM returns `{"traits": "bold"}` instead of `{"traits": ["bold"]}`? The persona file is written. Next tick: `persona.traits.join(', ')` → crash. Every tick. Unrecoverable without manual editing.

Fix: type-check every field before merging. Arrays must be arrays. Objects must be objects. Backup the persona file before any write.

### Tweet M4-4 — Drift Baseline Shift

The persona drift guard compares current personality against the "original." But `_originalPersona` was loaded on the first sleep cycle, not on boot.

After a crash-restart: the drifted persona IS the original. After 10 restarts over a summer: the 60% drift threshold means nothing — the baseline keeps shifting.

Fix: save an immutable `persona-baseline.json` on first-ever boot. Load from that file on every subsequent startup. The original is the original, forever.

### Tweet M4-5 — The Hallucination Engine

Skills extraction asks the LLM: "find procedural knowledge the agent learned."

The agent doesn't learn procedures. It does `move_to`, `interact`, `speak`. But the LLM invents them anyway:

```
## Territory Management
### Claiming Territory
- Move to a new location and assert dominance
```

None of this happened. The LLM hallucinated an entire skill tree. And it gets fed back into every tick's prompt as "MY SKILLS."

Fix: constrained the prompt to ONLY extract from the activity log with strict rules. "DO NOT invent, embellish, or generalise." Added validation + backup.

### Tweet M4-6 — Memory Truncation Was Backwards

When the prompt exceeds the token budget, memory gets truncated. The old code: `memory.slice(0, memory.length - overBy)`.

memory.md sections: Relationships → Learned Facts → Important Memories.

So "Important Memories" — the most valuable section — gets cut first. Every time.

Fix: now specifically truncates the middle of "Learned Facts" (the largest, least critical section). Important Memories and Relationships are protected.

### Tweet M4-7 — The Slow Leak

Nothing stopped the LLM from writing a 500-character paragraph as a "learned fact." Over months, individual memory entries become novels and blow the token budget, triggering truncation, which cuts other memories to make room for the bloated one.

Fix: hard cap at 120 characters per memory entry. Both in the decision handler and in the append method. Two layers of defense.

### Tweet M4-8 — The Scorecard

7 critical fixes in v0.3.1:
1. ✅ Memory backup + validation before consolidation writes
2. ✅ Removed destructive _refreshTools()
3. ✅ Persona evolution type validation + backup
4. ✅ Immutable persona baseline for drift guard
5. ✅ Skills extraction constrained to log evidence only
6. ✅ Smart truncation (protects Important Memories)
7. ✅ Memory entry length cap (120 chars)

13 more issues documented for later. The difference between a demo and a thesis is this: every write is guarded, every LLM output is validated, every file has a backup.

v0.3 asked "will it still work in August?" v0.3.1 asks "will it still work correctly?"

### Milestone 5 — v0.3.2: Soak Test Results + Anti-Repetition Overhaul (2026-03-14)

Ran a 45-minute soak test on v0.3.1. 13 environmental phases. Object persistence gauntlet. Here's what we found and fixed 🧵

### Tweet M5-1 — The Soak Report Card

45 minutes, ~340 ticks, 13 phases including object appearance/disappearance/return. Results:

- Sleep cycles: fired on schedule, consolidation succeeded
- Action validation: zero invalid actions
- Hallucinations: down from rampant to 3 instances (all "pillar" mentioned after removal)
- Emotional tracking: worked, but flatlined in the neutral band
- Speech: still repetitive — "Interesting" and "Right" over and over

3 hallucinations is 3 too many. And "Feeling steady" described 70% of ticks. Time to fix both.

### Tweet M5-2 — Ghost Object Tracking

3 hallucinations survived v0.3.1. Root cause: the LLM sees "pillar" disappear from Nearby Objects but nothing explicitly says "it's gone."

Fix: track recently-disappeared objects for 10 ticks after they vanish. Inject an explicit warning into the user prompt:

```
GONE: The following objects have DISAPPEARED and are
NO LONGER HERE: pillar-01. Do NOT mention, interact
with, or speak about them.
```

Belt, suspenders, and a warning sign.

### Tweet M5-3 — Fuzzy Speech Dedup

The agent kept saying variations of the same thing: "Interesting, let me explore" → "Right, interesting, I'll look around" → "Let me check that out, interesting."

Exact-match dedup doesn't catch paraphrasing. Added keyword-based fuzzy matching:

1. Extract keywords from each utterance (stop-word removal)
2. Compare keyword sets between recent speech
3. 60%+ overlap = "same idea" → warning fired

Same approach we used for memory dedup. If it works for facts, it works for speech.

### Tweet M5-4 — Emotional Flatline Fix

The internal state `describe()` method had 9 descriptions covering the full valence×arousal grid. Problem: the neutral catch-all covered a HUGE range (v: -0.1 to 0.15, a: -0.3 to 0.5).

In the soak test, "Feeling steady — nothing remarkable" described 70%+ of ticks. The agent felt nothing most of the time.

Fix: expanded from 9 to 16 descriptions. Narrowed the neutral band to v: -0.05 to 0.05, a: -0.15 to 0.15. Added mid-range states like "comfortable focus," "awake and aware," "flat and disengaged."

The agent now has emotional resolution where it matters most — in the middle, where it spends most of its time.

### Tweet M5-5 — Working Memory Efficiency

Each cognitive tick generated 2 working memory events: one for the action, one for the result. 12-slot buffer = only 6 ticks of context.

Fix: action_result events now merge into the preceding action event. One slot per tick instead of two. Buffer increased from 12 → 20 slots.

The agent now remembers 20 ticks of context instead of 6. That's the difference between "what just happened" and "what I've been doing for the last few minutes."

### Tweet M5-6 — Object Position Awareness

Objects in the world had positions, but the agent couldn't see them. The perceiver was skipping `pos` and `distance` fields on objects.

Fix: objects now narrate their distance or coordinates. "pillar-01 3.2 away" instead of just "pillar-01". Spatial awareness matters for an agent that moves.

### Tweet M5-7 — The v0.3.2 Scorecard

6 fixes shipped:
1. ✅ Disappeared-object tracking (10-tick fade + explicit GONE warning)
2. ✅ Fuzzy speech dedup (keyword overlap, 60% threshold)
3. ✅ Emotional descriptions expanded (9 → 16, neutral band narrowed 4x)
4. ✅ Working memory merged events (2 slots/tick → 1, buffer 12 → 20)
5. ✅ Object position narration (distance + coordinates)
6. ✅ Version bump to v0.3.2

Ready for the next soak test. The question: can we get hallucinations to zero and speech repetition under control?

### Milestone 6 — v0.3.3: Second Soak Test + Valence Flatline Fix (2026-03-14)

Second 45-minute soak test on v0.3.2. Hallucinations dropped from 3 → 1. But valence flatlined at exactly 0.000 for 70%+ of ticks. Here's what happened and what we fixed 🧵

### Tweet M6-1 — The Valence Flatline

Valence sat at 0.000 from tick 52 onwards — for the entire rest of the test. The expanded emotional descriptions couldn't help because the underlying value was stuck at zero.

Root cause: successful actions had NO effect on valence. Only failures mattered (-0.15). With no environment signals in half the phases, valence decayed to 0 and stayed there. The agent was successfully exploring, interacting, discovering — and feeling *nothing*.

### Tweet M6-2 — The Fix: Asymmetric Reward

Success should feel mildly positive. Failure should feel sharply negative. This is negativity bias — it's how biological systems work.

```js
if (!context.actionResult.success) {
    this._nudgeValence(-0.15)     // failure: sharp
} else {
    this._nudgeValence(0.02)      // success: mild
    if (context.actionResult.action === 'interact') {
        this._nudgeValence(0.04)  // exploration: rewarding
    }
}
```

The agent now generates its own positive valence through successful action. It doesn't need the environment to tell it to feel good — doing things well is its own reward.

### Tweet M6-3 — The Last Hallucination

1 hallucination remained: tick 138, "Pillar's stability has piqued my interest" — 46 ticks after pillar was removed. The 10-tick GONE warning had expired 36 ticks earlier. The agent was drawing on stale memory facts.

Fix: extended the GONE window from 10 → 30 ticks (~4 minutes). Objects now haunt the agent's conscience for much longer after disappearing. If 30 ticks isn't enough, the next defense is memory pruning during sleep.

### Tweet M6-4 — Soak Test Realism

Half the test phases sent NO environment signals (null vitality, null warmth). In a real installation, the environment always sends signals. This made the test unrealistically harsh for the valence system.

Fix: every phase now has baseline signals. Calm exploration gets vitality 0.55 (slightly positive). Empty world gets vitality 0.35 (slightly negative). Stress phases are genuinely stressful. The test now models a real environment, not a void.

### Tweet M6-5 — v0.3.3 Scorecard

Second soak test (v0.3.2) results:
- Hallucinations: 3 → 1 (GONE tracking working, window too short)
- Emotional variety: improved (3 distinct states vs 1), but valence flatlined
- Speech: less repetitive (fuzzy dedup working), but still gravitates to similar constructions
- Action mix: move_to dominated at 61%, interact dropped to 9%

3 fixes in v0.3.3:
1. ✅ Asymmetric valence rewards (success +0.02, interact +0.04, failure -0.15)
2. ✅ GONE window extended 10 → 30 ticks
3. ✅ Soak test: baseline signals for all phases
