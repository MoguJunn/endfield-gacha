# Release Checklist（可复用发布模板）

本文件的未勾选项是下一次发布时复用的模板，不代表当前 `v4.5.4` 尚未完成。`v4.5.4` 已在 `78f5ed1 chore:发布v4.5.4` 收口：迁移 157 / 158 已执行且没有主动修改异常记录，CN / INTL 后端 `1.6.3` 健康，GitHub CI 全部通过，GitHub 触发的 Vercel Production 部署 Ready，生产首页、移动入口、bootstrap 版本、双区公网健康和 CORS 预检均通过。

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

## 认证专项（涉及邮箱、密码、OAuth、Session 时必做）

- [ ] `npm run test:auth-hardening-phase-a`
- [ ] `npm run test:auth-hardening-phase-cd`
- [ ] candidate baseline 已在真正的空数据库和本地 Supabase/PostgreSQL 17 中完整执行，不只检查头尾标记
- [ ] `service_role` 可读写认证同源 API 所需的 `profiles` / 私有 Session 撤销状态；`anon/authenticated` 仍不可访问私有撤销状态
- [ ] 已确认邮箱 challenge 只能消费一次、首次设密能力不能重放、过期临时凭据不能创建/刷新 Auth Session
- [ ] 已确认 identity 旧 key 双读迁移、owner/hash/version 防改写和原子解绑
- [ ] 隔离普通账号已通过邮箱密码登录、站点 Session 建立、当前用户读取和注销；测试密码未写入仓库或文档
- [ ] GitHub 登录、绑定、解绑、重绑已使用隔离测试 OAuth App 完成真实浏览器回归
- [ ] 已验证解绑后 GitHub 直接登录返回 `oauth_identity_unlinked`，重绑恢复原 identity ID 和 owner
- [ ] 取消授权、跨浏览器 transaction、link Session 切换和 callback 重放分别有真实浏览器证据；若 provider 已授权状态无法无副作用触发取消页，需记录 provider 限制，不能以浏览器后退冒充 `access_denied`
- [ ] OAuth 出站网络需要代理时，仅显式开启 `AUTH_OAUTH_USE_ENV_PROXY`，并确认 `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` 不会把本地数据库或内部服务错误送入代理
- [x] 已区分本地 181 个测试文件/976 项测试、MaaMCP 真实浏览器回归、提交前集成和生产部署状态

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
- [x] 已通过 SSH 只读核对生产 schema；独立抽奖迁移 160–165 的结构存在且不属于主站 baseline，认证结构尚不存在
- [x] 认证迁移已定为 166/167，并已重新生成/验证 baseline
- [ ] 新迁移已按编号顺序执行；站点版本与 `public_cache_epoch` 已核对
- [ ] 数据库迁移先于依赖新列/RPC 的 API，provider 开关最后开放
- [ ] commit、push、部署、生产 migration 和生产账号修改已分别获得所需授权，没有相互推定
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
