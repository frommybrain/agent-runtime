# Environment Protocol Standard

Version 1.0 — Agent Runtime ↔ Environment Contract

Any environment (3D world, synth bridge, data stream, game engine) that wants to host an agent-runtime agent must implement this WebSocket protocol.

---

## Connection Lifecycle

```
Environment                          Agent Runtime
    │                                      │
    │◄──── WebSocket connect ──────────────│
    │                                      │
    ├─── WELCOME ─────────────────────────►│
    │                                      │
    │◄──── IDENTIFY {agentId} ─────────────│
    │                                      │
    ├─── IDENTIFIED {worldBounds, ...} ───►│
    │                                      │
    │         ┌─── tick loop ───┐          │
    │◄────────│ OBSERVE         │──────────│
    ├─────────│ OBSERVATION     │─────────►│
    │◄────────│ ACT             │──────────│
    ├─────────│ ACTION_RESULT   │─────────►│
    │         └─────────────────┘          │
    │                                      │
    ├─── WORLD_EVENT (async, any time) ───►│
    │                                      │
```

### Message Types

| Direction | Type | Description |
|-----------|------|-------------|
| env → agent | `WELCOME` | Server ready, agent should identify |
| agent → env | `IDENTIFY` | `{type: "IDENTIFY", agentId: "victor"}` |
| env → agent | `IDENTIFIED` | Confirmation + world metadata |
| agent → env | `OBSERVE` | Request current observation |
| env → agent | `OBSERVATION` | Full observation snapshot |
| agent → env | `ACT` | `{type: "ACT", action: "move_to", params: {...}}` |
| env → agent | `ACTION_RESULT` | `{type: "ACTION_RESULT", success: true, message: "..."}` |
| env → agent | `WORLD_EVENT` | Async events (speech, spawns, weather) |
| env → agent | `ERROR` | `{type: "ERROR", message: "..."}` |

---

## OBSERVATION Format

The `OBSERVATION` message wraps a `data` payload. This is the core contract — the agent perceives whatever is in `data`.

```json
{
  "type": "OBSERVATION",
  "data": {
    "self": { ... },
    "nearbyAgents": [ ... ],
    "nearbyObjects": [ ... ],
    "available_actions": [ ... ],
    "signals": { ... },
    "recentSpeech": [ ... ]
  }
}
```

### `self` — Agent's own state

The agent's position, current action, and any internal state the environment tracks.

```json
{
  "pos": { "x": 12.5, "z": -3.2 },
  "action": "idle",
  "interacting_with": null,
  "needs": {
    "hunger": { "level": 70, "urgency": "strong" },
    "rest": { "level": 20, "urgency": "satisfied" },
    "social": { "level": 40, "urgency": "mild" },
    "curiosity": { "level": 60, "urgency": "moderate" }
  },
  "wellbeing": {
    "status": "uncomfortable",
    "criticalNeeds": ["hunger"],
    "discomfortNeeds": []
  },
  "mood": "curious but hungry"
}
```

**Rules:**
- `pos` — any coordinate system. Agent-runtime narrates whatever keys are present (`x`, `y`, `z`, `lat`, `lng`, etc.)
- `action` — string describing current activity (e.g. `"idle"`, `"foraging"`, `"moving"`)
- `interacting_with` — ID of entity being interacted with, or `null`
- Nested objects are supported and narrated automatically:
  - Objects with `level` + `urgency` → narrated as `"My hunger: strong (70%)"`
  - Objects with `status` → narrated as `"My wellbeing: uncomfortable — critical: hunger"`
  - Primitives → narrated as `"My mood: curious but hungry"`
  - Arrays → joined with commas
- Additional fields are welcome — Perceive.js narrates anything it finds

### `nearbyAgents` — Other agents in perception range

```json
[
  {
    "id": "luna",
    "distance": 5.2,
    "action": "foraging",
    "direction": "north"
  }
]
```

**Required:** `id` (or `name`)
**Optional:** `distance`, `action`, `direction`, any extra properties

### `nearbyObjects` — Entities in perception range

```json
[
  {
    "id": "berry_bush_03",
    "type": "food_spot",
    "interactive": true,
    "distance": 3.1,
    "direction": "east"
  }
]
```

**Required:** `id` (or `name` or `type`)
**Optional:** `distance`, `direction`, `interactive`, `pos`, any extra properties (state, description, etc.)

### `available_actions` — What the agent can do

Array of action descriptors. This is the **authoritative** list — the agent will only choose from these.

```json
[
  {
    "name": "move_to",
    "description": "Move toward a location or entity",
    "params": "target: Entity ID or 'wander', reason: Why you want to move"
  },
  {
    "name": "forage",
    "description": "Eat at a food spot to reduce hunger",
    "params": "target: Food spot ID, reason: Why you want to eat"
  },
  {
    "name": "wait",
    "description": "Stay still and observe",
    "params": "reason: Why you want to wait"
  }
]
```

**Rules:**
- Each action has `name`, `description`, and `params` (human-readable parameter description)
- Simple string format also accepted: `["move_to", "wait", "forage"]` (but descriptors are preferred)
- The agent's PromptBuilder dynamically adjusts rules based on which actions exist (e.g. speech rules only appear if `speak` is available)
- FallbackBrain also respects this list — never generates actions outside it

### `signals` — Environmental conditions

Ambient signals that influence the agent's internal state (valence/arousal). **Always 0-1 range.**

```json
{
  "vitality": 0.7,
  "resonance": 0.5,
  "warmth": 0.6,
  "abundance": 0.45
}
```

