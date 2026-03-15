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

## Known Issues Backlog (v0.3.1 audit)

### Fixed in v0.3.7
- ~~**Cloud API rate limiting**~~: 60s cooldown on 429 errors, auto-fallback to Ollama during cooldown
- ~~**Ollama one-time check**~~: Re-checks every 5 minutes if initially unavailable
- ~~**Promise leak on disconnect**~~: Pending observe/action rejected immediately in close handler
- ~~**Day boundary buffer**~~: Buffer entries tagged with target file at creation time
- ~~**Tick counter resets**~~: Persisted in state checkpoint, restored on startup
- ~~**Consolidation shares rate limit**~~: 5s delay between sleep LLM calls to spread load
- ~~**System prompt rebuilt every tick**~~: Read cache in MemoryFiles with write-through invalidation
- ~~**DeltaDetector misses property changes**~~: Now tracks property mutations on existing objects

### Fixed in earlier versions (v0.3.2-v0.3.6)
- ~~**Working memory waste**~~: Merged events, buffer 12→20 (v0.3.2)
- ~~**Monotone emotional descriptions**~~: Expanded to 16 descriptions, narrowed neutral band (v0.3.2)
- ~~**Exact-match speech dedup**~~: Fuzzy keyword matching (v0.3.2)
- ~~**Perceive.js omits object positions**~~: Distance + coordinates narrated (v0.3.2)

### Remaining
- **No process watchdog**: No external mechanism to restart if Node.js hangs. Add systemd service or health check endpoint.
