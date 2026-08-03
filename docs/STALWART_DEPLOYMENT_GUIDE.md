# Stalwart 自建邮件部署模板

本文档用于把项目的邮件方向从“只做 outbox / 演练模式”推进到 Stalwart-first 的可公开部署模板。当前代码仍默认 `MAIL_WORKER_DRY_RUN=true`（演练模式），不会真实发信；本指南只保留部署、验证、回滚和运维方法，不记录任何现有生产设施或人员信息。

## 认证发布额外门禁

`AUTH-HARDEN-001` Phase A–D 与本地候选验收已完成；生产数据库已于 2026-08-02 按 166 → 167 部署邮箱归属、首次设密和临时凭据数据库能力，API 尚未部署。测试邮件只证明投递链路，不能证明账号归属或 OAuth/Session 安全闭环；LinuxDo 已降为 P3，真实 Connect Client 验收完成前保持关闭且不阻塞本发布。

## 结论

- 第一阶段优先使用 Stalwart：它更适合当前自建 Supabase 服务器的资源余量，也保留后续完整邮箱能力。
- Postal 暂退为后续独立邮件 VPS 上的事务邮件平台备选。
- Cloudflare Email Routing 可以做免费收信转发；Cloudflare Email Sending 可以通过 Workers / external servers REST API 发信，但发信需要 Workers Paid，额度为每月 3,000 封，超出后 $0.35 / 1,000 封。它可以作为后续 fallback adapter，不替代 Stalwart 主线。
- 应用只写 `mail_outbox`，由受控 worker 拉取并调用 provider。前端和公开 API 不直接调用 Stalwart 或 Cloudflare。

## 部署前服务器评估模板

先从私有资产清单读取目标服务器规格，并把评估结果记录在受限运维系统中。公开文档只保留以下判断口径：

| 项目 | 待部署服务器 | Stalwart 参考需求 | 判断 |
| --- | --- | --- | --- |
| CPU | `<cpu-capacity>` | 低流量约 1 core 可运行 | `<assessment>` |
| 内存 | `<memory-capacity>` | idle 约 100MB；5-10 用户约 1GB RAM | `<assessment>` |
| Swap | `<swap-capacity>` | 无硬性要求 | `<assessment>` |
| 磁盘 | `<disk-capacity>` | 取决于邮件数据 / 日志 / retention | `<assessment>` |
| Docker | `<docker-version>` / `<compose-version>` | Docker 部署可用 | `<assessment>` |
| 出站 SMTP | `<open-or-blocked>` | 直接投递时需要 | `<assessment>` |
| 现有服务 | `<co-located-services>` | Stalwart 建议按实际负载调参 | `<assessment>` |

同机部署边界：

- 只做低频事务邮件：密码重置、工单提醒、审核通知、管理员告警。
- 不启用营销 / 群发。
- 初期不开放公共邮箱注册或多用户 IMAP 使用。
- 保持 `MAIL_OUTBOX_GLOBAL_KILL_SWITCH=true`（环境级紧急停发）到真实发信链路验证完成。
- 生产前要限制连接数、日志保留、队列重试和 Stalwart 存储增长。

## 部署状态记录模板

以下字段用于私有运维记录；公开副本必须只保留占位符：

- Compose 目录：`<stalwart-compose-dir>`
- 配置挂载：`<stalwart-config-dir>`
- 数据挂载：`<stalwart-data-dir>`
- Compose 文件：`<stalwart-compose-file>`
- recovery 凭据来源：`<private-credential-path>`，只允许由私有密码管理器或服务器受限 secret store 注入
- 容器名：`stalwart`
- 镜像：`stalwartlabs/stalwart:v0.16`
- 管理端：仅绑定 `<loopback-address>:<local-admin-port> -> <container-admin-port>`
- 当前状态：`<container-health>`
- 管理入口：`https://<mail-host>/<admin-path>`，应配合访问控制，不在公开记录中保留真实入口
- 公网端口：`<public-mail-ports>`
- 回滚备份：`<private-backup-path>`

生产前置检查记录模板：

- `<mail-host> A -> <mail-server-ip>`
- `<mail-domain> MX -> <mail-host>`
- `SPF / DKIM / DMARC` 均已通过公网 DNS 解析。
- `PTR / rDNS`: `<mail-server-ip> -> <mail-host>`
- TLS 服务已切到 Let's Encrypt production 证书：
  - Subject: `CN=<mail-host>`
  - Issuer: `Let's Encrypt E8`
  - SAN: `DNS:<mail-host>`
  - 有效期：`<certificate-validity-window>`
