# Meemo 长期架构规范

> **文档性质**：长期、规范性（Normative）架构约束
> **适用仓库**：`on195594/meemo`
> **基线版本**：`master@600acf4e1048e1e4129268758349ffc1cc59ccb3`
> **制定日期**：2026-09-16
> **建议路径**：`docs/LONG_TERM_ARCHITECTURE.md`

---

## 0. 文档定位

本文件定义 Meemo 在未来持续演进时应遵守的**长期架构边界、设计原则和复杂度预算**。

它回答的是：

> **以后新增功能、重构代码、接入 AI、替换存储、扩大用户规模时，什么可以变，什么不能轻易变。**

它不取代：

- `docs/ARCHITECTURE.md`：描述“当前系统实际上怎么工作”。
- `docs/openapi.yaml`：描述“当前 HTTP API 契约”。
- `docs/BACKUP_RESTORE.md`：描述“如何备份和恢复生产数据”。
- `docs/RELEASE_CHECKLIST.md`：描述“如何执行一次具体发布”。
- `AGENTS.md`：描述“编码 Agent 如何在仓库中工作”。

推荐长期保持以下职责分离：

```text
ARCHITECTURE.md
    = Current Architecture / 当前事实

LONG_TERM_ARCHITECTURE.md
    = Architecture Constitution / 长期约束

openapi.yaml
    = Runtime API Contract / API 契约

AGENTS.md
    = Engineering Workflow / 工程执行规则
```

如果当前实现与本文件冲突：

1. 不要求立即为了“架构纯洁性”重写现有代码。
2. 新代码不得继续扩大冲突。
3. 在相关模块下一次被实质修改时，以最小改动逐步收敛。
4. 只有经过明确架构决策，才允许改变本文件中的核心约束。

---

# 1. 长期目标

Meemo 的长期目标不是成为一个“大型知识管理平台”。

Meemo 应长期保持为：

> **一个可自托管、数据可掌控、结构简单、长期可维护、可逐步增强的个人知识与笔记系统。**

系统优先级从高到低为：

1. **数据可靠**
2. **简单可维护**
3. **行为可预测**
4. **安全**
5. **可恢复**
6. **使用体验**
7. **性能**
8. **功能数量**
9. **架构先进性**

当“更先进的架构”和“更容易长期维护”发生冲突时，默认选择后者。

---

# 2. 核心架构结论

Meemo 长期采用：

> **Modular Monolith（模块化单体）**

而不是：

- 微服务
- 分布式服务网格
- 多数据库架构
- Event Sourcing
- CQRS
- Actor System
- 大型前端状态管理体系
- 完整 DDD 框架
- 重型 Design System 框架

长期推荐拓扑：

```text
                    Browser
                       │
                 Vue 3 SPA
                       │
                  HTTP / JSON
                       │
              ┌─────────────────┐
              │   Meemo Node    │
              │ Modular Monolith│
              └─────────────────┘
                 │           │
                 │           │
             MongoDB     Attachment Store
                            Filesystem
                               │
                      future optional adapter
                               │
                         S3-compatible
```

默认部署单元应继续是：

```text
Meemo Application
MongoDB
Persistent Attachment Storage
```

除非出现明确、可测量的实际问题，否则不得增加新的长期运行基础设施。

---

# 3. 架构原则

## 3.1 Simple First

新增架构组件前必须先回答：

> 现有模块真的无法可靠解决这个问题吗？

如果答案不是明确的“无法”，就不增加新组件。

默认禁止因为“以后可能会需要”而提前增加：

- Redis
- Kafka
- RabbitMQ
- Elasticsearch
- Vector Database
- 独立 Worker Service
- API Gateway
- Service Discovery
- Kubernetes 专用逻辑

架构应解决已经存在的问题，而不是预测未来问题。

---

## 3.2 Single Source of Truth

每类核心业务信息必须存在一个明确的在线事实源。

任何时候都不得存在两个可以独立修改、但系统又默认它们始终同步的事实源。

允许：

```text
Source of Truth
      │
      ├── cache
      ├── projection
      ├── search index
      └── derived view
```

禁止：

```text
Database A ←→ Database B
    两边都能改
    两边都被当作真相
```

---

## 3.3 Local Consistency Before Distributed Consistency

优先利用 MongoDB 单文档原子更新和清晰的数据模型解决一致性问题。

