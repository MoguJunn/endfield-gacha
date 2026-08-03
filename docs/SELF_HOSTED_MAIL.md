# 自建邮件平台选型与基础设施方案

本文档用于 `MAIL-SELFHOST-001` / `MAIL-ABUSE-001`。它定义选型、边界、基础设施、已落地的 provider-independent 防刷 / outbox / 队列处理器、受控 Auth 邮件入口和后续决策点；当前默认以 Stalwart 作为第一阶段自建邮件平台方向，生产真实发信仍由显式环境变量和紧急停发开关控制。

> 认证边界：Phase A–D 已在本 worktree 本地完成邮箱唯一归属、一次性 challenge、首次设密能力、临时凭据认证层到期和 identity keyring，但尚未生产部署。SMTP、DNS 或测试邮件成功不能替代这些数据库能力、GitHub 真实浏览器回归或生产迁移验收。

## 目标

- 为账号注册确认、密码重置、工单提醒、开发者 API 审核通知和管理员告警提供可控事务邮件能力。
- 避免浏览器、前端页面或公开 API 直接调用邮件平台。
- 把第三方邮件额度风险转为可观测、可限流、可暂停的站内队列风险。
- 保留后续接入收信能力的空间；第一阶段只记录脱敏入站事件，不默认实现 `support@` 邮件回复转工单。

## 当前约束

- 数据库按自建站点数据库处理，不描述为官方数据库。
- 当前账号恢复优先走受控同源自助密码重置邮件；风控命中、邮件不可用、投递失败、邮箱不可访问或用户需要人工核验时，再回退到人工审核链路。人工恢复申请始终返回通用 `received`，避免邮箱枚举。
- `AUTH-003` 已补 provider-independent 降级闭环；Phase C 候选进一步把管理员临时凭据元数据与 Auth 密码更新原子写入，并通过 Auth session 门禁和站点 Session/Bearer 检查执行认证层到期。候选尚未生产部署。
- `AUTH-003` 已补受控同源 Auth 邮件入口：`/api/auth-email-action` 支持注册验证、密码重置和邮件登录，必须启用 `AUTH_MAIL_ACTIONS_ENABLED=true`、`MAIL_OUTBOX_WORKER_ENABLED=true` 且未命中 `MAIL_OUTBOX_GLOBAL_KILL_SWITCH` 才会真实调用 provider adapter。
- `AUTH-003` 也支持在 `ACCOUNT_RECOVERY_MAIL_OUTBOX_ENABLED=true` 且 `MAIL_OUTBOX_WORKER_ENABLED=true` 时，把密码重置申请写入 `mail_outbox`。入队被防刷阻断、异常或状态回写失败时，申请仍保留人工恢复 fallback。
- `api/_lib/mailTemplateRenderer.js` 是统一 HTML + plaintext 邮件模板入口。注册验证、邮件登录、密码重置、开发者 API 审核通知、工单回复通知、管理员告警、后台测试邮件和账号恢复队列邮件都应复用它，不再散落纯文本邮件。
- `MAIL-SELFHOST-001` 已补 outbox 队列处理器 / provider adapter 边界：`api/_lib/mailOutboxWorker.js` 能从 `mail_outbox` 读取 due rows、标记 `sending`、解析账号恢复、开发者 API 审核、工单回复或管理员告警收件人、渲染对应模板、调用 provider adapter，并回写 `mail_outbox` / `mail_delivery_events` / `account_recovery_requests`。
- `MAIL-DELIVERABILITY-001` 已补基础投递反馈回写：`api/_lib/mailDeliveryFeedback.js` 和内部 `/api/mail-delivery-feedback` 能用服务端 secret 接收 hard bounce / complaint / invalid recipient / domain pause，也能接收 Stalwart Telemetry Webhook 的 `{ events: [...] }` 批量事件并归一化 `delivery.delivered`、`delivery.dsn-temp-fail`、`delivery.dsn-perm-fail` 等投递事件；只有永久失败 / 投诉 / 无效地址 / 域名暂停会写入 `mail_suppression`，临时失败和成功只写入脱敏 `mail_delivery_events`。后台“站点健康”和“邮件状态”面板已能汇总 outbox、suppression、delivery events、入站事件、预算高水位和关键开关状态；Stalwart 管理端仍需按部署环境配置真实 Webhook 或日志轮询来源。
- `MAIL-SELFHOST-001` 已补基础入站事件入口：`api/_lib/mailInboundEvents.js` 和内部 `/api/mail-inbound` 能用服务端 secret 接收 Stalwart Webhooks / MTA Hooks 或受控桥接脚本的入站摘要，只写入脱敏 `mail_delivery_events`，不保存原始正文、附件或明文邮箱。
- 邮件平台不能直接承接公开流量；所有发信请求必须经应用服务端鉴权、限流、队列和审计。
- 邮件内容不得自动包含 Token、完整 API key、邮箱以外的私有身份标识、`user_id`、`game_uid`、平台 ID 或原始抽卡记录 ID。
- 自建邮件不等于无限额度。限制从服务商配额转移到 IP / 域名信誉、队列资源、退信和封禁风险。

