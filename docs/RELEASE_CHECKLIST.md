# Meemo v2.1 Release Checklist

Use this checklist for v2.1 release candidates and later releases. Stop on any failed check. Completing this document records required operations; it does not claim they have already run.

## Authorization boundary

Pull-request approval, protected-branch status, CI success, and release/image publication approve an artifact; they do **not** authorize production mutation. Record separate, time-bounded production authorization for the migration, session revocation, deployment, cutover, and any later legacy retirement. Stop if authorization does not identify the exact post-merge commit, immutable image digest, target environment, and rollback set.

## Pre-release

- [ ] The release commit is on protected `master`, arrived through a pull request, and the validation gate is green; see [`BRANCH_PROTECTION.md`](BRANCH_PROTECTION.md).
- [ ] Fetch the protected branch after merge, record `git rev-parse master`, and prove the candidate was built and tested from that exact head; superseded PR-head evidence is not release evidence.
- [ ] `npm ci`, `npm --prefix web ci`, generated API types, frontend typecheck/Vitest/build, and backend Mocha tests pass.
- [ ] Treat delegated evidence as `INCOMPLETE`, never as release-ready proof, when it reports `max_iterations` or truncation, is schema-invalid, or omits the command exit status, exact commit SHA, named artifact, or artifact hash. Reject summaries that cannot be bound to those originals.
- [ ] Compose smoke covers health, register/login, Thing CRUD, attachment, public share/stream, export, and import.
- [ ] Docker builds pass for `linux/amd64` and `linux/arm64`.
- [ ] No credentials, data exports, user files, or attachment data are in the commit.
- [ ] Record the candidate immutable image digest, previous running image ID/digest, and configuration identifiers.
- [ ] Back up MongoDB and the complete Meemo data volume while writes are stopped or from a storage-consistent snapshot.
- [ ] Follow [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md) to retain the exact previous image artifact and restore the matched data backup with that image into an isolated stack.
- [ ] Checksum and make the matched MongoDB archive, `/app/data` archive, exact previous image, Compose file, and metadata read-only as one immutable rollback set; readiness output is stored elsewhere.
- [ ] In the isolated stack, verify readiness, login, representative Things, attachments, public shares, export, restart persistence, and the running image ID.
- [ ] Inventory every legacy namespace and candidate backup; reject test, fixture, sample, and demo indicators.
- [ ] Independently review the exact expected database name, namespace names, counts, canonical-EJSON fingerprints, and owner-map digest. Store them in a read-only expected-source artifact that the migration did not generate; bind `--dry-run`, `--apply`, and `--verify` to that database name and both write/readback modes to that same artifact.

## Migration and deployment

