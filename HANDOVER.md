# 3aiii — Diligence Handover

This is the diligence package for 3aiii, the autonomous agent cognition
runtime developed by Sam Skirrow. The package is structured for evaluation
by a technical reviewer, a patent attorney, and a transactional lawyer
working in parallel.

If you're a developer with thirty minutes, read this file, then
`QUICKSTART.md`, then run the agent.
If you're a patent attorney, read `docs/CODEBASE_AUDIT_MEMO.md` and
`docs/agent-runtime-overview.md`.
If you're a lawyer, read `LICENCE`, `docs/SBOM.md`, and `SECURITY.md`.

---

## What's in this package

### Code

The entire runtime, around 3,000 lines of Node.js, with three direct npm
dependencies and no build step. Modules organised under `src/`:

```
src/
  loop/           Heartbeat (adaptive 4-15s tick), SleepCycle (4h/1h)
  cognition/      InternalState (mood/energy), DeltaDetector,
                  RepetitionGuard, Think, Perceive, FallbackBrain
  memory/         WorkingMemory (ring buffer), MemoryFiles (persistent
                  markdown), DailyLog (rotating logs), SpeechLog
  llm/            LLMClient (tiered routing), PromptBuilder
  connection/     EnvironmentSocket (WebSocket client)
  api/            ApiServer (HTTP + SSE)
  logging/, util/, config.js, index.js
```

Each module is single-responsibility and intentionally short. Comments
explain *why*, not *what*. See `CONTRIBUTING.md` for the conventions.

### Documentation

- `README.md` — five-minute orientation, setup, API surface
- `QUICKSTART.md` — verbatim ten-minute path: clone, install, run, see a
  thinking cycle
- `docs/agent-runtime-overview.md` — full technical overview. Architecture,
  module layout, cognitive pipeline detail, memory model, persona system,
  LLM routing, deployment notes, what's been proven, what's planned for
  production hardening, ownership and rights. Approximately 680 lines.
  This is the primary technical reference document
- `docs/ENVIRONMENT_PROTOCOL.md` — the WebSocket contract any host
  environment has to implement. Approximately 350 lines with worked
  examples for a 3D world and a synth bridge
- `docs/CODEBASE_AUDIT_MEMO.md` — operator-authored audit of the codebase
  against the four patent-relevant items, with file/line evidence,
  structural claim shapes, known prior art, confidence levels, and
  caveats for sworn declaration. This is the document a patent attorney
  should start from
- `docs/PROGRESS-2026-03-14-15.md` — a 48-hour development log spanning
  v0.2 → v0.3.7. Documents the design principles that emerged from
  repeated soak-test failures. Useful for understanding *why* the
  codebase looks the way it does
- `docs/SBOM.md` — software bill of materials. Four production packages
  total (3 direct + 1 transitive), all permissive licences, no copyleft.
  Generated via `npx license-checker --production`
- `STATUS-2026-02-28.md`, `STATUS-2026-03-10.md` — earlier development
  snapshots, kept as historical evidence
- `CHANGELOG.md` — version history with the substantive change per release

### Endpoints

When the agent is running, it exposes an HTTP API on port 5000 (default):

- `GET /status` — current internal state, tick count, recent actions
- `GET /memory` — full content of memory.md, skills.md, tools.md
- `POST /memory/remember` — inject a memory entry
- `GET /logs/today` — today's daily log
- `POST /sleep` — trigger sleep cycle now
- `POST /wake` — wake from sleep early
- `PUT /persona` — hot-swap the active persona
- `GET /metrics` — runtime metrics for observability
- `GET /events` — Server-Sent Events stream of all runtime events

Full reference in `docs/agent-runtime-overview.md` section 3.7.

### Tests the buyer's developers can run

Three entry points at the repo root:

- `test-suite.js` — ten controlled scenarios (object appears, action
  fails, speech heard, signal spike, repetition pressure, synth-mode
  transition). Runs in ~12 minutes and writes a report to `test-results/`
- `soak-test.js` — long-running phase-cycling test. `SOAK_HOURS=1` for
  a quick run, `SOAK_HOURS=8` for the buyer-facing endurance evidence
- `test-server.js` — minimal interactive WebSocket environment server.
  Keyboard controls (`o` adds an object, `s` sends speech, `c` toggles
  signals, etc.) let you drive the agent through whatever scenario you
  want

Run pattern: start one of the test servers in one terminal, start the
agent (`npm start`) in another. See `QUICKSTART.md` for verbatim
commands.

### Test results we have run

Two batches in `test-results/`:

- **Historical (2026-03-14 onwards):** ~60 raw + report files from the
  development period. These are honest artifacts of earlier work. They
  reference the previous `valence`/`arousal` field names in their raw
  JSON (renamed in 2026-05); the substance and structure of the agent
  behaviour they document is unchanged
