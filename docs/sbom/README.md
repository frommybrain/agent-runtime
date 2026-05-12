# Software Bill of Materials

Generated 2026-05-12 against the `main` branch (commit `09975a7`).

## Method

Production dependency tree pulled via `npx license-checker --production --json`.
Tree confirmed against `npm ls`. No dev dependencies (this project has none).

## Production dependencies

### Direct (declared in `package.json`)

| Package | Version | Licence | Source |
|---|---|---|---|
| `dotenv` | 16.6.1 | BSD-2-Clause | https://github.com/motdotla/dotenv |
| `ollama` | 0.5.18 | MIT | https://github.com/ollama/ollama-js |
| `ws` | 8.19.0 | MIT | https://github.com/websockets/ws |

### Transitive

| Package | Version | Licence | Pulled in by | Source |
|---|---|---|---|---|
| `whatwg-fetch` | 3.6.20 | MIT | `ollama` | https://github.com/github/fetch |

## Summary

- Total production packages: **4** (3 direct + 1 transitive)
- All licences are permissive: 3 × MIT, 1 × BSD-2-Clause
- No copyleft licences (no GPL, LGPL, AGPL, MPL)
- All four licences permit unrestricted commercial use, including in proprietary
  software, without requiring source disclosure of the surrounding application
- No dev dependencies declared. The project uses only Node built-ins for testing
  (the three test entry points at the repo root rely on `node:http`, `ws`, and
  `node:fs` — `ws` is already a production dep)

## Per-licence breakdown

**MIT (3 packages):** `ollama`, `ws`, `whatwg-fetch`. Permits use, copying,
modification, distribution, sale; requires copyright notice + licence text be
included with copies of the package.

**BSD-2-Clause (1 package):** `dotenv`. Permits use, copying, modification,
distribution; requires copyright notice + disclaimer be retained.

## Note on the project's own licence detection

`license-checker` reports the project itself (`agent-runtime@0.1.0`) as
`Custom: https://ollama.com`. This is a false positive — the tool parsed the
README's link to ollama.com and mistook it for a licence URL. The project's
own licence is `All Rights Reserved` (see `../LICENCE` at the repo root).
`package.json` doesn't declare a `license` field; recommend adding
`"license": "UNLICENSED"` before any future public publication.

## Action items for the buyer's lawyer

- All four prod dependencies are commercial-use-clean. No source disclosure
  obligations attach.
- The three direct dependencies are well-known, actively-maintained projects
  (the `ws` package alone has 100m+ weekly downloads). Low supply chain risk.
- `whatwg-fetch` is GitHub's fetch polyfill, pulled in by `ollama`'s npm
  client. Its inclusion is for browser-compat code paths that this Node
  runtime doesn't execute, but the package still ships.
- No transitive licences to flag, no audit warnings under `npm audit` at
  time of generation. Recommend re-running before closing.

## How to reproduce this report

```bash
cd agent-runtime
npm ci --omit=dev
npx license-checker --production --json
```

Cross-check with:

```bash
npm ls --all --omit=dev
npm audit
```