不得为了普通 CRUD 引入：

- 分布式锁
- 消息最终一致性
- Saga
- Outbox
- 跨服务事务

只有未来真正拆分部署单元后，才重新讨论这些机制。

---

## 3.4 Explicit Contracts

跨层边界必须有明确契约。

核心契约包括：

```text
Browser
   │
OpenAPI
   │
HTTP Validation
   │
Service
   │
Persistence
```

不得依赖“前端肯定不会传这个值”或“调用者应该知道”。

---

## 3.5 Backward Compatibility Has an Expiry Date

兼容层只能用于：

- 数据迁移
- 升级
- 有明确时间范围的回滚
- 历史数据验证

兼容代码不得永久升级为架构组成部分。

每一个 legacy adapter 都应该回答：

```text
为什么还存在？
谁还在调用？
什么条件满足后可以删除？
```

---

## 3.6 Operational Simplicity Is Architecture

对 Meemo 来说：

```text
能备份
能恢复
能验证
能理解
能单人维护
```

比“技术栈更现代”更重要。

一个功能如果显著增加恢复复杂度，其架构成本必须被明确考虑。

---

# 4. 代码层级规范

长期保持以下主边界：

```text
app.js
  │
  ▼
src/http/
  │
  ▼
src/services/
  │
  ├──────────────┐
  ▼              ▼
src/database/   src/storage/
```

前端：

```text
web/src/views/
      │
      ▼
web/src/components/
      │
      ▼
web/src/composables/
      │
      ▼
web/src/api/
```

---

## 4.1 `app.js`：Composition Root

`app.js` 负责：

- 启动
- 运行时依赖初始化
- MongoDB 生命周期
- Worker 生命周期
- HTTP server 生命周期
- graceful shutdown

它不应包含业务规则。

### 长期规则

新基础设施依赖应尽量从 composition root 创建并向下传递。

现有部分代码仍通过共享 `config` 持有运行时数据库引用，可以兼容保留，但：

> **新模块不应继续扩大对 mutable global state 的依赖。**

同时不引入 DI Container。

Meemo 规模不需要：

```text
Inversify
Nest dependency container
复杂 service locator
```

普通 factory 参数已经足够。

---

# 5. HTTP 层规范

目录：

```text
src/http/
```

职责：

- route registration
- authentication middleware
- request parsing
- Zod validation
- HTTP status
- public response shaping
- error mapping

HTTP 层不得：

- 直接写 MongoDB
- 直接访问 attachment filesystem
- 实现核心业务规则
- 复制 service 业务逻辑

标准路径：

```text
Request
  │
  ▼
Validation
  │
  ▼
Route Handler
  │
  ▼
Service
```

---

# 6. Service 层规范

目录：

```text
src/services/
```

Service 是 Meemo 的主要业务边界。

负责：

- 笔记行为
- 标签提取
- WikiLinks / rich-content 相关规则
- sharing
- import/export
- authentication behavior
- attachment behavior
- settings behavior

Service：

- MUST 不依赖 Express request/response
- SHOULD 使用 Promise-first API
- SHOULD 可以被单元或集成测试直接调用
- MUST 通过 database/storage adapter 操作外部状态

---

# 7. Domain 规则模块

Meemo 不需要建立大型 DDD 层。

只有满足以下条件时，才允许增加一个小型 domain module：

> 同一个业务 invariant 被两个以上边界重复定义。

典型例子：

```text
NoteColor
```

如果：

- HTTP validation
- import
- database
- frontend contract

都需要知道合法值，则应该提取统一定义。

允许：

```text
src/domain/note-colors.js
```

禁止因为一个 enum 就创建：

```text
domain/
entities/
aggregates/
repositories/
value-objects/
factories/
use-cases/
commands/
queries/
```

架构目标是**消除重复规则**，而不是追求 DDD 目录形式。

---

# 8. 数据架构

## 8.1 MongoDB 是唯一生产业务数据库

长期生产目标：

```text
MongoDB
```

承载：

- users
- sessions
- things
- settings
- 必要 projection

不得重新增加第二套业务数据库作为在线事实源。

---

# 9. Thing 是核心业务实体

长期来看，Meemo 的中心不是 Tag、Folder 或 Feed。

核心实体是：

```text
Thing
```

Thing 可以表达：

