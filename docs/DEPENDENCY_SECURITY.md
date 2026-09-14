# Dependency security (VR-213)

## Scope and result

Production dependencies were audited with `npm audit --package-lock-only --omit=dev --json` against the baseline and remediated lockfiles.

| Workspace | State | Low | Moderate | High | Critical | Total |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Root | Before | 5 | 2 | 10 | 3 | 20 |
| Root | After | 0 | 0 | 0 | 0 | 0 |
| `web/` | Before | 0 | 0 | 0 | 0 | 0 |
| `web/` | After | 0 | 0 | 0 | 0 | 0 |

## High and critical remediation map

The baseline root audit reported 13 high or critical vulnerable package nodes. The paths below account for all of them.

| Audit package(s) | Production dependency path | Reachability and risk | Fix | Decision |
| --- | --- | --- | --- | --- |
| `@mapbox/node-pre-gyp` (high), `brace-expansion` (high), `minimatch` (high), `tar` (critical) | `bcrypt@5.1.1 > @mapbox/node-pre-gyp > tar` | Install-time native-module tooling, not request-time application code. A compromised or crafted installation input could reach the vulnerable archive/glob code. | Upgrade `bcrypt` to `6.0.0`, which uses `node-gyp-build` and removes this chain. | Accepted the related major upgrade because Node 20+ is already required and authentication tests exercise bcrypt hashing and comparison. |
| `markdown-it` (high), `linkify-it` (high) | Direct `markdown-it@13.0.1 > linkify-it@4.0.1` | Remotely supplied note content reaches Markdown parsing and linkification; the reported quadratic/ReDoS behavior is reachable. | Upgrade to `markdown-it@15.0.2` and `linkify-it@6.1.0`. | Accepted the related major upgrade; server tests and the frontend build/typecheck cover the parsing integrations. |
| `body-parser` (high), `express` (high), `path-to-regexp` (high) | Direct `body-parser@1.20.2`; direct `express@4.18.3 > body-parser/path-to-regexp` | Every API request reaches Express routing and JSON parsing, so the DoS/ReDoS paths are remotely reachable. | Upgrade within Express 4 to `express@4.22.2`, `body-parser@1.20.8`, and patched transitive releases including `path-to-regexp@0.1.13`; pin `qs@6.16.0` with an override. | Avoided the unrelated Express 5 major upgrade while removing the reported production vulnerabilities. |
| `tar-fs` (high) | Direct `tar-fs@2.1.1` | Authenticated archive import reaches extraction. Existing validation reduces exposure, but crafted archives still cross this trust boundary. | Upgrade to `tar-fs@2.1.5`. | Applied the compatible patch release and retained the application-level archive validation. |
| `minimist` (critical), `prettyjson` (critical) | `supererror@0.7.2 > prettyjson@1.2.1 > minimist@1.2.0` | `supererror` was loaded globally at process startup; its formatter/CLI dependency was unnecessary to serve requests but remained production-installed. | Remove the startup hook and the `supererror` dependency. | Deleted the nonessential dependency instead of carrying an override for its bundled vulnerable tree. |
| `underscore` (high) | `markdown-it-checkbox@1.1.0 > underscore@1.13.1` | Checkbox rendering runs on supplied Markdown. The plugin does not intentionally expose Underscore APIs, but keeping a vulnerable parser dependency is unnecessary. | Override `underscore` to `1.13.8`. | Applied the fixed compatible release without replacing the Markdown plugin. |

`express-session` was also updated to `1.18.2`, and `bn.js` was overridden to `4.12.3`, removing the remaining low and moderate production audit findings without a framework major upgrade.

## Remaining production findings

Neither the root nor `web/` production audit has a remaining critical or high finding. Both production audits are clean at every severity. The regenerated root lockfile also removes stale package trees that were no longer declared by `package.json`; retaining them would make production installs and audit results inconsistent with the manifest.

Development-only findings are outside this production remediation scope and should be triaged separately rather than addressed with `npm audit fix --force` or unrelated major upgrades.
