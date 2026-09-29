# 3aiii: Endpoints and test results

Captured 2026-05-12 against the diligence-ready `main` branch.
For orientation see `handover.md`; for the step-by-step run path see `quickstart.md`.

## Environment

| | |
|---|---|
| Branch / commit | `main` at `60ca9fd` |
| Runtime version | `3aiii v0.3.10` (boot banner) |
| Repository | https://github.com/frommybrain/agent-runtime |
| Reference deployment target | Raspberry Pi 5 with Ollama + Groq cloud |
| Smoke host (this session) | macOS, Node 24.1.0, local Ollama 0.5.18 |
| Cloud model (production default) | `openai/gpt-oss-120b` (quality), `openai/gpt-oss-20b` (fast), via Groq |
| Local model (fallback default) | `qwen3:4b` (Ollama) |
| Direct dependencies | `ws@8.19.0`, `ollama@0.5.18`, `dotenv@16.6.1`, see `sbom/` |
| Persona under test | Victor (`personas/victor.json`) |

---

## API endpoints

The runtime serves a small HTTP API on port 5000 (default). All
endpoints are unauthenticated today; production hardening adds auth and
rate limiting.

### `GET /status`

Current internal state, tick count, recent actions. Used by dashboards
and operators.

Sample response (captured during the integration smoke, 4 ticks in; the `description` string is left out):

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
    "energyLabel": "moderate"
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
  (renamed from `valence`/`arousal` on 2026-05-12; the historical reports
  below use the old names)
- `heartbeatMs`: current adaptive tick interval, 4000-15000ms
- `tickCount`: keeps counting across restarts (persisted in the state checkpoint)

### `GET /memory`

The three persistent markdown files (memory.md, skills.md, tools.md).
Sleep-cycle consolidation rewrites them.

Sample response shape:

```json
{
  "memory": "# Victor's Memory\n\n## Relationships\n\n## Learned Facts\n- ...",
  "skills": "# Victor's Skills\n- ...",
  "tools": "# Available Actions\n- ...\n\n# Nearby Objects (GROUND TRUTH ...)"
}
```

### `POST /memory/remember`

Inject a memory entry into the agent's long-term store.

Request:

```json
{ "section": "Learned Facts", "content": "the terminal at -5,10 is interactive" }
```

Allowed sections: `"Relationships"`, `"Learned Facts"`,
`"Important Memories"`. Anything else returns `400`.

### `GET /logs/today`

Today's daily log as plain text, the tick history line by line. It's
buffered in RAM and flushed to disk periodically to spare the Pi's SD card.

### `POST /sleep`

Trigger the sleep cycle now. Runs the four passes (memory consolidation,
skill extraction, self-reflection with drift guard, daily-log GC). Returns
`409` if the agent is already asleep.

### `POST /wake`

Wake from sleep early. Returns `409` if the agent isn't asleep.

### `PUT /persona`

Hot-swap the active persona. The body is a full persona JSON, checked for
the required fields (`id`, `name`). The PromptBuilder uses the new
persona from the next tick.

### `GET /metrics`

Runtime metrics for observability: tier counts (which model tier each
tick went to), buffer usage, heap usage, prompt size.

Sample response (from the integration smoke):

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

Server-Sent Events stream of all runtime events, for live dashboards.
Emits on every tick, sleep transition, memory injection, persona swap,
and error. Keep-alive ping every 15s; stale clients are dropped after
5 min.

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

Two fresh runs after the mood/energy rename. Raw files are in
`test-results/diligence/`.

#### Module-level smoke

Direct instantiation of the five core cognitive modules with mocked
dependencies. Checks the post-rename JSON shape, asymmetric reward
behaviour, working-memory event merging, repetition-guard pattern
detection, delta-detector diffing, and felt-experience signal translation.

Modules exercised: `InternalState`, `WorkingMemory`,
`RepetitionGuard`, `DeltaDetector`, `Perceive`.

Result: all five modules produce the expected output. The `mood` /
`energy` / `moodLabel` / `energyLabel` fields are confirmed in the
`describe()` output. Asymmetric reward is visible (success +0.02,
failure -0.15). Speech creativity feedback applies through the affect
channel (-0.08 for repetitive, +0.03 for novel). Action and result events
are merged into one working-memory slot. Three independent fixation
patterns fired on 4x identical `move_to(wander)`. Felt-experience
translation maps `vitality: 0.7` to "healthy energy ... vibrant" before
the LLM sees it.

