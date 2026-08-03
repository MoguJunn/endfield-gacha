# Release Checklist（可复用发布模板）

本文件的未勾选项是下一次发布时复用的模板，不代表当前 `v4.5.4` 尚未完成。`v4.5.4` 已在 `78f5ed1 chore:发布v4.5.4` 收口：迁移 157 / 158 已执行且没有主动修改异常记录，CN / INTL 后端 `1.6.3` 健康，GitHub CI 全部通过，GitHub 触发的 Vercel Production 部署 Ready，生产首页、移动入口、bootstrap 版本、双区公网健康和 CORS 预检均通过。

## 代码

- [ ] 版本号和 changelog 已更新
- [ ] 公开主链的变更已完成局部自测
- [x] `npm run lint`
- [x] `npm run test:unit`
- [x] `npm run build`
- [x] `npm run test:supabase-baseline:smoke`（baseline 小范围真实执行）
- [ ] `npm run test:history-batch-delete-guard`
- [x] `git diff --check`

## Git 历史与分支

- [ ] 已按 `docs/GIT_WORKFLOW.md` 建立本版本分支结构。
- [ ] 从 `main` 切出 `release/vX.Y.Z`，本轮功能与修复先进入发布分支。
- [ ] 新功能使用 `feat/vX.Y-<name>`，修复使用 `fix/vX.Y-<name>`，只在对应分支提交相关文件。
- [ ] 功能分支合入 `release/*` 前整理为 1 个主题清晰的提交，修复分支按问题保持小提交。
- [ ] `release/*` 验证通过后再合入 `main`，并打 `vX.Y.Z` tag。
- [ ] 发布收口提交使用 `chore:发布vX.Y.Z` 或同等清晰标题。
- [ ] 已推送到远端的 `main` 不做历史改写；需要纠错时新增修复提交或发布分支。

## 公开验证

- [x] `npm test`
- [ ] `npm run test:public-api-boundary`
- [ ] `npm run test:bootstrap-cache`
- [ ] `npm run test:official-announcements-feed`
- [ ] `npm run test:ops-automation`
- [ ] `npm run perf:report`

## 统一认证加固候选（AUTH-HARDEN-001 / AUTH-HARDEN-RELEASE-001）

- [x] `npm run test:auth-hardening-phase-a`
- [x] `npm run test:auth-hardening-phase-cd`
- [x] candidate baseline 已在真正的空数据库和本地 Supabase/PostgreSQL 17 中完整执行，不只检查头尾标记
- [x] `service_role` 可读写认证同源 API 所需的 `profiles` / 私有 Session 撤销状态；`anon/authenticated` 仍不可访问私有撤销状态
- [x] 已确认邮箱 challenge 只能消费一次、首次设密能力不能重放、过期临时凭据不能创建/刷新 Auth Session
- [x] 已确认 identity 旧 key 双读迁移、owner/hash/version 防改写和原子解绑
- [x] 已使用旧主线真实 HMAC 格式验证既有 identity 复用原 owner，并原子迁移到当前专用 key/version
- [x] 已确认撤销站点 Session 后，旧兼容 JWT 不能绕过同源 API 直接读取 RLS 表
- [x] 已确认仅剩 refresh Cookie 的注销会撤销数据库 Session，独立导入后端会拒绝到期临时凭据
- [x] 已确认 OAuth callback 与首次设密完成共用数据库锁，陈旧 callback 不能把 completed 能力回退为待设密
- [x] 隔离普通账号已通过邮箱密码登录、站点 Session 建立、当前用户读取和注销；测试密码未写入仓库或文档
- [x] GitHub 登录、绑定、解绑、重绑已使用隔离测试 OAuth App 完成真实浏览器回归
- [x] 已验证解绑后 GitHub 直接登录返回 `oauth_identity_unlinked`，重绑恢复原 identity ID 和 owner
- [x] 跨浏览器 transaction、link Session 切换和 callback 重放已有确定性专项自动化；不再把重复真人复现作为 `AUTH-HARDEN-001` 完成条件
- [x] GitHub 已授权 App 不提供取消/拒绝控件的平台限制已记录，没有以浏览器后退冒充 `access_denied`
- [x] OAuth 出站网络需要代理时，仅显式开启 `AUTH_OAUTH_USE_ENV_PROXY`，并确认 `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` 不会把本地数据库或内部服务错误送入代理
- [x] 已区分 `AUTH-HARDEN-001` 本地实现完成与 `AUTH-HARDEN-RELEASE-001` 远端/生产发布状态
- [x] 已确认分支技术上可推送为远端审查候选，但推送不授权合并、部署、生产迁移或生产账号修改

## LinuxDo provider（仅 AUTH-LINUXDO-002，P3）

LinuxDo 代码、配置和验收矩阵由独立分支 `feat/linuxdo-oauth` 维护，不进入本认证候选。外部申请条件恢复前保持关闭，也不阻塞本次认证发布。

## 文档

- [ ] README 已保持 GitHub 首页短摘要，并链接到专题文档
- [x] `docs/PROJECT_GUIDE.md` 已同步部署、环境变量、数据库和维护命令
- [x] `docs/ARCHITECTURE.md` 已同步架构、公共缓存、自动化和数据库边界
- [x] `docs/CODEMAP.md` 已同步代码入口索引
- [x] `supabase/README.md` 已同步 baseline 覆盖范围
- [ ] 若 UI 有变化，`docs/screenshots/` 已更新
- [ ] `.github/` 模板已覆盖当前提交流程

## 部署

- [x] Supabase baseline / migration 状态已确认到本分支 168
- [x] 迁移前已通过 SSH 只读核对生产 schema；独立抽奖 160–165 存在且不属于主站 baseline，认证结构当时不存在
- [x] 认证初始迁移已定为 166/167，审查修复使用前向迁移 168；baseline 已重新生成并在临时 PostgreSQL 中完整验证
- [x] 生产数据库已按 166 → 167 执行；3,095 个邮箱归属、83 条 identity key 版本、权限/触发器/函数断言和 `site_version=v4.5.4` 均核对通过
- [ ] 生产执行迁移 168，并核对 restrictive RLS policy 数量、RPC 权限、首页/bootstrap 和 Auth 健康；本 PR 不自动执行生产迁移
- [ ] 确认迁移 168 完成后再部署依赖 `claim_oauth_identity_v2` / `refresh_oauth_account_security_state` 的 API；LinuxDo/QQ 开关继续关闭
- [x] 生产迁移 166/167 已获明确授权并完成；该授权没有扩展到本 PR 新增的 168、合并、API 部署或生产账号修改
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
