# Gemini MCP：Codex 独立审查及修复

清理备注（2026-10-12）：用户授权后，本会话的临时审查副本与原始日志已清除。下文路径仅为历史调用记录，不再是可读取的验收附件；结论与修复依据保留在本文，后续清理改动不属于当时的审查范围。

日期：2026-10-12。对象：Meemo 第一阶段只读 MCP 的全部 28 个未提交候选文件（16 个已跟踪修改、12 个未跟踪文件），包括源码、测试、API、生成类型、前端和文档；暂存区为空。不将上轮 AGY 结论作为证据，不审查生产环境。

## 实际调用与隔离

使用真实 OpenAI Codex CLI **0.162.1**，模型 **gpt-6-astra**，通过原生 `codex exec review` 的自定义提示明确审查相对 HEAD 的全部未提交/未跟踪变更。

- 独立 `git clone --no-local --no-hardlinks` 到 `/tmp/meemo-codex-mcp-0Zq3TS/source`，复制候选文件，无共享 worktree/Git 元数据；记录初始与修复后逐文件 SHA-256。
- `--ignore-user-config --ignore-rules --ephemeral`；禁用 hooks、plugins、remote plugins、apps、浏览器、multi-agent、skill search、shell snapshot；审批 **never**，模型命令网络关闭。
- 使用官方命名权限配置：根路径 deny、最小系统运行文件 read、工作区 read，主机 `/home/lin/.codex` deny。CLI 实际报告 **sandbox: read-only**。未同时混用会覆盖此策略的旧 `sandbox_mode` 设置。配置来源为官方 [Permissions](https://developers.openai.com/codex/permissions) 与已安装 CLI help。
- 最初启动失败：隔离策略阻止主机用户目录内的 CLI sandbox helper 执行；复制 CLI 后又因缺少相邻 code-mode host 返回 INCOMPLETE。未放宽主机目录读取、写入、网络或审批。最终将已有官方 CLI 和配套 host 复制到快照的 ignored `node_modules/.bin`；两者 SHA-256 与原始已安装文件一致，没有安装/替换评审器。
- 每个完成的审查都检查了目录读取隔离；复审首个命令 `test -r /home/lin/.codex/config.toml` 得到 `EXPECTED_UNREADABLE`，未读取配置内容。
- 只复制官方 SDK 1.32.1 和 rate-limit 源码用于核实，不提供生产数据、账号文件、附件或环境凭证。其他测试依赖不提供给 Codex，禁止其安装、执行测试或启动服务。

初审、复审完成调用均退出 0，有完整最终结论；启动失败和 INCOMPLETE 不计作通过。日志/最终消息位于上述私有临时目录（`transcript.log`、`result.txt`、`recheck-transcript.log`、`recheck-result.txt`），不提交完整运行日志。以下保留可持久化的结论和证据。

## 初审：REQUEST_CHANGES

| 优先级与原位置 | 本地核实 | 最小修复及回归 |
| --- | --- | --- |
| P1，原 `src/http/mcp.js:109–112`：异步认证期间断连会泄漏并发名额 | SDK Bearer middleware 在数据库 await 后仍可 next；close 已发生后才挂释放监听器不会再释放。16 次泄漏可阻塞整个 MCP。 | 占位前检查 `res.destroyed`；分派前及 await connect 后也检查断连。测试延迟用户查询、等待实际 response close、释放认证，重复 17 次后正常请求仍 200。 |
| P2，原 `src/http/mcp.js:115–121`：批数组绕过按 HTTP 计费的工具限制 | SDK `webStandardStreamableHttp.js` 接受 batch 并分派多条消息；单个请求占一个并发槽，却可调用多次工具。 | 在创建 server/transport 前拒绝所有数组，返回 JSON-RPC invalid request；不新增批量计费系统。测试批数组被拒且没有工具审计事件。 |
| P2，原 `src/http/mcp.js:115–116`：发现/401 缺少受限 CORS | 协议路由先于普通 app CORS 返回；发现响应和认证错误此前没有正确浏览器访问头，WWW-Authenticate 未暴露。 | Host/Origin 校验后、发现和 Bearer 前统一应用已有 cors 依赖，暴露挑战头；预检仍经过限流。测试允许来源的两个发现端点、预检、401 和 400，以及不允许来源的 403。 |
| P2，原 `src/http/mcp-tools.js:33–34`：长请求 ID 突破 128-KiB 回复预算 | SDK 回显不限长度的 request ID；固定 1-KiB headroom 无法覆盖数 KiB ID。 | 入口限制 ID 的序列化 UTF-8 字节数 ≤256，超限不回显 ID；保留有界 envelope headroom。测试 8-KiB ID、转义/Unicode 边界及合法 ID +125-KiB 正文的实际线缆体积。 |

所有四项均接受并修复。另修正测试日志捕获：logger 函数 stream 接收对象，应 JSON 序列化后再判断工具事件/敏感内容；旧 `.join()` 会产生 `[object Object]`，不足以有效证明日志脱敏。未改生产 logger 行为。

## 复审：PASS_WITH_NOTES

Codex 完整复审结论：

> 只读审阅覆盖全部 28 个候选文件（16 个已跟踪、12 个未跟踪）、相关调用方及工作区 SDK 1.32.1 源码，未发现剩余可操作缺陷。前四项修复均有实际代码支撑；新增测试的断连同步、无分派审计、转义/Unicode 边界及 125KiB 响应断言静态检查有效。

复审并非只看修复摘要：检查当前源码、SDK 与相关调用链及测试，并明确包含未跟踪文件。复审后核对快照和主工作区：28 个目标文件均与修复后 manifest 一致，未发现 Codex 修改候选文件。之后仅新增本审查记录及补充文档索引/状态记录，不改变已复审代码。

## 主助手验证与限制

以下由主助手在隔离测试 MongoDB 上执行，**不是 Codex 执行**：

- `npm test`：**486 passing**。
- `npm run api:generate`、前端 typecheck：通过；Vitest：**103 passing**。
- 生成类型独立重生成比对一致；61 个相对 Markdown 链接、tracked/new-file whitespace 和 JS 语法检查通过；代码/类型与 Codex 复审输入逐字一致。
- 本轮不重跑 frontend build：前端源码未改变，上轮实现构建已通过；本轮生成类型仅同步协议描述，typecheck 重新通过。

Codex 仅执行只读检查。生产部署、真实 Gemini 双端、Docker 打包、完整 verify、MCP 恢复专项：**NOT_RUN**。功能保持默认关闭；写入阶段仍未实现。既有 multer moderate 审计问题未顺带升级，见[安全记录](../DEPENDENCY_SECURITY.md)。

PASS_WITH_NOTES 是候选源码审查结论，不是生产批准、真实客户端兼容性证明或全部依赖安全认证。
