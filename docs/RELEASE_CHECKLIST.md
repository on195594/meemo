# Meemo v2.1 Release Checklist

Use this checklist for v2.1 release candidates and later releases. Stop on any failed check. Completing this document records required operations; it does not claim they have already run.

## Pre-release

- [ ] The release commit is on protected `master`, arrived through a pull request, and the validation gate is green; see [`BRANCH_PROTECTION.md`](BRANCH_PROTECTION.md).
- [ ] `npm ci`, `npm --prefix web ci`, generated API types, frontend typecheck/Vitest/build, and backend Mocha tests pass.
- [ ] Compose smoke covers health, register/login, Thing CRUD, attachment, public share/stream, export, and import.
- [ ] Docker builds pass for `linux/amd64` and `linux/arm64`.
- [ ] No credentials, data exports, user files, or attachment data are in the commit.
- [ ] Record the candidate immutable image digest, previous running image ID/digest, and configuration identifiers.
- [ ] Back up MongoDB and the complete Meemo data volume while writes are stopped or from a storage-consistent snapshot.
- [ ] Follow [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md) to retain the exact previous image artifact and restore the matched data backup with that image into an isolated stack.
- [ ] In the isolated stack, verify readiness, login, representative Things, attachments, public shares, export, restart persistence, and the running image ID.

## Migration and deployment

1. Bind the expected environment, database, users file, and account source explicitly; do not rely on migration defaults.
2. While normal service remains available, run the user migration in `dry-run` mode and retain its reviewed manifest. Run the v2 data migration in `dry-run` mode with that exact `--users-file PATH --users-manifest PATH` pair so mapped owners bind to the planned canonical IDs before users are applied. If legacy collection prefixes do not identify their authoritative accounts, pass the same private `--owner-map PATH` JSON file (`prefix` to username) to data `dry-run`, `apply`, `verify`, and retirement preflight.
3. Resolve every identity collision, unmatched owner, and count mismatch; do not deploy through a failed gate. Many-to-one mappings merge only distinct Thing/tag identities and canonically identical settings; duplicate identities or conflicting settings fail closed.
4. Establish the release write freeze **before either final user-migration or v2 data-migration apply**: block external write traffic, stop the Meemo application and every worker/scheduler that can write MongoDB or `/app/data`, verify no writer remains, and record the UTC freeze start.
5. Keep that freeze in force for every following migration, verification, deployment, and cutover step. Do not admit user writes or run a catch-up migration during this release path.
6. Take the final matched MongoDB, Meemo data-volume, and exact previous-image backup under the freeze.
7. Restore that matched backup and exact image into an isolated stack and complete the restore checks before changing production.
8. With only the explicitly controlled migration process able to write, run final user-migration `apply` and `verify`, then v2 data-migration `apply` and `verify`; compare canonical users and per-owner things/tags/settings counts.
9. Run `scripts/preflight-legacy-retirement.js` and require `SAFE_TO_RETIRE` for the explicitly bound target.
10. Select MongoDB accounts in deployment configuration, deploy the immutable candidate digest while external writes remain blocked, and read back the effective non-secret configuration and running image digest.
11. Under the same freeze, verify readiness, login for every migrated identity class, representative owned data, attachments, public sharing, export, restart persistence, and final migration counts.
12. Cut over by enabling external traffic and writes only after every final assertion passes; record the UTC freeze end. If any assertion fails, keep writes frozen and execute rollback.
13. Keep the legacy account file, legacy collections, matched backup, exact previous image artifact, and previous configuration read-only throughout the observation/rollback window.
14. Remove compatibility data only after the observation window closes with no unresolved discrepancy and a separately authorized retirement operation.

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

Release only when every item above passes and the restored backup has been exercised. Record the release tag, commit SHA, image digest, retained image-artifact SHA-256, backup identifiers, redacted migration/preflight verification output, freeze start/end, observation-window result, branch-protection read-back, operator, and UTC completion time in the release notes.
