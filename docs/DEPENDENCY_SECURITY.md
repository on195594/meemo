# Dependency security (VR-213)

## 2026-10-15 frontend release audit remediation

The note-card release audit reported nine frontend package findings, including critical findings in the development-only Vitest/Tinypool chain and a high finding in `source-map-js`. Under separate authorization, the frontend now locks Vite `6.4.4`, Vitest `4.1.11`, DOMPurify `3.4.17`, `source-map-js` `1.2.2`, and `brace-expansion` `5.0.12`; the Vitest upgrade removes Tinypool entirely. Vite 6 remains compatible with the existing Vue plugin, so Vue, its plugin, and TypeScript do not change. No dependency overrides or blanket `npm audit fix --force` are used.

After a clean frontend `npm ci`, all 207 frontend tests, typechecking, and the production build pass on Node.js 22 without test/configuration changes. The complete `npm --prefix web audit` and root `npm audit --omit=dev` both report zero vulnerabilities. The root full audit still reports eight development-only findings (one low, seven high, no critical), outside this frontend remediation; they are not included in the production image. These are registry snapshots, not a guarantee against future advisories; historical audit results below are unchanged.

## 2026-10-12 upload-abort security fix

The deployment candidate upgrades the existing upload dependency to `multer@2.4.0` (minimum manifest version `^2.4.0`). The official [GHSA-3pph-fpjx-jg34 advisory](https://github.com/advisories/GHSA-3pph-fpjx-jg34) identifies orphaned disk writes after aborted uploads in `>=2.2.0, <2.4.0`; `2.4.0` is the first patched version. Disk-backed archive imports cross this boundary; memory-backed attachment uploads do not leave disk files through that mechanism.

The current root `npm audit --omit=dev` reports **zero production vulnerabilities**. An isolated HTTP regression verifies that disconnecting an incomplete disk upload removes its temporary file; existing size, nesting, malformed-body, authentication and import/export regressions remain. Only multer and its no-longer-needed transitive packages change; no blanket audit fix or framework upgrade is applied. Development-only findings remain outside this production fix.

## Initial MCP candidate audit (`c9c8ddc`, historical)

Phase-1 integration adds exact `@modelcontextprotocol/sdk@1.32.1` and `express-rate-limit@8.7.1`. The SDK's nested Express 5 dependency requires `proxy-addr@2.0.8`, so npm deduplication also advances the compatible shared transitive version from 2.0.7. The app's Express 4 and other existing package versions are unchanged; `npm ci` verifies the resulting lockfile.

`npm audit --omit=dev` on this candidate reports one **moderate** finding in existing `multer@2.3.0` (unchanged from HEAD), not a clean production audit. MCP-added packages are not named in that report. No blanket `npm audit fix` or unrelated dependency upgrade was performed; remediate/accept the existing finding under the release security policy. Prior scan results below are historical snapshots, not proof of the current registry state.

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
| `@mapbox/node-pre-gyp` (high), `brace-expansion` (high), `minimatch` (high), `tar` (critical) | `bcrypt@5.1.1 > @mapbox/node-pre-gyp > tar` | Install-time native-module tooling, not request-time application code. A compromised or crafted installation input could reach the vulnerable archive/glob code. | Upgrade `bcrypt` to `6.0.0`, which uses `node-gyp-build` and removes this chain. | Accepted the related major upgrade because Node 24+ is already required and authentication tests exercise bcrypt hashing and comparison. |
| `markdown-it` (high), `linkify-it` (high) | Direct `markdown-it@13.0.1 > linkify-it@4.0.1` | Remotely supplied note content reaches Markdown parsing and linkification; the reported quadratic/ReDoS behavior is reachable. | Upgrade to `markdown-it@15.0.2` and `linkify-it@6.1.0`. | Accepted the related major upgrade; server tests and the frontend build/typecheck cover the parsing integrations. |
| `body-parser` (high), `express` (high), `path-to-regexp` (high) | Direct `body-parser@1.20.2`; direct `express@4.18.3 > body-parser/path-to-regexp` | Every API request reaches Express routing and JSON parsing, so the DoS/ReDoS paths are remotely reachable. | Upgrade within Express 4 to `express@4.22.2`, `body-parser@1.20.8`, and patched transitive releases including `path-to-regexp@0.1.13`; pin `qs@6.16.0` with an override. | Avoided the unrelated Express 5 major upgrade while removing the reported production vulnerabilities. |
| `tar-fs` (high) | Direct `tar-fs@2.1.1` | Authenticated archive import reaches extraction. Existing validation reduces exposure, but crafted archives still cross this trust boundary. | Upgrade to `tar-fs@2.1.5`. | Applied the compatible patch release and retained the application-level archive validation. |
| `minimist` (critical), `prettyjson` (critical) | `supererror@0.7.2 > prettyjson@1.2.1 > minimist@1.2.0` | `supererror` was loaded globally at process startup; its formatter/CLI dependency was unnecessary to serve requests but remained production-installed. | Remove the startup hook and the `supererror` dependency. | Deleted the nonessential dependency instead of carrying an override for its bundled vulnerable tree. |
| `underscore` (high) | `markdown-it-checkbox@1.1.0 > underscore@1.13.1` | Checkbox rendering runs on supplied Markdown. The plugin does not intentionally expose Underscore APIs, but keeping a vulnerable parser dependency is unnecessary. | Override `underscore` to `1.13.8`. | Applied the fixed compatible release without replacing the Markdown plugin. |

`express-session` was also updated to `1.18.2`, and `bn.js` was overridden to `4.12.3`, removing the remaining low and moderate production audit findings without a framework major upgrade.

## Historical post-remediation production findings

Neither the root nor `web/` production audit has a remaining critical or high finding. Both production audits are clean at every severity. The regenerated root lockfile also removes stale package trees that were no longer declared by `package.json`; retaining them would make production installs and audit results inconsistent with the manifest.

Development-only findings are outside this production remediation scope and should be triaged separately rather than addressed with `npm audit fix --force` or unrelated major upgrades.
