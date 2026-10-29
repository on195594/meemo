# Deployment and releases

## Routine host deployment

Production MongoDB is independently deployed and shared with travel-cards. Meemo uses its existing database and `/home/lin/meemo` Compose configuration. The repository Compose stack is a standalone development/test setup, not the production topology.

1. Reuse the relevant successful checks for the code being deployed; rerun only checks affected by subsequent changes or failures. Documentation/test-only changes do not need an application rebuild or restart unless explicitly requested.
2. From a clean, committed checkout, run `./deploy.sh` when deployment is authorized. Existing authorization for this deployment remains valid; do not ask again for each step.
3. The script builds once while the old app keeps running, records the previous image ID, then runs `up -d --no-deps --no-build --wait --wait-timeout 60 meemo`. It verifies the running image ID and prints the deployed commit.
4. If activation, health, or image verification fails, it restores the previous Meemo image, checks that it starts, and exits nonzero. Investigate the failure before retrying. Keep the previous image locally through the observation period.

This is the complete default deployment flow. It does not restart MongoDB or travel-cards, change databases, acquire a database write freeze, dump data, save image archives, clone production, reset passwords, inspect existing login sessions, or run a restore rehearsal. Do not create a temporary deployment framework around the script.

Do not repeat frontend builds outside the Docker build or wait for every hosted CI job during routine host deployment. Report known CI failures and investigate those relevant to the change; an unrelated CI failure is not a reason to rerun all local suites. Readiness verifies process/dependency availability, not every user workflow; run a focused user-flow check only when the change affects it.

## Separate operations

- **Schema/data migrations, MongoDB upgrades, or destructive maintenance:** plan the exact target and backup/rollback procedure for that operation. Follow [Backup and restore](BACKUP_RESTORE.md); legacy migration source selection and readiness checks belong there.
- **Data recovery:** restore only Meemo's explicitly identified database and attachments. Never restore the shared MongoDB data directory or operate on travel-cards as part of Meemo deployment.
- **MCP/OAuth changes:** use the relevant [assistant acceptance checks](GEMINI_ASSISTANT.md). Repeat real-client checks when tools, scopes, OAuth, or related deployment settings change.
- **Backup/recovery exercises:** run when requested or when recovery tooling changes, independently of routine deployment.

## Published RC releases

The manually dispatched **RC release** workflow is separate from host deployment. It requires a green full validation gate, builds both `linux/amd64` and `linux/arm64`, publishes an immutable `vX.Y.Z-rcN` candidate to GHCR with provenance/SBOM, and creates a GitHub prerelease. It does not move stable aliases or deploy the host. Do not dispatch it merely to update the running Meemo app.
