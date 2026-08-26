# WK-001 开发记录

## 目标

实现基于 SourceRefs 的局部 Wiki 图谱。

## 当前实现分析

- Wiki 图谱节点：`WikiPage`，由 slug 唯一标识，节点度数原先直接使用持久化的 `len(InLinks)+len(OutLinks)`。
- Wiki 图谱边：`WikiPage.OutLinks` 中的有向 Wiki 链接；overview 截断后仅返回两端均存活的边，ego 使用无向邻接做 BFS。
- SourceRefs 格式：兼容 `"<knowledge_id>"` 和 `"<knowledge_id>|<doc_title>"`。
- 现有接口：`GET /api/v1/knowledgebase/:kb_id/wiki/graph`，支持 overview、ego、types、limit；本次增加可选 `knowledge_ids`。
- 前端入口：`frontend/src/views/knowledge/wiki/WikiBrowser.vue` 的图谱视图。

## 实施任务

- [x] 扩展图谱请求参数
- [x] 校验 Knowledge IDs
- [x] 过滤 Wiki 页面
- [x] 构建局部边
- [x] 重算局部节点度数
- [x] 支持 overview 和 ego
- [x] 增加前端资料多选器
- [x] 增加后端测试
- [x] 增加前端测试
- [x] 更新接口文档

## 开发过程

### 2026-08-25

- 完成需求分析
- 确定采用 SourceRefs 近似过滤方案
- 记录 ADR-0001
- 为图谱和 Wiki 页面搜索接口增加 `knowledge_ids` 查询参数，采用逗号分隔、OR 语义，最多 100 个。
- 对请求 ID 去空、去重，并校验资料可访问且属于当前知识库；显式空 scope 和跨库 ID 返回 400。
- scoped 图谱先按 SourceRefs 和页面类型得到候选集合，再构造诱导边、重算局部度数，并在该集合上执行 overview 排序或 ego BFS。
- 前端增加来源资料远程多选器，并将 scope 贯穿 overview、ego、bloom、frontier 和远程节点搜索。
- 增加 scoped 空状态、近似来源说明和中英韩俄文案。
- 更新手写 API 文档、Swagger 参数和 Wiki 功能说明。

## 问题与解决方案

- **局部节点仍显示全库度数**：若直接复用持久化 InLinks/OutLinks 数量，overview 排名和节点大小会受 scope 外页面影响。最终从候选页面之间的有向边重新计算两端度数。
- **ego 可能通过 scope 外页面穿透**：不再直接遍历原始 InLinks/OutLinks，而是先构建诱导图无向邻接，再执行 BFS。
- **远程页面搜索可能跳出局部图谱**：同步给 `/wiki/search` 增加相同 `knowledge_ids` scope，并在数据库排名和 limit 之前过滤。
- **快速切换 scope 的旧请求回写**：前端为异步图谱请求记录 scope key；响应返回时 scope 已变化则丢弃旧结果。
- **无节点时无法清空筛选**：来源资料选择器在图谱为空时仍保持显示。

## 验证记录

- 通过：`go test ./internal/application/service ./internal/handler -run 'TestComputeGraphSubset|TestParseWikiGraphKnowledgeIDs|TestValidateWikiGraphKnowledgeIDs' -count=1`
- 通过：`go test ./internal/application/repository -run '^$' -count=1`（接口与实现编译检查）
- 前端新增 `wikiGraphScope.test.ts` 和 `WikiBrowser.sourceScope.test.mjs`。
- 当前环境无法执行前端测试与 `vue-tsc`：只有 Windows Node/npm，运行时因 WSL 1 检测直接退出。
- 全量 Go 测试存在环境/基线阻断：sandbox 禁止 `httptest` 监听端口；container 编译缺少 `sqlite3.h`；handler 全量测试另有既存 `TestPutTenantParserConfigAdminPreservesRedactedSecrets` 失败。上述均不在本次改动路径内。
