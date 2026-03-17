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

### Milestone 7 — 8-Hour Soak Test: The Overnight Run (2026-03-15)

First overnight soak test. 8 hours, 1948 ticks, 5 full phase cycles, 31 sleep/wake transitions. Zero crashes. Here's what 8 hours of continuous cognition looks like 🧵

### Tweet M7-1 — The Numbers

8 hours on v0.3.3. The agent ran from evening through the night:
- 1948 ticks across 5 complete 97-minute phase cycles
- 31 sleep cycles (every ~15 min with test settings), all completed successfully
- Memory: started at 15 entries, consolidated down to 10. Pruning works.
- Zero crashes, zero WebSocket disconnects, zero unrecoverable errors

This is the first test where "months" starts feeling plausible.

### Tweet M7-2 — Valence Is Alive

The v0.3.3 asymmetric reward fix completely solved the valence flatline:
- Range: -0.22 to +0.40 (was stuck at 0.000 for 70% of v0.3.2)
- 7+ distinct emotional descriptions appeared across all 5 cycles
- Stress phases hit genuine negative valence, flourishing hit genuine positive
- The agent *felt* differently in different environments, consistently, for 8 hours

The attractor model + asymmetric rewards = a working emotional system.

### Tweet M7-3 — The Memory vs Hallucination Distinction

16 hallucinations reported. But 6 were false positives — our detector used `.includes("pond")` which matches "responds" and "responding" as substrings.

Of the 10 real hits, ~4 were genuine hallucinations (treating absent objects as currently present) and ~5 were legitimate reminiscing (reflecting on past experiences with objects no longer there).

This distinction matters. "I remember the pond" is not a hallucination — it's memory. "The pond is interesting" when the pond is gone — THAT's a hallucination.

### Tweet M7-4 — Reinforcing the Distinction

Updated the prompt to explicitly separate memory from hallucination:

Before: "If something is not in your current nearby objects, it is GONE — do not speak about it as if it is still present"

After: Two rules:
1. "ONLY interact with objects listed under Nearby Objects RIGHT NOW"
2. "You may REMEMBER past experiences — reflecting on things you've seen before is natural. But always make it clear they are MEMORIES, not current reality."

And the GONE warning now says: "If you mention them, use past tense only."

We WANT the agent to build a sense of history. We just don't want it to hallucinate presence.

### Tweet M7-5 — Action Distribution at Scale

1948 ticks, 5 complete cycles:
- move_to: 53% (down from 61% in v0.3.2)
- speak: 21%
- interact: 12% (up from 9%)
- wait: 5%
- synth actions: 9%

The interact recovery is good — the agent is engaging with objects more, not just moving around. The action mix held steady across all 5 cycles, suggesting stable behavioral patterns.

### Tweet M7-6 — Empty World: Zero Hallucinations

The "Empty world — removal test" phase (ALL objects removed) produced zero hallucinations across all 5 cycles. This was the worst-performing phase in earlier tests.

The combination of ground truth labels, GONE warnings, and the 30-tick fade window works. When objects are gone, the agent knows they're gone.

### Tweet M7-7 — Soak Test Bug Fix

The false positive bug: `msg.includes("pond")` matches "responds" as a substring. 6 ghost hallucinations in the report that weren't real.

Fix: word boundary regex `\bpond\b` instead of `.includes()`. Simple but important — false positives in your measurement tool erode trust in all your results.

### Tweet M7-8 — Model Exploration

Currently running llama-3.1-8b-instant on Groq (cloud) with qwen2.5:3b as local fallback. Researched alternatives for the Pi 5 (8GB):

Top pick: **qwen3:4b** — generational leap over qwen2.5:3b. Better hallucination control (~15% reduction), native tool calling, fits in ~3GB RAM. Matches Qwen2.5-7B quality at half the size.

Also interesting: Ollama's `format` parameter for grammar-constrained JSON output. Instead of "please respond with JSON" (soft prompt), the model physically cannot produce invalid tokens. Could eliminate JSON parse failures entirely.

### Tweet M7-9 — v0.3.4 Scorecard

4 changes in v0.3.4:
1. ✅ Memory vs hallucination distinction in prompt (reminiscing allowed, presence-hallucination blocked)
2. ✅ GONE warning updated (past tense guidance instead of total silence)
3. ✅ Soak test word boundary matching (fixes 6 false positives)
4. ✅ Version bump to v0.3.4

The 8-hour test proved the foundation is solid. v0.3.4 refines the cognitive rules. Next up: test with the new prompt, then explore qwen3:4b as the local model.

### Milestone 8 — Model Upgrade + First 70B Test (2026-03-15)

Switched from llama-3.1-8b-instant to llama-3.3-70b-versatile on Groq cloud. Same free API, dramatically better results. 🧵

### Tweet M8-1 — The 70B Difference

First soak test on llama-3.3-70b-versatile. 45 minutes, 170 ticks. The action distribution shift is staggering:

| Action | 8B model | 70B model |
|--------|----------|-----------|
| move_to | 53% | 42% |
| interact | 12% | **30%** |
| speak | 21% | 21% |
| wait | 5% | 6.5% |

The agent went from "mostly wandering" to "actively engaging with its world." interact more than doubled. The 70B model understands "be curious, explore, interact" in a way the 8B just couldn't.

### Tweet M8-2 — Hallucination Quality

