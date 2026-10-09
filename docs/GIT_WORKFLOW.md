# Git Workflow

本文档从 `v4.4.1` 起作为本项目的默认 Git 提交规范。`v4.4.0` 以前的提交历史作为真实开发档案保留，不再为了展示效果反复压缩；`v4.4.0` 是第一版按功能 / 修复 / 发布收口整理的版本。

近期交付见 [RECENT_DELIVERY_STATUS.md](RECENT_DELIVERY_STATUS.md)：PR #37／#43 已合并，v4.6.3 后的原图、卡池管理与日期修正按用户明确要求作为独立 main 提交。该次授权只解释这些交付，后续默认仍遵守主题分支流程；纯文档更新本身不表示已经授权提交或推送。

## 历史边界

- `v4.3.0` 及以前：保留真实旧历史。可以通过 `v4.0.0`、`v4.1.0`、`v4.2.0`、`v4.3.0` tags 回看对应版本。
- `v4.4.0`：作为整理后的示例版本，保留 `feat/v4.4-*`、`fix/v4.4-*` 和 `release/v4.4.0` 作为参考。
- `v4.4.1` 及以后：严格按本文档执行。`main` 只保留稳定主线，功能和修复先进入主题分支。

旧历史如果需要再整理，只做轻量处理：补标签、补文档、清理无意义远端分支。不要为了标题更好看而改写大量旧 commit，除非已经建立备份并确认旧历史不再需要作为原始参考。

## 分支模型

执行切换或拉取前先核对 `git status` 与 `git worktree list`。main 已检出于另一工作树时，使用该树或新建隔离主题树；不要为了满足下面示例而切换脏工作树、覆盖用户修改。独立版本日历是另一仓库，两边分别提交和核验；工作区根 todo／handoff 不随任一仓库提交。

2026-10-09 已将主站与日历 main 及最新文档收回各自源目录；旧主站混合修改已完整保存在恢复备份，数据工作台继续独立维护。新工作从源目录当前 main 建立主题分支，不重新应用整份旧混合备份，也不把旧候选迁移并入当前基线。公开文件与本地产物的范围见 [仓库内容规范](REPOSITORY_LAYOUT.md)。

从一个新版本开始：

```bash
git switch main
git pull
git switch -c release/vX.Y.Z
```

功能分支从发布分支切出：

```bash
git switch release/vX.Y.Z
git switch -c feat/vX.Y-topic-name
```

修复分支也从发布分支切出：

```bash
git switch release/vX.Y.Z
git switch -c fix/vX.Y-bug-name
```

命名规则：

- `release/vX.Y.Z`：一个版本的集成与发布收口。
- `feat/vX.Y-<name>`：该版本的新功能或较大体验改造。
- `fix/vX.Y-<name>`：该版本的缺陷修复或线上兼容修复。
- `docs/vX.Y-<name>`：纯文档整理，只有确实需要单独展示时使用。
- `chore/vX.Y-<name>`：依赖、CI、构建、仓库治理等维护任务。

## 提交信息

提交标题使用中文，保持短句，不写流水账。

推荐格式：

```text
feat:接入账号邮件验证
fix:修复首页倒计时显示
perf:拆分后台重型入口
docs:更新自建邮件部署指南
test:补齐公共API边界测试
chore:发布v4.4.1
```

规则：

- 标题控制在一行内，优先说明“改了什么结果”，不要列完整文件清单。
- 一个功能分支合入发布分支前，整理成 1 个主题清晰的 `feat:` 提交。
- 一个修复分支可以保留小提交，但每个提交只解决一个问题。
- 文档、测试、构建、依赖更新不要混进业务功能提交。
- 不提交真实密钥、私有服务器地址、token、可登录真实后端的调试账号或一次性本地产物。公开 synthetic 沙盒身份须保持无真实权限。
- 明确跟踪的生成产物（例如分享渲染器）随源文件同步，不因“自动生成”遗漏。

## 合入顺序

推荐顺序：

1. 功能分支完成局部验证。
2. 将功能分支整理为可读提交。
3. 合入 `release/vX.Y.Z`。
4. 在 `release/vX.Y.Z` 跑版本验证。
5. 发布收口提交：版本号、README、changelog、迁移说明、截图或公告。
6. 合入 `main`。
7. 打 `vX.Y.Z` tag。
8. 推送 `main`、`release/vX.Y.Z`、需要保留的 `feat/*` / `fix/*` 分支和 tag。
9. 等待 GitHub-connected Vercel 自动创建 Production 部署，确认状态为 Ready、生产 alias 指向新部署，并核对站点版本与公共缓存版本。

