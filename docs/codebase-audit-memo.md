# 3aiii Codebase Audit Memo

Author: Sam Skirrow
Date: 2026-05-12
Branch audited: `main` at commit `09975a7`
Scope: 3aiii only. DegenBox items are covered in a separate audit memo.

---

## 1. Executive summary

This memo documents the result of a self-audit of the 3aiii codebase against
the patent-relevant components called out in the buyer's diligence package.

The four 3aiii items audited:

1. Anti-fixation / repetition guard
2. Sleep-cycle four-pass consolidation
3. Persona drift guard
4. Hardware-grounded loops / environment-agnostic protocol

All four are present and active in the production code path. None are
"reduced to practice but disabled" (the situation that applies to the
time-weighted reward mechanism on the DegenBox side). One of the four
(the persona drift guard) is structurally novel as far as I can find in
the public agent-framework literature; the other three are present and
well-implemented, but their patentability depends on the specific framing
of the claim against existing prior art.

The audit was conducted by the operator (Sam Skirrow) against the actual
codebase prior to sharing materials with the buyer. No buyer pressure or
direction shaped any finding here. The honest read on each item, including
the parts that need narrow framing, is in section 4.

---

## 2. Methodology

The audit was conducted by walking the codebase module by module against
the four items listed above. For each item:

- Files and line ranges containing the implementation were identified
- The first-commit date for each module was pulled from git history
  (`git log --diff-filter=A --follow --format=...`)
- The implementation was compared against the documented behaviour in
  `3aiii-overview.md`, `progress-2026-03-14-15.md`, and
  the STATUS files
- Closest public prior art known to the operator was named, with the
  caveat that no external prior-art search was conducted and no patent
  counsel review has happened

**Limits of self-audit:**

- No prior-art search beyond what the operator already knew (OHMAR for
  anti-fixation, MemGPT/Letta for memory consolidation)
- No patent counsel review of claim language. The "claim shape" given
  for each item below is structural, not legal
- One claim relies on external deployments existing as documented (the
  Ibiza Botanical Gardens installation, kiwiexe.com integration). The
  operator has not produced or verified standalone evidence of either
  in this session

---

## 3. Item-by-item findings

### Item 1 — Anti-fixation / repetition guard

**Status:** Present, active in the production code path.

**Evidence:**

- `src/cognition/RepetitionGuard.js`, 354 lines, first commit `1dc835c`
  on 2026-03-14 (introduced with the v0.2 cognitive redesign)
- Six independent detection patterns inside `check()`
  ([RepetitionGuard.js:60-180](../src/cognition/RepetitionGuard.js)):
  - Consecutive identical action (≥3 in a row)
  - Single-action dominance (>60% of recent history)
  - Action+target combo dominance (>30% of recent history, env-agnostic)
  - Target in 3-of-last-5 actions (catches spread-out fixation)
  - Exact action+params duplicate (≥3 in last 5)
  - Alternating cycle detection (A→B→A→B or A→B→C→A→B→C patterns)
  - Plus speech-specific: exact repeat, fuzzy keyword overlap, generic-
    opening detection
- Warnings inject into the next prompt as a natural-language constraint at
  [PromptBuilder.js:132-134](../src/llm/PromptBuilder.js). The constraint
  enters the agent's cognition, not the output stream
- Hard-block fallback at [Heartbeat.js:191-202](../src/loop/Heartbeat.js):
  `isFixated()` → forced `move_to wander` when a combo dominates the
  recent window. This is enforced in code, not in the prompt, so it can't
  be overridden by the LLM
- Creativity-as-felt-sensation feedback at
  [RepetitionGuard.js:185-207](../src/cognition/RepetitionGuard.js) →
  [InternalState.applySpeechCreativity](../src/cognition/InternalState.js).
  Repetitive speech costs mood; novel speech gives a small mood reward.
  The agent never sees the score, only the resulting affective shift

**Claim shape (structural):**

A method for preventing autonomous-agent fixation, comprising:
maintaining a bounded history of agent actions; detecting a plurality of
fixation patterns including consecutive repetition, single-action
dominance, action-plus-target combination dominance, target-level cycling,
and alternating cycles; on detection, injecting a natural-language
constraint into the agent's next decision prompt rather than filtering
the agent's output; and additionally feeding a creativity score derived
from speech-keyword overlap back into the agent's internal affective
state, such that repetition produces a negative shift and novelty
produces a positive shift, without disclosure of the score to the agent.

**Prior art known to the operator:**

