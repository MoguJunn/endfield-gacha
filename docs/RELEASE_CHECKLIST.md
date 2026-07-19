# Release Checklist（可复用发布模板）

本文件的未勾选项是下一次发布时复用的模板，不代表当前 `v4.5.3` 尚未完成。`v4.5.3` 已在 `99296c2 chore:发布v4.5.3` 收口：migration 156 已执行，CN / INTL 后端 `1.6.2` 健康，GitHub 触发的 Vercel Production 部署 Ready，完整验证链和真实双区导入均通过。

## 代码

- [ ] 版本号和 changelog 已更新
- [ ] 公开主链的变更已完成局部自测
- [ ] `npm run lint`
- [ ] `npm run test:unit`
- [ ] `npm run build`
- [ ] `npm run test:supabase-baseline:smoke`（baseline 小范围真实执行）
- [ ] `npm run test:history-batch-delete-guard`
- [ ] `git diff --check`

## Git 历史与分支

- [ ] 已按 `docs/GIT_WORKFLOW.md` 建立本版本分支结构。
- [ ] 从 `main` 切出 `release/vX.Y.Z`，本轮功能与修复先进入发布分支。
- [ ] 新功能使用 `feat/vX.Y-<name>`，修复使用 `fix/vX.Y-<name>`，只在对应分支提交相关文件。
- [ ] 功能分支合入 `release/*` 前整理为 1 个主题清晰的提交，修复分支按问题保持小提交。
- [ ] `release/*` 验证通过后再合入 `main`，并打 `vX.Y.Z` tag。
- [ ] 发布收口提交使用 `chore:发布vX.Y.Z` 或同等清晰标题。
- [ ] 已推送到远端的 `main` 不做历史改写；需要纠错时新增修复提交或发布分支。

## 公开验证

- [ ] `npm test`
- [ ] `npm run test:public-api-boundary`
- [ ] `npm run test:bootstrap-cache`
- [ ] `npm run test:official-announcements-feed`
- [ ] `npm run test:ops-automation`
- [ ] `npm run perf:report`

## 文档

- [ ] README 已保持 GitHub 首页短摘要，并链接到专题文档
- [ ] `docs/PROJECT_GUIDE.md` 已同步部署、环境变量、数据库和维护命令
- [ ] `docs/ARCHITECTURE.md` 已同步架构、公共缓存、自动化和数据库边界
- [ ] `docs/CODEMAP.md` 已同步代码入口索引
- [ ] `supabase/README.md` 已同步 baseline 覆盖范围
- [ ] 若 UI 有变化，`docs/screenshots/` 已更新
- [ ] `.github/` 模板已覆盖当前提交流程

## 部署

- [ ] Supabase baseline / migration 状态已确认
- [ ] 新迁移已按编号顺序执行；站点版本与 `public_cache_epoch` 已核对
- [ ] CN / INTL 私有导入后端版本一致，`/health` 返回正确 `sourceMode`、版本和 `fullImport: true`
- [ ] 官方导入已验证“`import-full` → 后台获取 / 内部暂存 → 自动原子写入 → `import-status` 轮询 → 异常标记 → 现在 / 稍后处理”；缺少安全归属字段的记录会跳过，任务重试保持幂等，浏览器不调用同步 `import-confirm`
- [ ] 历史编辑已验证乐观锁冲突、变更审计、受影响作用域保底重算，以及旧批量删除对跨账号重复 ID 的整笔拒绝
- [ ] 异常回填先只读演练；仅在记录数和用户数精确校验值一致时执行 `--apply`
- [ ] GitHub push 触发的 Vercel Production 部署已检查并 Ready；正常流程没有直接运行 `vercel deploy --prod`
- [ ] 公共页面首屏未出现浏览器直连 Supabase
- [ ] 公共缓存版本 / 失效链已验证

## 收尾

- [ ] 需要的话同步更新 `todo`
- [ ] 需要的话同步更新 `SESSION_HANDOFF.md`
- [ ] 如果有回归风险，准备对应 BUG 条目
