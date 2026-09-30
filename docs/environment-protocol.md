# Environment protocol

Protocol version 1.0.

What a world has to implement to host a 3aiii agent. A 3D world, a synth bridge, a data feed, whatever. The agent is the WebSocket client, the world is the server, and everything is JSON with a `type` field.

## The conversation

1. agent connects
2. world sends `WELCOME`
3. agent sends `IDENTIFY`
4. world sends `IDENTIFIED`
5. then every tick: agent sends `OBSERVE`, world answers `OBSERVATION`, agent sends `ACT`, world answers `ACTION_RESULT`
6. the world can push `WORLD_EVENT` at any point

Messages, world to agent:

- `WELCOME` ready, identify yourself. can carry `requiresToken: true`, the agent then warns if it has no token
- `IDENTIFIED` registration confirmed, plus any world metadata
- `OBSERVATION` the snapshot, see below
- `ACTION_RESULT` `{ "type": "ACTION_RESULT", "success": true, "message": "..." }`
- `WORLD_EVENT` async stuff (speech, spawns, weather)
- `ERROR` `{ "type": "ERROR", "message": "..." }`, the agent just logs it

Agent to world:

- `IDENTIFY` `{ "type": "IDENTIFY", "agentId": "victor" }`. if the agent has `ADMIN_TOKEN` set it adds `"token"`, compare it against yours if you require auth
- `OBSERVE` asks for a snapshot
- `ACT` `{ "type": "ACT", "action": "move_to", "params": { ... } }`
- `PERSONA_SYNC` `{ "type": "PERSONA_SYNC", "persona": { ... } }`, the current persona file. sent after `IDENTIFIED` and again every hour, so the world can keep up with how the persona has evolved. ignore it if you don't need it

## OBSERVATION

A `data` payload. This is the core of it, the agent perceives whatever is in `data`.

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

`nearby_agents` and `nearby_objects` work too. Any other top-level key gets narrated as `key: value` (objects as clipped JSON), so a world can send extra stuff without the agent needing new code. The whole rendered situation is capped at 12,000 characters.

A few optional top-level keys the agent does know about:

- `world_clock` `{ "hour": 22, "is_night": true, "day": 14, "night_ends_in_sec": 900 }`. when present the agent sleeps once per world night instead of on its timer, and wakes when `night_ends_in_sec` runs out (clamped to between 1 minute and 2 hours)
- `recent_events` array of strings, rendered under an "Earlier today" heading
- `nearby_details` array of strings, scenery the agent can see but not act on

### self

The agent's own state: position, what it's doing, whatever else the world tracks.

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

`pos` can be any coordinate system, it narrates whatever keys are there (`x`, `y`, `z`, `lat`, `lng`...). `action` is a string for the current activity (`"idle"`, `"foraging"`, `"moving"`). `interacting_with` is an entity id or `null`.

Everything else on `self` is narrated too, nested objects included:

- `{ level, urgency }` becomes `My hunger: strong`
- `{ status, criticalNeeds }` becomes `My wellbeing: uncomfortable, critical: hunger`
- plain values become `My mood: curious but hungry`
- arrays get joined with commas

Execution state. If the world runs actions that take time, tell the agent so it doesnt decide again halfway through:

- `busy: true` a timed action is running (`action` names it)
- `journey: { "active": true, "target": "pond" }` it's walking somewhere
- `asleep: true` the world has it asleep, it won't call the LLM and just waits

While either `busy` or `journey.active` is set no new decision is made. Older worlds that only set `action` to something starting with `move toward ` still count as a journey.

### nearbyAgents

```json
[
  { "id": "luna", "distance": 5.2, "action": "foraging", "direction": "north" }
]
```

Needs `id` (or `name`). `distance`, `action`, `direction` and anything else are optional.

### nearbyObjects

```json
[
  { "id": "berry_bush_03", "type": "food_spot", "interactive": true, "distance": 3.1, "direction": "east" }
]
```

Needs `id` (or `name` or `type`). Optional: `distance`, `direction`, `interactive`, `pos`, plus whatever else (state, description).

### available_actions

The list the agent picks from. It won't choose anything that isn't on it, and neither will FallbackBrain.

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

Each has `name`, `description` and `params` (a human-readable description of the params). A plain array of names like `["move_to", "wait", "forage"]` also works but you lose the descriptions. PromptBuilder changes the rules depending on what's in the list, eg the speech rules only show up if `speak` is there.

### signals

Ambient conditions that push mood and energy. Always 0-1.

```json
{
  "vitality": 0.7,
  "resonance": 0.5,
  "warmth": 0.6,
  "abundance": 0.45
}
```

Perceive.js has built-in wording for `vitality`, `resonance`, `warmth` and `abundance`, among others. Anything it doesn't know gets narrated as `key: value`. If your world uses another scale, normalise before sending:

```js
signals: {
  vitality: rawVitality / 100,
  resonance: rawResonance / 100,
}
```

`decision_pending` is special: at 0.5 or above the tick goes to the `decision` tier (Anthropic, if `ANTHROPIC_API_KEY` is set on the agent).

### recentSpeech

Optional.

```json
[
  { "from": "luna", "message": "Found berries over here!", "secondsAgo": 12 }
]
```

## ACT and ACTION_RESULT

The agent sends:

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

The world answers:

```json
{
  "type": "ACTION_RESULT",
  "success": true,
  "message": "Started foraging at berry_bush_03"
}
```

`success` is whether the action started or finished. `message` is shown to the agent next tick, so make failures say why: `{ "success": false, "message": "Too far from berry_bush_03" }`.

## WORLD_EVENT

Pushed between ticks. The agent keeps the last 20 and reads them on its next tick.

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

`agent_speech` (with `agentId`, `message`), `agent_joined` and `agent_left` are understood. Anything else gets narrated generically.

Speech makes the agent act straight away rather than on its next tick. Any other event can do the same with `"wake": true` in `data`, which is how a world that keeps its agent asleep (`self.asleep`) to save on model calls brings it round the moment something happens.

## IDENTIFIED

Can carry world metadata:

```json
{
  "type": "IDENTIFIED",
  "agentId": "victor",
  "status": "ready",
  "worldBounds": { "halfSize": 50 },
  "terminalGridSize": 10
}
```

All optional. The agent keeps `worldBounds` and `terminalGridSize` but needs neither.

## Minimum for a new world

A WebSocket server on a port you can configure. Send `WELCOME` on connect, answer `IDENTIFY` with `IDENTIFIED`, `OBSERVE` with `OBSERVATION`, `ACT` with `ACTION_RESULT`. In the observation, `self` with a position and whatever state you want it to feel, nearby agents and objects with at least `id` and `distance`, the full `available_actions` list, and signals in 0-1. Push `WORLD_EVENT` for speech and things changing. And expect the agent to drop and reconnect, it backs off from 5s up to 5 minutes.

## Examples

A 3D world (the anon-ai-world sim-server):

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

A synth bridge (hardware synths):

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

The agent handles both the same way. Perceive.js narrates whatever fields turn up, there's no per-world code.
