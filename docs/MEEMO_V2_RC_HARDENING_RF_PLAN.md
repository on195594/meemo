# Meemo v2 Release Candidate Hardening

## 17 个 RF 修复任务执行计划

> Repository: `on195594/meemo`  
> Target Branch: `master`  
> Baseline: 重构完成后的当前 master  
> Project Phase: Release Candidate Hardening  
> Target Release: `v2.0.0-rc1`

---

# 1. 执行目标

本阶段不再进行大规模架构重构。

核心目标从：

```text
Refactoring
```

切换为：

```text
Correctness
Data Safety
Security
Testability
Release Reliability
```

最终目标是证明当前 Meemo 可以完成：

```text
clean install
→ test
→ build
→ migrate
→ deploy
→ shutdown
→ upgrade
→ recover
```

形成完整工程闭环。

---

# 2. 总体任务列表

| RF | 优先级 | 名称 | 建议顺序 |
|---|---|---|---:|
| RF-701 | P0 | 修复 CI 隐式依赖并建立 Clean Install 基线 | 1 |
| RF-702 | P0 | 恢复并强化 Master CI Quality Gate | 2 |
| RF-703 | P1 | 修复 Migration Dual-Read 数据完整性 | 3 |
| RF-704 | P1 | Migration 全链路 Fail-Fast | 4 |
| RF-705 | P1 | Migration State 与重复执行保护 | 5 |
| RF-706 | P1 | Migration Canonical Hash Verification | 6 |
| RF-707 | P1 | Import Attachment 覆盖与事务回滚保护 | 7 |
| RF-708 | P1 | 修复 API Contract 不一致 | 8 |
| RF-709 | P1/P3 | OpenAPI 驱动前端 Type / Client | 9 |
| RF-710 | P1 | Multer 与上传链路安全升级 | 10 |
| RF-711 | P2 | Attachment 生命周期与 Orphan GC | 11 |
| RF-712 | P2 | Graceful Shutdown 正确性修复 | 12 |
| RF-713 | P2 | Worker Single-Flight 防重入 | 13 |
| RF-714 | P2 | Structured Logging 隐私加固 | 14 |
| RF-715 | P2 | First-User Registration 原子化 | 15 |
| RF-716 | P3 | MongoDB Node Driver 现代化 | 16 |
| RF-717 | P2/P3 | Release Pipeline 合并与最终 RC Gate | 17 |

---

# 3. 推荐执行策略

不要一次建立 17 个并行开发分支。建议采用四个阶段：

```text
Phase A — CI Trust
RF-701
RF-702

Phase B — Data Safety
RF-703
RF-704
RF-705
RF-706
RF-707

Phase C — Contract + Security + Runtime
RF-708
RF-709
RF-710
RF-711
RF-712
RF-713
RF-714
RF-715

Phase D — Platform + Release
RF-716
RF-717
```

原则：**每一个 RF 独立提交、独立测试、独立验收。**

---

# RF-701 — CI Dependency and Clean Environment Validation

## Priority

`P0`

## 目标

彻底消除测试环境中的隐式依赖，并证明 Meemo 可以在全新 checkout 环境完成安装、构建和测试。

## 当前问题

`src/test/api-contract-test.js` 直接使用：

```js
require('js-yaml')
```

但根 `package.json` 没有直接声明 `js-yaml`，属于 phantom dependency。

## 修改范围

```text
package.json
package-lock.json
src/test/
.github/workflows/
```

## 实施步骤

1. 将 `js-yaml` 加入 `devDependencies`。
2. 更新 `package-lock.json`。
3. 检查全部测试代码的 `require()` / `import`。
4. 确认所有直接依赖均在对应 `package.json` 中显式声明。
5. 增加 clean install CI 验证。

## 建议命令

```bash
npm install --save-dev js-yaml
npm ls --depth=0
```

## Test

```bash
rm -rf node_modules
rm -rf web/node_modules
npm ci
npm run build
npm test
```

## Acceptance Criteria

所有命令返回 `exit code 0`。

## Definition of Done

