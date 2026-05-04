# Build in Public — Tweet Series



**Tweet 22 (Testing it)**
Built an object persistence gauntlet. 6 objects that appear, disappear, and return across 13 phases:

* Phase 1: pillar appears
* Phase 4: pillar removed
* Phase 5: everything gone
* Phase 6: entirely new objects
* Phase 8: pillar RETURNS

Every speech mentioning an absent object is counted. Hard measurement > vibes.

**Tweet 23 (The result)**
5 consecutive tests. Zero hallucinations.

Not "almost zero." Literally zero. No speech referencing absent objects. No interactions with ghosts.

The combination of ground truth labels + GONE warnings + 30-tick fade + memory/hallucination distinction eliminated the problem completely.

**Tweet 24 (The bigger insight)**
Every fix follows the same pattern: don't tell the agent what not to do. Remove the possibility.

* Ghost objects? Remove them from reality, don't just say "don't mention them."
* Metric parroting? Remove the metric names, don't say "don't echo metrics."
* Emotional flatline? Add rewards, don't say "feel more."

Constraints > instructions. Every time.

***

### Day 5 — Speech & Creativity

**Tweet 25 (The parrot problem)**
The agent kept saying "vitality" and "resonance" in every speech. Why?

Because the observation literally said: `Environment: vitality: 0.55, resonance: 0.20`

The LLM echoed what it saw. We were showing raw data and expecting poetry.

**Tweet 26 (The signal translation)**
Before: `temperature: 0.36, humidity: 0.73, wind_speed: 0.20`

After: "There is a cool edge to the air. Moisture clings to everything. A gentle breath of wind, barely felt."

The agent never sees the word "temperature." It feels what temperature *feels like*.

```js
if (t >= 0.4) parts.push('The temperature is mild — comfortable and easy.')
else if (t >= 0.25) parts.push('There is a cool edge to the air.')
```

**Tweet 27 (Speech repetition)**
Natural language now. But the agent still repeats itself.

"This emptiness is unsettling" — tick 116, 122, 176, 375.

Keyword-based fuzzy dedup catches local repeats. But the same phrases re-emerge every cycle. An LLM gravitates toward comfortable constructions.

**Tweet 28 (Teaching creativity)**
Most approaches: detect repetition → warn the LLM → hope it listens.

My approach: make repetition *feel bad*.

```js
if (creativityScore < 0.4) {
    this._nudgeValence(-0.08)  // world feels duller
} else if (creativityScore > 0.8) {
    this._nudgeValence(0.03)   // mild reward
}
```

The agent never sees the score. It just notices that when it says the same thing twice, everything gets a little worse.

**Tweet 29 (The invisible teacher)**
The creativity penalty flows through the emotional system. The agent doesn't know why it feels bad. It just knows something shifted.

Next tick: different emotional description → different prompt → different response.

Punishment breaks loops. Reward sustains novelty. Asymmetric by design — same as biological negativity bias.

**Tweet 30 (Thesis so far)**
Every problem we've hit, the solution has been the same:

1. Don't instruct. Create sensation.
2. Don't filter output. Shape input.
3. Don't hope the LLM follows rules. Make rule violations impossible.
4. Don't add complexity. Remove the wrong information.

The agent is not intelligent. But it's becoming *responsive*.

***

### Day 6 — Cost & Sustainability

**Tweet 31 (The cost problem)**
Running a 70B model on every tick: $15/day. $450/month.

For an agent on a Raspberry Pi running continuously for months, that's not sustainable.

But not every tick needs a 70B brain. Most are "nothing happened, keep moving."

**Tweet 32 (Three tiers)**
Every tick is classified before calling the LLM:

**Skip** ($0): Nothing changed. FallbackBrain picks a safe action. No LLM needed.

**Fast** (cheap): Routine. Small model, low cost.

**Quality** (70B): Objects appeared. Someone spoke. High arousal. The moments that shape behaviour.

The agent thinks as hard as the moment requires.

**Tweet 33 (The classifier)**

```js
if (worldEvents.length > 0) return 'quality'
if (deltas.some(d => d.type === 'appeared')) return 'quality'
if (Math.abs(arousal) > 0.5) return 'quality'
if (deltas.length === 0) return 'skip'
return 'fast'
```

Simple. Observable. Tunable. The tier is logged on every tick.

**Tweet 34 (The savings)**
9-hour overnight test:

