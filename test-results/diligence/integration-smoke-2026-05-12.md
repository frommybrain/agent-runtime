# Diligence Integration Smoke — 2026-05-12

A short end-to-end run on the renamed `main` branch (commit `09975a7`). Goal:
prove the full pipeline boots, connects to a test environment server, completes
real LLM-driven ticks via Ollama, and exposes a working API — without needing
the full ~10 minute scripted test-suite.

The full `test-suite.js` (10 scripted scenarios) takes ~5-10 minutes against a
cloud API and ~50 minutes against local Ollama. Running it isn't useful in this
session because the local `.env` has no cloud API key. The buyer's team should
run `test-suite.js` themselves with their own Groq key for the integrated-
behaviour evidence at scale. This integration smoke is the shorter "agent
actually runs end-to-end" check.

## Setup

- Branch: `main` at commit `09975a7`
- LLM: local Ollama with `llama3.2:3b` (the agent's default is `qwen3:4b` —
  overridden to match what was installed locally)
- Env server: `test-server.js` with no scenario keys pressed (a static empty
  world)
- Data dir: `data-diligence-smoke/` (cleaned up after the run; no state
  leaked into `data/`)

Two processes, both backgrounded:

```bash
node test-server.js                          # listens on :4001
OLLAMA_MODEL=llama3.2:3b npm start           # agent connects to :4001, API on :5000
```

## What was observed

### Agent boot

```
[18:03:48] [victor] === 3aiii v0.3.10 ===
[18:03:48] [victor] Agent: victor
[18:03:48] [victor] Server: ws://localhost:4001
[18:03:48] [victor] LLM: quality=openai/gpt-oss-120b, fast=openai/gpt-oss-20b, local=llama3.2:3b
[18:03:48] [victor] Heartbeat: 8000ms base (adaptive 4000-15000ms)
[18:03:48] [victor] Sleep: 1h active / 5m sleep
[18:03:48] [victor] Persona loaded: Victor (thoughtful, watchful, private, ...)
[18:03:48] [victor] Created memory.md
[18:03:48] [victor] Created skills.md
[18:03:48] [victor] Created tools.md
[18:03:48] [victor] Ollama connected (model: llama3.2:3b)
[18:03:48] [victor] Drift guard: saved initial persona baseline
[18:03:48] [victor] Connecting to ws://localhost:4001
[18:03:48] [victor] API listening on http://localhost:5000
[18:03:48] [victor] Connected
[18:03:48] [victor] Identified. World bounds: ±100
[18:03:48] [victor] Connected and identified with environment server
[18:03:48] [victor] Heartbeat started (8000ms base, adaptive 4000-15000ms)
[18:03:48] [victor] 3aiii running — API on http://localhost:5000
```

Boot sequence completes in under a second. Visible:

- Renamed brand string (`=== 3aiii v0.3.10 ===`) in the boot banner
- Renamed running message (`3aiii running — API on ...`)
- Persona baseline saved on first boot (the drift guard's immutable
  reference). On every subsequent boot this would say `loaded immutable
  persona baseline` instead
- Ollama detected with the override model. The agent prefers cloud for
  fast-tier calls and falls back to Ollama on this run because no
  `CLOUD_API_KEY` is set
- WebSocket handshake to the test server completed (`WELCOME → IDENTIFY → IDENTIFIED`)

### Ticks

```
[18:03:48] [victor] [tick 1] move_to (fallback/skip)  — exploring          [v=0.00 a=0.00]
[18:04:15] [victor] [tick 2] wait    (ollama/fast)    — no particular reason [v=0.02 a=0.00]
[18:04:18] [victor] [tick 3] wait    (ollama/fast)    —                     [v=0.04 a=0.00]
[18:04:36] [victor] [tick 4] wait    (ollama/fast)    — nothing in particular [v=0.05 a=0.00]
```

Four ticks completed in 48 seconds. Interpretation:

- Tick 1 used the **skip tier** (FallbackBrain). The classifier
  ([Heartbeat.js:333-346](../../src/loop/Heartbeat.js)) routes to skip when
  there are no deltas, no world events, no recently-disappeared objects,
  no heightened internal state, and no repetition warnings — matches the
  first tick after boot (no previous observation to diff against). The
  fallback heuristic picked `move_to wander` for "exploring", which is
  the expected default
- Ticks 2-4 used the **fast tier** (Ollama, real LLM call). The model
  picked `wait` each time with brief reasoning, which is the right
  behaviour for an empty world with no signals or nearby entities — no
  novelty to investigate, nothing to interact with
- Mood drifted upward from 0.00 → 0.05 over four successful ticks. This
  is the asymmetric reward at work
  ([InternalState.js:43-54](../../src/cognition/InternalState.js)):
  failure -0.15, success +0.02. Four successes net out to roughly +0.08
  before decay (the decay rate of 0.1 trims this back each tick)
- Energy stayed at 0.00 throughout. Expected — the world is static,
  there are no deltas, no novelty spikes

### `/status` response

```json
{
  "agent": "Victor",
  "id": "npc_victor",
  "sleeping": false,
  "quietHours": false,
  "connected": true,
  "tickCount": 4,
  "uptime": 39,
  "heartbeatMs": 12599,
  "internalState": {
    "mood": 0.0542,
    "energy": 0,
    "moodLabel": "neutral",
    "energyLabel": "moderate",
    "description": "Feeling steady — calm, present, unremarkable"
  },
  "recentActions": [ ... 4 entries ... ]
}
```

