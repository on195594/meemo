# Meemo 重构执行路线图

> 建议仓库路径：`docs/REFACTORING_ROADMAP.md`  
> 状态：Proposed / Ready for execution  
> 基线：`master` @ `3a8fa1585280b6ccff699a10120c3cafccfb90c2`（2026-09-09）  
> 目标：在不进行“大爆炸式重写”的前提下，把 Meemo 演进成安全、可测试、可迁移、可持续维护的现代自托管应用。

---

## 1. 重构目标

Meemo 的产品核心保持不变：快速记录 Notes/Things，并提供 Tag、Search、Attachment、Archive、Sticky、Public Share、RSS、Import/Export。

本轮重构的成功标准不是“换成新技术栈”，而是达到以下状态：

1. `master` 始终可发布，所有行为变化必须通过 PR 和自动化检查。
2. 修复当前认证、SSRF、附件访问、上传与导入链路中的高风险边界问题。
3. 用户身份、业务数据和附件不再依赖 username 作为底层存储标识。
4. 用户数据从 `.users.json` 迁入 MongoDB，并具备可验证、可回滚的迁移流程。
5. 后端从大文件/回调式组织演进为清晰的 HTTP → Service → Repository 分层。
6. 建立稳定的 API 契约与安全回归测试，再迁移 Vue 1/Gulp 前端。
7. 前端最终迁移至 Vue 3 + Vite + TypeScript，功能平价后删除旧前端工具链。
8. Docker 发布形成真正可部署、可回滚、可追踪的镜像供应链。
9. 重构结束后再进入 PWA、Quick Capture、浏览器剪藏和 AI 辅助整理等产品增强阶段。

---

## 2. 重构原则与硬约束

### 2.1 必须遵守

- 不做 Big Bang Rewrite。
- 不在同一个 PR 同时进行“数据模型迁移 + 前端重写 + 依赖大升级”。
- 每个 PR 只解决一个主要问题，且必须能独立回滚。
- 在新前端完成 Feature Parity 之前，保持现有 API 行为兼容。
- 数据迁移必须包含：备份、dry-run、计数校验、切换、回滚路径。
- 安全修复优先于 UI、视觉和新增产品功能。
- `master` 必须保持可构建、可测试、可 Docker 启动。
- 任何涉及 Auth、Attachment、Import/Export、Public Share 的行为修改必须有回归测试。
- 在生产模式下，安全关键配置不得静默降级为不安全默认值。

### 2.2 本轮明确不做

以下内容不属于重构主线，除非为了兼容或安全必须实现：

- 不重新引入 Cloudron/OIDC。
- 不恢复旧 token authentication。
- 不做微服务拆分。
- 不引入 Kubernetes 作为项目运行前提。
- 不引入复杂事件总线、CQRS、DDD 框架。
- 不做富文本编辑器替换。
- 不在安全与数据迁移完成前加入 AI 功能。
- 不在 Vue 3 迁移期间同时重新设计全部产品交互。

---

## 3. 目标架构

```text
                    Meemo Web / PWA
                          │
                      HTTP / REST
                          │
                ┌─────────┴─────────┐
                │   HTTP Layer      │
                │ routes & validate │
                └─────────┬─────────┘
                          │
                ┌─────────┴─────────┐
                │   Service Layer   │
                │ auth / things     │
                │ files / sharing   │
                │ import / export   │
                └─────────┬─────────┘
                          │
               ┌──────────┴──────────┐
               │                     │
        Database Layer         Storage Adapter
               │                     │
            MongoDB              Local Filesystem
                                      │
                                 S3-compatible
                                  (future option)
```

针对 Meemo 当前后端核心逻辑约 1,400 行原生代码的实际规模，架构重构**坚决避免企业级重型 DDD 与过度分层**（不搞单一实现的 Repository/Domain/Controller 重复代理样板）。目录结构收敛为务实清晰的 3 层结构：

```text
src/
  config.js          # 配置与环境变量解析/校验
  http/              # HTTP 接入层
    routes/          # 路由映射与端点定义
    middleware/      # 鉴权、限流、请求上下文、统一错误处理
  services/          # 核心领域业务逻辑（脱离 HTTP 的纯业务实现）
  database/          # MongoDB 持久化操作与数据模型
  storage/           # 本地/对象存储适配器
  migrations/        # 数据迁移与校验脚本
  test/              # 自动化单元/集成/安全测试
```

迁移过程允许旧结构与新结构短期共存，任何新模块都应朝目标结构移动。

---

## 4. 阶段门禁（Gates）

| Gate | 目标 | 进入下一阶段的必要条件 |
|---|---|---|
| G0 Baseline | 建立可信基线 | CI、测试、Docker smoke test 全绿；App 工厂解耦完成；禁止绕过主线门禁 |
| G1 Security | 封堵高风险边界 | Auth、SSRF、Attachment、Upload、Import 安全测试全绿 |
| G2 Identity & Data | 去除 username 底层耦合 | users Mongo 化；稳定 userId；Things/Tags/Settings 统一迁移验证通过 |
| G3 Backend & Observability | 可维护后端与可观测性 | 模块边界解耦、async/await 普及、统一 schema 输入校验、结构化日志与核心回归套件稳定 |
| G4 Frontend | 现代前端 | Vue 3 功能平价；旧 Vue 1/Gulp/多页模板可删除 |
| G5 Delivery | 可发布/可回滚 | GHCR、多架构镜像、版本化、备份恢复、发布检查完成 |
| G6 Product | 开始产品增强 | 重构债务归零或进入可控 backlog |

