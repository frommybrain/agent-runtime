# agent-runtime

Portable autonomous agent cognition runtime. Runs on Raspberry Pi 5 (or any Node.js host). Environment-agnostic — plug it into any project by implementing the WebSocket protocol.

## What it does

Each instance is one agent with a persistent identity, memory, and LLM-driven cognition loop:

```
OBSERVE (get world state) → THINK (LLM decides) → ACT (send action) → repeat
```

Every 4 hours, the agent sleeps for 1 hour. During sleep, the LLM consolidates memory, extracts skills, and cleans up logs automatically.

## Setup

```bash
npm install
cp .env.example .env
# edit .env — set AGENT_ID, SERVER_URL, OLLAMA_MODEL
npm start
```

Requires [Ollama](https://ollama.com) running locally with a model pulled:
```bash
ollama pull llama3.2:3b
```

## HTTP API

The agent exposes a local REST API (default port 5000):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/status` | Agent state, tick count, uptime, recent actions |
| `GET` | `/memory` | All three memory files (memory.md, skills.md, tools.md) |
| `POST` | `/memory/remember` | Inject a memory: `{ section, content }` |
| `GET` | `/logs/today` | Today's daily log (plain text) |
| `POST` | `/sleep` | Trigger sleep cycle immediately |
| `POST` | `/wake` | Wake agent early |
| `PUT` | `/persona` | Hot-swap persona JSON |
| `GET` | `/events` | SSE stream of all runtime events |

### SSE events

Connect to `GET /events` for a live event stream:

```
event: tick       — every cognition cycle (action, reason, result)
event: sleep      — sleep started
event: wake       — agent woke up
event: memory     — memory written (injected or LLM-remembered)
event: persona    — persona swapped
event: error      — tick failed
event: connected  — initial state on SSE connect
```

## Environment protocol

The environment server must implement this WebSocket protocol on its agent port:

| Direction | Message | Description |
|-----------|---------|-------------|
| → server | `{ type: "IDENTIFY", agentId, name }` | Register agent on connect |
| ← server | `{ type: "IDENTIFIED", worldBounds }` | Confirm registration |
| → server | `{ type: "OBSERVE" }` | Request current world state |
| ← server | `{ type: "OBSERVATION", data: { self, nearbyAgents, nearbyObjects, recentSpeech, available_actions } }` | World state snapshot |
| → server | `{ type: "ACT", action, params }` | Perform an action |
| ← server | `{ type: "ACTION_RESULT", success, message }` | Action outcome |

The `available_actions` field tells the agent what it can do right now:
```json
[
  { "name": "move_to", "params": "x, z", "description": "Move to world coordinates" },
  { "name": "speak", "params": "message", "description": "Say something to nearby agents" },
  { "name": "interact", "params": "objectId", "description": "Interact with a nearby object" }
]
```

## Memory files

Three persistent markdown files in `./data/`:

- **memory.md** — episodic memory (relationships, learned facts, important moments)
- **skills.md** — procedural knowledge (how to do things)
- **tools.md** — auto-populated with available actions and discovered objects

Daily logs in `./data/logs/YYYY-MM-DD.md`. Files older than 7 days are garbage collected during sleep.

## Multi-agent setup

Each Pi runs one agent instance. Use different ports and persona files:

```bash
# Pi 1 — pip
AGENT_ID=pip PERSONA_PATH=./personas/pip.json API_PORT=5001 npm start

# Pi 2 — bean
AGENT_ID=bean PERSONA_PATH=./personas/bean.json API_PORT=5002 npm start
```

## Personas

Persona files in `./personas/*.json`:
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
