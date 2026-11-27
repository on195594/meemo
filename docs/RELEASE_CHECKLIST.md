# Deployment and releases

## Routine host deployment

Production MongoDB is independently deployed and shared with travel-cards. Meemo uses its existing database and `/home/lin/meemo` Compose configuration; the repository `docker-compose.yml` is for standalone development/testing.

1. Reuse relevant passing checks for the candidate commit; rerun only checks affected by subsequent edits. Docs/test-only changes do not require rebuilding or redeploying unless requested.
2. From a clean, committed checkout, run `./deploy.sh` when deployment is authorized.
3. `./deploy.sh` builds `meemo:latest` once while the existing container stays online, records the previous image ID, runs `up -d --no-deps --no-build --wait --wait-timeout 60 meemo`, and verifies the running image ID.
4. If activation, health, or image verification fails, it rolls back to the previous local image, confirms startup, and exits nonzero.

Routine deployment never restarts MongoDB or travel-cards, dumps data, acquires write freezes, or runs backup/restore exercises.

## Separate operations

- **Schema/data maintenance or MongoDB upgrades:** require separate authorization and explicit target/rollback planning; follow [Backup and restore](BACKUP_RESTORE.md).
- **Data recovery:** restore only Meemo's identified database and attachments; never touch travel-cards or the shared MongoDB data directory.
- **MCP/OAuth changes:** perform [real-client acceptance checks](GEMINI_ASSISTANT.md) whenever tools, scopes, OAuth flows, or MCP deployment settings change.

## Published RC releases

The manually dispatched **RC release** workflow runs the full validation gate, builds `linux/amd64` and `linux/arm64` images, publishes an immutable `vX.Y.Z-rcN` image to GHCR with provenance/SBOM, and creates a GitHub prerelease. It does not move stable aliases or deploy the production host.
