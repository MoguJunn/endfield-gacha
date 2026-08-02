# Project Guide

这份文档承接 README 中不适合放在 GitHub 首页的部署、环境变量、数据库和维护细节。

## 功能范围

- 官方抽卡记录导入、去重、内部暂存后自动原子写入、写入完成后的异常核对、云同步和区服纠错。
- 私有历史记录按完整账号作用域精确编辑 / 删除；用户核对与超级管理员集中复核只处理已经写入的异常记录，不参与导入前逐条放行。
- 首页 bootstrap、公告、全服统计、卡池目录和阵容公开读取。
- 桌面端 / 移动端双入口、抽卡模拟器、分享卡和后台管理。
- 运营自动化：公告、卡池轮换、Wiki catalog 的 job graph、partial、review bundle 和审计。
- 可观测性：Vercel Analytics、Speed Insights、性能预算报告。

## 本地开发

```bash
npm install
cp .env.contributor.example .env.local
npm run dev
```

外部贡献者默认使用 `.env.contributor.example`：它只包含公开读取和前端 UI 所需的 `VITE_*` 变量，不能用于后台、邮件、BOT、运营自动化或服务端写入任务。维护者需要调试完整服务端链路时，再从 `.env.example` 复制到本地私有 `.env.local` 并补齐服务端密钥。私有代理和旧后端不在公开仓库内。`npm run dev:backend*`、`npm run test:harness` 在缺少私有目录时会安全退出。

## 验证矩阵

| 命令 | 用途 |
|------|------|
| `npm test` | 公开验证链 |
| `npm run test:unit` | Vitest 单元测试 |
| `npm run lint` | ESLint |
| `npm run build` | 生产构建 |
| `npm run perf:report` | 包体和资源预算 |
| `npm run test:public-api-boundary` | 首屏公共读取不直连 Supabase |
| `npm run test:bootstrap-cache` | 公共 cache partial / stale 行为 |
| `npm run test:supabase-baseline` | baseline 覆盖范围和首尾 marker |
| `npm run test:supabase-baseline:smoke` | 在临时 PostgreSQL 中小范围真实执行候选 baseline |
| `npm run test:auth-hardening-phase-a` | Phase A/B：管理员 RPC、OAuth transaction、Session 与 owner 权限边界 |
| `npm run test:auth-hardening-phase-cd` | Phase C/D：邮箱归属、首次设密、临时凭据到期与 identity key 迁移 |
| `npm run test:history-batch-delete-guard` | 在临时 PostgreSQL 中验证旧批量删除的跨账号重复 ID 防护 |
| `npm run test:mail-abuse-guards` | 自建邮件防刷 guard、预算桶、幂等和脱敏 |
| `npm run test:mail-outbox-enqueue` | 自建邮件 outbox 入队、幂等、预算和 RPC 边界 |
| `npm run test:mail-outbox-worker` | 自建邮件 outbox 队列处理器、provider adapter、演练 / 真实发送回写和脱敏 |
| `npm run test:mail-inbound` | 自建邮件入站 webhook 脱敏记录和 secret 鉴权 |
| `npm run test:mail-service-entrypoints` | 网站侧邮件 worker endpoint、后台测试邮件入口和脱敏边界 |
| `npm run test:ops-automation` | 运营自动化 job graph |
| `npm run test:official-announcements-feed` | 官方公告 feed |
| `npm run backfill:history-anomalies` | 只读扫描已知异常历史；正式写入还需要 `--apply` 和精确记录数 / 用户数确认变量 |

## 环境变量

贡献者安全模板：

```bash
cp .env.contributor.example .env.local
```

这个模板只允许填写浏览器端可公开变量，例如 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`、`VITE_APP_URL` 和前端功能开关。`VITE_SUPABASE_PUBLISHABLE_KEY` 可以出现在浏览器中，但必须是受 RLS 限制的低权限公开 key。不要把 `SUPABASE_SECRET_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_JWT_SECRET`、SMTP 密码、OAuth Client Secret、BOT token、Cron secret 或 CAPTCHA secret 交给外部贡献者。

维护者完整模板：

```env
# Supabase
SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
SUPABASE_SECRET_KEY=sb_secret_xxx