**硬规则：G1 未完成前，不启动 Vue 3 主迁移；G2 未完成前，不删除旧数据结构；G4 未完成前，不改变默认用户工作流。**

---

# Phase 0 — Baseline 与仓库治理

## 0.1 目标

先保证“我们知道什么叫正常”，否则后续所有重构都无法判断是否破坏行为。

## 0.2 工作项

### RF-001：建立主分支门禁

建议分支：`ci/master-protection-baseline`

- 为 `master` 启用 branch protection/ruleset。
- 禁止直接 push 到 `master`。
- PR 必须通过 required checks。
- 至少要求当前 `Pull request validation` 成功。
- 禁止有 unresolved review conversation 时合并。
- 保持 `master` 为唯一长期主线，不新增长期 `develop` 分支。

### RF-002：验证并固定 CI 基线

建议分支：`ci/baseline-validation`

要求 PR 验证固定执行：

```text
npm ci
npm run build
npm test
docker build .
docker compose up --build -d
healthcheck
register
login
profile
docker compose down -v
```

补充：

- 让 docs-only PR 可以跳过重型 Docker job，但仍运行 Markdown/link 检查。
- 代码、Docker、依赖和 workflow 变化必须运行完整验证。
- CI 失败时自动输出 compose logs。

### RF-003：建立运行时契约

建议分支：`ops/runtime-contract`

- 固定一个明确支持的 Node LTS 版本（锁定为 Node 20 LTS，与 CI 及 Dockerfile 统一）。
- 明确 MongoDB 支持范围（锁定为 MongoDB 5.0+）。
- `NODE_ENV=production` 时缺失 `SESSION_SECRET` 必须启动失败。
- 新增 `/api/health/live` 与 `/api/health/ready`：
  - live：进程可响应。
  - ready：MongoDB 可访问，必要持久化目录可用。
- 保留旧 `/api/healthcheck` 一段兼容期，再标记 deprecated。
- 增加 graceful shutdown：停止接收连接、关闭 Mongo client、退出。

### RF-004：App 工厂化与 HTTP 测试基座

建议分支：`test/app-factory-harness`

- 将当前 `app.js` 中 Express 应用实例化与 `MongoClient.connect` / `app.listen` 解耦，拆出 `createApp(config)` 工厂函数。
- 引入 `supertest` 作为 `devDependencies`，搭建针对 Express 路由与中间件的集成测试脚手架。
- 解决 G1 安全测试与后端重构的时序死锁，使得 Phase 1 的各项安全测试能够直接使用 `request(app)` 编写高保真回归用例，无需真实监听外部端口或提前进入深层分层重构。

## 0.3 Gate G0 验收

- [ ] 新 clone 可完成 `npm ci && npm run build && npm test`。
- [ ] `createApp` 可在测试环境下直接被 `supertest` 引用，无隐式端口监听与孤儿句柄。
- [ ] `docker compose up --build -d` 后 readiness 成功。
- [ ] 登录 smoke test 成功。
- [ ] `master` 无法绕过 PR required checks。
- [ ] 基线失败时不得进入 Phase 1 以外的大规模改动。

---

# Phase 1 — Security Stabilization

这是整个计划中优先级最高的阶段。

## 1.1 Auth 与 Session

### RF-101：账户输入与注册策略

建议分支：`security/auth-registration`

实施：

- 新注册 username 做规范化与严格校验。
- 旧账户兼容，不因为新规则自动失效。
- password 设置最小长度和最大长度，避免极短密码与异常超长输入。
- email/displayName 做长度和类型约束。
- 增加：

```text
REGISTRATION_MODE=first-user | disabled | open
```

建议默认：

```text
production: first-user
development: open
```

`first-user` 表示仅允许创建第一个账户，之后关闭公开注册。

### RF-102：登录与 Session 强化

建议分支：`security/session-hardening`

- 不再通过 404/401 区分“用户不存在”和“密码错误”，统一认证失败响应。
- 登录接口增加 rate limit。
- Session ID 在成功登录后 regenerate，降低 session fixation 风险。
- HTTPS 场景开启 secure cookie。
- 正确配置 reverse proxy `trust proxy`。
- 保持 `httpOnly=true`。
- 重新评估 `sameSite=strict` 对公开分享/反向代理场景影响。
- 移除不必要的全开放 `cors()`；默认同源访问。
- 如果未来必须跨域，则改为显式 allowlist + credentials policy。

验收：

- [x] 不存在用户与错误密码表现一致。
- [x] 暴力登录会被限速。
- [x] 登录前后的 session id 不相同。
- [x] 生产环境无 SESSION_SECRET 无法启动。

---

## 1.2 SSRF

### RF-103：关闭不安全的 URL 自动探测

建议分支：`security/ssrf-hardening`

