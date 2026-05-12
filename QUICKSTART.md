# Quickstart

Goal: clone the repo, install dependencies, run the agent, watch a thinking
cycle. Should take under 10 minutes on any Node 20+ machine.

This guide assumes you're evaluating the codebase, not deploying it. For
production deployment on a Raspberry Pi, see `setup-pi.sh` and the README.

---

## What you need

- **Node 20+** (`node --version` to check)
- **A Groq API key.** For diligence evaluation, email Sam
  (sam.skirrow@gmail.com) and he'll send the production key when he grants
  repo access — pastes straight into `.env`, no signup needed. Or sign up
  yourself at groq.com (free tier, ~2 minutes, same rate limits) if you'd
  rather use your own. Optional if you want to use a local model only —
  see "Without a cloud key" below
- **5-10 minutes**

---

## Step 1 — Install

```bash
git clone <repo-url> agent-runtime
cd agent-runtime
npm install
```

Three dependencies (ws, ollama, dotenv) install in ~10 seconds. No build
step, no transpilation.

---

## Step 2 — Configure

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```
AGENT_ID=victor
PERSONA_PATH=./personas/victor.json
SERVER_URL=ws://localhost:4001
CLOUD_API_KEY=<your-groq-key>
CLOUD_API_URL=https://api.groq.com/openai/v1/chat/completions
```

If you want to use only a local model, leave `CLOUD_API_KEY` blank and
install Ollama with `qwen3:4b`:

```bash
brew install ollama   # or follow instructions at ollama.com
ollama serve &
ollama pull qwen3:4b
```

---

## Step 3 — Start the test environment server

In one terminal:

```bash
node test-server.js
```

You'll see:

```
🧪 Test environment server running on ws://0.0.0.0:4001
📝 Logging to test-logs/<timestamp>.jsonl

Keyboard controls:
  o  — add interactive object
  r  — remove object
  s  — send speech from stranger
  c  — toggle cosmology signals
  f  — next action will fail
  x  — toggle synth/spatial mode
  q  — quit
```

This is a minimal WebSocket server that speaks the agent protocol. It logs
every message in both directions to `test-logs/`. You can drive it from the
keyboard to test different scenarios.

---

## Step 4 — Start the agent

In a second terminal:

```bash
npm start
```

You should see boot output:

```
=== 3aiii v0.3.10 ===
Agent: victor
Server: ws://localhost:4001
LLM: quality=openai/gpt-oss-120b, fast=openai/gpt-oss-20b, local=qwen3:4b
Heartbeat: 8000ms base (adaptive 4000-15000ms)
Sleep: 0.83h active / 10m sleep
Persona loaded: Victor (thoughtful, watchful, private, ...)
Connecting to ws://localhost:4001
Connected
Identified. World bounds: ±100
Heartbeat started (8000ms base, adaptive 4000-15000ms)
3aiii running — API on http://localhost:5000
```

The agent is now thinking. You'll see tick output every 4-15 seconds:

```
[tick 1] move_to (cloud/fast) — exploring the empty world [v=0.00 a=0.00]
[tick 2] wait (cloud/fast) — nothing here to interact with [v=-0.02 a=0.05]
...
```

---

## Step 5 — Watch what it's doing

In a third terminal:

```bash
# current internal state, recent actions, uptime
curl http://localhost:5000/status | jq

# live event stream
curl -N http://localhost:5000/events

# today's full activity log
curl http://localhost:5000/logs/today

# the three memory files
curl http://localhost:5000/memory | jq

# operational metrics (LLM tier counts, buffer sizes, heap)
curl http://localhost:5000/metrics | jq
```

The `internalState` block in `/status` is the key signal:

```json
{
  "internalState": {
    "mood": 0.12,
    "energy": 0.45,
    "moodLabel": "neutral",
    "energyLabel": "elevated",
    "description": "Feeling alert and engaged — something has your attention"
  }
}
```

---

## Step 6 — Drive a scenario

In the test-server terminal, press keys to inject changes:

- **`o` + Enter** — adds an interactive object. Agent's energy should spike;
  it should try to interact within a tick or two
- **`s` + Enter** — sends a speech event from a stranger. Agent's energy
  bumps; it may respond with `speak`
- **`c` + Enter** — toggles environment signals (low vitality + high
  resonance). Mood should drop, energy should climb
- **`f` + Enter** — next action will fail. Watch the mood dip and the
  agent try something different on the next tick

The full controlled-scenario suite is `node test-suite.js`. It runs ten
scripted scenarios and writes a report to `test-results/`. Takes about
12 minutes.

---

## Step 7 — Trigger a sleep cycle

To watch consolidation happen without waiting an hour:

```bash
curl -X POST http://localhost:5000/sleep
```

The agent stops ticking and runs through four passes:

1. Memory consolidation (LLM reads daily log + working memory, rewrites memory.md)
2. Skill extraction (LLM extracts procedural patterns into skills.md)
3. Self-reflection (LLM proposes persona changes, drift guard validates)
4. Daily log garbage collection

Watch in the agent's terminal:

```
=== SLEEP STARTED === (active for 12.4 min)
Memory consolidated
Skills extracted
Self-reflection: no evolution needed
Sleeping for 10 minutes...
```

To wake it early:

```bash
curl -X POST http://localhost:5000/wake
```

Memory files in `./data/memory.md`, `./data/skills.md`, `./data/tools.md`
should now show consolidated content. Compare them to the daily log in
`./data/logs/<today>.md`.

---

## Step 8 — Try a different persona

```bash
curl -X PUT http://localhost:5000/persona \
  -H "Content-Type: application/json" \
  -d @personas/sharay.json
```

The agent's voice will change within one tick. The internal state
continues unchanged — only the persona-driven response to it shifts.

---

## What to do next

- **Run the controlled test suite:** `node test-suite.js`. Drives the
  agent through 10 scripted scenarios; saves a report to `test-results/`
- **Run a soak test:** `SOAK_HOURS=1 node soak-test.js`. Cycles through
  environmental phases for an hour, exercises the sleep cycle, dumps
  metrics. The standard buyer-facing soak runs are at 2-12 hours
- **Read the architecture overview:** `docs/agent-runtime-overview.md`
- **Read the protocol spec:** `docs/ENVIRONMENT_PROTOCOL.md` if you want
  to wire this to your own environment

---

## Troubleshooting

**"Failed to load persona"** — make sure `PERSONA_PATH` in `.env` points
to a real file in `personas/`.

**"Cloud API 401" or "403"** — `CLOUD_API_KEY` is missing or invalid.
Either fix it or remove the key from `.env` and use Ollama locally.

**"Cloud API 429"** — Groq's free tier rate limit hit. The agent will
cool down for 60 seconds and fall back to Ollama if available. If you
don't have Ollama, the agent will go quiet for a minute and recover.

**Agent boots but doesn't connect** — check `test-server.js` is running
on port 4001 and `SERVER_URL` in `.env` matches.

**Ticks are slow** — if you're using only Ollama (no cloud key) on a
small machine, expect 30-60 seconds per tick. Set `CLOUD_API_KEY` for
2-3 second ticks.

**Memory dir errors** — make sure `./data/` exists and is writable.
First run will create it.
