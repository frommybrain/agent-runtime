# 3aiii — Endpoints & test results

Captured 2026-05-12 against the diligence-ready `main` branch.
For orientation see `HANDOVER.md`; for the verbatim run path see `QUICKSTART.md`.

## Environment

| | |
|---|---|
| Branch / commit | `main` at `60ca9fd` |
| Runtime version | `3aiii v0.3.10` (boot banner) |
| Repository | https://github.com/frommybrain/agent-runtime |
| Reference deployment target | Raspberry Pi 5 with Ollama + Groq cloud |
| Smoke host (this session) | macOS, Node 24.1.0, local Ollama 0.5.18 |
| Cloud model (production default) | `openai/gpt-oss-120b` (quality), `openai/gpt-oss-20b` (fast) — via Groq |
| Local model (fallback default) | `qwen3:4b` (Ollama) |
| Direct dependencies | `ws@8.19.0`, `ollama@0.5.18`, `dotenv@16.6.1` — see `docs/SBOM.md` |
| Persona under test | Victor (`personas/victor.json`) |

---

## API endpoints

The runtime exposes a small HTTP API on port 5000 (default). All
endpoints are unauthenticated today; production hardening adds auth +
rate limiting (see `SECURITY.md`).

### `GET /status`

Current internal state, tick count, recent actions. Used by dashboards
and operators.

