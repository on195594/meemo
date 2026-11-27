# Backup and Restore

Use this runbook for explicitly requested backups, data recovery, migrations, or MongoDB upgrades. Routine deployment and rollback use [deploy.sh](../deploy.sh) without running a backup or restore rehearsal.

Production MongoDB is independently deployed and shared with travel-cards. Scope every dump and restore to Meemo's exact database from `MONGODB_URL`—never stop/recreate the shared MongoDB container, restore its entire data directory, or touch travel-cards data. Data restoration, migration, and session/credential invalidation require explicit authorization separate from deployment.

## Directory boundary

On the production host, `/home/lin/meemo-repo` is the Git/build directory and `/home/lin/meemo` is the Compose operations directory. Keep backups and recovery sets (database archive, attachments archive, `docker image save` tarball, metadata) in a private directory outside both.

## Optional MCP authorization state

When MCP is enabled, MongoDB dumps include sensitive `mcp_clients`, `mcp_requests`, `mcp_codes`, `mcp_grants`, and `mcp_tokens` collections (note `.tar` exports omit them). After any database restore, keep `MCP_ENABLED=false` until an authorized step excludes or clears all five `mcp_*` collections in the restored target so revoked grants are not resurrected; clients re-register afterward. See [MCP recovery and rollback](GEMINI_ASSISTANT.md#persistence-recovery-and-rollback). Restore exercises must explicitly validate this step before claiming OAuth recovery readiness.

## Compatibility

- Record the running application image ID/digest, commit SHA, MongoDB major version, non-secret config keys, and UTC timestamp.
- Retain a `docker image save` archive of the running Meemo image for disaster recovery.
- Match MongoDB major versions (`mongo:8` for current Compose) before restoring, and load/start the matching retained Meemo image before restoring `/app/data`.

## Create a consistent backup

1. Identify `MONGO_CONTAINER`, `MEEMO_DATABASE`, the Meemo container, and its attachment mount, plus a private `BACKUP_DIR`.
2. Stop only Meemo (and any other writer to `MEEMO_DATABASE`) while keeping the shared MongoDB server running.
3. Dump only Meemo's database:

   ```bash
   : "${MONGO_CONTAINER:?identify the shared MongoDB container}"
   : "${MEEMO_DATABASE:?read the database name from active Meemo config}"
   : "${BACKUP_DIR:?select a private backup directory}"
   docker exec "$MONGO_CONTAINER" mongodump --db "$MEEMO_DATABASE" --archive \
     >"$BACKUP_DIR/mongodb.archive"
   printf '%s\n' "$MEEMO_DATABASE" >"$BACKUP_DIR/database-name.txt"
   ```

4. Archive Meemo's attachment mount preserving ownership/permissions, checksum the backup set together, and keep it read-only.
5. Restart Meemo (or keep writers stopped if proceeding directly into an authorized restore/migration).

## Isolated restore verification

To verify a backup, spin up fresh disposable MongoDB + Meemo containers with no production mounts, `MCP_ENABLED=false`, `URL_ENRICHMENT_ENABLED=false`, and a fresh test `SESSION_SECRET`. Restore the dump and attachments, verify document/index counts, login, notes/attachments, sharing, export, and restart persistence, then remove only the disposable resources.

## Production restore or rollback

For a failed app update without data corruption, perform image rollback only. For an explicitly authorized **data restore**:

1. Verify backup checksums, retained image, and `MEEMO_DATABASE` identity; preserve current Meemo state first and stop only Meemo/writers.
2. Restore only `MEEMO_DATABASE`:

   ```bash
   : "${MONGO_CONTAINER:?identify the shared MongoDB container}"
   : "${MEEMO_DATABASE:?identify the authorized Meemo database}"
   : "${BACKUP_DIR:?select the verified backup set}"
   test "$(cat "$BACKUP_DIR/database-name.txt")" = "$MEEMO_DATABASE" &&
   docker exec -i "$MONGO_CONTAINER" mongorestore --archive \
     --nsInclude "$MEEMO_DATABASE.*" --drop <"$BACKUP_DIR/mongodb.archive"
   ```

3. Restore matching attachments into Meemo's mount only.
4. Invalidate restored browser sessions and handle [MCP authorization state](#optional-mcp-authorization-state) before opening traffic.
5. Start only Meemo with the retained image and verify readiness, authenticated reads, and attachments.
