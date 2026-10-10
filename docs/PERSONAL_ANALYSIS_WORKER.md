# 个人分析快照 Worker 调度

个人分析快照由 `/api/personal-analysis-worker` 异步生成。生产定时调度运行在
自建 Supabase PostgreSQL 的 `pg_cron + pg_net` 中，不使用 Vercel 高频 Cron，
也不依赖可能延迟数十分钟的 GitHub Scheduled Workflow。

个人 owner/account 分析 Worker 与 v4 公共／个人统计的独立 Docker Worker 是不同链路，后者见 [STATISTICS_SCHEDULING.md](STATISTICS_SCHEDULING.md)。发布涉及分析能力时，须核对本 Worker 的不可变部署地址，并重建受影响快照；主站部署成功不能代替该核验。

## 当前快照合同

v4.6.4 使用个人分析 schema 3；模拟器继承合同为 2，完整历史编码为 1，本地会话版本为 2。Worker 使用完整可见卡池目录及当前用户个人池生成投影，零抽目标池也参与共享水位和情报书目标装配。

`mode=analysis` 保留个人总览与选中视图，不附带完整继承历史；`mode=simulator-inheritance&accountKey=…` 是独立鉴权读取，只有 owner/account 来源、版本和修订匹配才返回 `ready`。构建中响应不覆盖本地存档，GET 不扫描原始历史。完整历史与本地资源、存储规则见 [模拟器合同](SIMULATOR_ENGINE.md)。

`2026100901_simulator_inheritance_v2.sql` 已在既有自托管环境应用并完成存量重建，保留旧快照、ACL 和活动租约。不要重复执行这份递增修订的失效迁移；其他环境按实际 schema 和执行记录升级，详见 [数据库指南](../supabase/README.md)。

## 调度方式

- migrations：178 建立定时调度，179/180 增加节流与优先级感知即时派发
- 默认频率：每分钟
- 地址必须是包含 Worker 的不可变 Vercel Deployment URL
- 活跃用户成功入队时立即请求一次 Worker，全局至少间隔 5 秒；每分钟 cron 继续兜底
- 每个 HTTP 请求在 45 秒预算内顺序处理最多 4 个用户批次
- 数据库 lease 与 revision 合同负责并发安全
- GitHub Actions 只保留 `workflow_dispatch` 手动应急入口，不再配置 schedule

`pg_net` 是异步 HTTP 队列。cron 成功表示派发 RPC 已运行；实际请求是否入队以及
HTTP 状态还需通过 `personal_analysis_worker_dispatches` 与 `net._http_response` 联合检查。
已启用空队列优化的环境没有可领取任务时不会发送 HTTP。

前端冷启动按 3、5、10、20、30 秒递增检查快照；`building-poll` 只读取分析状态，
复用已有公共卡池，不重复请求公共目录。组件或路由重挂载会沿用全局 Store 中的
`nextRetryAt`，同 owner 的被动认证事件也不会打断 building 状态。

## 必需配置

### Vercel Production

```text
PERSONAL_ANALYSIS_WORKER_ENABLED=true
PERSONAL_ANALYSIS_WORKER_SECRET=<随机高强度密钥>
PERSONAL_ANALYSIS_WORKER_BACKFILL_ENABLED=false
```

`SUPABASE_SECRET_KEY`（或兼容的 service role key）也必须可用。
每批领取一个用户及该用户最多 20 个 scope；Worker 只构建一次该用户模型，再发布
owner 和 scope。单次受保护 HTTP 调用最多顺序运行 4 批，并在 45 秒预算到达后停止。

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
SELECT public.request_personal_analysis_worker_dispatch(NULL, 5);
```

自建数据库必须已经预加载并提供 `pg_cron`、`pg_net` 与 `supabase_vault`。
`cron.database_name` 和 `pg_net.database_name` 必须指向实际业务数据库；使用默认
数据库 `postgres` 时，两项均设置为 `postgres`。

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

-- command 应为：
-- SELECT public.request_personal_analysis_worker_dispatch(NULL, 5);

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

SELECT 'owner' AS kind, analysis_schema_version,
       count(*) AS rows,
       count(*) FILTER (WHERE snapshot_revision < history_revision) AS pending,
       count(*) FILTER (WHERE lease_expires_at > now()) AS leased,
       count(*) FILTER (WHERE last_error IS NOT NULL) AS failed
FROM public.personal_analysis_owner_state GROUP BY analysis_schema_version
UNION ALL
SELECT 'scope', analysis_schema_version, count(*),
       count(*) FILTER (WHERE snapshot_revision < history_revision),
       count(*) FILTER (WHERE lease_expires_at > now()),
       count(*) FILTER (WHERE last_error IS NOT NULL)
FROM public.personal_analysis_scope_state GROUP BY analysis_schema_version;
```

HTTP 200 仍需检查响应中的 `result.stats`：`succeeded` 表示成功发布，`stale` 表示租约、修订或 schema 不匹配而拒绝发布。任务持续返回 `stale` 时，优先核对 Vault 中 URL 对应的代码版本；不能通过跳过修订校验解决。

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

## 发布与诊断注意事项

- v4.6.4（PR #44）已于 2026-10-09 发布。生产调度已切换到该版本的不可变 Vercel 部署，实际调用发布 2 项任务，陈旧结果／失败／待处理均为 0；这是发布时证据，后续状态仍按上面 SQL 检查。
- 后续发布依赖 Worker 新算法或 schema 时，先备份原 Vault URL，确认新部署就绪及相同鉴权变量，再仅更新 `personal_analysis_worker_url`。网站域名指向新版本不会替换此固定地址；GitHub 应急入口的 `PERSONAL_ANALYSIS_WORKER_URL` 也需独立核对。
- 切换后通过现有受限派发 RPC 验证 HTTP 响应和真实发布。队列为空时 `request_personal_analysis_worker_dispatch()` 可返回 `no_claimable_job` 而不发 HTTP，这是已部署的空队列优化；不要仅为连通检查重新失效全部快照。
- PR #24 引入即时派发、轻量轮询和多批 Worker；PR #25 修复包含 `:` 的附加寻访 `viewKey` 查询。验证 `viewKey=__group_extra:reconstruction` 时，无该分组记录的账号可以正常返回空视图；有记录时只投影目标 view / locale。
- PR #39 修复旧固定部署漏读重构规则的问题。升级后核对 `poolManifest.extra_rule_profile` 与时间线 `stageKind`，再确认受影响快照已按新代码生成。
- 源码 migration 181–183 是编号冲突后的前向文件名。既有环境应核对最终字段、约束、触发器、受限 RPC、种子卡池与版本绑定，再判断缺失迁移；不能仅按文件编号重复执行已生效内容。
- 历史发布或测试结果不代表当前生产队列状态。每次部署均按上面的调度状态检查确认派发、HTTP 响应与快照发布。