- note
- idea
- link
- bookmark
- task-like content

未来新增能力应优先考虑：

> 能否作为 Thing 的属性、关系或派生行为表达？

而不是快速创建新的平行数据模型。

---

# 10. Tag 数据权威

长期保持：

```text
things.tags
```

是在线 tag identity / usage 的事实源。

运行时获取 tag usage 应继续从 `things` 聚合。

持久化 `tags` collection：

> 只能是 projection / maintenance artifact。

不得重新让：

```text
things.tags
```

和：

```text
tags collection
```

同时成为可独立写入的业务真相。

### 长期简化方向

当历史迁移/retirement 完全结束，如果持久化 `tags` projection 不再提供明确运行价值：

**优先删除，而不是继续维护。**

---

# 11. User Identity

用户内部身份必须长期使用：

```text
stable userId
```

不得再次让：

```text
username
email
legacy collection prefix
```

承担主键角色。

Username 可以修改；内部 owner identity 不应因此改变。

---

# 12. Legacy User Repository

生产长期目标只有：

```text
MongoDB users
```

历史兼容模式：

```text
USERS_FILE
fallback repository
```

**现状更新**：`users-file.js` 和 `users-fallback.js` 现已彻底删除，`src/users.js` 统一仅保留 `MongoUserRepository` 作为运行期持久化实现；离线迁移脚本保留只读格式解析能力以备灾难恢复。禁止新增任何生产功能依赖 legacy user source。

---

# 13. Attachment 架构

当前：

```text
filesystem
```

仍然是合理的默认存储。

访问规则：

```text
HTTP
 │
Service
 │
Storage Adapter
 │
Filesystem
```

Route 不得绕过 `src/storage/`。

---

## 13.1 什么时候才考虑对象存储

只有出现下列真实需求之一，才考虑 S3-compatible storage：

- 多实例部署导致本地文件无法共享
- 主机迁移成为高频需求
- attachment 数据量明显超过单机管理能力
- 需要外部对象生命周期管理
- backup window 由于 attachment 规模成为实际瓶颈

引入 S3 时：

```text
Attachment Service
        │
Storage Interface
   ┌────┴────┐
Filesystem  S3
```

业务层不感知具体存储。

不得直接把 S3 SDK 调用散落到 routes/services。

---

# 14. API 架构

`docs/openapi.yaml` 长期保持：

> **公开 HTTP API 的唯一权威契约。**

API 改动必须形成：

```text
OpenAPI
   ↓
Generated Types
   ↓
Frontend Client
   ↓
Server Validation
   ↓
Tests
```

不得：

- 手工修改 generated API types
- 只改后端不改 OpenAPI
- 只改前端 interface 掩盖契约不一致

---

# 15. API 演进策略

优先：

- additive change
- optional property
- backward-compatible response

避免：

- 无必要 endpoint 重命名
- 无必要 REST 风格重构
- 为“更标准”而改稳定接口

如果未来产生破坏性 API：

优先考虑：

```text
/api/v2/
```

而不是同时在一个 endpoint 中维护大量行为分支。

但在没有真实外部客户端之前，不主动创建版本体系。

---

# 16. Frontend 长期架构

长期保持：

```text
Vue 3
TypeScript
Vue Router
Composable state
Vite
Vitest
```

当前规模不需要：

- Vuex
- Pinia
- Redux-style global store
- RxJS
- micro frontend

除非状态复杂度已经出现实际不可维护证据。

---

# 17. 前端状态权威

继续保持：

```text
URL route query
```

作为：

- search
- tag
- archive view

等可导航状态的事实源。

这样：

- refresh 可恢复状态
- URL 可分享
- back/forward 工作正常
- 页面状态不依赖隐藏内存

Session-scoped 状态继续由 composables 管理。

---

# 18. 前端请求一致性

必须继续防止：

> 前一个用户/前一个查询的慢响应覆盖当前状态。

当前 generation/request-generation 模式是合理的轻量方案。

在当前规模下不需要因此引入：

- React Query 类复杂缓存系统
- Redux middleware
- observable pipeline

---

# 19. Material Design 3 的长期定位

MD3 是：

> **设计原则和 Token 来源。**

MD3 不是：

> **必须完整引入的 UI framework。**

长期推荐：

```text
CSS semantic tokens
+
Vue native components
+
small shared constants
```

