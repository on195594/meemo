# Dependency security (VR-213)

## 2026-10-22 audit snapshot (open, not remediated)

A live `npm audit` against `7b6eec8` reports new advisories published after the 2026-10-15 triage. They are recorded here, not yet fixed:

| Scope | Finding | Reachability | Available fix |
| --- | --- | --- | --- |
| Root, `--omit=dev` | `markdown-it@15.0.2` (high): [GHSA-vfgh-jcmw-g37q](https://github.com/advisories/GHSA-vfgh-jcmw-g37q) quadratic inline-HTML parsing with `html` enabled; [GHSA-gfr2-rv44-r23c](https://github.com/advisories/GHSA-gfr2-rv44-r23c) quadratic multi-line link reference definitions | Reachable: `src/services/thing-service.js` and `src/http/routes/public.js` render user note content with `html: true`. | `markdown-it@15.0.3` (in the current `^15.0.2` range; lockfile-only change). |
| Frontend, full | `markdown-it@14.x` (high): the two advisories above plus [GHSA-r7fv-28h4-cvq7](https://github.com/advisories/GHSA-r7fv-28h4-cvq7) smartquotes | Reachable in the browser renderer `web/src/utils/markdown.ts` (`html: true`); impact is client-side CPU on the viewer's own notes or shared notes. | `markdown-it@14.3.3` (in the `^14.1.0` range). |
| Frontend, full | `vitest`/`@vitest/mocker` `<=4.1.11` (moderate) | Development/test only. | Requires a Vitest upgrade; validate separately. |
| Root, full | `mocha` chain (`braces`, `chokidar`, `serialize-javascript`) | Unchanged from the 2026-10-15 conditional retention below. | `mocha@12` major upgrade. |

Re-run `npm audit` before acting; this table is a dated snapshot.

## 2026-10-15 root development dependency triage

This follow-up was verified against `c9062b061037f0af6d4c1ba69683caf5d5bba5eb` (which includes frontend remediation `7988740c73f3f1af563b1bda7b231b6187bbaf50`). Results below are live registry snapshots from 2026-10-15, not a guarantee against later advisories.

### Isolation and result

The initial full `npm audit --json` ran in an archived source copy inside a Bubblewrap filesystem/process namespace, with a new HOME/cache, an empty inherited environment, the public `https://registry.npmjs.org` registry, and no production directories, credentials, or Docker socket mounted. Dependency installation used `npm ci --ignore-scripts`; lockfile updates also disabled lifecycle scripts. Git metadata used for subsequent verification was copied independently, not shared through a worktree.

| Audit | Before | After |
| --- | --- | --- |
| Root, full | 8 package findings: 7 high, 1 low | 4 package findings: 4 high, no critical |
| Root, `--omit=dev` | Previously recorded as zero; rechecked after this change | **0** |
| Frontend, full | Previously remediated; rechecked after this change | **0** |

The eight original package findings cover 24 distinct advisory IDs, not eight independent production vulnerabilities. The four remaining package findings are `braces`, `chokidar`, `serialize-javascript`, and `mocha`; `chokidar` and `mocha` inherit findings and must not be counted as new vulnerability mechanisms. Three distinct advisories remain (two high, one moderate; npm assigns the highest severity to each affected package node).

### Minimal compatible changes and dependency paths

The only manifest change is the Mocha minimum, `^10.3.0` to `^10.8.2`, retaining Mocha 10. Its newer compatible dependency ranges permit the patched lockfile resolutions below. Existing production overrides are unchanged; no new overrides, `--force`, or `--legacy-peer-deps` are used. All 201 non-root production package entries in the lockfile are byte-equivalent as parsed JSON to the baseline. In particular, production's hoisted `debug@4.3.4` stays unchanged; Mocha's newer `debug@4.4.3` is nested under Mocha instead of updating the shared runtime copy. Clean `npm ci` and `npm ls --all` validate the resulting tree and constraints.

| Original finding / source | Before → locked after | Disposition |
| --- | --- | --- |
| `mocha` (direct dev dependency) | `10.3.0` → `10.8.2` | Compatible minor upgrade; still inherits the remaining findings below. |
| `mocha > glob/minimatch > brace-expansion`; `openapi-typescript > @redocly/openapi-core > minimatch > brace-expansion` | Mocha copy `2.0.1`, Redocly copy `2.1.4` → shared `2.1.7` | All eight original brace-expansion advisories cleared, including the code-generation chain. |
| `mocha > chokidar > braces` | `3.0.2` → `3.0.3` | Fixes GHSA-grv7-fg5c-xmjg; deep-pattern stack exhaustion remains. |
| `mocha > diff` | `5.0.0` → `5.2.2` | GHSA-73rr-hh4g-fpgx cleared within diff 5. |
| `mocha > js-yaml` | Nested `4.1.0` → existing root `4.3.2` | All five original js-yaml advisories cleared by deduplication; direct dev dependency unchanged. |
| `mocha > minimatch` (also reached through `glob`) | `5.0.1` → `5.1.9` | All three original minimatch advisories cleared within minimatch 5. Redocly already used `5.1.9`. |
| `mocha > chokidar > anymatch/readdirp > picomatch` | `2.3.1` → `2.3.2` | Both original picomatch advisories cleared within picomatch 2. |
| `mocha > serialize-javascript` | `6.0.0` → `6.0.2` | GHSA-76p7-773f-r4q5 cleared; the two newer advisories below remain. |

Direct `supertest@7.2.2`, `openapi-typescript@7.13.0`, `js-yaml@4.3.2`, and `tar-stream@2.2.0` do not need independent manifest upgrades. A dev declaration alone does not prove production exclusion: `tar-stream@2.2.0` is also a **production** transitive dependency through `tar-fs@2.1.5`. It has no finding in this snapshot and remains unchanged.

### Remaining advisories, fix availability, and conditional retention

Official GitHub advisory API responses and npm registry version metadata were fetched directly, rather than relying on the suggested `npm audit fix` command.

| Advisory | Affected installed path / impact | Available fix and constraint |
| --- | --- | --- |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), high | `mocha@10.8.2 > chokidar@3.5.3 > braces@3.0.3`: attacker-controlled deeply nested brace patterns can exhaust the stack. | Advisory affects `<=3.0.3` and lists no patched release; npm's latest braces is `3.0.3`. Chokidar 4+ removes glob support and is outside Mocha 10's `^3.5.3` range. |
| [GHSA-5c6j-r48x-rmvq](https://github.com/advisories/GHSA-5c6j-r48x-rmvq), high | `mocha > serialize-javascript@6.0.2`: crafted RegExp flags/Date serialization can lead to code injection when serialized text is evaluated. | First patched `7.0.3`; outside Mocha's `^6.0.2` range. |
| [GHSA-qj8w-gfj5-8c6v](https://github.com/advisories/GHSA-qj8w-gfj5-8c6v), moderate | Same serialization path: crafted array-like objects can cause CPU exhaustion. | First patched `7.0.5` (also covers the RCE fix); requires Node >=20 and is outside Mocha's range. |

The registry/audit offers `mocha@12.0.3` as the complete remediation candidate. Its published metadata uses `chokidar ^5.0.0` and `serialize-javascript ^7.1.1`, but also moves js-yaml to 5, diff to 9, glob to 13, and minimatch to 10, with Node `^20.19.0 || >=22.12.0`. Those breaking toolchain changes were **not** applied or claimed compatible here. Forcing serialize-javascript 7 or chokidar 4/5 into Mocha 10 would violate upstream dependency constraints, so neither is overridden merely to clear audit output.

The engineering disposition is to conditionally retain the residual **development-tool** risk for the current trusted, serial, non-watch workflow, pending a separately validated Mocha major upgrade or compatible upstream fixes:

| Stage | Actual input / reachability | Risk decision |
| --- | --- | --- |
| Installation | These affected package nodes have no install lifecycle hook recorded in the lockfile; the audit/install in this investigation disabled scripts. npm's own package extraction is not the application's `tar-stream` API. | No identified install-time trigger for the three residual advisories. This is not a claim that installing arbitrary packages or running arbitrary lifecycle scripts is safe. |
| Test execution | `runTests` invokes Mocha serially without `--watch` or `--parallel`; no repository Mocha config enables either. Mocha's `lib/cli/watch-run.js` calls Chokidar only for watching, and `lib/nodejs/buffered-worker-pool.js` uses serialize-javascript for parallel-worker options. Test paths, CLI options, configuration, and fixtures are repository-controlled, not HTTP inputs. | Residual watch-pattern and parallel-options exploit paths are not exercised by the supported test command. Assertion diff/glob/YAML helpers did have reachable test-time code and were patched rather than dismissed because they are dev dependencies. |
| Code generation | `api:generate` reads checked-in `docs/openapi.yaml`; Redocly's minimatch/brace-expansion chain is now patched. Tests also parse local YAML using js-yaml `4.3.2`. Supertest is used by synthetic HTTP tests/restore checks. | No remaining code-generation advisory in this snapshot. Do not generalize this review to untrusted remote OpenAPI specifications or new plugins. |
| Production | The production dependency builder runs `npm ci --omit=dev`, and the final Docker stage copies that node_modules tree; Mocha/Chokidar/braces/serialize-javascript are dev-only in the lockfile and are not server imports. The frontend bundle is built separately. Production `tar-fs > tar-stream` remains present and audit-clean. | The three residual advisories have no identified production request path or final-image dependency path. This does not make the development installation universally safe. |

Reopen this disposition at the next dependency security review, before enabling Mocha watch/parallel execution, accepting external test/configuration/glob inputs, adding remote code-generation inputs, or changing production dependency installation. Do not expose development tooling to untrusted repositories/inputs or treat these findings as remediated. A Mocha major upgrade needs its own compatibility validation; this review is not a blanket or permanent risk waiver.

### Verification

Verified on Node `24.21.0`, npm `11.19.0` in the isolated candidate copy:

- Root clean `npm ci --ignore-scripts` and `npm ls --all`: pass, no invalid/unsatisfied dependency constraints.
- `npm test`: **476 passing**, exit 0, including all six Docker resource lifecycle/interruption regressions. This is the full build + `runTests` entry point, not a filtered test subset.
- `npm --prefix web test`: **221 passing** (15 files), exit 0. The later baseline includes note-preview tests added after the earlier 207-test frontend snapshot. An initial concurrent run timed out two tests; the unchanged suite passed when rerun alone.
- `npm --prefix web run typecheck` and `npm run build`: pass.
- `npm run api:generate`: pass; `types/generated/api-types.ts` is byte-identical to baseline.
- Final root full audit: **4 high package findings**, exit 1 as expected; production and full frontend audits: **0**, exit 0.
- Production lockfile entry equality, independent candidate Git diff scope, and `git diff --check`: pass.

The strict namespace run intentionally had no Docker socket: both baseline and candidate produced the same 470 passing tests and six Docker-access failures. The Docker lifecycle tests and then the complete `npm test` were rerun successfully in the disposable copy with a fresh HOME/TMPDIR and cleared inherited environment, using only test-created containers and ownership-labelled resources. Restore interruption tests additionally require the independent Git copy; a source archive without Git metadata cannot exercise that entry point. No production notes, databases, OAuth secrets, deployment files, or deployment operations were used. This is toolchain/regression validation, not a deployment or production restore acceptance.

## 2026-10-15 frontend release audit remediation (earlier snapshot)

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

Development-only findings were outside this historical production remediation scope. See the 2026-10-15 root development dependency triage above for the subsequent targeted fixes and conditional retention of residual risks; no `npm audit fix --force` or unrelated major upgrade was used.
