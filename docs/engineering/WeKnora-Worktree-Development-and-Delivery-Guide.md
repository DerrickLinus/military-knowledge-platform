# WeKnora Worktree 开发、Docker 验证与私有仓库交付指南

> 适用目录：
>
> - 主工作目录：`/home/dlh/projects/WeKnora`（检出 `main`）
> - 功能开发现场：`/home/dlh/projects/WeKnora-WK-001`（按功能切换分支，如 `feat/WK-002-xxx`）
> - 私有仓库远程：`origin`（`DerrickLinus/military-knowledge-platform`）
> - 腾讯上游远程：`upstream`（`Tencent/WeKnora`）

> 2026-09-08 更新：生产前端已改为 Docker 多阶段构建，无需宿主机预生成 `frontend/dist`。文中的 WK-001 测试用例和备份标签是该功能的示例，其他功能应替换为对应编号；合入上游后的数据库迁移不能套用 WK-001“无迁移”的假设。

## 1. 先理解三个彼此独立的概念

### 1.1 Git worktree

Worktree 只是同一个 Git 仓库的另一份工作目录。每个 worktree 可以检出不同分支，适合同时开发多个功能。

创建 worktree 不会自动执行以下操作：

- 不会复制被 Git 忽略的 `.env`；
- 不会复制 `frontend/node_modules`；
- 不会创建 Docker 容器；
- 不会复制 Docker Volume；
- 不会构建镜像；
- 不会部署代码。

因此，新 worktree 能否运行，取决于它是否能访问数据库、Redis、DocReader 等依赖，以及 app/frontend 是否由这个 worktree 的代码构建。

### 1.2 Docker 镜像和容器

- **镜像**是已经编译好的程序模板，例如 `wechatopenai/weknora-app:latest`。
- **容器**是镜像启动后的进程，例如 `WeKnora-app`。
- 修改 worktree 中的源码不会自动改变已经运行的容器。
- 必须重新构建镜像并重建容器，运行中的系统才会使用新代码。

### 1.3 Git push/PR 与本地 Docker

本地 Docker 只用于验证代码。Git push 和 PR 只提交 Git 跟踪的文件。

以下内容不会随 Git push 上传：

- `.env`；
- `frontend/node_modules`；
- `frontend/dist`（如果被忽略）；
- 本地 Docker 镜像；
- 本地 Docker 容器和 Volume；
- PostgreSQL 中的本地数据。

因此，功能验证通过后可以提交代码、push 功能分支并向私有仓库的 `main` 创建 PR，不需要把本地 Docker 一起提交。

## 2. 当前推荐的运行模式

当前机器已经运行一个 Compose 项目：

```text
项目名：weknora
配置目录：/home/dlh/projects/WeKnora
Web：http://localhost
API：http://localhost:8080
```

该项目中已有数据库、Redis、Neo4j、DocReader 和已有业务数据。为了直接使用已有知识库数据验证 WK-001，推荐：

1. 保留现有 PostgreSQL、Redis、Neo4j 和 DocReader；
2. 从 `WeKnora-WK-001` 构建新的 app/frontend 镜像；
3. 只替换现有 `WeKnora-app` 和 `WeKnora-frontend`；
4. 使用原数据库中的资料、Wiki 页面和 `SourceRefs` 验证局部图谱；
5. 测试结束后可以恢复原镜像。

这样做的原因：

- `docker-compose.yml` 使用固定容器名和固定端口，两个完整 Compose 栈不能直接同时运行；
- 原 PostgreSQL 没有映射宿主机端口，不适合直接让另一个本地 Go 进程访问；
- 新建独立数据库会缺少已有用户、知识库和 Wiki 数据，准备测试数据成本更高；
- WK-001 没有数据库迁移，只替换 app/frontend 不会破坏数据库结构；
- `--no-deps` 可以确保替换 app/frontend 时不重建数据库等依赖服务。