当前 Notes 会触发服务端对正文 URL 发出 HEAD 请求。第一步不要尝试“边补边继续开放”，先建立安全默认值：

```text
URL_ENRICHMENT_ENABLED=false
```

生产环境默认关闭 outbound URL enrichment。

第二步如果保留自动识别远程图片功能，必须把它移入单独的受控模块，并满足：

- 仅允许 `http:` / `https:`。
- 拒绝 localhost、loopback、link-local、private、reserved IPv4/IPv6。
- DNS 解析后检查目标地址。
- 每次 redirect 都重新校验目标。
- 限制 redirect 次数。
- 设置短连接/总超时。
- 单条 Note 限制自动探测 URL 数量。
- 不转发用户 Cookie、Authorization、内部 Header。
- 失败必须降级为普通链接，而不是保存失败。

必须新增安全回归测试：

```text
http://127.0.0.1
http://localhost
http://169.254.169.254
RFC1918 private addresses
IPv6 loopback/private/link-local
public URL -> private redirect
```

Gate：上述目标全部被拒绝，正常公网 URL 不影响 Note 保存。

---

## 1.3 Attachment / Upload

### RF-104：附件授权修复

建议分支：`security/attachment-authorization`

核心规则：

> “知道文件名”永远不能等同于“有权下载文件”。

要求：

- 私有附件：仅 owner session 可访问。
- Public/Shared Note 的附件：先加载 Thing，再确认：
  1. Thing 属于目标 user；
  2. Thing 处于 public/shared 状态；
  3. 请求的 attachment identifier 确实存在于该 Thing 的 `attachments[]`。
- `/api/public/:userId/files/:fileId` 不允许继续绕过 Thing 权限模型：
  - 删除；或
  - 迁移为基于 thingId + attachmentId 的授权接口。
- 非法 attachmentId、thingId、userId 不泄露物理文件路径。

### RF-105：Upload 限制

建议分支：`security/upload-limits`

- 禁止无限制 `.any()` 上传。
- 配置单次文件数量限制。
- 配置单文件大小限制。
- 配置 import archive 独立大小限制。
- 文件名只用于显示，不参与存储路径。
- storage key 改为服务端生成的 opaque UUID/random id。
- MIME 仅作为提示，不作为可信安全依据。
- 对 image inline preview 建立明确允许类型。
- 上传失败后清理临时文件。

验收至少覆盖：

- [x] 用户 A 无法读取用户 B 私有附件。
- [x] Public Thing 只能暴露属于它自己的附件。
- [x] 猜到 storage key 不能绕过 authorization。
- [x] 超限文件返回 413/明确错误，不导致进程 OOM。

---

## 1.4 Import / Export

### RF-106：Import 安全与一致性

建议分支：`security/import-hardening`

- 等待 tar extractor 真正完成后再读取 `things.json`。
- 解压到独立 temp directory，再经过校验后搬入用户 storage。
- 拒绝 absolute path、`..` path traversal、symlink/hardlink 等危险 entry。
- 限制 archive 总大小、entry 数量、单 entry 大小。
- 校验 `things.json` schema，而不只检查 `things` 是否为 array。
- Import 失败不得留下部分写入的数据或孤儿附件。
- Import 完成后输出：计划导入数量、成功数量、失败数量。

### RF-107：Export 作为迁移安全网

建议分支：`test/export-roundtrip`

建立 round-trip 测试：

```text
create user
create notes + tags + attachments
export
new empty instance/user
import
compare core data
```

## 1.5 Gate G1 验收

- [x] Auth 安全测试全绿。
- [x] SSRF 私网与 redirect 测试全绿。
- [x] Attachment authorization 测试全绿。
- [x] Upload limits 生效。
- [x] Import path traversal 与 partial-write 测试全绿。
- [x] Export/Import round-trip 可重复执行。

**G1 未通过，不启动 Vue 3 主迁移。**

---

# Phase 2 — Identity 与 Data Model

## 2.1 目标模型

### users

```text
users
  _id            ObjectId/UUID
  username       string
  usernameNorm   string unique
  displayName    string
  email          string
  passwordHash   string
  createdAt      timestamp
  status         active/disabled
```

### things

```text
things
  _id
  ownerId
  content
  createdAt
  modifiedAt
  tags[]
  externalContent[]
  attachments[]
  public
  shared
  archived
  sticky
```

附件 metadata 初期继续嵌在 Thing 中，避免为了重构引入不必要的额外 collection；但 attachment 必须拥有独立 opaque `id/storageKey`。

## 2.2 RF-201：抽象 UserRepository

建议分支：`refactor/user-repository`

先不迁数据，只改变调用边界：

```text
routes/services
      │
 UserRepository
      │
LegacyFileUserRepository
```

目标：HTTP/业务代码不再直接读 `.users.json`。

验收：现有用户行为完全不变，原测试保持通过。

## 2.3 RF-202：Mongo User Repository + 用户迁移

建议分支：`refactor/users-to-mongodb`

增加迁移命令，示例：

```text
node scripts/migrate-users-to-mongo.js --dry-run
node scripts/migrate-users-to-mongo.js --apply
node scripts/migrate-users-to-mongo.js --verify
```

迁移要求：

