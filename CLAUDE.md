# Agent Runtime — Claude Code Instructions

## Project Overview
Autonomous agent runtime for embodied AI agents (runs on Raspberry Pi 5). Cognitive loop: SENSE → FEEL → THINK → ACT → REFLECT. Uses Groq cloud API (llama-3.1-8b-instant) for decisions.

## Tweet Milestones
**Every significant milestone, fix, or architectural change** — append a tweet to `tweets.md`. Include:
- What changed and why it matters
- Code snippets or data where relevant
- Frame it as a build-in-public narrative for the project

## Key Architecture
- `src/loop/Heartbeat.js` — core cognitive loop
- `src/loop/SleepCycle.js` — sleep/wake + memory consolidation
- `src/cognition/` — InternalState (valence/arousal), Think, DeltaDetector, RepetitionGuard
- `src/memory/` — WorkingMemory (RAM ring buffer), MemoryFiles (persistent .md), DailyLog
- `src/llm/` — LLMClient (Groq primary, Ollama fallback), PromptBuilder
- `src/connection/EnvironmentSocket.js` — WebSocket to environment server
- `src/api/ApiServer.js` — HTTP API + SSE events

## Conventions
- Pure Node.js, minimal dependencies (ws, ollama, dotenv)
- No TypeScript, no build step
- ES modules throughout
- Config via environment variables (see src/config.js)
- Test files at project root: test-suite.js (unit), soak-test.js (long-running)

## Known Issues Backlog (v0.3.1 audit — not yet fixed)

These were identified during the 3-month readiness audit. Important but not critical.

### Stability
- **Cloud API rate limiting**: No backoff on 429 errors from Groq. At 15 req/min during high arousal, free tier can be exhausted. Add cooldown period after 429.
- **Ollama one-time check**: `ollamaAvailable` set once at startup. If Ollama restarts later, it's never rediscovered. Re-check periodically.
- **Promise leak on disconnect**: WebSocket `_pendingObserve`/`_pendingAction` not rejected on close event — tick hangs for 5s until timeout. Reject immediately in close handler.
- **Day boundary buffer**: Entries buffered at 23:59 flushed at 00:01 go into wrong day's file. Tag buffer entries with date.
- **No process watchdog**: No external mechanism to restart if Node.js hangs. Add systemd service or health check endpoint.
- **Tick counter resets**: `tickCount` resets to 0 on restart, breaking temporal context. Persist in state checkpoint.

### Quality
- **Working memory waste**: Each tick pushes 2-3 events (action + result + speech) into 12-slot buffer = only 4 ticks of context. Merge action+result into single event, or increase maxSize.
- **Monotone emotional descriptions**: Only 9 description strings in InternalState.describe(). "Feeling steady" covers 70% of ticks. Add micro-sensations for the neutral band.
- **Exact-match speech dedup**: RepetitionGuard speech check is exact-match only. "What's that?" vs "What is that?" both pass. Apply keyword-based fuzzy matching.
- **Consolidation shares rate limit**: 4 LLM calls during sleep go through same cloud API path as ticks. Could exhaust quota and fail first waking ticks.

### Architecture
- **System prompt rebuilt every tick**: 3 file reads per tick for mostly-static content. Cache with invalidation.
- **Perceive.js omits object positions**: Objects narrated without coordinates, preventing spatial reasoning. tools.md has them but in a different format.
- **DeltaDetector misses property changes**: Only detects appeared/disappeared by ID. Object property changes (interactive→non-interactive) are invisible.
