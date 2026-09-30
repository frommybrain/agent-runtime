# 3aiii

Cognition runtime for one autonomous agent. A process is one agent: a persona file, a few markdown files of memory, and a loop that asks an LLM what to do next. It talks to its world over a small WebSocket protocol and doesnt care what the world is.

The repo and package are still called `agent-runtime`. In production it runs Pino, a kiwi who lives in a small town at pinos.world, on a Raspberry Pi 5, but it's plain Node ESM with no build step, so anything with Node 20+ will run it. One process is one agent, so running another is just another process with its own `AGENT_ID`, persona and `DATA_DIR`.

## How it works

Each tick it asks the world for an observation, diffs it against the last one, updates mood and energy, asks the model for an action, sends it, and carries the result into the next tick. The tick interval moves between 4s and 15s depending on energy.

Not every tick costs the same. Nothing new happening means no LLM call at all. Routine ticks go to a small cloud model (`fast`), bigger moments (world events, repetition warnings) go to the `quality` model, and local Ollama picks up when the cloud is down or rate limited. There's also an optional `decision` tier on the Anthropic API for high-stakes ticks: the world opts in by sending `signals.decision_pending >= 0.5`, and without `ANTHROPIC_API_KEY` set it just uses the quality chain.

A repetition guard watches the recent actions and speech. When it spots a fixation it tells the model in the next prompt, and a hard block redirects if that doesn't work.

It also sleeps. If the observation carries a `world_clock` it sleeps once per world night, until the world says it's morning. Without one it's a timer: `ACTIVE_HOURS_BEFORE_SLEEP` awake (default 0.83), `SLEEP_DURATION_MINUTES` asleep (default 10). Sleep dedups and consolidates `memory.md`, pulls skills into `skills.md`, lets the persona evolve a little (checked against a saved baseline so it can't drift too far, and at most once every `PERSONA_EVOLUTION_MIN_HOURS`, 12 by default) and clears out old logs.

## Setup

```bash
npm install
cp .env.example .env
# set AGENT_ID, PERSONA_PATH, SERVER_URL, and CLOUD_API_KEY + CLOUD_API_URL
npm start
```

The cloud side is any OpenAI-style chat completions endpoint. Defaults are Groq's `openai/gpt-oss-120b` for quality and `openai/gpt-oss-20b` for fast (`CLOUD_MODEL`, `CLOUD_MODEL_FAST`). For the local fallback, run Ollama with the default model pulled:

```bash
ollama pull qwen3:4b
```

With no cloud key it runs on Ollama alone, just slowly (30-60s a tick on a Pi).

`docs/quickstart.md` walks through running it against the bundled test server. `npm test` runs the unit tests in `test/`.

## HTTP API

Default port 5000, bound to 127.0.0.1 unless `API_HOST` says otherwise. If `ADMIN_TOKEN` is set, POST and PUT need `Authorization: Bearer <ADMIN_TOKEN>`. GETs stay open. Don't bind to 0.0.0.0 without a token, it will warn you.

- `GET /status` state, tick count, uptime, recent actions
- `GET /memory` memory.md, skills.md and tools.md
- `POST /memory/remember` inject a memory, body `{ section, content }`
- `GET /logs/today` today's daily log as plain text
- `POST /sleep` sleep now
- `POST /wake` wake early
- `PUT /persona` hot-swap the persona JSON
- `GET /metrics` tier counts, the day's usage, buffer sizes, heap
- `GET /events` SSE stream

SSE events: `connected` (initial state), `started`, `tick`, `sleep`, `wake`, `memory`, `persona`, `error`.

## Environment protocol

The world runs a WebSocket server. The short version:

- server sends `WELCOME`
- agent sends `{ type: "IDENTIFY", agentId }`, plus `token` when `ADMIN_TOKEN` is set
- server replies `{ type: "IDENTIFIED", worldBounds }`
- each tick: agent sends `{ type: "OBSERVE" }`, server replies `{ type: "OBSERVATION", data: { self, nearbyAgents, nearbyObjects, available_actions, signals, recentSpeech } }`
- agent sends `{ type: "ACT", action, params }`, server replies `{ type: "ACTION_RESULT", success, message }`
- server can push `WORLD_EVENT` any time

`available_actions` is what the agent is allowed to do right now:

```json
[
  { "name": "move_to", "params": "x, z", "description": "Move to world coordinates" },
  { "name": "speak", "params": "message", "description": "Say something to nearby agents" },
  { "name": "interact", "params": "objectId", "description": "Interact with a nearby object" }
]
```

Full spec in `docs/environment-protocol.md`.

## Keeping it cheap

Every tick a model decides costs money, so the cheapest tick is one that never asks. Roughly in order of how much they save:

- let the world keep it asleep. An observation with `self.asleep: true` never goes to a model, so a world that only wakes its agent when something is happening (someone walks up, a screen gets switched on) pays for those moments and nothing in between. A `WORLD_EVENT` with `wake: true` makes it act straight away instead of on its next interval, the same as speech does
- nothing new, no call. A tick with no change and no action result to read goes to the skip tier, so actions that change nothing should come back without a `message`
- the small model for routine ticks (`fast`), `quality` only for the moments that matter
- a ceiling. `DAILY_CALL_BUDGET` and `DAILY_TOKEN_BUDGET` cap paid calls per UTC day (0 = no cap). The count is kept in `data/usage.json` so a restart doesnt reset it. Once its spent the agent gets local Ollama if there is one, otherwise FallbackBrain, which never speaks. `GET /metrics` shows the day so far under `usage`
- a sleep with nothing to sleep on is free. If no model decided anything since the agent last woke, sleep skips the consolidation passes

## Memory

Everything lives under `./data/` (`DATA_DIR`):

- `memory.md` relationships, learned facts, important moments
- `skills.md` how-to knowledge pulled out during sleep
- `tools.md` rebuilt from the live observation, available actions and nearby objects
- `logs/YYYY-MM-DD.md` daily logs, deleted after 7 days
- `decisions/YYYY-MM-DD.jsonl` one line per decision, kept `DECISION_LOG_DAYS` (14). `node scripts/decisions.mjs` summarises a day, or `--days N`
- `persona-baseline.json` the persona as it was on first boot, what the drift guard compares against

## More than one agent

One agent per process. Give each its own id, persona and port:

```bash
# pi 1
AGENT_ID=pip PERSONA_PATH=./personas/pip.json API_PORT=5001 npm start

# pi 2
AGENT_ID=bean PERSONA_PATH=./personas/bean.json API_PORT=5002 npm start
```

## Personas

JSON files in `./personas/`. The shape:

```json
{
  "id": "npc_pip",
  "name": "Pip",
  "traits": ["curious", "cautious", "observant"],
  "values": ["discovery", "safety"],
  "fears": ["sudden movements"],
  "quirks": ["tilts head when confused"],
  "voice": { "style": "thoughtful and hesitant", "vocabulary": ["hmm", "interesting"] },
  "backstory": "..."
}
```

`voice.canon` (an array of lines) replaces the default rules for the reason field if a persona needs different ones.