---

# 20. Design Token 规范

`web/src/styles/tokens.css` 应成为：

> 全局主题语义 Token 的唯一来源。

优先使用：

```text
--md-sys-color-primary
--md-sys-color-on-surface
--md-sys-color-on-surface-variant
--md-sys-color-surface-container
--md-sys-color-outline-variant
--md-sys-color-error
```

组件不得不断新增：

```text
#3182ce
#edf2f7
#718096
...
```

等业务硬编码颜色。

新增 Token 时，应按“语义”新增，而不是按“某个组件当前颜色”新增。

---

# 21. Note Color

Note Color 属于稳定 domain concept。

颜色值必须由统一 enum 管理。

合法值应在：

- API
- DB
- import/export
- frontend

具有一致语义。

未知值不得静默成为新的事实值。

推荐规则：

```text
missing
    => default

known color
    => preserve

unknown color
    => reject at external boundary
```

对于已经存在的历史脏值，可在读取时显式 normalize，但不得继续传播。

---

# 22. Dark Mode

所有新 UI 必须：

- 使用 semantic tokens
- 支持 dark mode
- 不依赖固定白背景
- 不依赖固定深色文本

Dark Mode 不应通过复制整套组件 CSS 实现。

应通过 Token 切换实现。

---

# 23. Accessibility

新增交互组件 SHOULD 满足：

- keyboard reachable
- visible focus
- semantic role
- meaningful aria-label
- touch target 接近 44–48px
- `prefers-reduced-motion`
- 不单独使用颜色表达关键状态

Color Picker、Dialog、Popover 等必须考虑 keyboard interaction。

---

# 24. 并发模型

在线普通写入应尽量保持：

```text
single-document atomic mutation
```

MongoDB `findOneAndUpdate` 等原子操作优先于：

```text
read
modify in memory
write
```

---

# 25. CAS 使用边界

当维护任务需要：

1. 读取 Thing
2. 推导修改
3. 写回

而期间用户可能同时修改内容时：

必须使用：

```text
compare-and-set
```

或等价条件更新。

不得覆盖并发用户修改。

当前 tag repair 的 CAS 模式应作为同类操作的参考。

---

# 26. 全局 Write Freeze

Write Freeze 是：

> migration / disaster-sensitive maintenance tool

不是日常在线写入机制。

不得在普通业务 CRUD 中增加：

- lease counter
- application-wide mutex
- maintenance lock dependency

只有：

- 数据迁移
- destructive maintenance
- production readiness verification

等需要全局一致快照的操作才允许使用 durable freeze。

---

# 27. Background Worker

当前 Worker 应继续保持：

- 同进程
- 少量
- 可关闭
- 不承担核心同步写路径

不得因为存在周期任务就立即引入：

- Redis queue
- BullMQ
- Celery-like worker tier
- Kafka consumer

只有当任务需要：

- 独立扩缩容
- durable retry
- 长时间运行
- 明确任务积压
- 与 Web 进程故障隔离

才重新评估独立 Worker。

---

# 28. Search

当前 MongoDB 搜索方案应继续作为默认。

搜索架构演进顺序：

```text
Mongo query
   ↓
Mongo indexes
   ↓
benchmark & optimize
   ↓
only if proven insufficient
external search engine
```

不得因为“搜索系统通常用 Elasticsearch”而直接引入 Elasticsearch。

`scripts/benchmark-search.js` 应继续用于用数据而不是直觉决定搜索架构。

---

# 29. Import / Export

Import / Export 是 Meemo 的核心数据主权能力，不是辅助功能。

长期要求：

- 导出格式可理解
- 导入严格校验
- path traversal 防护
- archive size limit
- attachment consistency
- rollback on partial failure
- old archive compatibility 有明确策略

任何新增 Thing 字段必须回答：

```text
是否需要 export？
是否需要 import？
旧 archive 缺少字段时默认是什么？
非法值如何处理？
```

---

# 30. Backup / Restore

一个新架构组件只有在回答：

> “如何和现有数据一起一致地备份、恢复和验证？”

之后才允许进入生产架构。

如果未来增加：

```text
Redis
S3
Search Index
Vector DB
```

必须先明确它属于：

```text
authoritative
```

还是：

```text
rebuildable
```

如果是 rebuildable：

