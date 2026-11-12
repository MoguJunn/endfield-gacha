# 个人分析快照 Worker 调度

个人分析快照由独立 Worker 异步生成；`/api/personal-analysis-worker` 是受保护的 HTTP 入口。
当前自托管生产使用既有服务器定时器运行 schema 6 算法，历史 `pg_cron + pg_net`
派发保留但不重复接管。新环境按实际部署选择同机或 HTTP 调度，不使用 Vercel 高频 Cron。

个人 owner/account 分析 Worker 与公共／个人统计的独立 Docker Worker 是不同链路，后者见 [STATISTICS_SCHEDULING.md](STATISTICS_SCHEDULING.md)。发布涉及分析能力时，须核对实际执行的源码／镜像或 HTTP 不可变部署地址，并重建受影响快照；主站部署成功不能代替该核验。

## 当前快照合同

当前目标为 **schema 6**，由 `2026103100_personal_win_rate_guarantee.sql` 升级；手气字段补算、快照修订和 Worker 交付见 [v4.7.0](RELEASE_4.7.0.md)。11 月 7 日核验继续沿用服务器定时器，没有改回旧 HTTP 分发，见 [生产检查](PRODUCTION_MIGRATIONS_20261107.md)。不能将历史 schema 3／5 Worker 用于现行读端。

10 月 14 日曾从 schema 3 升级到 5，并用同机 `endfield-personal-analysis-upgrade.timer` 接管；原派发入口返回 `reason=server_timer`，Vault 中 URL 和密钥保留。这个配置来源及串行锁见 [当时迁移记录](PRODUCTION_WORKBENCH_MIGRATIONS_20261014.md)。恢复远程派发前必须发布当前 schema 6 Worker、恢复受控派发并验证真实发布，再处理同机 timer，不能同时运行两套无协调调度。

v4.6.4 使用个人分析 schema 3；模拟器继承合同为 2，完整历史编码为 1，本地会话版本为 2。Worker 使用完整可见卡池目录及当前用户个人池生成投影，零抽目标池也参与共享水位和情报书目标装配。

`mode=analysis` 保留个人总览与选中视图，不附带完整继承历史；`mode=simulator-inheritance&accountKey=…` 是独立鉴权读取，只有 owner/account 来源、版本和修订匹配才返回 `ready`。构建中响应不覆盖本地存档，GET 不扫描原始历史。完整历史与本地资源、存储规则见 [模拟器合同](SIMULATOR_ENGINE.md)。

`2026100901_simulator_inheritance_v2.sql` 已在既有自托管环境应用并完成存量重建，保留旧快照、ACL 和活动租约。不要重复执行这份递增修订的失效迁移；其他环境按实际 schema 和执行记录升级，详见 [数据库指南](../supabase/README.md)。

## 文件导入后的数量核对

2026-10-17 的文件导入修复先核对服务器完整明细，每批保存确认后才更新进度，全部写入完成后请求个人快照刷新。文件预览的识别条数、本机可能为空的 `history`、账号清单 `recordCount` 及所选视图的抽数不是同一个完成信号。

若总览仍显示较少记录，先核对相同 UID／区服的真实已保存数量与文件保存回执，再检查 owner/scope 修订、`availability` 和计算时间。只保存文件前几批时，Worker 正确计算部分已存记录也无法补齐缺少的明细；已存完整而修订滞后时才沿本指南检查队列。保存后读取旧快照不能被当作整份文件丢失，也不应据此清空账号重新上传。

客户端恢复与格式边界见 [文件导入恢复](FILE_IMPORT_RELIABILITY.md)；个人补录是否影响已知量见 [个人补录分析](PERSONAL_MANUAL_ANALYSIS.md)。10 月 17 日文件修复当时沿用 schema 5，没有新增迁移；当前扫码／Token 导入完成后同样应核对服务端保存与 schema 6 快照更新，见 [官方导入](OFFICIAL_IMPORT.md)。

## 原发布调度方式

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

现行前端通过轻量快照版本清单检查已知待处理任务，间隔 3／10／30／90／180 秒，
最多 5 次、完成即停止，隐藏页面不主动发起；版本变化后才按需读取分析结果。
多个面板共享请求，公开统计排队不启动个人完成轮询；恢复联网、回到窗口或手动检查可继续确认。
这与早期持续重拉完整分析的 building-poll 不同，细节见 [浏览器数据复用](STATISTICS_SCHEDULING.md#浏览器数据复用)。

## 必需配置

本节的 Vercel／Vault 配置用于 HTTP 调度环境。当前同机生产应保留现有进程环境、锁与定时器，先核对实际 schema 6 任务发布，不因下文历史配置而覆盖运行方式。

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

1. 核对目标环境实际使用的同机或 HTTP 调度，确认执行代码为 schema 6。
2. 同机方式检查既有 timer、串行锁、领取及发布日志；HTTP 方式检查 Vault 配置、active cron、dispatch 与响应，不打印解密值。
3. 等待正常周期，检查 `personal_analysis_snapshots` 的修订、错误和实际发布，确认活跃用户优先消费。
4. HTTP 200 只表示接口成功响应；还需检查成功发布数和 stale，队列为空无需为测试而全量失效。
5. GitHub 手动应急入口仅在 URL／版本已核对且需要时执行，避免重复接管常规计算。

实际队列不可用时，分析 API 返回 `personal_analysis_queue_unavailable` 503，
页面保留可诊断状态，不伪装为已入队。HTTP 调度另需检查 Vault、pg_cron 和 pg_net；
同机调度不能只凭旧 HTTP 入口未派发就判定失败。

## 发布与诊断注意事项

- v4.6.4（PR #44）已于 2026-10-09 发布。生产调度已切换到该版本的不可变 Vercel 部署，实际调用发布 2 项任务，陈旧结果／失败／待处理均为 0；这是发布时证据，后续状态仍按上面 SQL 检查。
- 后续发布依赖 Worker 新算法或 schema 时，先核对实际调度；同机方式更新匹配的 Worker 并检查真实发布，HTTP 方式先备份 Vault URL，再切换到已就绪的新部署。网站域名更新不会替换该固定地址；GitHub 应急入口的 `PERSONAL_ANALYSIS_WORKER_URL` 也需独立核对。
- 切换后通过现有受限派发 RPC 验证 HTTP 响应和真实发布。队列为空时 `request_personal_analysis_worker_dispatch()` 可返回 `no_claimable_job` 而不发 HTTP，这是已部署的空队列优化；不要仅为连通检查重新失效全部快照。
- PR #24 引入即时派发、轻量轮询和多批 Worker；PR #25 修复包含 `:` 的附加寻访 `viewKey` 查询。验证 `viewKey=__group_extra:reconstruction` 时，无该分组记录的账号可以正常返回空视图；有记录时只投影目标 view / locale。
- PR #39 修复旧固定部署漏读重构规则的问题。升级后核对 `poolManifest.extra_rule_profile` 与时间线 `stageKind`，再确认受影响快照已按新代码生成。
- 源码 migration 181–183 是编号冲突后的前向文件名。既有环境应核对最终字段、约束、触发器、受限 RPC、种子卡池与版本绑定，再判断缺失迁移；不能仅按文件编号重复执行已生效内容。
- 历史发布或测试结果不代表当前生产队列状态。每次部署均按上面的调度状态检查确认派发、HTTP 响应与快照发布。