1. dry-run 不写数据库。
2. 检测 username collision/normalization collision。
3. passwordHash 原样迁移，不重新计算密码。
4. apply 必须幂等。
5. verify 校验 source/target 用户数量及关键字段。
6. 切换后保留 `.users.json` 作为只读回滚材料一段兼容期。
7. 回滚期间不允许双写造成两个用户源分叉。

切换完成后：

```text
UserRepository -> MongoUserRepository
```

## 2.4 RF-203：引入稳定 userId

建议分支：`refactor/stable-user-id`

- Session 保存 `userId`，username 仅作为显示/登录属性。
- Attachment path 不再使用 username。
- 新增数据一律使用 `ownerId`。
- URL 中暂时保留 username 时，在 HTTP 层解析 username → userId。

## 2.5 RF-204：统一 Things、Tags、Settings 集合

建议分支：`refactor/unified-collections`

当前系统中不仅 `things` 采用了 `<username>_things`，`tags`（`<username>_tags`，见 `src/database/tags.js`）与 `settings`（`<username>_settings`，见 `src/database/settings.js`）同样采用了按用户动态建表模式。本项将三者彻底收敛为带 `ownerId` 的统一集合：

1. **things 集合**：迁入单一 `things` 集合，增加 `ownerId`。
2. **tags 集合**：迁入单一 `tags` 集合，文档为 `{ ownerId, name, usage }`，建立复合索引 `{ ownerId: 1, name: 1 }`。
3. **settings 集合**：迁入单一 `settings` 集合，建立唯一索引 `{ ownerId: 1 }`。

现有集合不直接删除，采用 shadow migration：

```text
legacy collections (<user>_things, <user>_tags, <user>_settings)
      │
      ├─ dry-run enumerate/count across all users
      ├─ copy -> unified collections (ownerId=...)
      ├─ verify counts/checksums
      └─ cutover database layer
```

迁移命令建议：

```text
node scripts/migrate-data-to-v2.js --dry-run
node scripts/migrate-data-to-v2.js --apply
node scripts/migrate-data-to-v2.js --verify
```

索引至少包括：

```text
things:
  ownerId + modifiedAt
  ownerId + sticky + modifiedAt
  ownerId + archived + modifiedAt
  text(content)
tags:
  ownerId + name (unique compound)
settings:
  ownerId (unique)
```

注意：Mongo text index 与 owner filter 的最终索引方案必须用真实数据验证后确定，不在迁移 PR 中做无依据优化。

## 2.6 数据迁移标准操作流程

任何真实生产数据迁移都必须按以下顺序：

```text
1. Export Meemo application archive
2. Backup MongoDB
3. Backup persistent /app/data
4. dry-run
5. review migration report
6. apply
7. verify counts + representative data
8. start new code
9. smoke test login/search/attachment/share/export
10. keep legacy source read-only during rollback window
```

任一步数量不一致：停止切换，不得“先上线再观察”。

## 2.7 Gate G2 验收

- [x] 新用户完全存储在 MongoDB。
- [x] 业务层不直接读取 `.users.json`。
- [x] Session 使用稳定 userId。
- [x] 新附件路径不包含 username。
- [x] Things、Tags、Settings 全部使用统一集合 + ownerId。
- [x] 用户与业务数据 migration 均支持 dry-run/apply/verify。
- [x] 迁移失败可回滚到旧数据源。

---

# Phase 3 — Backend Modernization

此阶段才开始真正“整理代码”，而不是用重构掩盖安全问题。

### 3.1 RF-301：运行时依赖注入与优雅停机完善

建议分支：`refactor/runtime-lifecycle`

在 RF-004 已建立的 `createApp` 基础上，进一步完善生命周期与外部资源治理：

- 显式管理 MongoClient 生命周期与连接池。
- timer/cleanup worker（如 `logic.cleanupTags`）改为显式注入，支持受控启停。
- 完善 SIGTERM/SIGINT 信号捕获：拒绝新连接、等待在途请求、关闭数据库连接、退出。
- 启动异常返回非 0 退出码。

## 3.2 RF-302：按领域拆分路由与统一输入验证

实施状态：已完成（领域路由、Zod 请求校验、统一安全错误响应）。

建议分支：`refactor/http-modules`

按业务领域拆分 `routes.js`：

```text
http/routes/auth
http/routes/things
http/routes/files
http/routes/settings
http/routes/public
http/routes/health
```

同时建立统一 schema validation（使用轻量成熟 schema 库，如 Zod），在进入业务层前对输入完成校验，统一错误映射：

```text
400 invalid_request
401 authentication_required / invalid_credentials
403 forbidden
404 not_found
409 conflict
413 payload_too_large
429 too_many_requests
500 internal_error
```

API 路由层不直接访问底层数据库驱动，不向客户端输出原始 stack、Mongo 错误或内部物理路径。

## 3.3 RF-303：Service 业务层解耦

实施状态：已完成（HTTP → Service → Database/Storage 边界落地，移除旧 `src/logic.js`）。

建议分支：`refactor/service-layer`

解耦原 `src/logic.js`，按功能提炼纯粹的业务服务，直接依赖 `database/` 与 `storage/`，避免为了分层而额外引入一层单一实现的 Repository 样板：

