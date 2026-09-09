# WK-002 开发记录

- 状态：已实现并通过自动化检查与浏览器人工验收（2026-09-09，`http://localhost` 生产镜像）；PR 待创建
- 关联 Issue：[WK-002 / #5](https://github.com/DerrickLinus/military-knowledge-platform/issues/5)
- 关联 ADR：[ADR-0002](../adr/ADR-0002-client-side-answer-export.md)
- 关联里程碑：[M02](../milestones/M02-export-answer.md)
- 计划分支：`feat/WK-002-export-answer-to-word`（沿用 Issue 中的分支命名，功能范围包含 Markdown）

## 目标

在聊天页回答操作区提供统一导出入口，支持将单条 AI 回答导出为 Word（`.docx`）或 Markdown（`.md`），用于线下留存、汇报和二次编辑。

两种格式均包含对应问题、最终回答正文和引用来源。Issue 原始范围为 Word 导出，本版规划纳入讨论中补充的 Markdown 导出与双格式菜单。

## 当前实现分析

- 普通回答入口：`frontend/src/views/chat/components/botmsg.vue`，已有复制、添加到知识库等操作。
- Agent 回答入口：`frontend/src/views/chat/components/AgentStreamDisplay.vue`，独立维护最终回答操作区。
- 两类回答已有 `answerFullyRendered` 状态，可用于等待流式输出和打字机展示完成。
- 聊天页 `frontend/src/views/chat/index.vue` 已通过 `userQuery` 传入对应问题。
- 普通回答读取 `content` 或 `session.content`；Agent 使用回答事件，现有 `getActualContent` 还会回退到最后一段 thinking。导出应只取最终回答，不能直接沿用思考内容回退。
- 引用数据主要来自 `knowledge_references`，`frontend/src/utils/referenceSources.ts` 已实现网页、文档和工具来源分类及部分去重，`citationMarkdown.ts` 处理正文引用。
- 本功能中的“引用来源”对应聊天引用数据，不等同于 WK-001 中的 `WikiPage.SourceRefs` 字段。
- 前端已有 `marked` 和 `docx-preview`；后者用于预览。实施时新增 `docx@^9.7.1` 作为生成库（见 2026-09-09 记录）。

## 实施任务

- [x] 梳理 Issue、现有回答操作区和引用数据结构
- [x] 编写开发记录、ADR 和里程碑初稿
- [x] 核对并锁定 `docx` 依赖版本，验证浏览器构建兼容性（锁定 `docx@^9.7.1`，构建成功且生独立懒加载 chunk）
- [x] 定义共享导出内容模型，提取问题、最终回答和引用来源
- [x] 完成引用标签转换、来源去重和正文编号映射
- [x] 实现 UTF-8 Markdown 文档生成
- [x] 实现 Markdown tokens 到 Word 原生结构的转换
- [x] 实现统一导出菜单及下载、加载和失败状态
- [x] 接入普通回答和 Agent 回答，覆盖历史消息
- [x] 补齐现有国际化语言的相关文案
- [x] 增加导出内容与交互测试，执行类型检查和构建
- [x] 完成浏览器下载及 Word/WPS 人工验收（2026-09-09 通过，见验证记录）
- [x] 更新实现、验证和交付记录

## 开发过程

### 2026-09-08

- 读取 Issue #5，确认问题、回答正文、引用来源和文件命名要求。
- 将 Markdown 导出纳入同一功能，采用一个按钮提供两种格式。
- 形成前端本地生成方案，拟共享内容整理逻辑，分别生成 `.docx` 和 `.md`。
- 编写工程文档初稿；业务代码、依赖安装、部署及功能测试尚未执行。

### 2026-09-09

- 安装 `docx@^9.7.1`（自带 `jszip` 依赖，供测试解包验证复用），确认与 Vite 构建兼容。
- 新增 `frontend/src/utils/answerExport.ts`：共享内容快照模型、引用标签到统一编号的转换、来源去重映射、文件名生成、Markdown 文档生成与 Blob 下载。
- 为复用引用解析逻辑，`citationMarkdown.ts` 导出原有内部工具 `parseTagAttributes` 和 `docTitlesMatch`。
- 新增 `frontend/src/utils/answerWordExport.ts`：私有 `marked` 实例解析 tokens，映射为 docx 原生标题、段落、有序/无序列表（含嵌套与任务列表）、表格、代码块、引用块、超链接与强调样式；A4 页面、Calibri + Microsoft YaHei 默认字体；`docx` 模块动态导入并缓存。
- 新增共享组件 `frontend/src/views/chat/components/AnswerExportMenu.vue`：悬停/点击/键盘三种方式打开菜单，Escape 关闭并回焦，方向键切换菜单项，生成期间禁用重复触发，失败后允许重试；导出时同步快照消息状态。
- `botmsg.vue` 工具栏接入导出菜单（嵌入页按规划排除）；`AgentStreamDisplay.vue` 工具栏接入，回答内容直接取 `event.content`（不经 `getActualContent` 的 thinking 回退），引用来源复用抽屉聚合规则 `getReferencesForDrawer`。
- 补齐 zh-CN / en-US / ja-JP / ko-KR / ru-RU 五种语言的 `chat.answerExport.*` 文案（含文档内分区标签）。
- 顺手修复既有的 ja-JP `knowledgeEditor.wikiBrowser.*` 7 个缺失键（上游合并遗留，阻塞 `check-i18n` 通过，与本功能无关）。
- 新增 26 个定向测试（内容模型 11、Word 包结构 6、工具栏接入 9），全部通过。
- 验证过程中发现宿主机 `npm run build` 在默认 Node 堆下 OOM；Dockerfile 已默认 `NODE_MAX_OLD_SPACE_SIZE=4096`，属既有环境特性，非本次改动引入；本地以 `NODE_OPTIONS=--max-old-space-size=6144` 完成构建。
- 浏览器预览（Vite 热更新，指南 §9 模式，端口 5173）中发现导出菜单向下弹出会被底部聊天输入框遮挡；改为默认向上弹出，并在工具栏距视口顶部不足 200px 时自动向下（`AnswerExportMenu.vue` 的 `popupUp` 方向自适应）。
- 按指南 §8.3 重建 frontend 生产镜像并重建容器，`http://localhost` 完成浏览器人工验收（详见验证记录）。

## 实现方案

### 交互与范围

- 在回答操作区增加导出图标，沿用现有 TDesign 组件、图标和工具栏样式。
- 悬停时展示 `Word (.docx)` 与 `Markdown (.md)` 菜单；点击也可打开，支持触屏和键盘操作、Escape 关闭及焦点恢复。
- 鼠标从按钮移入菜单时保持菜单打开；选择格式后直接生成并下载。
- 仅完整且非空的最终回答允许导出；生成期间禁用重复操作，失败后恢复并允许重试。
- 首版覆盖主聊天页普通问答、Agent 问答及历史回答；不扩展嵌入页、小程序和整段会话批量导出。
- 文件名为 `WeKnora-回答-{消息短ID}-{时间戳}.{docx|md}`；ID 缺失时使用时间戳，清理文件名非法字符。

### 内容整理与来源映射

- 导出开始时取得内容快照，避免异步生成期间切换会话导致问题和回答错配。
- 共享模型包含问题、清理后的最终回答 Markdown、规范化来源和文件命名信息。
- 复用最终回答包装清理逻辑；不导出思考过程、工具调用日志和页面操作元素。已作为引用提供的工具来源元数据可以进入来源列表。
- 优先使用消息聚合引用；实施时核对 Agent 历史消息从工具事件恢复来源的现有逻辑，复用可用数据。
- 复用来源归并规则，并建立 chunk ID、URL 等引用标识到导出编号的独立映射；不同来源分类使用统一编号，不能直接复用各分类从 1 开始的序号。
- 正文引用转换为 `[1]` 等可读编号，文末列出相应来源名称、可用 URL 和已有定位信息；不凭空生成页码、链接或资料信息。
- Markdown 使用普通编号和文末来源列表，不依赖特定编辑器的脚注扩展。对无法解析的引用保留可读来源文字或缺失标识，避免静默丢失或错误对应。
- 问题或来源缺失的历史消息仍可导出有效正文，缺失项明确标注或省略，不从其他消息猜测补齐。

### 两种格式的输出

| 内容 | Word | Markdown |
|---|---|---|
| 问题、回答、来源分区 | 原生标题和段落 | Markdown 标题和段落 |
| 标题、粗体、斜体、链接 | 对应 Word 格式 | 保留 Markdown 语义 |
| 有序、无序及嵌套列表 | 原生列表及层级缩进 | 保留列表结构 |
| 表格 | 可编辑表格，处理长文本换行 | 保留 Markdown 表格 |
| 引用块、代码块 | 独立段落样式，代码使用等宽字体 | 保留引用与代码围栏 |
| 正文引用 | 编号及文末来源列表 | 编号及文末来源列表 |
| 图片 | 说明文字和可用链接 | 标准图片语法；内部资源需转换为可读说明或可用链接 |
| 公式、Mermaid | 保留源码 | 保留公式和 Mermaid 源码 |

Word 使用 A4 页面、统一中文字体设置和段落间距，具体样式通过样本文档验证。字体不嵌入文档，客户端替代字体可能影响排版。首版不实现图片离线打包、原生公式转换或图表高保真导出。

### 实际代码改动

- 新增共享导出菜单组件 `frontend/src/views/chat/components/AnswerExportMenu.vue`，两个回答操作区复用。
- 新增 `frontend/src/utils/answerExport.ts`：共享内容模型、来源转换、统一编号映射、文件名和 Markdown 生成。
- 新增 `frontend/src/utils/answerWordExport.ts`：私有 `marked` 实例解析 tokens，映射到 `docx` 文档结构，按需动态加载并缓存模块。
- 修改 `botmsg.vue` 和 `AgentStreamDisplay.vue`：工具栏接入导出菜单，传入当前问题、最终回答及引用数据。
- `citationMarkdown.ts` 导出 `parseTagAttributes` 与 `docTitlesMatch` 供导出复用。
- 更新 `frontend/package.json`（新增 `docx@^9.7.1`）、锁文件和 `frontend/src/i18n/locales/` 五种语言文案。
- 下载通过 Blob 和对象 URL 完成（30 秒后释放），不调用第三方文档转换服务。
- 无后端接口或数据库迁移改动。

## 问题与解决方案

以下风险处理方案已在实现中落地，标注了各自的自动化覆盖情况；浏览器端行为仍以人工验收为准。

- **导出页面 HTML 混入控件或流式片段**：从完整回答数据构建文档，不读取操作区 DOM 作为导出正文（已实现）。
- **Agent 把 thinking 当成答案**：Agent 路径直接取 `event.content`，不经 `getActualContent` 的 thinking 回退；模型输出的 `<answer>` 包装在模型构建时剥离，有测试覆盖。
- **来源去重后编号不一致**：先建立统一来源表，再转换正文引用；同文档多 chunk、重复 URL 和缺失引用均有定向测试。
- **未知 Markdown/HTML 内容丢失**：内联/块级 HTML 剥离标签并解码实体作为可读回退，自定义引用标签单独转换；代码块内的标签保持原样（有测试覆盖）。
- **长表格和中文排版异常**：表格 100% 宽度、表头加底色；中英文分别设置字体。Word/WPS 内实际换行与分页效果待人工验收。
- **内部资源离线不可用**：非 http(s) 图片退化为“[图片: 说明]”文本，仅公开 URL 生成超链接；来源保留可读名称及可用定位信息。
- **生成库增加首屏负担**：`docx` 仅在 Word 导出时动态加载，构建产物为独立异步 chunk（约 1.43 MB，gzip 约 460 KB），不进入首屏；大文档是否需要 Worker 由人工实测决定。

## 验证记录

2026-09-09 在 worktree `WeKnora-WK-001`（分支 `feat/WK-002-export-answer-to-word`）执行以下检查；WK-001 的既往环境结果不代表本次检查结果。

### 已执行的自动化检查

- 内容与引用测试（`frontend/src/utils/answerExport.test.mjs`，11 项，全部通过）：
  - 跨分类统一编号（web/document/tool 共用 1..N 序列）；
  - 重复 URL（含尾斜杠差异）与同文档多 chunk 归并；
  - 未解析 `<kb>` 引用保留可读文档名或“未匹配来源”标记，不错误映射；
  - 未知 URL 的 `<web>` 标签追加为真实来源而非悬空标记；
  - 围栏代码块内引用标签保持原样；
  - `<answer>`/“最终答案：” 包装剥离；wiki 链接仅保留显示文本；
  - Markdown 文档问题/回答/来源分区、缺失项省略；
  - 文件名（短 ID + 时间戳、无 ID 回退、非法字符清理）。
- Word 包结构测试（`frontend/src/utils/answerWordExport.test.mjs`，6 项，全部通过）：
  - 使用 `jszip` 解包真实 DOCX，断言 `[Content_Types].xml`、`word/document.xml`、`styles.xml`、`numbering.xml` 等包结构存在；
  - 正文含问题、回答、统一来源列表及 `[n]` 编号；`Heading1/2` 样式、`w:hyperlink` 关系真实存在；
  - 表格 `w:tbl`、列表 `w:numPr`、引用块 `w:pBdr`、粗体/斜体/删除线/等宽字体 run 属性；
  - A4 页面（11905×16837 twips，docx 毫米换算舍入）与 CJK 字体（Microsoft YaHei/Calibri）默认样式；
  - 代码块内引用标签逐字保留；thinking 包装不进入导出正文。
- 工具栏接入测试（`frontend/src/views/chat/components/answerExportMenu.test.mjs`，9 项，全部通过）：两个操作区均接入、嵌入页排除、Agent 路径直接取 `event.content`（不走 thinking 回退）、引用聚合复用抽屉规则、`answerFullyRendered` 门控、悬停/点击/键盘交互与重复触发防护、i18n 键与懒加载引用。
- 全量前端检查（在 `frontend` 目录执行）：
  - `npm test`：672 项全部通过（含新增 26 项）；
  - `npm run check-i18n`：11 项全部通过（含修复既有 ja-JP `knowledgeEditor.wikiBrowser.*` 7 个缺失键后）；
  - `npm run type-check`（vue-tsc）：通过；
  - `npm run build`：成功（需 `NODE_OPTIONS=--max-old-space-size=6144`，见开发过程 2026-09-09 说明）。

### 构建产物记录

- `docx` 库（含其 jszip 依赖）形成独立异步 chunk `dist/assets/index-*.js` 约 1.43 MB（gzip 约 460 KB），仅在被引用处以 `import()` 惰性加载，未进入 `index.html` 首屏 eager 列表；聊天页首屏不承担该体积。
- 大 chunk 提示（vendor-mermaid、tdesign-icon-offline 等）为构建既有警告，未阻断构建。

### 人工验收（2026-09-09 已执行，通过）

验收环境与流程：

- 开发预览：Vite 热更新模式（指南 §9，`http://localhost:5173`，一次性 Node 容器），用于 UI 效果确认与菜单遮挡问题修复。
- 生产验收：按指南 §8.3 重建 frontend 镜像（`docker compose -p weknora … build frontend`）并 `up -d --no-deps --force-recreate frontend`，在 `http://localhost` 验收。
- 基础检查：`http://localhost/` 返回 200；`/api/v1/system/info` 返回未登录预期的 401；镜像内静态资源含导出功能代码（`answer-export-ordered`、`WeKnora-` 文件名前缀），docx 库仍为独立懒加载 chunk。
- 用户在浏览器中实际提问并导出两种格式，确认：导出按钮在回答完成后出现、菜单弹出方向正确且不再被输入框遮挡、下载成功、Word/WPS 打开无修复提示且内容可编辑。客户端具体版本未单独记录。
- 待办：最终提交后按正式提交号重建 frontend 镜像，使版本戳与代码对应。

### 已知限制（未解决）

- Word 不嵌入图片、不转换原生公式/Mermaid（保留源码），资源链接不保证离线可访问。
- 导出菜单方向自适应基于打开瞬间的视口位置，打开后不随滚动更新（菜单在滚动时关闭）。
- 大文档生成耗时的压力实测未做，暂未引入 Worker。
- 客户端（Word/WPS）具体版本未留存记录，后续需要时补充。
