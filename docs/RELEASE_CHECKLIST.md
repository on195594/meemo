# Meemo v2 RC Release Checklist

Use this checklist for `v2.0.0-rc1` and later v2 release candidates. Stop on any failed check.

## Pre-release

- [ ] The release commit is on `master` and the RC validation gate is green.
- [ ] `npm ci`, generated API types, frontend typecheck/build, and `npm test` pass.
- [ ] Compose smoke covers health, register/login, Thing CRUD, attachment, public share/stream, export, and import.
- [ ] Docker builds pass for `linux/amd64` and `linux/arm64`.
- [ ] No credentials, data exports, user files, or attachment data are in the commit.
- [ ] Record the current immutable image digest and configuration.
- [ ] Back up MongoDB and the complete Meemo data volume while writes are stopped or from a storage-consistent snapshot.
- [ ] Follow [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md) to restore both backups into an isolated stack and verify readiness, login, representative Things, attachments, public shares, and export.

## Migration and deployment

1. Run the user and v2 data migrations in `dry-run` mode.
2. Resolve every reported conflict or count mismatch; do not deploy through a failed gate.
3. Stop application writes and take the final MongoDB and Meemo data-volume backups.
4. Run migration `apply`, then `verify`.
5. Deploy the immutable RC tag/digest produced by the release workflow.
6. Verify readiness and repeat the Compose smoke paths against the deployment.
7. Keep legacy migration sources and the previous image digest read-only for the rollback window.

## Release workflow

1. From the release commit on `master`, manually run **RC release** with tag `v2.0.0-rc1`.
2. The workflow reruns the full validation gate before any GitHub Release or image is published.
3. It rejects a tag already present in Git or GHCR, then publishes only the exact immutable `2.0.0-rc1` multi-architecture image tag with SBOM and provenance.
4. After the image succeeds, it creates the GitHub prerelease. RC publication never moves `latest`, `2`, or `2.0`.
5. Stable aliases are outside this RC-only workflow and require a separately reviewed stable-release path.

## Rollback

1. Stop writes and retain diagnostic logs.
2. Redeploy the recorded previous immutable image digest.
3. If migration writes must be reverted, restore MongoDB and the Meemo data volume as one matched backup set. Do not mix backup timestamps.
4. Restore the previous configuration and user-source selection.
5. Start the stack and verify readiness, login, representative Things, attachments, public shares, and export.
6. Keep the failed deployment and migration evidence isolated for diagnosis; do not retry against production data until the cause is known.

## Release decision

Release only when every item above passes and the restored backup has been exercised. Record the release tag, commit SHA, image digest, backup identifiers, migration verification output, operator, and UTC completion time in the release notes.