- [ ] 所有直接依赖均显式声明
- [ ] clean `npm ci` 成功
- [ ] frontend build 成功
- [ ] backend tests 成功
- [ ] lockfile 已更新
- [ ] CI 可复现

---

# RF-702 — Restore Master CI Quality Gate

## Priority

`P0`

## 目标

使 GitHub Actions 真正成为 `master` 的质量门禁，而不是仅仅存在 workflow 文件。

## 修改范围

```text
.github/workflows/build.yml
.github/workflows/buildx-latest.yml
.github/workflows/buildx-release.yml
web/package.json
```

## 实施步骤

建立完整 PR 流程：

```text
PR
 │
 ▼
install
 │
 ▼
typecheck
 │
 ▼
build
 │
 ▼
test
 │
 ▼
docker build
 │
 ▼
compose smoke
 │
 ▼
PASS
```

增加前端类型检查：

```bash
npm install --save-dev vue-tsc
```

`web/package.json`：

```json
"typecheck": "vue-tsc --noEmit"
```

PR CI 至少执行：

```bash
npm ci
npm run build
npm test
npm --prefix web run typecheck
docker build -t meemo:ci .
docker compose up -d
```

Smoke 验证：

```text
/api/health/ready
/api/register
/api/login
/api/profile
/api/things
```

## Acceptance Criteria

GitHub Actions 中 `master` 至少出现：

```text
✓ test
✓ frontend
✓ docker
✓ integration
```

## Definition of Done

- [ ] PR 自动运行 CI
- [ ] master 自动运行 CI
- [ ] CI 失败时禁止 publish
- [ ] clean environment 验证成功
- [ ] Vue TypeCheck 纳入 CI
- [ ] Docker Compose Smoke 纳入 CI

## Depends On

`RF-701`

---

# RF-703 — Migration Dual-Read Correctness

## Priority

`P1`

## 目标

保证 migration 未完成期间，Unified 与 Legacy 数据同时存在时，用户始终可以读取完整数据。

## 修改范围

```text
src/database/things.js
src/database/tags.js
src/database/settings.js
src/test/
scripts/migrate-data-to-v2.js
```

## 当前问题

禁止继续采用：

```text
unified has data
→ return unified
```

## 推荐算法

```text
Unified
   +
Legacy
   ↓
merge
   ↓
deduplicate
   ↓
sort
   ↓
paginate
```

Thing 使用 `_id` 唯一去重；冲突时 **Unified wins**，因为 Unified 记录可能已经被用户更新。

分页必须建立在 merge 后的全局结果上，不能先分别 limit 再 merge。

## Test

构造：

```text
Legacy = 100 records
Unified = 40 records
```

验证：

```text
read = 100 unique records
```

再模拟相同 `_id` 同时存在于两侧，确认 Unified 版本胜出。

### Interrupted Migration Test

```text
100 legacy
copy 50
kill migration
restart app
```

必须仍然：

```text
100 records visible
```

## Definition of Done

- [ ] partial migration 不丢可见数据
- [ ] Unified 数据优先
- [ ] 无重复 `_id`
- [ ] sort 正确
- [ ] pagination 正确
- [ ] interruption regression test PASS

---

# RF-704 — Migration Fail-Fast Error Handling

## Priority

`P1`

## 目标

任何 MongoDB 读取、写入、索引或序列化错误都必须中断 migration。

## 修改范围

```text
scripts/migrate-data-to-v2.js
src/test/
```

## 禁止模式

```js
if (err || !docs || docs.length === 0) {
    return done();
}
```

## 修改为

```js
if (err) {
    return done(err);
}

if (!docs || docs.length === 0) {
    return done();
}
```

全面检查：

```text
listCollections
find
findOne
toArray
countDocuments
createIndex
replaceOne
updateOne
insertOne
```

错误日志必须包含：

```text
migration phase
user
collection
operation
```

禁止输出敏感 MongoDB URI。

## Test

模拟 Mongo find / write / index error，确认：

```text
migration exit != 0
```

且后续步骤没有继续执行。

## Definition of Done