- OHMAR — referenced in the buyer's diligence package as the closest
  prior art. The operator has not read the OHMAR paper directly; the
  differentiator (prompt-injection-as-constraint vs output filtering) is
  taken from the buyer's framing and should be verified by counsel
- Anti-repetition decoding penalties (no-repeat-ngram-size in nucleus
  sampling): operates on the token stream, not the action-decision
  stream. Not relevant
- Dialogue-history retrieval-augmented generation systems: closer in
  spirit but operate at the prompt-context level, not as enforced
  constraint

**Confidence:** Borderline.

The composite multi-pattern detector is unusual. Each individual
detector (n-gram repetition, keyword overlap, alternating-cycle
detection) is not novel. The creativity-fed-back-through-mood sub-claim
is the more defensible piece — I have not seen this pattern in any
public agent framework.

**Caveats for sworn declaration:**

- Sole inventorship of the design: defensible. The code is in commits
  authored by the operator. The composite design is documented in the
  progress report and PR descriptions
- AI tooling involvement: the *implementation* of these patterns was
  AI-assisted (the code style suggests this). The *idea* of using mood
  as a feedback channel for creativity is the inventive contribution.
  This distinction should be communicated to patent counsel
- The OHMAR claim is third-hand. Counsel should verify it against the
  actual OHMAR claims before any sworn declaration

---

### Item 2 — Sleep-cycle four-pass consolidation

**Status:** Present, active. The "four-pass" framing in the docs aligns
with the four LLM-driven or LLM-supporting passes; the code has additional
non-LLM steps (a pre-dedup and a volatile-state clear) that are not framed
as part of the patent claim.

**Evidence:**

- `src/loop/SleepCycle.js`, 482 lines, first commit `fa93038` on
  2026-02-20 (v0.1)
- Pass labels in code:
  - Pass 0 ([SleepCycle.js:101-106](../src/loop/SleepCycle.js)) — pre-LLM
    fuzzy-keyword deduplication of `memory.md`. Not part of the patent
    claim; this is an internal optimisation
  - Pass 1 ([SleepCycle.js:107-110](../src/loop/SleepCycle.js)) —
    memory.md consolidation via LLM
  - Pass 2 ([SleepCycle.js:111-114](../src/loop/SleepCycle.js)) —
    skills.md extraction via LLM
  - Pass 3 ([SleepCycle.js:119-121](../src/loop/SleepCycle.js)) —
    self-reflection via LLM, including the persona-evolution step and
    drift guard (see Item 3)
  - Pass 4 ([SleepCycle.js:122-124](../src/loop/SleepCycle.js)) —
    daily log garbage collection
  - Pass 5 ([SleepCycle.js:125-133](../src/loop/SleepCycle.js)) —
    volatile state clear (working memory, internal state history,
    repetition guard, speech log trim). Housekeeping, not patentable
- Safety pattern enforced at every LLM-driven write:
  [MemoryFiles.safeWriteMemory](../src/memory/MemoryFiles.js) (line 299)
  and `safeWriteSkills` (line 310). The pattern is `backup → validate →
  write → restore-on-failure`. Content validation rejects garbled LLM
  output before persisting ([MemoryFiles.js:281-296](../src/memory/MemoryFiles.js))
- Pre-LLM fuzzy dedup at
  [MemoryFiles.js:140-181](../src/memory/MemoryFiles.js). 70% keyword-
  overlap threshold. This step exists because the LLM consolidation pass
  cannot be trusted to merge duplicates reliably; it tends to keep
  everything. The dedup is code, not prompt

**Claim shape (structural):**

A method for autonomous-agent memory consolidation during scheduled
sleep cycles, comprising the coordinated execution of: a memory-merging
pass with pre-LLM keyword-overlap deduplication and post-LLM markdown-
structure validation; a procedural-skill extraction pass constrained to
evidence in the recent activity log; a self-reflective persona-evolution
pass with quantitative drift measurement and rejection threshold (see
Item 3); and a daily-log garbage-collection pass with retention bounds —
wherein each LLM-driven pass writes through a backup/validate/write/
restore safety wrapper preventing corruption of persistent knowledge
files by malformed LLM output.

**Prior art known to the operator:**

- MemGPT and Letta — both implement scheduled memory consolidation in some
  form. Single-domain (memory only). The 3aiii contribution is the
  combined four-domain cycle including bounded persona evolution
- The buyer's diligence package names these two as closest prior art

**Confidence:** Borderline, with narrow framing.

The individual passes (memory consolidation, skill extraction, GC) are
not new. The composite cycle is uncommon. The backup/validate/write
safety wrapper is unusual. Counsel will likely want to narrow the claim
around the combination and the safety wrapper rather than around any
single pass.

