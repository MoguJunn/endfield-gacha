# 统计定时刷新运行说明

统计快照随 v4.6.2（PR #37）发布。新环境与计算版本升级必须先完成数据库迁移、启动 Worker 并预热快照，再切换读端。统计口径见 [STATS_OBSERVATION_CONTRACT.md](STATS_OBSERVATION_CONTRACT.md)。

## 推荐运行方式

使用独立 Docker Worker。`node scripts/build-statistics-worker.mjs` 生成 `.agent-tmp/statistics-worker.mjs`，部署为 `/opt/endfield-statistics/worker.mjs`；凭据保存在服务器 `/etc/endfield/statistics.env`，仅 root 可读，禁止加入构建文件或日志。与 Supabase 同机部署时可通过本机 Kong 接入数据库。

安装 `scripts/systemd/endfield-statistics-docker.service` 时命名为 `endfield-statistics.service`，沿用同目录 timer。镜像固定摘要，运行用户为容器内无权限用户，文件只读，1 CPU／1200MiB 总内存／768MiB 堆，不允许容器额外使用 Swap。串行处理、240 秒领取预算和5分钟任务租约保留。`STATISTICS_MAX_JOBS=500` 用于避免小型个人任务每分钟只处理8项造成积压，时间预算仍限制每轮耗时。

容器包升级在当前轮结束后替换，再启动下一轮；不要同时启动多个服务实例。用只含分类计数的 SQL 检查任务与快照，不打印 owner 身份、个人 payload 或服务密钥。失败时先保留上次快照并查看租约／失败计数，不能跳过发布修订校验。

同一 `pool_id` 下的官方 `pool_version` 独立计算首获与重复间隔；未知期次保留独立分组，不臆测为第一期。账号覆盖仍按真实账号去重，资源和保底继承沿用既有规则。

## 计算与读取

`statistics_jobs` 保存待计算范围、修订号、租约及下一次检查时间；`statistics_snapshots` 保存完成的结果；`statistics_activity` 只保存最近 65 分钟的上传／编辑／删除数量。三张表启用 RLS，浏览器角色不能读写，相关 RPC 仅服务端可用。

`history` 的语句级触发器按受影响卡池和站点账号增加修订号。一次千条上传只增加一次卡池修订号。卡池／对象目录和卡池对象关系改变时使已有结果失效；用户新增时建立空账号任务，删除时清理个人结果。

后台每分钟检查队列，依据实际上传时间决定重算间隔：

- 最近 10 分钟至少 5 位上传者，或至少 1,000 条新增／修改／删除：5 分钟。
- 不满足上项，但最近 60 分钟有变化：30 分钟。
- 最近 60 分钟无变化：60 分钟。

修改按一条变化计数，跨池移动同时使旧池、新池失效。无变化的卡池和账号只推进下一次检查时间，不扫描历史、不改写计算时间。全服概览的活跃人数有随时间到期的语义，仍定期计算。

现有上传完成回调 `refresh_public_analytics_cache()` 保留名称，但迁移后只标记旧统计待更新，返回 `queued: true`；原计算函数改名为仅供内部 Worker 调用的 `recompute_public_analytics_for_worker()`。因此无需修改并行导入任务的业务代码，上传完成也不会立即扫描全量历史。管理员经该入口申请刷新时同样进入队列。

PR #43 的 `2026100601_reuse_pool_counts_for_catalog_groups.sql` 已修正目录保存超时：角色／阵容变更仅递增 revision，卡池／可见性变更重计单池并复用同事务单池计数生成组合计数。它没有放宽 10 秒限制、修改函数 ACL 或跳过后台 payload 重算；不能为修复保存超时恢复旧的请求期全历史聚合。

新观测图按单池、五类合池和个人 owner 重算；旧全服概览、排名、图鉴及公开卡池趋势使用同一队列。个人结果包含分账号单池／合池、按范围的旧指标、排名和中英图鉴，图鉴的本地手动补充仍直接作用于展示。当前增量粒度为“受影响范围”，并不是把新增记录直接累加进频数；修改、删除及乱序补录需要重新检查该范围内的先后关系。

