# Meemo 长期架构规范

> 规范性（Normative）长期约束。制定于 2026-09-16，2026-10-23 精简（约束未变，删去重复图示与已完成任务；精简前全文见提交 `d25b511`）。
> 当前实现以 [ARCHITECTURE.md](ARCHITECTURE.md) 为准，HTTP 契约以 [openapi.yaml](openapi.yaml) 为准，工作流程以 [AGENTS.md](../AGENTS.md) 为准。

## 当前状态（2026-10-23）

- 模块化单体：Express + MongoDB + 文件系统附件，单进程；Vue 3 SPA。
- 在线数据只读写统一集合（`things`、`settings`、`users`、`sessions`）；`things.tags` 是标签事实源，`tags` 集合是迁移投影。
- 账号只在 MongoDB；旧 file/fallback 用户源已从运行时删除，只保留离线迁移输入。
- NoteColor 已有单一定义（`src/note-colors.js` ↔ `web/src/constants/noteColors.ts`）。
- 可选 MCP（Gemini）读写工具已实现，默认关闭，2026-10-22 真实客户端验收通过；助手写入留下可见、可撤销的 `assistant` 标记（见 §12）。
- 浏览器端：service worker 提供安装与离线只读（决策记录见 ARCHITECTURE.md「Offline shell」）；图片在浏览器上传前缩小，不保留原图。
- 未实现：内置 AI 聊天、语义/向量检索、对象存储。
- 未决：见 §17。

## 0. 定位与冲突处理

本文回答：新增功能、重构、接入 AI、替换存储、扩大规模时，什么可以变、什么不能轻易变。

当前实现与本文冲突时：不为“纯洁性”立即重写；新代码不扩大冲突；模块下次被实质修改时以最小改动收敛；只有明确架构决策才可修改本文核心约束。

## 1. 目标与优先级

Meemo 是**可自托管、数据可掌控、结构简单、长期可维护、可逐步增强的个人知识与笔记系统**，不是大型知识管理平台。

优先级：数据可靠 > 简单可维护 > 行为可预测 > 安全 > 可恢复 > 使用体验 > 性能 > 功能数量 > 架构先进性。“更先进”与“更易维护”冲突时选后者。

## 2. 拓扑与基础设施

- 长期采用 **Modular Monolith**。部署单元保持：Meemo 应用 + MongoDB + 持久化附件存储（未来可选 S3 兼容适配器）。
- 不采用：微服务、服务网格、多数据库、Event Sourcing、CQRS、Actor、DI 容器、完整 DDD 框架、重型 UI/Design System 框架、提前建设的多租户 SaaS 架构（quota、计费、分片、管理平面）。
- **Simple First**：除非现有模块明确无法可靠解决问题，否则不增加组件；不为“以后可能需要”提前引入 Redis、Kafka、RabbitMQ、Elasticsearch、向量库、独立 Worker、API Gateway、服务发现、Kubernetes 专用逻辑。
- 不按 auth/note/attachment/tag/search 拆独立部署；代码模块边界已经足够。

## 3. 原则

- **单一事实源**：每类核心信息只有一个在线事实源；cache、projection、索引、派生视图可以存在，但禁止两处可独立修改又被默认同步（不双写）。
- **本地一致性优先**：用 MongoDB 单文档原子更新解决一致性；普通 CRUD 不引入分布式锁、消息最终一致、Saga、Outbox、跨服务事务。
- **显式契约**：Browser → OpenAPI → HTTP 校验 → Service → Persistence，每层边界有明确契约，不依赖“调用者应该知道”。
- **兼容层有期限**：只用于迁移、升级、有时限的回滚和历史验证；每个 legacy adapter 要能回答为何存在、谁在调用、何时可删。
- **运维简单即架构**：能备份、能恢复、能验证、能理解、能单人维护，比技术栈现代更重要；显著增加恢复复杂度的功能必须显式计算成本。

## 4. 代码分层