**Caveats for sworn declaration:**

- Tools-refresh pass was removed in v0.3.1 because it was destructive
  (the LLM would corrupt the ground-truth header in `tools.md`). This is
  documented honestly in [SleepCycle.js:115-117](../src/loop/SleepCycle.js)
  as a code comment and in the PROGRESS report. It should not be claimed
  as part of the cycle
- The "four-pass" framing in the marketing docs counts: memory consolidation,
  skill extraction, persona reflection, GC. Patent counsel may want to
  align this with the code's literal pass numbering (which includes the
  pre-dedup as Pass 0). The honest framing is "four LLM-coordinated passes
  plus an internal pre-dedup and a volatile-state clear"

---

### Item 3 — Persona drift guard

**Status:** Present, active. This is the strongest single 3aiii item in
my assessment.

**Evidence:**

All implementation in `src/loop/SleepCycle.js`:

- **Immutable baseline** ([SleepCycle.js:42-58](../src/loop/SleepCycle.js)) —
  `loadOriginalPersona()` writes `persona-baseline.json` on first-ever
  boot and never modifies it. Every subsequent boot loads from that file,
  not from the current persona. This pattern was added in v0.3.1
  specifically to fix a bug where the "original" was loaded from current
  at first sleep, drifting itself over restarts. The PROGRESS report
  section v0.3.1 item 4 describes the fix in detail
- **Divergence metric** ([SleepCycle.js:407-443](../src/loop/SleepCycle.js)) —
  `_measureDrift()`. Set-overlap retention across the array fields
  `traits`, `values`, `fears`, `quirks`. Plus a string-match check on
  `voice.style`. Returns 0..1
- **Rejection threshold** ([SleepCycle.js:268-275](../src/loop/SleepCycle.js)) —
  `driftScore >= 0.6` blocks evolution this cycle. The proposed change
  set is discarded; the persona is not modified
- **Type validation** ([SleepCycle.js:339-351](../src/loop/SleepCycle.js)) —
  array fields must be arrays, voice must be an object. Rejects malformed
  LLM output before applying
- **Backup before write** ([SleepCycle.js:353-356](../src/loop/SleepCycle.js)) —
  `copyFile(personaPath + '.bak')` before merging changes. Allows manual
  recovery from a bad evolution
- **Bounded evolution log** ([SleepCycle.js:364-374](../src/loop/SleepCycle.js)) —
  evolutions appended to the persona JSON itself, capped at last 20
  entries. Each entry records timestamp, reason, the diff applied, and
  the post-change drift score
- **Identity-preserving constraint** ([SleepCycle.js:334-337](../src/loop/SleepCycle.js)) —
  `name`, `id`, and `backstory` are stripped from any proposed change
  set before validation. These cannot evolve under any circumstance

**Claim shape (structural):**

A method for bounding the evolution of an autonomous-agent persona over
recurring sleep-cycle self-reflection, comprising: persisting an immutable
baseline of the persona's evolvable fields on first boot; on each sleep
cycle, measuring a divergence score between the current persona and the
immutable baseline via set-overlap retention across enumerated array
fields and string equality on enumerated style fields; rejecting any
proposed evolution when the divergence score exceeds a threshold; type-
validating each field of any accepted evolution before applying; and
maintaining a bounded log of accepted evolutions appended to the persona
record itself — wherein identity fields (name, id, backstory) are not
evolvable and are stripped from any proposed change set before validation.

**Prior art known to the operator:**

I am not aware of public agent frameworks doing persona drift detection
with an immutable baseline and a quantitative rejection threshold.
Personas drift in many systems (Character.ai, NovelAI memory edits,
MemGPT user-preference updates). The *guard* is the unusual piece.

**Confidence:** Clear. Best candidate for a clean patent claim with
minimal framing tightness needed.

**Caveats for sworn declaration:**

- The divergence metric uses set-overlap on string arrays. This isn't a
  metric in the formal mathematical sense (triangle inequality not
  guaranteed across all inputs). The honest framing for the sworn
  declaration is "retention-based similarity score" or "divergence
  score", not "distance metric". The substance of the claim is unaffected
- The drift guard depends on `loadOriginalPersona()` being called once
  per boot. I traced the wiring at [src/index.js:69](../src/index.js)
  and confirmed the call is unconditional. A regression that bypassed
  this call would silently weaken the claim

---

### Item 4 — Hardware-grounded loops / environment-agnostic protocol

**Status:** Present, active. Documented as a formal protocol spec.

**Evidence:**

