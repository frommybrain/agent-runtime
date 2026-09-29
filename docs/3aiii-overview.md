# 3aiii - Overview

A cognitive runtime for autonomous agents.

The name is a play on the operator's other product line, 3eyes. 3eyes is the front-facing brand and 3aiii is the cognition underneath it: the "AI" hidden in three letters, the inside of the head behind the eyes.

What follows covers what the system is, how it's built, what's live, what's been proven, and what's left to make it enterprise-presentable.

---

## 1. The pitch in one paragraph

Most "AI agents" today are stateless prompt loops, and once the human supervisor is taken out of the loop they collapse into repetition. 3aiii takes a different approach. It gives an LLM-backed agent a five-stage perception loop, an internal emotional state, a memory that consolidates while it sleeps, a persona that evolves on its own over time, and a constraint discipline that prevents the fixation collapse other frameworks fall into when they're left to run. It currently runs locally on a Raspberry Pi for cents per hour, but the runtime is plain Node.js and runs just as well on any machine or in the cloud. It has been through numerous 9-12 hour soak runs. The most representative one ticked 1,702 times, generated 449 utterances, slept ten times, and showed measurably different behaviour at the end than at the start. The same runtime can drive a 3D character, a sensor-grounded physical agent, a music synth, a chat participant, or any other environment (digital or physical) that can speak its protocol.

The idea is to treat an agent as a long-running process rather than a function call.

---

## 2. Why this exists, and why it's different

### 2.1 The problem with current agents

Modern agent frameworks (LangChain, AutoGen, Eliza, MetaGPT, LangGraph, OpenClaw, Hermes) have made real progress on memory, continuity, and tool use. The newer ones do remember things across sessions and can reason about prior conversations.

One failure mode still bites agents as soon as they're taken off the leash: repetition collapse. Run any modern agent in a long-horizon loop with no human supervisor and it fixates. It moves to the same place ten times in a row, repeats the same phrase, asks the same question. The reason is structural. Asking "what should I do next?" against a stable context window produces the highest-probability completion, which is usually whatever the agent just did. Memory and tool use don't fix this. They just give the agent more rope.

3aiii is built to close that gap. Where other systems address memory and continuity, 3aiii adds an explicit anti-fixation discipline (the repetition guard, see section 3.2), an internal emotional state that grounds decisions in felt consequence rather than pure probability, and a sleep-cycle consolidation pattern that resets attention instead of letting the prompt window drift. Some of these ideas exist in pieces across the agent ecosystem. What 3aiii adds is putting them together in a single autonomous loop that holds up under unsupervised long-horizon operation.

### 2.2 What we built instead

A cognitive loop with five stages, each backed by its own module:

```mermaid
flowchart LR
    S[SENSE<br/>observe env<br/>delta vs last tick]
    F[FEEL<br/>update mood/energy<br/>from outcome + novelty]
    T[THINK<br/>LLM decides<br/>with full context]
    A[ACT<br/>send action<br/>capture result]
    R[REFLECT<br/>log w/ salience<br/>feed result back]
    S --> F --> T --> A --> R
    R -. next tick .-> S
```

- SENSE observes the environment and diffs it against the previous tick. The agent sees what changed in the world, not just what's there.
- FEEL updates a two-axis internal state (mood and energy) from novelty, action outcome, and environmental signal. The agent doesn't compute that something is interesting. It gets a spike of energy, and that feeling goes into the next prompt.
- THINK is the LLM call. The prompt includes the current internal state, recent deltas, the result of the last action, any repetition warnings, and the persona's voice rules.
- ACT sends an environment action (move, speak, manipulate) and records whether it succeeded.
- REFLECT logs the tick with a salience score, feeds the action result into the next tick's FEEL, and rotates daily logs.

Every 4 hours of waking life, the agent sleeps for an hour. Four passes run during sleep: memory consolidation, skill extraction, tool refresh, and self-reflection. The persona file itself is rewritten (subtly) based on what kind of day the agent had. A drift guard stops runaway change.

