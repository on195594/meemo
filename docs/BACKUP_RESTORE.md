# Backup and Restore

Use this runbook for Meemo v2 upgrades and rollback. MongoDB and `/app/data` form one backup set: create and restore them together. Commands assume the repository's Docker Compose stack and no shell history containing credentials.

## Compatibility

- Record the application image digest, commit SHA, Compose file, environment configuration names, MongoDB image version, and UTC timestamp.
- Restore with the same MongoDB major version used to create the dump (`mongo:8` for the current Compose file). Upgrade MongoDB only after the restored application is verified.
- Restore `/app/data` with the same Meemo image version that created it. Upgrade the application only after the backup has passed isolated verification.
- Do not restore a newer MongoDB dump into an older MongoDB server or mix MongoDB and `/app/data` backups from different timestamps.

## Create a consistent backup

Choose a private directory outside the repository:

```bash
set -euo pipefail
BACKUP_DIR=/secure/path/meemo-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 700 "$BACKUP_DIR"
container=$(docker compose ps -q meemo)
test -n "$container"
docker inspect --format '{{.Image}}' "$container" > "$BACKUP_DIR/image-id.txt"
image_ref=$(docker inspect --format '{{.Config.Image}}' "$container")
docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' "$image_ref" > "$BACKUP_DIR/image-digest.txt"
sha256sum docker-compose.yml > "$BACKUP_DIR/compose.sha256"
docker compose stop meemo
docker compose exec -T mongodb mongodump --db meemo --archive > "$BACKUP_DIR/mongodb.archive"
docker compose run --rm --no-deps \
  -v "$BACKUP_DIR:/backup" --entrypoint sh meemo \
  -c 'tar -C /app/data -czf /backup/meemo-data.tgz .'
sha256sum "$BACKUP_DIR/mongodb.archive" "$BACKUP_DIR/meemo-data.tgz" \
  > "$BACKUP_DIR/SHA256SUMS"
chmod 600 "$BACKUP_DIR"/*
docker compose start meemo
```

`image-id.txt` always records the running container's immutable local image ID. `image-digest.txt` records the repository digest when one exists and is empty for a local Compose build. Record configuration names separately, but never copy secret values into backup metadata.

## Restore into a clean isolated stack

Never test a restore against production volumes. Set an isolated Compose project name and a non-production port, then recreate empty volumes:

```bash
set -euo pipefail
BACKUP_DIR=/secure/path/meemo-YYYYMMDDTHHMMSSZ
export COMPOSE_PROJECT_NAME=meemo-restore-check
export MEEMO_PORT=3300
export SESSION_SECRET=temporary-restore-check-only
sha256sum -c "$BACKUP_DIR/SHA256SUMS"
docker compose down -v --remove-orphans
docker compose up -d mongodb
until docker compose exec -T mongodb mongosh --quiet \
  --eval 'quit(db.adminCommand("ping").ok ? 0 : 2)'; do sleep 1; done
docker compose exec -T mongodb mongorestore --archive --drop \
  < "$BACKUP_DIR/mongodb.archive"
docker compose run --rm --no-deps \
  -v "$BACKUP_DIR:/backup:ro" --entrypoint sh meemo \
  -c 'find /app/data -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar -C /app/data -xzf /backup/meemo-data.tgz'
docker compose up -d
until curl --fail --silent http://127.0.0.1:3300/api/health/ready >/dev/null; do sleep 1; done
```

Verify with a non-production test account:

1. Login and inspect representative Things, tags, and settings.
2. Download and compare representative attachments.
3. Verify public shares and Public Stream.
4. Export the account and confirm expected record and attachment counts.
5. Restart the stack and repeat readiness plus one representative read.
6. Record hashes, counts, image digest, MongoDB version, operator, and UTC completion time.

Remove the isolated stack after recording evidence:

```bash
docker compose down -v --remove-orphans
```

## Production restore or rollback

1. Stop application writes: `docker compose stop meemo`.
2. Preserve logs and the failed deployment evidence.
3. Verify backup hashes before changing data.
4. Restore the matched MongoDB archive and `/app/data` archive using the clean-stack procedure.
5. Pin the previously recorded immutable image digest and restore its compatible configuration.
6. Start MongoDB, then Meemo; verify readiness, login, representative data, attachments, public shares, and export.
7. Do not retry a failed migration against production data until its cause is understood.

A restore is not accepted until the isolated exercise succeeds. A backup that has not been restored is unverified.
