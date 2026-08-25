# 个人分析快照 Worker 调度

个人分析快照由 `/api/personal-analysis-worker` 异步生成。生产定时调度运行在
自建 Supabase PostgreSQL 的 `pg_cron + pg_net` 中，不使用 Vercel 高频 Cron，
也不依赖可能延迟数十分钟的 GitHub Scheduled Workflow。

## 调度方式

- migration：`178_schedule_personal_analysis_worker_with_pg_cron.sql`
- 默认频率：每分钟
- 地址必须是包含 Worker 的不可变 Vercel Deployment URL
- 每次只触发一个 Worker 调用；数据库 lease 与 revision 合同负责并发安全
- GitHub Actions 只保留 `workflow_dispatch` 手动应急入口，不再配置 schedule

`pg_net` 是异步 HTTP 队列。cron 成功表示请求已进入 `pg_net`，HTTP 状态还需通过
`personal_analysis_worker_dispatches` 与 `net._http_response` 联合检查。

## 必需配置

### Vercel Production

```text
PERSONAL_ANALYSIS_WORKER_ENABLED=true
PERSONAL_ANALYSIS_WORKER_SECRET=<随机高强度密钥>
PERSONAL_ANALYSIS_WORKER_BACKFILL_ENABLED=false
```

`SUPABASE_SECRET_KEY`（或兼容的 service role key）也必须可用。单次任务默认只
领取一个用户及该用户最多 20 个 scope；Worker 只构建一次该用户模型，再发布
owner 和 scope，以避免重复读取历史并控制 Vercel 函数时限。

常规计划任务必须保持 `PERSONAL_ANALYSIS_WORKER_BACKFILL_ENABLED=false`，避免
每分钟重复扫描全量历史。新写入会由数据库触发器自动创建或标脏队列状态。
历史数据的一次性全量回填应在维护窗口临时开启该变量，完成后立即关闭。

### Supabase Vault

迁移 178 执行前，通过受控运维渠道写入以下 Vault Secret：

```text
personal_analysis_worker_url=https://具体部署ID.vercel.app/api/personal-analysis-worker
personal_analysis_worker_secret=<与 Vercel 完全相同的 Worker Secret>
personal_analysis_worker_vercel_bypass_secret=<Deployment Protection bypass secret，可选>
```

不要把任何 Secret 直接写进 `cron.job.command`。migration 创建的 cron 命令只包含：

```sql
SELECT public.dispatch_personal_analysis_worker();
```

自建数据库必须已经预加载并提供 `pg_cron`、`pg_net` 与 `supabase_vault`。生产当前
使用数据库 `postgres`，`cron.database_name` 和 `pg_net.database_name` 也必须指向
该数据库。

### GitHub 手动应急入口

`.github/workflows/personal-analysis-worker.yml` 不再包含定时触发，只保留
`workflow_dispatch`。以下 GitHub Secret / Variable 继续用于人工应急运行：

```text
PERSONAL_ANALYSIS_WORKER_SECRET
VERCEL_AUTOMATION_BYPASS_SECRET
PERSONAL_ANALYSIS_WORKER_URL
PERSONAL_ANALYSIS_WORKER_MAX_BATCHES=4
```

## 调度状态检查

```sql
SELECT jobid, jobname, schedule, command, active
FROM cron.job
WHERE jobname = 'personal-analysis-worker';

SELECT
  dispatch.request_id,
  dispatch.dispatched_at,
  response.status_code,
  response.timed_out,
  response.error_msg
FROM public.personal_analysis_worker_dispatches AS dispatch
LEFT JOIN net._http_response AS response
  ON response.id = dispatch.request_id
ORDER BY dispatch.dispatched_at DESC
LIMIT 20;
```

## 活跃用户优先级

Migration 177 增加 `priority_requested_at`。分析 API 发现当前用户的 owner/account
快照缺失或过期时，只能通过 service role RPC 将该用户加入活跃优先队列；浏览器
无法直接指定其他用户。优先级使用首次排队时间，重复轮询不会刷新时间或绕过失败
退避，因此不会由高频请求长期霸占 Worker。

## 验证

1. 确认 Vault 三项配置存在，但不要读取或打印解密值。
2. 确认 cron job 为 active，且 schedule 是 `* * * * *`。
3. 等待至少两个周期，检查 dispatch request 与 HTTP 2xx 响应。
4. 检查 `personal_analysis_snapshots` 持续生成，活跃用户 priority 被优先消费。
5. 在 GitHub Actions 中手动运行一次作为独立应急链路验证。

如果 Vault、pg_cron 或 pg_net 不可用，不能把用户请求伪装成“正在排队”。分析 API
会返回明确的 `personal_analysis_queue_unavailable` 503，页面保留可诊断的错误状态。