核心 Service：

```text
AuthService
ThingService
AttachmentService
SharingService
ImportExportService
```

持久化与存储：

```text
database/
  users.js
  things.js
  tags.js
  settings.js
storage/
  local-storage.js
```

## 3.4 RF-304：callback → async/await 现代化

实施状态：已完成（运行时、数据库、存储、Service 与 HTTP 主链路均为 Promise-first；仅保留旧调用方的 callback 兼容桥）。

建议分支：`refactor/async-await`

从旧式 Node 回调全面演进为原生 `async/await`，彻底消除回调地狱与未捕获 promise rejection：

迁移顺序：

```text
database / storage
       ↓
    services
       ↓
  http routes
```

保持按领域模块小步演进，每个 PR 提交前确保已有单元与 HTTP 测试全绿。

## 3.5 RF-305：API 契约文档与渐进类型声明

实施状态：已完成（OpenAPI 3.0 权威规范 docs/openapi.yaml、渐进类型声明 types/api.d.ts 及契约一致性测试 src/test/api-contract-test.js 已建立）。

建议分支：`refactor/api-contract-and-types`

- 新增一份权威 API 契约文档（OpenAPI 3.0 / JSON Schema）。
- 契约至少覆盖：
  ```text
  /api/register, /api/login, /api/logout, /api/profile
  /api/things (CRUD, search, tags)
  /api/files (upload, download)
  /api/settings
  /api/export, /api/import
  /api/public/*, /api/rss/*
  /api/health/live, /api/health/ready
  ```
- 渐进引入类型约束（优先使用 JSDoc / TS 声明文件对核心领域对象与 API Req/Res 进行类型标注，供前后端参考，避免给 1,400 行原生后端强加沉重的转译构建工具链）。
- 新前端只面向这份 API 契约开发。

---

# Phase 4 — Test、Observability 与运行可靠性

测试不是单独最后补；每一个前序 PR 都必须增加对应测试。本阶段负责把测试和运行能力系统化并固化为长效门禁。

## 4.1 测试分层

```text
Unit
  extractTags / URL policy / validation / storage path

Integration
  service + MongoDB
  auth/session
  import/export

API contract
  full HTTP handlers (supertest)

Container smoke
  Docker + Mongo + register/login/profile
```

优先覆盖风险，不追求虚假的 coverage 百分比。

## 4.2 必须长期保留的安全回归场景

- 无 SESSION_SECRET 的 production 启动失败。
- 登录暴力尝试被限流。
- session fixation 防护。
- 非 owner 私有 Thing 读取失败。
- 非 owner 私有附件读取失败。
- Public Thing 不能读取不属于它的附件。
- SSRF localhost/private/link-local/redirect 被拦截。
- oversized upload/import 被拒绝。
- archive path traversal 被拒绝。
- malformed ObjectId/ID 不造成 500。
- export/import round-trip。

## 4.3 Observability 规范

增加轻量结构化日志（如 pino），至少记录：

```text
requestId
method/path
status
duration
userId (authenticated only; avoid sensitive details)
error code
```

严禁记录：

```text
password
passwordHash
session secret
session cookie
note body
attachment body
imported archive content
```

Readiness 中明确检查 MongoDB；业务指标只增加低基数指标，不把 username/tag 当 metric label。

## 4.4 PR 实施项

### RF-401：结构化日志与可观测性基建

实施状态：已完成（已实现轻量结构化日志中间件 src/http/middleware/logger.js，支持 requestId 追踪、耗时统计与敏感字段脱敏）。

建议分支：`ops/structured-logging`

- 引入轻量级结构化日志中间件（建议 pino/pino-http）。
- 自动为所有 HTTP 请求生成并在上下文中传递 `requestId`。
- 记录请求耗时、状态码、安全脱敏后的用户标识，统一未捕获错误日志记录。
- 确保敏感字段（密码、凭据、正文）自动过滤或阻断。

### RF-402：核心安全与业务回归自动化套件

实施状态：已完成（已实现统一核心安全回归套件 src/test/security-regression-suite-test.js，固化 11 项核心场景并接入自动化门禁保持全绿）。

建议分支：`test/security-regression-suite`

- 将 4.2 节列出的 11 项必须长期保留的安全场景全部编写为自动化回归用例。
- 固化 Export -> Import round-trip 端到端验证。
- 将安全回归套件接入 GitHub Actions 作为必跑 check，任何安全边界退化立即打断 CI。

## 4.5 Gate G3 验收

- [x] `createApp` 可被测试代码创建/销毁，无隐式 listen 或孤儿连接。
- [x] 路由层不直接访问底层 Mongo/FS，全流程经过 schema validation。
- [x] 错误响应格式统一且不泄露底层堆栈与路径。
- [x] 核心流程已完成 `async/await` 改造。
- [x] 结构化日志上线且严格遵守敏感信息过滤规则。
- [x] 11 项核心安全回归套件全部加入自动化门禁并保持全绿。
- [x] API 契约文档与实际行为一致。

---

# Phase 5 — Vue 3 + Vite + TypeScript 前端迁移

## 5.1 迁移策略：Strangler Frontend