> 不应让它扩大核心灾备集合。

---

# 31. Security

生产必须继续坚持：

```text
Mongo user source
server-side session
strong SESSION_SECRET
input validation
stable userId authorization
safe attachment paths
SSRF protection
```

不得为了开发便利降低生产 fail-closed 行为。

---

# 32. Secrets

Secrets：

- 不进入 Git
- 不进入日志
- 不进入导出 archive
- 不进入客户端 bundle
- 不作为 migration CLI 参数公开打印

未来 AI Provider Key 同样遵守此规则。

---

# 33. AI 能力的长期接入原则

AI 可以成为 Meemo 的重要增强能力，但：

> AI 不应成为核心数据架构的依赖。

即使所有 AI Provider 不可用，以下能力仍必须正常工作：

- 创建/编辑笔记
- 搜索
- WikiLinks
- tags
- attachment
- archive
- import/export
- backup/restore

---

# 34. AI 是 Optional Capability

推荐架构：

```text
Thing
  │
  ▼
AI Service Adapter
  │
  ├── OpenAI
  ├── Gemini
  ├── Local Model
  └── future provider
```

业务代码不得直接散落调用模型 SDK。

---

# 35. AI 输出不能静默成为事实

AI 自动生成：

- summary
- tags
- links
- title
- classification

应属于：

```text
derived suggestion
```

除非用户明确接受，否则不得覆盖用户原始笔记。

特别禁止：

```text
模型自动重写 content
并把它当成用户修改
```

---

# 36. Embedding / Vector Database

不得因为增加 AI 就默认增加 Vector DB。

演进顺序：

```text
现有 search
   ↓
AI query rewriting / reranking（可选）
   ↓
验证 semantic search 是否真的产生价值
   ↓
才评估 embedding
```

如果以后确实引入 embedding：

- embedding 必须可重建
- embedding 不得成为笔记事实源
- provider/model version 必须可识别
- 删除 Thing 后对应向量必须可清理

---

# 37. 外部集成

未来 Webhook、Agent、CLI、mobile client 应优先通过：

```text
HTTP API
```

接入。

不得让外部工具：

- 直接访问 MongoDB
- 直接修改 attachment filesystem
- 依赖内部 collection schema

这样可以让内部架构继续演进，而不破坏外部工具。

---

# 38. Dependency Policy

增加 production dependency 前必须回答：

1. 现有 dependency 能否解决？
2. 标准库能否解决？
3. 引入后是否增加 CVE / maintenance surface？
4. 是否影响 amd64 / arm64？
5. 是否影响 Docker build？
6. 是否影响 backup / runtime？
7. 删除它容易吗？

小功能优先自己实现少量清晰代码，而不是引入大型框架。

---

# 39. Backend 技术语言

Backend 当前继续：

```text
Node.js 24+
CommonJS
Promise-first async/await
```

不得仅为了“现代化”进行全仓：

```text
CommonJS → ESM
JavaScript → TypeScript
Express → 新框架
```

迁移。

只有当现有技术本身造成持续、可证明的问题时才考虑。

Frontend 继续使用 TypeScript。

---

# 40. Observability

Meemo 是小型系统，不需要完整 observability platform。

长期最低要求：

- structured logs
- request correlation where useful
- health live
- health ready
- startup failure explicit
- shutdown explicit
- sensitive data redaction

如果未来加入 metrics：

优先少量核心指标，不建立复杂 telemetry pipeline。

---

# 41. Testing Architecture

保持两层主测试体系：

```text
Backend / Contract
    Mocha

Frontend Behavior
    Vitest
```

不得增加第三个测试框架解决同类问题。

---

# 42. 测试分层

## Unit / behavior

验证：

- service rules
- frontend interactions
- parsers
- domain invariants

## Integration

验证：

- MongoDB
- sessions
- attachment
- import/export
- public sharing

## Build

验证：

- frontend typecheck
- production asset
- generated API types

## Container

验证：

- amd64
- arm64
- Compose startup

---

# 43. 新字段 Checklist

任何 Thing 新字段必须至少检查：

- [ ] Domain default
- [ ] HTTP validation
- [ ] OpenAPI
- [ ] Generated TS type
- [ ] Create path
- [ ] Update path
- [ ] Read path
- [ ] Import
- [ ] Export
- [ ] Old data compatibility
- [ ] Frontend state
- [ ] Tests

