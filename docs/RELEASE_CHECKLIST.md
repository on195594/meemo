# Meemo v2.1 Release Checklist

Use this checklist for v2.1 release candidates and later releases. Stop on any failed check.

## Pre-release

- [ ] The release commit is on protected `master`, arrived through a pull request, and the validation gate is green; see [`BRANCH_PROTECTION.md`](BRANCH_PROTECTION.md).
- [ ] `npm ci`, `npm --prefix web ci`, generated API types, frontend typecheck/Vitest/build, and backend Mocha tests pass.
- [ ] Compose smoke covers health, register/login, Thing CRUD, attachment, public share/stream, export, and import.
- [ ] Docker builds pass for `linux/amd64` and `linux/arm64`.
- [ ] No credentials, data exports, user files, or attachment data are in the commit.
- [ ] Record the current immutable image digest and configuration.
- [ ] Back up MongoDB and the complete Meemo data volume while writes are stopped or from a storage-consistent snapshot.
- [ ] Follow [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md) to restore both backups into an isolated stack and verify readiness, login, representative Things, attachments, public shares, and export.

## Migration and deployment

1. Bind the expected environment, database, users file, and account source explicitly; do not rely on migration defaults.
2. Run the user and v2 data migrations in `dry-run` mode.
3. Resolve every identity collision, unmatched owner, and count mismatch; do not deploy through a failed gate.
4. Stop application writes and take the final MongoDB and Meemo data-volume backups.
5. Restore that matched backup into an isolated stack and complete the restore checks before changing production.
6. Run migration `apply`, then `verify`; compare canonical users and per-owner things/tags/settings counts.
7. Run `scripts/preflight-legacy-retirement.js` and require `SAFE_TO_RETIRE` for the explicitly bound target.
8. Select MongoDB accounts in deployment configuration, deploy the immutable candidate digest, and read back the effective non-secret configuration.
9. Verify readiness, login for every migrated identity class, representative owned data, attachments, public sharing, export, and restart persistence.
10. Keep the legacy account file, legacy collections, matched backup, and previous image digest read-only throughout the observation/rollback window.
11. Remove compatibility data only after the observation window closes with no unresolved discrepancy and a separately authorized retirement operation.

## Release workflow

1. From the release commit on `master`, manually run **RC release** with the reviewed v2.1 RC tag.
2. The workflow reruns the full validation gate before any GitHub Release or image is published.
3. It rejects a tag already present in Git or GHCR, then publishes only the exact immutable RC multi-architecture image tag with SBOM and provenance.
4. After the image succeeds, it creates the GitHub prerelease. RC publication never moves `latest`, `2`, or `2.0`.
5. Stable aliases are outside this RC-only workflow and require a separately reviewed stable-release path.

## Rollback

1. Stop writes and retain diagnostic logs.
2. Redeploy the recorded previous immutable image digest.
3. If migration writes must be reverted, restore MongoDB and the Meemo data volume as one matched backup set. Do not mix backup timestamps.
4. Restore the previous configuration and user-source selection; keep credential values out of logs and release evidence.
5. Start the stack and verify readiness, login, representative Things, attachments, public shares, and export.
6. Keep the failed deployment and migration evidence isolated for diagnosis; do not retry against production data until the cause is known.

## Release decision

Release only when every item above passes and the restored backup has been exercised. Record the release tag, commit SHA, image digest, backup identifiers, redacted migration/preflight verification output, observation-window result, branch-protection read-back, operator, and UTC completion time in the release notes.