- 后端：`app.js`（composition root：启动、依赖初始化、Mongo/Worker/HTTP 生命周期、优雅关闭，不含业务规则）→ `src/http/` → `src/services/` → `src/database/` 与 `src/storage/`。
- 前端：`views/` → `components/` → `composables/` → `api/`。
- 新基础设施依赖从 composition root 创建并通过 factory 参数向下传递；现有共享 `config` 数据库引用可保留，但新模块不扩大对可变全局状态的依赖。
- **HTTP 层**：路由、认证中间件、解析、Zod 校验、状态码、响应整形、错误映射；不得直接访问 MongoDB 或附件文件系统，不实现或复制业务规则。
- **Service 层**：笔记、标签提取、WikiLinks/rich content、分享、导入导出、认证、附件、设置行为；不依赖 Express req/res，Promise-first，可被测试直接调用，只经 database/storage 适配器操作外部状态。
- **Domain 规则模块**：只有同一不变量被两个以上边界重复定义时（如 NoteColor）才提取小模块；禁止 entities/aggregates/value-objects/use-cases 等 DDD 目录形式。
- 不创建空目录或“为以后准备”的层级。

## 5. 数据

- MongoDB 是唯一生产业务数据库（users、sessions、things、settings 及必要投影）；不再增加第二套在线业务数据库。
- **Thing 是核心实体**（note、idea、link、bookmark、类任务内容）；新能力优先表达为 Thing 的属性、关系或派生行为，而不是平行数据模型。
- **标签权威**：`things.tags` 是标签身份与用量的事实源，运行时从 `things` 聚合；`tags` 集合只能是投影/维护产物，不得重新成为可独立写入的真相。迁移结束后若投影无运行价值，优先删除。WikiLinks 与标签可以增强，但默认基于 Thing 数据，不升级为复杂知识图谱基础设施。
- **用户身份**：内部所有权只用稳定 `userId`；username、email、旧集合前缀不得再承担主键角色。禁止新功能依赖旧用户源。
- **NoteColor**：统一枚举；缺失 → `default`，已知值保留，未知值在外部边界拒绝；历史脏值可在读取时显式归一化，但不得继续传播。
- **modifiedAt**：当前所有完整更新（含仅改颜色）都会刷新 `modifiedAt`；改变此语义须同步 OpenAPI 与排序行为。
- **并发**：在线写入优先单文档原子操作（`findOneAndUpdate`），而非读-改-写；维护任务需要读-推导-写回时必须 CAS 或等价条件更新，不得覆盖并发用户修改（参考 tag repair）。
- **Write Freeze** 只用于迁移、破坏性维护和生产就绪验证；普通 CRUD 不得增加 lease 计数、全局互斥或维护锁依赖。

## 6. 附件

- 文件系统仍是合理默认；访问路径 HTTP → Service → `src/storage/` → 文件系统，路由不得绕过 storage。
- 只有出现多实例共享、频繁迁移主机、数据量超出单机、需要对象生命周期管理或备份窗口成为瓶颈等真实需求，才引入 S3 兼容存储；届时经统一存储接口接入，业务层不感知实现，不把 S3 SDK 散落到 routes/services。

## 7. API

- `docs/openapi.yaml` 是公开 HTTP API 的唯一权威契约。改动链路：OpenAPI → 生成类型 → 前端 client → 服务端校验 → 测试；不得手改生成类型、只改后端或只改前端掩盖不一致。
- 优先增量、可选字段、向后兼容；避免无必要的改名或为“更标准”而改稳定接口。真有破坏性变更时优先 `/api/v2/`，但没有真实外部客户端前不建版本体系。

## 8. 前端

- 保持 Vue 3 + TypeScript + Vue Router + composable 状态 + Vite + Vitest；没有实际不可维护证据前不引入 Pinia/Vuex、Redux 式全局 store、RxJS、React Query 类缓存、微前端。
- URL route query 是搜索、标签、归档等可导航状态的事实源（刷新可恢复、可分享、前进后退正常）；会话内状态由 composables 管理。
- 必须防止上一用户/上一查询的慢响应覆盖当前状态；保持现有 generation 模式。
- MD3 是设计原则和 token 来源，不是必须整体引入的 UI 框架：CSS 语义 token + 原生 Vue 组件 + 少量共享常量。
- `web/src/styles/tokens.css` 是全局语义 token 唯一来源；组件不新增硬编码业务颜色；新增 token 按语义命名。
- 新 UI 必须用语义 token 支持暗色模式，不依赖固定白底或深色文字，不复制整套组件 CSS 实现暗色。
- 新交互组件应满足：键盘可达、可见焦点、语义 role、有意义的 aria-label、触控目标约 44–48px、`prefers-reduced-motion`、不单用颜色表达关键状态；取色器、对话框、弹出层必须考虑键盘交互。