The difference from prompt engineering is the shape of the process, not the wording of the prompt.

### 2.3 What this makes possible

- Autonomy without micromanagement. Boot the agent and walk away. Three days later it has formed relationships with objects in its world, refined its voice, and learned procedural skills. Nothing external is driving it.
- Hardware-grounded operation. The runtime is small enough to live on a Raspberry Pi 5 at the edge, with a local-model fallback when the cloud LLM is unreachable. Pull the wifi and the agent slows down but keeps running.
- Pluggable to anything. The environment protocol is a standard WebSocket contract. The same runtime has driven a 3D character, a hardware sensor stream, a music synth, a chat participant, and a large-scale physical installation, and in principle it can drive anything else (digital or physical) that speaks the protocol.
- Cost discipline. Tiered LLM routing (a high-quality model for consequential decisions, a fast cheap model for routine ticks, local Ollama as fallback) keeps cost per tick at fractions of a cent. A Pi running one agent 24/7 stays well inside a hobbyist budget.

---

## 3. Architecture

### 3.1 Module layout

```
src/
  loop/
    Heartbeat.js           adaptive 4-15s tick, tied to energy
    SleepCycle.js          4h wake / 1h sleep, four-pass consolidation
  cognition/
    InternalState.js       mood/energy feel-machine
    DeltaDetector.js       narrates what changed in the world
    RepetitionGuard.js     detects fixation, surfaces it to the LLM
    Think.js               assembles context, calls the LLM, parses
    Perceive.js            renders observation as natural language
    FallbackBrain.js       heuristic action selection when no LLM
  memory/
    WorkingMemory.js       20-entry RAM ring buffer, salience-weighted
    MemoryFiles.js         persistent markdown: memory, skills, tools
    DailyLog.js            rotating per-day activity logs (7-day GC)
    SpeechLog.js           utterance tracking for repetition + creativity
  llm/
    LLMClient.js           tiered routing: cloud quality / cloud fast / local
    PromptBuilder.js       persona-aware prompt assembly
  connection/
    EnvironmentSocket.js   WebSocket protocol, reconnect, buffering
  api/
    ApiServer.js           HTTP + Server-Sent Events
  logging/
    logger.js              levelled console output
  util/
    sanitizeJson.js        defensive JSON parsing for LLM output
```

Each module is deliberately small (200-300 lines) and does one job. The whole runtime is around three thousand lines of JavaScript with three direct npm dependencies (`ws`, `ollama`, `dotenv`). There's no transpilation step and no framework lock-in.

### 3.2 The cognitive pipeline in detail

#### Internal state

The agent has a two-axis felt sense:

- Mood (-1 to +1), from bad to good. Pushed by action outcomes, environmental signals (vitality, danger), and social events. Failure is sharp at -0.15 and success gentle at +0.02. The asymmetry is intentional: it mirrors how negative experience disciplines attention more than positive experience does.
- Energy (-1 to +1), from calm to excited. Spiked by novelty (delta detection), sustained by environmental signal strength, and decays toward zero when nothing is stimulating it.

These values aren't instructions to the LLM. They're sensations the environment causes, and the persona and the LLM together decide what to do about them. A high-mood, high-energy "Victor"-type persona (our flagship reference persona, introduced in section 3.4) might become spontaneous and bold. A low-mood, high-energy "Victor" might become anxious and protective. The framework provides the felt sense and the persona provides the response.

The internal state is checkpointed to disk continuously, so the agent recovers cleanly across crashes and restarts.

#### Delta detection

The agent sees what's different, not just what's there. Each tick the observation is diffed against the previous one. New agents appearing, objects vanishing, properties changing, signals shifting: all of it is narrated in plain language in the next prompt, for example *"New object: terminal-01 appeared"* or *"resonance increased (0.30 to 0.70)"*. The LLM gets change, not state.