- submission listener 已创建并在容器重启后生效；STARTTLS 使用同一张 Let's Encrypt production 证书。
- 未认证 open relay 探针通过：外发第三方域收件人返回 `550 5.1.2 Relay not allowed.`
- 未认证 submission 探针通过：未认证 `MAIL FROM` 返回 `503 5.5.1 You must authenticate first.`
- `<sender@example.com>` SMTP AUTH 测试通过；本域内测试邮件 `<sender@example.com> -> <postmaster@example.com>` 已成功入库投递。
- 外部投递测试邮件已完成：`<sender@example.com> -> <external-test-recipient@example.com>` 被目标服务器接受并进入投递队列。

当前仍未完成：

- 真实发信仍未启用；项目环境变量继续保持 `MAIL_WORKER_DRY_RUN=true`（演练模式）和 `MAIL_OUTBOX_GLOBAL_KILL_SWITCH=true`（环境级紧急停发）。
- 应用侧 Stalwart SMTP live transport 已接入；内部 `/api/mail-delivery-feedback` 已可记录 hard bounce / complaint / invalid recipient / domain pause，也能接收 Stalwart Telemetry Webhook 的 `{ events: [...] }` 批量投递事件并按永久失败写入 suppression；内部 `/api/mail-inbound` 已可记录 Stalwart Webhooks / MTA Hooks 或受控桥接脚本提交的入站摘要；后台“站点健康”和“邮件状态”面板已可查看 outbox、suppression、delivery events、入站事件、预算高水位、环境变量硬闸门和 `site_config.mail_runtime_config` 运行期开关；JMAP live transport 仍未接入。
- Outlook 原始邮件头已确认 `SPF / RSA DKIM / DMARC / compauth` 均通过；Ed25519 DKIM 已退役。Outlook 仍按 `SCL=5` 投递到垃圾邮件夹，后续按冷启动信誉问题处理。

访问 WebUI 的推荐方式：

```bash
ssh -i <ssh-private-key> -L <local-admin-port>:<loopback-address>:<remote-admin-port> <admin-user>@<mail-server-ip>
```

随后在本机浏览器打开：

```text
http://<loopback-host>:<local-admin-port>/<admin-path>
```

登录凭据必须从私有密码管理器或服务器受限 secret store 临时注入，禁止在文档或命令中直接读取真实凭据。完成 WebUI 初始化并创建永久管理员后，撤销 bootstrap 凭据、重启容器并确认旧凭据不再有效。

真实发信前不要直接把生产环境变量切到 `MAIL_WORKER_DRY_RUN=false`。当前应用代码已支持 Stalwart SMTP 真实传输，但仍受 `MAIL_OUTBOX_WORKER_ENABLED`、`MAIL_WORKER_DRY_RUN`（演练模式）、`MAIL_OUTBOX_GLOBAL_KILL_SWITCH`（环境级紧急停发）、`site_config.mail_runtime_config` 运行期开关和 SMTP 凭据共同控制。运行期开关只能进一步暂停或缩小发信范围，不能绕过环境变量硬闸门，也不能保存 SMTP 密码或 Webhook secret。

### 账号与投递状态

Stalwart 部署完成后应仅按规划提供 SMTP / SMTPS / IMAPS，使用 ACME / Cloudflare DNS-01 签发 production 证书，并验证 `<submission-port>` listener 可用。项目必须创建专用发信账号；不要使用管理员账号作为应用发信账号。

账号规划模板：

| 邮箱 | 用途 |
| --- | --- |
| `<postmaster@example.com>` | RFC/投递问题联系与 DMARC/TLS-RPT 报告收件人 |
| `<abuse@example.com>` | 滥用投诉联系 |
| `<sender@example.com>` | 项目事务邮件发信账号 |
| `<support@example.com>` | 可选，后续工单收信或转发入口 |

账号要求：

- `<sender@example.com>` 使用单独强密码，只授予 SMTP submission 所需能力。
- 不把管理员账号密码配置进项目环境变量。
- 真实发信灰度前仍保持项目侧 `MAIL_WORKER_DRY_RUN=true`（演练模式）和 `MAIL_OUTBOX_GLOBAL_KILL_SWITCH=true`（环境级紧急停发）。

### 当前下一步：投递信誉与认证审计