> 注意：替换 app/frontend 会暂时改变 `http://localhost` 上运行的版本。如果这台机器同时被其他人使用，应先沟通。整个过程不会删除数据库，但 app/frontend 重启时会有短暂停机。

## 3. 当前 worktree 的一次性准备

以下步骤通常只需为每个新 worktree 执行一次。

### 3.1 确认目录和分支

```bash
cd /home/dlh/projects/WeKnora-WK-001

git branch --show-current
git status
git worktree list
```

当前应处于：

```text
feat/WK-001-wiki-source-scope
```

### 3.2 复制 `.env`

`.env` 被 Git 忽略，所以创建 worktree 时不会自动出现。复制一次即可：

```bash
cd /home/dlh/projects/WeKnora-WK-001

cp -p /home/dlh/projects/WeKnora/.env .env
chmod 600 .env
```

验证：

```bash
test -f .env && echo ".env 已就绪"
git check-ignore -v .env
```

不要把 `.env` 加入 Git，其中可能包含数据库密码、JWT 密钥和模型凭据。

如果后续原目录 `.env` 有必要的配置变化，再手动同步。日常重新打开 worktree 不需要重复复制。

### 3.3 不必在 WSL 全局安装 Node.js

原 `WeKnora` 目录之所以不需要 Node，是因为它运行的是已经构建好的前端镜像。

当前 `frontend/Dockerfile` 使用多阶段构建，在 builder 阶段自动执行 `npm ci` 和 `npm run build`，再把生成的静态资源复制到 nginx 镜像。直接构建 frontend 镜像即可，不需要手动预构建宿主机的 `frontend/dist`。

运行前端测试、类型检查或 Vite 热更新时，仍可使用临时 Linux Node 容器：

```text
node:24-bookworm 镜像：第一次会下载，以后由 Docker 缓存
一次性 Node 容器：命令结束后由 --rm 自动删除
frontend/node_modules：保存在当前 worktree 中
frontend/dist：仅手动运行构建时生成，不是 Docker 镜像构建的输入
```

这不会把 Node 安装到 WSL，也不会影响其他 worktree。

## 4. WK-001 自动化验证

在进行浏览器验证前，先运行低成本自动化检查。

### 4.1 检查代码差异

```bash
cd /home/dlh/projects/WeKnora-WK-001

git status --short
git diff --check
git diff --stat
```

确认没有意外文件、密钥或与 WK-001 无关的修改。

### 4.2 后端定向测试

```bash
cd /home/dlh/projects/WeKnora-WK-001

env GOCACHE=/tmp/weknora-go-cache \
go test ./internal/application/service ./internal/handler \
  -run 'TestComputeGraphSubset|TestParseWikiGraphKnowledgeIDs|TestValidateWikiGraphKnowledgeIDs' \
  -count=1
```

再做接口和实现编译检查：

```bash
env GOCACHE=/tmp/weknora-go-cache \
go test ./internal/application/repository ./internal/types/interfaces ./internal/router \
  -run '^$' \
  -count=1
```

这些测试重点验证：

- `knowledge_ids` 的解析、去空和去重；
- 最多 100 个资料 ID；
- 资料必须可访问且属于当前知识库；
- `SourceRefs` 的 `id` 和 `id|title` 两种格式；
- 多资料 OR 语义；
- 诱导子图边界；
- 局部节点度数；
- overview、ego、类型过滤和 limit；
- ego 不会穿透到来源范围外页面。

### 4.3 首次安装当前 worktree 的前端依赖

需要在 worktree 中运行测试、类型检查或 Vite，且尚未安装依赖或 `frontend/package-lock.json` 发生变化时执行。仅构建生产镜像不需要这一步：

```bash
cd /home/dlh/projects/WeKnora-WK-001

docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e npm_config_cache=/tmp/npm-cache \
  -v "$PWD:/workspace" \
  -w /workspace/frontend \
  node:24-bookworm \
  bash -lc 'npm ci'
```

以后仅修改普通 `.vue`/`.ts` 文件时，不必重复 `npm ci`。