- [ ] Mongo 错误全部 fail-fast
- [ ] 无 silent continue
- [ ] CLI exit code 非 0
- [ ] error message 有上下文
- [ ] regression test PASS

## Depends On

`RF-703`

---

# RF-705 — Migration State and Rerun Protection

## Priority

`P1`

## 目标

建立明确 migration 生命周期，并阻止重复执行覆盖新数据。

## 修改范围

```text
scripts/migrate-data-to-v2.js
src/database/
src/test/
docs/
```

## Migration State

增加 collection：

```text
system_migrations
```

推荐记录：

```json
{
  "_id": "schema-v2",
  "sourceVersion": 1,
  "targetVersion": 2,
  "phase": "pending",
  "startedAt": null,
  "copiedAt": null,
  "verifiedAt": null,
  "cutoverAt": null
}
```

状态：

```text
pending
copying
copied
verified
cutover
complete
failed
```

`--apply` 只允许合法状态迁移。状态为 `complete` 时默认拒绝再次 apply。

Legacy 数据不能覆盖 Unified 中：

```text
modifiedAt > migration startedAt
```

的记录。

## Test

```text
migration
→ user edits unified note
→ run migration again
```

必须验证：

```text
new unified note unchanged
```

## Definition of Done

- [ ] migration 有显式状态
- [ ] complete 后默认禁止 apply
- [ ] restart 可继续未完成 migration
- [ ] newer unified 数据不会被 legacy 覆盖
- [ ] rerun test PASS

## Depends On

`RF-704`

---

# RF-706 — Canonical Migration Verification

## Priority

`P1`

## 目标

使 migration verify 真正能够证明完整数据一致性。

## 修改范围

```text
scripts/migrate-data-to-v2.js
src/test/
docs/
```

## Canonical Thing

必须包含：

```text
_id
content
createdAt
modifiedAt
attachments
externalContent
public
shared
archived
sticky
```

Canonical Tag：

```text
name
usage
createdAt
```

Settings：完整比较 `settings.value`。

## Hash

推荐：

```text
sort fields
sort records by identity
JSON.stringify
SHA256
```

输出 manifest：

```json
{
  "thingsCount": 100,
  "thingsHash": "...",
  "tagsCount": 10,
  "tagsHash": "...",
  "settingsHash": "..."
}
```

成功信息：

```text
Migration verification succeeded.
Canonical source and target manifests match.
```

失败必须指出实体和字段，例如：

```text
Mismatch:
user=...
entity=thing
id=...
field=attachments
```

## Definition of Done

- [ ] 全字段 compare
- [ ] deterministic hash
- [ ] mismatch 定位具体 entity
- [ ] corrupted target test FAIL
- [ ] identical target test PASS

## Depends On

`RF-705`

---

# RF-707 — Import Attachment Atomicity

## Priority

`P1`

## 目标

保证 Import 永远不能静默覆盖已有附件。

## 修改范围

```text
src/storage/local-storage.js
src/services/import-export-service.js
src/test/import-hardening-test.js
```

## 第一阶段修复

复制附件使用：

```js
fs.constants.COPYFILE_EXCL
```

目标存在：

```text
EEXIST
→ import fail
```

## 推荐第二阶段

```text
validate
→ extract
→ stage
→ DB import
→ commit files
```

失败时：

```text
delete new DB records
delete newly staged files
leave original files untouched
```

## Test

1. Existing attachment 使用相同 identifier。
2. Import archive 产生 collision。
3. Import 必须失败。
4. Existing attachment hash 必须保持不变。

## Definition of Done

- [ ] existing attachment 不可覆盖
- [ ] collision 可识别
- [ ] rollback 不修改旧文件
- [ ] failed import 无残留
- [ ] data integrity regression PASS

---

# RF-708 — API Contract Consistency

## Priority

`P1`

## 目标

修复当前前后端 API Response Contract 不一致。

## 首要问题

统一：

```text
GET /api/users/:userId
```

推荐响应：

```json
{
  "user": {
    "id": "...",
    "username": "...",
    "displayName": "..."
  }
}
```

## 修改范围

