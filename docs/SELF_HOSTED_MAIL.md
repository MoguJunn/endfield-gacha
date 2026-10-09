# 邮件架构、开关与投递边界

项目提供受控认证邮件和事务通知，默认使用 Stalwart adapter。应用侧已实现模板、预算、防刷、队列、投递反馈和入站摘要；真实发信是否启用由部署环境决定。

邮件服务器安装、DNS 和传输配置见 [Stalwart 指南](STALWART_DEPLOYMENT_GUIDE.md)，代码位置见 [CODEMAP](CODEMAP.md)。

## 两条发送链路

**认证邮件**通过同源 `/api/auth-email-action` 处理注册验证、密码重置和邮件登录。它先检查 origin、CAPTCHA、限流与账号存在性，再生成一次性链接并使用统一模板调用 adapter。未知邮箱重置／登录返回通用状态，避免枚举。

**事务通知**和人工恢复走 `mail_outbox`。服务端 `mailOutbox.js` 核对幂等、suppression 和预算，通过 `enqueue_mail_outbox_event()` 原子写入，Worker 领取后解析收件人、渲染模板并回写结果。业务路由不直接写队列表，也不公开任意收件人／模板的发送接口。

工单回复先写入 `/api/tickets/reply`，通知入队失败不阻断回复；审核通知同样不阻断审核。管理员告警只发送给当前超级管理员本人。用户界面接收脱敏发送状态，不返回邮箱或内部风控详情。

## 启用条件

```env
MAIL_PROVIDER=stalwart
MAIL_OUTBOX_WORKER_ENABLED=false
MAIL_WORKER_DRY_RUN=true
MAIL_OUTBOX_GLOBAL_KILL_SWITCH=true
AUTH_MAIL_ACTIONS_ENABLED=false
ACCOUNT_RECOVERY_MAIL_OUTBOX_ENABLED=false
DEVELOPER_API_REVIEW_MAIL_OUTBOX_ENABLED=false
TICKET_REPLY_MAIL_OUTBOX_ENABLED=false
ADMIN_ALERT_MAIL_OUTBOX_ENABLED=false
```

以上是安全默认值。真实传输需开启 Worker、关闭演练模式与紧急停发开关，配置有效 SMTP，并开启对应业务开关。认证邮件也要求 Worker 开关，但经同源请求受控同步发送。

`site_config.mail_runtime_config` 是运行期限制：可暂停全局发送、事件或域名，只能收紧环境设置，不能绕过硬闸门。SMTP 密码、Webhook secret 不存入站点配置。

演练成功写 `dry_run_accepted`，任务重新排队并推迟执行，不标为已发送。真实成功才写 `sent`；传输失败按次数退避或置为失败，用户恢复链保留人工处理入口。

## Worker 与鉴权

- `api/_lib/mailOutboxWorker.js` 条件领取到期 `queued` 行并置为 `sending`，防止重复处理。
- `/api/mail-outbox-worker` 接受 `MAIL_OUTBOX_WORKER_SECRET` 或 `CRON_SECRET`。每日 Vercel cron 使用 Bearer secret，外部任务可使用独立 Worker secret。
- 后台邮件状态页可以处理到期队列、发送受控测试邮件、设置运行期开关并查看预算和脱敏失败摘要；所有入口仍遵守发送限制。
- 本地受控入口为 `npm run worker:mail-outbox`，运行前确认连接目标与环境配置。

outbox 不保存明文收件邮箱，Worker 通过账号、工单、审核等受保护上下文解析。幂等 key 和预算桶使用 HMAC；发送额度按账号、IP、邮箱、域名和全局策略限制，自建 SMTP 不代表无限额度。

## 模板与私有数据

`api/_lib/mailTemplateRenderer.js` 统一生成 HTML 和纯文本。新增邮件类型复用该入口，同时验证两种格式与客户端可读性。

队列保存模板键、locale、脱敏 payload、幂等 key、优先级、发送状态、重试时间和 provider message hash。一次性认证链接按业务需要在发送时生成，不将明文密码、完整 API key、原始历史、游戏 UID 或平台身份塞入通知 payload。

账号恢复申请始终返回通用 `received`，邮件关闭、风控命中、入队或投递失败时保留人工恢复。删除账号申请不进入重置邮件队列；临时密码与会话撤销规则见 [认证合同](AUTH_SECURITY_HARDENING.md)。

## 投递反馈与入站摘要

`/api/mail-delivery-feedback` 接受 `MAIL_DELIVERY_WEBHOOK_SECRET`，也兼容 provider secret。Stalwart Telemetry Webhook 可批量提交投递、DSN、退信和限流事件；仅永久失败、投诉、无效地址或域名暂停写入 suppression，成功和临时失败只记录脱敏事件。

`/api/mail-inbound` 使用 `MAIL_INBOUND_WEBHOOK_SECRET` 或兼容的受控 secret，仅保存 sender／recipient hash、域名、subject hash、大小、附件数量与脱敏诊断。不保存原始正文、附件、明文邮箱，也不自动将邮件转工单。

上线时用小范围真实投递验证发送、退信、suppression 和后台状态。代码已支持 Webhook 不代表目标邮件服务器已配置事件来源。

## 服务器与后续扩展

发信基础包括独立子域、SPF、DKIM、DMARC、PTR／rDNS、TLS、合理 HELO、退信处理、投诉监控和信誉预热。初期低速发送，观察投递质量后再增加业务范围。

Stalwart 适合事务邮件和后续完整邮箱；若需专门的投递平台可评估 Postal，完整邮箱套件可评估 Mailu／mailcow。第三方 SMTP 或 Cloudflare 服务可作为 adapter 的另一实现，费用和额度按对应供应商当前文档核对。

正文收信、邮件回复转工单与完整 JMAP 集成属于后续扩展，实施前定义身份绑定、正文／附件脱敏与权限合同。

## 验证入口

```bash
npm run test:mail-abuse-guards
npm run test:mail-outbox-enqueue
npm run test:mail-outbox-worker
npm run test:mail-service-entrypoints
npm run test:mail-delivery-feedback
npm run test:mail-inbound
```

这些检查验证应用合同，演练通过不能替代 SMTP、DNS 与真实投递验证。问题排查保留错误码与脱敏状态，不公开收件人、密钥或完整邮件内容。