- **Client implementation:** `src/connection/EnvironmentSocket.js`, 213
  lines, first commit `fa93038` on 2026-02-20 (v0.1). WebSocket lifecycle
  (`WELCOME → IDENTIFY → IDENTIFIED → OBSERVE/ACT/WORLD_EVENT`),
  exponential reconnect backoff up to a 5 min cap
  ([EnvironmentSocket.js:190-207](../src/connection/EnvironmentSocket.js)),
  optional `ADMIN_TOKEN` auth on `IDENTIFY`
  ([EnvironmentSocket.js:85-89](../src/connection/EnvironmentSocket.js)),
  reject-pending-promises-on-disconnect to prevent timeout-hang
  ([EnvironmentSocket.js:57-66](../src/connection/EnvironmentSocket.js))
- **Environment-agnostic narration:** `src/cognition/Perceive.js`, 276
  lines.
  - Coordinate-system-agnostic at
    [Perceive.js:15-20](../src/cognition/Perceive.js) — narrates whatever
    keys are present in `pos`, never assumes (x, z)
  - Generic property narration at
    [Perceive.js:24-28](../src/cognition/Perceive.js) — for any unknown
    key on `self`, including nested objects (the `needs.hunger.{level,
    urgency}` pattern, the `wellbeing.{status, criticalNeeds}` pattern
    via `_narrateValue`)
  - Felt-experience translation at
    [Perceive.js:184-275](../src/cognition/Perceive.js). Maps numeric
    environmental signals to natural-language descriptions *before* the
    LLM sees them. Built-in mappings exist for `vitality`, `resonance`,
    `warmth`, `abundance`, `temperature`, `humidity`, `wind_speed`,
    `cloud_cover`, `crowd_energy`. Anything else falls through to
    generic key:value narration
    ([Perceive.js:266-273](../src/cognition/Perceive.js))
  - Top-level fall-through at
    [Perceive.js:122-133](../src/cognition/Perceive.js) — any
    observation key not in the handled set is JSON-stringified into the
    prompt
- **Protocol spec:** `environment-protocol.md`, 350 lines. First
  commit `6f06963` on 2026-03-17 (v0.4). Formal contract; examples for
  3D world and synth bridge
- **Worked example claims:** kiwiexe.com (3D virtual world integration),
  Ibiza Botanical Gardens installation (real-world sensor → agent →
  output loop). Both are claimed in the documentation. The operator has
  not produced standalone evidence in this audit session — see caveats

**Claim shape (structural):**

A method for embodied-agent deployment across heterogeneous environments,
comprising: a WebSocket protocol defining a handshake (welcome,
identification, identification confirmation with arbitrary world
metadata), a synchronous observation/action cycle, and asynchronous world
events; a runtime client implementing reconnection with exponential
backoff and pending-request rejection on disconnect; and an environment-
agnostic perception layer that narrates an observation payload of
arbitrary structure into natural language for an LLM, including
coordinate-system-agnostic position narration, recursive narration of
nested self-state objects, mapping of numeric environmental signals to
felt-experience language before LLM exposure, and generic fall-through
narration for any unrecognised top-level keys — such that the same
runtime can drive a 3D virtual world, a hardware sensor stream, or a
music-synth bridge without environment-specific code changes.

**Prior art known to the operator:**

Many agent frameworks have plug-in tool or plug-in environment systems
(LangChain, AutoGen, MetaGPT). Most either constrain the observation
shape or require an environment-specific adapter. The 3aiii claim relies
on shape-free narration being the inventive piece.

**Confidence:** Borderline.

The protocol itself is unremarkable (a small JSON-over-WebSocket
contract). The implementation is solid. Patentability depends on whether
the *combination* (protocol + shape-free narration + felt-experience
pre-translation + LLM-context-injection) is recognised as novel as a
method. The parts individually are not.

**Caveats for sworn declaration:**

- "Hardware-grounded" framing depends on the Ibiza Botanical Gardens
  installation existing and being demonstrable. If the installation
  isn't currently running or can't be shown live to the buyer, the
  claim should be reframed as *"designed for hardware grounding with a
  documented test environment and one prior live deployment"* rather
  than *"demonstrated end-to-end"*
- The specific signal-name mappings in `_describeSignals`
  (`vitality`, `resonance`, etc.) come from the operator-authored
  cosmology and are content, not patentable structure. The *pattern*
  (translate numeric signals to felt-experience language before LLM
  exposure) is the claim shape

---

## 4. Cross-cutting findings

These were not in the inferred four items but emerged during the audit.
Listed in case any are worth surfacing to the buyer.