五类 `group:<key>` 使用共享白名单：限定角色、限定武器、常驻武器、重构寻访、重构申领。先逐账号逐期逐对象计算首次，再按当期身份汇总类别；账号覆盖跨期去重。历史变化根据旧／新行中的游戏账号找到关联池，使依赖保底继承或获得次序的池与合池同步失效。公共成员仅来自当前可见目录；旧 `metrics` / `resources` 按所选范围保存，资源与保底计算读取相关完整账号上下文，但不输出原始身份。记录按固定最大 ID 分段并使用主键翻页，最多八页并行，读取后校验完整计数；角色池读取其他角色池上下文，武器配额按单个结果且保底为单池，不读取无关武器期。

每次领取获得 5 分钟租约，读取历史请求最多 180 秒。发布时核对租约和修订号；期间发生数据变化则丢弃本次结果，约 1 分钟后重试。失败保留上次结果，按 5～60 分钟退避。旧统计的内部缓存写入与新快照发布在同一事务中，版本冲突会一起回滚。

一次个人快照内，观测统计按对象类型准备目录索引和账号／卡池时间线，各范围复用准备结果；旧指标只准备一次逐账号、逐池的可加计数与六星保底间隔。规范化历史逐账号复制和释放，准备完成后旧指标上下文仅保存聚合贡献。合池同样逐账号计算，首获／重复成本直接累计频数，不保留全部成本样本或跨账号的逐条去重字符串。缓存生命周期仅限本次任务，不跨用户或任务缓存历史。

页面获取结果不会触发计算。首次未完成返回 202 等待态；已有快照过期时继续返回上次结果及真实计算时间。界面显示“更新于”“自动刷新间隔”“下次检查”；后台无变化检查不会冒充新的计算。GET 也不会移动下一次检查时间。个人请求只使用认证结果中的用户 ID，忽略请求方提供的用户 ID。

## 新主机启用顺序

1. 按 [数据库指南](../supabase/README.md) 准备 schema。新环境 baseline 已包含两份统计迁移，不重复执行；已有环境升级时核对 `2026092201_schedule_statistics_snapshots.sql`、`2026092401_group_statistics_snapshots.sql` 及后续修复是否已应用。迁移新增表、触发器和函数，首次汇总计数会读取历史表；后续迁移登记五组并标记 v4 重算。
2. 优先使用上面的 Docker 运行方式；若主机已有 Node 22.17+，也可安装源码及生产依赖，按实际路径修改原生 `endfield-statistics.service`。Vercel 页面进程本身不负责定时运行。容量评估使用目标主机的实时指标，运行时监控内存、Swap、数据库与队列延迟。
3. 创建仅服务账号／管理员可读的 `/etc/endfield/statistics.env`，填入 `SUPABASE_URL` 和 `SUPABASE_SECRET_KEY`（或 `SUPABASE_SERVICE_ROLE_KEY`），同时设置 `NODE_ENV=production`。不要使用浏览器发布密钥，不要把文件加入仓库。
4. 安装仓库的 service／timer 到 `/etc/systemd/system/`，运行 `systemctl daemon-reload`、`systemctl enable --now endfield-statistics.timer`。此动作会开始真实后台计算；先确认没有已有实例，避免重复启动。
5. 用 `journalctl -u endfield-statistics.service` 查看结果。脚本默认每轮最多8项，生产 Docker 单元设置500项，均保留约4分钟领取预算；单次任务最多可令总时长超过预算一个任务，service 上限8分钟。首次会建立所有公开卡池及已有账号结果，需要等待队列处理。
6. 确认公开卡池、五类合池和旧统计已有 `public-statistics-v4` 快照，个人快照也已预热，再发布前端／API。服务端必须持有同一项目的服务密钥。

可在数据库管理会话只读检查，不输出账号标识：

