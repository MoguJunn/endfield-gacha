# 个人分析快照 Worker 调度

个人分析快照由 `/api/personal-analysis-worker` 异步生成。生产环境使用
GitHub Actions Scheduled Workflow 调度，不使用 Vercel 高频 Cron，避免 Hobby
套餐因 `* * * * *` 每分钟任务拒绝整个部署。

## 调度方式

- Workflow：`.github/workflows/personal-analysis-worker.yml`
- 默认频率：每 5 分钟
- 地址必须是包含 Worker 的不可变 Vercel Deployment URL
- 支持在 Actions 页面通过 `workflow_dispatch` 手动执行
- 同一时间最多执行一个任务，后续触发会等待前一次完成
- 单批调用失败会重试 3 次，并校验 HTTP 与 Worker JSON 状态
- 每次 Workflow 默认连续处理 4 个用户批次，队列为空时提前结束

GitHub 的 Scheduled Workflow 只从默认分支读取。Workflow 合并到 `main` 后才会
开始定时执行；GitHub 在高负载时可能延迟计划任务。

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
每 5 分钟重复扫描全量历史。新写入会由数据库触发器自动创建或标脏队列状态。
历史数据的一次性全量回填应在维护窗口临时开启该变量，完成后立即关闭。

### GitHub Repository Actions Secret / Variable

在仓库 `Settings → Secrets and variables → Actions` 中添加：

```text
PERSONAL_ANALYSIS_WORKER_SECRET=<与 Vercel 完全相同的值>
```

必需 Repository Variable：

```text
PERSONAL_ANALYSIS_WORKER_URL=https://具体部署ID.vercel.app/api/personal-analysis-worker
```

不要使用正式前台域名。前台被 promote/rollback 到旧部署时，正式域名可能没有
Worker 路由，导致计划任务持续 404；不可变 Deployment URL 不会随前台回滚移动。

可选配置：

```text
PERSONAL_ANALYSIS_WORKER_MAX_BATCHES=4
VERCEL_AUTOMATION_BYPASS_SECRET=<Deployment Protection bypass secret>
```

如果该 Deployment 启用了 Vercel Protection，必须把 bypass secret 同时配置为
GitHub Actions Secret；Workflow 会通过 `x-vercel-protection-bypass` 请求头发送。

## 活跃用户优先级

Migration 177 增加 `priority_requested_at`。分析 API 发现当前用户的 owner/account
快照缺失或过期时，只能通过 service role RPC 将该用户加入活跃优先队列；浏览器
无法直接指定其他用户。优先级使用首次排队时间，重复轮询不会刷新时间或绕过失败
退避，因此不会由高频请求长期霸占 Worker。

## 验证

1. 部署包含 Worker 环境变量的新 Production。
2. 在 GitHub Actions 中手动运行 `Personal Analysis Worker`。
3. Workflow 输出应包含受控统计，例如 `claimedOwner`、`claimedScope`、
   `succeeded`、`failed`，但不会输出用户 ID 或 Secret。
4. 检查 `personal_analysis_snapshots` 开始生成，队列 lease 与 attempt 发生变化。

如果 Worker 未启用、Secret 不匹配、返回 partial 或 skipped，Workflow 会失败，
不会把降级响应误判为成功。