### 4.4 前端定向测试和类型检查

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e npm_config_cache=/tmp/npm-cache \
  -v "$PWD:/workspace" \
  -w /workspace/frontend \
  node:24-bookworm \
  bash -lc 'npm test -- src/views/knowledge/wiki/wikiGraphScope.test.ts src/views/knowledge/wiki/WikiBrowser.sourceScope.test.mjs && npm run type-check'
```

### 4.5 构建前端生产镜像

前端代码变化后，直接构建镜像。Dockerfile 会在容器内安装依赖并编译，无需先执行宿主机 `npm run build`：

```bash
docker compose -p weknora --env-file .env -f docker-compose.yml \
  build --build-arg VITE_FRONTEND_COMMIT="$(git rev-parse --short HEAD)" frontend
```

当前 Dockerfile 默认 `NODE_MAX_OLD_SPACE_SIZE=4096`（MB）。出现堆内存不足时，可在确认 Docker 可用内存后增加 `--build-arg NODE_MAX_OLD_SPACE_SIZE=6144`。不要把既往机器的内存设置当成所有环境的固定要求。

验证镜像中存在静态入口：

```bash
docker run --rm --entrypoint sh wechatopenai/weknora-ui:latest \
  -c 'test -s /usr/share/nginx/html/index.html'
```

构建成功不等于类型检查或测试通过，第 4.4 节仍应按改动范围执行。镜像名示例使用默认 `latest`；设置了 `WEKNORA_VERSION` 时应使用实际标签。

## 5. 首次替换 app/frontend 前备份原镜像

只需在第一次构建 WK-001 镜像前执行一次。不要在后续迭代时覆盖这些备份标签，否则备份会指向开发镜像。

```bash
docker image tag \
  "$(docker inspect --format '{{.Image}}' WeKnora-app)" \
  weknora-backup/app:before-wk001

docker image tag \
  "$(docker inspect --format '{{.Image}}' WeKnora-frontend)" \
  weknora-backup/frontend:before-wk001
```

确认备份存在：

```bash
docker image inspect weknora-backup/app:before-wk001 >/dev/null
docker image inspect weknora-backup/frontend:before-wk001 >/dev/null
echo "原镜像已备份"
```

备份镜像不包含数据库；数据库仍然保存在 Docker Volume 中，替换 app/frontend 不会删除它。

### 5.1 合入上游后先备份数据库

新 app 启动可能执行数据库迁移。存在迁移时，先暂停应用写入，使用 `pg_dump -Fc` 备份业务数据库、`pg_dumpall --globals-only` 备份角色，再用 `pg_restore --list` 检查归档目录。备份应保存在仓库外、限制文件权限；目录可读取不等于已完成恢复演练。

启用 Neo4j 时应使用离线 dump 或停止 Neo4j 后备份其数据卷；上传文件也应保留对应数据卷备份。备份完成后恢复依赖服务，再更新 app/frontend。不要删除原 Volume。

镜像标签适合本地快速回滚，也可用 `docker image save --output <备份路径> <备份标签...>` 另存离线镜像。发生数据库迁移后，只换回旧镜像不一定兼容，需评估是否一并恢复数据库备份；恢复操作会覆盖备份之后的新数据。

## 6. 从当前 worktree 构建并运行 app/frontend

### 6.1 构建镜像

如果后端和前端都修改了：

```bash
cd /home/dlh/projects/WeKnora-WK-001

docker compose \
  -p weknora \
  --env-file .env \
  -f docker-compose.yml \
  build \
  --build-arg VITE_FRONTEND_COMMIT="$(git rev-parse --short HEAD)" \
  --build-arg COMMIT_ID_ARG="$(git rev-parse --short HEAD)" \
  app frontend
```

如果只修改后端：

```bash
docker compose -p weknora --env-file .env -f docker-compose.yml build app
```

如果只修改前端，直接执行（已完成第 4.5 节且源码未变化时无需重复构建）：

```bash
docker compose -p weknora --env-file .env -f docker-compose.yml \
  build --build-arg VITE_FRONTEND_COMMIT="$(git rev-parse --short HEAD)" frontend
