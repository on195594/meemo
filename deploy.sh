#!/bin/bash
set -e
docker build -t meemo:latest "$(dirname "$0")" && docker compose --project-directory /home/lin/meemo up -d