Full report: `test-results/diligence/smoke-2026-05-12.md`
Raw output: `test-results/diligence/smoke-2026-05-12.txt`

#### Integration smoke

The full pipeline end to end: test environment server plus agent, 4 real
ticks via Ollama (`llama3.2:3b`, because the local `.env` has no Groq key).

Run shape:

| | |
|---|---|
| Duration | 51 seconds |
| Ticks completed | 4 |
| Boot to first tick | < 1 second |
| Adaptive heartbeat range | 8000ms (base) to 13319ms (final, low energy) |
| Tier routing | 1 skip (boot tick), 3 fast (ollama), 0 quality |
| Resident memory | 44.6 MB (heap: 10/11.5 MB) |
| Persona drift baseline | saved on first boot (`data/persona-baseline.json`) |
| WebSocket protocol round-trips | 4 clean `OBSERVE`, `OBSERVATION`, `ACT`, `ACTION_RESULT` cycles |

Checks:

| check | result |
|---|---|
| Agent boots without import or config errors | pass |
| All cognitive modules initialise | pass |
| Persona loads from JSON | pass |
| Drift guard saves immutable baseline on first boot | pass |
| Ollama connection succeeds | pass |
| WebSocket connects and completes IDENTIFY handshake | pass |
| API listens on port 5000 | pass |
| Tick routes to `fallback/skip` correctly (boot tick) | pass |
| Tick routes to `ollama/fast` with real LLM call | pass |
| Internal state updates per tick (asymmetric reward visible) | pass |
| `/status` returns renamed fields (no leftover `valence`/`arousal`) | pass |
| `/metrics` returns renamed fields | pass |
| Adaptive heartbeat slows in low-energy state | pass |
| Memory files created on first boot | pass |
| Clean shutdown on SIGTERM | pass |
| Heap stays small (fits Pi 4GB) | pass |

Full report: `test-results/diligence/integration-smoke-2026-05-12.md`

### Historical test runs (2026-03)

68 raw and report files in `test-results/` from the v0.2 to v0.3.7
development period. A selection of the more substantive runs:

| file | date | duration | scope |
|---|---|---|---|
| `2026-03-14T16-04-21-*` | 2026-03-14 | 45 min | v0.3.1 readiness audit validation |
| `soak-2026-03-14T19-29-50-*` | 2026-03-14 | 8 hrs | overnight stability, 1948 ticks, 31 sleep/wake transitions, zero crashes |
| `2026-03-15T*` | 2026-03-15 | 45 min, several runs | v0.3.5 first zero-hallucination run with 70B model |

These predate the mood/energy rename. The reports use the old field
names (`valence`, `arousal`) in their raw JSON and prose. The rename
doesn't change the substance or structure of the agent behaviour they
document; the underlying cognitive loop is the same code. Treat them as
historical evidence of stability over hours, not as documentation of the
current API shape.

The 8-hour overnight soak is the most informative single run for
stability: zero crashes, zero WebSocket disconnects, mood (then valence)
ranging from -0.22 to +0.40 across the 5 phase cycles, and memory
consolidated from 15 to 10 entries across the 31 sleep cycles (the
consolidation pass prunes, as designed).

---

## How to reproduce

Setup is covered in `quickstart.md`. The minimum:

```bash
git clone https://github.com/frommybrain/agent-runtime
cd agent-runtime
npm install
cp .env.example .env
# edit .env, set CLOUD_API_KEY (ask 3eyes) or use Ollama only
```

Two terminals for the controlled scenario suite:

```bash
# terminal 1
node test-suite.js     # WebSocket env server, drives 10 scripted scenarios

# terminal 2
npm start              # the agent, connects to the test server
```

The suite runs for ~5-10 min against Groq, ~50 min against Ollama only.
It writes a report to `test-results/<timestamp>-report.md` and raw JSON to
`<timestamp>-raw.json`.

For the long-running stability test:

```bash
SOAK_HOURS=2 node soak-test.js   # default 2 hours; SOAK_HOURS=8 for overnight
```

This cycles through environmental scenarios for the duration, exercises
sleep consolidation, and writes a soak report.

---

## Where to dig next

For a deeper evaluation:

- `3aiii-overview.md`: the main architecture reference
- `codebase-audit-memo.md`: self-audit against the four
  patent-relevant items, with file/line evidence
- `environment-protocol.md`: the WebSocket contract for any
  environment that wants to host a 3aiii agent

Questions: 3eyes, iii@3eyes.world.
