# M01：基于 SourceRefs 的局部 Wiki 图谱

- 状态：已完成
- 关联 Issue：WK-001
- 关联 ADR：ADR-0001
- 关联分支：feat/WK-001-wiki-source-scope
- 关联 PR：

## 阶段目标

让用户在 Wiki 图谱中选择一到多份资料，并基于 `WikiPage.SourceRefs` 查看这些资料参与生成页面的近似局部诱导子图，同时保持原有全库 overview/ego 行为兼容。

## 完成内容

- 图谱和 Wiki 搜索接口支持 `knowledge_ids`。
- 后端完成资料归属校验、SourceRefs 两种格式匹配、OR 过滤、诱导边构建和局部度数重算。
- overview、ego、类型过滤、limit、bloom 和 frontier 均支持相同 scope。
- 前端增加可搜索的资料多选器、局部图谱状态提示、空状态和四语言文案。
- API、Swagger、Wiki 功能说明和开发记录已同步。

## 个人负责内容

需求梳理、接口设计、后端图算法、资料权限校验、前端交互、测试与文档。

## 关键技术问题

- SourceRefs 只描述页面级来源参与关系，因此输出是近似局部图谱，不声称边级证据。
- 局部度数必须基于诱导边重算，避免 scope 外链接影响节点大小与 overview 排名。
- ego BFS 必须运行在过滤后的邻接表上，防止穿透 scope 外页面。

## 测试与验证

- 后端 scoped 核心与请求解析/归属校验定向测试通过。
- repository 接口编译检查通过。
- 前端测试和类型检查因当前 WSL 1/Windows Node 环境不可执行，已记录在开发日志。
- 全量 Go 套件存在与本功能无关的 sandbox、系统依赖和既存用例阻断，详见开发日志。

## 前后效果对比

- 之前：图谱只能按页面类型查看全库 overview 或单节点 ego。
- 现在：可选择资料后查看与其 SourceRefs 相交页面的局部图谱，边、度数、搜索和扩展操作均限制在相同范围；清空资料恢复原行为。

## 性能与兼容性

- 不需要数据库迁移，也不触发 LLM。
- 不传 `knowledge_ids` 时保持旧接口语义。
- scoped 请求显著减少返回和渲染节点，但第一阶段仍复用 `ListAll`，后端读取复杂度仍为 O(全库 Wiki 页面数)。

## 已知限制

- SourceRefs 不能证明具体边由哪份资料产生。
- 最多选择 100 份资料，以控制查询字符串、权限校验和数据库过滤成本。
- 大型知识库的 DB 侧按 scope 投影尚未下推到图谱主查询。

## 后续计划

- 增加页面贡献和链接证据记录，实现边级来源追踪。
- 根据性能数据评估图谱主查询的 SQL 下推与缓存。
- 在具备 Linux Node 和完整 sqlite 开发依赖的 CI/开发机上补跑前端与全量 Go 验证。

## 证据索引

- Issue：WK-001
- ADR：ADR-0001
- Commit：
- PR：
- 测试报告：`docs/engineering/development-log/WK-001-source-ref-scoped-wiki-graph.md`
- 演示截图：
