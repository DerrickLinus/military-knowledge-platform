# WeKnora 平台技术方案（一期 MVP）

> 版本：v0.1（评审稿）
> 日期：2026-08-31
> 作者：dlh
> 状态：待 mentor 评审
>
> 需求依据：[02-WeKnora平台PRD](./02-WeKnora平台PRD.md)（用户故事与验收标准）；架构与权限依据 [01-总体方案](./01-总体方案.md)。

---

## 1. WeKnora 现状与改造原则

### 1.1 基座概况（调研结论）

- **形态**：Go(Gin+GORM+dig) 单体后端 + Vue3 前端 + Python docreader 解析微服务（gRPC）；docker-compose / k8s(Helm) / Lite 三种部署形态；当前版本 v0.7.2，MIT 许可。
- **存储**：默认 ParadeDB（PostgreSQL 17，自带 BM25 + pgvector）——**单机部署无需独立向量库**；Redis（Asynq 异步任务队列、SSE 续传）；Neo4j 图谱为可选。
- **Agent 引擎**：ReAct 循环（`internal/agent/engine.go`），SSE 流式（EventBus 30+ 事件类型），内置 24+ 工具（`internal/agent/tools/`），MCP 外挂、技能系统（`internal/agent/skills/`）、沙箱执行。
- **RAG 管线**：插件化流水线 `internal/application/service/chat_pipeline/`（查询理解/扩展/混合检索/重排/引用等 20+ 插件）；混合检索（向量+BM25 → RRF → rerank → 父子块扩展）。
- **文档管线**：上传 → docreader 解析为 Markdown（多引擎可路由：builtin / markitdown / opendataloader / MinerU / MinerU Cloud / PaddleOCR-VL(/Cloud)，见 `internal/infrastructure/docparser/engine_registry.go`）→ 分块（标题感知/父子分块，`internal/infrastructure/chunker/`）→ 异步向量化/富化（6 个 Asynq worker 池，`internal/router/task.go`）。
- **权限**：租户（空间）隔离 + 空间内 RBAC 四级角色 + 跨租户 Organization 共享（`kb_shares`/`agent_shares`）；API 三态认证（JWT / API Key 能力级、fail-closed / OIDC）。**无文档级权限**。
- **官方扩展点文档**：`website-docs/06-development/03-extension-points.md`（9 大扩展点，接口定义+注册点速查表）——本方案所有改造路径均以该文档为准。

### 1.2 改造原则（决策 D7）

**跟住上游，一切扩展走官方扩展点，不动权限内核。** 依据调研：PRD 一期 5 个功能没有一个必须突破扩展边界。所有新增走四种官方路径之一：

| 路径 | 适用 | 注册点 |
|---|---|---|
| A. 纯配置 | 新内置 Agent / 提示词模板 / 技能 | `config/builtin_agents.yaml`、`config/prompt_templates/`、`skills/preloaded/` |
| B. 新 Agent 工具 | 需要新能力（导图生成、综述生成） | `internal/agent/tools/definitions.go` + `internal/application/service/agent_service.go` 的 `registerTools()` |
| C. 流水线插件 | RAG 检索行为增强 | `chat_pipeline.Plugin` 接口 |
| D. 新表/端点 | 新数据结构（语料数据集等，二期） | `migrations/versioned/` 一对 up/down + `internal/types/` GORM 模型 + `internal/handler/` + `internal/router/routes_*.go` |

## 2. 功能一：智能问答（含教学模式增强）

### 现状
问答全链路为现成能力：会话/多轮/SSE 流式/引用回溯/@知识库与@文档圈定均已有。内置 Agent 与提示词均为 YAML 配置（路径 A）。

### 差距
仅缺"教学模式"的提示词设计与模型质量验证。无代码改动。

### 实现路径
1. `config/builtin_agents.yaml` 新增内置 Agent「学习助手」（模式 `quick-answer` 或 `smart-reasoning`，评审时按 POC 效果定）；
2. `config/prompt_templates/` 新增教学模式提示词：三段结构（条款依据 → 概念解释 → 检验性追问），强调引用强制；
3. （可选）`config/agent_type_presets.yaml` 注册为预设类型，供员工一键选用。