4 "hallucinations" reported, but all from one speech at tick 113:

> "I'm wondering if the **disappearance** of pillar-01 and relic-01 has caused a ripple effect..."

The agent explicitly says "disappearance" — it knows they're gone. It's reflecting on the past, not claiming absent objects are present. This is the memory-vs-hallucination distinction working exactly as intended.

The 4-count is a detector bug: "pillar-01" and "pillar" both match the same speech. Empty world phase: zero hallucinations for the 3rd consecutive test.

### Tweet M8-3 — The Parrot Problem

The agent kept saying "vitality" and "resonance" in every speech. Why? Because the observation literally said:

```
Environment: vitality: 0.55, resonance: 0.20, warmth: 0.50
```

The LLM echoed what it saw. We were showing raw metric names and expecting natural language in return. An observer of the thesis doesn't want to hear "the environment's vitality is 0.55" — they want "this place feels alive."

### Tweet M8-4 — The Fix: Sensation Not Data

Replaced raw signal pass-through with experiential descriptions:

Before: `Environment: vitality: 0.55, resonance: 0.20, warmth: 0.50, abundance: 0.50`

After: `Environment: There is a healthy energy here, things feel vibrant. The atmosphere is quiet and still. The air feels neutral — neither warm nor cold. Things seem adequate — enough, but nothing more.`

The agent never sees the word "vitality." It experiences what vitality *feels like*. The same approach we use for internal state — sensation, not instruction.

```js
if (v >= 0.8) parts.push('This place feels alive — buzzing with energy.')
else if (v >= 0.6) parts.push('There is a healthy energy here, things feel vibrant.')
else if (v >= 0.45) parts.push('The energy here feels ordinary — nothing special.')
else if (v >= 0.3) parts.push('The energy feels low, like this place is fading.')
else parts.push('This place feels drained, almost lifeless.')
```

### Tweet M8-5 — Killing the Analysis Voice

The agent spoke like a research paper: "I'm observing the environment's state has shifted" / "I'm noticing a connection between X's influence on vitality and resonance."

Two fixes:
1. Removed raw valence/arousal numbers from the prompt. Agent sees "A comfortable focus — present and attentive" not "valence: 0.22, arousal: 0.32"
2. Updated speech rules: "Say something SHORT, FRESH, and in your own voice — react to what you feel and see, don't analyze or explain"

We want "something's different here" not "I'm observing a shift in the environment's parameters."

### Tweet M8-6 — v0.3.5 Scorecard

5 changes in v0.3.5:
1. ✅ Cloud model upgrade: llama-3.1-8b → llama-3.3-70b-versatile
2. ✅ Local fallback upgrade: qwen2.5:3b → qwen3:4b
3. ✅ Signal descriptions: raw metrics → felt experience
4. ✅ Internal state: removed raw valence/arousal numbers from prompt
5. ✅ Speech rules: short, fresh, experiential — no analysis voice

The thesis insight: if you show data to an LLM, it will talk about data. If you show sensation, it will talk about experience. The medium shapes the message.

### Milestone 9 — v0.3.5 Soak Test: Zero Hallucinations, Natural Speech (2026-03-15)

Second test on the 70B model, now with signal translation and speech overhaul. The best results we've ever recorded. 🧵

### Tweet M9-1 — The Perfect Score

45 minutes, 167 ticks, 3 sleep cycles. **Zero hallucinations.** Not "almost zero" — literally zero. No speech referencing absent objects. No interactions with ghosts. First completely clean test in the project's history.

The empty world phase — historically our worst — produced zero false references for the 4th consecutive test. The combination of 70B model + memory/hallucination prompt distinction + GONE warnings + signal translation has eliminated the problem.

### Tweet M9-2 — Speech Transformation

Before (v0.3.4, 8B model):
> "I'm observing the environment's vitality and resonance"
> "The pillar's influence on the environment's state is notable"

After (v0.3.5, 70B + signal translation):
> "Something feels off about this place"
> "The chill in the air is unsettling"
> "This place feels drained"
> "The emptiness is suffocating"
> "What did you find?"

The agent stopped being a research analyst and started being a *being*. No mention of "vitality" or "resonance" in any speech. The signal translation worked — when you remove the vocabulary of metrics, only experience remains.

### Tweet M9-3 — Action Distribution Holds

| Action | v0.3.4 (70B) | v0.3.5 (70B) |
|--------|---------------|---------------|
| move_to | 42% | 45.5% |
| interact | 30% | **29.9%** |
| speak | 21% | 19.8% |
| wait | 6.5% | 4.8% |

Interact held steady at ~30% — double what the 8B model achieved. The 70B model's curiosity is consistent. Speech dropped slightly, which is good — the agent speaks when it has something to say, not to narrate its own actions.

### Tweet M9-4 — The Remaining Edge

Not perfect yet. Two patterns survived:
- "Vibrancy is palpable here" appeared twice across 167 ticks
- "Something feels off" appeared in two similar constructions

The RepetitionGuard catches exact and fuzzy repeats, but near-misses slip through. This isn't a filter problem — it's a *training* problem. The agent repeats because nothing in its world makes repetition feel wrong.

### Tweet M9-5 — The Idea: Train Creativity, Don't Just Filter It

Current approach: detect repetition → warn the LLM → hope it listens. This is reactive.

