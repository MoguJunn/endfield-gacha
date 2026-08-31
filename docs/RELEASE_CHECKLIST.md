# Release Checklist（可复用发布模板）

本文件的未勾选项是下一次发布时复用的模板，不代表当前 `v4.5.4` 尚未完成。`v4.5.4` 已在 `78f5ed1 chore:发布v4.5.4` 收口：迁移 157 / 158 已执行且没有主动修改异常记录，CN / INTL 后端 `1.6.3` 健康，GitHub CI 全部通过，GitHub 触发的 Vercel Production 部署 Ready，生产首页、移动入口、bootstrap 版本、双区公网健康和 CORS 预检均通过。

## v4.5.4 后主线补充记录（2026-08-27）

- [x] PR #24 已合入个人分析 Session 循环修复、Supabase `pg_cron + pg_net` 调度、即时派发、短间隔检查、45 秒多批 Worker，以及重构寻访 / 重构申领 / 特殊附加寻访支持。
- [x] PR #25 已修复含 PostgREST 保留字符的分析 `viewKey` 触发 `PGRST100 / HTTP 500`；生产真实登录请求返回 HTTP 200 / ready。
- [x] 当前发布主线为 `d186a425d5fb29aad940b4f08027744dfecbc602`；GitHub CI、Vercel Preview 和 GitHub-connected Vercel Production 均已核对成功 / Ready。
- [x] 完整回归为 239 个 Vitest 文件 / 1316 项测试，另通过 ESLint、公共验证、个人分析队列 PostgreSQL 合同、baseline smoke 和生产构建。
- [x] 1789 条合成历史的一次真实浏览器冷启动观测约 `13.1s`；这是观测值，不是 SLA。
- [x] 新环境 baseline 覆盖到 migration 183；生产已只读核验个人分析调度和附加寻访最终数据库合同。重编号后的 181–183 不应因此重复执行。

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

## OAuth 邮箱旧空壳自助修复（migration 169；以下保留为该阶段发布检查历史）

- [x] `npm run test:auth-hardening-phase-cd` 已在临时 PostgreSQL 17 中完成候选识别、错码计数与持久预算、一次性验证、claim 原子占用、归属转移、完成及 restrictive RLS 门禁闭环
- [x] API 专项覆盖：先提示可修复、重新核对候选、发送 6 位验证码、验证和显式确认分离、协调状态不暴露内部错误、确认必须绑定发起时的站点会话
- [x] 验证后到确认前目标账号可能变化的竞态已收口：claim 阶段在数据库内重新执行完整空壳检查，claim 后通过 Auth 触发器与业务表触发器冻结空壳；任何检查失败都不会进入隔离
- [x] 确认时先原子占用（claim）并撤销双方原生 Auth Session，再隔离空壳、转移归属、绑定源账号；Auth Admin 更新失败或响应丢失时按数据库最终状态决定继续、回滚或进入人工协调，不再盲目补偿
- [x] 响应丢失恢复：完成后重试确认会撤销旧 handoff 会话并创建新会话，旧 Cookie 不再残留
- [x] 验证码预算持久化：按“源用户 + 目标邮箱”在数据库内累计发送（≤5 次/24h）与失败（≤8 次后锁定 24h），更换 intent 无法绕过
- [x] 空壳识别要求 operator 在 `account_email_artifact_merge_approvals` 中逐条人工批准（绑定邮箱 hash、事件版本、批准引用），事件证据还要求精确脱敏收件人匹配；任意真实账号、MFA、额外身份、Session、封禁或数据引用都会拒绝
- [x] 桌面和移动端共用同一确认组件；用户必须先控制目标邮箱，再阅读修复内容并单独确认
- [x] 普通浏览器不能读取 `account_email_merge_intents` / 批准表 / 预算表，不能直接执行任何迁移 169 RPC
- [ ] 生产应用迁移 169 前：创建完整备份和 schema-only 备份，记录迁移 SHA-256；对 16 个历史冲突做匿名化只读分类，只把严格满足空壳证据链的账号写入批准表（绑定邮箱 SHA-256 与批准引用，不存明文邮箱/用户 ID）
- [ ] 先生产执行迁移 169 与批准回填，再部署依赖新 RPC 的 API/前端；不得反序
- [ ] 部署后使用隔离测试账号完成“冲突提示 → 验证码 → 显式确认 → 继续设密 → 重新登录”的真实浏览器闭环
- [ ] 生产历史账号不批量自动修复；只有用户本人在有效 OAuth Session 中主动发起并完成验证/确认才会写入

## 文档

- [ ] README 已保持 GitHub 首页短摘要，并链接到专题文档
- [x] `docs/PROJECT_GUIDE.md` 已同步部署、环境变量、数据库和维护命令
- [x] `docs/ARCHITECTURE.md` 已同步架构、公共缓存、自动化和数据库边界
- [x] `docs/CODEMAP.md` 已同步代码入口索引
- [x] `supabase/README.md` 已同步 baseline 覆盖范围
- [ ] 若 UI 有变化，`docs/screenshots/` 已更新
- [ ] `.github/` 模板已覆盖当前提交流程

## 部署

- [x] 当时 Supabase baseline / migration 状态已确认到本分支 169、生产到 168；当前覆盖范围必须读取 baseline 头部与 `supabase/README.md`，不能沿用该历史尾号
- [x] 迁移前已通过 SSH 只读核对生产 schema；独立抽奖 160–165 存在且不属于主站 baseline，认证结构当时不存在
- [x] 认证初始迁移已定为 166/167，审查修复使用前向迁移 168；baseline 已重新生成并在临时 PostgreSQL 中完整验证
- [x] 生产数据库已按 166 → 167 执行；3,095 个邮箱归属、83 条 identity key 版本、权限/触发器/函数断言和 `site_version=v4.5.4` 均核对通过
- [x] 生产已执行迁移 168，并核对 restrictive RLS policy 数量、RPC 权限、首页/bootstrap 和 Auth 健康
- [x] 迁移 168 完成后已部署依赖 `claim_oauth_identity_v2` / `refresh_oauth_account_security_state` 的 API；LinuxDo/QQ 开关继续关闭
- [x] 生产迁移 166/167/168 已分别获授权并完成；历史授权没有扩展到本分支新增的 169、合并、部署或生产账号批量修改
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