建议新目录：

```text
web/
```

旧 `frontend/` 保持可构建，直到新前端功能平价。

新栈：

```text
Vue 3
Vite
Vue Router
TypeScript
Composition API
modern markdown renderer + maintained sanitizer (DOMPurify)
```

关键架构决策：

1. **统一 SPA 路由替代多页面 HTML 模板**：当前旧前端采用 `index.html`、`stream.html`（公开流）、`shared.html`（公开单篇）等分散模板。新前端采用单 SPA + Vue Router 架构，统一由路由接管主应用与公开页面（如 `/public/:userId` 与 `/shared/:thingId`），后端生产环境将公开页面入口路由回退给 SPA 宿主，彻底废弃孤立的 HTML 文件与后端直接 `res.sendFile('stream.html')` 的紧密耦合。
2. **Markdown 双端一致性与 XSS 防护**：前端采用现代 Markdown 解析器配合 DOMPurify 严密清洗；后端 RSS 描述生成与文本摘要遵循同源过滤规则，彻底杜绝存储型 XSS 漏洞。
3. **轻量状态管理**：优先基于 Vue 3 响应式组合式函数（Composables），仅在真实需要时引入额外状态库。

## 5.2 PR 序列

### RF-501：前端工程骨架与路由体系

实施状态：已完成（已搭建 web/ 下的 Vue 3 + Vite + TypeScript 骨架、Vue Router 路由体系、Markdown/DOMPurify 清洗基座、API 客户端与 Docker 多阶段构建）。

分支：`frontend/vue3-foundation`

- Vite build 与 TypeScript 配置。
- Vue Router 搭建（覆盖主记事界面、公开笔记流 `/public/:userId`、单篇共享 `/shared/:thingId`）。
- Markdown 渲染与 DOMPurify 统一清洗基座。
- API client 封装与全局 error handling。
- development proxy 配置。
- Docker builder 支持多阶段构建新 web，但暂不切默认入口。

### RF-502：Auth Shell

实施状态：已完成（已实现 useAuth 组合式函数、LoginModal 弹窗、用户 Profile 下拉与登出、首用户检测与注册流引导、401 Session 过期拦截与顶部横幅提醒）。

分支：`frontend/vue3-auth`

实现：

```text
login
logout
profile
first-user registration flow
session expiration handling
```

### RF-503：Notes Read Path

实施状态：已完成（已实现 useNotes 组合式函数、NoteCard 卡片流与附件/徽标、TagSidebar 标签云过滤、全文检索与 Enter 快捷触发展示、Active/Archive 视图双向切换、IntersectionObserver 无限加载/分页）。

分支：`frontend/vue3-notes-read`

实现：

```text
list
pagination/load more
search
tags
sticky
archive view
markdown rendering
```

### RF-504：Notes Write Path

实施状态：已完成（已实现 NoteComposer 快速发帖组件、NoteCard 行内卡片编辑与保存/取消、永久删除二次确认弹窗、置顶/取消置顶切换、公开/私有切换、归档/取消归档双向流转与 Ctrl+Enter / Ctrl+S 键盘快捷保存）。

分支：`frontend/vue3-notes-write`

实现：

```text
create
edit
save/cancel
delete
archive/restore
sticky toggle
public/shared toggle
keyboard save
```

### RF-505：Attachment / Settings / Import Export

分支：`frontend/vue3-feature-parity`

实现：

```text
file upload
image preview
attachment link
settings
import
export
public stream
RSS links
```

### RF-506：切换默认前端

分支：`frontend/vue3-cutover`

只有 Feature Parity Matrix 全绿后才允许：

- Docker 默认构建 `web/`。
- 删除 Vue 1 runtime。
- 删除 Gulp。
- 删除 jQuery（若新前端无依赖）。
- 删除 vendored Bootstrap/legacy sanitizer。
- 删除旧 `frontend/`。
- 更新 README、ARCHITECTURE、AGENTS。

## 5.3 Feature Parity Matrix

| 能力 | Legacy | Vue 3 | Cutover 必须 |
|---|---:|---:|---:|
| Login/logout | ✓ | [ ] | ✓ |
| Register/first-user | ✓ | [ ] | ✓ |
| Create/edit/delete | ✓ | [ ] | ✓ |
| Search | ✓ | [ ] | ✓ |
| Tags | ✓ | [ ] | ✓ |
| Sticky | ✓ | [ ] | ✓ |
| Archive/restore | ✓ | [ ] | ✓ |
| Markdown | ✓ | [ ] | ✓ |
| Attachment upload/read | ✓ | [ ] | ✓ |
| Public/share | ✓ | [ ] | ✓ |
| Settings | ✓ | [ ] | ✓ |
| Import/export | ✓ | [ ] | ✓ |
| Public stream | ✓ | [ ] | ✓ |
| RSS | ✓ | [ ] | ✓ |

## 5.4 Gate G4 验收

- [ ] Feature Parity Matrix 全绿。
- [ ] 新前端构建进入 CI。
- [ ] 旧 Vue 1/Gulp 不再参与 production build。
- [ ] 旧 vendor JS/CSS 可以安全删除。
- [ ] Docker smoke test 全部基于新前端/新后端。