What if repetition had *consequences*? What if the agent's world got duller when it repeated itself, and more vibrant when it said something new?

The concept: feed speech uniqueness back into the environment signals. Repetitive speech → vitality drops → the agent feels worse → it's motivated to try something different. Creative speech → vitality boost → positive reinforcement.

Not filtering. Not warning. *Teaching.* The agent learns creativity because creativity feels good and repetition feels bad. Emergent behaviour through sensation, not instruction.

This is the same thesis principle we've been applying everywhere: show the agent what it feels, not what to do. If we can make repetition literally feel like the world is dying, the agent will avoid it on its own.

### Tweet M9-6 — v0.3.5 Final Scorecard

Test results (45 min, 167 ticks):
- ✅ Hallucinations: **0** (first ever clean test)
- ✅ Speech quality: natural, experiential, no metric parroting
- ✅ Action mix: balanced (interact 30%, not just wandering)
- ✅ Emotional tracking: 7+ distinct states across phases
- ⚠️ Speech repetition: rare but present — next target

The foundation is now solid enough to start building *up* instead of fixing *down*. Next: creativity as felt experience.

### Milestone 10 — v0.3.6: Teaching Creativity Through Sensation (2026-03-15)

The agent's speech is natural now, but it still occasionally repeats itself. The question: can we *train* creativity instead of just filtering repetition? 🧵

### Tweet M10-1 — The Problem With Filters

Current approach to repetition: detect it → warn the LLM → hope it listens.

This is a prompt-level fix. The weakest tool we have. The agent has no *reason* to be creative — no consequence for repeating, no reward for novelty. It's like telling someone "don't be boring" without them ever experiencing what boring feels like.

### Tweet M10-2 — The Thesis Principle

Every successful fix in this project follows the same pattern: **sensation, not instruction.**

- Signal parroting? Don't tell the agent "stop saying vitality." Remove the word from its perception. It can't parrot what it can't see.
- Hallucination? Don't tell the agent "don't mention absent objects." Make them disappear from its reality. It can't hallucinate what isn't there.
- Emotional flatline? Don't tell the agent "feel things." Give successful actions a mild positive valence. It feels good because doing well *is* good.

So why are we still *telling* the agent not to repeat itself? We should make repetition *feel* bad.

### Tweet M10-3 — The Design

After every speech action, we score its creativity: how different is this from recent speech? Keyword extraction, overlap comparison against the last 10 utterances.

Score 0.0 = exact repeat. Score 1.0 = completely novel.

Then we feed it back through the only channel the agent trusts: its feelings.

```js
applySpeechCreativity(score) {
    if (score < 0.4) {
        // Repetitive — world feels duller
        this._nudgeValence(-0.08)
    } else if (score > 0.8) {
        // Creative — mild reward
        this._nudgeValence(0.03)
    }
}
```

The agent never sees the score. It never knows *why* the world feels different. It just notices that when it says the same thing twice, everything gets a little worse.

### Tweet M10-4 — Asymmetric By Design

The penalty (-0.08) is stronger than the reward (+0.03). Same negativity bias we use for action results. This is deliberate:

- **Punishment breaks loops.** When the agent repeats itself, valence drops sharply. The next tick's emotional description shifts — "a subtle unease" replaces "feeling steady." The agent is more likely to try something different.
- **Reward sustains.** Creative speech gets a gentle boost. Not enough to create artificial highs, just enough to keep the needle slightly positive. The absence of punishment is itself the reward.

The penalty decays naturally via the existing valence decay rate. No doom spirals — the agent always has a path back to neutral.

### Tweet M10-5 — The Invisible Teacher

The scoring happens BEFORE the speech is recorded. Critical detail — if we scored after recording, the message would compare against itself and always score 0.0.