```text
src/http/routes/public.js
src/services/sharing-service.js
docs/openapi.yaml
types/api.d.ts
web/src/api/client.ts
web/src/views/PublicStreamView.vue
src/test/api-contract-test.js
```

同时审计：

```text
/api/profile
/api/users
/api/users/:userId
/api/settings
/api/things
/api/public/:userId/things
```

统一 Response Envelope：

```json
{"user": {}}
{"thing": {}}
{"things": []}
{"settings": {}}
{"tags": []}
```

## Definition of Done

- [ ] Public profile 修复
- [ ] OpenAPI 同步
- [ ] TS types 同步
- [ ] runtime response test PASS
- [ ] Vue PublicStream 正常显示用户资料

---

# RF-709 — OpenAPI as Single Source of Truth

## Priority

`P1/P3`

## 目标

减少 API Contract 多套手工定义长期漂移的问题。

## 修改范围

```text
docs/openapi.yaml
web/src/api/
types/
package.json
web/package.json
```

## 推荐方案

可选择：

```text
openapi-typescript
```

或：

```text
orval
```

初期建议只生成 Types，保留当前轻量 fetch client。

目标结构：

```text
docs/openapi.yaml
       │
       ▼
generated/api-types.ts
       │
       ▼
web api client
```

增加：

```bash
npm run api:generate
```

CI 执行：

```bash
npm run api:generate
git diff --exit-code
```

## Definition of Done

- [ ] OpenAPI 成为事实来源
- [ ] TS 类型自动生成
- [ ] CI 检查 generated drift
- [ ] 手写重复接口类型明显减少
- [ ] RF-708 contract tests PASS

## Depends On

`RF-708`

---

# RF-710 — Multer and Upload Security Upgrade

## Priority

`P1`

## 目标

升级 multipart 解析依赖并强化上传边界。

## 修改范围

```text
package.json
package-lock.json
app.js
src/http/routes/files.js
src/http/routes/transfer.js
src/test/upload-limits-test.js
src/test/import-hardening-test.js
```

## Dependency

升级到当前安全修复线，计划目标：

```text
multer >= 2.2.x
```

## Limits

附件建议：

```js
{
  fileSize: MAX_ATTACHMENT_SIZE,
  files: 1,
  fields: 10,
  parts: 12,
  fieldNameSize: 100,
  fieldSize: 1024 * 1024
}
```

## Test

覆盖：

```text
oversized file
too many files
too many fields
too many parts
large field
nested multipart field
malformed multipart
```

## Definition of Done

- [ ] Multer 升至安全修复线
- [ ] package-lock 更新
- [ ] multipart 全维度有限制
- [ ] malformed multipart 不崩溃
- [ ] DoS regression test PASS

---

# RF-711 — Attachment Lifecycle and Orphan GC

## Priority

`P2`

## 目标

解决长期运行中的孤儿附件与磁盘无限增长问题。

## 修改范围

```text
src/services/attachment-service.js
src/storage/local-storage.js
src/services/thing-service.js
src/database/things.js
src/lifecycle.js
scripts/
src/test/
```

## 第一阶段

实现 attachment reference GC：

```text
scan DB attachment identifiers
+
scan filesystem
↓
filesystem - references
↓
orphans
```

只删除：

```text
age > grace period
```

推荐默认 `24h`。

## CLI

```bash
node scripts/gc-attachments.js --dry-run
node scripts/gc-attachments.js --apply
```

自动 worker 可选，但建议日级执行，不要分钟级扫描。

## Definition of Done

- [ ] orphan 可以检测
- [ ] 默认 dry-run
- [ ] 有 grace period
- [ ] referenced files 永不删除
- [ ] orphan GC integration PASS

---

# RF-712 — Graceful Shutdown Correctness

## Priority

`P2`

## 目标

使 `SIGTERM` 真正优雅终止服务。

## 修改范围

```text
src/lifecycle.js
src/services/health-service.js
app.js
docker-compose.yml
src/test/runtime-lifecycle-test.js
```

## 正确顺序