Note Color 应成为这个模式的第一个完整示范。

---

# 44. CI 是架构边界的一部分

长期 required validation 应继续覆盖：

```text
API generated type sync
frontend typecheck
frontend test
frontend build
backend test
integration
amd64 image
arm64 image
```

CI green 不代表功能一定正确，但：

> 非 green commit 不应成为正式发布输入。

---

# 45. Repository Workflow 与 Architecture 分离

开发流程可以随着单维护者/多人协作变化。

允许：

```text
direct master
```

也允许：

```text
PR workflow
```

长期架构规范不绑定其中一种。

真正的 release identity 是：

```text
exact commit SHA
+
successful validation
+
immutable image digest
+
matched recoverable backup
```

不能把“经过 PR”本身等同于生产安全。

现有文档中关于 direct-master 与 mandatory-PR 的冲突应单独清理，不继续复制到新规范。

---

# 46. Production Release

生产发布必须能够明确回答：

```text
代码是什么？
镜像是什么？
配置是什么？
数据备份是什么？
如何回滚？
验证结果是什么？
```

发布必须绑定 immutable image digest，而不是只依赖：

```text
latest
```

等可变 tag。

---

# 47. Migration Code 的生命周期

`scripts/` 下历史迁移工具不能无限增长。

每一代 migration 应明确属于：

```text
active migration
rollback window
historical evidence
retired
```

长期策略：

> 升级完成、观察窗口结束、rollback 不再需要后，优先删除 runtime compatibility path。

Migration 工具可以保留较长时间作为历史证据，但不得污染 runtime request path。

---

# 48. Architecture Complexity Budget

每引入一个新的：

- runtime process
- database
- message broker
- persistence system
- state framework
- UI framework
- build system
- service

都视为一次：

> **Architecture Cost Event**

必须写明：

```text
Problem
Why current architecture cannot solve it
New component
Failure mode
Backup impact
Security impact
Rollback
Removal path
```

如果这些内容说不清楚：

**不引入。**

---

# 49. 明确禁止的演进路线

在没有新的强证据前，以下路线不属于 Meemo 长期计划：

### 不拆微服务

不要拆：

```text
auth-service
note-service
attachment-service
tag-service
search-service
```

独立部署。

代码模块边界已经足够。

---

### 不双写

禁止：

```text
MongoDB + another DB
```

同时作为 Thing 真相。

---

### 不把 tags 升级成复杂知识图谱基础设施

WikiLinks 和 Tags 可以继续增强，但默认仍基于 Thing 数据。

---

### 不为了 AI 重写核心

AI 应挂在核心旁边，而不是核心围绕 AI 重建。

---

### 不为了 MD3 引入大型 UI 框架

继续保持：

```text
Vue
CSS tokens
small components
```

---

### 不提前建设多租户 SaaS 架构

当前 owner partition 已足以支撑用户隔离。

只有真正进入 SaaS 运营，才重新审视：

- quotas
- tenant billing
- sharding
- admin plane
- audit platform

---

# 50. 何时允许重大架构升级

只有出现以下一种或多种实际证据时，才允许进入重大架构评估：

### Scale

- 当前数据库/文件存储已形成真实性能瓶颈
- 单实例资源限制被持续触发

### Reliability

- 单进程故障域无法满足真实 SLA

### Operations

- backup/restore 时间已经不可接受

### Product

- 多实例成为产品必须
- 大规模异步任务成为核心需求
- semantic search 已被证明是核心体验

### Team

- 多团队需要真正独立发布与 ownership

“业界都这么做”不属于证据。

---

# 51. 架构决策记录

Meemo 不需要完整 ADR bureaucracy。

只有涉及以下变化时，才需要一个短 Architecture Decision：

- 新数据库
- 新 runtime service
- 新持久化系统
- API breaking change
- auth model change
- attachment backend change
- major frontend state framework
- AI/vector infrastructure
- backup model change

建议格式不超过一页：

```text
Decision
Problem
Alternatives
Why
Operational Impact
Rollback
```

---

# 52. 推荐未来目录

近期不需要重构整个目录。

只有真实需要时，可以逐步形成：

```text
src/
  http/
  services/
  database/
  storage/
  domain/        # only small shared invariants
  lifecycle.js

web/src/
  api/
  components/
  composables/
  constants/
  styles/
  views/
```