The flow:
1. Agent speaks
2. We score the speech against the previous 10 utterances
3. We nudge valence (agent doesn't know)
4. We record the speech in history
5. Next tick: the agent feels different and makes a different choice

The creativity score is emitted in the tick event for observability, but it never touches the prompt. The agent is being taught through pure sensation.

### Tweet M10-6 — v0.3.6 Scorecard

3 changes:
1. ✅ `RepetitionGuard.scoreSpeech()` — keyword-based creativity scoring (0.0-1.0)
2. ✅ `InternalState.applySpeechCreativity()` — valence feedback (penalty -0.08 / reward +0.03)
3. ✅ Creativity score emitted in tick events for soak test analysis

This is the first time we're using the agent's emotional system not just to *reflect* the environment, but to *shape behaviour*. The environment teaches the agent how to feel. Now we're teaching it how to speak — through feeling.

If this works, the same principle applies to everything: spatial exploration (reward novelty, punish pacing), social interaction (reward engagement, punish ignoring), even memory formation (reward learning, punish rumination). All through sensation. All invisible.

### Milestone 11 — v0.3.7: Deployment Readiness (2026-03-15)

The cognitive pipeline is done. Now: will it survive weeks without human intervention? Cleared the entire stability backlog in one session. 🧵

### Tweet M11-1 — The 429 Time Bomb

Groq's free tier has rate limits. At 15 req/min during high arousal, the agent could exhaust its quota in 4 minutes. Previous behaviour: generic error → fall through to Ollama → Ollama also fails on Pi if not running → agent goes silent.

Fix: detect 429 specifically, enter 60-second cooldown, auto-route to local Ollama during cooldown. The agent keeps thinking — just slower. When cooldown expires, cloud resumes automatically.

### Tweet M11-2 — The 5-Second Hang

When the WebSocket disconnected mid-request, pending observe/action promises were never rejected. The tick hung for 5 seconds waiting for a timeout that shouldn't have been necessary.

Fix: reject pending promises immediately in the close handler. The tick fails fast, the reconnect logic kicks in, and the next tick proceeds normally. 5 seconds of dead time per disconnect → 0.

### Tweet M11-3 — The Midnight Bug

Daily log entries buffered at 23:59:59 would flush at 00:00:01 — into tomorrow's file. The timestamp said yesterday but the file said today.

Fix: tag each buffer entry with its target filename at creation time. When flush groups entries by file, midnight-boundary entries go to the correct day's log.

### Tweet M11-4 — The Amnesia Bug

Every restart: `tickCount = 0`. The agent has been running for 6 hours and 2000 ticks, crashes, restarts — and thinks it just woke up. Time awareness broken.

Fix: tickCount now persists in the state checkpoint alongside valence/arousal. On restart, restored from the last checkpoint. The agent picks up at tick 2001, not tick 0.

### Tweet M11-5 — The Cache

System prompt reads memory.md, skills.md, and tools.md every tick. At 8-second intervals: 10,800 file reads per day for content that changes maybe 10 times.

Fix: read cache in MemoryFiles with write-through invalidation. Reads return cached content. Writes (including appendToMemory, consolidation, backup restore) update or invalidate the cache. File reads drop from 10,800/day to ~30.

### Tweet M11-6 — v0.3.7 Scorecard

8 fixes shipped:
1. ✅ 429 rate limit: 60s cooldown + Ollama fallback
2. ✅ Ollama re-check: every 5 min if initially down
3. ✅ Promise leak: immediate reject on disconnect
4. ✅ Day boundary: entries tagged at creation time
5. ✅ Tick counter: persisted in checkpoint
6. ✅ Sleep rate limit: 5s delay between consolidation LLM calls
7. ✅ Prompt caching: write-through read cache
8. ✅ DeltaDetector: tracks property mutations on existing objects

Only one backlog item remains: process watchdog (systemd service). Everything else is fixed. The agent is ready for long-duration deployment.

### Milestone 12 — 6-Hour Endurance Test: Launch Day (2026-03-15)

Kicking off the first long-duration soak test on v0.3.7. Everything from the last 11 milestones tested at once. 🧵

### Tweet M12-1 — The Launch

Kicking off a 6-hour soak test on our autonomous agent runtime.

One agent. One Raspberry Pi. 2,700+ expected ticks. Zero human intervention.

Everything we've built over the last 11 versions comes down to this.

### Tweet M12-2 — The Journey

In the last 48 hours we went from v0.3 to v0.3.7. Eleven milestones. Here's the arc:

- v0.3.0: Can it survive months? (stability overhaul)
- v0.3.1: Can it survive *correctly*? (memory corruption, persona drift)
- v0.3.3: Can it feel? (valence flatline → asymmetric rewards)
- v0.3.5: Can it stop parroting metrics? (sensation not data)
- v0.3.6: Can it learn creativity? (valence punishment for repetition)
- v0.3.7: Can it run unattended? (rate limits, promise leaks, caching)

Each version answered one question. The 6-hour test asks them all at once.

### Tweet M12-3 — What We're Watching

Key metrics for the run:
- **Hallucinations**: Should be 0. Been clean for 4 consecutive tests
- **Speech creativity**: New in v0.3.6 — the agent gets punished through valence for repeating itself. First long-duration test of this system
- **Rate limits**: Groq 429 handling + Ollama fallback, first real stress test
- **Memory consolidation**: Multiple sleep cycles merging and pruning memory
- **Emotional range**: Does valence stay dynamic over 6 hours, or flatline again?

### Tweet M12-4 — The Thesis Test

The core thesis: **sensation, not instruction.**

Don't tell the agent what to do. Let it feel the consequences.

- Repetition → valence drops → world feels duller
- Creativity → mild reward → world stays vibrant
- Success → positive nudge → doing things well feels good
- Failure → sharp penalty → mistakes sting

The agent never sees any of these scores. It only feels the shift.

6 hours will tell us if invisible teaching actually produces behavioural change at scale — or if the agent just learns to feel bad while repeating itself anyway.

### Tweet M12-5 — The Setup

Running on:
- Groq cloud (llama-3.3-70b-versatile) with local Ollama fallback
- 13-phase environmental cycle with object persistence gauntlet
- 6 unique objects that appear, vanish, and return
- Stress phases, calm phases, empty world, synth mode
- Sleep cycle every ~15 min (compressed for testing)

Results when it's done. If it crashes at hour 4, that's a result too.

### Milestone 13 — v0.3.8: Tiered Model Routing (2026-03-15)

Running 70B on every tick is like hiring a surgeon to put on a plaster. Most ticks are boring — nothing changed, nobody spoke, the agent's just wandering. Time to get smart about cost. 🧵

### Tweet M13-1 — The Cost Problem

70B cloud: ~$0.0014/request. 8B cloud: ~$0.0001/request. Local Ollama: $0.

At 10,800 ticks/day, all-70B costs ~$15/day ($441/month). For an agent running on a Raspberry Pi, that's not sustainable.

But not every tick deserves a 70B brain. Most are "nothing happened, move somewhere." The question: which ticks actually matter?

### Tweet M13-2 — Three Tiers

Every tick is now classified before the LLM is called:

**Skip** ($0): Zero deltas, no speech, no action feedback. The FallbackBrain picks a safe action. No LLM needed. The agent still acts — it just doesn't think hard about it.

**Fast** (free/cheap): Routine exploration, minor signal changes. Ollama on the Pi (free) first, 8B cloud as fallback. Good enough for "move to that spot."

**Quality** (70B): Objects appeared/disappeared. Someone spoke. High arousal. Repetition warnings. Hallucination risk window. The moments that actually shape behaviour.

### Tweet M13-3 — The Classifier

```js
_classifyTick(deltas, worldEvents, context) {
    if (worldEvents.length > 0) return 'quality'
    if (deltas.some(d => d.type === 'appeared'
        || d.type === 'disappeared')) return 'quality'
    if (context.recentlyDisappeared?.length > 0) return 'quality'
    if (Math.abs(context.internalState?.arousal) > 0.5) return 'quality'
    if (context.repetitionWarnings?.length > 0) return 'quality'
    if (deltas.length === 0 && !context.lastActionResult?.message)
        return 'skip'
    return 'fast'
}
```

Simple. Observable. Tunable. The tier is logged on every tick and emitted in SSE events.

### Tweet M13-4 — Projected Savings

Estimated split for a typical day (10,800 ticks):
- Skip: ~25% → 2,700 × $0 = $0
- Fast: ~45% → 4,860 × $0.0001 = $0.49
- Quality: ~30% → 3,240 × $0.0014 = $4.54

**Total: ~$5/day ($150/month) vs $441/month pure 70B. ~65% cost reduction.**

And that's conservative — in a quiet world with no other agents, skip/fast could handle 80%+ of ticks. In a busy multi-agent world, quality tier gets used more. The cost scales with complexity, not with time.

### Tweet M13-5 — The Pi Advantage

The local Ollama model (qwen3:4b) is slow on the Pi — 5-8 seconds per generation. But for fast-tier ticks, the heartbeat is already at 15 seconds (low arousal = slow heartbeat). The generation time fits inside the interval. And it's completely free.

The tiered routing inverts the priority: quality tier goes cloud-first (speed matters when things are happening), fast tier goes local-first (cost matters when nothing is).

### Tweet M13-6 — v0.3.8 Scorecard

4 changes:
1. ✅ Tick classifier: skip/fast/quality routing based on tick complexity
2. ✅ LLMClient: tier-aware generation (Ollama-first for fast, 70B-first for quality)
3. ✅ Tier counts in /metrics endpoint for cost observability
4. ✅ Config: CLOUD_MODEL_FAST env var (default: llama-3.1-8b-instant)

The agent thinks as hard as the moment requires. Quiet moments get quiet brains. Important moments get the full model. Cost scales with complexity, not with uptime.

### Milestone 14 — 6-Hour Endurance Test Results (2026-03-15)

6 hours. 1,446 ticks. 23 sleep cycles. 3 complete phase rotations. Here's what happened. 🧵

### Tweet M14-1 — Zero Hallucinations (Again)

5th consecutive clean test. Not a single reference to an absent object across 1,446 ticks and 389 speeches. Objects appeared, disappeared, and returned across 3 full rotations — the agent tracked them all correctly.

The combination of ground truth labels, 30-tick GONE warnings, and the memory/hallucination distinction in the prompt has completely solved this problem. It's done.

### Tweet M14-2 — The Emotional System at Scale

Valence tracked environment perfectly for 6 straight hours:

| Phase | Valence | Arousal | Felt |
|-------|---------|---------|------|
| Flourishing | +0.436 | 0.258 | "A surge of energy and satisfaction" |
| New arrivals | +0.222 | 0.319 | "A comfortable focus" |
| Empty world | -0.246 | 0.066 | "A growing frustration" |
| Stress | -0.236 | 0.574 | "Something feels wrong — uneasy, on edge" |

7+ distinct emotional descriptions. Heartbeat: 8.7s during stress, 14.2s during calm. The pattern repeated consistently across all 3 cycles with no drift or flatline. The emotional system is production-ready.

### Tweet M14-3 — Action Distribution Evolution

| Action | v0.3.3 (8hr) | v0.3.5 (45m) | **v0.3.7 (6hr)** |
|--------|--------------|--------------|-------------------|
| move_to | 53% | 45.5% | **36.4%** |
| interact | 12% | 29.9% | **25.3%** |
| speak | 21% | 19.8% | **26.9%** |
| wait | 5% | 4.8% | **4.5%** |

move_to at its lowest ever. The agent spends less time wandering, more time engaging. interact held strong at 25% — double what the 8B model ever achieved. Synth mode: 100% synth actions, zero speech. The agent knows what context it's in.

### Tweet M14-4 — The Speech Problem

26.9% speech rate, up from 19.8%. More concerning: the same phrases across 6 hours.

"This emptiness is unsettling" — ticks 116, 122, 176, 375
"Time to break the cycle" — ticks 238, 249, 256
"Scout, what do you sense/think about..." — same question structure, over and over

The v0.3.6 creativity scoring catches local repetition (20-speech buffer), but phrases repeated 250 ticks apart are invisible. The agent has no long-term memory of what it's said.

This isn't a filter problem. It's a vocabulary problem — an 8B/70B model with a short context window gravitates toward the same constructions. The creativity penalty makes it feel bad locally, but with no persistent speech memory, the same phrases re-emerge every cycle.

### Tweet M14-5 — The Cost Baseline

The 6-hour run cost **$2.10** — all ticks on llama-3.3-70b-versatile.

$2.10 / 1,446 ticks = $0.00145/tick
At production rates: ~$15.66/day → $470/month

This is the baseline. v0.3.8 (tiered routing) should cut this by 50-65%. Running a 9-hour overnight test next to measure the difference.

### Tweet M14-6 — 23 Sleep Cycles, Zero Failures

Every sleep cycle completed all passes: dedup → consolidation → skills → self-reflection → GC → clear. Memory stayed lean: 8 entries in, 8 entries out. The consolidation system is pruning as fast as it's learning.

Skills stayed at 0 — the strict "ONLY extract from log evidence" constraint means no hallucinated skill trees. Better zero than fiction.

### Tweet M14-7 — Verdict

The runtime is production-ready for continuous deployment:
- ✅ Zero hallucinations (5 consecutive tests)
- ✅ Emotional system stable and responsive over 6 hours
- ✅ 23 sleep cycles, zero failures
- ✅ Memory consolidation keeping files lean
- ✅ No crashes, no disconnects, no unrecoverable errors

Remaining work: cost optimization (v0.3.8 tiered routing, testing next) and speech variety at scale. The foundation is done. Time to run it for real.

### Milestone 15 — 9-Hour Overnight Test: Tiered Routing Results (2026-03-16)

First test of v0.3.8's tiered model routing. 9 hours overnight. The good: cost per hour dropped 26%. The bad: Ollama on the Pi was too slow and halved the tick rate. 🧵

### Tweet M15-1 — The Cost Comparison

| Metric | v0.3.7 (6hr, all-70B) | **v0.3.8 (9hr, tiered)** |
|--------|------------------------|--------------------------|
| Duration | 6 hours | **9 hours** |
| Cost | $2.10 | **$2.30** |
| Cost/hour | $0.35/hr | **$0.26/hr** |
| Ticks | 1,446 | **1,002** |
| Sleep cycles | 23 | **32** |

26% cheaper per hour. But only 1,002 ticks in 9 hours vs 1,446 in 6. The agent was thinking less often, not just thinking cheaper.

### Tweet M15-2 — The Ollama Bottleneck

The fast tier was designed to route to Ollama on the Pi (free) before falling back to 8B cloud (cheap). Problem: qwen3:4b on the Pi takes 8-12 seconds per generation.

With a heartbeat interval of 10-15s, the model generation time exceeds the tick window. The `_ticking` guard prevents overlap — so the next scheduled tick gets skipped. Effectively halving throughput during calm periods.

The math: 1,002 ticks / (9 hrs - 1.6 hrs sleeping) = ~136 ticks/hour. The v0.3.7 baseline: ~241 ticks/hour. Ollama was eating 44% of our ticks.

### Tweet M15-3 — The Fix

Swap the fast tier priority: 8B cloud first (fast, $0.0001/call), Ollama only as fallback when cloud is down.

The Pi model becomes emergency backup, not default. Cloud 8B responds in ~200ms vs ~10s for local Ollama. No more tick skipping. Cost increase is negligible — the savings come from NOT using 70B, not from using Ollama vs 8B.

### Tweet M15-4 — Sleep Cycle Overhead

32 sleep cycles in 9 hours. Each sleep runs 4 consolidation passes on 70B: memory, skills, self-reflection, GC. That's 128 quality-tier LLM calls just for sleeping — more than the cost of routine ticks.

Testing with 12 minutes active / 3 minutes sleep was too aggressive. Each consolidation only had 12 minutes of data to work with — barely enough for meaningful memory formation.

Fix: longer active periods, longer but less frequent sleep. 30 min active / 10 min sleep → ~13 cycles per 9 hours instead of 32. Richer data per consolidation, 60% fewer 70B consolidation calls.

### Tweet M15-5 — What Held Up

Despite the throughput issue, the runtime was solid:
- 9 hours, zero crashes, 32 sleep cycles all completed
- Emotional system stable across 5 full phase rotations
- Speech rate dropped to 21.1% (healthier than v0.3.7's 26.9%)
- Memory: 8 → 9 entries (lean consolidation working)

2 hallucinations at a single tick (sleep/synth boundary) — a minor regression worth investigating.

### Tweet M15-6 — Lessons

Three things learned from this test:

1. **Local model as primary was wrong.** The Pi isn't fast enough for routine use. Cloud 8B is 50× faster and costs almost nothing. Save the Pi model for when the internet goes down.

2. **Sleep frequency matters for cost.** 32 consolidation cycles × 4 LLM calls = 128 quality-tier calls. That's more than routine ticks cost. Less frequent, richer sleep saves money and produces better memories.

3. **The soak test overstates quality-tier usage.** Constant phase changes mean constant deltas, pushing most ticks to 70B. A real deployment with a stable world would see much more skip/fast usage. The 26% hourly savings is a floor, not a ceiling.

Next: rerun with 8B cloud as fast-tier primary and longer sleep cycles. The projected savings should be much closer to the 65% target.

---

## Milestone 16: Quiet Hours & JSON Resilience (v0.3.9)

### Tweet M16-1 — Quiet Hours

Running an autonomous agent 24/7 is expensive. But your viewers aren't watching 24/7.

v0.3.9 adds **quiet hours** — time-zone-aware sleep scheduling that throttles activity during low-viewership windows.

```
# Peak hours: 50 min active, 10 min sleep
ACTIVE_HOURS_BEFORE_SLEEP=0.83
SLEEP_DURATION_MINUTES=10

# Quiet hours: 15 min active, 30 min sleep
QUIET_HOURS=02:00-10:00
QUIET_ACTIVE_MINUTES=15
QUIET_SLEEP_MINUTES=30
```

During quiet hours the agent naps more and acts less. During peak hours it's almost always awake. One env var switches the whole schedule.

### Tweet M16-2 — The Math

Peak hours (18h): 50 min active / 10 min sleep per hour → ~54 LLM ticks/hr
Quiet hours (6h): 15 min active / 30 min sleep per hour → ~20 LLM ticks/hr

That's roughly 40% fewer LLM calls during the quiet window. Plus fewer consolidation cycles = fewer 70B calls.

Projected daily cost: ~$4.50 → ~$3.50. Small savings add up over weeks.

### Tweet M16-3 — JSON Resilience

Small but annoying bug: the 8B model occasionally returns slightly malformed JSON during self-reflection. Trailing commas, stray comments — valid-ish but not valid JSON.

```
WARN: Self-reflection parse error: Expected ',' or '}'
after property value in JSON at position 438
```

Fix: a tiny `sanitizeJson()` utility that strips trailing commas and line comments before `JSON.parse`. Applied to both Think (tick decisions) and SleepCycle (self-reflection).

Three lines of regex, zero more skipped reflections.

### Tweet M16-4 — Design Philosophy

The quiet hours feature captures something important about this project: the agent should have a natural rhythm.

Humans don't operate at 100% all day. Neither should an autonomous agent. Quiet hours aren't just cost optimization — they're the agent resting when nobody's watching and being present when they are.

Peak hours, quiet hours, sleep cycles, arousal-driven heartbeat — every layer of this system breathes.

---

## Milestone 17: 9-Hour Soak Test — v0.3.8.1 Results

### Tweet M17-1 — The Numbers

Best soak test yet. 9 hours, v0.3.8.1 (8B cloud as fast tier, 30 min active / 10 min sleep):

```
Ticks:          2,048 (228/hr)
Sleep cycles:   13
Hallucinations: 0
Phase cycles:   5 complete
Speech rate:    28.8%
Cost:           $2.30 ($0.26/hr)
```

Compare to v0.3.8 (Ollama as fast tier, 12 min active / 3 min sleep):

```
Ticks:          1,002 (111/hr)
Sleep cycles:   32
Hallucinations: 2
Phase cycles:   2
Cost:           $2.30 ($0.26/hr)
```

Same hourly cost. Double the ticks. Zero hallucinations. The swap from Ollama to 8B cloud didn't save money per hour — it doubled what we get for the same money.

### Tweet M17-2 — Cost Per Tick

The real metric isn't $/hour — it's $/tick.

v0.3.7: $2.10 / 1,446 = $0.00145/tick (all 70B)
v0.3.8: $2.30 / 1,002 = $0.00230/tick (Ollama bottleneck)
v0.3.8.1: $2.30 / 2,048 = $0.00112/tick

v0.3.8.1 is the cheapest per tick we've ever run. The tiered routing is paying off — quality-tier only fires when it matters, fast-tier handles the routine, and fewer sleep cycles mean fewer consolidation costs.

### Tweet M17-3 — Emotional Stability

5 full phase rotations. The emotional system is rock solid:

- Environmental stress → negative valence, high arousal every time
- Flourishing → positive valence, "surge of energy and satisfaction"
- Empty world → unease, low arousal
- Recovery → returns to comfortable focus

Same emotional arc, 5 times in a row. No drift, no flatline. The agent *feels* its environment consistently.

### Tweet M17-4 — The Remaining Problem

Speech repetition. "The stillness is captivating" appears in 5+ phases across every cycle. The 20-entry working memory gets wiped every sleep cycle, so the agent forgets what it said.

This isn't a bug in the filter — it's a vocabulary/memory problem. The agent needs to remember its own words across sleep boundaries. That's the next challenge.

## Milestone 18: v0.3.10 — Quiet Hours, SpeechLog & Stability Hardening

### Tweet M18-1 — The Overnight Run

v0.3.10 ran 9 hours overnight. Three big changes: quiet hours scheduling, persistent SpeechLog (speech survives sleep), and a full stability audit (WebSocket leak fix, Ollama timeout fix, double-shutdown guard).

```
Ticks:          1,702 (189/hr)
Sleep cycles:   10
Hallucinations: 1 (0.06%)
Cost:           $2.02 ($0.22/hr)
Total Groq:     $10.01
```

15% cheaper per hour than v0.3.8.1. Same $/tick. The savings came from quiet hours — the agent sleeps more when nobody's watching.

### Tweet M18-2 — Quiet Hours In Action

Time-zone-aware sleep scheduling. Peak hours: 50 min active / 10 min sleep. Quiet hours: 15 min active / 30 min sleep.

The overnight logs show the exact transition:

```
21:59  sleep 10 min  ← normal
22:59  sleep 10 min  ← normal
23:59  sleep 10 min  ← normal
01:25  sleep 30 min  ← quiet hours kicked in
02:10  sleep 30 min
02:55  sleep 30 min
03:41  sleep 30 min
04:26  sleep 30 min
05:46  sleep 10 min  ← back to normal
```

No code told the agent to "be less active". The scheduling layer just gives it more sleep. The agent wakes up, explores for 15 minutes, and goes back to sleep. Naturally.

### Tweet M18-3 — SpeechLog: Persistent Memory for Speech

The speech repetition problem from v0.3.8.1: working memory wipes on sleep, so the agent says "the stillness is captivating" every cycle.

Fix: a persistent ring buffer (50 entries) that survives sleep. Last 15 speeches injected into the prompt as "YOUR RECENT SPEECHES — do NOT repeat these."

Result: speech rate dropped 28.8% → 26.4%. But the 8B model still falls back on the same structures — "The [noun] is [adjective]". The prompt tells it not to repeat; it paraphrases instead. This is an inherent 8B vocabulary limitation, not a code problem. The real fix is a richer environment — give the agent something to actually talk *about*.

### Tweet M18-4 — Stability Audit

Went through the entire codebase before this run. Found and fixed:

- **WebSocket reconnect leak**: old listeners accumulated on every reconnect. `removeAllListeners()` before creating new connection.
- **Ollama timeout deadlock**: AbortController wasn't actually aborting. Replaced with `Promise.race`.
- **Double-shutdown corruption**: Ctrl+C twice caused concurrent disk flush. Added `shuttingDown` guard.
- **Fire-and-forget tick crash**: unhandled rejection in `_scheduleNext()`. Added `.catch()`.

Result: clean 9-hour run. Zero crashes, zero disconnects, all 10 sleep cycles completed. This runtime is production-stable.

### Tweet M18-5 — Cost Trajectory

```
v0.3.7   $2.10  (6hr, all-70B)     $0.35/hr
v0.3.8   $2.30  (9hr, Ollama)      $0.26/hr
v0.3.8.1 $2.30  (9hr, 8B cloud)    $0.26/hr
v0.3.10  $2.02  (9hr, quiet hours) $0.22/hr
```

$0.22/hr = $5.28/day = ~$160/month for a 24/7 autonomous agent. And that's before any further optimization.

The agent runtime is stable, cheap, and environment-agnostic. It's ready for a real world. Next step: plug it into the 3D environment.

## Milestone 19: Environment Protocol Standard (v0.4)

### Tweet M19-1 — The Blindness Bug

We put Victor in the 3D world. He inspected every shiny object he could find — obsessively, endlessly. Never ate. Never rested. Never socialised properly.

Soak tests worked perfectly. What was different?

The sim-server sends `self.needs.hunger = {level: 70, urgency: "strong"}`. Perceive.js had this line:

```js
if (typeof val === 'object' && val !== null) continue  // 💀
```

Victor was literally blind to his own needs. Every nested object — needs, wellbeing, mood — silently discarded. No wonder he never ate. He couldn't feel hunger.

### Tweet M19-2 — The Signal Mismatch

It got worse. The sim-server sends `world: {vitality: 70, resonance: 50}` (0-100 scale). Agent-runtime expects `signals: {vitality: 0.7}` (0-1 scale).

Victor's InternalState never received a single environment signal. His emotional state was completely disconnected from the world around him.

And the PromptBuilder was telling him "if someone speaks to you, respond" — but the sim-server has `socialise`, not `speak`. He was getting instructions for capabilities he didn't have.

Three structural mismatches, all invisible from the soak test because the test-server used a different format.

### Tweet M19-3 — The Fix

Seven changes across both repos:

1. **Perceive.js** — recursive `_narrateValue()` handles nested objects naturally. `{level: 70, urgency: "strong"}` → "My hunger: strong (70%)"
2. **Heartbeat.js** — `_normalizeSignals()` auto-detects 0-100 scale and normalizes to 0-1
3. **PromptBuilder.js** — rules are now action-aware. Socialise rules only if `socialise` exists. Speech rules only if `speak` exists
4. **Think.js** — threads `available_actions` to the prompt builder
5. **FallbackBrain.js** — respects whatever actions the environment offers instead of hardcoding
6. **AgentBridge.js** (sim-server) — sends `signals` in 0-1 range instead of `world` in 0-100

All backwards compatible — existing test-suite still passes.

### Tweet M19-4 — The Protocol

The real win: we defined a standard. `docs/ENVIRONMENT_PROTOCOL.md` — the contract any environment must implement to host an agent.

```
WELCOME → IDENTIFY → IDENTIFIED → [OBSERVE/ACT loop] + WORLD_EVENTs
```

Same observation shape everywhere: `self`, `nearbyAgents`, `nearbyObjects`, `available_actions`, `signals`, `recentSpeech`.

A 3D bird world and a hardware synth bridge use the exact same protocol. Perceive.js narrates whatever it finds — no environment-specific code needed.

```json
// 3D world
{"self": {"needs": {"hunger": {"level": 70, "urgency": "strong"}}}}

// Synth bridge
{"self": {"currentPatch": "warm_pad", "filterCutoff": 0.6}}
```

Both work. One agent runtime, infinite environments.