账号创建、本域内投递、外部投递测试邮件和应用侧 Stalwart SMTP 真实传输均应纳入验收。如果目标邮箱服务已接受测试邮件、收件侧也确认收到，但邮件进入垃圾邮件夹，这通常不是 SMTP 链路失败，而是冷启动域名 / IP 信誉和内容信誉需要继续验证。

首封外部测试邮件的审计记录模板：

- `SPF`: pass，`smtp.mailfrom=<mail-domain>`，发信 IP `<mail-server-ip>` 被授权。
- `DKIM`: RSA 签名 pass，`header.d=<mail-domain>`；Ed25519 签名被目标服务标为 `signature syntax error`。
- `DMARC`: pass，`header.from=<mail-domain>`。
- `compauth`: pass。
- `SCL`: 5，`X-Microsoft-Antispam-Mailbox-Delivery` 显示 `dest:J` / `RF:JunkEmail`，因此进入垃圾邮件夹。

历史观察结论（Ed25519 退役前）：这不是认证主链失败。为了减少兼容性负信号，当时的处置建议是只保留 RSA-SHA256 DKIM 外发签名、暂停 Ed25519，并用真实事务邮件内容低频复测。

当前记录状态（Ed25519 已退役后的复测结果）：

- Stalwart 的 Ed25519 DKIM signature 已进入 pending deletion / retired 状态。
- 新邮件头只剩 `DKIM-Signature: a=rsa-sha256`。
- Outlook `Authentication-Results`: `spf=pass`、`dkim=pass`、`dmarc=pass`、`compauth=pass`。
- Outlook 仍给 `X-MS-Exchange-Organization-SCL: 5`，并继续投递到 `dest:J` / `RF:JunkEmail`。

结论：DKIM 兼容性问题已排除；后续不要继续围绕 DKIM 配置排查垃圾箱问题，应进入 IP / 域名信誉、邮件内容和收件端信任预热阶段。

下一步按低风险顺序推进：

1. 保持 Ed25519 DKIM 退役，只保留 RSA-SHA256 DKIM 外发签名。
2. 改用真实事务邮件内容低频测试，不再使用“测试”主题和过短正文。
3. 检查 `From`、`Return-Path`、`Message-ID`、`HELO/EHLO` 是否与 `<mail-domain>` / `<mail-host>` 边界一致。
4. 让测试收件账号在目标邮箱服务中把 `<sender@example.com>` 标记为“非垃圾邮件”，并加入联系人或安全发件人列表；这只能改善该用户侧信任，不代表全局信誉已建立。
5. 保留低频人工测试邮件，不做批量测试；新域名 / 新 IP 先用真实事务类内容慢速预热。
6. 在 Stalwart 管理端配置真实 Telemetry Webhook 并完成真实事件复测后，再考虑打开 `MAIL_WORKER_DRY_RUN=false`。项目侧 `/api/mail-delivery-feedback` 已能接收 Stalwart 批量投递事件，`/api/mail-inbound` 已能接收入站摘要；真实事件来源仍需在 Stalwart Webhooks、MTA Hooks 或受控日志轮询中配置。
7. 即使 SMTP live transport 已可用，账号恢复邮件仍保持 `ACCOUNT_RECOVERY_MAIL_OUTBOX_ENABLED=false`，直到投递监控和人工恢复 fallback 都验证完成。

### Submission listener 配置模板

官方文档说明：SMTP 服务由 `NetworkListener` 对象启用；submission 端口需要单独创建一个 protocol 为 `smtp`、bind 到 `[::]:<submission-port>` 的 listener。只在 Docker Compose 里映射端口不会自动让 Stalwart 监听该端口。

WebUI 操作：

1. 打开 `https://<mail-host>/<admin-path>`。
2. 进入 `Settings -> Network -> Listeners`。
3. 新建 listener：
   - Name: `submission`
   - Protocol: `smtp`
   - Bind: `[::]:<submission-port>`
   - `tlsImplicit`: `false`
   - TLS / STARTTLS 使用默认开启状态；保存后通过 `STARTTLS` 升级。
4. 保存后重启或等待配置热加载。

验证：

```bash
openssl s_client -starttls smtp -connect <mail-host>:<submission-port> -servername <mail-host> -brief
```

期望结果：能建立 TLSv1.2/TLSv1.3 连接，证书 issuer 为 Let's Encrypt production。

### 证书状态

可选方案：

