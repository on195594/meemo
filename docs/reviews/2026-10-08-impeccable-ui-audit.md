# Impeccable UI 审查与精修（2026-10-08）

## 范围与结论

审查现有 Vue 界面，精修导航、笔记卡片、输入框、筛选/空状态及批量操作栏；没有更换 Material 配色、瀑布流或业务接口。保留审查开始时已有的未提交改动，复用其 `UiIcon.vue`，没有新增依赖。后端、安全、生产性能和部署不在本次审查范围。

**实现一致性：通过，仍有局部欠账。** 保留笔记颜色、置顶/公开状态、Markdown、标签等产品语义，工具图标统一为继承主题颜色的 SVG；不是新增装饰性页面。详情、设置等弹窗尚未全部统一。

分数是本次界面范围内的工程判断，不是 WCAG 认证或全项目质量评级。

| 维度 | 优化前 | 优化后 | 主要证据 / 限制 |
| --- | ---: | ---: | --- |
| 可访问性 | 2 | 3 | 新增原生打开按钮、控件名称和全局焦点环；单笔/批量删除弹窗实现焦点捕获与 Escape 恢复 |
| 性能 | 3 | 3 | 保留已有懒加载和 Markdown 缓存；移除 max-width 与上传进度 width 过渡；detector 布局警告已清零 |
| 响应式 | 2 | 3 | 320–1440px 两种主题无页面/卡片工具栏溢出；批量栏和颜色面板不再裁切；选择框 28px 视觉保持 44px 触控区 |
| 主题 | 2 | 3 | 批量栏不再引用未定义的最高层表面 token；核心图标继承主题颜色 |
| 实现一致性 | 3 | 4 | 使用既有组件、SVG 图标和 tokens；统一单笔与批量操作的键盘导航和弹窗行为 |
| **总计** | **12/20：可接受，需改进** | **16/20：良好** | |

共记录 10 组问题：P0 0、P1 2、P2 7、P3 1。经本轮审查与跟进修复，全部 10 组已处理完毕。

## 问题与处理

| 优先级 / 分类 | 位置 | 用户影响与证据 | 状态与处理 |
| --- | --- | --- | --- |
| P1 / 可访问性 | [NoteCard.vue](../../web/src/components/NoteCard.vue)、[NoteComposer.vue](../../web/src/components/NoteComposer.vue)、[NotesView.vue](../../web/src/views/NotesView.vue) | 点击卡片打开详情没有原生键盘入口；输入框、筛选删除按钮等缺少明确名称。涉及 WCAG 2.1.1、4.1.2 | 已处理：独立的原生打开按钮、明确名称和切换状态；Enter 打开、Escape 关闭详情已验证 |
| P1 / 可访问性 | `NoteCard.vue` 与 `NotesView.vue` 的删除确认弹窗 | `aria-modal="true"` 缺少焦点限制；Escape 无法退出单笔删除；焦点未回退到触发按钮。涉及 WCAG 2.1.1、2.4.3 | 已处理：打开自动聚焦 Cancel，Tab/Shift+Tab 环内循环，Escape 立即退出并回退焦点到触发按钮；绑定 `aria-labelledby` |
| P2 / 布局 | `NoteCard.vue` 的 `.card-header` | 工具栏 opacity 为 0，但仍占据整行，正文上方形成无用空白 | 已处理：操作移到正文/标签之后，持续可见，不再依赖 hover 才能发现 |
| P2 / 响应式 | 卡片与输入框的操作按钮 | 约 35×28px 的按钮使用 48px 伪元素扩大点击区域，相邻区域相互重叠；手机容易误点 | 已处理：实际 44×44px 控件，不用重叠伪元素；卡片选择按钮保持 28px 外观并以 44px 伪元素保障触控 |
| P2 / 响应式 | `NotesView.vue` 的 `.batch-action-bar` | 375px 下删除等尾部操作需要横向滚动；放大文字时横向裁切更严重 | 已处理：手机两行布局、可换行前导区、安全区域留白和选中状态底部空间；320px + 根字号 200% 下验证无工具栏内部溢出 |
| P2 / 响应式与交互 | 卡片和批量颜色面板 | 卡片面板向右对齐，批量面板居中展开且点击外部不关闭、不支持方向键切换 | 已处理：左对齐展开在 320px 视口内；批量面板补充外部点击关闭、方向键漫游切换和 Escape 回退焦点 |
| P2 / 主题 | `NotesView.vue` 的批量栏/面板 | 引用未定义的 `surface-container-highest`，深色模式仍回退到浅色背景 | 已处理：使用既有 `surface-container-high`，悬停/选中/删除反馈也使用主题 tokens |
| P2 / 文案与语义 | `NotesView.vue` 的空状态和 section | 只切换归档视图也被描述成“筛选无结果”；未置顶时 section 指向不存在的标题 | 已处理：区分真实搜索、归档、回收站与首次写作；添加工作区标题，按实际标题设置 section 名称 |
| P2 / 性能 | `NotesView.vue` 的 `transition: max-width`；`NoteComposer.vue` 的进度条 `transition: width` | detector 标记布局属性动画。最大宽度切换会重排卡片；进度条 width 动画与上传事件冲突 | 已处理：移除非必要宽度与最大宽度过渡，完全通过机械检测并消除布局抖动 |
| P3 / 视觉一致性 | 卡片、输入框、空状态、批量栏 | emoji 操作图标跨平台外观不同；卡片标题比例过大，列表/引用缺乏基本阅读节奏 | 已处理：复用 SVG，收敛标题大小但保留级别差异，补充块间距、列表缩进和引用样式，减轻静态阴影 |