```text
SIGTERM
  ↓
isShuttingDown=true
  ↓
readiness=503
  ↓
server.close()
  ↓
wait in-flight
  ↓
timeout
  ↓
destroy remaining sockets
  ↓
workers stop
  ↓
Mongo close
```

Docker 增加：

```yaml
stop_grace_period: 20s
```

应用建议：

```text
SHUTDOWN_TIMEOUT_MS=15000
```

## Test

构造 5 秒请求，在第 1 秒发送 SIGTERM，预期请求完成后退出。

再测试 30 秒 hanging request，预期 timeout 后强制关闭。

## Definition of Done

- [ ] readiness 在 shutdown 时 503
- [ ] 新连接不再接受
- [ ] 正常 in-flight request 完成
- [ ] 超时请求会强制关闭
- [ ] Mongo 正确关闭
- [ ] signal handlers 清理

---

# RF-713 — Worker Single-Flight Execution

## Priority

`P2`

## 目标

防止后台 worker 重叠执行。

## 修改范围

```text
src/lifecycle.js
src/test/runtime-lifecycle-test.js
```

## 推荐实现

Worker state：

```js
{
  fn,
  intervalMs,
  running: false
}
```

运行逻辑：

```text
timer
  ↓
running?
 ├ YES → skip
 └ NO
     ↓
   running=true
     ↓
    execute
     ↓
   finally
     ↓
   running=false
```

更推荐使用 recursive `setTimeout`，天然避免任务重叠。

## Test

```text
interval=50ms
task duration=200ms
```

运行 500ms，必须证明：

```text
max concurrent executions = 1
```

## Definition of Done

- [ ] 同一 worker 无并发执行
- [ ] error 后 running 正常释放
- [ ] stop 后不再启动
- [ ] shutdown 能等待或安全停止 worker

---

# RF-714 — Structured Logging Privacy Hardening

## Priority

`P2`

## 目标

防止 Query String、Token 和用户搜索内容进入日志。

## 修改范围

```text
src/http/middleware/logger.js
src/test/structured-logging-test.js
.github/workflows/build.yml
```

## 默认日志

只记录 pathname，例如：

```text
/api/profile
```

禁止记录：

```text
/api/profile?token=abc
```

## Sensitive Query Test

测试：

```text
?token=secret
?password=secret
?filter=private-note
?email=user@example.com
```

上述值均不得出现在日志。

保留 `X-Request-Id`，继续限制最大长度。

## Definition of Done

- [ ] query 默认完全不记录
- [ ] sensitive values 不进入日志
- [ ] path 正常记录
- [ ] requestId 保留
- [ ] structured logging tests PASS

---

# RF-715 — Atomic First-User Registration

## Priority

`P2`

## 目标

保证 `REGISTRATION_MODE=first-user` 在并发请求下只允许一个首用户注册成功。

## 修改范围

```text
src/services/auth-service.js
src/database/users-mongo.js
src/test/auth-test.js
```

## 推荐方案

Mongo collection：

```text
system_config
```

记录：

```json
{
  "_id": "registration-initialized"
}
```

利用唯一 `_id` 原子 claim：

```text
register request
      ↓
atomic claim
      │
      ├ success → create first user
      │
      └ duplicate → registration closed
```

创建用户失败时必须释放 claim，或使用 Mongo transaction。

## Test

并发发送：

```text
20 registration requests
```

期望：

```text
1 × HTTP 201
19 × HTTP 403
```

最终：

```text
users.count() == 1
```

## Definition of Done

- [ ] first-user 原子化
- [ ] 并发测试 PASS
- [ ] registration failure 不会永久锁死系统
- [ ] open/disabled mode 行为不变

---

# RF-716 — MongoDB Node Driver Modernization

## Priority

`P3`

## 目标

将 Node MongoDB Driver 升级到与 MongoDB Server 8 更匹配的现代版本。

## 修改范围

```text
package.json
package-lock.json
src/config.js
src/lifecycle.js
src/database/**
scripts/**
src/test/**
```

## 推荐目标

```text
mongodb 6.x
```

重点检查：

```text
MongoClient.connect
ObjectId
close()
collection APIs
countDocuments
findOne
insertOne
updateOne
replaceOne
createIndex
```

