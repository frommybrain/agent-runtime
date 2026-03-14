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