### POC（开发前置，见 PRD §3.1 验收）
用 `qwen3.8-27b` 跑 30 个条令问答用例，验证引用准确率与教学模式三要素；质量不足则按总体方案 §4 换 `deepseek-v4-flash-0731` 或升级大模型重跑。

### 工作量
提示词设计与调优 2～3 人日；POC 2 人日。**合计约 4～5 人日。**

## 3. 功能二：文档研读（对照式 + 章节导航）

### 现状
- 分块已带标题层级（标题感知分块 + 父子分块，`internal/infrastructure/chunker/`），chunk 有双链表与父块关系（`internal/types/chunk.go`）——章节结构数据已具备；
- 会话支持 @文档圈定与 `RetrieveKBOnlyWhenMentioned`；引用（KnowledgeReferences）已能定位到 chunk；
- 前端已有文档预览与引用跳转的组件基础（`frontend/src/views/`）。

### 差距
没有"左侧原文 + 右侧会话"的研读视图，以及基于文档结构的目录树导航、引用点击反向定位阅读区。**纯前端为主的改造，后端基本复用。**

### 实现路径
1. 前端新增研读视图（路由 + 页面）：左栏按 chunk 标题层级渲染目录树与正文，右栏内嵌会话组件（复用现有 chat 组件）；
2. 章节圈定：选中章节 → 以现有 @文档提及机制传入该文档，会话检索范围收敛（若需 chunk 范围级过滤，在 `chat_pipeline` 加一个轻量过滤插件，路径 C，仅过滤 MentionedItems 指定的 chunk 范围）；
3. 引用反向定位：回答引用点击 → 左栏滚动至对应 chunk 并高亮（chunk id 已在引用数据中）；
4. 需要小量后端配合时（如按文档拉取带层级的 chunk 树），优先复用现有"列出知识分块"接口族（`list_knowledge_chunks` 工具背后的服务），不满足再补一个只读端点。

### 工作量
前端研读视图与目录树 8～12 人日；范围圈定与引用定位联调 3～5 人日；后端配合 2～3 人日。**合计约 13～20 人日，是五项功能中最重的前端工程。**

## 4. 功能三：自动综述（生成 + 沉淀回库）

### 现状
- Wiki 生成已有 `synthesis`/`comparison` 页面类型（`internal/types/wiki_page.go`），证明"多文档合成"提示词工程平台已做过一轮，可借鉴其提示词与引用组装方式；
- 异步任务框架（Asynq worker 池，`internal/router/task.go`）、文档入库管线、引用数据结构均为现成；
- 前端已有任务进度类交互与文档列表多选的基础组件。

### 差距
没有"多选文档 → 生成综述 → 入库"的独立功能入口与任务流。

### 实现路径
1. **后端新端点 + 异步任务**（路径 D 的轻量版，不建新表，任务参数直接复用现有任务模型）：
   - `POST` 综述生成接口：入参 = 文档 id 列表 + 用户补充要求；创建 Asynq 任务；
   - 任务执行：拉取所选文档内容（含 chunk）→ 提示词组装（借鉴 Wiki synthesis）→ LLM 生成带引用综述 → 预览暂存；
2. **入库**：用户预览/改标题确认后，走现有文档入库服务将综述写为所选知识库的新文档（Markdown 直接入库，天然走分块/向量化管线）；
3. **前端**：文档列表多选 → "生成综述" → 任务进度 → 预览确认 → 入库成功提示；
4. 综述文档打自定义元数据标记（`CustomMetadata`，`internal/types/knowledge.go`）标明来源文档 id 列表，便于溯源与后续语料生成复用。

### 风险与对策
- 长文档集合超出上下文：一期限制所选文档总 chunk 量（超出提示分批），并利用父块/摘要富化数据压缩；
- 生成质量：POC 用例纳入问答用例集；不足则该任务路由到大模型（WeKnora 支持按 Agent/任务选模型）。

### 工作量
后端端点+任务 4～6 人日；提示词与引用组装 3～4 人日；前端 4～5 人日。**合计约 11～15 人日。**

## 5. 功能四：思维导图生成