1. **推荐：Stalwart 内置 ACME + Cloudflare DNS-01**
   - 适合 HTTPS 端口已由 OpenResty / 1Panel 反代占用的服务器。
   - 不要求 Stalwart 独占 `80 / 443`。
   - 需要创建 Cloudflare API token，权限限定为 `Zone.DNS:Edit`，只给 `<mail-domain>` zone。
2. **备选：复用现有 OpenResty / 1Panel 证书**
   - 把 `<mail-host>` 的证书和私钥以只读方式挂载给 Stalwart。
   - 风险是证书续期后需要同步 reload / restart Stalwart，自动化边界更复杂。

生产证书签发后，可用以下命令复核：

```bash
openssl s_client -connect <mail-host>:<smtps-port> -servername <mail-host> -brief
openssl s_client -connect <mail-host>:<imaps-port> -servername <mail-host> -brief
```

期望结果：Issuer 不包含 `(STAGING)`，并与预期的 Let's Encrypt production 证书链一致。

#### Cloudflare DNS-01 配置步骤

不要把 Cloudflare API token 粘贴到聊天或 Git 文件中。直接在 Stalwart WebUI 填写：

1. 打开 `https://<mail-host>/<admin-path>`。
2. 进入 `Settings -> Network -> DNS -> DNS Providers`。
3. 新建 DNS Provider / DnsServer：
   - Type: `Cloudflare`
   - Description: `Cloudflare <mail-domain>`
   - Secret: 粘贴 Cloudflare API token
   - TTL: `5m`
   - Polling interval: `15s`
   - Propagation timeout: 首次建议 `2m` 或 `5m`
4. 进入 `Settings -> TLS -> ACME Providers`。
5. 新建 ACME Provider，先用 staging 验证：
   - Directory: `https://acme-staging-v02.api.letsencrypt.org/directory`
   - Challenge type: `Dns01` 或 `DnsPersist01`
   - Contact: 管理员邮箱，例如 `<postmaster@example.com>`
   - Renew before: `R23`
6. 进入 `Management -> Domains -> Domains`，编辑 `<mail-domain>`。
7. 把 `DNS management` 改为 `Automatic`：
   - DNS server: 选择第 3 步创建的 Cloudflare DNS Provider
   - Origin: `<mail-domain>`
   - Publish records: 如果已经手动配置了邮件 DNS，先只允许最小必要记录，避免覆盖不想让 Stalwart 管的记录；如果 UI 不允许精细选择，则保存前先确认 Cloudflare 记录备份。
8. 同一个 Domain 上把 `Certificate management` 改为 `Automatic`：
   - ACME provider: 选择第 5 步创建的 ACME Provider
   - Subject Alternative Names: 至少确认包含 `<mail-host>`。如果当前 Domain 是 `<mail-domain>` 且 UI 没有自动把 `<mail-host>` 加入 SAN，需要手动添加。
9. 保存 Domain 后，到 `Management -> Tasks -> Scheduled / Failed` 查看 `DnsManagement` 与 `AcmeRenewal` 任务结果。
10. staging 成功后，把 ACME Provider 的 Directory 改成生产：
   - `https://acme-v02.api.letsencrypt.org/directory`
11. 再触发一次证书签发 / renew。

官方配置依据：

- `DnsServer` 的 Cloudflare provider 需要 `secret`，并通过 `ttl`、`pollingInterval`、`propagationTimeout` 控制记录发布与传播等待。
- `AcmeProvider` 只定义 ACME CA、challenge type、contact 和 renew policy；它不直接绑定域名。
- `Dns01` / `DnsPersist01` 会通过 Domain 的 `dnsManagement = Automatic` 引用的 DNS provider 发布 `_acme-challenge` 记录。
- 自动证书由 Domain 的 `certificateManagement = Automatic` 触发，并通过 `acmeProviderId` 引用 ACME Provider。
- 官方建议先使用 Let's Encrypt staging directory 验证配置，避免消耗生产 rate-limit。

## 域名规划

示例：

| 用途 | 示例 |
| --- | --- |
| Stalwart 主机 / SMTP / Web 管理 | `mail.example.com` |
| 发信地址 | `no-reply@example.com` 或独立事务邮件域下的 `no-reply@notify.example.com` |
| 可选支持邮箱 | `support@example.com` |
| abuse / postmaster | `abuse@example.com`、`postmaster@example.com` |

