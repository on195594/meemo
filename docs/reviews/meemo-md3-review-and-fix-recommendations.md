# Meemo Material Design 3 改造审查与修复建议

> 审查对象：`on195594/meemo`
> 审查提交：`600acf4e1048e1e4129268758349ffc1cc59ccb3`
> 提交说明：`feat: implement Material Design 3 and Google Keep styling with note colors`
> 审查日期：2026-09-16

## 1. 审查结论

本次改造方向整体正确，已经从单纯的 CSS 换肤升级为一套较完整的跨层改造，主要包括：

- 引入 Material Design 3 风格的颜色、圆角、阴影、动效 Token。
- 引入 Google Keep 风格的 12 色笔记颜色体系。
- 新增笔记 `color` 字段，并贯通 API、数据库、导入导出、前端类型与组件。
- 增加暗色模式 Token。
- 增强按钮 focus-visible、触摸区域、reduced-motion 等可访问性细节。
- Notes 页面由传统单列流调整为卡片式 Grid。
- 现有 CI 已通过：前端 typecheck/test/build、后端测试、integration、amd64/arm64 Docker build 均成功。

当前状态可以定义为：

**MD3 / Google Keep inspired 第一阶段已经可用，但尚未真正收口。**

下一阶段不建议继续扩大视觉改造范围，而应优先做一轮 **MD3 hardening**，把当前跨层改动的边界、语义与测试补齐。

---

## 2. 高优先级问题

### P1-1：Dark Mode 尚未完成，现有代码与 “WCAG AA” 声明不完全一致

`web/src/styles/tokens.css` 已经建立 light / dark 两套 Token，并支持：

- `prefers-color-scheme: dark`
- `prefers-reduced-motion: reduce`
- M3 primary / surface / outline / error 等语义色

这是本次改造中最正确的设计之一。

但实际组件中仍存在大量浅色硬编码，例如：

- `#64748b`
- `#718096`
- `#edf2f7`
- `#ffffff`
- `#2d3748`
- `#3182ce`
- `#cbd5e0`

主要分布在：

- `web/src/components/NoteCard.vue`
- `web/src/components/NoteComposer.vue`
- `web/src/views/NotesView.vue`

这些颜色在暗色模式下容易出现：

- 编辑框背景过亮
- 附件 chip 变成亮块
- 次级文本对比不足
- error / toast 与页面主题割裂
- badge 在暗色卡片上的视觉不协调

### 修复建议

不要继续新增更多颜色变量，而是把硬编码逐步收口到已有的 semantic tokens：

```css
color: var(--md-sys-color-on-surface);
color: var(--md-sys-color-on-surface-variant);
background: var(--md-sys-color-surface-container);
background: var(--md-sys-color-surface-container-high);
border-color: var(--md-sys-color-outline-variant);
```

对于 error / warning：

```css
background: var(--md-sys-color-error-container);
color: var(--md-sys-color-error);
```

同时建议暂时把：

```css
Conforming to WCAG AA strict contrast standards.
```

改成更保守的：

```css
Designed toward WCAG AA contrast targets.
```

除非后续真正增加自动化或人工对比度验证。

---

### P1-2：`color` 约束只在 HTTP 层成立，领域层没有守住

当前 HTTP 层通过 `z.enum(...)` 限定了合法颜色：

```text
default
coral
peach
sand
mint
sage
fog
storm
dusk
blossom
clay
chalk
```

但数据库层目前只判断：

```js
typeof color === 'string'
```

Import 路径同样只判断是不是字符串。

这意味着：

API 请求无法写入：

```json
{ "color": "red" }
```

但导入文件却可能把 `"red"` 写入数据库。

最终前端会生成：

```css
var(--note-color-red)
```

导致颜色变量不存在。

### 修复建议

新增一个非常小的后端共享模块：

```text
src/domain/note-colors.js
```

或者更轻量：

```text
src/note-colors.js
```

内容只需要：

