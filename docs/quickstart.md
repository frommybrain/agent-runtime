# Quickstart

Clone it, run it against the little test server, watch it think. Under 10 minutes on anything with Node 20+. This is for trying it out locally; for a Pi see `setup-pi.sh`.

You need Node 20+ and ideally a Groq API key (free tier at groq.com is fine). Without a key it can run on a local Ollama model, see below.

## Install

```bash
git clone <repo-url> agent-runtime
cd agent-runtime
npm install
```

Three dependencies (ws, ollama, dotenv), no build step.

## Configure

```bash
cp .env.example .env
```

Then in `.env`:

```
AGENT_ID=victor
PERSONA_PATH=./personas/victor.json
SERVER_URL=ws://localhost:4001
CLOUD_API_KEY=<your-groq-key>
CLOUD_API_URL=https://api.groq.com/openai/v1/chat/completions
```

Local model only: leave `CLOUD_API_KEY` empty and get Ollama running with `qwen3:4b`:

```bash
brew install ollama   # or see ollama.com
ollama serve &
ollama pull qwen3:4b
```

## Start the test server

Terminal one:

```bash
node test-server.js
```

It listens on port 4001, speaks the agent protocol, and logs every message both ways to `test-logs/<timestamp>.jsonl`. It also takes single keys (type the key, then Enter) so you can poke the world:

- `o` add an interactive object
- `r` remove an object
- `s` a stranger says something
- `c` toggle the cosmology signals
- `f` make the next action fail
- `x` switch between synth and spatial mode
- `q` quit

## Start the agent

Terminal two:

```bash
npm start
```

Boot looks roughly like this (trimmed):

```
=== 3aiii v0.3.10 ===
Agent: victor
Server: ws://localhost:4001
LLM: quality=openai/gpt-oss-120b, fast=openai/gpt-oss-20b, local=qwen3:4b
Heartbeat: 8000ms base (adaptive 4000-15000ms)
Sleep: 0.83h active / 10m sleep
Persona loaded: Victor (thoughtful, watchful, private, ...)
...
Connected
Identified. World bounds: ±100
```

After that you get a `[tick N]` line every 4-15 seconds with the action, which source and tier answered, the reason, and current mood/energy as `v=` and `a=`.

## Watch it

Terminal three. The API is on localhost:5000:

```bash
# state, recent actions, uptime
curl http://localhost:5000/status | jq

# live events
curl -N http://localhost:5000/events

# today's log
curl http://localhost:5000/logs/today

# memory.md, skills.md, tools.md
curl http://localhost:5000/memory | jq

# tier counts, buffer sizes, heap
curl http://localhost:5000/metrics | jq
```

The bit of `/status` worth watching is `internalState`:

```json
{
  "internalState": {
    "mood": 0.12,
    "energy": 0.45,
    "moodLabel": "neutral",
    "energyLabel": "elevated",
    "regime": null,
    "description": "Head up, checking everything twice"
  }
}
```

## Poke it

In the test server terminal:

- `o` then Enter: energy should jump and it should go for the object within a tick or two
- `s`: energy bumps, it may answer with `speak`
- `c`: low vitality, high resonance. mood should drop and energy climb
- `f`: the next action fails. mood dips and it should try something else next tick

## Make it sleep

No need to wait for the timer:

```bash
curl -X POST http://localhost:5000/sleep
```

Ticks stop. It dedups `memory.md`, has the LLM rewrite it from the daily log and working memory, pulls procedural patterns into `skills.md`, reflects on the persona (the drift guard checks any change, and it only does this once every 12h by default), updates the thread it's carrying, and deletes old logs. In the agent's terminal:

```
=== SLEEP STARTED === (active for 12.4 min)
Memory consolidated
Skills extracted
Self-reflection: no evolution needed
...
Sleeping for 10 minutes...
```

If the persona's evolution log shows a change in the last 12 hours you'll get `Self-reflection: deferred` instead.

Wake it early:

```bash
curl -X POST http://localhost:5000/wake
```

Then compare `./data/memory.md`, `./data/skills.md` and `./data/tools.md` with `./data/logs/<today>.md`.

## Swap the persona

```bash
curl -X PUT http://localhost:5000/persona \
  -H "Content-Type: application/json" \
  -d @personas/sharay.json
```

The voice changes on the next tick. Internal state carries on as it was, only the persona's response to it is different.

## Longer runs

Both of these run their own env server on port 4001, so stop `test-server.js` first. They also poll the agent at `victor.local:5000` unless you point them somewhere else.

The scripted suite, ten scenarios, report goes to `test-results/`, about 12 minutes:

```bash
AGENT_STATUS_URL=http://localhost:5000/status node test-suite.js
```

A soak test cycles through enviroment phases for as long as `SOAK_HOURS` says (default 2) and exercises sleep. Start the agent with a short sleep cycle so you actually see some:

```bash
ACTIVE_HOURS_BEFORE_SLEEP=0.5 SLEEP_DURATION_MINUTES=5 npm start
AGENT_STATUS_URL=http://localhost:5000 SOAK_HOURS=1 node soak-test.js
```

The longer soak runs have been 2-12 hours. For the unit tests, `npm test`.

After that, `3aiii-overview.md` covers the architecture and `environment-protocol.md` is what to read if you want to plug it into your own world.

## When it goes wrong

`Failed to load persona`: `PERSONA_PATH` has to point at a real file in `personas/`.

`Cloud API 401` or `403`: `CLOUD_API_KEY` is missing or wrong. Fix it, or remove it and use Ollama.

`Cloud API rate limited (429)`: Groq's free tier limit. It cools down for 60 seconds and uses Ollama in the meantime if it's there. Without Ollama it goes quiet for a minute and then recovers.

Boots but never connects: check `test-server.js` is running on 4001 and `SERVER_URL` in `.env` matches.

Slow ticks: Ollama alone on a small machine is 30-60 seconds a tick. With a cloud key it's 2-3 seconds.

Errors about the data dir: `./data/` has to be writable. The first run creates it.