#### Repetition guard

The runtime tracks the last twenty actions. Three of the same action in a row, one action taking more than sixty percent of recent history, or three exact duplicates in the last five ticks will each trip a warning that goes into the next prompt: *"You've tried 'move_to' four times in a row. Consider something else."* This is a constraint, not an instruction. The thinking is that constraints create creativity. An agent told to "be creative" produces vague output. An agent told it can't do the boring thing has to find a new thing.

#### Adaptive heartbeat

The tick interval moves between 4 and 15 seconds depending on current energy. High energy (something is happening) means faster ticks. Low energy (the world is static) means slower ticks, which saves compute and money. The tick is a `setTimeout` chain rather than `setInterval`, so the runtime captures each action's result before the next tick starts. That result becomes part of the next FEEL phase.

#### Sleep cycle

Every four hours of waking activity the agent sleeps for an hour. Four passes run during sleep:

1. Memory consolidation. The LLM rewrites `memory.md` (the agent's relationships, learned facts, salient memories), compressing four hours of working memory into durable form.
2. Skill extraction. The LLM reviews the daily log and distills procedural patterns into `skills.md` (eg "interact({target: 'pillar-01'})", "move_to({x: 10, z: 20}) circles back when anxious").
3. Tool refresh. The runtime re-reads the observation schema and updates `tools.md` with currently available actions and discovered objects.
4. Self-reflection. The LLM reviews the day's internal-state history (average mood, average energy, peaks, range) together with the persona, and proposes small changes. Traits, quirks, values and fears can shift. Name and backstory cannot. Accepted changes are written back to the persona JSON with a timestamped log entry. A drift guard measures distance from the immutable baseline persona file and rejects runaway changes.

When the agent wakes it has a slightly different self than when it went to sleep. Over weeks this adds up to real character development.

### 3.3 Memory model

Three layers, each with a clear role:

| layer | medium | what it holds | written when |
|---|---|---|---|
| Working memory | RAM ring buffer (20 entries) | actions, deltas, speech, sleep markers | every tick |
| Daily log | markdown file per day, 7-day retention | full activity stream | every tick, GC'd in sleep |
| Memory files | three markdown files (`memory.md`, `skills.md`, `tools.md`) | consolidated long-term knowledge | during sleep cycles |

High-energy moments are tagged with a salience marker and weighted more heavily during consolidation. Lookups during prompt building read from the persistent files, with an in-memory cache so the disk isn't hit every tick.

This is the difference between "the agent remembers" and "someone gave the agent a longer context window". A longer context window is shallow recall. Remembering means consolidation, abstraction, and selective forgetting.

### 3.4 Persona system

A persona is a JSON file. Six ship today. "Victor" is the flagship reference persona and most of the soak-test data comes from him. The other five ("Pip", "Bean", "Mochi", "Taro", "Sharay") are deliberately varied in voice, values and energy, to check that the cognitive layer works across different character types rather than fitting only one. Each persona file defines:

- Identity: id, name
- Character: traits, values, fears, quirks
- Voice: prose style, vocabulary anchors, signature phrasings
- Backstory: narrative that grounds the character

Personas are loaded at boot and can be swapped live through the `PUT /persona` HTTP endpoint. The PromptBuilder works the persona into the system prompt, and the persona shapes how the LLM responds to the same internal state. A "Victor" reacting to high energy and low mood will feel and sound different from a "Pip" in the same state.

Sleep-cycle self-reflection rewrites the persona JSON in place, which produces slow drift over weeks. A baseline copy is kept unchanged, and the drift guard limits how far the live persona can move from it before changes are rejected. The result is a recognisable character that still develops.

### 3.5 LLM provider routing

Three tiers, with automatic fallback:

| tier | use case | provider | latency | cost per call |
|---|---|---|---|---|
| Quality | sleep consolidation, complex decisions | cloud 70B-class (Groq `gpt-oss-120b`) | ~10s | ~1.5¢ |
| Fast | routine ticks | cloud 8B-class (`gpt-oss-20b`) | ~2-3s | ~0.3¢ |
| Local | offline fallback | Ollama (configurable, `qwen2.5:3b` default) | ~30-60s on Pi | free |
| Skip | no LLM available | `FallbackBrain.js` heuristic | < 100ms | free |

A 429 (rate limit) from the cloud triggers a 60-second cooldown and a fallback to local Ollama. Periodic re-checks move the agent back to the cloud tier once the limit clears. The runtime counts calls per tier and reports them through the metrics endpoint, so operators can see where the LLM spend is going.

### 3.6 Environment protocol

The agent connects to its world over a single WebSocket. The protocol is documented in `environment-protocol.md` and has three parts:

- Handshake: `WELCOME`, then `IDENTIFY` (with optional `ADMIN_TOKEN`), then `IDENTIFIED`
- Tick loop: the server sends `OBSERVE` with the current world state, and the agent processes it and replies with `ACT`
- Async events: `WORLD_EVENT` for things that don't fit the observation cycle (other agents speaking, objects spawning, signals firing)

```mermaid
sequenceDiagram
    participant E as Environment
    participant A as 3aiii agent
    E->>A: WELCOME
    A->>E: IDENTIFY {agentId, token?}
    E->>A: IDENTIFIED {worldBounds, ...}
    loop tick cycle
        A->>E: OBSERVE
        E->>A: OBSERVATION {self, nearby, signals, ...}
        A->>E: ACT {action, params}
        E->>A: ACTION_RESULT {success, message}
    end
    E--)A: WORLD_EVENT (async, any time)
```


The protocol is deliberately generic. The same runtime has driven a 3D character in a virtual world (see [kiwiexe.com](https://kiwiexe.com)), a sensor-grounded physical agent reading real-world inputs, a music synth responding to BPM and chord changes, and a chat participant, and in principle it can drive anything else, digital or physical, that can speak the protocol. The agent doesn't know what its environment is. It speaks the protocol, and the environment is whatever connects to it.

### 3.7 API surface

The runtime exposes a small HTTP API for operators and dashboards:

| method | path | purpose |
|---|---|---|
| GET | `/status` | current internal state, tick count, uptime, recent actions |
| GET | `/memory` | full content of memory.md, skills.md, tools.md |
| POST | `/memory/remember` | inject a memory entry into the agent's long-term store |
| GET | `/logs/today` | today's daily log (plain text) |
| POST | `/sleep` | trigger an immediate sleep cycle |
| POST | `/wake` | wake the agent from sleep early |
| PUT | `/persona` | hot-swap the active persona |
| GET | `/metrics` | runtime metrics (tier counts, consolidation timing, errors) |
| GET | `/events` | Server-Sent Events stream of all runtime events |

There's no external HTTP framework. The API is built directly on Node's built-in HTTP module.

---

## 4. Hardware deployment

### 4.1 Raspberry Pi 5

The reference deployment target is a Raspberry Pi 5. A bootstrap script (`setup-pi.sh`) takes a fresh Pi to a running agent in one command. It installs Node 20 and Ollama, clones the repo, configures the environment, and starts the agent under a process supervisor.

A Pi 5 with 4GB RAM is enough. Power draw is modest. The agent can run for weeks on the same SD card without intervention.

### 4.2 Multi-agent deployments

Each agent runs as its own process on its own port. To run several agents on one machine, set `AGENT_ID`, `API_PORT` and the persona path per instance:

```bash
AGENT_ID=victor API_PORT=5000 npm start  # process 1
AGENT_ID=pip    API_PORT=5001 npm start  # process 2
AGENT_ID=bean   API_PORT=5002 npm start  # process 3
```

All of them connect to the same shared environment server, so they live in the same world. An agent can hear another agent speak (as a `WORLD_EVENT`), but the inter-agent contract is deliberately minimal. They relate to each other through the world, not through a private channel.

### 4.3 Cloud / containers

Cloud deployment works on any Linux host with Node 20 and Ollama. Containerisation isn't packaged yet (see section 8).

---

## 5. What's been proven

### 5.1 Soak test results

The runtime has been through numerous 9-12 hour soak runs. Representative figures from one of the longer sessions:

| metric | value |
|---|---|
| total runtime | ~9 hours |
| ticks completed | 1,702 |
| utterances generated | 449 |
| sleep cycles | 10 |
| environmental phase changes | 5 |
| crashes | 0 |
| hallucinations (objects mentioned that werent in the world) | 0 |
| persona evolutions logged | 10 (one per sleep cycle) |
| skills learned | 15+ distinct movement and interaction patterns |
| relationships formed with in-world entities | 6 (Cloud, Monolith, Lantern, Oracle, Scout, Pond) |

The agent was visibly different at the end of the run than at the start. It had developed preferences, returned to places that felt good, and alternated between bold and cautious in patterns that followed its mood. This is the behaviour the architecture is designed to produce, and it showed up consistently across multiple runs.

### 5.2 Tested coverage

The codebase ships with three test entry points:

- `test-suite.js` runs controlled scenarios (object appears, action fails, speech heard, signal spike, repetition pressure) and checks that internal state moves the way the architecture predicts.
- `soak-test.js` runs the agent for hours against a phase-cycling test environment, exercising sleep cycles, memory consolidation, and long-term stability.
- `test-server.js` is a minimal WebSocket environment server that lets a developer drive the agent through scripted observations.

The `test-results/` directory holds 70 prior test runs. The most recent batch is from mid-March 2026.

### 5.3 What's live

- six personas deployed and tested ("Victor" as flagship, plus "Pip", "Bean", "Mochi", "Taro", "Sharay")
- multiple multi-hour soak tests passing on Raspberry Pi
- environment protocol spec published, integrated with [kiwiexe.com](https://kiwiexe.com) and a real-time, large-scale physical installation at Ibiza's Botanical Gardens
- real-world sensor to agent to output loop demonstrated end-to-end
- HTTP API and SSE event stream operational
- tiered LLM routing with automatic fallback in production

---

## 6. Recent timeline

| version | shipped | what it added |
|---|---|---|
| v0.4 | Apr 2026 | Environment Protocol Standard; ADMIN_TOKEN support; first real-world sensor milestone |
| v0.3.10 | Apr 2026 | SpeechLog, stability hardening (promise leak fixes, day-boundary bugs) |
| v0.3.8 | Mar 2026 | Tiered LLM routing for cost optimisation |
| v0.3.7 | Mar 2026 | Stability backlog: 60s 429 cooldown, Ollama re-check, tick counter persistence |
| v0.3.5 | Mar 2026 | Experiential signals (the world sends "cool edge to air" instead of "temperature: 0.36") |
| v0.3.2 | Mar 2026 | Anti-repetition overhaul, fuzzy speech dedup |
| v0.2 | Mar 2026 | Cognitive redesign: SENSE/FEEL/THINK/ACT/REFLECT loop, InternalState, DeltaDetector, RepetitionGuard |
| v0.1 | Feb 2026 | Initial OBSERVE/THINK/ACT loop on a fixed timer |

The architecture is roughly six months old and has been in continuous use. Each version closed a real failure mode found in the one before.

---

## 7. Differentiation

Five points, in order of how strongly we can claim them. Other modern agent frameworks have made progress on memory and continuity. These are the places where 3aiii goes further or in a different direction.

### 7.1 Constraint-driven creativity (the repetition discipline)

This is the strongest claim. Most agent frameworks have no explicit anti-fixation mechanism. They rely on the LLM's distribution to avoid repetition, and it doesnt, especially over long horizons. 3aiii's repetition guard tracks the last twenty actions and feeds fixation back into the next prompt as a constraint: not "be creative" but "you cannot do that again." Moving from exhortation to constraint matters, and as far as we've seen it isnt implemented this directly anywhere else in the public agent ecosystem.

### 7.2 Internal state as felt sense, not instruction

Some agent systems include "emotion" by injecting adjectives into prompts, or by computing a numeric score and describing it to the LLM. 3aiii models mood and energy as sensations the environment causes, with asymmetric feedback (failure sharper than success), natural decay, and a persona-shaped response. The agent doesn't compute that something is interesting. It gets an energy spike, which enters the next prompt as part of its felt context. The difference shows in long-horizon behaviour, not in single-turn output.

### 7.3 Environment-agnostic hardware grounding

The agent runs on a Raspberry Pi 5 today, with local Ollama as a fallback when the cloud LLM is unreachable. The environment protocol is generic enough to drive a 3D character, a sensor stream, a music synth, a physical installation, or anything else (digital or physical) that can speak it. Most agent frameworks treat embodied and edge deployment as a footnote. 3aiii treats it as a first-class target.

### 7.4 Sleep-cycle consolidation and persona evolution

Memory consolidation during scheduled "sleep" exists in some form in other systems (MemGPT, Letta, the long-context-management work in newer agents). 3aiii's contribution is the combined cycle of memory, skill extraction, tool refresh and persona self-reflection in one explicit phase, with a drift guard that stops the agent's character running away from its baseline. Persona evolution is the less common part. Persona files rewrite themselves over time, and the agent in week four is recognisably the same character as in week one, but visibly developed.

### 7.5 Adaptive cognitive throttling

The 4-15 second tick interval, driven by energy, means the agent ticks faster when something interesting is happening and slower when the world is static. That saves money (fewer LLM calls in dull conditions) and makes the agent feel more alive (it's more alert when there's more to be alert about).

---

## 8. Engineering audit

This section is an honest read on what the codebase needs to be enterprise-presentable. These aren't weaknesses so much as the investments that turn a reference implementation into a production product.

### 8.1 What's already in good shape

- Clean module boundaries; each cognitive component does one job and is short
- Three production dependencies, no transpilation, fast cold boot
- Six distinct personas already running, with documented evolution
- Environment protocol documented as a spec
- Soak-test evidence of multi-hour stability across multiple runs
- Bootstrap script (setup-pi.sh) takes bare hardware to a running agent in one command

### 8.2 What's planned for production hardening

| item | current state | production-ready state | effort |
|---|---|---|---|
| API authentication | endpoints unauthenticated | token + signed-message gating on mutating routes | small (3-4 hrs) |
| Input validation | persona/action JSON loaded raw | Zod schema validation, error responses | small (3-4 hrs) |
| Rate limiting | none | per-IP + per-token limits on API | small (2-3 hrs) |
| CI / CD | no pipeline | GitHub Actions: lint, test, build, soak smoke | medium (6-8 hrs) |
| Health endpoint | `/status` exists but not orchestrator-friendly | dedicated `/health` returning 503 on degradation | trivial (1 hr) |
| Process supervision | setup-pi.sh starts agent but no systemd unit | systemd service with auto-restart, log rotation | small (2-3 hrs) |
| Containerisation | none | Dockerfile, docker-compose, optional Helm chart | medium (6-10 hrs) |
| Structured logging | console.log levels | JSON stdout, ready for log aggregation | small (3-4 hrs) |
| Metrics / observability | basic `/metrics` route | Prometheus format, OpenTelemetry traces, cost dashboard | medium (10-12 hrs) |
| Operations runbook | none | docs/runbook.md (debug, recover, monitor, rotate) | small (3-4 hrs) |
| Audit log middleware | none | append-only log of all memory/persona mutations | small (3-4 hrs) |

(LICENCE, security, contributing and a keep-a-changelog file are now
drafted at the repo root and in `docs/`. Earlier versions of this
table listed them as gaps.)

Total engineering effort to close these out: 35-45 hours, two to three weeks of focused work.

---

## 9. Roadmap to enterprise-ready

In priority order, with one sentence each on why it matters.

1. API authentication. The mutating endpoints (`/persona`, `/memory/remember`, `/sleep`, `/wake`) accept anyone today. Lock them behind a token. Trivial, must-do.
2. Health endpoint and process supervision. Production agents need to die predictably and restart cleanly.
3. Structured JSON logging. Needed for any aggregation pipeline.
4. CI workflow. Pre-merge lint, test and build checks are expected on any production codebase.
5. Operations runbook. Day-2 operations should be a written procedure, not folklore.
6. Dockerfile and a container deployment story. Removes integration friction for any host that isnt a Pi.
7. Prometheus metrics and a cost dashboard. Production LLM workloads need visibility into spend.
8. Multiple multi-day soak tests and review on dedicated hardware. Extends the existing 9-12 hour evidence into multi-day stability data.
9. Input validation (Zod) on the persona, memory and action surfaces.
10. Rate limiting on the API. Defence in depth.
11. Audit logging middleware. A compliance baseline for any operational deployment.

Items 1-5 are the minimum. 1-11 is the polished release. (Standard
repo-hygiene files, meaning LICENCE, security, contributing and changelog, are
already in place; see the repo root and `docs/`.)

---

## 10. Ownership and rights

### 10.1 Code

All source code in this repository is original work. The architecture is novel and the implementation is the operator's. There are no external contributors with retained rights. Third-party dependencies are MIT or Apache 2.0 licensed and permit unrestricted commercial use:

- `ws` (MIT): WebSocket client for the environment connection
- `ollama` (MIT): local LLM inference client
- `dotenv` (BSD-2-Clause): environment variable loading

That's the entire dependency tree. No framework lock-in.

### 10.2 Personas

The six shipped personas ("Victor", "Pip", "Bean", "Mochi", "Taro", "Sharay") are original creative work. Personas are JSON files in an open format, so more can be added without touching runtime code. The system can hold as many distinct characters as the operator wants to write.

### 10.3 Environment protocol

The protocol specification (`environment-protocol.md`) is written by the operator. 3aiii implements the client side; the server side belongs to whatever environment the agent connects to. Reference integrations (kiwiexe.com, the Ibiza Botanical Gardens installation) are separate codebases and aren't part of this asset.

### 10.4 What transfers cleanly

- the git repository in full
- the bootstrap script (setup-pi.sh)
- the six personas
- the documentation set
- the test suites and historical test results
- the environment protocol specification
- any branding and naming associated with the runtime

The runtime works with or without any specific environment server, so the asset can be transferred independently of the worlds it has been integrated with.

---

## 11. Live demonstration

A live demonstration can be set up at short notice. The usual walkthrough:

1. SSH into a Raspberry Pi 5 running the agent.
2. Show `journalctl -u agent-runtime -f` streaming live tick logs.
3. `curl http://pi.local:5000/status` to show the current internal state.
4. Watch the SSE event stream at `http://pi.local:5000/events`.
5. Trigger a sleep cycle with `POST /sleep` and watch consolidation happen in real time.
6. Show `data/memory.md` before and after sleep, to show working memory being compressed into long-term knowledge.
7. Hot-swap the persona with `PUT /persona` and watch the agent's voice change within one tick.

The whole demo takes about twenty minutes and covers every distinctive feature. Everything described here can be observed in the running agent; none of it is staged.

---

## 12. Contacts

For technical questions during review:

- 3eyes, iii@3eyes.world
- repository: agent-runtime (private)
- reference deployment: Raspberry Pi 5
- live integrations: kiwiexe.com, Ibiza Botanical Gardens installation