```js
'use strict';

var NOTE_COLORS = [
    'default',
    'coral',
    'peach',
    'sand',
    'mint',
    'sage',
    'fog',
    'storm',
    'dusk',
    'blossom',
    'clay',
    'chalk'
];

function isValidNoteColor(color) {
    return NOTE_COLORS.indexOf(color) !== -1;
}

function normalizeNoteColor(color) {
    return isValidNoteColor(color) ? color : 'default';
}

module.exports = {
    NOTE_COLORS: NOTE_COLORS,
    isValidNoteColor: isValidNoteColor,
    normalizeNoteColor: normalizeNoteColor
};
```

然后统一用于：

- `src/http/routes/things.js`
- `src/database/things.js`
- `src/services/import-export-service.js`

OpenAPI 中也建议把重复 enum 抽成：

```yaml
NoteColor:
  type: string
  enum:
    - default
    - coral
    - peach
    - sand
    - mint
    - sage
    - fog
    - storm
    - dusk
    - blossom
    - clay
    - chalk
```

其他 schema 统一：

```yaml
$ref: '#/components/schemas/NoteColor'
```

这样可以避免颜色定义在多个地方逐渐漂移。

---

### P1-3：修改笔记颜色会改变 `modifiedAt`，但当前页面不会立即重新排序

数据库 `put()` 当前无论修改什么字段，都会执行：

```js
modifiedAt: Date.now()
```

列表查询又按照：

```js
sticky DESC
modifiedAt DESC
_id DESC
```

排序。

但前端 `updateNote()` 只会在 `sticky` 变化时重新 sort。

因此会出现：

1. 用户只修改笔记颜色。
2. 后端更新 `modifiedAt`。
3. 当前页面卡片位置不变。
4. 用户刷新页面。
5. 该笔记突然跑到前面。

这是一个典型的状态一致性问题。

### 推荐修复方案

建议把颜色视为 **presentation metadata**。

因此：

**仅修改颜色时，不更新 `modifiedAt`。**

这样最符合用户直觉：

- 修改正文 → 算编辑
- 修改标签 → 算编辑
- 修改附件 → 算编辑
- 修改公开/归档/置顶状态 → 根据产品定义决定
- 修改颜色 → 不应改变内容的最近编辑时间

如果现阶段不想改数据库 update 语义，那么另一个可接受方案是：

前端所有 update 成功后都按后端同样规则重排。

但相比之下，建议优先采用第一种方案。

---

## 3. 中优先级问题

### P2-1：Composer 的 textarea 可能遮住笔记颜色

`NoteComposer` 外层会根据：

```ts
selectedColor
```

设置卡片背景。

但 textarea 自身目前没有明确：

```css
background: transparent;
```

并且文字仍然使用硬编码浅色：

```css
color: #2d3748;
```

在不同浏览器、系统暗色模式下，textarea 默认 field background 可能会覆盖父元素颜色。

### 修复建议

至少改成：

```css
.composer-textarea {
  background: transparent;
  color: var(--md-sys-color-on-surface);
}

.composer-textarea::placeholder {
  color: var(--md-sys-color-on-surface-variant);
}
```

同时建议把以下区域一起 Token 化：

- upload progress
- attachment chip
- remove button
- error banner
- action separator
- shortcut hint

---

### P2-2：Color Picker 的可访问性还不完整

目前已经做了：

- `role="radiogroup"`
- `role="radio"`
- `aria-checked`
- `aria-expanded`
- `focus-visible`

这些方向正确。

但仍缺：

- ArrowLeft / ArrowRight / ArrowUp / ArrowDown 切换
- Esc 关闭
- 打开后焦点进入当前选中项
- 点击外部关闭
- 完整 roving tabindex
- 颜色保存失败后的反馈

另外 swatch 视觉尺寸只有：

```css
24px × 24px
```

相比普通 action button 已经扩展到 48×48，swatch 触控区域明显偏小。

### 修复建议

保持圆点视觉仍为 24px，但扩大按钮实际点击区域到 40~48px。

