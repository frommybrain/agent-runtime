# Changelog

Newest first. Version numbers follow the boot string in `src/index.js`. The early entries were pieced together from commit history, the later ones written at the time.

## [Unreleased] - 2026-09-17

- every decision writes one JSON line to `data/decisions/YYYY-MM-DD.jsonl`, kept `DECISION_LOG_DAYS` (14 default). has the tier and the rule that picked it, the model that actually answered plus latency and tokens, what the brain asked for vs what got sent, every guard that stepped in, fallback kind, act result, running commit, a hash of the persona the prompt was built from, and two evidence keys (`scene`, `detail`) so the same situation asked about again unchanged can be counted. on 25 september 836 of 1,384 decisions went to the 120B and victor.log couldnt say why, and 19 got turned into wait with no record of what the model wanted.
- `scripts/decisions.mjs` reads a day of that (or `--days N`): tiers and why, models with latency/tokens, guards, repeated evidence, failures, repeated reasons.
- `_classifyTick` returns `{ tier, why }`. `RepetitionGuard.checkDetailed()` gives each warning a kind, `check()` unchanged. `LLMClient.generate()` also returns `model`, `usage` and `ms`.
- visitor-attention slot is checked before the model is asked now. it used to replace the model's answer after the call, so we paid for a decision and threw it away, and that decision's `remember` still reached memory.md and the world.
- visitor-attention slot stops picking a crystal it already set out for and didn't read. if the pending count hasn't moved since the last slot the shrine takes the next one (the world's shrine fallback reads the oldest waiting note from there), a moving count hands it back to the crystals. live on 17 september it picked one unreachable crystal seventeen times in nine hours.
- its reason is written by the fast tier from facts (who left the note, how long it's waited, how many are behind it), with his recent reasons passed as ground to avoid and the bare facts as fallback. the one authored sentence it used to use got published sixteen times in a day.
- `dueOfferingAttention` reads `waited_min` and `from` off each waiting crystal when the world sends them.

## [Unreleased] - 2026-09-16

- structured execution state. `self.busy` and `self.journey.active` hold off new decisions until the env says the accepted journey or timed action is done. the old movement-text check stays for older envs.
- live observation rendering capped at 12,000 chars. oversized entity state and generic fields get clipped, immediate state and the narrative tail are kept.
- prompt budget trims oversized live situation text before it drops durable memory, then fits the whole user prompt into what's left. covers big delta, exploration and voice-history blocks outside the situation too. prompt metrics record the payload actually sent.
- stalled-heartbeat watchdog: a tick in flight for 120s or more exits the process so the service restarts it.
- `ops/victor-agent.logrotate`: daily, or earlier at 10 MB, seven compressed generations kept. uses root ownership because that's what systemd opens `StandardOutput` as.
- tests for work state, older protocol compat, observation bounds, narrative retention, watchdog wiring.

## [Unreleased] - 2026-07

- new `decision` LLM tier, Anthropic-backed, for money / high-stakes ticks. an env opts in with `signals.decision_pending >= 0.5` in the observation. no `ANTHROPIC_API_KEY` means it aliases to the normal quality chain. config: `ANTHROPIC_API_KEY`, `DECISION_MODEL`.
- `voice.canon` (array of lines) on a persona replaces the default reason-field rules. default canon is byte-for-byte the same so victor/synth prompts don't change. needed because the default bans quoting numbers, which is wrong for a trading persona.
- anti-fixation redirect is env-aware: blocks pick their escape from `available_actions` (move_to, then wait, then hold) instead of always forcing `move_to("wander")`, which non-spatial envs can't run. also the block log named the redirect action instead of the blocked one, fixed.

## [Unreleased] - 2026-05

- renamed internal-state fields: `valence` to `mood`, `arousal` to `energy`. plainer english for the diligence package. API/SSE/checkpoint JSON keys changed with it, so downstream consumers (anon-ai-world viewer, sim-server bridge) need updating.
- branding: user-facing references say `3aiii` now instead of `agent-runtime`. repo name, package name, systemd unit and file paths unchanged.
- tidied source comments and docs.
- diligence material: SBOM, LICENCE, this changelog, fresh smoke test report in `test-results/diligence/`.

## [v0.4] - 2026-03-17

- environment protocol written up in `docs/environment-protocol.md`, first proper spec of the WebSocket contract between 3aiii and an env server.
- anti-fixation guard generalised: no more hardcoded entity-type checks, only looks at inspect actions, skips survival targets in warnings.
- tighter fixation thresholds.
- behaviour fixes: desperate cycling, shiny fixation, ghost actions.
- delta detection no longer fires on positional jitter.
- energy no longer saturates under sustained signals.
- `ADMIN_TOKEN` on the `IDENTIFY` handshake.
- `FallbackBrain.move_to` works with sim-server.

## [v0.3.10] - 2026-03-16

- `SpeechLog`, speech history that survives sleep.
- stability fixes from a code review.

## [v0.3.9] - 2026-03-16

- quiet hours (`QUIET_HOURS`, UTC window), less activity when hardly anyone's watching.
- more forgiving JSON parsing of LLM responses.

## [v0.3.8.1] - 2026-03-16

- fast tier prefers cloud 8B over local Ollama. on the Pi Ollama was taking longer than the heartbeat interval and ticks were getting skipped. cloud 8B is fast enough not to miss ticks and cheap enough for routine use.

## [v0.3.8] - 2026-03-15

- tiered LLM routing: `quality` (cloud 70B) for important moments, `fast` (cloud 8B / Ollama) for routine ticks, `skip` (no LLM) when nothing's happening. picked per tick from deltas, world events, internal state and repetition warnings.

## [v0.3.7] - 2026-03-15

Deployment prep, eight stability fixes in one go:

- 60s cooldown on cloud 429s, falls back to Ollama meanwhile.
- re-check Ollama every 5 min if it wasn't there at boot.
- pending observe/action promises rejected straight away on WebSocket disconnect (was hanging 5s every time).
- daily log buffer entries tagged with their target file when created, fixes writing to the wrong day at midnight.
- tick counter saved in the state checkpoint and restored on boot.
- 5s gap between sleep-cycle LLM calls to spread out rate limit load.
- read cache in `MemoryFiles`, invalidated on write (10,800 file reads/day down to ~30).
- `DeltaDetector` tracks property changes on existing objects.

## [v0.3.6] - 2026-03-15

- speech creativity feedback. each speech is scored against recent ones by keyword overlap (0.0 exact repeat, 1.0 completely new). under 0.4 is a small mood penalty, over 0.8 a small reward. the agent never sees the score, only the mood shift.

## [v0.3.5] - 2026-03-15

- cloud model llama-3.1-8b-instant to llama-3.3-70b-versatile. interact rate went from 12% to 30%, hallucinations to zero.
- local fallback qwen2.5:3b to qwen3:4b.
- signals described as how they feel instead of raw numbers (`vitality: 0.55` becomes `there is a healthy energy here`).
- internal-state numbers taken out of the prompt, the agent only sees the description.

## [v0.3.4] - 2026-03-15

- memory vs hallucination: the prompt lets the agent *remember* objects that are gone, in past tense, and still blocks present-tense mentions of things that aren't there.
- soak test false positive: word-boundary regex instead of substring match for hallucination detection.
- qwen3:4b is the default local model.

## [v0.3.3] - 2026-03-14

- asymmetric reward fix. success gives a small mood bump (+0.02, +0.04 for interact). before only failures moved mood, and mood flatlined at 0.000 in envs with no signals. 7.5:1 negativity ratio kept.
- `GONE` warning window 10 to 30 ticks (~4 minutes).
- soak test phases get baseline signals instead of nulls.

## [v0.3.2] - 2026-03-14

- tracks objects that disappear, explicit `GONE` warning in the prompt.
- fuzzy speech dedup by keyword overlap (60% threshold).
- emotional descriptions 9 to 16, neutral catch-all band narrower.
- working memory: action and action-result merged into one slot. buffer 12 to 20.
- object narration includes distance or coordinates.

## [v0.3.1] - 2026-03-14

Readiness pass for a 3-month run. Seven fixes:

- memory corruption protection: backup, validate, write, restore on failure, for `memory.md` and `skills.md`.
- removed the destructive `_refreshTools()` (`tools.md` is rebuilt from the live observation every tick anyway).
- persona evolution type checks: arrays must be arrays, objects objects. malformed LLM output rejected.
- immutable persona baseline. `persona-baseline.json` saved on the very first boot and never touched again. the drift guard compares against that, not a moving target.
- skills extraction can only use evidence from the activity log, stops it inventing skills.
- memory truncation order: cuts from the middle of `Learned Facts` (biggest, least important) instead of from the end (which would have cut `Important Memories` first).
- hard 120-char cap on memory entries.

## [v0.3] - 2026-03-14

Stability work for running months at a time:

- `DailyLog` buffers in memory and flushes periodically (21,600 disk writes/day down to ~288).
- hourly maintenance timer, independent of sleep.
- sleep consolidation input capped at 200 lines.
- crash recovery: internal state checkpointed every 5 min, restored on boot if under an hour old.
- persona drift guard with an actual measurement (60% threshold).
- prompt token budget, truncates `memory.md` when over.
- `tools.md` skips the write when the hash hasn't changed.
- WebSocket exponential backoff (5s up to a 5 min cap).
- stale SSE client cleanup.
- `/metrics` endpoint.

## [v0.2] - 2026-03-14

Rewrote the loop. The simple `OBSERVE / THINK / ACT` became five stages:

- `SENSE / FEEL / THINK / ACT / REFLECT`
- `InternalState` (two axes, mood and energy)
- `DeltaDetector` (diffs observations between ticks)
- `RepetitionGuard` (tracks recent actions, surfaces fixation)
- adaptive heartbeat, 4-15s depending on energy
- sleep does self-reflection and persona evolution
- test suite at the repo root

## [v0.1] - 2026-02-20

First version:

- `OBSERVE / THINK / ACT` on a fixed 8s timer
- 3 layers of memory: markdown files, RAM ring buffer, daily logs
- two LLMs, Ollama first with cloud fallback
- sleep cycle, 4h awake / 1h of LLM memory consolidation
- HTTP API + SSE
- Pi bootstrap script
- four personas: Pip, Bean, Mochi, Taro

## Personas

Pip, Bean, Mochi and Taro came with v0.1 on 2026-02-20. Victor was added 2026-02-28 and is the main one, most of the soak test data comes from him. Sharay was added 2026-03-31, wider output range and more specific reasoning.

Each is a JSON file in `personas/` and the runtime doesn't care how many there are.
