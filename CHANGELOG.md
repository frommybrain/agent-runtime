# Changelog

Reverse chronological. Versions follow the boot-string in `src/index.js`.
Earlier entries reconstructed from commit history; later entries from
contemporaneous version commits.

## [Unreleased] — 2026-05

- Renamed internal-state field names: `valence` → `mood`, `arousal` → `energy`.
  Plain-English for the diligence package. API/SSE/checkpoint JSON keys
  changed accordingly; downstream consumers (anon-ai-world viewer, sim-server
  bridge) need updating to match.
- Branding pass: user-facing references rebranded `agent-runtime` → `3aiii`.
  Technical identifiers (repo name, package name, systemd unit, file paths)
  unchanged.
- De-AI'd source comments and docs across the codebase.
- Added diligence handover materials: `docs/handover.md`, audit memo,
  SBOM, LICENCE, `docs/security.md`, CONTRIBUTING, this changelog,
  fresh smoke test report in `test-results/diligence/`.

## [v0.4] — 2026-03-17

- Environment Protocol Standard documented in `docs/environment-protocol.md`.
  First formal spec of the WebSocket contract between 3aiii and any
  environment server.
- Anti-fixation guard generalised: removed hardcoded entity-type checks,
  scoped to inspect actions only, skips survival targets in warnings.
- Tightened fixation detection thresholds.
- Behavioural tuning: fixed desperate cycling, shiny fixation, ghost actions.
- Fixed delta-detection noise from positional jitter.
- Fixed energy saturation under sustained signals.
- `ADMIN_TOKEN` support added to the `IDENTIFY` handshake.
- `FallbackBrain.move_to` made compatible with sim-server.

## [v0.3.10] — 2026-03-16

- Added `SpeechLog` — persistent speech history that survives sleep cycles.
- Stability hardening from a structured code review.

## [v0.3.9] — 2026-03-16

- Quiet hours scheduling (`QUIET_HOURS` env var, UTC window). Reduced
  activity during low-viewership windows.
- JSON resilience improvements in LLM response parsing.

## [v0.3.8.1] — 2026-03-16

- Fast-tier routing prefers cloud 8B over local Ollama. On the Pi, Ollama
  generation time was exceeding heartbeat interval and causing tick skipping.
  Cloud 8B is fast enough to avoid missed ticks and cheap enough for routine
  use.

## [v0.3.8] — 2026-03-15

- Tiered LLM routing: `quality` (cloud 70B) for important moments,
  `fast` (cloud 8B / Ollama) for routine ticks, `skip` (no LLM) when
  nothing is happening. Routes per-tick based on deltas, world events,
  internal state, and repetition warnings.

## [v0.3.7] — 2026-03-15

Deployment readiness pass. Eight stability fixes shipped together:

- 60s cooldown on cloud 429 rate limits, auto-fallback to Ollama during
  cooldown.
- Periodic Ollama re-check every 5 min if initially unavailable.
- Pending observe/action promises rejected immediately on WebSocket
  disconnect (was hanging for 5s on every disconnect).
- Daily log buffer entries tagged with target file at creation time
  (fixes wrong-day write at midnight boundary).
- Tick counter persisted in state checkpoint, restored on startup.
- 5s delay between sleep-cycle LLM calls to spread rate-limit load.
- Read cache in `MemoryFiles` with write-through invalidation
  (10,800 file reads/day → ~30).
- `DeltaDetector` tracks property mutations on existing objects.

## [v0.3.6] — 2026-03-15

- Speech creativity feedback loop. Each speech is scored against recent
  speeches via keyword overlap (0.0 = exact repeat, 1.0 = completely
  novel). Score nudges mood: <0.4 → mild penalty, >0.8 → mild reward.
  The agent never sees the score, only the resulting mood shift.

## [v0.3.5] — 2026-03-15

- Cloud model upgraded llama-3.1-8b-instant → llama-3.3-70b-versatile.
  Interact rate doubled from 12% to 30%; hallucinations dropped to zero.
- Local fallback upgraded qwen2.5:3b → qwen3:4b.
- Signal descriptions changed from raw metrics to felt-experience prose
  (`vitality: 0.55` → `there is a healthy energy here`).