例如：

```css
.color-swatch-btn {
  width: 40px;
  height: 40px;
  padding: 8px;
  background-clip: content-box;
}
```

或者使用伪元素扩大 hit target。

不建议为了颜色选择器引入第三方 UI library。

---

### P2-3：颜色保存失败目前没有用户反馈

`NoteCard.selectColor()` 当前大致逻辑为：

```ts
await props.onSaveEdit(props.thing._id, { color });
```

但是没有处理：

```ts
{
  success: false,
  error: '...'
}
```

用户点击颜色以后，如果保存失败：

- palette 会立即关闭
- 用户不知道失败
- UI 状态可能短时间与后端不一致

### 修复建议

改成：

```ts
const result = await props.onSaveEdit(props.thing._id, { color });

if (!result.success) {
  editError.value = result.error || 'Failed to update note color';
}
```

更理想的是单独增加：

```ts
const actionError = ref<string | null>(null);
```

避免复用正文编辑错误状态。

---

### P2-4：颜色定义在前端重复维护

当前：

- `NoteCard.vue`
- `NoteComposer.vue`

都定义了一份 `NOTE_COLORS`。

这很容易出现未来一处改名、一处忘改。

### 修复建议

新增：

```text
web/src/constants/noteColors.ts
```

例如：

```ts
import type { NoteColor } from '../api/client';

export const NOTE_COLORS: { key: NoteColor; name: string }[] = [
  { key: 'default', name: 'Default' },
  { key: 'coral', name: 'Coral' },
  { key: 'peach', name: 'Peach' },
  { key: 'sand', name: 'Sand' },
  { key: 'mint', name: 'Mint' },
  { key: 'sage', name: 'Sage' },
  { key: 'fog', name: 'Fog' },
  { key: 'storm', name: 'Storm' },
  { key: 'dusk', name: 'Dusk' },
  { key: 'blossom', name: 'Blossom' },
  { key: 'clay', name: 'Clay' },
  { key: 'chalk', name: 'Chalk' },
];
```

不要额外引入 store、provider 或 theme framework。

---

## 4. 布局与视觉建议

### 4.1 保留普通 CSS Grid，不建议为了 Google Keep 引入 Masonry

当前：

```css
.m3-notes-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
}
```

这是一个合理的折中。

Google Keep 的 masonry 确实视觉更接近便签墙，但会带来：

- DOM 顺序与视觉顺序差异
- 键盘导航复杂化
- 虚拟滚动复杂化
- Infinite Scroll 配合更困难
- 更难维护

Meemo 是个人笔记工具，不值得为了视觉模仿增加这些复杂度。

**建议保持现有 Grid。**

---

### 4.2 清理 NoteCard 的重复纵向间距

当前：

```css
.m3-notes-grid {
  gap: 1rem;
}
```

同时：

```css
.note-card {
  margin-bottom: 1rem;
}
```

这会导致 Grid 自己有 gap，Card 自身又增加 margin。

建议在 Grid 模式下移除：

```css
margin-bottom: 1rem;
```

或者直接把 Card 默认 margin 改为 0，由容器统一负责间距。

---

### 4.3 不建议继续扩大“Google Keep 仿制”

推荐定位：

> Material Design 3 inspired + Keep-like note interactions

而不是：

> Google Keep clone

保留以下借鉴即可：

- card
- note color
- pin
- archive
- compact action bar
- rounded search
- responsive grid

Meemo 自己的：

- Markdown
- WikiLinks
- Tag
- public/share
- attachments
- import/export

才是长期真正有辨识度的部分。

---

## 5. 测试补强建议

目前 CI 是绿色的，但这次新增的颜色功能没有对应新增测试。

### 5.1 后端测试

建议至少增加：

#### 合法颜色

```text
POST /api/things
color = coral
=> 201
```

#### 非法颜色

```text
POST /api/things
color = red
=> 400
```

#### 更新颜色

```text
PUT /api/things/:id
color = sage
=> 返回 sage
```