## 机械检测

在最终界面上执行：

```sh
/home/lin/.pi/agent/skills/impeccable/scripts/impeccable detect --json \
  web/src/App.vue web/src/views/NotesView.vue \
  web/src/components/NoteCard.vue web/src/components/NoteComposer.vue
```

返回仅 2 条 warning（已消除全部布局过渡警告），无 error：保留的 2 条 `side-tab` 为置顶笔记侧边标识和标准 Markdown 引用边框，具有明确语义。

## 验证

- `npm --prefix web run typecheck`：通过。顺手修复现有账户菜单的事件签名问题：显式调用 `closeUserMenu()`，不把 MouseEvent 传给布尔参数。
- `npm --prefix web test`：7 个文件、96 项通过。包含新增的打开按钮、输入框展开/清空、归档/回收站空状态回归。现有链接测试产生两条 JSDOM 不支持完整导航的 stderr，但没有失败。
- `npm run build`、`git diff --check`：通过。生成文件只由构建脚本更新，不手改、不提交。
- Chromium：320、375、768、1280、1440px × 浅/深色，共 10 组无页面或卡片操作栏溢出，卡片操作均为实际 44×44px。
- 实际键盘 Enter 打开详情、Escape 关闭；卡片/输入框/批量颜色面板边界验证；Chromium CDP 合成触摸选择笔记；320px 下根字号放大至 200% 的批量工具栏验证。
- 长搜索词、标签、无空格正文、文件名和宽 Markdown 表格的合成样本未造成页面水平溢出。表格仍可局部横向滚动。
- 使用本地 Vite 与浏览器拦截的合成 API 数据，不读取真实账户、笔记或附件，不调用生产写接口。业务搜索正确性不由这些 UI fixture 证明。

会话内截图位于 `.playwright-mcp/`（本地未提交产物）：`ui-before-desktop.png`、`ui-before-mobile.png`、`ui-after-light-1440.png`、`ui-after-dark-1440.png`、`ui-after-light-375.png`、`ui-after-dark-375.png`、`ui-after-mobile-batch-dark.png`、`ui-after-mobile-long-content.png`。最终截图关闭动画以避免捕捉主题过渡中间帧。

## 保留的优点与后续顺序

保留：集中主题/笔记颜色 tokens、Markdown 安全渲染及缓存、组件行为测试、颜色面板原有方向键导航、标签过滤和附件链接行为。

1. **P1 `/impeccable harden`**：统一弹窗焦点生命周期并加入键盘回归，先解决删除确认的已验证缺口。
2. **P2 `/impeccable optimize`**：移除非必要布局过渡；先测量，再决定是否改上传进度实现。
3. **`/impeccable polish`**：将详情、设置、登录等弹窗纳入同一轮主题和图标精修。

可以按上述顺序逐项执行；之后重跑 `/impeccable audit`。如要改品牌或整体视觉方向，先用 `/impeccable init` 补充 PRODUCT.md，而不是在精修中暗自替换现有风格。

**未验证**：真实 iOS/Android 设备、Safari/Firefox、屏幕阅读器、完整浏览器缩放、全部 note-color 与控件状态的数值对比度、生产性能和后端测试。合成触摸不是物理设备验收；本轮也没有完成全站 WCAG 合规或完整弹窗可访问性修复。没有提交、推送或部署。