```

`docker compose build` 只在本机构建镜像，不会 push 到 Docker Hub。

### 6.2 为什么显式使用 `-p weknora`

Compose 默认使用目录名作为项目名：

- `/home/dlh/projects/WeKnora` 默认项目名是 `weknora`；
- `/home/dlh/projects/WeKnora-WK-001` 默认项目名是 `weknora-wk-001`。

现有数据库、网络和 Volume 属于 `weknora`。指定 `-p weknora` 后，从 worktree 启动的 app/frontend 会继续连接现有依赖和数据，而不是尝试创建一套冲突的新服务。

### 6.3 只重建 app/frontend 容器

后端和前端都修改时：

```bash
docker compose \
  -p weknora \
  --env-file .env \
  -f docker-compose.yml \
  up -d \
  --no-deps \
  --force-recreate \
  app frontend
```

只修改后端时：

```bash
docker compose -p weknora --env-file .env -f docker-compose.yml \
  up -d --no-deps --force-recreate app
```

只修改前端时：

```bash
docker compose -p weknora --env-file .env -f docker-compose.yml \
  up -d --no-deps --force-recreate frontend
```

参数含义：

- `-p weknora`：使用现有 Compose 项目、网络和 Volume；
- `--env-file .env`：使用当前 worktree 的环境配置；
- `--no-deps`：不重建 PostgreSQL、Redis、Neo4j、DocReader；
- `--force-recreate`：即使配置相同，也让容器采用刚构建的新镜像。

不要执行以下命令：

```bash
docker compose down -v
```

`-v` 会删除 Compose Volume，可能导致本地数据库数据丢失。

### 6.4 检查运行状态

```bash
docker compose -p weknora --env-file .env -f docker-compose.yml ps
docker logs --tail 100 WeKnora-app
curl -i http://localhost:8080/health
```

正常结果：

- `WeKnora-app` 最终为 `healthy`；
- `WeKnora-frontend` 为 `Up`；
- `http://localhost:8080/health` 返回成功；
- `http://localhost` 可以打开页面。

## 7. 浏览器端验证 WK-001

访问：

```text
http://localhost
```

此时页面使用的是当前 worktree 构建的 app/frontend，但数据来自原有 PostgreSQL。

### 7.1 基础交互验证

1. 登录系统；
2. 打开一个已经生成 Wiki 的知识库；
3. 进入“Wiki → 图谱”；
4. 确认左上角出现“按来源资料筛选（可多选）”；
5. 选择一份资料；
6. 确认状态卡显示“局部图谱”；
7. 清空筛选，确认恢复全库图谱。

### 7.2 单资料验证

选择资料 A，验证：

- 只返回 `SourceRefs` 与 A 相交的 Wiki 页面；
- scope 外页面不会出现；
- 图中只保留入选页面之间的边；
- 节点大小和 overview 排序使用局部度数，而不是全库度数。

### 7.3 多资料 OR 语义

同时选择资料 A、B，验证：

- 结果是 A 和 B 对应页面的并集；
- 页面只需引用 A 或 B 中任意一份资料即可进入图谱；
- 未引用 A/B 的页面不会进入图谱。

### 7.4 ego、Bloom、Frontier 和搜索边界

在局部图谱中依次验证：

- 双击节点进入 ego；
- 点击“展开邻居”；
- 使用 Bloom；
- 使用 Frontier 批量扩展；
- 使用图谱页面搜索。

所有新增节点和搜索结果都必须保持在当前资料 scope 内，不能通过 scope 外页面继续遍历。

### 7.5 空状态

选择没有关联 Wiki 页面的资料，验证：

- 页面显示局部图谱空状态；
- 来源资料选择器仍然可见；
- 用户可以清空或重新选择资料。

### 7.6 浏览器 Network 验证