**A. Creativity-as-felt-sensation feedback** — folded into Item 1 above
as a sub-claim, but stands alone if useful. Code at
[RepetitionGuard.js:185-207](../src/cognition/RepetitionGuard.js) +
[InternalState.applySpeechCreativity](../src/cognition/InternalState.js).
The novel piece: a score the agent never sees drives its affective state,
making repetition naturally aversive without instruction. The strongest
sub-claim across the codebase in my opinion.

**B. Asymmetric reward via mood** —
[InternalState.js:43-54](../src/cognition/InternalState.js). Failure
-0.15, success +0.02, interact-success +0.04 bonus. 7.5:1 negativity
ratio. RL reward shaping is an established field; this isn't patentable
on its own. Worth naming as it reinforces the "felt sense not instruction"
framing in Item 1.

**C. Tick classification with tiered LLM routing** —
[Heartbeat.js:333-346](../src/loop/Heartbeat.js) `_classifyTick()` +
[LLMClient.js](../src/llm/LLMClient.js) tier-aware `generate()`. Routes
to quality (70B cloud), fast (8B cloud / Ollama), or skip (no LLM) based
on deltas, world events, internal-state magnitude, and repetition
warnings. Cost-aware cognitive throttling. Borderline patent claim —
model cascading exists; *cognitive-context-driven* tier selection is
the differentiator. Counsel could narrow around the selection criteria.

**D. Adaptive heartbeat throttling** —
[Heartbeat.js:319-327](../src/loop/Heartbeat.js) `_adaptInterval()`.
Tick interval keyed off |energy|, 4-15s range with smoothing. Engineering
merit; probably not patentable on its own.

**E. Memory write safety pattern** —
[MemoryFiles.js:281-319](../src/memory/MemoryFiles.js) `safeWriteMemory`
/ `safeWriteSkills`. Backup → validate → write → restore-on-failure.
Database-write patterns are well-known; not patentable as a standalone
but reinforces the "production hardness" claim in Item 2.

**F. Delta detection with noise-property filtering** —
[DeltaDetector.js:37-40](../src/cognition/DeltaDetector.js). Skip-list
for `pos` / `distance` / `direction` / `heading` so positional jitter
doesn't generate fake deltas. Subtle but it's the kind of detail a
sophisticated reviewer notices as competent implementation.

---

## 5. What I will and will not sworn-state to

**Will sworn-state to:**

- The implementation of all four items, as documented in section 3, is
  present in the production code path on the audited branch and has
  been since the dates given in the evidence sections
- The composite design of each item (the combination of components, not
  any individual component) was conceived and implemented by the
  operator. Implementation was AI-assisted; the inventive decisions and
  composition were the operator's
- The codebase audit was conducted by the operator against the actual
  code, without external review and without pressure from the buyer

**Will not sworn-state to without patent counsel review:**

- Any claim of novelty against specific prior art (OHMAR for Item 1,
  MemGPT/Letta for Item 2). The prior-art framing in this memo is
  based on the buyer's diligence package framing and the operator's
  general knowledge of the agent-framework field. It has not been
  cross-checked against the actual prior-art claims
- The strength of the claim shapes given in section 3. The "method
  comprising" language given is structural shorthand for a patent
  attorney to start from, not a draftable claim
- Sole inventorship of any sub-component that relies on a known design
  pattern (eg the safe-write-with-backup pattern in Item 2, the
  exponential-reconnect backoff in Item 4)

**External evidence required before any further sworn declarations:**

- The Ibiza Botanical Gardens installation, if claimed as a worked
  example for Item 4, needs standalone evidence. The operator can
  provide installation photos, deployment logs, or a live demonstration
  on request
- The 70 prior test runs in `test-results/` predate the mood/energy
  rename and the de-AI pass. They are honest historical artifacts of
  earlier development; the buyer's team should be told this rather than
  given them as current evidence

---

## 6. Closing

The four 3aiii items are real, implemented, and documented. The strongest
single claim is the persona drift guard (Item 3). The other three are
present and substantive but their patentability depends on framing
against specific prior art, which is patent-counsel territory.

This memo is intended to give the buyer's reviewers and patent counsel
enough information to evaluate the codebase against the claim list
without needing to do the audit themselves. The honest read is that the
codebase substantiates everything the marketing docs claim, with the
specific caveats above.

The companion documents in this package (the architecture overview, the
environment protocol spec, the dependency licence summary, the smoke
test report, the changelog) provide the supporting evidence the buyer's
team will likely want to cross-reference against the findings here.

— Sam Skirrow
