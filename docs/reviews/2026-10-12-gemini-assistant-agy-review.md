# Gemini 接入方案：AGY 独立审查与修订

清理备注（2026-10-12）：用户授权后，本会话的临时审查副本与原始日志已清除。下文路径仅为历史调用记录，不再是可读取的验收附件；结论与修复依据保留在本文，后续清理改动不属于当时的审查范围。

日期：2026-10-12。范围：仅[接入方案](../roadmaps/2026-10-12-gemini-assistant-integration.md)，不是实现、安全认证或上线验收。

## 调用与证据

实际调用本机 `/home/lin/.local/bin/agy` CLI 两次，独立于主助手，不以内部代理冒充 AGY。使用 `git archive HEAD` 创建 `/tmp/meemo-gemini-agy-uJbY7Y` 源码副本并复制候选文档，未创建共享 Git 元数据的 worktree。审查指令禁止修改、执行测试、访问生产、凭据或外部网络。

- 第一轮：`agy --mode plan --sandbox --disable-slash-commands --print-timeout 240s -p ...`。CLI 警告禁用 slash expansion 时 plan 模式不生效；因此不声称本轮 plan 模式提供只读保证。使用副本、sandbox 和只读指令，后续比对副本源文件。进程返回 0，但正文明确超时、输出不完整，因此记录为 **INCOMPLETE（已返回 REQUEST_CHANGES 及部分 findings）**，不能仅据退出码认定完成。
- 修订复审：去掉 `--disable-slash-commands`，使用 `agy --mode plan --sandbox --print-timeout 300s -p ...`，新调用，限定方案及三个相关源文件。完整返回 **PASS**，退出码 0，无超时标记。
- 原始临时输出：`/tmp/meemo-gemini-agy-uJbY7Y-review.txt`、`/tmp/meemo-gemini-agy-uJbY7Y-recheck.txt`。临时路径不作为持久化证据依赖，本文件保留核心结论、核实依据及处置；未记录运行模型，不能推断模型身份。

## 首轮发现与主助手核实

| 发现 | 本地核实与处置 |
| --- | --- |
| 用户撤销不能影响全局 OAuth client | 接受补充契约。原稿已绑定用户，但未明确撤销查询粒度；现明确 client/grant/token 分层，设置页只撤销认证用户的 grant，测试同 clientId 双用户隔离。不采纳“Gemini 一定共享一个 client_id”的未经验证断言。 |
| 预分配 ID 幂等与现有 add 接口不匹配 | 接受。`src/services/thing-service.js:189` 与 `src/database/things.js:343` 的现有创建链无调用方幂等键。修订明确需要服务/仓储层专用单文档幂等创建入口、局部唯一索引和恢复测试，不能假装原样复用已支持。写阶段以此为门禁。 |
| 待确认系统复杂度过高 | 部分接受。新同源确认页本身并不等于分布式系统或必然违反单体规范，但前稿预先引入跨集合状态与恢复负担不合适。删除默认实施该系统的承诺，首批只读，写阶段保留“持续授权 / 强制逐次确认”待用户明确选择。不接受以未经核实的 Gemini 原生弹窗代替服务端安全保证。 |
| 标签分页缺少现有接口支持 | 接受并自行完成核实（该项首轮输出在中途截断）。`src/services/thing-service.js:267` → `src/database/things.js:278` 聚合直接 toArray。补充兼容分页、数据库侧 limit、maxTimeMS 和现有返回语义；分页不声称消除全量聚合成本。 |

修改是方案修订，不是对应功能已经实现。保留创建/更新作为完整目标，只建议先交付只读，不能将用户目标改成永久只读。

## AGY 复审结论摘录

> 审查结论：PASS
>
> 方案将 Phase 1 只读工具定义为当前可执行目标，将写入工具及逐次确认、幂等性严格列为“前置门禁”（非已实现缺陷），不依赖未经实测的 Gemini 客户端弹窗承诺，且与现有代码逻辑及长期架构约束一致。

复审检查：

- `docs/LONG_TERM_ARCHITECTURE.md`：单体分层、things.tags 为标签事实源、AI 为可选能力、单文档本地一致性。
- `src/services/thing-service.js:267–269`、`src/database/things.js:278–293`：当前标签查询无分页。
- `src/services/thing-service.js:189–231`、`src/database/things.js:343–436`：创建无幂等入口，更新富化请求早于数据库 CAS。

非阻断建议：标签分页保留 `{ ownerId, name, usage }` 兼容性并限制聚合耗时；更新先核验所有权、版本，再发出富化网络请求。方案已涵盖这些约束。

复审文本中“功能开关保持关闭”不作为运行事实：当前只是提案，Meemo MCP 功能和开关尚未实现，本轮没有核查或修改生产配置。

## 验证与限制

- 相对 Markdown 链接 21 个全部通过；185 个已跟踪文件与审查副本一致（排除审查后补充索引的 `docs/README.md`），最终方案与复审输入逐字一致。未发现 AGY 改动副本源文件。
- `git diff --check` 及两份新增文档的 no-index whitespace 检查通过。
- 自动化实现测试、Meemo 真实 Gemini 双端验收、生产部署：**NOT_RUN**。
- travel-cards 双端验收沿用用户确认，不要求重复证明，也不外推为 Meemo 或所有专项测试通过。
- AGY 的 PASS 仅表示该分阶段方案在本轮范围内可推进；写阶段仍须完成明确列出的产品与技术决策，并在落地时重新验证。