打开浏览器开发者工具：

```text
F12 → Network
```

选择资料后应出现类似请求：

```http
GET /api/v1/knowledgebase/<kb_id>/wiki/graph?mode=overview&limit=500&knowledge_ids=<doc-id-1>,<doc-id-2>
```

图谱搜索应出现：

```http
GET /api/v1/knowledgebase/<kb_id>/wiki/search?q=<keyword>&limit=20&knowledge_ids=<doc-id-1>,<doc-id-2>
```

重点确认：

- `knowledge_ids` 是逗号分隔；
- 多资料是 OR 语义；
- 清空筛选后不再发送 `knowledge_ids`；
- 非法、跨知识库或无权限资料 ID 返回 400；
- 最多允许 100 个资料 ID。

## 8. 下次重新打开 worktree 时要做什么

不需要每次从头重复所有步骤。

### 8.1 没有修改代码，只是继续使用

```bash
cd /home/dlh/projects/WeKnora-WK-001

docker compose -p weknora --env-file .env -f docker-compose.yml ps
curl -i http://localhost:8080/health
```

如果 app/frontend 仍然是之前从该 worktree 构建的版本，直接访问 `http://localhost` 即可。

可查看容器最近一次由哪个目录创建：

```bash
docker inspect WeKnora-app \
  --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}'
```

如果显示 `/home/dlh/projects/WeKnora-WK-001`，说明容器最近由当前 worktree 的 Compose 配置创建。

### 8.2 只修改 Go 后端

执行：

```bash
docker compose -p weknora --env-file .env -f docker-compose.yml build app
docker compose -p weknora --env-file .env -f docker-compose.yml \
  up -d --no-deps --force-recreate app
```

不需要重新构建 frontend。

### 8.3 只修改 Vue/TypeScript 前端

执行：

```bash
docker compose -p weknora --env-file .env -f docker-compose.yml \
  build --build-arg VITE_FRONTEND_COMMIT="$(git rev-parse --short HEAD)" frontend
docker compose -p weknora --env-file .env -f docker-compose.yml \
  up -d --no-deps --force-recreate frontend
```

不需要重新构建 app。

### 8.4 前后端都修改

重新运行：

1. 后端和前端定向测试；
2. `docker compose build app frontend`（沿用第 6 节项目参数，并注入前端提交号，静态资源在镜像内编译）；
3. `up -d --no-deps --force-recreate app frontend`；
4. 浏览器回归验证。

### 8.5 什么情况下需要重新执行 `npm ci`

仅在以下情况下执行：

- 新 worktree 中还没有 `frontend/node_modules`；
- `frontend/package-lock.json` 改变；
- 依赖损坏或版本不一致。

普通 `.vue`/`.ts` 修改不需要重新执行 `npm ci`。

### 8.6 什么情况下不需要重建 Docker 镜像

- 只修改文档；
- 只运行单元测试；
- 代码没有变化；
- 暂时只做代码审查。

## 9. 可选：前端快速热更新模式

如果需要频繁调整前端，不想每次构建 frontend 镜像，可以保留当前 worktree 后端 app 容器，在一次性 Node 容器中运行 Vite：

```bash
cd /home/dlh/projects/WeKnora-WK-001

docker run --rm -it \
  --name weknora-wk001-vite \
  --user "$(id -u):$(id -g)" \
  --add-host=host.docker.internal:host-gateway \
  -p 5173:5173 \
  -e npm_config_cache=/tmp/npm-cache \
  -e VITE_DEV_PROXY_TARGET=http://host.docker.internal:8080 \
  -v "$PWD:/workspace" \
  -w /workspace/frontend \
  node:24-bookworm \
  bash -lc 'test -d node_modules || npm ci; npm run dev -- --host 0.0.0.0'
```

访问：

```text
http://localhost:5173
```

特点：

- `.vue`/`.ts` 修改后自动热更新；
- `Ctrl+C` 后临时容器自动删除；
- 不需要在 WSL 安装 Node；
- 最终提交前仍应构建正式 frontend 镜像，并通过 `http://localhost` 做一次生产构建验证。

