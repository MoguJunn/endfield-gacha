# 个人分析快照 Worker 调度

个人分析快照由 `/api/personal-analysis-worker` 异步生成。生产环境使用
GitHub Actions Scheduled Workflow 调度，不使用 Vercel 高频 Cron，避免 Hobby
套餐因 `* * * * *` 每分钟任务拒绝整个部署。

## 调度方式

- Workflow：`.github/workflows/personal-analysis-worker.yml`
- 默认频率：每 5 分钟
- 默认地址：`https://ef-gacha.mogujun.icu/api/personal-analysis-worker`
- 支持在 Actions 页面通过 `workflow_dispatch` 手动执行
- 同一时间最多执行一个任务，后续触发会等待前一次完成
- 单次调用失败会重试 3 次，并校验 HTTP 与 Worker JSON 状态

GitHub 的 Scheduled Workflow 只从默认分支读取。Workflow 合并到 `main` 后才会
开始定时执行；GitHub 在高负载时可能延迟计划任务。

## 必需配置

### Vercel Production

```text
PERSONAL_ANALYSIS_WORKER_ENABLED=true
PERSONAL_ANALYSIS_WORKER_SECRET=<随机高强度密钥>
```

`SUPABASE_SECRET_KEY`（或兼容的 service role key）也必须可用。单次任务默认只
领取一个队列作业，以避免超过 Vercel 函数执行时限。

### GitHub Repository Actions Secret

在仓库 `Settings → Secrets and variables → Actions` 中添加：

```text
PERSONAL_ANALYSIS_WORKER_SECRET=<与 Vercel 完全相同的值>
```

可选 Repository Variable：

```text
PERSONAL_ANALYSIS_WORKER_URL=https://你的生产域名/api/personal-analysis-worker
```

未设置 URL Variable 时使用主站默认地址。

## 验证

1. 部署包含 Worker 环境变量的新 Production。
2. 在 GitHub Actions 中手动运行 `Personal Analysis Worker`。
3. Workflow 输出应包含受控统计，例如 `claimedOwner`、`claimedScope`、
   `succeeded`、`failed`，但不会输出用户 ID 或 Secret。
4. 检查 `personal_analysis_snapshots` 开始生成，队列 lease 与 attempt 发生变化。

如果 Worker 未启用、Secret 不匹配、返回 partial 或 skipped，Workflow 会失败，
不会把降级响应误判为成功。