1. Bind the expected environment, database, users file, and account source explicitly; do not rely on migration defaults.
2. Confirm the selected migration source matches the historical user-visible corpus. While normal service remains available, run the user migration in `dry-run` mode and retain its reviewed manifest. Run every v2 data-migration mode with the same explicit `--expect-database NAME`; the expected-source artifact must contain that exact database name. Run its `dry-run` with the exact `--users-file PATH --users-manifest PATH` pair so mapped owners bind to the planned canonical IDs before users are applied. If legacy collection prefixes do not identify their authoritative accounts, pass the same private `--owner-map PATH` JSON file (`prefix` to username) to data `dry-run`, `apply`, `verify`, and retirement preflight.
3. Resolve every identity collision, unmatched owner, count mismatch, implausibly small source, and attachment-reference gap; do not deploy through a failed gate. Many-to-one mappings collapse duplicate Thing identities only when canonical content is identical, require tag identities to remain unique, and merge only canonically identical settings; divergent Things, duplicate tags, or conflicting settings fail closed.
4. Establish the release write freeze **before either final user-migration or v2 data-migration apply**: block external write traffic, stop the Meemo application and every worker/scheduler that can write MongoDB or `/app/data`, verify no writer remains, and record the UTC freeze start.
5. Keep that freeze in force for every following migration, verification, deployment, and cutover step. Do not admit user writes or run a catch-up migration during this release path.
6. Take the final matched MongoDB, Meemo data-volume, and exact previous-image backup under the freeze.
7. Restore that matched backup and exact image into an isolated stack and complete the restore checks before changing production.
8. With only the explicitly controlled migration process able to write, run final user-migration `apply` and `verify`, then v2 data-migration `apply` and `verify` with the same independently reviewed expected-source artifact; compare canonical users and per-owner things/tags/settings counts. Run `scripts/migrate-thing-revisions.js` in `--dry-run`, `--apply`, and `--verify` modes with the exact `--expect-database NAME`; it may only fill missing revisions and must stop on invalid values. Run tag reconstruction during this freeze; require its durable MongoDB gate to report a verified write freeze before staging or swapping tags, and keep the gate frozen through readiness.
9. Run `scripts/preflight-legacy-retirement.js` and require `SAFE_TO_RETIRE` for the explicitly bound target. Its CLI output is redacted; keep any identity-level diagnostics only in a mode-0600 local evidence file outside the repository.
10. Select MongoDB accounts in deployment configuration, deploy the immutable candidate digest while external writes remain blocked, and read back the effective non-secret configuration and running image digest.
11. Revoke every pre-migration server session while the write freeze and production authorization remain active. Confirm the session collection is empty before authenticated verification.
12. Run `scripts/verify-production-readiness.js` with the expected-source artifact and a mode-0600 file containing all database/readback credentials; pass no secrets as arguments. Require source-evidence binding, owner/schema/count invariants, session revocation, exact tags, attachment resolution, and authenticated protected readback. `/api/health/ready` alone is only process/dependency health.
13. Under the same freeze, complete representative historical Thing, attachment, public-sharing, export, restart-persistence, and final migration-count checks without placing content or credentials in command output.
14. Cut over by enabling external traffic and writes only after every final assertion passes; record the UTC freeze end. If any assertion fails, keep writes frozen and execute rollback.
15. Keep the legacy account file, legacy collections, immutable rollback set, exact previous image artifact, and previous configuration read-only throughout the observation/rollback window.
16. Remove compatibility data only after the observation window closes with no unresolved discrepancy and a separately authorized retirement operation.

## Release workflow

1. From the release commit on `master`, manually run **RC release** with the reviewed v2.1 RC tag.
2. The workflow reruns the full validation gate before any GitHub Release or image is published.
3. It rejects a tag already present in Git or GHCR, then publishes only the exact immutable RC multi-architecture image tag with SBOM and provenance.
4. After the image succeeds, it creates the GitHub prerelease. RC publication never moves `latest`, `2`, or `2.0`.
5. Stable aliases are outside this RC-only workflow and require a separately reviewed stable-release path.

## Rollback

1. Keep the write freeze in force and retain diagnostic logs.
2. Follow the production rollback procedure in [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md): checksum, load, tag, and verify the retained exact previous image before changing production data.
3. Restore MongoDB and the Meemo data volume as one matched backup set. Do not mix backup timestamps.
4. Restore the previous configuration and user-source selection; keep credential values out of logs and release evidence.
5. Start the stack with builds disabled, assert that the running image ID equals the retained image ID, and verify readiness, login, representative Things, attachments, public shares, export, and restart persistence.
6. Reopen writes only after rollback verification passes. Otherwise keep the freeze in force and escalate.
7. Keep the failed deployment and migration evidence isolated for diagnosis; do not retry against production data until the cause is known.

## Release decision

Release only when every item above passes and the restored backup has been exercised. Immediately before mutation, re-read protected `master`, record its exact head, and reject evidence produced for any other commit or image. Record the release tag, exact post-merge commit SHA, image digest, retained image-artifact SHA-256, immutable rollback-set digest, backup identifiers, redacted migration/preflight/business-verifier output, freeze start/end, production authorization reference, observation-window result, branch-protection read-back, operator, and UTC completion time in the release notes.