## 10. WK-001 提交到私有仓库的流程

### 10.1 确认远程仓库

```bash
git remote -v
```

应明确：

- `origin` 是私有/个人仓库 `DerrickLinus/military-knowledge-platform`；
- `upstream` 是腾讯源仓库 `Tencent/WeKnora`。

WK-001 应 push 到 `origin`，PR 的 base 也应选择私有仓库的 `main`。除非明确计划向腾讯贡献，否则不要把功能分支 push 到 `upstream`。

### 10.2 提交前检查

```bash
cd /home/dlh/projects/WeKnora-WK-001

git status --short
git diff --check
git diff --stat
```

确认 `.env`、`node_modules`、模型密钥和数据库文件没有进入待提交列表。

再次运行本指南第 4、6、7 节的测试和浏览器验证。

### 10.3 创建提交

先查看即将提交的内容：

```bash
git diff
```

确认无误后：

```bash
git add docs frontend internal website-docs
git status --short
git commit -m "feat(wiki): add source-ref-scoped graph"
```

不要盲目使用 `git add -A`，除非已经确认工作区不存在无关文件。

### 10.4 Push 功能分支

```bash
git push -u origin feat/WK-001-wiki-source-scope
```

如果远程分支已经建立，后续只需：

```bash
git push origin feat/WK-001-wiki-source-scope
```

### 10.5 更新或创建 PR

在 GitHub 私有仓库中确认：

```text
base repository: DerrickLinus/military-knowledge-platform
base branch: main
compare branch: feat/WK-001-wiki-source-scope
```

当前已有 Draft PR 时，push 会自动更新该 PR，不需要重新创建。

PR 内容至少应包含：

- 需求背景和 ADR；
- `knowledge_ids` 接口语义；
- SourceRefs 是页面级近似来源，不是边级证据；
- 前后端实现摘要；
- 自动化测试命令和结果；
- 浏览器截图或录屏；
- 已知限制；
- 回滚方式。

代码审查和检查通过后，将 Draft 标记为 Ready for review，再按私有仓库策略合并到 `main`。

### 10.6 不要“直接 push main 再创建 PR”

正确流程是：

```text
功能分支 commit
→ push 功能分支到 origin
→ PR: 功能分支 → origin/main
→ 审查和 CI
→ 合并 PR
```

不建议直接将本地功能提交 push 到 `origin/main`，否则会绕过 PR 审查。

### 10.7 Docker 是否影响 PR 合并

本地 Docker 不影响 Git PR：

- 不需要 push 本地测试镜像；
- 不需要把容器保持运行；
- 不需要提交 `.env`；
- PR 合并后，本地容器不会自动改变；
- 本地 Docker 验证只是证明构建产物可以工作。

仓库的 `Build and Push Docker Image` 工作流只在 `main` 或 `v*` tag push 时触发。PR 合并到 `main` 后，它可能尝试向 Docker Hub 推送镜像。

如果私有仓库没有配置以下 GitHub Actions Secrets，该工作流可能失败：

```text
DOCKERHUB_USERNAME
DOCKERHUB_PASSWORD
```

这与本地验证是两件事：

- 代码可以成功合并，但镜像发布失败；
- 如果分支保护要求该工作流成功，则必须先配置 Secrets；
- 如果私有仓库不需要发布 Docker Hub 镜像，应由仓库维护者决定是否调整工作流；
- 不要为了让 WK-001 通过而擅自修改发布策略。

## 11. PR 合并后的清理与同步

### 11.1 恢复原本地镜像（如果不再继续调试 WK-001）

当前环境使用 `latest`，可以恢复备份：

```bash
docker image tag \
  weknora-backup/app:before-wk001 \
  wechatopenai/weknora-app:latest

docker image tag \
  weknora-backup/frontend:before-wk001 \
  wechatopenai/weknora-ui:latest

cd /home/dlh/projects/WeKnora

docker compose \
  -p weknora \
  --env-file .env \
  up -d \
  --no-deps \
  --force-recreate \
  app frontend
```