## 已确认阶段方案

### Phase 1: 事务邮件发送

`DECISION-1` 当前为 Stalwart first；`DECISION-2` 已收窄为 Phase 1 只做入站事件记录，不做邮件正文解析或自动转工单。因此第一阶段按以下边界推进：

- 应用侧分两层：账号注册验证、密码重置和邮件登录使用受控同源 `/api/auth-email-action` 同步发信；工单、开发者 API、管理员告警和人工恢复队列继续走 `mail_outbox` / 队列处理器。
- Stalwart adapter / 队列处理器从 outbox 拉取任务；当前默认 `MAIL_WORKER_DRY_RUN=true`（演练模式），只验证队列处理 / 模板 / 状态回写，不真实发送。
- Stalwart SMTP submission 真实传输已接入，但默认仍由 `MAIL_WORKER_DRY_RUN=true`（演练模式）和 `MAIL_OUTBOX_GLOBAL_KILL_SWITCH=true`（环境级紧急停发）阻止真实发信；JMAP 和真实退信 webhook 映射后续再接入。
- 开发者 API 审核通知已接入 outbox：管理员审核、拒绝、撤销或重新启用时可提示填写审核备注；只有 `DEVELOPER_API_REVIEW_MAIL_OUTBOX_ENABLED=true` 和 `MAIL_OUTBOX_WORKER_ENABLED=true` 同时开启才会入队，入队失败不会阻断原审核。
- 工单 staff 回复通知已接入 outbox：桌面和移动端回复都走同源 `/api/tickets/reply`，服务端校验 owner / admin / super_admin 权限并写入回复；只有 `TICKET_REPLY_MAIL_OUTBOX_ENABLED=true` 和 `MAIL_OUTBOX_WORKER_ENABLED=true` 同时开启时，staff 回复才会为工单所有者写入 `ticket.reply` outbox。用户自回复不会发邮件，入队失败不阻断回复保存，响应只暴露脱敏状态。
- 管理员告警已接入受控自告警 outbox：后台“邮件状态”页可调用 `/api/admin?route=mail-alert` 写入 `admin.alert`，但只允许发给当前 `super_admin` 自己的账号邮箱；只有 `ADMIN_ALERT_MAIL_OUTBOX_ENABLED=true` 和 `MAIL_OUTBOX_WORKER_ENABLED=true` 同时开启才会入队，默认关闭，不提供任意收件人或批量告警入口。
- 邮件运行期开关已接入 `site_config.mail_runtime_config`：后台“邮件状态”页可以临时暂停全局发信、单独关闭认证邮件 / 账号恢复 outbox / 开发者 API 审核 / 工单回复 / 管理员告警，或追加禁用事件和暂停域名。该配置只是运行期 lower gate，只能进一步收紧发信范围；不能保存 SMTP 密码、Webhook secret，也不能绕过 Vercel 环境变量硬闸门。
- `/api/mail-inbound` 可记录入站邮件事件摘要，但不实现 `support@` 邮件回复转工单或自动入站正文解析。
- 若临时 shared relay 被封，站内恢复链仍回退到人工恢复和站内通知。
- 注册验证、密码重置、邮件登录默认由 `AUTH_MAIL_ACTIONS_ENABLED=false` 关闭。账号恢复申请中的 reset-mail outbox 仍需 `ACCOUNT_RECOVERY_MAIL_OUTBOX_ENABLED=true` 和队列处理器开关同时启用。

### Phase 2: 收信与邮件回复转工单

只有在后续明确需要 `support@` 邮件回复自动转工单、管理员真实邮箱套件或入站正文解析时，再开启完整收信链：

- `Stalwart`: 当前默认方向；同一套服务可从低频事务邮件平滑扩展到 SMTP / IMAP / JMAP、收信、投递和内建限流能力。
- `mailcow`: 完整 Dockerized 邮箱套件，Web 管理和常见邮件组件齐全，但资源和运维面更重。
- `Mailu`: Docker Compose 邮件服务器套件，组件化程度高，也偏完整邮箱平台而非单纯事务邮件服务。
- `Postal`: 后续如果拆出独立邮件 VPS，并希望更专注于事务邮件 HTTP API、webhook、suppression 和投递日志，可以再作为专门投递平台评估。

