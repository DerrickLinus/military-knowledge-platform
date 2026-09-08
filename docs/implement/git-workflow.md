# Git 工作流实施手册

> 适用仓库：military-knowledge-platform（基于腾讯 WeKnora 二次开发）
> 更新日期：2026-09-08

## 1. 仓库结构

### 1.1 远程配置

| 远程 | 地址 | 用途 |
|---|---|---|
| `origin` | https://github.com/DerrickLinus/military-knowledge-platform | 自己的仓库，日常开发与发布 |
| `upstream` | https://github.com/Tencent/WeKnora.git | 官方仓库，跟住上游更新 |

### 1.2 本地 worktree 布局

| 目录 | 分支 | 用途 |
|---|---|---|
| `~/projects/WeKnora` | `main` | 主目录：同步上游、提交方案文档、发布 |
| `~/projects/WeKnora-WK-001` | `feat/WK-001-wiki-source-scope`（按需切换） | 功能开发现场 |

**核心认知：两个 worktree 共享同一个 `.git` 对象库。**

由此得出三条铁律：

1. **commit 不需要 push，另一个 worktree 就能看到。**
   在 `WeKnora` 的 main 上提交后，`WeKnora-WK-001` 里立刻可以 `git log main`、`git merge main`。
   push 只影响 GitHub 上的其他克隆（如 mentor、其他机器）。
2. **在任一 worktree 里 `git fetch upstream`，另一个 worktree 立刻能看到官方最新代码。**
   fetch 更新的是共享的 `upstream/main` 引用，两边都能直接 `git log upstream/main`、`git merge upstream/main`。
3. **分支属于仓库，不属于 worktree。**
   任何 worktree 里创建/合并分支，两边都可见。一个分支同一时刻只能被一个 worktree 检出。

## 2. 跟住官方更新（上游同步）

```bash
# 在主目录（main 分支）执行
git fetch upstream
git merge upstream/main      # 用 merge，不用 rebase：不改写已有提交，单人开发无冲突复杂度代价
git push origin main         # 发布到自己的仓库
```

功能分支（在 WeKnora-WK-001 里）想吃官方更新：

```bash
git merge upstream/main
```

> 原则（对应总体方案决策 D7"跟住上游"）：**官方更新合并得越勤，冲突越小**。建议每周至少同步一次；官方发大版本时立即同步。

## 3. 功能开发流程（串行开发标准节奏）

```
issue → 新分支 → 开发 → PR → 合并 → 删分支 → 下一个功能
```

| 产物 | 需要吗 | 说明 |
|---|---|---|
| issue | ✅ | 需求/决策记录，串起 mentor 评审上下文 |
| 分支 | ✅ 必须 | `feat/WK-<编号>-<功能名>`，main 只放可发布状态 |
| worktree | ❌ 按需 | 串行开发**不需要**新 worktree，在 WeKnora-WK-001 里切分支即可 |
| PR | ✅ 推荐 | 合并前走一遍 diff 审查（可用 Claude Code /review），GitHub 保留功能级历史 |
| 合并 | ✅ 尽快 | 功能验收通过就合并，分支拖得越久与 main 差距越大 |

### 3.1 开工

```bash
# 在 WeKnora-WK-001 里
git checkout main && git pull          # 从最新 main 起步
git checkout -b feat/WK-002-strict-graph
```

### 3.2 开发中（与 main / upstream 保持同步）

```bash
git merge main                 # main 上有新提交时（如文档、其他已合并功能）
git merge upstream/main        # 官方有新提交时
```

### 3.3 完工

```bash
git push origin feat/WK-002-strict-graph
# GitHub 上开 PR → 审查 diff → merge
# 本地同步
git checkout main && git pull
git branch -d feat/WK-002-strict-graph          # 删除本地分支
git push origin --delete feat/WK-002-strict-graph   # 删除远程分支
```

合并前自查：PR diff 干净（无无关改动混入）、CI 通过、本地功能验证过。

## 4. 何时新建 worktree

**只有一个场景需要新 worktree：需要并行。**
即"这个功能做到一半，要临时切去修另一个问题，且不想破坏当前现场"（依赖环境、运行中的服务等）。

```bash
git worktree add ../WeKnora-WK-002 -b feat/WK-002-xxx
```

代价：每个 worktree 是一份完整目录（node_modules、构建产物各装一遍），WSL 下磁盘成本不小。串行开发就用 WeKnora-WK-001 一个现场，**用分支名表达任务，不用 worktree 目录表达任务**。

用完清理：

```bash
git worktree remove ../WeKnora-WK-002   # 在另一个 worktree 里执行
```

## 5. 常用命令速查

| 场景 | 命令 |
|---|---|
| 查看远程 | `git remote -v` |
| 查看 worktree | `git worktree list` |
| 同步官方到 main | `git fetch upstream && git merge upstream/main` |
| 功能分支吃官方更新 | `git merge upstream/main`（在功能分支上） |
| 功能分支吃 main 更新 | `git merge main`（在功能分支上） |
| 新建功能分支 | `git checkout -b feat/WK-<编号>-<功能名>` |
| 查看共享对象库里的分支 | `git log main` / `git log upstream/main`（无需 push/pull） |
| 提交信息风格 | `feat(模块): 描述` / `docs(plan): 描述`（跟仓库现有 conventional commits） |

## 6. 已定决策记录

| # | 决策 | 结论 |
|---|---|---|
| G1 | 上游同步方式 | `git merge upstream/main`，不用 rebase |
| G2 | 串行开发布局 | 不新建 worktree，WeKnora-WK-001 一个现场按功能切分支 |
| G3 | worktree 新建时机 | 仅需并行开发时 |
| G4 | 功能单元闭环 | issue + 分支 + PR + 合并，缺一不可 |
| G5 | push 的意义 | 只为发布到 GitHub 给他人/其他机器，本机 worktree 间共享不需要 |
