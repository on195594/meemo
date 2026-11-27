# Documentation index

## Current contracts and operations

- [Project README](../README.md): quick start, environment configuration, development commands, and repository layout.
- [Architecture](ARCHITECTURE.md): module boundaries, persistence, offline SW, performance, and change guardrails.
- [OpenAPI specification](openapi.yaml): authoritative HTTP contract; regenerate `types/generated/api-types.ts` via `npm run api:generate` after edits.
- [Design system](../DESIGN.md): Material Design 3 and Google Keep tokens, palette, and component specifications.
- [Contribution guide](../CONTRIBUTING.md): coding style, testing boundaries, and [validation matrix](../CONTRIBUTING.md#validation).
- [Agent instructions](../AGENTS.md): repository working rules and targeted verification commands.
- [Security policy](../SECURITY.md): vulnerability reporting, supported branches, and dependency audits.
- [Gemini assistant](GEMINI_ASSISTANT.md): default-disabled MCP read/write tools, OAuth 2.1 / PKCE setup, budgets, privacy, and recovery.
- [Backup and restore](BACKUP_RESTORE.md): database and attachment backup/restore runbook on the shared MongoDB host.
- [Deployment and releases](RELEASE_CHECKLIST.md): routine Meemo-only deployment, rollback, and RC release workflow.
- [Nginx reference](nginx-reverse-proxy.conf): sample TLS, compression, and static-caching reverse proxy configuration.

## Repository maintenance

- Keep server source in `src/`, frontend source/tests in `web/src/`, server/contract tests in `src/test/`, operational scripts (`build-frontend.js`, `gc-attachments.js`, `verify.js`, `verify-integration.sh`) in `scripts/`, and generated OpenAPI types in `types/generated/api-types.ts`.
- Root scripts (`app.js`, `start.sh`, `deploy.sh`, `runTests`, `localdevelopment`) are intentional runtime/ops entry points.
- Never hand-edit generated `public/`, `web/dist/`, or `types/generated/api-types.ts`, and never commit local state (`.users.json`, `storage/`, `.env`, `node_modules/`).
- Remove unused code only after verifying runtime, test, script, and build callers. Keep documentation and links synchronized when behavior changes.
