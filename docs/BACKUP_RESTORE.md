# Backup and Restore

Use this runbook for Meemo v2 upgrades and rollback. MongoDB, `/app/data`, and the exact Meemo image artifact form one backup set: create, retain, checksum, and restore them together. Commands assume the repository's Docker Compose stack and no shell history containing credentials. They are operator instructions, not evidence that a backup or restore has run.

## Compatibility

- Record the application image ID and repository digest, commit SHA, Compose file, non-secret configuration names, MongoDB image version, and UTC timestamp.
- Retain `docker image save` output for the running Meemo image. A registry digest alone is not a rollback artifact: the tag or manifest may become unavailable.
- Restore with the same MongoDB major version used to create the dump (`mongo:8` for the current Compose file). Upgrade MongoDB only after the restored application is verified.
- Load and run the retained Meemo image before restoring `/app/data`. Upgrade the application only after the backup has passed isolated verification.
- Do not restore a newer MongoDB dump into an older MongoDB server or mix MongoDB, `/app/data`, and image artifacts from different backup sets.

## Create a consistent backup

Choose a private directory outside the repository. Stop all application writers before dumping either datastore; during a release freeze, do not restart them after this block.

```bash
set -euo pipefail
BACKUP_DIR=/secure/path/meemo-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 700 "$BACKUP_DIR"
container=$(docker compose ps -q meemo)
test -n "$container"
image_id=$(docker inspect --format '{{.Image}}' "$container")
case "$image_id" in sha256:*) ;; *) printf 'unexpected image ID: %s\n' "$image_id" >&2; exit 1 ;; esac
printf '%s\n' "$image_id" >"$BACKUP_DIR/image-id.txt"
docker inspect --format '{{.Config.Image}}' "$container" >"$BACKUP_DIR/image-reference.txt"
docker image inspect "$image_id" >"$BACKUP_DIR/image-inspect.json"
docker image inspect --format '{{json .RepoDigests}}' "$image_id" \
  >"$BACKUP_DIR/image-repo-digests.json"
docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' "$image_id" \
  >"$BACKUP_DIR/image-repository-digest.txt"
docker image save --output "$BACKUP_DIR/meemo-image.tar" "$image_id"
install -m 600 docker-compose.yml "$BACKUP_DIR/docker-compose.yml"

docker compose stop meemo
docker compose exec -T mongodb mongodump --db meemo --archive \
  >"$BACKUP_DIR/mongodb.archive"
docker run --rm --volumes-from "$container" --entrypoint sh "$image_id" \
  -c 'tar -C /app/data -czf - .' >"$BACKUP_DIR/meemo-data.tgz"

(
  cd "$BACKUP_DIR"
  sha256sum mongodb.archive meemo-data.tgz meemo-image.tar image-id.txt \
    image-inspect.json image-repo-digests.json image-repository-digest.txt \
    docker-compose.yml >SHA256SUMS
)
chmod 600 "$BACKUP_DIR"/*
```

`image-id.txt` records the running container's immutable local image ID. `meemo-image.tar` retains that exact image independently of registry availability, and `SHA256SUMS` binds it to the MongoDB and `/app/data` archives. Record configuration names separately, but never copy secret values into backup metadata.

For a standalone backup outside a release freeze, restart Meemo only after `sha256sum -c "$BACKUP_DIR/SHA256SUMS"` passes. During release, keep the write freeze in force through final migration, deployment verification, and cutover.

When legacy collection prefixes need explicit account ownership, keep a private JSON object mapping each prefix to an authoritative username and pass its path as `--owner-map PATH` to `migrate-data-to-v2.js` dry-run/apply/verify and `preflight-legacy-retirement.js`. The migration binds the raw-file SHA-256 in `schema-v2` state, so a missing or changed map fails replay and preflight. Multiple prefixes may map to one account only when Thing/tag identities remain unique and canonical settings values are identical; otherwise migration fails before legacy data is removed.

## Restore into a clean isolated stack

Never test a restore against production volumes. The commands load the retained image, verify its immutable ID, give it an isolated tag, and generate a Compose override that removes `build`. Every Compose invocation uses that override and `--no-build`.

```bash
set -euo pipefail
BACKUP_DIR=/secure/path/meemo-YYYYMMDDTHHMMSSZ
export COMPOSE_PROJECT_NAME=meemo-restore-check
export MEEMO_PORT=3300
export SESSION_SECRET=temporary-restore-check-only

(
  cd "$BACKUP_DIR"
  sha256sum -c SHA256SUMS
)
expected_image_id=$(<"$BACKUP_DIR/image-id.txt")
case "$expected_image_id" in sha256:*) ;; *) printf 'invalid saved image ID\n' >&2; exit 1 ;; esac
docker image load --input "$BACKUP_DIR/meemo-image.tar"
loaded_image_id=$(docker image inspect --format '{{.Id}}' "$expected_image_id")
test "$loaded_image_id" = "$expected_image_id"
restore_image="meemo:restore-$(basename "$BACKUP_DIR")"
docker image tag "$expected_image_id" "$restore_image"
test "$(docker image inspect --format '{{.Id}}' "$restore_image")" = "$expected_image_id"

image_override="$BACKUP_DIR/restore-image.override.yml"
printf 'services:\n  meemo:\n    build: !reset null\n    image: %s\n' \
  "$restore_image" >"$image_override"
compose=(docker compose -f "$BACKUP_DIR/docker-compose.yml" -f "$image_override")
RESTORE_IMAGE="$restore_image" "${compose[@]}" config --format json \
  >"$BACKUP_DIR/restore-compose.resolved.json"
python3 - "$BACKUP_DIR/restore-compose.resolved.json" "$restore_image" <<'PY'
import json
import sys
from pathlib import Path

service = json.loads(Path(sys.argv[1]).read_text())["services"]["meemo"]
assert service["image"] == sys.argv[2], service
assert "build" not in service, service
print("restore Compose configuration pins the retained image and has no build")
PY

"${compose[@]}" down -v --remove-orphans
"${compose[@]}" up -d --no-build mongodb
mongo_ready=false
for _ in $(seq 1 120); do
  if "${compose[@]}" exec -T mongodb mongosh --quiet \
    --eval 'quit(db.adminCommand("ping").ok ? 0 : 2)'; then
    mongo_ready=true
    break
  fi
  sleep 1
done
test "$mongo_ready" = true
"${compose[@]}" exec -T mongodb mongorestore --archive --drop \
  <"$BACKUP_DIR/mongodb.archive"
"${compose[@]}" run --rm --no-deps --no-build \
  -v "$BACKUP_DIR:/backup:ro" --entrypoint sh meemo \
  -c 'find /app/data -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar -C /app/data -xzf /backup/meemo-data.tgz'
"${compose[@]}" up -d --no-build

restore_container=$("${compose[@]}" ps -q meemo)
test -n "$restore_container"
test "$(docker inspect --format '{{.Image}}' "$restore_container")" = "$expected_image_id"
app_ready=false
for _ in $(seq 1 120); do
  if curl --fail --silent http://127.0.0.1:3300/api/health/ready >/dev/null; then
    app_ready=true
    break
  fi
  sleep 1
done
test "$app_ready" = true
```

