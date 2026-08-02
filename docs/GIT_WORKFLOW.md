# Git Workflow

本文档从 `v4.4.1` 起作为本项目的默认 Git 提交规范。`v4.4.0` 以前的提交历史作为真实开发档案保留，不再为了展示效果反复压缩；`v4.4.0` 是第一版按功能 / 修复 / 发布收口整理的版本。

## 历史边界

- `v4.3.0` 及以前：保留真实旧历史。可以通过 `v4.0.0`、`v4.1.0`、`v4.2.0`、`v4.3.0` tags 回看对应版本。
- `v4.4.0`：作为整理后的示例版本，保留 `feat/v4.4-*`、`fix/v4.4-*` 和 `release/v4.4.0` 作为参考。
- `v4.4.1` 及以后：严格按本文档执行。`main` 只保留稳定主线，功能和修复先进入主题分支。

旧历史如果需要再整理，只做轻量处理：补标签、补文档、清理无意义远端分支。不要为了标题更好看而改写大量旧 commit，除非已经建立备份并确认旧历史不再需要作为原始参考。

## 分支模型

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
- 不提交真实密钥、服务器地址、私有 token、临时调试账号或本地生成文件。

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
2. 本 worktree 的候选 160 与共享生产库独立抽奖迁移 160–165 冲突，集成时通常重编号到 166+；性能/旧邮箱同号 159 也按实际顺序处理。
3. 编号改变后同步迁移源、baseline marker、专项文档、发布清单和回滚说明，并重新生成/验证 baseline。
4. 数据库先于依赖新列/RPC 的 API；GitHub 真实浏览器回归完成后才开放 provider。
5. commit、push、部署、生产 migration 和生产账号修改分别授权，不能相互推定。

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

如果涉及公共 API、缓存、数据库迁移、邮件、账号安全或自动化，还要补对应专项脚本。认证变更必须运行 `test:auth-hardening-phase-a`、`test:auth-hardening-phase-cd` 和 baseline 验证；GitHub 真实浏览器回归不能由单元测试替代。验证结果应写进提交前说明、PR 描述或交接文档。

## 历史改写守则

已经推送的 `main` 默认不改写。确实需要整理历史时，先完成以下动作：

1. 建立本地备份分支。
2. 导出 bundle 备份。
3. 确认改写前后的最终文件树一致，或明确列出差异。
4. 使用 `--force-with-lease` 推送，避免覆盖远端新提交。
5. 同步更新 `todo` 和 `SESSION_HANDOFF.md`。

根目录 `todo` 与 `SESSION_HANDOFF.md` 位于主仓库外层，不会随 `gacha-analyzer` 提交自动进入 Git。发布交接时必须单独检查它们是否已经同步，仓库内文档提交不要假定会包含这两个文件。

历史改写只适合本练习项目或已明确允许的仓库。协作仓库默认用新增修复提交解决问题。