#### 旧数据兼容

数据库不存在 color：

```text
GET
=> color = default
```

#### export/import round-trip

```text
mint
=> export
=> import
=> mint
```

#### 非法导入颜色

建议行为明确二选一：

A. reject archive
B. normalize to default

更推荐：

**reject 非法值，缺失值才 fallback default。**

---

### 5.2 NoteComposer 测试

补：

```text
打开 palette
=> 选择 coral
=> save
=> onSave(content, attachments, 'coral')
```

再补：

```text
Clear
=> selectedColor reset default
```

---

### 5.3 NoteCard 测试

补：

```text
thing.color = mint
=> card background references --note-color-mint
```

以及：

```text
点击 coral
=> onSaveEdit(id, { color: 'coral' })
```

和：

```text
onSaveEdit 返回失败
=> UI 显示错误
```

---

## 6. 建议实施顺序

建议下一轮只做一个小型：

```text
fix: harden Material Design 3 note color support
```

按以下顺序处理：

### Step 1：收口 color domain

- 新增共享 `NOTE_COLORS`
- HTTP 使用共享 enum
- DB normalize / validate
- Import validate
- OpenAPI 抽 `NoteColor`

### Step 2：修复颜色修改时间语义

优先实现：

```text
color-only update does not change modifiedAt
```

或者明确统一排序。

### Step 3：完成 dark mode token 化

优先处理：

1. NoteComposer
2. NoteCard
3. NotesView

不要一次改整个项目。

### Step 4：修复 Composer textarea

- transparent background
- semantic text color
- semantic placeholder

### Step 5：增强 Color Picker

- hit target
- Esc
- keyboard navigation
- failure handling

### Step 6：增加针对性测试

只测试新行为，不需要做视觉 snapshot 大工程。

---

## 7. 建议暂时不要做的事情

为了保持 Meemo 的简化架构，当前不建议：

- 引入 Vuetify
- 引入 Material Web Components
- 引入完整 design-system package
- 引入 CSS-in-JS
- 引入 Tailwind 仅用于 MD3
- 引入复杂 theme provider
- 引入 masonry library
- 引入运行时动态 color engine
- 引入复杂状态管理解决颜色问题
- 重构整个 UI 组件体系

当前最适合 Meemo 的方式仍然是：

```text
CSS Tokens
+
Vue 原生组件
+
少量共享 constants
+
现有 API 类型
```

---

## 8. 最终建议

这次 Material Design 3 改造应该继续保留。

它已经明显改善了：

- UI 一致性
- 卡片层级
- 笔记可区分性
- 手机触控体验
- 暗色模式基础
- 长期视觉维护能力

但下一阶段应该从：

```text
“继续做得更像 Material / Keep”
```

转向：

```text
“把现有 Material 基础做完整、做稳定”
```

推荐总体策略：

> 借用 Material Design 3 的 Token、Shape、Motion 和 Accessibility 原则，但不追求完整复刻 Material 组件体系。

这样既能获得成熟设计体系的优势，又不会破坏 Meemo 当前非常重要的特点：

**代码少、依赖少、架构简单、个人可维护。**

---

## 9. 建议验收标准

本轮 hardening 完成后，应至少满足：

- [ ] 所有合法 NoteColor 在 create/update/import/export 中行为一致
- [ ] 非法颜色不能落入数据库
- [ ] 旧笔记没有 color 时稳定返回 `default`
- [ ] color-only update 的 modifiedAt 语义明确且前后端一致
- [ ] NoteCard / NoteComposer 暗色模式无明显浅色硬编码残留
- [ ] Composer textarea 不遮挡笔记背景色
- [ ] Color Picker 支持键盘基本操作
- [ ] Color Picker 保存失败有用户反馈
- [ ] NoteComposer / NoteCard 有颜色相关测试
- [ ] export/import 有颜色 round-trip 测试
- [ ] 现有 CI 全绿
- [ ] amd64 / arm64 构建不受影响
