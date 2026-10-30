# Backup and Restore

Use this runbook for explicitly requested backups, data recovery, migrations, or MongoDB upgrades. Routine application deployment and image rollback use [deploy.sh](../deploy.sh) and do not require a fresh backup or restore rehearsal.

Production MongoDB is independently deployed and shared with travel-cards. Scope every dump/restore to Meemo's database from the effective `MONGODB_URL`; do not assume its name is `meemo`. Never stop/recreate the shared MongoDB container, restore its entire data directory, or change travel-cards data as part of a Meemo operation. The repository's bundled MongoDB is for standalone use and isolated tests.

Data restoration, migration, and credential/session invalidation need authorization for those operations. An application deployment request alone does not authorize them. A recovery set contains the matching Meemo database archive, attachments and previous image; keep it outside the source and production directories.

## Directory boundary

On the current production host, use `/home/lin/meemo-repo` only as the Git repository and `/home/lin/meemo` only as the production operations directory. Run source checks and image builds from the repository; run production Compose commands from the operations directory. Store backups and readiness evidence outside both. The operations directory must not contain a Git checkout or copied build context.

## Optional MCP authorization state

When MCP is enabled, dumps also contain sensitive `mcp_clients`, `mcp_requests`, `mcp_codes`, `mcp_grants`, and `mcp_tokens`. Note exports do not include these credentials/authorization records. TTL expiry does not make backup contents non-sensitive.

After a database restore, keep `MCP_ENABLED=false` until a separately authorized, target-verified recovery step excludes or invalidates all five restored MCP collections. This prevents an older backup from resurrecting a revoked grant. Do not perform production deletion under this runbook without explicit authorization. Clients must reconnect/re-register afterward; ordinary note reads and browser login do not depend on OAuth state. See [MCP recovery and rollback](GEMINI_ASSISTANT.md#persistence-recovery-and-rollback).

The current synthetic restore fixture does not seed or validate MCP grants; its PASS is not evidence of MCP-state recovery. Add that fixture before claiming OAuth recovery acceptance.

## Compatibility

- Record the application image ID and repository digest, commit SHA, Compose file, non-secret configuration names, MongoDB image version, and UTC timestamp.
- Retain `docker image save` output for the running Meemo image. A registry digest alone is not a rollback artifact: the tag or manifest may become unavailable.
- Restore with the same MongoDB major version used to create the dump (`mongo:8` for the current Compose file). Upgrade MongoDB only after the restored application is verified.
- Load and run the retained Meemo image before restoring `/app/data`. Upgrade the application only after the backup has passed isolated verification.
- Do not restore a newer MongoDB dump into an older MongoDB server or mix MongoDB, `/app/data`, and image artifacts from different backup sets.

## Create a consistent backup

For an authorized backup, identify `MONGO_CONTAINER`, `MEEMO_DATABASE`, the Meemo container and attachment mount from the active deployment. Use a private directory outside the repository and operations directory. Keep credentials out of commands and output; authenticated MongoDB deployments need their approved database-tool credential configuration.

1. Record the database name, running Meemo image ID, MongoDB version and configuration reference. Retain the exact image with `docker image save` for disaster recovery; routine image rollback only needs the local previous image.
2. Stop only Meemo and any separately identified writers to its database/attachments while creating the matched backup. Keep the shared MongoDB server running.
3. Dump only the selected database:

   ```bash
   : "${MONGO_CONTAINER:?identify the existing shared MongoDB container}"
   : "${MEEMO_DATABASE:?read the database name from the active Meemo configuration}"
   : "${BACKUP_DIR:?select a private backup directory}"
   docker exec "$MONGO_CONTAINER" mongodump --db "$MEEMO_DATABASE" --archive \
     >"$BACKUP_DIR/mongodb.archive"
   printf '%s\n' "$MEEMO_DATABASE" >"$BACKUP_DIR/database-name.txt"
   ```

4. Archive Meemo's attachment mount with ownership and permissions preserved. Do not copy the MongoDB data directory or unrelated application mounts.
5. Checksum the database, attachments, retained image and metadata together. Keep the set read-only; store subsequent reports/configuration in a separate private work directory.
6. For backup-only work, restart Meemo once the backup is complete. For a migration or recovery, keep its writers stopped until that operation's checks pass.

## Restore into a clean isolated stack

A restore exercise is separate work. Create fresh MongoDB/application containers and attachment storage with no production mounts or shared MongoDB connection. Load the retained image and restore the selected Meemo database and attachments into these disposable resources. Disable MCP, workers and URL enrichment, and use a separate test session secret.

Compare document/index fingerprints and attachment hashes with the backup, then verify login, representative notes/attachments, sharing, export and restart persistence. Keep credentials and note contents out of reports. Remove only the resources created for the exercise. A synthetic fixture pass is not proof that a real backup restores correctly.

## Production restore or rollback

For a failed application update without data changes, use image rollback only; do not restore data.

For an explicitly authorized **data restore**:

1. Verify the matched backup checksums, retained image and exact database identity. Preserve the current Meemo data before overwriting it. Stop only Meemo and its other identified writers.
2. Restore only the database recorded in the backup, restricted by namespace:

   ```bash
   : "${MONGO_CONTAINER:?identify the existing shared MongoDB container}"
   : "${MEEMO_DATABASE:?identify the authorized Meemo database}"
   : "${BACKUP_DIR:?select the verified backup set}"
   test "$(cat "$BACKUP_DIR/database-name.txt")" = "$MEEMO_DATABASE" &&
   docker exec -i "$MONGO_CONTAINER" mongorestore --archive \
     --nsInclude "$MEEMO_DATABASE.*" --drop <"$BACKUP_DIR/mongodb.archive"
   ```

3. Restore the matching attachments into Meemo's mount only. Keep the shared MongoDB instance and travel-cards untouched.
4. Revoke restored browser sessions and handle [MCP authorization state](#optional-mcp-authorization-state) within the selected Meemo database before opening access.
5. Start only Meemo with the retained image and previous configuration. Verify readiness, representative authenticated reads, attachments and the affected recovery behavior before accepting the restore. If checks fail, retain the evidence and diagnose before another attempt.

## Historical migration retirement

The application and production database operate entirely on unified collections (`things`, `users`, `settings`, `sessions`). The legacy file-based authentication and per-user dynamic collections have been fully cut over and retired. Historical one-off migration and preflight tooling (`migrate-data-to-v2.js`, `migrate-users-to-mongo.js`, `verify-production-readiness.js`, `preflight-legacy-retirement.js`, `owner-map.js`) has been pruned from `scripts/` as part of codebase simplification.

Production recovery strictly follows the standard MongoDB dump/restore and attachment volume extraction runbook above. Standalone MongoDB stores `things` as the authoritative single source of truth for tag identity and usage; `/api/tags` aggregates `things.tags` dynamically without requiring cross-collection coordination. Tag repair and projection refresh are managed online via `thingService.cleanupTags`.