**Sample response** (captured during integration smoke, 4 ticks in):

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
  "recentActions": [
    {
      "time": "2026-05-12T17:03:48Z",
      "type": "action",
      "action": "move_to({\"target\":\"wander\"})",
      "reason": "exploring",
      "resultSuccess": true
    }
  ]
}
```

Key fields:

- `internalState.mood` and `.energy`: -1..1, the agent's affective state
  (renamed from `valence`/`arousal` on 2026-05-12 — historical reports
  below use the old names)
- `heartbeatMs`: current adaptive tick interval, 4000-15000ms
- `tickCount`: monotonic across restarts (persisted via state checkpoint)

### `GET /memory`

The three persistent markdown files (memory.md, skills.md, tools.md).
Sleep-cycle consolidation rewrites these.

**Sample response shape**:

```json
{
  "memory": "# Victor's Memory\n\n## Relationships\n\n## Learned Facts\n- ...",
  "skills": "# Victor's Skills\n- ...",
  "tools": "# Available Actions\n- ...\n\n# Nearby Objects (GROUND TRUTH ...)"
}
```

### `POST /memory/remember`

Inject a memory entry into the agent's long-term store.

**Request**:

```json
{ "section": "Learned Facts", "content": "the terminal at -5,10 is interactive" }
```

Sections whitelisted: `"Relationships"`, `"Learned Facts"`,
`"Important Memories"`. Anything else returns `400`.

### `GET /logs/today`

Today's daily log as plain text. Returns the line-by-line tick history.
Buffered (RAM ring) + flushed periodically to disk to spare the Pi's SD card.

### `POST /sleep`

Trigger the sleep cycle now. Runs the four passes (memory consolidation,
skill extraction, self-reflection with drift guard, daily-log GC). Returns
`409` if already sleeping.

### `POST /wake`

Wake from sleep early. Returns `409` if not sleeping.

### `PUT /persona`

Hot-swap the active persona. Body is a full persona JSON. Validated for
required fields (`id`, `name`). The PromptBuilder rebuilds with the new
persona on the next tick.

### `GET /metrics`

Runtime metrics for observability. Includes tier counts (which model tier
each tick routed to), buffer utilisation, heap usage, prompt size.

**Sample response** (from integration smoke):

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

### `GET /events`

Server-Sent Events stream of all runtime events. Useful for live
dashboards. Emits on every tick, sleep transition, memory injection,
persona swap, and error. Keep-alive ping every 15s; stale clients pruned
after 5 min.

Event types:

| event | emitted when |
|---|---|
| `connected` | SSE handshake complete (initial state snapshot) |
| `tick` | every cognition cycle (action, reason, result, internal state) |
| `sleep` | sleep cycle started |
| `wake` | agent woke up |
| `memory` | memory written (injected via API or remembered by agent) |
| `persona` | persona hot-swapped |
| `error` | tick failed |
| `started` | agent boot complete |

---

## Test results

### Pre-handover smokes (2026-05-12)

Two fresh runs after the mood/energy rename + de-AI pass. Raw files in
`test-results/diligence/`.

#### Module-level smoke

Direct instantiation of the five core cognitive modules with mocked
dependencies. Verifies the post-rename JSON shape, asymmetric reward
behaviour, working-memory event merging, repetition-guard pattern
detection, delta-detector diffing, felt-experience signal translation.

**Modules exercised**: `InternalState`, `WorkingMemory`,
`RepetitionGuard`, `DeltaDetector`, `Perceive`.

**Result**: all five modules produce expected output. `mood` / `energy`
/ `moodLabel` / `energyLabel` fields confirmed in `describe()` output.
Asymmetric reward visible (success +0.02, failure -0.15). Speech
creativity feedback applies through the affect channel (-0.08 for
repetitive, +0.03 for novel). Action+result events merged into one
working-memory slot. Three independent fixation patterns fired on 4x
identical `move_to(wander)`. Felt-experience translation maps
`vitality: 0.7` → "healthy energy ... vibrant" before the LLM sees it.

**Full report**: `test-results/diligence/smoke-2026-05-12.md`
**Raw output**: `test-results/diligence/smoke-2026-05-12.txt`

#### Integration smoke

Full end-to-end pipeline: test environment server + agent, 4 real ticks
via Ollama (`llama3.2:3b`, since the local `.env` has no Groq key).

**Run shape**:

| | |
|---|---|
| Duration | 51 seconds |
| Ticks completed | 4 |
| Boot to first tick | < 1 second |
| Adaptive heartbeat range | 8000ms (base) → 13319ms (final, low energy) |
| Tier routing | 1× skip (boot tick), 3× fast (ollama), 0× quality |
| Resident memory | 44.6 MB (heap: 10/11.5 MB) |
| Persona drift baseline | saved on first boot (`data/persona-baseline.json`) |
| WebSocket protocol round-trips | 4× clean `OBSERVE → OBSERVATION → ACT → ACTION_RESULT` |

**Verified pass/fail**:

| check | result |
|---|---|
| Agent boots without import or config errors | ✅ |
| All cognitive modules initialise | ✅ |
| Persona loads from JSON | ✅ |
| Drift guard saves immutable baseline on first boot | ✅ |
| Ollama connection succeeds | ✅ |
| WebSocket connects + completes IDENTIFY handshake | ✅ |
| API listens on port 5000 | ✅ |
| Tick routes to `fallback/skip` correctly (boot tick) | ✅ |
| Tick routes to `ollama/fast` with real LLM call | ✅ |
| Internal state updates per tick (asymmetric reward visible) | ✅ |
| `/status` returns renamed fields (no straggling `valence`/`arousal`) | ✅ |
| `/metrics` returns renamed fields | ✅ |
| Adaptive heartbeat slows in low-energy state | ✅ |
| Memory files created on first boot | ✅ |
| Graceful shutdown on SIGTERM | ✅ |
| Heap stays small (fits Pi 4GB) | ✅ |

**Full report**: `test-results/diligence/integration-smoke-2026-05-12.md`

### Historical test runs (2026-03)

68 raw + report files in `test-results/` from the v0.2 → v0.3.7
development period. Selection of the more substantive runs:

| file | date | duration | scope |
|---|---|---|---|
| `2026-03-14T16-04-21-*` | 2026-03-14 | 45 min | v0.3.1 readiness audit validation |
| `soak-2026-03-14T19-29-50-*` | 2026-03-14 | 8 hrs | overnight stability, 1948 ticks, 31 sleep/wake transitions, zero crashes |
| `2026-03-15T*` | 2026-03-15 | 45 min × multiple | v0.3.5 first zero-hallucination run with 70B model |

These predate the mood/energy rename. Reports reference the old field
names (`valence`, `arousal`) in their raw JSON and prose. The substance
and structure of agent behaviour they document is unchanged by the
rename — the underlying cognitive loop is the same code. Treat them as
historical evidence of stability over hours, not as current API-shape
documentation.

The 8-hour overnight soak in particular is the most informative single
run for stability evidence: zero crashes, zero WebSocket disconnects,
mood (then valence) ranged -0.22 to +0.40 across the 5 phase cycles,
memory consolidated from 15 to 10 entries across the 31 sleep cycles
(the consolidation pass is pruning, as designed).

---

## How to reproduce

Setup is detailed in `QUICKSTART.md`. Minimum path:

```bash
git clone https://github.com/frommybrain/agent-runtime
cd agent-runtime
npm install
cp .env.example .env
# edit .env, set CLOUD_API_KEY (ask Sam) or use Ollama only
```

Two-terminal workflow for the controlled scenario suite:

```bash
# terminal 1
node test-suite.js     # WebSocket env server, drives 10 scripted scenarios

# terminal 2
npm start              # the agent, connects to the test server
```

The suite runs for ~5-10 min against Groq, ~50 min against Ollama only.
Writes a report to `test-results/<timestamp>-report.md` and raw JSON to
`<timestamp>-raw.json`.

For the long-running stability test:

```bash
SOAK_HOURS=2 node soak-test.js   # default 2 hours; SOAK_HOURS=8 for overnight
```

Phase-cycles environmental scenarios for the duration, exercises sleep
consolidation, dumps a soak report.

---

## Where to dig next

For deeper evaluation:

- `docs/agent-runtime-overview.md` — primary architecture reference
- `docs/CODEBASE_AUDIT_MEMO.md` — self-audit against the four
  patent-relevant items, with file/line evidence
- `docs/ENVIRONMENT_PROTOCOL.md` — the WebSocket contract for any
  environment that wants to host a 3aiii agent
- `docs/PROGRESS-2026-03-14-15.md` — 500-line retrospective covering
  v0.2 → v0.3.7. Documents the failure modes that drove the design

For questions: Sam Skirrow — sam.skirrow@gmail.com.
