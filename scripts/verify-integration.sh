#!/usr/bin/env bash

set -Eeuo pipefail

for command in docker curl python3; do
    command -v "$command" >/dev/null || {
        echo "Missing required command: $command" >&2
        exit 1
    }
done
docker info >/dev/null
run_id="$(date -u +%Y%m%d%H%M%S)-$$"
project="meemo-verify-${run_id}"
port="${MEEMO_VERIFY_PORT:-33100}"
work="$(mktemp -d "${TMPDIR:-/tmp}/meemo-verify.XXXXXX")"
compose=(docker compose --project-name "$project")

cleanup() {
    "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$work"
}
trap cleanup EXIT

export SESSION_SECRET='ci-only-session-secret-at-least-32-characters'
export REGISTRATION_MODE=open
export AUTH_USER_SOURCE=mongo
export MEEMO_PORT="$port"

"${compose[@]}" up --build --detach
"${compose[@]}" exec -T meemo sh -c 'test "$AUTH_USER_SOURCE" = mongo'

base="http://127.0.0.1:${MEEMO_PORT}"
for i in {1..60}; do
    if curl --fail --silent "$base/api/health/ready" >/dev/null; then
        break
    fi
    if [ "$i" -eq 60 ]; then
        echo 'Meemo integration stack did not become ready' >&2
        exit 1
    fi
    sleep 2
done

"${compose[@]}" exec -T mongodb mongosh --quiet meemo --eval \
    'quit(db.getName() === "meemo" ? 0 : 2)'

curl --fail --silent --show-error \
    -H 'Content-Type: application/json' \
    -d '{"username":"ci-user","password":"ci-password","email":"ci@example.invalid","displayName":"CI User"}' \
    "$base/api/register" >/dev/null
curl --fail --silent --show-error -c "$work/cookies" \
    -H 'Content-Type: application/json' \
    -d '{"username":"ci-user","password":"ci-password"}' \
    "$base/api/login" >/dev/null

profile=$(curl --fail --silent --show-error -b "$work/cookies" "$base/api/profile")
user_id=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["user"]["id"])' <<<"$profile")

printf 'release smoke attachment\n' > "$work/attachment.txt"
attachment=$(curl --fail --silent --show-error -b "$work/cookies" \
    -F "file=@$work/attachment.txt" "$base/api/files")
attachment_id=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["identifier"])' <<<"$attachment")

create_body=$(python3 -c 'import json,sys; print(json.dumps({"content":"RC smoke note #release","attachments":[json.load(sys.stdin)]}))' <<<"$attachment")
thing=$(curl --fail --silent --show-error -b "$work/cookies" \
    -H 'Content-Type: application/json' -d "$create_body" "$base/api/things")
thing_id=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["thing"]["_id"])' <<<"$thing")
thing_revision=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["thing"]["revision"])' <<<"$thing")

curl --fail --silent --show-error -b "$work/cookies" "$base/api/things" >/dev/null
updated_thing=$(curl --fail --silent --show-error -b "$work/cookies" \
    -X PUT -H 'Content-Type: application/json' \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"content":"RC smoke note updated #release","attachments":[json.load(sys.stdin)],"expectedRevision":int(sys.argv[1]),"public":True,"shared":True}))' "$thing_revision" <<<"$attachment")" \
    "$base/api/things/$thing_id")
thing_revision=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["thing"]["revision"])' <<<"$updated_thing")
curl --fail --silent --show-error "$base/api/public/$user_id/things/$thing_id" >/dev/null
curl --fail --silent --show-error "$base/public/$user_id" >/dev/null
curl --fail --silent --show-error "$base/api/files/$user_id/$thing_id/$attachment_id" >/dev/null

curl --fail --silent --show-error -b "$work/cookies" \
    "$base/api/export" -o "$work/export.tar"
test -s "$work/export.tar"

curl --fail --silent --show-error -b "$work/cookies" \
    -X DELETE -H 'Content-Type: application/json' \
    -d "{\"expectedRevision\":$thing_revision}" \
    "$base/api/things/$thing_id" >/dev/null

curl --fail --silent --show-error \
    -H 'Content-Type: application/json' \
    -d '{"username":"ci-import","password":"ci-password","email":"ci-import@example.invalid","displayName":"CI Import"}' \
    "$base/api/register" >/dev/null
curl --fail --silent --show-error -c "$work/import-cookies" \
    -H 'Content-Type: application/json' \
    -d '{"username":"ci-import","password":"ci-password"}' \
    "$base/api/login" >/dev/null
curl --fail --silent --show-error -b "$work/import-cookies" \
    -F "file=@$work/export.tar" "$base/api/import" >/dev/null
imported=$(curl --fail --silent --show-error -b "$work/import-cookies" "$base/api/things")
python3 -c 'import json,sys; assert any("RC smoke note updated" in x["content"] for x in json.load(sys.stdin)["things"])' <<<"$imported"

echo "Integration verification passed for Compose project $project on port $MEEMO_PORT."