```sql
SELECT CASE WHEN scope_key LIKE 'owner:%' THEN 'personal'
            WHEN scope_key LIKE 'pool:%' THEN 'pool' ELSE scope_key END AS kind,
       count(*) AS jobs,
       count(*) FILTER (WHERE computed_at IS NULL) AS initial_pending,
       count(*) FILTER (WHERE revision<>published_revision) AS changed,
       count(*) FILTER (WHERE failure_count>0) AS failed,
       min(computed_at) AS oldest_calculation
FROM public.statistics_jobs GROUP BY 1;
```

以后改变计算版本时，需要配套迁移将相关任务 `revision` 增加并令 `next_refresh_at=now()`，再预热后切换读端版本。不要仅修改 JS 版本常量，否则无变化范围不会重新计算。

暂停可停止 timer 和 service；已发布结果仍能读取。回退页面版本不需要删除快照或历史数据。若需完全撤销调度，应在单独迁移中恢复旧 `refresh_public_analytics_cache` 名称及服务端权限、移除本次具名触发器和函数；不能通过清空历史表处理。只停止 Worker 后上传仍会入队，不会重新启用即时计算。

## 本地真实数据预览

`scripts/prepare-statistics-local-preview.mjs` 仅从已有数据库读历史和旧缓存，计算后写入忽略提交的 `.agent-tmp/statistics-live/snapshots.json`。它不执行迁移、生产统计 RPC 或写入数据库。

在仓库根目录运行：

```powershell
node --max-old-space-size=1536 scripts/prepare-statistics-local-preview.mjs --all
$env:STATISTICS_LOCAL_SNAPSHOT_FILE = "$PWD/.agent-tmp/statistics-live/snapshots.json"
npm run dev -- --host 127.0.0.1 --port 5193 --strictPort
```

指定卡池 ID 可只准备该池和零记录池；`--groups` 独立计算五组，`--missing` 补齐缺失或旧版本快照。`--all` 在内存中复用一次完整读取，原始记录不写入文件。环境变量只在非生产且为公开统计时生效，个人数据仍走认证后的数据库快照。文件是静态计算预览，不能用于判断生产任务运行状态；UI 标记“本地计算预览”。Windows 文件锁导致替换失败时，脚本会重试，不发布不完整 JSON。

## 验证与容量评估

- `scripts/verify-statistics-schedule-sql.mjs` 在 PGlite 中执行迁移，覆盖批量增删改和移动、5/30/60 分钟调度、租约、修订冲突、旧缓存事务回滚、刷新时间、权限及删除清理。安装依赖：`npm install --prefix .agent-tmp --no-save --package-lock=false @electric-sql/pglite`。该测试使用最小表结构和函数桩，不能替代目标数据库的 Supabase 扩展集成验证。
- 页面验证应覆盖十图、目标选择、空池、旧指标与资源、双端布局，并确认读取不改变计算时间。个人接口还需验证未登录／跨用户拒绝、账号切换清空及分页完整性。
- 合成基准：`node --expose-gc --max-old-space-size=1536 scripts/benchmark-observation-statistics.mjs 240000 prepared`。模式另有 `group`、`repeated`、`legacy-single`、`legacy-repeated`、`legacy-prepared`；旧指标模式可在末尾指定参考模块路径。
- 算法等价核对：`node --max-old-space-size=1536 scripts/verify-statistics-optimization.mjs <reference-commit>`。脚本从 Git 读取参考算法，在同一批内存数据上比较，仅输出范围与汇总结果。`--verify-existing` 只适用于源数据未变化的旧快照。
- 容量参考：2026-09-24 的约 100 万有效结果、约 138 万相关上下文任务，独立进程峰值约 733MiB；连续五组合池峰值约 810MiB。全量预览曾达到约 1.34GiB RSS，因此堆上限之外仍须预留运行时和数据库响应空间。这些历史测量只用于确定评估规模，不是性能承诺，也不代表当前主机余量或队列已核验。

首次按本期已导入记录计数，缺失记录仍会使成本偏低；界面已说明。现阶段受影响的大卡池仍须完整读取，并发持续上传可能导致重试和结果延迟。5/30/60 分钟是任务检查／重算间隔，不能承诺任务排队、网络异常时严格按时完成。生产需要根据实际队列延迟和最大池耗时确认主机容量。