删除新版本不再需要的遗留参数，例如 `useUnifiedTopology`。

## Test Matrix

```text
auth
session
things CRUD
tags
settings
attachments
migration
import/export
health
shutdown
```

不要在本 RF 中同时进行 Server 版本升级、Schema 重构或数据库抽象层重写。

## Definition of Done

- [ ] mongodb driver 6.x
- [ ] deprecated options 清理
- [ ] full tests PASS
- [ ] migration tests PASS
- [ ] Docker Compose PASS

## Depends On

建议等待 `RF-703 ~ RF-715` 基本稳定后执行。

---

# RF-717 — Release Pipeline Consolidation and RC Gate

## Priority

`P2/P3`

## 目标

建立 Meemo v2 最终统一发布流水线。

## 修改范围

```text
.github/workflows/
README.md
docs/
Dockerfile
docker-compose.yml
```

## 推荐 Workflow

保留两个主 Workflow：

```text
ci.yml
release.yml
```

## ci.yml

触发：

```text
pull_request
push master
```

Jobs：

```text
quality
integration
docker
```

Quality：

```bash
npm ci
npm --prefix web ci
npm --prefix web run typecheck
npm run build
npm test
```

Integration：

```bash
docker compose up -d
```

Smoke：

```text
health
register
login
profile
create note
update note
delete note
attachment upload
public share
export/import
```

## release.yml

触发：

```text
GitHub release published
```

执行：

```text
CI reusable workflow
      ↓
Docker buildx
      ↓
amd64
arm64
      ↓
SBOM
      ↓
provenance
      ↓
push version
      ↓
push latest
```

Tags 建议：

```text
2.0.0-rc1
2.0.0
2.0
2
latest
```

`latest` 只能由正式 release 更新，RC 不污染 `latest`。

## Definition of Done

- [ ] CI 与 Release workflow 职责清晰
- [ ] release 必须依赖完整验证
- [ ] amd64/arm64 镜像成功
- [ ] SBOM 生成
- [ ] provenance 生成
- [ ] RC 不发布 latest
- [ ] 正式版才更新 latest

---

# 4. 最终 Release Candidate Gate

完成 RF-717 后必须执行最终 Gate。

## Build Gate

```text
[ ] clean npm ci
[ ] clean web npm ci
[ ] frontend typecheck
[ ] frontend build
[ ] backend test suite
```

## Security Gate

```text
[ ] Multer upgraded
[ ] multipart limits
[ ] XSS regression
[ ] SSRF regression
[ ] no query secret logging
```

## Migration Gate

```text
[ ] dry-run
[ ] apply
[ ] verify
[ ] interruption recovery
[ ] rerun protection
[ ] canonical hash
```

## Data Gate

```text
[ ] import/export roundtrip
[ ] attachment collision protection
[ ] orphan attachment GC
```

## Runtime Gate

```text
[ ] Mongo readiness
[ ] storage readiness
[ ] graceful shutdown
[ ] worker single-flight
```

## Container Gate

```text
[ ] non-root
[ ] read-only rootfs
[ ] no-new-privileges
[ ] cap_drop ALL
[ ] amd64 build
[ ] arm64 build
```

## API Gate

```text
[ ] OpenAPI valid
[ ] generated TypeScript current
[ ] runtime API schema correct
[ ] Public Stream works
```

只有全部 PASS，才允许发布：

```text
v2.0.0-rc1
```

---

# 5. 推荐 Git 分支策略

每一个 RF 使用独立分支：

```text
master
  │
  └── hardening/RF-701-ci-clean-install
```

例如：

```text
hardening/RF-701-ci-clean-install
hardening/RF-702-master-quality-gate
hardening/RF-703-migration-dual-read
hardening/RF-704-migration-fail-fast
...
hardening/RF-717-release-gate
```

每个 RF 独立 PR。

---

# 6. 推荐 Commit Convention