### 不推荐作为第一阶段

- 直接使用 Gmail / Outlook / QQ 邮箱账号作为生产发信主通道。
- 让 Supabase Auth 或浏览器直接调用外部 SMTP / 邮件 API。
- 在应用代码中硬编码 SMTP 凭据。
- 未接入 CAPTCHA、限流、紧急停发开关、suppression / 投递反馈和管理员可观测入口前开放注册确认 / 重置密码 / 邮件登录真实投递。

## 应用侧架构边界

```text
Browser / Mobile UI
  -> same-origin /api/*
  -> auth / notification API validates user intent
  -> Auth mail action direct send OR mail outbox / notification event in DB
  -> provider adapter OR worker / controlled job drains outbox
  -> mail provider adapter
  -> Stalwart or temporary relay
  -> provider webhook / delivery log
  -> delivery_events / suppression / admin panel
  -> optional inbound webhook summary
  -> redacted delivery_events / admin panel
```

强制边界：

- UI 只提交业务意图，例如“申请重置密码”或“发送工单通知”。
- `/api/auth-email-action` 只处理认证邮件：注册验证、密码重置、邮件登录。它先做 origin、CAPTCHA、内存限流、账号存在性判断和脱敏审计，再通过 Supabase Admin `generateLink()` 生成一次性链接并调用 provider adapter。未知邮箱的重置 / 邮件登录仍返回通用状态，不暴露账号存在性。
- 通知类 API 根据账号状态、CAPTCHA、限流、幂等 key 和安全策略写入 outbox。
- `api/_lib/mailOutbox.js` 是服务端唯一入队 helper；它会读取 suppression / budget counter，再调用 `enqueue_mail_outbox_event()` RPC 原子写入 outbox。
- `api/_lib/mailOutboxWorker.js` 负责队列处理状态机，不能在公开请求里无限同步等待邮件平台。
- `api/_lib/mailProviderAdapter.js` 负责 provider 抽象；默认演练 provider 不发送邮件，Stalwart SMTP 真实传输仅在显式关闭演练模式、关闭紧急停发开关且配置 SMTP 凭据后使用。
- `api/_lib/mailTemplateRenderer.js` 负责统一邮件模板。新增模板应同时提供 HTML 和 plaintext fallback。
- `api/_routes/root/mail-outbox-worker.js` 是内部队列处理 endpoint，同时接受 `MAIL_OUTBOX_WORKER_SECRET` 和 `CRON_SECRET` 鉴权；Vercel Cron 使用 `Authorization: Bearer <CRON_SECRET>` 触发，外部 cron / 受控运维脚本可使用独立 `MAIL_OUTBOX_WORKER_SECRET`。是否真正处理队列仍由 `MAIL_OUTBOX_WORKER_ENABLED`、演练模式和紧急停发开关决定。
- `api/_routes/root/mail-delivery-feedback.js` 是内部投递反馈入口，只接受 `MAIL_DELIVERY_WEBHOOK_SECRET` / `STALWART_WEBHOOK_SECRET` / `POSTAL_WEBHOOK_SECRET` 对应的服务端 secret，不给浏览器或普通用户调用。
- `api/_routes/root/mail-inbound.js` 是内部入站事件入口，只接受 `MAIL_INBOUND_WEBHOOK_SECRET` / `STALWART_INBOUND_WEBHOOK_SECRET` / 兼容 webhook secret，不给浏览器或普通用户调用；它只保存 sender / recipient hash、域名、subject hash、大小和附件数量等脱敏摘要。
- 超级管理员可在后台“邮件状态”页手动触发 `/api/admin?route=mail-outbox-drain` 处理到期 outbox；该入口仍遵守队列处理器开关、演练模式和紧急停发开关。
- 超级管理员可在后台“邮件状态”页发送测试邮件；该入口直接调用当前 provider adapter 做受控测试邮件，不写入 outbox，不保存原始邮箱，只写入脱敏 `mail_delivery_events`。如果队列处理器未启用或真实发送紧急停发未关闭，页面会显示跳过原因。
- 超级管理员可在后台“邮件状态”页触发受控管理员告警；该入口只写入当前超管自己的 `admin.alert` outbox，不支持任意收件人或批量发送，仍遵守 `ADMIN_ALERT_MAIL_OUTBOX_ENABLED`、队列处理器开关、演练模式和紧急停发开关。
- 超级管理员可在后台“邮件状态”页保存运行期开关；保存路径为 `/api/admin?route=mail-runtime-config`，数据落在 `site_config.mail_runtime_config`。环境变量仍是最高限制：例如 `AUTH_MAIL_ACTIONS_ENABLED=false` 时，运行期开关选择“允许认证邮件”也不会启用真实发信；`MAIL_OUTBOX_GLOBAL_KILL_SWITCH=true` 时，运行期关闭紧急停发也不会绕过全局停发。
- 邮件平台 API key / SMTP 密码只存在服务端环境变量或私有 worker 配置里。
- 投递结果通过 webhook 或轮询进入内部事件表，不暴露平台原始错误给普通用户。

