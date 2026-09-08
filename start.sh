#!/bin/sh

set -eu

mkdir -p "${ATTACHMENT_DIR}"

echo "=> Start Meemo"
exec node /app/code/app.js