不要创建空目录或“为以后准备”的层级。

---

# 53. 近期收敛任务

基于当前项目状态，长期规范落地的第一批工作应该很小。

## P1

### 1. NoteColor 单一定义

统一：

- HTTP
- DB
- import
- OpenAPI
- frontend constant

---

### 2. 完成 MD3 token 化

优先：

```text
NoteComposer
NoteCard
NotesView
```

避免新增硬编码颜色。

---

### 3. 明确 modifiedAt 语义

推荐：

```text
content-semantic update
    => modifiedAt changes

presentation-only update
    => modifiedAt unchanged
```

至少 color 应明确属于哪一种。

---

## P2

### 4. 清理 repository workflow 文档冲突

统一：

- `AGENTS.md`
- `BRANCH_PROTECTION.md`
- `RELEASE_CHECKLIST.md`

不要同时声明：

```text
direct master preferred
```

与：

```text
PR mandatory
```

---

### 5. 规划 legacy user source 退出

当生产观察窗口与回滚需求结束：

- file source
- fallback production path

应进入 removal plan。

---

### 6. 重新评估 tags projection 的长期价值

迁移完全结束后确认：

```text
tags collection
```

是否还有实际必要。

没有必要就删除，而不是继续维护第二份派生状态。

---

# 54. 长期架构验收 Checklist

对每一个较大的 Feature / Refactor，都应检查：

## Data

- [ ] 数据事实源是否唯一？
- [ ] 是否引入了新的双写？
- [ ] 旧数据如何兼容？
- [ ] import/export 是否覆盖？
- [ ] backup/restore 是否受影响？

## Boundary

- [ ] HTTP 是否只处理 HTTP？
- [ ] Service 是否拥有业务行为？
- [ ] Database/Storage 是否封装外部状态？
- [ ] 是否出现跨层直接访问？

## Contract

- [ ] OpenAPI 是否更新？
- [ ] Generated type 是否同步？
- [ ] Validation 是否与 domain 一致？

## Concurrency

- [ ] 是否可能覆盖并发修改？
- [ ] 是否应该使用 atomic update / CAS？

## Frontend

- [ ] URL/Composable 状态权威是否清晰？
- [ ] 是否无必要引入全局状态？
- [ ] 是否使用 semantic design tokens？
- [ ] dark mode / keyboard / focus 是否正常？

## Security

- [ ] auth / authorization 是否保持 fail-closed？
- [ ] 新输入是否验证？
- [ ] secrets 是否可能泄漏？
- [ ] 外部网络请求是否扩大 SSRF 风险？

## Operations

- [ ] CI 覆盖？
- [ ] amd64 / arm64？
- [ ] 如何回滚？
- [ ] 是否增加新的长期运行组件？

## Complexity

- [ ] 这是不是解决问题所需的最小架构？
- [ ] 有没有更简单的方案？
- [ ] 新抽象是否已有至少两个真实使用点？

---

# 55. Architecture North Star

最终希望 Meemo 保持如下形态：

```text
              ┌─────────────────────┐
              │       Vue SPA       │
              │ simple + accessible │
              └──────────┬──────────┘
                         │
                    OpenAPI HTTP
                         │
              ┌──────────▼──────────┐
              │   Modular Monolith  │
              │                     │
              │ HTTP                │
              │ Services            │
              │ Small Domain Rules  │
              │ Persistence Adapters│
              └───────┬───────┬─────┘
                      │       │
                  MongoDB   Files
                      │
                Source of Truth
```

未来即使增加：

```text
AI
semantic search
mobile client
S3
automation
```

也应围绕这个核心扩展，而不是把核心推倒重来。

---

# 56. 最终原则

Meemo 的长期架构优势不是“先进”。

而是：

> **每一层都能被一个人理解，每一份核心数据都知道真相在哪里，每一次升级都能被验证，每一次失败都能恢复。**

因此，未来所有架构决策默认遵循：

```text
Prefer explicit over implicit.
Prefer one source of truth over synchronization.
Prefer one deployable over distributed components.
Prefer small modules over frameworks.
Prefer proven need over speculative scalability.
Prefer recoverability over architectural elegance.
Prefer deleting compatibility code over maintaining it forever.
```

这就是 Meemo 的长期架构边界。