# 认证安全与同源站点 Session（真实值仅放服务端秘密存储）
OAUTH_STATE_SECRET=replace-me-with-long-random-secret
AUTH_IDENTITY_HASH_KEY_CURRENT=replace-me-with-independent-identity-hash-key
AUTH_IDENTITY_HASH_KEY_CURRENT_VERSION=v2
AUTH_IDENTITY_HASH_KEY_PREVIOUS=
AUTH_IDENTITY_HASH_KEY_PREVIOUS_VERSION=
APP_SESSION_SECRET=replace-me-with-another-long-random-secret
APP_SESSION_COOKIE_NAME=__Host-eg_session
APP_REFRESH_COOKIE_NAME=__Secure-eg_refresh
AUTH_SECURITY_HASH_SECRET=replace-me-with-third-long-random-secret
# 仅在服务端 OAuth 出站网络必须使用 HTTPS_PROXY / HTTP_PROXY 时开启；NO_PROXY 仍生效
AUTH_OAUTH_USE_ENV_PROXY=false

# GitHub 公开模板默认关闭；隔离浏览器回归已完成，生产仍需单独授权后再开启
AUTH_OAUTH_GITHUB_ENABLED=false
AUTH_OAUTH_GITHUB_CLIENT_ID=
AUTH_OAUTH_GITHUB_CLIENT_SECRET=
AUTH_OAUTH_GITHUB_REDIRECT_URI=https://your-domain.vercel.app/api/auth/oauth/github/callback
VITE_AUTH_OAUTH_GITHUB_ENABLED=false

# App / cache
VITE_APP_URL=https://your-domain.vercel.app
VITE_APP_FORCE_REFRESH_TOKEN=2026-05-22-release-refresh
VITE_PUBLIC_DATA_DIRECT_SUPABASE_FALLBACK=false
MAIL_ABUSE_HASH_SECRET=replace-me-with-long-random-secret
MAIL_PROVIDER=stalwart
AUTH_MAIL_ACTIONS_ENABLED=false
ACCOUNT_RECOVERY_MAIL_OUTBOX_ENABLED=false
DEVELOPER_API_REVIEW_MAIL_OUTBOX_ENABLED=false
TICKET_REPLY_MAIL_OUTBOX_ENABLED=false
ADMIN_ALERT_MAIL_OUTBOX_ENABLED=false
MAIL_OUTBOX_WORKER_ENABLED=false
MAIL_WORKER_DRY_RUN=true
MAIL_WORKER_BATCH_SIZE=10
MAIL_WORKER_MAX_ATTEMPTS=3
MAIL_WORKER_RETRY_DELAY_SECONDS=900
MAIL_PROVIDER_TIMEOUT_MS=15000
MAIL_OUTBOX_GLOBAL_KILL_SWITCH=true
MAIL_OUTBOX_WORKER_SECRET=replace-me
STALWART_SMTP_HOST=mail.example.com
STALWART_SMTP_PORT=587
STALWART_SMTP_USERNAME=replace-me
STALWART_SMTP_PASSWORD=replace-me
STALWART_JMAP_URL=https://mail.example.com
STALWART_WEBHOOK_SECRET=replace-me
MAIL_DELIVERY_WEBHOOK_SECRET=replace-me
MAIL_INBOUND_WEBHOOK_SECRET=replace-me
MAIL_SENDING_DOMAIN=mail.example.com
ACCOUNT_RECOVERY_TEMP_PASSWORD_TTL_HOURS=24

# Optional proxies and puzzle player
VITE_PROXY_URL_CN=https://your-cn-proxy.example.com
VITE_PROXY_URL_INTL=https://your-intl-proxy.example.com
VITE_PUZZLE_PLAYER_URL=https://your-player.example.com

# Ops automation
CRON_SECRET=replace-me
OPS_AUTOMATION_ANNOUNCEMENTS_URL=https://example.com/announcements.json
OPS_AUTOMATION_ANNOUNCEMENTS_TAG=official-json
OPS_AUTOMATION_POOL_SCHEDULE_URL=https://example.com/pools.json
OPS_AUTOMATION_POOL_SCHEDULE_TAG=official-json
OPS_AUTOMATION_WIKI_CATALOG_URL=https://example.com/wiki.json
OPS_AUTOMATION_WIKI_CATALOG_TAG=official-json