### 现状
- 前端已有 Mermaid 渲染封装（`frontend/src/utils/mermaidShared.ts`）与 17 种工具结果渲染卡片可参考；
- Agent 工具注册机制成熟（路径 B：`internal/agent/tools/definitions.go` 常量 + `agent_service.go` 的 `registerTools()`）。

### 差距
无"文档 → 导图"功能。需要新工具 + 提示词 + 渲染卡片 + 导出。

### 实现路径
1. 新 Agent 工具 `generate_mindmap`（路径 B）：入参文档 id；实现 = 取文档标题层级 + 各节要点 → 提示词生成 Mermaid mindmap 语法 → 返回文本；
2. 提示词模板入 `config/prompt_templates/`；**降级策略**：LLM 输出解析失败时直接用标题层级拼装纯结构导图（保证可用性，PRD §3.4 验收兜底）；
3. 前端：新增导图工具结果渲染卡片（Mermind mindmap 渲染 + 节点折叠）+ 文档详情"生成思维导图"入口 + "导出 Markdown 大纲"按钮（前端把 mindmap 树转大纲文本，无后端参与）；
4. 若走"工具"路径，导图能力同时可被问答会话复用（"帮我画个导图"）——比做成孤立按钮更符合平台形态，一期两者都要：入口按钮内部同样调用该工具。

### 工作量
工具+提示词 2～3 人日；渲染卡片与导出 3～4 人日。**合计约 5～7 人日。**

## 6. 功能五：扫描件支持（OCR 入库）

### 现状
- 解析引擎抽象已支持多引擎路由：`internal/infrastructure/docparser/engine_registry.go`，可按文件类型配置 `ParserEngineRules`，且支持按批次覆盖（`process_config`）；
- 已对接的 OCR 级引擎：MinerU（本地）、MinerU Cloud、PaddleOCR-VL（本地）、PaddleOCR-VL Cloud；
- docreader（Python）为解析进程，OCR 引擎部署在其侧或经其调用。

### 差距
MVP 环境尚未部署任何 OCR 引擎；OCR 质量未用真实扫描件验证。

### 实现路径
1. **引擎选型（两个候选，评审定夺）**：
   - **方案甲（推荐）：本地部署 MinerU 容器**——数据不出私有云（与 PRD §6 数据安全口径一致），docreader 侧加容器、`ParserEngineRules` 将 PDF 路由到 MinerU。代价：单机资源占用（建议配 GPU；CPU 可跑但慢）；
   - **方案乙：MinerU Cloud / PaddleOCR-VL Cloud API**——零部署，但扫描件内容出网，**需评审确认是否允许**；dmxapi 上的 `DeepSeek-OCR`/`qwen-vl-ocr-latest` 若要接入需按 `internal/models/provider/` 自定义 provider 适配（额外工作量）。
2. 配置 `ParserEngineRules`：扫描特征明显的 PDF 路由 OCR 引擎，文本型 PDF 走原生解析；同批次可手动覆盖引擎（重试用）；
3. 解析状态与异常重试：沿用现有文档解析状态流（`SummaryStatus` 类似的 status 列与任务面板），补一个"重新解析（指定引擎）"入口（WeKnora 已有批量重解析能力，确认覆盖引擎参数即可）；
4. **质量 POC**：取 5 份典型扫描件（清晰度从好到差）过全管线，校验 PRD §3.5 的 80% 章节识别口径。

### 工作量
引擎部署与路由配置 3～4 人日；重试入口与状态联调 2 人日；POC 与调参 2～4 人日。**合计约 7～10 人日**（方案乙若需自定义 provider 适配，另加 3～5 人日）。

## 7. 权限三层落地（零代码改造项）

按总体方案 §3.2 执行，全部为**配置与管理流程**，不含开发：

1. 建各部门空间（租户），成员按部门加入；RBAC 默认角色：普通员工 viewer/contributor，部门管理员 admin；
2. 建"全公司"Organization，各部门空间加入；公共知识库共享至该组织（组织角色 viewer）；
3. 员工个人知识库建在个人默认空间；
4. **实施时验证**：`internal/middleware/kb_access.go` 的三层可见性解析（自有 → 组织共享 → 共享 Agent 只读）在"部门空间成员看公共库"场景下的实际表现，以真实账号逐层验证；注意 `tenant.enable_rbac` 灰度开关默认开启，验收权限前确认未被关闭。

