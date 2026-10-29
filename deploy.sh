#!/bin/bash
set -euo pipefail

repository="$(cd "$(dirname "$0")" && pwd)"
compose=(docker compose --project-directory /home/lin/meemo)
revision="$(git -C "$repository" rev-parse HEAD)"
if [ -n "$(git -C "$repository" status --porcelain)" ]; then
    echo 'Commit changes before deploying so the image revision identifies its source.' >&2
    exit 1
fi

container="$("${compose[@]}" ps -q meemo)"
previous_image="$(docker inspect --format '{{.Image}}' "$container")"
docker build --build-arg "COMMIT=$revision" -t meemo:latest "$repository"
candidate_image="$(docker image inspect --format '{{.Id}}' meemo:latest)"

activate() {
    "${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 60 meemo || return 1
    container="$("${compose[@]}" ps -q meemo)" || return 1
    [ "$(docker inspect --format '{{.Image}}' "$container")" = "$1" ]
}

if activate "$candidate_image"; then
    printf 'Deployed %s (%s). Previous image: %s\n' "$revision" "$candidate_image" "$previous_image"
else
    echo 'Deployment failed; restoring the previous Meemo image.' >&2
    docker tag "$previous_image" meemo:latest
    if activate "$previous_image"; then
        echo 'Previous Meemo image restored and healthy.' >&2
    else
        echo 'Rollback failed; inspect the Meemo container before retrying.' >&2
    fi
    exit 1
fi