# Official bot
TELEGRAM_OFFICIAL_BOT_TOKEN=replace-me
TELEGRAM_OFFICIAL_BOT_PROXY_URL=http://127.0.0.1:7890
TELEGRAM_OFFICIAL_BOT_PUBLIC_API_KEY=replace-me
TELEGRAM_OFFICIAL_BOT_VERIFIER_SECRET=replace-me
TELEGRAM_OFFICIAL_BOT_POLL_INTERVAL_MS=1500
TELEGRAM_OFFICIAL_BOT_LONG_POLL_SECONDS=20
```

旧变量别名 `VITE_SUPABASE_ANON_KEY` 和 `SUPABASE_SERVICE_ROLE_KEY` 仍可兼容，但新配置应使用 publishable / secret key 口径。

## 部署

1. 在 Supabase 创建项目。
2. 执行 `supabase/baseline/000_complete_schema.sql` 起库。
3. 启用 `global_stats` 表 Realtime。
4. 在 Vercel 配置 `VITE_SUPABASE_*`、`SUPABASE_SECRET_KEY`、`CRON_SECRET` 和需要的自动化 / BOT 环境变量。
5. 导入仓库部署。

主站生产部署由 GitHub `main` 推送触发 GitHub-connected Vercel 自动部署。正常开发流程不直接运行 `vercel deploy --prod`；仅在用户明确批准紧急回滚、promotion 或切换已有部署时使用 Vercel CLI，并在操作前后核对目标部署和生产 alias。独立状态页等其他 Vercel 项目必须按单独项目处理，不与主站发布混用。

`AUTH-HARDEN-001` Phase A–D 与隔离 GitHub 核心浏览器闭环已完成，并已集成到最新 `origin/main` 的独立 worktree。2026-08-02 通过 SSH 只读确认生产运行版本为 `v4.5.4`、抽奖 160–165 结构存在、认证结构不存在；认证迁移因此定为 166/167。候选尚未提交、推送、部署或执行生产迁移；提交前仍需重新生成 baseline 并完成集成树全量验证。LinuxDo 暂缓。

当前管理后台主链已收口到 Vercel Serverless `/api/admin`，并通过 `vercel.json` rewrite 兼容旧 `admin-*` 路径。不再要求额外部署同名 Supabase Edge Functions。

官方导入的数据获取仍由独立 CN / INTL 私有后端承接。`v4.5.4` 对应后端版本为 `1.6.3`：浏览器用 `POST import-full` 创建后台任务，只通过 `GET import-status` 轮询；后端先过滤情报书等非寻访事件，再把规范化结果写入 `official_import_tasks` 与 `official_import_staged_records`，并在内部调用 `commit_official_import_records()` 自动原子提交。当前浏览器主路径不再调用同步 `import-confirm`，旧逐条审阅接口仅保留兼容。正常记录直接写入；仍具备账号、区服、卡池、官方序号和时间作用域的未知角色 / 武器记录会保留并写入 `history_anomalies`，由前端在导入完成后提示用户现在或稍后核对；缺少安全定位字段的记录继续跳过。再次导入时，后端只会通过迁移 157 提供的 service-role-only RPC 修复与官方非寻访标记完整吻合的旧版四星未知占位；查询失败时增量导入会保守降级为完整抓取。私有后端镜像必须同时包含 `backend/lib/officialImportStaging.js`、`backend/lib/officialImportIncremental.js`、`shared/historyPity.js` 和 `shared/officialImportRecordNormalizer.js`；两个地区部署后都要核对 `/health`、容器版本、正常 CORS 预检和一次受控导入，不得只更新单一区域。

邮件发送分为两层：认证邮件使用受控同源 `/api/auth-email-action`，支持注册验证、密码重置和邮件登录；通知类和人工恢复队列继续走 provider-independent outbox / 队列处理器。认证邮件入口必须同时启用 `AUTH_MAIL_ACTIONS_ENABLED=true`、`MAIL_OUTBOX_WORKER_ENABLED=true`，且未命中环境级紧急停发开关 `MAIL_OUTBOX_GLOBAL_KILL_SWITCH` 才会调用 provider adapter；它会先做 origin、CAPTCHA、内存限流、账号存在性判断和脱敏审计，未知邮箱的重置 / 邮件登录仍返回通用状态。当前 `api/_lib/mailOutbox.js` 只允许服务端 service-role 经过防刷、suppression、幂等和 `enqueue_mail_outbox_event()` RPC 写入私有 `mail_outbox`；`api/_lib/mailOutboxWorker.js` 和 `api/_lib/mailProviderAdapter.js` 已提供 Stalwart-first 的队列处理器 / provider 边界。`api/_lib/mailTemplateRenderer.js` 是统一 HTML + plaintext 邮件模板入口，注册验证、邮件登录、密码重置、账号恢复队列处理器、开发者 API 审核通知、工单回复通知、管理员告警和后台测试邮件都应复用它。开发者 API 审核结果已可在 `DEVELOPER_API_REVIEW_MAIL_OUTBOX_ENABLED=true` 且 `MAIL_OUTBOX_WORKER_ENABLED=true` 时写入 outbox；工单 staff 回复已通过 `/api/tickets/reply` 服务端路由写入回复，并可在 `TICKET_REPLY_MAIL_OUTBOX_ENABLED=true` 且 `MAIL_OUTBOX_WORKER_ENABLED=true` 时为工单所有者写入 `ticket.reply` outbox；后台“邮件状态”页可在 `ADMIN_ALERT_MAIL_OUTBOX_ENABLED=true` 且队列处理器开启时把 `admin.alert` 受控入队给当前超级管理员自己的账号邮箱。通知类入队失败都不会阻断原业务操作，响应只回传 queued / deduped / disabled / skipped / blocked / error 等脱敏状态，不返回收件邮箱或 guard decision。`/api/mail-outbox-worker` 是内部队列处理 endpoint，同时接受 `MAIL_OUTBOX_WORKER_SECRET` 和 `CRON_SECRET` 鉴权；`vercel.json` 已配置每日一次 Vercel Cron 触发该 endpoint，外部 cron 或受控运维脚本可使用独立 worker secret，后台“邮件状态”页也能由超级管理员手动调用 `/api/admin?route=mail-outbox-drain` 处理到期队列。`/api/mail-delivery-feedback` 是内部投递反馈入口，用服务端 secret 接收单条 hard bounce / complaint / invalid recipient / domain pause，也能接收 Stalwart Telemetry Webhook `{ events: [...] }` 批量投递事件；永久失败会写入 `mail_suppression`，成功和临时失败只写入脱敏 `mail_delivery_events`。`/api/mail-inbound` 是内部入站邮件事件入口，用服务端 secret 接收 Stalwart Webhooks / MTA Hooks 或受控桥接脚本的入站摘要，并只写入脱敏 `mail_delivery_events`，不保存原始正文或自动生成工单。后台“站点健康”和“邮件状态”面板通过 `/api/admin?route=site-health` 汇总内容更新时间、公共缓存、自动化、邮件队列、入站事件、suppression、发送预算高水位和待处理事项；“邮件状态”页还提供超级管理员测试邮件入口，用当前 provider adapter 发送受控测试邮件，并只记录脱敏投递事件。邮件状态页可在线编辑 `mail_abuse_budget_config` 的窗口、上限和启用状态，并能展开查看最近失败 / suppressed outbox 的脱敏错误摘要。所有响应不返回原始邮箱、SMTP 密码、webhook secret、Stalwart 原始 event id / queue id 或预算 bucket hash。真实投递前必须先设置 `MAIL_ABUSE_HASH_SECRET`、保持环境级紧急停发开关可用，并确认 `docs/SELF_HOSTED_MAIL.md` 中的 DNS、suppression、预算和投递监控检查项完成。

账号恢复现在优先走自助重置邮件：登录弹窗的“账号恢复”会先调用 `/api/auth-email-action` 发送密码重置邮件；只有多次收不到邮件、邮箱不可访问或需要注销旧账号时，才提交人工恢复申请。人工恢复申请仍只返回通用 `received` 状态。Phase C 候选已把管理员临时密码的 issue/issued/expires 元数据与 Auth 密码更新原子写入，并通过 `auth.sessions` 门禁和站点 Session/Bearer 检查执行认证层到期；普通用户不能直接清除改密状态。该能力尚未生产部署。只有 `ACCOUNT_RECOVERY_MAIL_OUTBOX_ENABLED=true` 且 `MAIL_OUTBOX_WORKER_ENABLED=true` 时，人工恢复申请中的 `password_reset` 才会写入 `mail_outbox` 并标记为 `mail_reset_queued`；防刷阻断、入队异常或状态回写失败时仍保留人工恢复 fallback。认证预检和恢复申请会写入私有 `auth_security_events`，只保存 hash、风险桶、CAPTCHA 摘要和脱敏 metadata。不要把强制改密状态放进公开 profile 字段，也不要在响应、日志或审计包中保存明文临时密码、原始邮箱、验证码 token 或 `game_uid`。

第三方一键登录当前走本站统一 OAuth 桥接：provider 进入 `/api/auth/oauth/{provider}/start` / callback，以 `auth.users` UUID 为锚点并通过 `app_auth_identities` / `app_sessions` 创建 HttpOnly 站点会话。Phase A–D 候选已完成 OAuth transaction 浏览器/Session 绑定与单次消费、Cookie/Bearer 冲突拒绝、独立版本化 identity keyring、旧 key 原子迁移、owner 防改写、原子认领/解绑和半成品 Auth user 补偿恢复。隔离 OAuth App 已完成 GitHub 登录、绑定、软解绑、解绑后拒绝和恢复原 identity 的核心浏览器闭环；取消授权、跨浏览器 transaction、link Session 切换和 callback 重放仍需独立真人浏览器证据。LinuxDo 前后端保持关闭并暂缓重新实现，QQ 保持关闭。真实 Client Secret 只写服务端环境变量，不进入 `VITE_*`；服务端不得保存 raw access token / refresh token，也不得把 provider 原始资料写入公开输出。

受控队列处理器可用 `npm run worker:mail-outbox` 手动运行，也可调用 `/api/mail-outbox-worker`，或在后台“邮件状态”页点击“处理到期队列”。这些路径默认都需要 `MAIL_OUTBOX_WORKER_ENABLED=true` 且未命中紧急停发开关才会处理队列；每日 Vercel Cron 只负责触发，不会绕过队列处理器开关、演练模式或紧急停发开关。当前已接入 Stalwart SMTP 真实传输、Stalwart Telemetry Webhook 批量投递事件归一、入站事件记录、后台健康汇总、发送预算高水位摘要和站内测试邮件入口；在关闭演练模式前仍必须完成 DNS、收件端认证结果审计、Stalwart 管理端 Webhook 真实事件小测试、紧急停发灰度和更细的投递监控。未配置 SMTP 主机、账号或密码时会以 `stalwart_smtp_not_configured` 安全失败，不会伪装投递成功。

邮件运行期开关存放在 `site_config.mail_runtime_config`，由后台“邮件状态”页通过 `/api/admin?route=mail-runtime-config` 保存。它用于临时暂停全局发信、单独关闭认证邮件 / 账号恢复 outbox / 开发者 API 审核 / 工单回复 / 管理员告警，以及追加禁用事件和暂停域名。该配置只能进一步收紧：环境变量关闭时运行期“允许”不会启用发信，环境级紧急停发开启时运行期“关闭紧急停发”不会绕过停发；SMTP 密码、Webhook secret 和 Vercel env 仍只放在部署环境变量里。

## 数据库维护

- `supabase/baseline/`：新环境基线 schema。
- `supabase/archive/migrations/`：已合并进 baseline 的历史标准迁移，仅用于审计和重建 baseline。
- `supabase/migrations/`：当前 active 标准迁移源文件，以及未来新增、尚未合并进 baseline 的前向迁移。
- `supabase/manual/`：危险、回滚、回填和历史诊断脚本，不进入默认部署链。

刷新 baseline：

```bash
npm run generate:supabase-baseline
npm run test:supabase-baseline
```

迁移 152–158 是已发布主站标准链。共享生产 schema 已确认独立抽奖 160–165 存在而认证结构不存在；认证迁移最终为 166/167，集成 baseline 覆盖到 167，但两条认证迁移仍未生产执行。性能线和旧邮箱候选的同号 159 位于其他 worktree，不属于本认证分支。历史异常回填脚本默认只读，只有同时提供 `--apply` 与脚本打印的精确确认快照时才允许写入。

数据库体积治理的现状：远端 `history` 体积主要来自索引。删除字段或索引前必须先做线上读写路径、RPC 查询计划、回滚脚本和实际基准验证；本轮只整理 baseline 和迁移归档，不直接改生产表结构。

## 静态资源维护

- 头像主链优先使用 `public/avatars/` 本地静态路径，减少 Supabase Storage egress。
- 版本日历等大图优先使用压缩后的 Web 友好格式。
- `src/generated/fonts/harmony/` 由 `npm run fonts:prepare` 生成，不进入 Git。
- 新增截图或大图后应运行 `npm run perf:report` 检查资源预算。

## Changelog 摘要

### v4.5.4

- 官方导入过滤 `gift_intel_book` 等非寻访事件，避免情报书进入抽卡历史、卡池计数或保底计算。
- 再次导入时可精确修复已被官方响应证明为非寻访事件的旧四星未知占位；修复要求完整账号作用域和待处理异常同时吻合，并记录审计、重算保底。
- 导入完成页统一展示异常、跳过记录、漏池、警告和云端刷新失败；干净导入才自动关闭，桌面与移动端使用统一异常核对入口。
- 独立 CN / INTL 导入后端升级到 `1.6.3`；迁移 157 增加受控修复 RPC，迁移 158 更新运行时站点版本并刷新公共缓存。

### v4.5.3

- 官方导入改为内部暂存后立即原子写入，不再让用户在写入前逐条保留或跳过。
- 可精确定位的未知角色 / 武器记录会以明确标记的占位信息保留，并在导入完成后提供“现在处理 / 稍后处理”；缺少安全归属字段的记录仍会跳过并显示提示。
- 修复时间排序后异常元数据与历史记录错位，以及生产历史响应使用 `id` 时无法打开编辑 / 删除操作的问题。
- 独立 CN / INTL 导入后端升级到 `1.6.2`；迁移 156 仅更新运行时站点版本并刷新公共缓存，不增加业务表或接口。

### v4.5.2

> 以下为历史版本流程，已被 `v4.5.3` 的“后台自动写入、导入后再核对”路径替代。

- 官方导入增加服务端暂存与前端逐条审阅，确认后通过数据库 RPC 原子写入；异常或无法识别记录可跳过，审阅会话可恢复。
- 日志详情支持按用户、游戏账号、区服、卡池和序号精确编辑 / 删除，修改会写入审计并重算受影响卡池保底。
- 增加用户异常提醒、超级管理员异常复核、旧批量删除歧义保护和受保护的生产异常回填脚本；生产迁移链与 baseline 覆盖到 155。
- 优化卡池详情与本地登录后同步：隐藏日志按需挂载、复用时间线 / 阵容结果、延迟自定义分享统计，并以必要列并行分页读取账号历史。
- 独立 CN / INTL 导入后端升级到 `1.6.1`。

### v4.4.0

- 账号邮件系统进入主线：注册邮箱验证、自助密码重置、邮件登录、邮箱更换验证和统一 HTML 邮件模板。
- 后台新增站点健康与邮件状态面板，可查看邮件队列、发送预算、投递反馈、入站事件和关键运行期开关。
- 验证链路升级为 Turnstile / 自建 PoW 双轨，并接入注册、登录、重置、恢复等账号入口。
- 首页版本前瞻、倒计时、路线图、卡池 / 角色 / 武器管理和导入恢复体验完成本轮收口。
- 公共卡池分析补齐预聚合缓存、趋势点和更完整指标，依赖、Node 26 兼容与 CI 链路完成复查。

### v4.3.0

- `CACHE-001 / ARCH-022`：公共数据访问统一到同源 `/api/*`，接入公共缓存版本、响应 `meta` 和显式失效。
- `OPS-006`：运营自动化补齐 job graph、partial 语义、手动重跑、审计详情和缓存失效回写。
- Speed Insights：接入 `@vercel/speed-insights` 并修复生产 bundle 动态配置透传。
- 文档与数据库 baseline 同步到当前主线。

### v4.2.0

- 接入角色图鉴全服聚合、个人图鉴、手动补录与角色详情资源统计。
- 补齐复刻混池与附加寻访的配额规则。
- 优化统计页与角色图鉴的桌面端 / 移动端布局。

### v4.0.0

- 建立自定义字体链、公告多语言、官方游戏公告 feed、管理后台用户管理、CI 和移动端主路由。