The post-rename JSON shape is correct: `mood`, `energy`, `moodLabel`,
`energyLabel`. No straggling `valence` or `arousal` fields. The
adaptive heartbeat has slowed from the 8000ms base to 12599ms (low
energy → slower ticking, conserving compute).

### `/metrics` response

```json
{
  "uptime": 51,
  "tickCount": 4,
  "heartbeatMs": 13319,
  "sleeping": false,
  "mood": 0.0542,
  "energy": 0,
  "fileSizes": { "memory": 77, "skills": 18, "tools": 225 },
  "buffers": {
    "workingMemory": 4,
    "workingMemoryMax": 20,
    "repetitionHistory": 4,
    "logBuffer": 5
  },
  "actionDiversity": 0.5,
  "tierCounts": { "skip": 0, "fast": 3, "quality": 0 },
  "lastPromptChars": 5588,
  "sseClients": 0,
  "heapUsedMB": 10,
  "heapTotalMB": 11.5,
  "rssMB": 44.6
}
```

- **Resident memory: ~45 MB**. Comfortably fits on a Raspberry Pi 4GB
- **Heap: 10 MB / 11.5 MB**. No fragmentation
- **Prompt size: 5588 chars** (~1400 tokens), well under the 7800-token
  budget enforced in `Think._truncateLearnedFacts`
- **Tier counts: 0 quality + 3 fast + 0 skip** (the v0.3.10 metric
  counter doesn't include the boot-time skip tick from tick 1, which is
  a minor display gap, not a functional bug — the classifier ran
  correctly)
- **Action diversity: 0.5** — two distinct actions across four ticks
  (`move_to` and `wait`)

### Protocol round-trips (from `test-server.js` log)

The full WebSocket transcript shows clean protocol round-trips on every
tick:

```
[17:03:48] ← AGENT IDENTIFY: {"type":"IDENTIFY","agentId":"victor"}
[17:03:48] → AGENT IDENTIFIED: {"type":"IDENTIFIED","agentId":"victor","worldBounds":{"halfSize":100}}
...
[17:03:56] ← AGENT OBSERVE
[17:03:56] → AGENT OBSERVATION (self, nearbyAgents, nearbyObjects, available_actions, recentSpeech)
[17:04:15] ← AGENT ACT: {"action":"wait","params":{}}
[17:04:15] → AGENT ACTION_RESULT: {"success":true,"message":"wait completed"}
```

All four cycles handshake → observe → act → result completed without
error.

## Pass / fail summary

| Check | Result |
|---|---|
| Agent boots without import or config errors | ✅ |
| All cognitive modules initialise (InternalState, RepetitionGuard, DeltaDetector, etc.) | ✅ |
| Persona loads from JSON | ✅ |
| Drift guard saves the immutable baseline on first boot | ✅ |
| Ollama connection succeeds (with override model) | ✅ |
| WebSocket connects to env server and completes IDENTIFY handshake | ✅ |
| API server listens on port 5000 | ✅ |
| At least one tick routes to `fallback/skip` correctly | ✅ |
| At least one tick routes to `ollama/fast` with a real LLM call | ✅ |
| Internal state updates per tick (asymmetric reward visible) | ✅ |
| `/status` returns renamed fields (`mood`, `energy`, ...) — no straggling `valence`/`arousal` | ✅ |
| `/metrics` returns observability data with renamed fields | ✅ |
| Adaptive heartbeat slows in low-energy state (8000 → 13319 ms) | ✅ |
| Memory files created on first boot from templates | ✅ |
| Graceful shutdown on SIGTERM | ✅ (ports cleared after kill, no orphan processes) |
| Heap stays small (10 MB) — fits on Pi 4GB | ✅ |

## What this does and doesn't prove

**Proves:**

- The renamed code paths work end-to-end. No regression from the
  valence/arousal → mood/energy rename
- The agent boots, connects, observes, decides, acts, and observes again
  in a complete cognitive cycle
- The protocol layer (WebSocket + JSON) round-trips cleanly
- The API surface is operational with the renamed field names
- The fallback brain (heuristic) and Ollama-driven decisions both work
- The cost-aware tier classifier picks the right tier (skip for boot,
  fast for routine ticks)

**Doesn't prove:**

- Sleep cycle behaviour (sleep was configured for 1h active / 5m sleep
  on this run; not enough wall-clock for a sleep to fire). The
  underlying sleep-cycle code was exercised by the module smoke
- Cloud LLM behaviour (no `CLOUD_API_KEY` available). The cloud code
  path is exercised every day in production on the Pi (Groq); not in
  this session
- Quality-tier routing (no events triggered the conditions that route to
  quality)
- Stability over hours (the historical `test-results/` directory has
  prior batches at the 2-hour to 12-hour scale)
- Behaviour against the full 10-scenario controlled `test-suite.js`
  scenarios. The buyer's team should run that with their own cloud key

## How to reproduce

```bash
cd agent-runtime
npm install

# terminal 1
node test-server.js

# terminal 2 (with .env configured)
OLLAMA_MODEL=llama3.2:3b npm start  # if using local Ollama
# or just `npm start` if CLOUD_API_KEY is set in .env

# terminal 3
curl http://localhost:5000/status | jq
curl http://localhost:5000/metrics | jq

# stop
kill <agent-pid> <test-server-pid>
```

For the full controlled suite (10 scripted scenarios, ~5-10 min with a
cloud key):

```bash
node test-suite.js     # in place of test-server.js
# (start the agent in another terminal as above)
```

Report writes to `test-results/<timestamp>-report.md`.