## 9. Worker 与搜索

- Worker 保持同进程、少量、可关闭、不承担核心同步写路径。只有任务需要独立扩缩容、持久重试、长时间运行、明确积压或与 Web 进程故障隔离时，才评估独立 Worker；不因存在周期任务就引入队列系统。
- 搜索演进顺序：Mongo 查询 → Mongo 索引 → 基准测试与优化 → 仅在被证明不足时引入外部搜索引擎；用 `scripts/benchmark-search.js` 的数据而非直觉决策。

## 10. 导入导出与备份恢复

- 导入导出是核心数据主权能力：格式可理解、严格校验、防路径穿越、限制归档大小、附件一致、部分失败可回滚、旧归档兼容策略明确。
- 新组件只有回答“如何与现有数据一致地备份、恢复和验证”后才能进入生产；新增 Redis/S3/搜索索引/向量库等必须先声明是 authoritative 还是 rebuildable，rebuildable 的不得扩大核心灾备集合。

## 11. 安全与密钥

- 生产坚持：Mongo 用户源、服务端会话、强 `SESSION_SECRET`、输入校验、基于稳定 `userId` 的授权、安全附件路径、SSRF 防护；不为开发便利降低生产 fail-closed 行为。
- 密钥不进 Git、日志、导出归档、客户端 bundle，不作为迁移 CLI 参数打印；未来 AI Provider Key 同样适用。

## 12. AI

- AI 是挂在核心旁的可选能力，不是核心数据架构的依赖。所有 AI Provider 不可用时，创建/编辑、搜索、WikiLinks、标签、附件、归档、导入导出、备份恢复必须正常工作。不为 AI 重写核心。
- 模型调用经 AI 适配层（Gemini、OpenAI、本地模型等），业务代码不散落调用模型 SDK。外部助手（如 MCP）只经应用服务访问数据。
- **AI 输出不能静默成为事实**：AI 生成的摘要、标签、链接、标题、分类属于派生建议，用户明确接受前不得覆盖原始笔记；禁止把模型重写的内容当作用户修改。当前落地：用户在助手中主动发起的 MCP 写入直接生效，但在 Thing 上留下可见的 `assistant` 标记并可由用户撤销；用户的下一次写入会清除标记，自动冲突合并不得越过助手写入。
- 向量库：顺序为现有搜索 → 可选的 AI 查询改写/重排 → 证明语义检索有价值 → 才评估 embedding。若引入，embedding 必须可重建、不得成为事实源、记录 provider/模型版本、随 Thing 删除可清理。

## 13. 外部集成

Webhook、Agent、CLI、移动端等外部工具优先通过 HTTP API（或同样受控的 MCP 边界）接入，不得直接访问 MongoDB、直接修改附件文件系统或依赖内部集合 schema。

## 14. 依赖与技术栈

- 新增生产依赖前回答：现有依赖或标准库能否解决？CVE/维护面？amd64/arm64？Docker 构建？备份/运行时影响？是否易于删除？小功能优先写少量清晰代码。
- 后端保持 Node.js 24+、CommonJS、Promise-first async/await；不为“现代化”做全仓 ESM/TypeScript/换框架迁移，除非现有技术造成持续、可证明的问题。前端继续用 TypeScript。

## 15. 可观测性、测试与 CI