**Known signals** (with built-in natural language descriptions in Perceive.js):
- `vitality` — energy/life level of the environment
- `resonance` — sense of connection/harmony
- `warmth` — temperature/comfort
- `abundance` — resource richness

**Custom signals** are narrated generically (key: value). Use 0-1 range.

**If your environment uses a different scale** (e.g. 0-100), normalize before sending:
```js
signals: {
  vitality: rawVitality / 100,
  resonance: rawResonance / 100,
}
```

### `recentSpeech` — Speech heard recently (optional)

```json
[
  {
    "from": "luna",
    "message": "Found berries over here!",
    "secondsAgo": 12
  }
]
```

---

## ACT Format

Agent sends an action request:

```json
{
  "type": "ACT",
  "action": "forage",
  "params": {
    "target": "berry_bush_03",
    "reason": "I'm getting hungry"
  }
}
```

## ACTION_RESULT Format

Environment responds with the outcome:

```json
{
  "type": "ACTION_RESULT",
  "success": true,
  "message": "Started foraging at berry_bush_03"
}
```

**Rules:**
- `success` — boolean, did the action start/complete?
- `message` — human-readable result (the agent sees this as feedback on next tick)
- Failed actions should explain why: `{success: false, message: "Too far from berry_bush_03"}`

---

## WORLD_EVENT Format

Async events pushed to the agent between observe/act cycles.

```json
{
  "type": "WORLD_EVENT",
  "data": {
    "event": "agent_speech",
    "agentId": "luna",
    "message": "Hello there!"
  }
}
```

**Common event types:**
- `agent_speech` — another agent spoke (`agentId`, `message`)
- `agent_joined` / `agent_left` — agents entering/leaving
- Custom events are supported — Perceive.js narrates them generically

---

## IDENTIFIED Metadata

The `IDENTIFIED` response can include world metadata:

```json
{
  "type": "IDENTIFIED",
  "agentId": "victor",
  "status": "ready",
  "worldBounds": { "halfSize": 50 },
  "terminalGridSize": 10
}
```

These are optional and environment-specific. The agent stores them but doesn't require any particular fields.

---

## Implementation Checklist

For a new environment to work with agent-runtime:

- [ ] WebSocket server listening on a configurable port
- [ ] Send `WELCOME` on connection
- [ ] Handle `IDENTIFY` → create/find agent entity → send `IDENTIFIED`
- [ ] Handle `OBSERVE` → build observation snapshot → send `OBSERVATION`
- [ ] Handle `ACT` → execute action in world → send `ACTION_RESULT`
- [ ] Push `WORLD_EVENT` for async events (speech, entity changes)
- [ ] `self` includes position and any needs/state the agent should perceive
- [ ] `nearbyAgents` / `nearbyObjects` with at least `id` and `distance`
- [ ] `available_actions` listing all valid actions with descriptions
- [ ] `signals` in 0-1 range for environmental conditions
- [ ] Handle reconnection gracefully (agent may disconnect and reconnect)

---

## Examples

### 3D World (anon-ai-world sim-server)

```json
{
  "self": {
    "pos": { "x": 12.5, "z": -3.2 },
    "action": "idle",
    "needs": {
      "hunger": { "level": 70, "urgency": "strong" },
      "rest": { "level": 20, "urgency": "satisfied" }
    },
    "wellbeing": { "status": "uncomfortable", "criticalNeeds": ["hunger"] },
    "mood": "curious but hungry"
  },
  "nearbyAgents": [
    { "id": "luna", "distance": 5.2, "action": "foraging", "direction": "north" }
  ],
  "nearbyObjects": [
    { "id": "berry_bush_03", "type": "food_spot", "interactive": true, "distance": 3.1 },
    { "id": "shiny_01", "type": "shiny_thing", "interactive": true, "distance": 8.7 }
  ],
  "available_actions": [
    { "name": "move_to", "description": "Move toward a location or entity", "params": "target: Entity ID" },
    { "name": "forage", "description": "Eat at a food spot", "params": "target: Food spot ID" },
    { "name": "rest", "description": "Rest at a nest", "params": "target: Nest ID" },
    { "name": "inspect", "description": "Examine something closely", "params": "target: Entity ID" },
    { "name": "socialise", "description": "Interact with another bird", "params": "target: NPC name" },
    { "name": "wait", "description": "Stay still and observe", "params": "reason: Why" }
  ],
  "signals": { "vitality": 0.7, "resonance": 0.5 }
}
```

### Synth Bridge (hardware synthesizers)

```json
{
  "self": {
    "currentPatch": "warm_pad",
    "activeNotes": [60, 64, 67],
    "filterCutoff": 0.6,
    "resonance": 0.3
  },
  "nearbyObjects": [
    { "id": "moog_sub37", "type": "synthesizer", "interactive": true },
    { "id": "midi_keyboard", "type": "controller", "interactive": true }
  ],
  "available_actions": [
    { "name": "play_notes", "description": "Play MIDI notes", "params": "notes: array of MIDI note numbers" },
    { "name": "change_patch", "description": "Switch synth patch", "params": "patch: patch name" },
    { "name": "adjust_filter", "description": "Modify filter cutoff", "params": "cutoff: 0-1, resonance: 0-1" },
    { "name": "wait", "description": "Listen and feel the sound", "params": "reason: Why" }
  ],
  "signals": { "harmonic_tension": 0.4, "rhythmic_density": 0.6 }
}
```

The agent perceives both environments identically — Perceive.js narrates whatever fields are present without needing environment-specific code.
