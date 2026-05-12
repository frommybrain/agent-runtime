# Security

## Reporting a vulnerability

Email `sam.skirrow@gmail.com` with the subject line `3aiii security`.
Please don't open a public issue for a security problem.

Expect an acknowledgement within 72 hours. If the issue is confirmed, a fix
will be discussed and shipped before any public disclosure.

## Current security posture (honest read)

This codebase is a reference runtime, not a production-hardened service.
Anyone evaluating it for production deployment should be aware of the
following gaps before exposing it to an untrusted network:

### Authentication

- The HTTP API endpoints (`/status`, `/memory`, `/sleep`, `/wake`,
  `/persona`, `/memory/remember`, `/metrics`, `/events`) are unauthenticated.
- The mutating endpoints (`PUT /persona`, `POST /memory/remember`, `POST /sleep`,
  `POST /wake`) accept any caller. Anyone who can reach the API port can
  rewrite the agent's personality or inject memories.
- The WebSocket connection to the environment server supports an optional
  `ADMIN_TOKEN` (constant-time comparison on the server side). Set via the
  `ADMIN_TOKEN` env var. Required when the server is bound to a non-loopback
  interface.

**Mitigation today:** bind the API to `127.0.0.1` only and rely on a reverse
proxy with auth in front. Don't expose port 5000 to the internet.

### Input validation

- Persona JSON is parsed and merged with minimal type checking. A malformed
  `PUT /persona` body could be loaded if it satisfies the basic shape check
  (`id` and `name` required). Sleep-cycle drift guard catches malicious
  evolution attempts that exceed the threshold but not malformed inputs
  injected via the API.
- `POST /memory/remember` enforces a section whitelist (`Relationships`,
  `Learned Facts`, `Important Memories`) but doesn't sanitise content
  beyond that.

### Rate limiting

- No rate limit on any endpoint. A caller could exhaust the LLM quota by
  triggering rapid sleep cycles or memory injections.

### Secrets

- `CLOUD_API_KEY` (Groq) and `ADMIN_TOKEN` live in `.env`. `.env` is in
  `.gitignore` and should never be committed. Verify before any push.
- The runtime writes persona files, memory files, daily logs, and a state
  checkpoint to `./data/` on disk. No encryption at rest.

### Network

- The agent maintains a single outbound WebSocket connection to the
  environment server. Exponential reconnect backoff is implemented.
- The agent makes outbound HTTPS calls to the cloud LLM provider (Groq by
  default). No certificate pinning.

## What's planned

See `3aiii-overview.md` section 8.2 for the full production
hardening backlog. Items most relevant to security:

- API authentication (token + signed-message gating on mutating routes)
- Input validation via Zod schemas
- Per-IP + per-token rate limiting
- Audit log middleware for all memory/persona mutations
- Structured JSON logging ready for SIEM ingestion

Estimated total effort to close the security backlog: 15-20 hours.