```text
fix(ci): declare js-yaml and verify clean install [RF-701]
ci: establish master validation quality gate [RF-702]
fix(migration): merge unified and legacy reads safely [RF-703]
fix(migration): fail fast on database errors [RF-704]
feat(migration): add migration state and rerun protection [RF-705]
feat(migration): add canonical hash verification [RF-706]
fix(import): prevent attachment overwrite [RF-707]
fix(api): align public profile response contract [RF-708]
feat(api): generate TypeScript definitions from OpenAPI [RF-709]
fix(security): upgrade multer and harden multipart limits [RF-710]
feat(storage): add attachment orphan garbage collection [RF-711]
fix(runtime): implement graceful shutdown sequencing [RF-712]
fix(runtime): prevent worker concurrent execution [RF-713]
fix(logging): remove query strings from request logs [RF-714]
fix(auth): make first-user registration atomic [RF-715]
chore(db): upgrade MongoDB Node driver [RF-716]
ci(release): consolidate RC release pipeline [RF-717]
```

---

# 7. Agent 执行规范

如果由 AI Agent 实施，每个 RF 必须遵守：

```text
1. Read RF
2. Inspect current implementation
3. Create dedicated branch
4. Implement minimal change
5. Add regression test
6. Run focused tests
7. Run full tests
8. Run Docker build where relevant
9. Update docs
10. Commit
11. Open PR
```

禁止：

```text
顺手重构其他模块
无关依赖升级
大规模格式化整个仓库
改变公共 API 而不更新 OpenAPI
删除 legacy compatibility 而没有 migration proof
```

---

# 8. 每个 PR 的强制检查项

PR Description：

```text
RF:
Problem:
Root Cause:
Solution:
Risk:
Tests:
Migration Impact:
Rollback:
```

Checklist：

```text
[ ] change scope limited to RF
[ ] regression test included
[ ] npm test PASS
[ ] frontend build PASS
[ ] typecheck PASS where applicable
[ ] Docker build PASS where applicable
[ ] migration behavior documented where applicable
[ ] no unrelated formatting
[ ] no credentials added
[ ] docs updated
```

---

# 9. 建议里程碑

## Milestone 1 — CI TRUSTED

```text
RF-701
RF-702
```

## Milestone 2 — DATA SAFE

```text
RF-703
RF-704
RF-705
RF-706
RF-707
```

这是整个 RC Hardening 中最重要的里程碑。

## Milestone 3 — RUNTIME HARDENED

```text
RF-708
RF-709
RF-710
RF-711
RF-712
RF-713
RF-714
RF-715
```

## Milestone 4 — RC READY

```text
RF-716
RF-717
```

---

# 10. 最终执行顺序

```text
RF-701
   ↓
RF-702
   ↓
RF-703
   ↓
RF-704
   ↓
RF-705
   ↓
RF-706
   ↓
RF-707
   ↓
RF-708
   ↓
RF-709
   ↓
RF-710
   ↓
RF-711
   ↓
RF-712
   ↓
RF-713
   ↓
RF-714
   ↓
RF-715
   ↓
RF-716
   ↓
RF-717
   ↓
v2.0.0-rc1
```

以下任务在基础依赖稳定后可以有限并行：

```text
RF-710
RF-712
RF-713
RF-714
RF-715
```

但以下迁移任务建议严格串行：

```text
RF-703
RF-704
RF-705
RF-706
RF-707
```

Migration 是整个系统最容易造成不可逆问题的部分，不值得为了开发速度增加复杂度。

---

# 11. 完成标准

17 个 RF 全部完成以后，Meemo 才建议正式把：

```text
docs/MEEMO_REFACTORING_ROADMAP.md
```

中的重构状态标记为：

```text
COMPLETE
```

届时可以正式进入：

```text
Meemo v2
Feature Development Phase
```

并建立新的长期节奏：

```text
Feature
   ↓
Test
   ↓
PR
   ↓
CI
   ↓
Release
   ↓
Observe
```

而不再继续：

```text
Refactor
→ Refactor
→ Refactor
```

最终判断标准：

> **这 17 个 RF 不是另一轮重构，而是为了证明上一轮重构值得信任。**

当它们全部关闭以后，Meemo 才真正完成从历史项目向长期可维护应用的转变。