---

# Phase 6 — Docker、Release 与运维能力

## 6.1 RF-601：镜像发布

建议分支：`release/ghcr-pipeline`

目标标签策略：

```text
master -> ghcr.io/on195594/meemo:edge
release vX.Y.Z -> :vX.Y.Z + :X.Y + :latest
```

要求：

- `linux/amd64`
- `linux/arm64`
- OCI labels 使用真实 commit/version。
- 镜像与 release 一一对应。
- 构建 provenance/SBOM。
- release job 真正 push，而不是只在 runner 本地 build。

## 6.2 RF-602：部署安全默认值

- 容器继续 non-root。
- 评估 read-only root filesystem。
- writable 目录只保留 data/tmp。
- Compose 明确 production 必填 `SESSION_SECRET`。
- APP_ORIGIN 必须与真实 public origin 一致。
- MongoDB 不暴露宿主机端口。
- MongoDB 升级到当前支持版本必须独立 PR，不能与 data model migration 同时进行。

## 6.3 RF-603：Backup / Restore Runbook

新增 `docs/BACKUP_RESTORE.md`，至少覆盖：

```text
MongoDB backup
/app/data backup
restore to clean instance
version compatibility
verify after restore
```

发布前至少实际执行一次 clean restore smoke test。

## 6.4 Gate G5 验收

- [ ] Release 能生成并 push multi-arch 镜像。
- [ ] 已发布镜像可通过 immutable tag 回滚。
- [ ] backup/restore 文档经过实际演练。
- [ ] production config 缺失关键 secret 会 fail fast。
- [ ] readiness 能检测依赖不可用。

---

# Phase 7 — 重构完成后的产品路线（不属于重构阻塞项）

只有 G5 通过后再启动：

1. PWA / Add to Home Screen。
2. 极简 Quick Capture 页面。
3. Mobile share target。
4. Browser clipper；如需 API token，应重新设计 scoped token，而不是恢复旧 legacy token。
5. Search ranking 改进。
6. Optional semantic search。
7. Optional AI enrichment：自动 title、tag、摘要、相似笔记、weekly review。
8. AI Provider 必须可选，可支持 OpenAI/Claude/Gemini/Ollama；关闭 AI 时 Meemo 核心能力完整可用。

产品定位保持：

> 一个极快、极轻、隐私优先、自托管的个人信息 Inbox，而不是另一个 Notion。

---

# 8. 建议 PR 执行队列

以下顺序可直接转成 GitHub Issues/Milestones：

| 顺序 | ID | 建议分支 | 内容 | 依赖 |
|---:|---|---|---|---|
| 1 | RF-001 | `docs/refactoring-roadmap` | 本路线图 | 无 |
| 2 | RF-002 | `ci/baseline-validation` | CI/required checks 基线 | RF-001 |
| 3 | RF-003 | `ops/runtime-contract` | runtime、health/readiness、shutdown | RF-002 |
| 4 | RF-004 | `test/app-factory-harness` | App 工厂化 (createApp) 与 HTTP 测试基座 | RF-003 |
| 5 | RF-101 | `security/auth-registration` | 注册与输入安全 | RF-004 |
| 6 | RF-102 | `security/session-hardening` | session/rate-limit/CORS | RF-101 |
| 7 | RF-103 | `security/ssrf-hardening` | outbound URL policy | RF-004 |
| 8 | RF-104 | `security/attachment-authorization` | 附件授权 | RF-004 |
| 9 | RF-105 | `security/upload-limits` | 上传安全 | RF-104 |
| 10 | RF-106 | `security/import-hardening` | Import 安全 | RF-004 |
| 11 | RF-107 | `test/export-roundtrip` | Export/Import round-trip | RF-106 |
| 12 | RF-201 | `refactor/user-repository` | UserRepository 抽象 | G1 |
| 13 | RF-202 | `refactor/users-to-mongodb` | 用户迁 Mongo | RF-201 |
| 14 | RF-203 | `refactor/stable-user-id` | 稳定 userId | RF-202 |
| 15 | RF-204 | `refactor/unified-collections` | Things、Tags、Settings 统一集合模型与迁移 | RF-203 |
| 16 | RF-301 | `refactor/runtime-lifecycle` | 运行时依赖注入与优雅停机完善 | G2 |
| 17 | RF-302 | `refactor/http-modules` | 路由拆分与统一输入校验 | RF-301 |
| 18 | RF-303 | `refactor/service-layer` | 核心 Service 业务层解耦 | RF-302 |
| 19 | RF-304 | `refactor/async-await` | 全流程 async/await 现代化 | RF-303 |
| 20 | RF-305 | `refactor/api-contract-and-types` | API 契约文档与渐进类型声明 | RF-304 |
| 21 | RF-401 | `ops/structured-logging` | 结构化日志与请求上下文 | RF-304 |
| 22 | RF-402 | `test/security-regression-suite` | 核心安全与业务回归自动化套件 | RF-401 |
| 23 | RF-501 | `frontend/vue3-foundation` | Vue 3/Vite/TS/Router 骨架与清洗基座 | G3 |
| 24 | RF-502 | `frontend/vue3-auth` | Auth shell | RF-501 |
| 25 | RF-503 | `frontend/vue3-notes-read` | Read path | RF-501 |
| 26 | RF-504 | `frontend/vue3-notes-write` | Write path | RF-503 |
| 27 | RF-505 | `frontend/vue3-feature-parity` | Attachments/settings/public | RF-502/504 |
| 28 | RF-506 | `frontend/vue3-cutover` | 删除 legacy frontend 与多页模板 | RF-505 |
| 29 | RF-601 | `release/ghcr-pipeline` | GHCR/multi-arch/SBOM | G4 |
| 30 | RF-602 | `ops/production-hardening` | production defaults | RF-601 |
| 31 | RF-603 | `docs/backup-restore` | backup/restore 演练 | RF-602 |