认证和数据库变更需要额外分层：

1. 合入前分别检查主站标准链、各 worktree 候选和共享生产库迁移记录；不能只按本地文件名推断生产编号。
2. 迁移编号必须以当前 baseline 覆盖范围、所有活动 worktree 候选和共享生产记录共同决定；不能只把旧文档中的 166/167 或任意尾号当作下一编号。
3. 变更 `archive/` 或 `migrations/` 后必须重新生成 baseline，并验证每个 migration block 的内容一致性和临时 PostgreSQL smoke；当前覆盖范围看 baseline 头部与 `supabase/README.md`。
4. 数据库必须先于依赖新列 / RPC 的 API 应用；API 部署仍需独立授权。每个 provider 都必须完成各自真实浏览器回归后才开放，GitHub 验收不能替代 LinuxDo / QQ 验收。
5. commit、push、部署、生产 migration 和生产账号修改分别授权，不能相互推定。生产已存在等价最终 schema 时，重编号后的仓库迁移不得重复执行。

本轮核对的具体冲突包括数据工作台候选 190/191、Vercel CPU 候选 190 与主线抽奖迁移同号。集成时重新分配编号、更新引用并生成 baseline；不要用候选的旧 baseline 覆盖主线。重构日期与维护截止的手动脚本已经执行，不进入新环境默认安装链。

主站正常发布不直接运行 `vercel deploy --prod`。只有用户明确批准紧急回滚、promotion 或切换已有部署时，才使用 Vercel CLI；操作前必须说明目标部署 URL / ID，操作后必须重新核对生产 alias。独立状态页等其他 Vercel 项目是不同部署目标，不得与主站发布混用。

发布收口提交建议固定为：

```text
chore:发布vX.Y.Z
```

## 验证口径

普通功能分支至少确认：

```bash
npm run lint
npm run test:unit
npm run build
git diff --check
```

如果涉及公共 API、缓存、数据库迁移、邮件、账号安全或自动化，还要补对应专项脚本。认证变更必须运行 `test:auth-hardening-phase-a`、`test:auth-hardening-phase-cd` 和 baseline 验证；LinuxDo 独立分支还必须运行其 `test:linuxdo-oauth` 专项。任何 provider 的真实浏览器回归都不能由单元测试替代。验证结果应写进提交前说明、PR 描述或交接文档。

## 历史改写守则

已经推送的 `main` 默认不改写。确实需要整理历史时，先完成以下动作：

1. 建立本地备份分支。
2. 导出 bundle 备份。
3. 确认改写前后的最终文件树一致，或明确列出差异。
4. 使用 `--force-with-lease` 推送，避免覆盖远端新提交。
5. 同步更新 `todo` 和 `SESSION_HANDOFF.md`。

根目录 `todo` 与 `SESSION_HANDOFF.md` 位于主仓库外层，不会随 `gacha-analyzer` 提交自动进入 Git。发布交接时必须单独检查它们是否已经同步，仓库内文档提交不要假定会包含这两个文件。

## 已合并分支闭拢

分支或 worktree 的“已合并”不能只看名称或 PR 标题。闭拢前必须：

1. 普通 merge 用 `git merge-base --is-ancestor <branch> main` 确认祖先关系；Squash 合并需结合 PR、提交内容和差异确认，`git cherry` 只能辅助比较单个等价补丁，多个提交压缩后不能仅凭 `+` 判定未合入。
2. 检查该 worktree 的跟踪改动、未跟踪文件和被忽略的本地配置；区分换行噪声、已发布修改和独有候选，不能整体复制或丢弃。
3. `.env.local`、密钥、数据库导出、Git bundle 和恢复材料不得因删除 worktree 被顺带清理；不得读取或复制其值到公开文档。
4. 干净 worktree 可先移除再用 `git branch -d` 删除分支；有本地环境配置的目录可切到 detached `main` 保留环境，分支仍用非强制删除。
5. 远端分支只在确认已合并且没有开放 PR 后删除；本地与远端引用分别核验，不使用强推或按名称批量猜测。

历史改写只适合本练习项目或已明确允许的仓库。协作仓库默认用新增修复提交解决问题。