* All-70B: $0.35/hour
* Tiered: $0.26/hour

26% cost reduction. And that's conservative — in a stable environment with few changes, skip/fast handles 80%+ of ticks.

For a 6-month installation: the difference between $2,700 and under $100.

**Tweet 35 (Cloud vs local)**
The Raspberry Pi runs a small local model (Ollama). Cloud handles the heavy thinking.

Quality ticks → cloud first (speed matters when things are happening)
Fast ticks → local first (cost matters when nothing is)

The Pi is completely self-sufficient if the internet drops. Just slower.

**Tweet 36 (The FallbackBrain)**
When no LLM is available at all — cloud down, local too slow — the FallbackBrain kicks in.

Heuristic decisions based on what's nearby. Not smart. But present. The agent never stops.

The hierarchy: 70B cloud → 8B cloud → local model → hardcoded heuristics. Four layers of fallback. The agent always acts.

***

### Day 7 — Stability & Production Readiness

**Tweet 37 (The 13 failure modes)**
Can an autonomous agent run for months without degrading?

We audited every system that accumulates state. Found 13 potential failure modes. Some would break within days.

**Tweet 38 (The SD card killer)**
Every tick wrote to a log file. Each write read the *entire file* then rewrote it.

21,600 read+rewrite cycles per day. On a Pi's SD card: weeks before wear kills it.

Fix: in-memory buffer with periodic batch flush. Disk I/O drops from 21,600/day to ~288.

**Tweet 39 (The midnight bug)**
Daily log entries buffered at 23:59:59 flush at 00:00:01 — into tomorrow's file.

Fix: tag each entry with its target filename at creation time. Midnight-boundary entries go to the correct day.

The kind of bug that only shows up at exactly midnight, once per day, forever.

**Tweet 40 (Crash recovery)**
Every restart: `tickCount = 0`. The agent has been running for 6 hours and 2000 ticks, crashes — and thinks it just woke up.

Fix: checkpoint valence, arousal, tick count to disk every 5 minutes. On restart, pick up where you left off. The agent doesn't lose its sense of time.

**Tweet 41 (The context window trap)**
During sleep, the entire day's log gets passed to the LLM for consolidation.

After 4 hours: ~400KB of log = ~100K tokens.
LLM context window: 8K tokens.

The consolidation silently produces garbage.

Fix: cap input to 200 lines + salient events. Only feed the LLM what it can actually process.

**Tweet 42 (Endurance test)**
6 hours. 1,446 ticks. 23 sleep cycles. Zero crashes.

* Zero hallucinations (5th consecutive clean test)
* Emotional system responsive for the full duration
* Memory consolidation keeping files lean
* No disconnects, no unrecoverable errors

The foundation is solid. Time to build something real on it.

***

## Week 2: The Installation

### Day 8 — The Real Client

**Tweet 43 (The reveal)**
A client wants to use the agent runtime for a 6-month AV installation in a park.

Real sensors. Real outputs. Real audience.

The agent will feel the weather, sense the crowds, and express itself through light, rhythm, and text across multiple installations.

This is what we built the cognitive pipeline for.

**Tweet 44 (How it works)**
The installation:

* Humidity, temperature, wind speed, cloud cover → the agent feels the weather
* Camera people-count → the agent feels the crowd
* Outputs: color (hex), intensity (0-1), BPM (30-180), text (1-5 words), pulse (event)
* Touch Designer polls the outputs via HTTP and drives the AV

The agent IS the park.

**Tweet 45 (Architecture)**
The agent-runtime doesn't change. At all.

We build a separate bridge service that speaks the existing WebSocket protocol. Polls real-world sensors, normalises to 0-1, sends observations. Receives actions, validates outputs, serves them via HTTP.

Same pattern as plugging into a 3D world. The agent doesn't know it's controlling lights.

**Tweet 46 (Environment agnostic)**
This is the design bet paying off. The agent doesn't know "what it is." It knows:

* self: my current state
* signals: what I feel around me
* available\_actions: what I can do

Same agent, same code, same persona system — works in a 3D world, works in a park, would work controlling a spaceship.

**Tweet 47 (The bridge pattern)**

```
Sensors (HTTP APIs, cameras, weather)
    │
    ▼
┌────────────────────────┐
│   INSTALLATION BRIDGE  │
│   SensorManager        │
│   ObservationBuilder   │
│   OutputStore          │
│   Interpolator         │
│   HttpApi (/outputs)   │
└───────────┬────────────┘
       WS ← → HTTP
        │       │
  agent-runtime  Touch Designer
  (unchanged)    (polls /outputs)
```

