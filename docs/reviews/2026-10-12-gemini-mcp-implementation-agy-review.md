# Read-only MCP implementation: AGY review

清理备注（2026-10-12）：用户授权后，本会话的临时审查副本与原始日志已清除。下文路径仅为历史调用记录，不再是可读取的验收附件；结论与修复依据保留在本文，后续清理改动不属于当时的审查范围。

Date: 2026-10-12. Scope: phase-1 candidate code, not production approval or real Gemini acceptance.

## Invocation and boundaries

The main assistant invoked the real local `/home/lin/.local/bin/agy` CLI in separate invocations, using an isolated `git archive HEAD` snapshot plus candidate files at `/tmp/meemo-mcp-implementation-agy-JImKwp`. No shared Git worktree was used. Instructions prohibited writes, production, credentials, services and external network. Later invocations supplied relevant source inline and prohibited all tools; no internal substitute was presented as AGY.

1. Broad snapshot review: `--mode plan --sandbox --print-timeout 300s`. The process returned 0, but the output only reported timeout: **INCOMPLETE**, no findings or verdict.
2. Focused inline review: `--sandbox --effort medium --disable-slash-commands --print-timeout 240s`. Completed with **REQUEST_CHANGES**. Four files: HTTP MCP router, auth service, OAuth persistence, tool registration. The stated auth-context blocker was checked against the installed SDK and rejected as factually incorrect; the HTTP-method finding also did not identify an actual failing path.
3. Evidence-based recheck: same focused CLI flags, fresh invocation with router/auth/tools/note service, relevant note repository methods, exact SDK forwarding source, and isolated integration results. Completed with **PASS within that supplied scope**, no blocking findings. This is not a whole-repository or dependency security review. The runtime model was not recorded.

Raw temporary outputs end in `-review.txt`, `-focused.txt`, `-recheck.txt` beside the snapshot path. This report retains the meaningful evidence and decisions rather than relying on those temporary artifacts as durable acceptance.

## Findings adjudication

| Claim | Local evidence and disposition |
| --- | --- |
| Transport loses `req.auth`, so all tools fail | **Not reproduced; rejected.** Installed `@modelcontextprotocol/sdk@1.32.1` `dist/cjs/server/streamableHttp.js:131–145` explicitly reads `req.auth` and passes `authInfo` to its Web Standard transport. That transport forwards it to `onmessage`. Tests execute search/read/tag calls with actual synthetic data. AGY retracted this claim on recheck. No speculative fourth argument or session-token fallback was added. |
| Unmatched HTTP method is a security blocker | **No concrete bug identified.** OPTIONS is intentionally before Bearer auth, POST is authenticated, other `/mcp` methods return 405, and unrelated reserved protocol paths return 404. AGY recheck found no method mismatch. |
| Tag page bounds could diverge in future | Non-blocking. Current HTTP schema is max 50, repository bound is max 51 to fetch `hasMore`. Both are tested. No unrequested conversion/wrapper was added for a hypothetical future bound change. |
| Per-request server allocation | Non-blocking stateless transport trade-off; instances are closed on response close. Rate/concurrency limits bound allocation. Do not introduce shared authentication/session state for speculative optimization. |

## Final scope and checks

The main assistant additionally hardened the protocol deadline from an inactivity timeout to an absolute 15-second deadline, added refresh/revocation, public-rate-limit and stalled-body deadline tests, and invalidated frontend async responses on unmount after the reviewed snapshot. The main assistant also added canonical-ID/disabled-account checks rather than relying on the profile response (which drops account status), and rejects username-only legacy sessions. Regressions cover disabled accounts, legacy sessions and a username matching a deleted stable ID. The final middleware also applies a 2-KiB MCP browser-API body cap before the global REST parser and short-circuits disabled APIs before parsing/session access; both have regressions. These final changes are covered by local checks, not misrepresented as AGY-reviewed final bytes.

- Final local checks: `npm ci` PASS; `npm test` **483 passing**; frontend build/typecheck PASS; Vitest **103 passing**; independent OpenAPI regeneration matches candidate types; 58 relative Markdown links and whitespace/syntax checks PASS. See the [integration plan](../roadmaps/2026-10-12-gemini-assistant-integration.md).
- Source/dependency review is bounded; AGY did not validate the actual public callback, proxy, Google account, renewal UX or real Gemini client.
- Meemo real Gemini web/mobile acceptance, Docker packaging check, production deployment and credential changes: **NOT_RUN**.
- Existing production `multer` audit finding was reported separately; no blanket claim that all dependencies are clean.

The scoped PASS supports continuing candidate implementation work, not bypassing release gates. Writing remains disabled/unimplemented pending the plan's explicit product and idempotency decisions.