- **Diligence (`test-results/diligence/`):** two fresh post-rename runs:
  - `smoke-2026-05-12.md` — module-level smoke. Confirms all five
    core modules (InternalState, WorkingMemory, RepetitionGuard,
    DeltaDetector, Perceive) work end-to-end post-rename. Raw output
    next to it as a `.txt`
  - `integration-smoke-2026-05-12.md` — full-pipeline integration
    smoke. Agent boots, connects to a WebSocket env server via the
    protocol, completes four real LLM-driven ticks against local
    Ollama, exposes a working API. Boot log, protocol round-trips,
    `/status` and `/metrics` snapshots all included

Recommended next step before delivery: run the full controlled
`test-suite.js` (ten scripted scenarios, ~5-10 min with a cloud API key,
~50 min with local Ollama only) on a machine with a Groq key and add
the resulting report to `test-results/diligence/`. The two smokes
above cover module shapes and end-to-end wiring; the controlled suite
covers the full ten-scenario behavioural envelope.

### Commit history

Forty-six commits, 2026-02-20 → 2026-05-04. Clear version progression
from v0.1 (initial OBSERVE/THINK/ACT loop on a fixed timer) through
v0.4 (Environment Protocol Standard) and the v0.3.x stability series.
`git log` for the full record; `CHANGELOG.md` for the summarised view.

### Personas

Six JSON files in `personas/`: Victor (flagship, ~10 weeks of soak-test
data), Pip, Bean, Mochi, Taro, Sharay. The format is open (`id`, `name`,
`traits`, `values`, `fears`, `quirks`, `voice`, `backstory`). Adding a
new persona doesn't require touching runtime code.

### Standard repo hygiene

- `LICENCE` — All Rights Reserved (pre-acquisition; rights transfer at
  closing per the deal terms)
- `SECURITY.md` — vulnerability reporting + honest read on current
  security posture and the production-hardening backlog
- `CONTRIBUTING.md` — local setup, conventions, testing pattern
- `.env.example` — annotated environment-variable template
- `.gitignore` — covers `.env`, `data/`, `node_modules/`, `test-logs/`

---

## How to evaluate this in 30 minutes

1. **First 5 minutes.** Read this file (you're nearly done) and the
   executive summary of `docs/CODEBASE_AUDIT_MEMO.md`
2. **Next 10 minutes.** Skim `docs/agent-runtime-overview.md` sections 1
   (pitch), 2 (why this exists), 3.2 (the cognitive pipeline in detail),
   8.2 (engineering audit / production-hardening backlog), 10
   (ownership and rights)
3. **Next 10 minutes.** Run the agent following `QUICKSTART.md`. Open
   `/status` in your browser, watch a few ticks, trigger a sleep cycle,
   hot-swap a persona
4. **Last 5 minutes.** Skim `docs/CODEBASE_AUDIT_MEMO.md` for the item-
   by-item findings on the four patent-relevant components and the
   honest "what I will and will not sworn-state to" closing

This gives you a representative read on the codebase. Deeper review
(reading the actual module source) takes another 2-3 hours; the
overview doc tells you which modules to read first depending on what
you're evaluating.

---

## Honest framing the buyer should know

Three things to be clear about before further evaluation:

**The runtime is a reference implementation, not a productionised
service.** The architecture is solid and proven over multi-hour soak
runs. The operational surface (auth, rate limiting, structured logging,
CI, container packaging) is not yet built. `docs/agent-runtime-overview.md`
section 8.2 lists thirteen production-hardening items totalling about
40-50 hours of engineering work. The buyer should plan for that work
or accept that the asset is suitable for further development rather
than direct production deployment.

**Implementation was AI-assisted; the inventive ideas were not.** The
operator authored the architecture, the design principles, and the
composite designs documented in the audit memo. The line-level
implementation of those designs was produced with AI tooling. This is
the standard mode of modern engineering work and is documented honestly
in the audit memo. Patent counsel should be told this; sworn
declarations on sole inventorship should reflect the distinction
between "I conceived the design" and "I personally typed every
character".

**One worked example referenced in the marketing docs requires
external verification.** The Ibiza Botanical Gardens installation is
claimed as a live deployment for the hardware-grounded loops item. If
the buyer wants to rely on this as evidence, the operator can arrange
photos, deployment logs, or a live walkthrough of the installation.
Without that external verification, the claim should be framed as
"designed for hardware grounding with one prior live deployment" rather
than "demonstrated end-to-end".

---

## What's expected to transfer at closing

Per the operator's intent and the package above:

- The full git repository, history intact
- All six personas
- The documentation set in `docs/` and at the repo root
- The bootstrap script (`setup-pi.sh`)
- The three test entry points and the historical + diligence test
  results
- The environment protocol specification
- The 3aiii brand and naming associated with the runtime
- Any patent rights arising from the four items in the audit memo,
  subject to patent counsel review

The runtime is functional with or without any specific environment
server, so the asset is transferable independent of the worlds it has
been integrated with (kiwiexe.com, the Ibiza Botanical Gardens
installation). Those integrations are separate codebases.

---

## Contact

Sam Skirrow — sam.skirrow@gmail.com

Available for technical questions, walkthrough demos, and patent-counsel
follow-up during the review window.