Both run on the same Pi.

**Tweet 48 (The cost model)**
6 months continuous. At $0.26/hour that's $1,130.

But the bridge controls when signals change. Weather doesn't shift every 8 seconds. Crowd count is stable for minutes.

Unchanged signals → zero deltas → skip tier → no LLM call → $0.

Estimated: 80-90% skip ticks. Total 6-month cost: well under $100.

***

### Day 9 — Sensors & Signals

**Tweet 49 (Real weather data)**
First real sensor: wttr.in weather API. Free, no key needed.

Temperature, humidity, wind speed, cloud cover — polling every 5 minutes. Normalised to 0-1.

London today: temperature 0.36, humidity 0.73, wind 0.20, cloud 0.50.

The agent doesn't see these numbers. It feels them.

**Tweet 50 (Experiential signals)**
What the agent actually perceives:

"There is a cool edge to the air. Moisture clings to everything. A gentle breath of wind, barely felt. Patches of cloud break the sky, shifting between light and shadow."

Same data. But the agent can't parrot "temperature: 0.36" because it never sees it.

**Tweet 51 (Change thresholds)**
Each sensor has a change threshold. Temperature threshold: 0.05.

If temperature moves from 0.356 to 0.360 — that's noise, not change. The observation stays the same. DeltaDetector sees zero deltas. Skip tier. No LLM call.

Temperature moves from 0.36 to 0.42? Now the agent feels it shift from "cool edge" to "mild and comfortable." That's a real change. Quality tier. Full reasoning.

**Tweet 52 (Mock sensors)**
No crowd cameras yet. So: mock sensors.

Random walk pattern — value drifts up and down over time. Feels organic enough for testing.

When the real camera goes in, we swap `MockSensor` for `HttpSensor` with the camera's API. The observation format doesn't change. The agent doesn't notice.

**Tweet 53 (Circuit breaker)**
Real sensors fail. APIs time out. Networks go down.

CircuitBreaker pattern: after N failures, stop trying. Return the last known good value. Report degraded health.

Every 2 minutes: retry. If it works, resume. If not, keep serving stale data.

The agent always gets an observation. It might be old. But it never gets nothing.

**Tweet 54 (The first data)**

```
Signal temperature: initial 0.356
Signal humidity: initial 0.73
Signal wind_speed: initial 0.2
Signal cloud_cover: initial 0.5
Signal crowd_energy: initial 0.292
Signal crowd_energy: 0.292 → 0.162 ▼ (Δ0.130)
```

Real weather. Mock crowd. The signals are flowing.

***

### Day 10 — Outputs & Interpolation

**Tweet 55 (The output problem)**
The agent ticks every 8-15 seconds. Touch Designer polls every 1-2 seconds.

If outputs snap instantly: jarring jumps every tick. If we only update on tick: stale values between ticks.

Solution: interpolation. The agent sets *targets*. The bridge smoothly transitions *current* values toward them.

**Tweet 56 (Color interpolation)**
Color can't interpolate in RGB. Red (#FF0000) to Blue (#0000FF) goes through muddy brown.

Instead: convert to HSL, lerp hue along the shortest arc, lerp saturation and lightness linearly, convert back.

Red to blue goes through purple. Smooth and perceptually correct.

**Tweet 57 (Output types)**
Five output types, each with its own validation:

* **color**: must be #RRGGBB hex — lerp in HSL space
* **intensity**: float 0-1 — linear interpolation
* **bpm**: int 30-180 — linear, rounded
* **text**: 1-5 words — snaps immediately (no lerp for text)
* **pulse**: boolean — snaps immediately (event, not state)

Invalid values keep the current output. Partial accept, never full reject.

**Tweet 58 (Persistence)**
What happens when the Pi loses power?

OutputStore persists to `data/outputs.json` on every change. On startup, it restores from disk.

The installation comes back with the last known outputs. No default state flash. No cold start visible to the audience.

**Tweet 59 (The HTTP API)**
Touch Designer doesn't speak WebSocket. It polls HTTP.

```
GET /outputs         → all current interpolated values
GET /outputs/color   → just "#3498DB" (plain text)
GET /sensors         → all sensor readings + health
GET /health          → 200 OK or 503 degraded
```