- Internal-state numbers removed from prompt context — agent sees only
  the description string.

## [v0.3.4] — 2026-03-15

- Memory vs. hallucination distinction. The prompt now allows the agent
  to *remember* absent objects in past tense, while continuing to block
  hallucinated current-tense references.
- Soak test false-positive fix: word-boundary regex instead of substring
  match for hallucination detection.
- qwen3:4b set as the default local model.

## [v0.3.3] — 2026-03-14

- Asymmetric reward fix. Success now generates mild positive mood (+0.02,
  +0.04 for interact). Previously only failures affected mood, and mood
  flatlined at 0.000 in signal-free environments. 7.5:1 negativity ratio
  preserved.
- `GONE` warning window extended from 10 to 30 ticks (~4 minutes).
- Soak test phases given baseline signals instead of nulls.

## [v0.3.2] — 2026-03-14

- Disappeared-object tracking + explicit `GONE` warning in prompt.
- Fuzzy speech dedup via keyword overlap (60% threshold).
- Emotional descriptions expanded from 9 to 16; neutral catch-all band
  narrowed.
- Working memory: action + action-result events merged into one slot.
  Buffer size 12 → 20.
- Object position narration: distance or coordinates included.

## [v0.3.1] — 2026-03-14

3-month readiness audit. Seven critical fixes:

- Memory corruption protection: backup → validate → write, restore on
  failure for `memory.md` and `skills.md`.
- Destructive `_refreshTools()` removed (`tools.md` is rebuilt from
  live observation every tick).
- Persona evolution type validation: arrays must be arrays, objects
  must be objects. Rejects malformed LLM output.
- Immutable persona baseline. `persona-baseline.json` saved on
  first-ever boot, never modified. Drift guard compares against this
  permanent reference, not a moving target.
- Skills-extraction hallucination guard: constrained to evidence in
  the activity log only.
- Memory truncation order fixed. Cuts from middle of `Learned Facts`
  (largest, least critical) instead of from the end (would have cut
  `Important Memories` first).
- Hard 120-char cap on memory entries.

## [v0.3] — 2026-03-14

Long-term stability overhaul for months-long operation:

- `DailyLog` rewritten to use in-memory buffer + periodic flush
  (21,600 disk writes/day → ~288).
- Background maintenance timer runs hourly, independent of sleep cycle.
- Sleep consolidation input capped at 200 lines.
- Crash recovery: internal state checkpoints every 5 min, restored on
  startup if less than 1 hour old.
- Persona drift guard with quantitative measurement (60% threshold).
- Token budget for prompts, truncates `memory.md` if over.
- `tools.md` hash-based write skipping.
- WebSocket exponential backoff (5s → 5min cap).
- SSE stale client cleanup.
- `/metrics` endpoint added.

## [v0.2] — 2026-03-14

Cognitive redesign. Replaced the simpler `OBSERVE → THINK → ACT` loop
with a five-stage pipeline:

- `SENSE → FEEL → THINK → ACT → REFLECT`
- New module: `InternalState` (two-axis mood/energy)
- New module: `DeltaDetector` (diff observations between ticks)
- New module: `RepetitionGuard` (track recent actions, surface fixation)
- Adaptive heartbeat (4-15s based on energy)
- Sleep cycle with self-reflection + persona evolution
- Test suite added at repo root

## [v0.1] — 2026-02-20

Initial portable agent cognition runtime:

- `OBSERVE → THINK → ACT` loop on fixed 8s timer
- 3-tier memory: persistent markdown + RAM ring buffer + daily logs
- Dual LLM: Ollama primary, cloud fallback
- Sleep cycle: 4hr active / 1hr LLM-driven memory consolidation
- HTTP API + SSE
- Pi bootstrap script
- Four personas: Pip, Bean, Mochi, Taro

## Persona additions

| Persona | Added | Notes |
|---|---|---|
| Pip, Bean, Mochi, Taro | 2026-02-20 | Initial four |
| Victor | 2026-02-28 | Flagship reference persona, most soak-test data drawn from |
| Sharay | 2026-03-31 | Wider output range, more specific reasoning |

(Each persona is a JSON file in `personas/`. The runtime accommodates any
number; these six ship with the package.)