也可以从 Docker Hub 重新拉取官方镜像后重建：

```bash
cd /home/dlh/projects/WeKnora
docker compose pull app frontend
docker compose up -d --no-deps --force-recreate app frontend
```

### 11.2 同步私有仓库 main

```bash
cd /home/dlh/projects/WeKnora

git fetch origin
git switch main
git pull --ff-only origin main
```

### 11.3 删除已完成 worktree（可选）

先确认功能分支已经合并、push 完成且 worktree 干净：

```bash
cd /home/dlh/projects/WeKnora-WK-001
git status
```

然后从主工作目录执行：

```bash
cd /home/dlh/projects/WeKnora

git worktree remove /home/dlh/projects/WeKnora-WK-001
git branch -d feat/WK-001-wiki-source-scope
```

不要使用 `--force` 删除存在未提交改动的 worktree。

远程功能分支是否删除取决于仓库策略；GitHub 合并 PR 时通常可以选择自动删除。

## 12. 后续功能是否需要新 worktree

### 12.1 继续完善同一个 WK-001

以下情况继续使用当前 worktree 和分支即可：

- PR 尚未合并；
- 代码审查要求修改；
- WK-001 范围内的 bug；
- WK-001 的测试、文档或小型补充。

修改后重复“相关自动化测试 → 相关镜像重建 → 浏览器验证 → commit → push”。

### 12.2 开发新的独立功能（串行开发，默认做法）

不需要新建 worktree。在现有 `WeKnora-WK-001` worktree 中基于最新 `main` 创建新分支：

```bash
cd /home/dlh/projects/WeKnora
git fetch origin
git switch main
git pull --ff-only origin main

cd /home/dlh/projects/WeKnora-WK-001
git checkout -b feat/WK-002-new-feature main
```

切换后该 worktree 就是新功能的工作现场，`.env`、`frontend/node_modules` 等一次性准备全部复用，无需重复。

### 12.3 仅在需要并行开发时新建 worktree

只有当上一个功能做到一半需要临时切换到另一个任务、且不想破坏当前现场时，才新建 worktree：

```bash
cd /home/dlh/projects/WeKnora

git worktree add \
  -b feat/WK-003-another-feature \
  /home/dlh/projects/WeKnora-WK-002 \
  main
```

新 worktree 需要一次性准备：

```bash
cd /home/dlh/projects/WeKnora-WK-002
cp -p /home/dlh/projects/WeKnora/.env .env
chmod 600 .env
```

如果需要前端测试或 Vite，再为这个 worktree 执行一次 `npm ci`；仅构建生产镜像不需要。Docker 中的 `node:24-bookworm` 镜像可以复用；每个 worktree 的 `frontend/node_modules` 是独立的，任务完成、合并后用 `git worktree remove` 清理。

### 12.4 是否每个 worktree 都要替换 app/frontend

不一定。

- 只做文档：不需要；
- 只做后端纯函数并有充分单元测试：开发过程中可以暂不替换；
- 只做前端纯工具函数：可以先跑前端测试；
- 需要真实登录、数据库、接口和 UI 联调：需要将要验证的 worktree 构建为 app/frontend；
- 最终合并前：建议至少进行一次完整 Docker 集成验证。

由于现有 Compose 使用固定容器名和端口，同一时间通常只能有一个 worktree 的 app/frontend 占用 `80/8080`。切换验证目标时，应从目标 worktree 重新构建并重建 app/frontend。

如果未来确实需要多个功能环境同时运行，应另外编写 Compose override，为每个环境设置不同的：

- project name；
- container name；
- Web/API 端口；
- 网络名；
- Volume 名；
- 数据库实例。

这属于多环境基础设施建设，不是普通功能 worktree 的必需步骤。

## 13. 日常开发速查表