建议先用独立发信子域或专用邮箱，不直接把所有站点邮件绑定到主域根邮箱体系。

## 部署步骤

### 1. 部署前检查

1. 备份当前服务器重要配置。
2. 确认 `<smtp-port> / <smtps-port> / <submission-port> / <https-port> / <admin-port>` 的端口规划不会和 1Panel / OpenResty / Supabase 冲突。
3. 确认 Cloudflare / DNS 能把 `mail.example.com` 指向这台服务器。
4. 确认云厂商 PTR / rDNS 能设置为 `mail.example.com`。
5. 确认规划的出站 SMTP 端口可用。

同机部署时推荐只暴露必要端口：

| 端口 | 用途 | 初期建议 |
| --- | --- | --- |
| 25 | SMTP server-to-server | 如果要直接对外投递，需要开放 |
| 587 | SMTP submission | 项目 worker 发信优先使用 |
| 465 | SMTPS | 可选 |
| 443 | HTTPS / JMAP / Web 管理 | 推荐通过现有 OpenResty 反代 |
| 8080 | 初始 HTTP 管理 / bootstrap | 只绑定本机或临时防火墙放行 |
| 993 / 143 | IMAP / IMAPS | Phase 1 不需要，可不开放 |

### 2. 准备 Docker 数据目录

建议不要直接使用匿名 volume，便于备份和迁移：

```bash
mkdir -p <stalwart-config-dir>
mkdir -p <stalwart-data-dir>
chmod 700 <stalwart-config-dir> <stalwart-data-dir>
```

### 3. 启动 Stalwart

Stalwart 官方 Docker 镜像包含 JMAP、IMAP、POP3、SMTP、WebDAV 和管理 HTTP 界面。生产部署不要长期使用 `latest`，应固定版本标签。

示例 `docker-compose.yml`：

```yaml
services:
  stalwart:
    image: stalwartlabs/stalwart:v0.16
    container_name: stalwart
    restart: unless-stopped
    environment:
      STALWART_RECOVERY_ADMIN: "${STALWART_RECOVERY_ADMIN}"
    ports:
      - "25:25"
      - "587:587"
      - "465:465"
      - "<loopback-address>:<admin-port>:8080"
    volumes:
      - <stalwart-config-dir>:/etc/stalwart
      - <stalwart-data-dir>:/var/lib/stalwart
    logging:
      driver: json-file
      options:
        max-size: "20m"
        max-file: "5"
```

启动：

```bash
docker compose up -d
docker logs stalwart --tail=100
```

如果需要通过 HTTPS 访问管理端，优先用现有 OpenResty / 1Panel 反代到 `<loopback-address>:<admin-port>`，并在 Stalwart 设置公开 URL。不要让 bootstrap HTTP 管理端长期裸露公网。

### 4. 完成 WebUI 初始化

1. 访问 `http://<mail-server-ip>:<admin-port>/<admin-path>` 或反代后的 `https://mail.example.com/<admin-path>`。
2. 从私有密码管理器或服务器受限 secret store 临时注入 `STALWART_RECOVERY_ADMIN` 后登录，不在命令行或文档中打印其值。
3. 设置 server hostname，例如 `mail.example.com`。
4. 设置 default email domain，例如 `example.com` 或 `notify.example.com`。
5. 存储首期使用默认本地 RocksDB。
6. 日志选择 console，让 Docker log driver 控制大小。
7. DNS 管理先选择 manual，避免自动改错 DNS。
8. 创建永久管理员后移除 `STALWART_RECOVERY_ADMIN` 并重启。

### 5. 配置 DNS

至少需要：

- `A` / `AAAA`: `mail.example.com -> server IP`
- `MX`: 需要收信的域指向 `mail.example.com`
- `SPF`: 限定发信来源
- `DKIM`: 使用 Stalwart 生成的签名记录
- `DMARC`: 先 `p=none` 观察，再逐步收紧
- PTR / rDNS: 反解到 `mail.example.com`
- 可选 MTA-STS / TLS-RPT / autoconfig 记录

Stalwart WebUI 能生成需要发布的 DNS zone file。手动发布后，用 Gmail / Outlook / mail-tester 等低频测试投递，不要一开始大批量发信。

### 6. 创建项目发信账号

在 Stalwart 中创建专用发信账号，例如：

```text
no-reply@example.com
```

项目使用 SMTP submission：

