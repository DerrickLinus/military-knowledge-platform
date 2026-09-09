# WK-002 开发前本地环境更新记录

- 日期：2026-09-08
- 状态：镜像构建、容器更新和基础检查完成；登录后的业务验收待执行
- 分支：`feat/WK-002-export-answer-to-word`
- 源码提交：`6900fe41`（本次工程指南修订尚未提交，不影响业务代码）
- Compose 项目：`weknora`
- 工作目录：`/home/dlh/projects/WeKnora-WK-001`

## 更新原因

运行中的 app/frontend 镜像构建于 2026-08-26。当前分支已合入 2026-09-08 上游前后端改动及数据库迁移，需要同步本地联调环境。

## 备份

备份目录：`/home/dlh/backups/weknora-before-wk002-20260908`，位于仓库外，目录权限 700，敏感归档权限 600。

| 文件 | 内容 | 检查结果 |
|---|---|---|
| `postgres.dump` | 在线 PostgreSQL 业务库备份，约 390 MB | 目录读取及完整解压通过 |
| `postgres-globals.sql` | PostgreSQL 全局角色信息 | 命令成功，文件已生成 |
| `postgres-quiesced.dump` | app 停止写入后的业务库备份，约 390 MB | 完整解压通过，优先用于对应停写时点恢复 |
| `neo4j-data.tar.gz` | Neo4j 停止后的数据卷归档 | gzip 完整性检查通过 |
| `data-files.tar.gz` | app 停止后的上传文件数据卷归档，约 166 MB | gzip 完整性检查通过 |
| `app-frontend-images.tar` | 旧 app/frontend 离线镜像归档，约 580 MB | `docker image save` 成功 |
| `SHA256SUMS` | 数据及镜像归档校验和 | 已生成 |

旧镜像同时保留本地标签：

- `weknora-backup/app:before-wk002-20260908`
- `weknora-backup/frontend:before-wk002-20260908`

归档校验不等于完整恢复演练。本次未备份 Redis 缓存/队列，不构成整个环境的逐字节快照。停写备份后曾短暂恢复旧 app，因此备份不包含恢复服务后可能产生的新写入。

## 构建与切换

```bash
docker compose -p weknora --env-file .env -f docker-compose.yml \
  build --build-arg VITE_FRONTEND_COMMIT=6900fe41 \
  --build-arg COMMIT_ID_ARG=6900fe41 app frontend

docker compose -p weknora --env-file .env -f docker-compose.yml \
  up -d --no-deps --no-build --force-recreate app frontend
```

- app 与 frontend 均构建成功；前端在多阶段 Dockerfile 内自动执行依赖安装及 Vite 编译。
- 前端构建存在大 chunk 提示，未阻断构建；AnyDoc 编译存在缺少文档注释的警告。
- 后端二进制提交号为 `6900fe41`，前端产物提交号为 `6900fe4`（Vite 按 7 位显示）。
- 新 app 镜像 ID：`sha256:6f156e6e9709b052e65da027ca782ea9f5d84054525712529d6ca4713439d37b`。
- 新 frontend 镜像 ID：`sha256:565e7b4d856b939101285d91a37387e1f26c71522dd921fd3e8c56758109db99`。
- PostgreSQL、Redis、DocReader 未重建，Neo4j 仅为离线备份短暂停止后启动。未删除数据卷。

## 验证结果

- app：健康检查通过，`http://localhost:8080/health` 返回 `{"status":"ok"}`。
- frontend：`http://localhost/` 返回 HTTP 200。
- nginx 代理：`/api/v1/system/info` 返回未登录时预期的 HTTP 401，说明请求到达受保护的后端接口。
- 数据库从迁移版本 83 升级到 91，`dirty=false`，启动日志确认迁移成功。
- 更新前后记录数一致：用户 1、资料 16、消息 32。计数检查不等于所有业务数据完整性验证。
- 未进行登录、模型调用、聊天、知识库操作的浏览器验收，也未将镜像构建视为单元测试或类型检查通过。

## 遇到的问题

旧 app 容器的 `/app/skills/preloaded` 绑定挂载指向已失效的 Docker Desktop 路径，停止后无法直接重启。使用备份镜像和当前 Compose 的有效挂载重建旧 app 后恢复；最终新 app 使用当前 Compose 配置，已正常启动。

## 回滚边界

旧镜像和数据库归档均已保留。当前数据库已迁移到 91，不能假设只换回旧镜像即可安全回滚。需要先暂停写入，评估迁移兼容性，并在必要时恢复停写时点的 PostgreSQL、Neo4j 和上传文件备份，再启动旧版应用；恢复会覆盖备份之后的新数据，应另行确认恢复范围。

构建指南见 [Worktree 开发与交付指南](../WeKnora-Worktree-Development-and-Delivery-Guide.md)。