| 场景 | 需要做什么 |
|---|---|
| 下次打开 worktree，代码未改变 | 检查容器和 health，直接打开 `http://localhost` |
| 首次创建 worktree | 复制 `.env`；前端测试或 Vite 需要执行一次 `npm ci` |
| 修改 Go 后端 | 后端测试 → build app → recreate app |
| 修改 Vue/TS 前端 | 前端测试 → build frontend（镜像内编译）→ recreate frontend |
| 前后端都修改 | 两侧测试 → 构建两侧 → recreate app/frontend → 浏览器回归 |
| 只修改文档 | 文档检查即可，不重建 Docker |
| push 功能分支 | 不需要 push Docker 镜像 |
| PR 合并 main | 与本地 Docker 独立；远程镜像发布取决于 Actions Secrets |
| 新的独立 Issue（串行开发） | 在 WeKnora-WK-001 中基于最新 `main` 新建分支，无需新建 worktree |
| 新的独立 Issue（需并行） | 从最新 `main` 创建新分支和新 worktree，用完 `git worktree remove` 清理 |
| 同一 PR 的审查修改 | 继续使用原 worktree 和分支 |

## 14. 故障排查

### 14.1 `docker compose ps` 在 worktree 中为空

原因是默认 project name 变成了目录名。使用：

```bash
docker compose -p weknora --env-file .env -f docker-compose.yml ps
```

查看所有 Compose 项目：

```bash
docker compose ls
```

### 14.2 出现 `DB_USER variable is not set`

说明当前 worktree 缺少 `.env`，重新执行：

```bash
cp -p /home/dlh/projects/WeKnora/.env /home/dlh/projects/WeKnora-WK-001/.env
chmod 600 /home/dlh/projects/WeKnora-WK-001/.env
```

### 14.3 页面没有出现局部图谱筛选器

依次检查：

1. 是否从目标分支和 worktree 构建；
2. 是否成功执行了 `docker compose build frontend`（包含静态资源编译）；
3. 是否使用 `--force-recreate frontend`；
4. 浏览器是否强制刷新；
5. `docker inspect WeKnora-frontend` 的 working directory 是否指向当前 worktree。

### 14.4 请求没有 `knowledge_ids`

检查：

1. 是否真的选择了来源资料；
2. 浏览器是否加载了新 frontend；
3. app/frontend 是否来自同一次 worktree 构建；
4. Network 中查看的是 `/wiki/graph`，而不是其他图谱接口。

### 14.5 接口返回 400

可能原因：

- `knowledge_ids` 显式为空；
- 超过 100 个资料 ID；
- ID 不存在；
- ID 属于另一个知识库；
- 当前用户没有资料访问权限。

### 14.6 GitHub Actions 镜像工作流失败

先进入失败 Job 查看具体步骤。如果失败点是 Docker Hub Login，检查私有仓库 Actions Secrets：

```text
DOCKERHUB_USERNAME
DOCKERHUB_PASSWORD
```

这不会影响已经完成的本地 Docker 验证，也不会改变 Git worktree 中的代码。

## 15. 最终原则

1. 一个独立功能对应一个分支；串行开发复用同一个 worktree 切换分支，仅在需要并行时新建 worktree；
2. `.env` 每个 worktree 复制一次，永远不提交；
3. 当前项目不必在 WSL 全局安装 Node，可以使用一次性 Node 容器；
4. 源码修改不会自动进入运行中的 Docker，相关镜像必须重新构建；
5. 为复用已有数据，只替换 app/frontend，不重建依赖服务；
6. 单元测试负责快速验证，Docker + 浏览器负责最终集成验证；
7. push 的是功能分支，PR 合并到私有仓库 `origin/main`；
8. 本地 Docker 和 Git PR 相互独立，镜像发布由远程 CI/CD 单独负责；
9. 新 worktree 不必立刻部署，只有需要真实联调时才切换 app/frontend；
10. 永远不要为了切换代码随意执行 `docker compose down -v`。
