# Contributing

This is currently a closed codebase, not accepting external contributions.

This document exists for the maintainer (and future maintainer post-transfer)
so the conventions stay consistent.

## Local setup

```bash
npm install
cp .env.example .env
# edit .env, set AGENT_ID, SERVER_URL, OLLAMA_MODEL, CLOUD_API_KEY
npm start
```

Needs Node 20+ and (optionally) [Ollama](https://ollama.com) for the local
LLM fallback.

## Conventions

- **Pure Node.js.** No TypeScript, no build step. ES modules.
- **Three direct dependencies only**: `ws`, `ollama`, `dotenv`. Adding a
  fourth needs a real justification (size, audit surface, transferability).
- **Small modules.** Aim for 200-300 lines per file, single responsibility.
- **Config via env vars** (see `src/config.js`). New tunables should default
  to a sane value and be overridable from `.env`.
- **Comment what's non-obvious.** Skip "what does this code do" comments
  (the code already says). Comment the *why*: hidden constraint, surprising
  behaviour, the bug that motivated the workaround.

## Testing

Three test entry points at the repo root:

- `test-suite.js` — controlled scenarios. Drives the agent through a
  scripted observation stream and checks internal state, action variety,
  and protocol compliance.
- `soak-test.js` — long-running phase cycling. Used for stability
  validation over hours.
- `test-server.js` — interactive WebSocket env server with keyboard
  controls. Useful for live debugging.

Run pattern:

```bash
# terminal 1: start the agent pointing at the local test server
SERVER_URL=ws://localhost:4001 node src/index.js

# terminal 2: start a test server
node test-server.js          # interactive
node test-suite.js           # scripted scenarios
node soak-test.js            # long-running
```

Reports get dumped to `test-results/`.

## Branch + commit conventions

- Work on feature branches off `main`.
- Commit messages: short imperative + version tag where applicable.
  Examples from history: `v0.3.7: Stability backlog — deployment readiness`,
  `Tune Sharay for wider output range, meaningful text, specific reasoning`.
- Bump the version string in `src/index.js` boot log when shipping a
  meaningful change.

## What's open

See `docs/3aiii-overview.md` section 8.2 for the production
hardening backlog. Highest-priority items: API auth, health endpoint,
process supervisor (systemd unit), structured logging, CI pipeline.