```env
MAIL_PROVIDER=stalwart
MAIL_FROM_ADDRESS=no-reply@example.com
MAIL_FROM_NAME=Endfield Gacha
MAIL_SENDING_DOMAIN=mail.example.com

STALWART_SMTP_HOST=mail.example.com
STALWART_SMTP_PORT=587
STALWART_SMTP_USERNAME=no-reply@example.com
STALWART_SMTP_PASSWORD=<injected-secret>
STALWART_JMAP_URL=https://mail.example.com
STALWART_WEBHOOK_SECRET=<injected-secret>
MAIL_DELIVERY_WEBHOOK_SECRET=<injected-secret>
MAIL_INBOUND_WEBHOOK_SECRET=<injected-secret>

ACCOUNT_RECOVERY_MAIL_OUTBOX_ENABLED=false
MAIL_OUTBOX_WORKER_ENABLED=false
MAIL_WORKER_DRY_RUN=true
MAIL_OUTBOX_GLOBAL_KILL_SWITCH=true
```

敏感变量：

- `STALWART_SMTP_PASSWORD`
- `STALWART_WEBHOOK_SECRET`
- `MAIL_DELIVERY_WEBHOOK_SECRET`
- `MAIL_INBOUND_WEBHOOK_SECRET`
- `MAIL_OUTBOX_WORKER_SECRET`
- `MAIL_ABUSE_HASH_SECRET`

`MAIL_SENDING_DOMAIN` 用于 SMTP `EHLO` 和 `Message-ID` 域名，优先填写有 A / PTR / rDNS 对齐的邮件主机名，例如 `mail.example.com`。不要把它随意填成没有 PTR 的营销子域。

这些值必须从私有密码管理器或服务器受限 secret store 注入到私有 worker 环境或托管平台的敏感环境变量中，不通过本地凭据文件分发，也不写入 Git。

### 6.1 配置 Stalwart 投递 Webhook

项目侧内部入口已支持 Stalwart Telemetry Webhook 的批量事件格式：

```json
{
  "events": [
    {
      "id": "event-id",
      "createdAt": "2026-06-01T00:00:00Z",
      "type": "delivery.dsn-perm-fail",
      "data": {}
    }
  ]
}
```

在 Stalwart WebUI 中进入 `Settings -> Telemetry -> Webhooks` 后，新建一个投递事件 Webhook：

- URL: `https://<your-site>/api/mail-delivery-feedback`
- Method: `POST`
- HTTP auth: Bearer，值使用 `MAIL_DELIVERY_WEBHOOK_SECRET` 或 `STALWART_WEBHOOK_SECRET`
- Events: 至少包含 `delivery.delivered`、`delivery.dsn-success`、`delivery.dsn-temp-fail`、`delivery.dsn-perm-fail`、`delivery.double-bounce`、`delivery.rate-limit-exceeded`、`queue.rate-limit-exceeded`
- Events policy: 按包含列表发送，不要先订阅全部事件

映射边界：

- `delivery.dsn-perm-fail` / `delivery.double-bounce` 会按永久失败写入 `mail_suppression`。
- `delivery.delivered` / `delivery.dsn-success` / `delivery.dsn-temp-fail` 只写入脱敏 `mail_delivery_events`，不会停发。
- Stalwart 原始 event id、queue id、message id 会被 HMAC 后保存；原始收件邮箱、本地部分和 token 不进入响应或数据库诊断。
- 如果 Webhook 暂时无法配置，可用受控日志轮询脚本调用同一个 `/api/mail-delivery-feedback`，但同样必须携带服务端 secret。

### 7. 项目验证顺序

先只跑演练模式：

```bash
npm run test:mail-abuse-guards
npm run test:mail-outbox-enqueue
npm run test:mail-outbox-worker
npm run test:mail-delivery-feedback
npm run test:mail-inbound
npm run test:mail-service-entrypoints
```

再用本地或 staging 数据库验证：

```bash
MAIL_OUTBOX_WORKER_ENABLED=true MAIL_WORKER_DRY_RUN=true npm run worker:mail-outbox
```

当前代码已支持 Stalwart SMTP 真实传输。即使设置 `MAIL_WORKER_DRY_RUN=false`，若缺少 `STALWART_SMTP_HOST`、`STALWART_SMTP_USERNAME` 或 `STALWART_SMTP_PASSWORD`，也会返回 `stalwart_smtp_not_configured` 并失败，不会伪装投递成功。

### 8. 上线开关顺序

真实发信前按顺序推进：