## DNS 与投递基础设施清单

上线前必须具备：

- 独立发信子域，例如 `mail.example.com` 或 `notify.example.com`。
- SPF 记录，限定允许发信来源。
- DKIM 签名和密钥轮换方案。
- DMARC 策略，先 `p=none` 观测，再逐步收紧到 `quarantine` / `reject`。
- PTR / rDNS，指向发信主机名。
- TLS 证书和 SMTP TLS 配置。
- HELO / EHLO 主机名与 DNS / rDNS 一致。
- 退信地址和 bounce 处理。
- abuse / postmaster 邮箱或等价处理入口。
- 投递日志保留周期和脱敏规则。
- IP / 域名预热策略，初期低速发送。
- 黑名单和信誉监控。

参考事实：

- Google 发信方指南 FAQ 要求面向 Gmail 个人账号的发信满足认证、DNS、TLS、低投诉率、DMARC 等要求，并从 2025 年 11 月起加强不合规流量处置。[Google Workspace Admin Help, Email sender guidelines FAQ, https://support.google.com/a/answer/14229414]
- Microsoft Outlook.com 发信支持文档明确发送 IP / 域名信誉、认证、投诉率和内容会影响投递能力，新 IP 需要逐步建立信誉。[Microsoft Support, Sender Support in Outlook.com, https://support.microsoft.com/en-us/office/sender-support-in-outlook-com-05875e8d-1950-4d89-a5c3-adc355d0d652]

## 邮件类型与优先级

| 类型 | 优先级 | 首期发送 | 默认额度策略 | 失败降级 |
| --- | --- | --- | --- | --- |
| 注册确认 | 高 | 可选，取决于 Auth 策略 | IP + 邮箱 + 域名 + 全局预算 | 页面提示稍后重试 / 人工处理 |
| 密码重置 | 高 | `AUTH-003` 后启用 | 更严格；幂等 key；冷却窗口 | 人工恢复申请 |
| 工单回复 | 中 | 已接入 outbox，默认关闭 | 用户 + 工单 + 每日预算 | 站内通知 |
| 开发者 API 审核 | 中 | 已接入 outbox，默认关闭 | 用户 + 事件幂等 | 设置页状态 |
| 管理员告警 | 中 | 已接入受控自告警 outbox，默认关闭 | 超管本人 + 事件幂等 | 后台 badge |
| 营销 / 群发 | 禁止 | 不启用 | 不适用 | 不适用 |

## 已落地的应用侧 scaffold

Task 9 已加入 provider-independent 防刷与预算基础层：

- `api/_lib/mailAbuseGuards.js`
  - 归一化收件邮箱和域名。
  - 用 HMAC 生成 `recipient_email_hash`、域名 hash、预算桶 key 和去重 key。
  - 输出统一决策：`queue`、`block`、`dedupe`。
  - 支持全局紧急停发、事件禁用、域名暂停、suppression、幂等和多维预算桶。
  - 提供 `sanitizeMailPayload()`，默认脱敏 Token、密码、API key、邮箱、`user_id`、`game_uid`、平台 ID 和原始记录字段。
- `supabase/migrations/116_add_mail_outbox_and_abuse_controls.sql`
  - 新增 `mail_outbox`、`mail_suppression`、`mail_abuse_budget_config`、`mail_abuse_budget_counters`、`mail_delivery_events`。
  - 表默认启用 RLS，并显式撤销 `anon` / `authenticated` 权限。
  - 保存收件人 hash、域名、脱敏 payload、guard decision 和 provider message hash，不保存明文收件邮箱或敏感 token。
- `npm run test:mail-abuse-guards`
  - 覆盖允许入队、紧急停发、域名暂停、suppression、幂等、预算超限和 payload 脱敏。

Task 18 已加入 provider-independent outbox 入队层：

- `api/_lib/mailOutbox.js`
  - 仅接受 service-role Supabase client。
  - 统一执行幂等检查、suppression 读取、预算 counter 读取、payload 脱敏和 RPC 入队。
  - 不包含 SMTP、JMAP、Stalwart SDK、Postal API 或任何真实发信逻辑。
- `supabase/migrations/120_add_mail_outbox_enqueue_rpc.sql`
  - 新增 `enqueue_mail_outbox_event()`。
  - 在数据库事务内锁定预算桶、判断超限、写入 `mail_outbox`、递增 `mail_abuse_budget_counters`。
  - 仅 grant 给 `service_role`，不授权 `anon` / `authenticated`。
- `npm run test:mail-outbox-enqueue`
  - 覆盖正常入队、幂等命中、suppression、预算超限、payload 脱敏和 RPC 权限边界。

这些接口只供同源 API / worker 调用。当前唯一面向浏览器的发信入口是受控认证邮件路由 `/api/auth-email-action`，只允许注册验证、密码重置和邮件登录三类动作；项目仍不提供任意收件人 / 任意模板的公开“发送邮件”API。

Task 25 已加入 provider-independent 队列处理器 / adapter 边界：

- `api/_lib/mailProviderAdapter.js`
  - 读取 `MAIL_PROVIDER`、`MAIL_WORKER_DRY_RUN`、发件人、Stalwart SMTP / JMAP 占位配置，以及后续 Postal API / SMTP 备选配置。
  - 默认演练 provider 返回稳定的 provider message id hash 输入，不连接网络、不发送邮件。
  - `MAIL_WORKER_DRY_RUN=false` 时支持内置 Stalwart SMTP transport；未配置 SMTP 主机、账号或密码会返回 `stalwart_smtp_not_configured`，不会伪装成功。
- `api/_lib/mailOutboxWorker.js`
  - 从 `mail_outbox` 读取 `status = queued` 且 `next_attempt_at <= now()` 的 due rows。
  - 用条件更新把行 claim 为 `sending`，避免多个队列处理器同时处理同一行。
  - 支持 `password_reset + account_recovery + auth.password-reset`、`developer_api_review + api_client + developer-api.review`、`ticket_reply + ticket + ticket.reply` 和 `admin_alert + profile + admin.alert`。因为 `mail_outbox` 不保存明文邮箱，队列处理器必须通过受控业务上下文解析收件人；管理员告警只能解析到当前超管 profile 邮箱。
  - 演练成功时写入 `mail_delivery_events.event_type = dry_run_accepted`，并把 outbox 放回 `queued`、推迟 `next_attempt_at`，不把账号恢复状态改成“已发送”。
  - live transport 成功时写入 `status = sent`、`provider_key`、`provider_message_id_hash`，并把恢复申请推进到 `mail_reset_sent`。
  - live transport 不可用、模板不支持或重置链接生成失败时写入 `failed` 或重新排队，并把恢复申请推进到 `mail_reset_failed` 或保持 `mail_reset_queued`。
- `scripts/run-mail-outbox-worker.mjs`
  - 提供本地 / 受控任务入口：`npm run worker:mail-outbox`。
  - 默认仍受 `MAIL_OUTBOX_WORKER_ENABLED` 和 `MAIL_WORKER_DRY_RUN` 控制。
- `api/_routes/root/mail-outbox-worker.js`
  - 提供内部 HTTP worker endpoint：`/api/mail-outbox-worker`。
  - 通过 `Authorization: Bearer <secret>`、`x-mail-outbox-worker-secret`、`x-mail-worker-secret` 或 `x-cron-secret` 鉴权。
  - accepted secrets 同时包含 `MAIL_OUTBOX_WORKER_SECRET` 和 `CRON_SECRET`，解决生产环境单独设置 worker secret 后 Vercel Cron 的 `Authorization: Bearer <CRON_SECRET>` 被拒绝的问题。
  - `vercel.json` 已配置每日一次 `/api/mail-outbox-worker` cron；该 cron 只是触发队列处理，默认仍会因 `MAIL_OUTBOX_WORKER_ENABLED=false`、`MAIL_WORKER_DRY_RUN=true`（演练模式）或 `MAIL_OUTBOX_GLOBAL_KILL_SWITCH=true`（紧急停发）安全跳过。
- `npm run test:mail-outbox-worker`
  - 覆盖未启用队列处理器、演练模式、账号恢复真实传输成功、开发者 API 审核通知解析、工单回复通知、管理员告警通知、真实传输缺配置失败、unsupported template failure、状态回写和脱敏边界。
- `npm run test:mail-service-entrypoints`
  - 覆盖内部队列处理 endpoint 鉴权、后台测试邮件入口、真实发送紧急停发、演练模式和投递事件脱敏。

Task 26 已加入内部投递反馈 / suppression 回写基础层：

- `api/_lib/mailDeliveryFeedback.js`
  - 接收 provider 投递事件摘要，统一归类 `hard_bounce`、`complaint`、`invalid_recipient`、`domain_pause`。
  - 只保存收件人 hash 或域名，不保存明文收件邮箱。
  - 写入 `mail_delivery_events`，并在需要停发时插入或更新 `mail_suppression`。
  - 如果有 outbox id，会把对应 `mail_outbox.status` 标为 `suppressed`，并写入脱敏错误摘要。
- `api/_routes/root/mail-delivery-feedback.js`
  - 仅支持 POST。
  - 通过 `Authorization: Bearer <secret>` 或 `x-mail-webhook-secret` / `x-stalwart-webhook-secret` / `x-webhook-secret` 鉴权。
  - secret 来源优先为 `MAIL_DELIVERY_WEBHOOK_SECRET`，其次兼容 `STALWART_WEBHOOK_SECRET` / `POSTAL_WEBHOOK_SECRET`。
- `npm run test:mail-delivery-feedback`
  - 覆盖 hard bounce 创建 suppression、complaint 更新 suppression、domain pause、普通 delivered 事件只写 delivery event、缺少 suppression target 拒绝、secret 鉴权和脱敏边界。

Task 27 已加入内部入站邮件事件记录层：

- `api/_lib/mailInboundEvents.js`
  - 接收 Stalwart Webhooks / MTA Hooks 或受控桥接脚本提交的入站摘要。
  - 只保存 sender / recipient hash、域名、subject hash、邮件大小、附件数量和脱敏 diagnostics。
  - 不保存原始正文、附件、明文邮箱或 message-id。
- `api/_routes/root/mail-inbound.js`
  - 仅支持 POST。
  - 通过 `Authorization: Bearer <secret>` 或 `x-mail-inbound-secret` / `x-stalwart-inbound-secret` / `x-webhook-secret` 鉴权。
  - secret 来源优先为 `MAIL_INBOUND_WEBHOOK_SECRET`，其次兼容 `STALWART_INBOUND_WEBHOOK_SECRET` / `MAIL_DELIVERY_WEBHOOK_SECRET` / `STALWART_WEBHOOK_SECRET`。
- `npm run test:mail-inbound`
  - 覆盖入站摘要写入、明文邮箱 / subject / token 脱敏、缺少 envelope 拒绝和 secret 鉴权。

Task 19 已把 provider-independent 账号恢复状态层接到可选 reset-mail outbox：

- `api/_routes/root/account-recovery-request.js`
  - 对未知邮箱、已有 pending 申请和新建申请返回同一通用 `received` 响应。
  - 新申请记录 `delivery_channel = manual`、`next_step = manual_review_pending` 和脱敏 `recovery_audit`。
  - 当 `ACCOUNT_RECOVERY_MAIL_OUTBOX_ENABLED=true` 且 `MAIL_OUTBOX_WORKER_ENABLED=true`，`password_reset` 申请会调用 `api/_lib/mailOutbox.js` 写入 `mail_outbox`。
  - 入队成功或幂等命中后，申请更新为 `delivery_channel = mail_outbox`、`next_step = mail_reset_queued`，并保存 `mail_outbox_id` 和脱敏审计事件。
  - 入队被预算 / suppression / 紧急停发等 guard 阻断、helper 异常或状态更新失败时，接口仍返回通用 `received`，申请保持或回落到 `manual_review_pending`。
  - `delete_account` 申请不进入密码重置邮件队列。
- `api/_routes/root/admin.js`
  - 超管设置账号恢复临时密码后，记录临时密码过期时间、强制改密状态和审计事件。
  - auth 密码更新成功但状态持久化失败时返回 `partial` 和 `warnings`，避免误报整体失败。
- `api/_routes/root/account-security-state.js`
  - 登录用户通过同源 API 读取/清除自己的强制改密状态。
  - 状态来自私有 `account_security_states`，不写入公开 `profiles`。
- `api/_lib/authSecurityGuards.js`
  - 注册、登录、密码重置预检和账号恢复申请复用服务端风险桶。
  - `AUTH_CAPTCHA_MODE=monitor|enforce` 时可接入 Turnstile / hCaptcha token；默认 `off` 不改变当前前端体验。
  - 审计输出只包含请求者 / 邮箱 hash、风险原因、CAPTCHA 摘要和脱敏 metadata。
- `supabase/migrations/117_add_account_recovery_state_metadata.sql`
  - 扩展 `account_recovery_requests` 的 delivery / next-step / temporary-password metadata。
  - 新增 `account_security_states`，仅用户本人可读，写入由服务端 service role 完成。
- `supabase/migrations/119_add_auth_security_events.sql`
  - 新增私有 `auth_security_events`，仅 service role 可写、超管可读。
  - 不保存原始邮箱、密码、CAPTCHA token、`game_uid`、平台 ID 或用户私密标识。

自助密码重置已由 `/api/auth-email-action` 接管：在 `AUTH_MAIL_ACTIONS_ENABLED=true`、`MAIL_OUTBOX_WORKER_ENABLED=true` 且未命中 `MAIL_OUTBOX_GLOBAL_KILL_SWITCH` 时，同源请求会先通过 CAPTCHA / 内存限流 / 账号存在性判断，再用 Supabase Admin `generateLink()` 生成一次性重置链接并通过当前 provider adapter 发送统一 HTML 邮件。未知邮箱仍返回通用状态，不暴露账号存在性。`account-recovery-request` 的 reset-mail outbox 只作为人工恢复申请链路中的可选队列能力保留；队列处理器可以在演练模式下验证队列和模板链路，也可以由后台“邮件状态”页手动触发。人工恢复继续作为风控命中、邮件不可用、投递失败、邮箱不可访问或 shared relay 被封时的 fallback。

## outbox 数据模型

```text
mail_outbox
  id
  event_type
  recipient_email_hash
  recipient_domain
  template_key
  locale
  payload_redacted_json
  idempotency_key
  priority
  status: queued | sending | sent | failed | suppressed | cancelled
  attempt_count
  next_attempt_at
  last_error_code
  last_error_redacted_json
  provider_key
  provider_message_id_hash
  guard_decision
  created_by_user_id
  related_entity_type
  related_entity_id
  created_at
  updated_at
```

不要在 outbox 里保存：

- 明文密码。
- 完整重置 token。
- 完整 API key。
- 原始抽卡记录、`game_uid`、平台用户 ID。
- 不必要的邮件正文长文本。

## anti-abuse 必须前置

当前已落地 guard / outbox / 队列处理器 scaffold，但后续真正启用发信前仍必须补齐：

- CAPTCHA 或等价人机校验接入注册、重置、恢复申请；生产环境开启 `AUTH_CAPTCHA_MODE=enforce` 前必须先让前端提交真实 provider token。
- 服务端必须通过 `mailOutbox` / `enqueue_mail_outbox_event()` 入队，禁止业务路由直接写 `mail_outbox`。
- 账号恢复邮件必须同时启用 `ACCOUNT_RECOVERY_MAIL_OUTBOX_ENABLED=true` 和 `MAIL_OUTBOX_WORKER_ENABLED=true`，避免只开业务路由但没有队列处理器。
- `MAIL_WORKER_DRY_RUN=true`（演练模式）不能作为真实投递证明；只适合验证队列处理器能取队列、解析上下文、渲染模板和写入脱敏事件。
- `MAIL_WORKER_DRY_RUN=false` 前必须有真实 Stalwart SMTP transport、DNS、内部 suppression 回写、基础后台健康面板和人工恢复 fallback；JMAP 可后续接入。
- 管理员 UI 已展示关键邮件开关、运行期紧急停发、事件禁用、单域名暂停、outbox / suppression / delivery events / 入站事件和发送预算高水位；“邮件状态”页已支持在线编辑 `mail_abuse_budget_config` 的窗口、上限和启用状态。
- Stalwart Telemetry Webhook 可直接把 `delivery.delivered`、`delivery.dsn-success`、`delivery.dsn-temp-fail`、`delivery.dsn-perm-fail`、`delivery.double-bounce`、`delivery.rate-limit-exceeded`、`queue.rate-limit-exceeded` 批量 POST 到 `/api/mail-delivery-feedback`；该入口只保存脱敏事件，永久失败才写入 `mail_suppression`。如果不用 Webhook，也可以用受控中继任务或受控日志轮询调用同一入口。
- Stalwart / MTA Hooks 或受控桥接脚本可以把 `support@`、`postmaster@`、`abuse@` 的入站摘要调用 `/api/mail-inbound`，只用于后台观测；自动转工单要另开任务并先定义正文脱敏、附件处理和用户身份绑定规则。
- 幂等 key 命中时返回可解释状态，不重复发信。
- 后台“站点健康”已展示 outbox、suppression、delivery events、发送预算高水位、环境硬闸门和运行期开关状态；最近失败 outbox 会返回脱敏 `last_error_redacted_json`，用于后台下钻诊断。后续仍需补 Stalwart 管理端真实 Webhook 配置复测。
- 后台“邮件状态”页可手动处理到期 outbox、发送测试邮件、保存运行期开关，展示入站事件计数与预算高水位，编辑预算配置，并查看最近失败 / suppressed outbox 的脱敏错误摘要。后续仍需补真实 Stalwart 事件来源小范围测试。
- 灰度开关：先对管理员账号或小比例用户开启。

## 方案对比

| 方案 | 更适合 | 优点 | 风险 / 成本 | 首期建议 |
| --- | --- | --- | --- | --- |
| Stalwart | 当前 Supabase 同机低频事务邮件，后续可扩展完整邮箱 | 资源占用低；Docker 单体；SMTP / IMAP / JMAP / Web 管理完整；适合现有服务器余量 | 不是专门事务邮件平台，webhook / suppression / 投递日志需要按项目边界补齐 | Phase 1 默认优先方向 |
| Postal | 独立邮件 VPS 上的事务邮件投递平台 | HTTP API / SMTP、投递日志、webhooks、suppression、send limits 和发信平台定位清晰 | 官方最低 4GB RAM / 2 CPU / 25GB disk，建议独立服务器；不适合同机挤压 Supabase | 后续拆出独立邮件 VPS 时再评估 |
| mailcow | 完整邮箱套件 | Web 管理完整，生态成熟 | 资源占用和组件面较重 | 不作为第一阶段默认 |
| Mailu | Docker 邮件套件 | Compose 部署，组件化 | 仍是完整邮箱运维，不是轻量事务邮件 | 作为完整套件备选 |
| Cloudflare Email Service | Cloudflare Workers 场景下的收发邮件 | Email Routing 免费、Email Sending 可从 Workers / external servers 调用 REST API | 发信需要 Workers Paid，额度和 Workers 账单绑定；不是自建 Stalwart 的替代 | 可作为后续 fallback adapter 或收信转发入口 |
| 第三方 SMTP | 快速发信 | 低运维 | 额度、封禁、恶意消耗和供应商限制 | 仅作临时 fallback 或测试 |

## 官方资料入口

- Postal: open source mail delivery platform for websites and web servers, with web interface, webhooks, IP pools and send-limit features. See `https://docs.postalserver.io/` and `https://docs.postalserver.io/welcome/feature-list/`.
- Postal self-hosting caveat: Postal documentation states self-hosting requires DNS configuration and platform maintenance, including upgrades. See `https://docs.postalserver.io/getting-started`.
- Stalwart deployment guide for this project: `docs/STALWART_DEPLOYMENT_GUIDE.md`.
- Cloudflare Email Routing / Email Service: Email Routing is available on all plans and free for inbound routing; Email Sending requires Workers Paid and includes 3,000 outbound emails per month, then $0.35 per 1,000 emails. See `https://developers.cloudflare.com/email-routing/` and `https://developers.cloudflare.com/email-service/platform/pricing/`.
- Stalwart: Mail & Collaboration Server with rate limiting and automatic IP banning; rate-limit docs cover HTTP, IMAP / POP3 and JMAP-related controls. See `https://stalw.art/` and `https://stalw.art/docs/email/settings/ratelimit`.
- mailcow: Dockerized open-source groupware / e-mail suite with a web UI and components such as Dovecot, DKIM / ARC, spam controls and monitoring. See `https://docs.mailcow.email/`.
- Mailu: Docker-based full-featured mail server with IMAP, SMTP, submission, webmail, administration, TLS, DKIM and anti-virus features. See `https://mailu.io/`.

## 推荐默认决策

当前用户决策：

- `DECISION-1`: Stalwart first。
- `DECISION-2`: Phase 1 只做入站事件脱敏记录，不做正文解析或邮件回复转工单。
- `DECISION-3`: 优先使用当前自建 Supabase 服务器同机低频部署；独立发信子域；是否拆独立邮件 VPS 取决于后续资源和投递信誉验证。

后续实现按以下默认设计继续：

- 先做 provider-independent `mail_outbox` / `notification_event` 和发送预算模型。
- 预算判断以 `api/_lib/mailAbuseGuards.js` 为唯一入口，不在具体账号、工单或开发者 API 流程里各写一套。
- 邮件平台 adapter 默认 provider 为 `stalwart`，但接口先只依赖 worker/adapter 抽象，不在公开 API 中绑定 Stalwart SDK。
- Phase 1 不实现完整收信正文处理；工单回复仍走站内 `/api/tickets/reply`，入站邮件只作为脱敏事件进入后台观测。
- 不把 Supabase Auth 邮件作为唯一主链；应用侧应能在邮件不可用时降级到人工恢复。
- 不在公开仓库提交任何真实 SMTP 主机、密码、API key、DKIM 私钥或服务器 IP。