工作量：配置 1～2 人日 + 验证 2 人日。**合计约 3～4 人日。**

## 8. 部署方案（MVP）

- **形态**：单机 docker-compose 核心 6 服务（frontend / app / docreader / postgres(ParadeDB) / redis / sandbox）+ MinerU 容器（若选方案甲）；
- **模型接入**：所有模型经 dmxapi 网关 URL + Key，在 WeKnora 模型管理中按"自定义 OpenAI 兼容 Provider"配置（chat / embedding / rerank 分别登记）；**实施时验证**：`qwen3.7-text-embedding`、`qwen3-rerank` 在 dmxapi 的接口形态与 WeKnora provider 的兼容性；
- **检索栈**：默认 ParadeDB（pgvector + BM25），`RETRIEVE_DRIVER` 保持默认，不部署独立向量库；
- **认证**：WeKnora 本地账号 + JWT；对外（应用二/三）预留 API Key（能力级授权，启用时按能力发放）；
- **可选启用**：Langfuse（链路追踪，排障用）；Neo4j 不装（图谱为演进项）。

## 9. 工程实践

- **上游同步**：main 跟随 upstream/main；每个功能一支 `feat/WK-xxx-*` 分支（沿用现有 `feat/WK-001-wiki-source-scope` 的命名约定），合并前跑通同目录既有测试；周期性 merge upstream 并回归；
- **迁移规范**：需要建表时（一期预计无需）在 `migrations/versioned/` 加一对 up/down，版本号顺延，不自改既有迁移；
- **API Key fail-closed**：新端点如需开放给 API Key 调用，必须在路由注册处声明能力（`apiKeyGroup(...)`），否则启动时断言 panic（`internal/router/router.go`）——新增对外接口时的固定检查项；
- **文档同步**：新端点写 swaggo 注解，`make docs` 重生成 Swagger，接口说明书随《接口说明书》附件维护（应用二联调前冻结）。

## 10. 工作量汇总与里程碑

| # | 项 | 工作量（人日） |
|---|---|---|
| 0 | 模型 POC（问答/综述/OCR 用例集） | 4～6 |
| 1 | 智能问答+教学模式 | 4～5 |
| 2 | 文档研读 | 13～20 |
| 3 | 自动综述 | 11～15 |
| 4 | 思维导图 | 5～7 |
| 5 | 扫描件 OCR | 7～10（+3～5 视方案乙） |
| 6 | 权限配置与验证 | 3～4 |
| 7 | 部署联调与整体验收 | 4～6 |
| — | **合计** | **51～73 人日**（单人约 10～14 周，含缓冲） |

> 估算为粗粒度（±50%），以功能为独立交付单元滚动修正。里程碑（单人节奏，暂无硬节点）：

| 里程碑 | 内容 |
|---|---|
| M1（第 1～2 周） | 环境部署 + 模型接入 + 权限三层配置验证 + 模型 POC |
| M2（第 2～3 周） | 智能问答（含教学模式）可用 |
| M3（第 4～5 周） | 文档研读可用 |
| M4（第 6～7 周） | 自动综述 + 思维导图可用 |
| M5（第 8 周+） | 扫描件全链路 + 整体验收，MVP 收口 |

## 11. 待确认事项（评审输出）

| # | 事项 | 影响 |
|---|---|---|
| 1 | Rerank 型号：**已确认采用 dmxapi 清单中的 `qwen3-rerank`**（统一走网关；此前自配的 `qwen3-vl-rerank` 为官方 API 直连，不再使用） | 已解决 |
| 2 | OCR 方案甲/乙定夺（本地 MinerU vs Cloud，涉及扫描件是否出网） | §6 工作量与数据安全 |
| 3 | POC 用例集（30 问答 + 3 综述 + 5 扫描件）评审确认 | M1 启动条件 |
| 4 | dmxapi embedding/rerank 接口形态与 WeKnora provider 兼容性验证 | M1 期间 |
| 5 | 质量不足时按任务路由大模型：**已获 mentor 允许**（综述/写作类任务质量不足即升级，成本相应上升） | 已解决 |