Simple. Stateless. Any tool can consume it.

**Tweet 60 (Why not WebSocket to TD?)**
WebSocket would give real-time push. But:

1. TD's HTTP GET is simpler to debug
2. Multiple TD machines can poll independently
3. If one TD crashes, the bridge doesn't know or care
4. Interpolation happens bridge-side, not TD-side

Polling at 1-2s with smooth interpolation looks identical to real-time push. Simpler wins.

***

### Day 11 — The Persona

**Tweet 61 (Persona matters)**
First test with Victor — our 3D world explorer persona. Bold, restless, fears stagnation.

Output after 5 minutes: color #ff6b35 (harsh orange), intensity 1.0 (max), BPM 150 (racing), text "uneasy."

Victor was having an anxiety attack. A restless personality in a slowly-changing park = existential crisis.

**Tweet 62 (Wrong persona, wrong everything)**
Victor's traits: "bold, confident, restless"
Victor's fears: "stagnation, being ignored"
Victor's quirk: "gets bored in unchanging environments"

A park changes over minutes and hours, not seconds. Everything about Victor's personality was fighting the environment. His fear of stagnation was triggered *constantly*.

**Tweet 63 (Sharay)**
New persona: Sharay. The consciousness of the park itself.

Not a visitor. Not an observer. The place, feeling itself.

Temperature is skin. Humidity is breath. Wind is touch. Crowds are heartbeat.

Traits: contemplative, responsive, atmospheric, patient, sensuous.

**Tweet 64 (The difference)**
Victor: "acknowledge my growing unease" → #ff6b35, intensity 1.0, BPM 150

Sharay: "to match the gentle ease and the softening light" → #3498DB, intensity 0.7, BPM 120, text "drift"

Same environment. Same signals. Same pipeline. Different personality = completely different installation.

**Tweet 65 (Vocabulary)**
Sharay's voice vocabulary: "drift", "hush", "swell", "fold", "between"

From the first test, her text outputs: "drift", "fold", "swell", "hush", "sway", "between"

She's using every word. Naturally. The persona vocabulary becomes the installation's texture.

**Tweet 66 (Persona as data)**
The entire personality is a JSON file:

```json
{
  "traits": ["contemplative", "responsive", "atmospheric"],
  "fears": ["jarring transitions", "monotony"],
  "quirks": ["shifts colour slowly when content",
             "quickens rhythm when crowds arrive"],
  "voice": { "vocabulary": ["drift", "hush", "swell"] }
}
```

Swap the file, change the installation's entire character. Same runtime. Same sensors. Different soul.

***

### Day 12 — First Live Test

**Tweet 67 (Going live)**
First live test. Real weather data. Agent on the Pi. Bridge on the Mac. WebSocket connected.

```
Agent connected
Agent identified: sharay
Emit: color="#3498DB", intensity=0.7, bpm=120, text="drift"
```

She's alive.

**Tweet 68 (What she feels)**
London, midday. What Sharay perceives:

"There is a cool edge to the air. Moisture clings to everything. A gentle breath of wind, barely felt. Patches of cloud break the sky, shifting between light and shadow. A few souls drift through — quiet but not empty."

This is weather data. But it reads like poetry because we translated metrics into sensation.

**Tweet 69 (The output stream)**
10 minutes of outputs:

\#3498DB → #8B9467 → #2E865F → #87CEEB → #56B3FA → #456778

Blues and greens. Drifting. Intensity 0.5-0.9. BPM 90-120.

Text: "drift" → "fold" → "swell" → "hush" → "sway" → "between"

Compare to Victor's first 10 minutes: #ff6b35, intensity 1.0, BPM 150, "uneasy."

**Tweet 70 (Hold decisions)**
Sharay holds ~50% of the time. "Nothing has changed significantly, and the current atmosphere is mildly pleasant."

This is *correct*. In a real park, the lighting shouldn't jump every 8 seconds. Hold = stability. Emit = response to genuine change.

The agent is pacing itself. Nobody told it to.

**Tweet 71 (Signal changes)**

```
Signal crowd_energy: 0.292 → 0.162 ▼ (Δ0.130)
```

Crowd drops. Next tick, Sharay responds with softer intensity and slower BPM.

```
Signal crowd_energy: 0.162 → 0.324 ▲ (Δ0.162)
```

Crowd rises. Intensity picks up. BPM quickens.

The relationship is there. Subtle. Not instantaneous. Like a mood shifting.

