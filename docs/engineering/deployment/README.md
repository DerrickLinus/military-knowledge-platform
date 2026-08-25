# 部署文档

本目录记录企业知识库平台的开发、测试、生产及离线环境部署方案。

当前系统以 WeKnora 为基础框架进行二次开发。本目录重点记录企业定制版本与上游 WeKnora 在构建、配置、发布和运维方面的差异。

## 文档目标

部署文档需要保证：

- 新成员能够根据文档搭建运行环境
- 测试人员能够部署指定版本进行验收
- 运维人员能够完成安装、升级和回滚
- 每次发布都能够追溯代码、镜像、配置和数据库版本
- 私有化及离线环境能够在不访问公网的情况下部署

## 环境划分

| 环境 | 用途 | 部署方式 | 状态 |
| --- | --- | --- | --- |
| 本地开发环境 | 功能开发与调试 | Make / Docker Compose | 使用上游现有方案 |
| 测试环境 | 功能集成与验收 | 待确定 | 未建立 |
| 生产环境 | 企业内部正式使用 | 待确定 | 未建立 |
| 离线环境 | 内网或无公网环境 | 私有镜像仓库 / 离线镜像包 | 规划中 |

## 计划中的部署文档

后续根据项目进展逐步增加以下文档：

- `local-development.md`：本地开发环境搭建与启动
- `docker-compose-production.md`：单机 Docker Compose 私有化部署
- `environment-variables.md`：环境变量及配置项说明
- `image-build-and-release.md`：镜像构建、标记和发布流程
- `offline-deployment.md`：内网及完全离线部署方案
- `upgrade-and-rollback.md`：系统升级、数据库迁移和回滚
- `backup-and-restore.md`：数据库及对象存储备份恢复
- `troubleshooting.md`：常见部署故障与排查方法

目前不需要一次性创建所有文件，在实际涉及对应工作时再增加。

## 当前部署基线

当前开发环境暂时沿用 WeKnora 原有方案：

- 开发环境使用 `make dev-start`
- 后端使用 `make dev-app`
- 前端使用 `make dev-frontend`
- 基础设施由 Docker Compose 启动
- PostgreSQL 保存业务及 Wiki 页面数据
- Redis 提供缓存等基础能力
- MinIO 提供对象存储
- DocReader 提供文档解析能力

上游文档：

- [WeKnora 开发指南](../../开发指南.md)
- [快速开发模式说明](../../快速开发模式说明.md)

企业定制版本形成独立部署流程后，应在本目录维护，不直接覆盖上游文档。

## 企业版本管理

企业定制镜像应使用独立镜像名称，例如：

```text
registry.example.com/knowledge-platform/app:<version>
registry.example.com/knowledge-platform/frontend:<version>
registry.example.com/knowledge-platform/docreader:<version>