说明：Phase 1 中相互独立的 Security PR 可以并行开发，但必须保持 PR 小而独立；数据迁移 PR 按表中顺序串行执行。

---

# 9. 每个 PR 的 Definition of Done

所有 PR 合并前必须检查：

- [ ] Scope 单一，无无关格式化/重命名。
- [ ] `npm run build`（涉及前端时）通过。
- [ ] `npm test`（涉及后端/数据/安全时）通过。
- [ ] Docker build（涉及部署或跨层行为时）通过。
- [ ] 对非平凡行为新增/更新 focused test。
- [ ] 安全行为没有通过“关闭校验”来换取兼容。
- [ ] 影响配置时更新 README。
- [ ] 影响组件边界时更新 `docs/ARCHITECTURE.md`。
- [ ] 影响 agent 工作方式时更新 `AGENTS.md`。
- [ ] 影响数据结构时提供 migration + rollback。
- [ ] 影响 public API 时更新 API 契约。
- [ ] 不记录 password/hash/session secret/private note 内容。
- [ ] Commit message 使用短 imperative / Conventional Commit 风格。

---

# 10. 数据迁移 Stop Conditions

出现以下任何情况必须停止上线，而不是继续观察：

- source/target 用户数量不一致。
- source/target Thing、Tag、Setting 数量不一致且无法解释。
- representative attachment 无法读取。
- login 成功但用户映射到错误 ownerId。
- public/private flag 迁移结果不一致。
- export → import round-trip 不一致。
- migration 不是幂等的。
- rollback 只能通过删除新数据才能完成。

---

# 11. 前端切换 Stop Conditions

以下任一能力未达到 legacy parity，则 `web/` 不得成为默认 production frontend：

- 登录/退出。
- 创建/编辑/删除 Note。
- Search/Tag/Sticky/Archive。
- Attachment 上传和查看。
- Public/Shared 行为。
- Settings。
- Import/Export。
- Public stream/RSS。
- 手机端基本可用性。

视觉变化不是阻塞项，行为兼容是阻塞项。

---

# 12. ADR（Architecture Decision Record）建议

在 `docs/adr/` 记录不可轻易反转的决定：

```text
0001-user-identity-and-storage.md
0002-unified-mongodb-collections.md
0003-outbound-network-ssrf-policy.md
0004-api-error-contract.md
0005-vue3-vite-frontend.md
0006-container-release-strategy.md
```

ADR 只记录“为什么选这个方案”和“放弃了什么”，不重复实现文档。

---

# 13. 完成定义：什么时候可以宣布 Meemo 2.0 重构结束

必须同时满足：

- [ ] G0–G5 全部通过。
- [ ] `.users.json` 不再是生产账户数据源。
- [ ] username 不再作为文件路径或 collection identity。
- [ ] Things、Tags、Settings 彻底收敛为统一集合，不再按用户动态建表。
- [ ] SSRF policy 有自动化安全回归测试。
- [ ] Attachment 权限绑定 Thing/owner，而不是文件名保密性。
- [ ] Import/Export 具备 round-trip 测试。
- [x] 后端业务边界不再集中于单个 `routes.js` / `logic.js`。
- [ ] 关键后端代码具备清晰输入校验与 API 契约文档。
- [ ] Vue 1、Gulp、jQuery、legacy vendored sanitizer 及旧多页模板已从 production build 移除。
- [ ] Docker image 可从 release 重新构建并通过版本标签回滚。
- [ ] Backup/Restore 实际演练成功。
- [ ] README、ARCHITECTURE、AGENTS 与代码现实一致。

达到这些条件后，才把后续 PWA、Quick Capture、Browser Clipper、Semantic Search、AI enrichment 当作产品迭代，而不是继续把它们混在“重构”名义下。

---

# 14. 立即开始时的第一组动作

如果今天开始执行，只做下面这些，不碰 Vue 3：

```text
A. 合并本路线图
B. 建立 master required checks / branch protection
C. 让当前 master 的 CI 真正跑通并保留可追踪 run
D. 实施 RF-004：解耦 createApp 并引入 supertest 搭建 HTTP 测试基座
E. 补 Auth/SSRF/Attachment/Import 安全回归测试
F. 依次修复 SSRF、Attachment authorization、Upload、Import
G. 完成 Gate G1 后再启动数据模型迁移
```

第一阶段的目的不是“代码更漂亮”，而是把 Meemo 变成一个可以放心继续重构的系统。