Verify with a non-production test account:

1. Login and inspect representative Things, tags, and settings.
2. Download and compare representative attachments.
3. Verify public shares and Public Stream.
4. Export the account and confirm expected record and attachment counts.
5. Restart with `"${compose[@]}" restart`, repeat readiness and one representative read, and reassert the running container image ID.
6. Record archive hashes, counts, expected/running image IDs, MongoDB version, operator, and UTC completion time.

Remove the isolated stack only after recording evidence:

```bash
set -euo pipefail
BACKUP_DIR=/secure/path/meemo-YYYYMMDDTHHMMSSZ
export COMPOSE_PROJECT_NAME=meemo-restore-check
image_override="$BACKUP_DIR/restore-image.override.yml"
compose=(docker compose -f "$BACKUP_DIR/docker-compose.yml" -f "$image_override")
"${compose[@]}" down -v --remove-orphans
```

## Production restore or rollback

Obtain explicit production authorization, keep the write freeze active, bind the real Compose project name and previous non-secret configuration, and make the prior `SESSION_SECRET` available without placing it in shell history. This block verifies and loads the exact image before altering production data.

```bash
set -euo pipefail
BACKUP_DIR=/secure/path/meemo-YYYYMMDDTHHMMSSZ
: "${COMPOSE_PROJECT_NAME:?set the existing production Compose project name}"
: "${SESSION_SECRET:?load the previous session secret through the approved secret channel}"

(
  cd "$BACKUP_DIR"
  sha256sum -c SHA256SUMS
)
expected_image_id=$(<"$BACKUP_DIR/image-id.txt")
case "$expected_image_id" in sha256:*) ;; *) printf 'invalid saved image ID\n' >&2; exit 1 ;; esac
docker image load --input "$BACKUP_DIR/meemo-image.tar"
test "$(docker image inspect --format '{{.Id}}' "$expected_image_id")" = "$expected_image_id"
rollback_image="meemo:rollback-$(basename "$BACKUP_DIR")"
docker image tag "$expected_image_id" "$rollback_image"
test "$(docker image inspect --format '{{.Id}}' "$rollback_image")" = "$expected_image_id"

image_override="$BACKUP_DIR/rollback-image.override.yml"
printf 'services:\n  meemo:\n    build: !reset null\n    image: %s\n' \
  "$rollback_image" >"$image_override"
compose=(docker compose -f "$BACKUP_DIR/docker-compose.yml" -f "$image_override")
ROLLBACK_IMAGE="$rollback_image" "${compose[@]}" config --format json \
  >"$BACKUP_DIR/rollback-compose.resolved.json"
python3 - "$BACKUP_DIR/rollback-compose.resolved.json" "$rollback_image" <<'PY'
import json
import sys
from pathlib import Path

service = json.loads(Path(sys.argv[1]).read_text())["services"]["meemo"]
assert service["image"] == sys.argv[2], service
assert "build" not in service, service
print("rollback Compose configuration pins the retained image and has no build")
PY

container=$("${compose[@]}" ps -q meemo)
test -n "$container"
"${compose[@]}" stop meemo
"${compose[@]}" exec -T mongodb mongorestore --archive --drop \
  <"$BACKUP_DIR/mongodb.archive"
docker run --rm --volumes-from "$container" --entrypoint sh "$expected_image_id" \
  -c 'find /app/data -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar -C /app/data -xzf -' \
  <"$BACKUP_DIR/meemo-data.tgz"
"${compose[@]}" up -d --no-build mongodb meemo

rollback_container=$("${compose[@]}" ps -q meemo)
test -n "$rollback_container"
test "$(docker inspect --format '{{.Image}}' "$rollback_container")" = "$expected_image_id"
app_ready=false
for _ in $(seq 1 120); do
  if curl --fail --silent "${APP_ORIGIN:?set the production application origin}/api/health/ready" \
    >/dev/null; then
    app_ready=true
    break
  fi
  sleep 1
done
test "$app_ready" = true
```

Before reopening writes, verify login, representative Things/tags/settings, attachments, public shares, export, restart persistence, and the running image ID. Keep writes frozen if any check fails. Preserve logs and failed-deployment evidence, and do not retry a failed migration against production data until its cause is understood.

A restore is not accepted until the isolated exercise succeeds. A backup that has not been restored with its retained image is unverified.