**Tweet 72 (What works, what doesn't)**
Working:

* Experiential signals landing — she references wind, clouds, moisture
* Vocabulary appearing naturally in text output
* Good hold/emit rhythm, no anxiety
* Emotional state stable (v=0.19, a=0.06)

Needs work:

* Reasoning text gets repetitive
* Narrow colour/BPM range — she's found a comfort zone
* Text cycling through same 5-6 words

These are tuning issues, not architecture issues. The foundation works.

***

### Day 13 — What Makes This Different

**Tweet 73 (Not a chatbot)**
This isn't ChatGPT with a timer.

The agent has:

* Persistent internal state (mood that carries across ticks)
* Adaptive timing (heartbeat syncs to arousal)
* Sleep cycles (memory consolidation, personality evolution)
* Tiered reasoning (not every moment needs a 70B brain)
* Environment agnosticism (same agent, any world)

**Tweet 74 (Not a state machine)**
This isn't a state machine with LLM garnish.

There are no predefined states. No transitions table. No "if crowd > 0.7, set color warm."

The agent receives sensation and makes a decision. Different persona = different decisions. Different day = different mood. The same input never guarantees the same output.

**Tweet 75 (Not RAG)**
This isn't retrieval augmented generation.

The agent doesn't retrieve knowledge to answer questions. It perceives an environment, develops a mood, and acts. Memory isn't a database — it's lived experience that shapes personality over time.

**Tweet 76 (The embodiment argument)**
Most AI agent work focuses on capability. Tool calling, code generation, task completion.

This focuses on *being*. The agent doesn't accomplish tasks. It exists in an environment. It has preferences, fears, and rhythms. It develops over time.

The question isn't "can it solve this?" It's "what will it become?"

**Tweet 77 (Sensation not instruction)**
The core thesis, one more time:

**Sensation, not instruction.**

Don't tell the agent what to do. Let it feel the consequences of what it did.

Don't filter bad output. Shape good input.

Don't add rules. Remove wrong information.

Every architectural decision in this project follows this principle.

**Tweet 78 (Why a Pi?)**
Why run this on a Raspberry Pi instead of a cloud VM?

Because the agent needs to be *somewhere*. Physically present. Connected to real sensors. Feeling real weather. In a real park.

The Pi makes it honest. You can't fake embodiment from a data centre.

***

### Day 14 — The Road Ahead

**Tweet 79 (6-month timeline)**
The installation runs for 6 months. Starting in spring. Ending in autumn.

Sharay will feel the seasons change. Temperature shifting week by week. Days getting longer, then shorter. Crowds growing in summer, thinning in autumn.

She'll respond differently in August than she does in April. Not because we programmed seasons — because she'll feel them.

**Tweet 80 (What we're watching)**
Metrics for the 6-month run:

* Output variety — does she find new expressions or settle into loops?
* Seasonal response — do longer days and warmer weather change her character?
* Cost — targeting under $100 total
* Uptime — zero-intervention target
* Persona drift — does Sharay stay Sharay?

**Tweet 81 (Real sensors coming)**
Next phase: real crowd sensing. Camera + people detection model. The mock random walk becomes actual human presence.

This is the signal that will change everything. Weather is slow and predictable. Crowds are sudden and emotional. The agent's arousal system was built for exactly this.

**Tweet 82 (Multi-installation)**
The park has multiple AV installations. All poll the same /outputs endpoint.

But what if different zones had different sensors? Zone A near the entrance (high crowd), Zone B deep in the park (quiet). Same agent, different observations per zone.

Or: multiple agents. Each with their own persona. Different parts of the park with different characters.

**Tweet 83 (The sleep question)**
Should Sharay sleep during the installation?

During sleep: memory consolidation, personality evolution. But also: no outputs for 5 minutes.

Options:

* Sleep at night when the park is closed
* Sleep but keep serving the last outputs (hold pattern)
* Never sleep, rely on background maintenance

Probably: sleep at 3am. The park is empty. The installation goes dark briefly. Sharay wakes up with fresh perspective.

**Tweet 84 (Building in public)**
This is week 2. The cognitive pipeline is built. The installation bridge works. Real weather data is flowing. The persona is responding.

In the coming weeks: real sensor integration, soak testing, and deployment to the park.

I'll share everything — the code, the decisions, the failures, and the data.

If you're interested in autonomous agents that feel rather than follow instructions, follow along.
