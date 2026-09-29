# Software Bill of Materials

Generated 2026-05-12 against the `main` branch (commit `09975a7`).

## Method

The production dependency tree was pulled with `npx license-checker --production --json`
and checked against `npm ls`. There are no dev dependencies (this project has none).

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

- Total production packages: 4 (3 direct + 1 transitive)
- All licences are permissive: 3 MIT, 1 BSD-2-Clause
- No copyleft licences (no GPL, LGPL, AGPL, MPL)
- All four licences allow unrestricted commercial use, including in proprietary
  software, without requiring the source of the surrounding application to be disclosed
- No dev dependencies declared. Testing uses only Node built-ins (the three
  test entry points at the repo root rely on `node:http`, `ws` and `node:fs`,
  and `ws` is already a production dependency)

## Per-licence breakdown

MIT (3 packages): `ollama`, `ws`, `whatwg-fetch`. Permits use, copying,
modification, distribution and sale; requires the copyright notice and licence
text to be included with copies of the package.

BSD-2-Clause (1 package): `dotenv`. Permits use, copying, modification and
distribution; requires the copyright notice and disclaimer to be retained.

## Note on the project's own licence detection

`license-checker` reports the project itself (`agent-runtime@0.1.0`) as
`Custom: https://ollama.com`. This is a false positive: the tool parsed the
README's link to ollama.com and took it for a licence URL. The project's
own licence is `All Rights Reserved` (see `../LICENCE` at the repo root).
`package.json` doesn't declare a `license` field; I recommend adding
`"license": "UNLICENSED"` before any future public publication.

## Action items for the buyer's lawyer

- All four production dependencies are clean for commercial use. No source
  disclosure obligations attach.
- The three direct dependencies are well-known, actively maintained projects
  (`ws` alone has 100m+ weekly downloads). Low supply chain risk.
- `whatwg-fetch` is GitHub's fetch polyfill, pulled in by `ollama`'s npm
  client. It's there for browser-compat code paths that this Node runtime
  doesn't execute, but the package still ships.
- No transitive licences to flag, and no `npm audit` warnings at the time
  of generation. Recommend re-running before closing.

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
