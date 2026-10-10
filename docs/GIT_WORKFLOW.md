# Git 工作流

`main` 保存稳定主线。常规贡献从最新主线建立主题分支，使用 Pull Request 说明改动并接受 CI 检查；集中发布时由维护者使用 `release/vX.Y.Z` 整合。

## 建立分支

先确认当前工作区没有需要保留的未提交修改：

```bash
git status --short
git switch main
git pull --ff-only
git switch -c fix/vX.Y-topic
```

功能使用 `feat/`，修复使用 `fix/`，文档使用 `docs/`，配置或仓库维护使用 `chore/`。多版本开发可在分支名加入版本号。

## 提交与 PR

- 一个 PR 聚焦一个问题或功能，提交说明修改的目的和结果。
- 标题使用 `feat:`、`fix:`、`perf:`、`docs:`、`test:` 或 `chore:`；例如 `fix: 修正导出账号筛选`。
- 检查暂存与未暂存差异，不混入凭据、用户样本、临时输出或无关格式变化。
- 跟踪的生成物随源文件提交，文件范围见 [仓库结构](REPOSITORY_LAYOUT.md)。
- PR 描述包含改后行为、验证结果及环境限制；UI 改动附截图。

常用检查：

```bash
npm run lint
npm run test:unit
npm run build
git diff --check
git diff --cached --check
```

按 [贡献指南](../CONTRIBUTING.md) 补充受影响的专项验证。纯文档修改检查引用、命令和差异即可。

## 发布

维护者在发布分支汇总已验证的改动，更新版本、发布说明与迁移要求，再合入 `main`。版本标签和 GitHub Release 按本次发布要求创建；网站公告及运行配置分别验证。检查项见 [Release Checklist](RELEASE_CHECKLIST.md)。

当前主站连接 GitHub 与 Vercel，推送 `main` 会触发生产部署。数据库新列／RPC 必须先于依赖它们的 API，统计 Worker 与快照须在读端启用前准备好；发布后确认目标部署、正式域名、版本和受影响接口。

新迁移核对当前基线与其他待合入改动，避免编号冲突；重新生成 baseline 并验证。已执行的手动修复不能当作初始化重跑。部署说明应记录数据、Worker 与应用的先后顺序及回退方式。

个人分析调度使用 Vault 中的不可变部署 URL，网站域名更新不会自动切换 Worker；涉及算法／schema 时同步地址并验证任务发布。运行版本优先读取数据库配置，须同时核对 `site_version`、`build_info`、公共缓存与中英文公告。

v4.6.4 已通过 PR #44 合入 `main@22909e5e` 并完成生产部署、迁移、调度及公告发布，见 [发布记录](RELEASE_4.6.4.md)。本次未创建独立版本标签或 GitHub Release，后续文档修正仍作为本地改动或新的主题提交处理，不改写该发布提交。

## 历史与分支清理

已推送的主线通过新增提交修正。不要为了缩短历史反复改写发布提交。

清理分支前确认 PR 已合入且没有独有修改。普通合并可用 `git merge-base --is-ancestor` 核对；Squash 合并需结合 PR 和最终补丁比较，单凭祖先关系或 `git cherry` 不能判断多个压缩提交是否等价。

额外工作目录可能含未提交代码和被忽略的环境文件，清理前分别核对。独立日历等其他仓库按各自 PR 与部署流程维护。