1. 保持 `MAIL_OUTBOX_GLOBAL_KILL_SWITCH=true`（环境级紧急停发）。
2. Stalwart SMTP 真实传输、内部 `/api/mail-outbox-worker`、每日 Vercel Cron 触发、后台测试邮件入口、应用侧基础 suppression 回写、Stalwart Telemetry Webhook 批量投递事件归一、后台基础健康面板、发送预算高水位摘要、预算在线编辑和投递失败脱敏下钻已完成；JMAP 仍可后续补齐。
3. Outlook 垃圾邮件夹结果暂不阻断后续本地测试，但要继续按冷启动信誉处理，不做批量发信。
4. 在 Stalwart 管理端把投递事件 Webhook 配置到内部 `/api/mail-delivery-feedback`，或先用受控日志轮询调用该入口，完成 live 事件复测。
5. 如果要观测 `support@`、`postmaster@`、`abuse@` 的入站邮件，使用 Stalwart Webhooks / MTA Hooks 或桥接脚本调用 `/api/mail-inbound`；该入口只保存脱敏摘要，不解析正文、不自动生成工单。
6. 管理后台已能查看队列、suppression、delivery events、入站事件、发送预算高水位、环境变量硬闸门和运行期开关，并能手动处理到期 outbox、编辑预算配置和查看脱敏失败原因；Vercel Cron 每日触发一次 `/api/mail-outbox-worker`，但仍不会绕过 `MAIL_OUTBOX_WORKER_ENABLED`、演练模式、全局紧急停发或运行期紧急停发。后续补真实 Stalwart Webhook 小范围测试记录。
7. 先只对管理员账号或测试域名开启。
8. `MAIL_WORKER_DRY_RUN=false`，但 `ACCOUNT_RECOVERY_MAIL_OUTBOX_ENABLED=false`。
9. 手动投递测试通过后再开启小范围账号恢复邮件。
10. 最后再按事件类型开放注册确认、工单回复、开发者 API 审核通知。

## Cloudflare Email 是否能接入

可以，但边界如下：

| 功能 | 免费 / 额度 | 是否适合本项目 |
| --- | --- | --- |
| Email Routing / inbound routing | Workers Free 和 Workers Paid 都可用，inbound unlimited | 适合 `support@`、`postmaster@`、`abuse@` 转发到你的现有邮箱，也可接 Email Workers 做轻量入站处理 |
| Email Sending / outbound emails | Workers Free 不可用；Workers Paid 每月 3,000 封，之后 $0.35 / 1,000 封 | 可作为后续 provider adapter 或 fallback，不建议替代 Stalwart 主线 |
| 从 external servers 通过 REST API 发信 | Cloudflare 文档表示 Email Service 支持 | 技术上可接入当前 provider adapter，但仍要走 outbox、限流、suppression 和审计 |

推荐接入方式：

1. 先用 Cloudflare Email Routing 接收 `postmaster@`、`abuse@`、`support@`，转发到你的管理邮箱。
2. 若以后希望 Cloudflare 作为 fallback 发信，新建 `cloudflare-email` provider adapter。
3. 仍复用 `mail_outbox`、`mail_suppression`、预算桶、幂等 key 和 `mail_delivery_events`。
4. 不允许前端直接调用 Cloudflare Email API。

## 参考资料

- Stalwart system requirements: `https://stalw.art/docs/install/requirements/`
- Stalwart Docker install: `https://stalw.art/docs/install/platform/docker/`
- Stalwart listeners: `https://stalw.art/docs/server/listener/`
- Stalwart DKIM signing: `https://stalw.art/docs/mta/authentication/dkim/sign/`
- Stalwart DKIM key rotation and manual signature objects: `https://stalw.art/docs/domains/dkim-rotation/`
- Microsoft Exchange SCL thresholds: `https://learn.microsoft.com/en-us/exchange/antispam-and-antimalware/antispam-protection/scl`
- Microsoft Defender SCL overview: `https://learn.microsoft.com/en-us/defender-office-365/anti-spam-spam-confidence-level-scl-about`
- Postal prerequisites: `https://docs.postalserver.io/getting-started/prerequisites/`
- Postal feature list: `https://docs.postalserver.io/welcome/feature-list/`
- Cloudflare Email Routing: `https://developers.cloudflare.com/email-routing/`
- Cloudflare Email Service pricing: `https://developers.cloudflare.com/email-service/platform/pricing/`