- 最低要求：结构化日志、必要的请求关联、live/ready 健康检查、明确的启动失败与关闭、敏感数据脱敏；若加 metrics，只加少量核心指标，不建遥测管道。
- 测试保持两套：后端/契约用 Mocha，前端行为用 Vitest；不增加第三个同类测试框架。分层覆盖：单元/行为（服务规则、前端交互、解析器、领域不变量）、集成（MongoDB、会话、附件、导入导出、公开分享）、构建（类型检查、生产资源、生成类型同步）、容器（amd64、arm64、Compose 启动）。
- CI 覆盖生成类型同步、前端 typecheck/test/build、后端测试、集成、amd64 与 arm64 镜像；公开 RC 发布要求完整门禁通过。日常主机部署复用本次改动相关的验证，不默认等待全部远程 CI 或重跑全套检查；相关失败必须先查明。

## 16. 发布与迁移

- 开发流程（直推 master 或 PR）不属于架构约束。日常部署记录提交 SHA、实际镜像 ID/digest 和相关验证结果，保留上一镜像用于应用回滚，不只依赖 `latest` 等可变 tag。
- 生产 MongoDB 独立部署并与 travel-cards 共用。Meemo 日常部署只替换应用容器，不管理共享数据库实例，不默认冻结写入、全库备份或做恢复演练。数据迁移、数据库升级和数据恢复另行明确范围与匹配备份，不能影响其他应用。
- 迁移代码标明属于 active / rollback window / historical evidence / retired；观察窗口结束且不再需要回滚后，优先删除运行时兼容路径。迁移工具可作为历史证据保留，但不得污染请求路径。

## 17. 复杂度预算与重大升级

- 每引入新的运行进程、数据库、消息中间件、持久化系统、状态框架、UI 框架、构建系统或服务，都是一次 **Architecture Cost Event**，必须写清：问题、现有架构为何无法解决、新组件、失败模式、备份影响、安全影响、回滚、移除路径。说不清就不引入。
- 只有出现实际证据才进入重大架构评估：Scale（数据库/文件存储形成真实瓶颈、单实例资源持续触顶）、Reliability（单进程故障域无法满足真实 SLA）、Operations（备份恢复时间不可接受）、Product（多实例或大规模异步任务成为必须、语义检索被证明是核心体验）、Team（多团队需要独立发布）。“业界都这么做”不是证据。
- 涉及新数据库、新运行服务、新持久化系统、API 破坏性变更、认证模型变更、附件后端变更、主要前端状态框架、AI/向量基础设施、备份模型变更时，写一页以内的架构决策：Decision / Problem / Alternatives / Why / Operational Impact / Rollback。
- **未决**：迁移完全结束后，重新评估 `tags` 投影集合（目前仍被 `cleanupTags` 与就绪检查使用）是否还有必要，无必要即删除。

## 18. 变更检查清单

**Thing 新字段**：默认值、HTTP 校验、OpenAPI、生成类型、创建/更新/读取路径、导入、导出（旧归档缺字段时的默认值、非法值处理）、旧数据兼容、前端状态、测试。

**较大功能/重构**：

- 数据：事实源唯一？有无双写？旧数据兼容？导入导出覆盖？备份恢复受影响？
- 边界：HTTP 只处理 HTTP？Service 拥有业务行为？外部状态经 database/storage 封装？无跨层直接访问？
- 契约：OpenAPI 更新、生成类型同步、校验与领域一致？
- 并发：会否覆盖并发修改？该用原子更新/CAS 吗？
- 前端：URL/composable 状态权威清晰？无不必要的全局状态？语义 token？暗色、键盘、焦点正常？
- 安全：认证授权仍 fail-closed？新输入已校验？密钥不泄露？外部请求未扩大 SSRF 风险？
- 运维：CI 覆盖？amd64/arm64？如何回滚？是否新增长期运行组件？
- 复杂度：这是最小所需架构吗？有更简单方案吗？新抽象已有至少两个真实使用点吗？

## 最终原则

每一层都能被一个人理解，每一份核心数据都知道真相在哪里，每一次升级都能被验证，每一次失败都能恢复。

```text
Prefer explicit over implicit.
Prefer one source of truth over synchronization.
Prefer one deployable over distributed components.
Prefer small modules over frameworks.
Prefer proven need over speculative scalability.
Prefer recoverability over architectural elegance.
Prefer deleting compatibility code over maintaining it forever.
```
