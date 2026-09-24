# 统计定时刷新运行说明

本轮统计实现来自 `feat/banner-stats-and-guide`，当前整理为 `v4.6.2` 候选。数据库迁移、后台脚本、systemd 配置和本地验证已准备；生产统计迁移及 Worker 尚未执行（2026-09-24 SSH 只读核对：生产库没有 `statistics_jobs` / `statistics_snapshots`，也没有 Worker 服务，现站仍为 `v4.6.0`）。公开单池、五类合池、旧统计和个人范围须先完成 `public-statistics-v4` 快照预热，再启用前端／API；发布证据见 [RELEASE_4.6.2.md](RELEASE_4.6.2.md)。

## 计算与读取

`statistics_jobs` 保存待计算范围、修订号、租约及下一次检查时间；`statistics_snapshots` 保存完成的结果；`statistics_activity` 只保存最近 65 分钟的上传／编辑／删除数量。三张表启用 RLS，浏览器角色不能读写，相关 RPC 仅服务端可用。

`history` 的语句级触发器按受影响卡池和站点账号增加修订号。一次千条上传只增加一次卡池修订号。卡池／对象目录和卡池对象关系改变时使已有结果失效；用户新增时建立空账号任务，删除时清理个人结果。

后台每分钟检查队列，依据实际上传时间决定重算间隔：

- 最近 10 分钟至少 5 位上传者，或至少 1,000 条新增／修改／删除：5 分钟。
- 不满足上项，但最近 60 分钟有变化：30 分钟。
- 最近 60 分钟无变化：60 分钟。

修改按一条变化计数，跨池移动同时使旧池、新池失效。无变化的卡池和账号只推进下一次检查时间，不扫描历史、不改写计算时间。全服概览的活跃人数有随时间到期的语义，仍定期计算。

现有上传完成回调 `refresh_public_analytics_cache()` 保留名称，但迁移后只标记旧统计待更新，返回 `queued: true`；原计算函数改名为仅供内部 Worker 调用的 `recompute_public_analytics_for_worker()`。因此无需修改并行导入任务的业务代码，上传完成也不会立即扫描全量历史。管理员经该入口申请刷新时同样进入队列。

新观测图按单池、五类合池和个人 owner 重算；旧全服概览、排名、图鉴及公开卡池趋势使用同一队列。个人结果包含分账号单池／合池、按范围的旧指标、排名和中英图鉴，图鉴的本地手动补充仍直接作用于展示。当前增量粒度为“受影响范围”，并不是把新增记录直接累加进频数；修改、删除及乱序补录需要重新检查该范围内的先后关系。

五类 `group:<key>` 使用共享白名单：限定角色、限定武器、常驻武器、重构寻访、重构申领。先逐账号逐期逐对象计算首次，再按当期身份汇总类别；账号覆盖跨期去重。历史变化根据旧／新行中的游戏账号找到关联池，使依赖保底继承或获得次序的池与合池同步失效。公共成员仅来自当前可见目录；旧 `metrics` / `resources` 按所选范围保存，资源与保底计算读取相关完整账号上下文，但不输出原始身份。记录按固定最大 ID 分段并使用主键翻页，最多八页并行，读取后校验完整计数；角色池读取其他角色池上下文，武器配额按单个结果且保底为单池，不读取无关武器期。

每次领取获得 5 分钟租约，读取历史请求最多 180 秒。发布时核对租约和修订号；期间发生数据变化则丢弃本次结果，约 1 分钟后重试。失败保留上次结果，按 5～60 分钟退避。旧统计的内部缓存写入与新快照发布在同一事务中，版本冲突会一起回滚。

一次个人快照内，观测统计按对象类型准备目录索引和账号／卡池时间线，各范围复用准备结果；旧指标只准备一次逐账号、逐池的可加计数与六星保底间隔。规范化历史逐账号复制和释放，准备完成后旧指标上下文仅保存聚合贡献。合池同样逐账号计算，首获／重复成本直接累计频数，不保留全部成本样本或跨账号的逐条去重字符串。缓存生命周期仅限本次任务，不跨用户或任务缓存历史。

页面获取结果不会触发计算。首次未完成返回 202 等待态；已有快照过期时继续返回上次结果及真实计算时间。界面显示“更新于”“自动刷新间隔”“下次检查”；后台无变化检查不会冒充新的计算。GET 也不会移动下一次检查时间。个人请求只使用认证结果中的用户 ID，忽略请求方提供的用户 ID。

## 生产启用顺序

1. 在目标数据库依次执行 `supabase/migrations/2026092201_schedule_statistics_snapshots.sql`、`2026092401_group_statistics_snapshots.sql`。它们新增表、触发器与函数，不修改原历史记录；首次汇总计数会读取历史表。后续迁移登记五组并将既有范围标为需要按 v4 重算。
2. 在有 Node 22.17+ 的常驻 Linux 主机放置本版本和生产依赖，默认目录 `/opt/endfield-gacha`、运行账号 `endfield`。按实际路径修改 `scripts/systemd/endfield-statistics.service`。Vercel 页面进程本身不负责定时运行。2026-09-24 只读核对：主库主机约 6GB 内存、可用 1665MiB，swap 已用 3272/4095；另一台可达主机 2GB／可用 418MiB，第三台连接超时。优化前本地全量批量预览约 1.34 GiB；优化后同一进程连续五组合池的峰值为 810 MiB（不同工作负载，不能直接计算降幅）。内存压力已有改善，但本地测量不代表数据库共机运行余量，启用前仍需确认实时内存、swap 和数据库负载。
3. 创建仅服务账号／管理员可读的 `/etc/endfield/statistics.env`，填入 `SUPABASE_URL` 和 `SUPABASE_SECRET_KEY`（或 `SUPABASE_SERVICE_ROLE_KEY`），同时设置 `NODE_ENV=production`。不要使用浏览器发布密钥，不要把文件加入仓库。
4. 安装仓库的 service／timer 到 `/etc/systemd/system/`，运行 `systemctl daemon-reload`、`systemctl enable --now endfield-statistics.timer`。此动作会开始真实后台计算；当前会话未执行。
5. 用 `journalctl -u endfield-statistics.service` 查看结果。每轮最多 8 项任务、约 4 分钟预算；单次任务最多可令总时长超过预算一个任务，service 的上限为 8 分钟。首次会建立所有公开卡池及已有账号结果，需要等待队列处理。
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

在此 worktree 中运行：

```powershell
node --max-old-space-size=1536 scripts/prepare-statistics-local-preview.mjs --all
$env:STATISTICS_LOCAL_SNAPSHOT_FILE = "$PWD/.agent-tmp/statistics-live/snapshots.json"
npm run dev -- --host 127.0.0.1 --port 5193 --strictPort
```

指定卡池 ID 可只准备该池和零记录池；`--groups` 独立实测五组，`--missing` 补齐缺失或旧版本快照。`--all` 在内存中复用一次完整读取，原始记录不写入文件。环境变量只在非生产且为公开统计时生效，个人数据仍走认证后的数据库快照。本地文件包含 34 个公开卡池、五类合池与 3 份旧统计缓存。它是静态计算预览，**不是正在运行的生产定时任务**；UI 明确标记“本地计算预览”。

## 验证与边界

- 真实浏览器验证十图、头像选择与排序、全部卡池抽数、读取不改计算时间、搜索／切池／空池／理论／旧指标及资源，以及合池 360～1920 宽度、中英亮暗、减少动态效果和手机路由；桌面统一首页宽度另覆盖 1366～3840。
- 单元测试验证本期首获与重复、目录精确匹配、未知对象间隔、未登录／跨用户拒绝、账号切换清空、完整分页、Worker 成功／失败及旧统计进入同一队列。
- `scripts/verify-statistics-schedule-sql.mjs` 在 PGlite 的 PostgreSQL 引擎中执行迁移，验证批量触发器、增删改和移动、5/30/60 分钟、租约、修订冲突、旧缓存事务回滚、稳定刷新时间、权限及删除清理。安装验证依赖：`npm install --prefix .agent-tmp --no-save --package-lock=false @electric-sql/pglite`。该测试使用最小表结构和旧统计函数桩，不代表生产全量数据或 Supabase 扩展集成已验收。
- 最终全量单元测试 269 个文件、1,495 项通过；完整 ESLint、主应用与抽奖子应用构建、PGlite 调度 SQL 行为和覆盖 186 个迁移的 baseline 验证通过。生产依赖改用官方 registry 执行 `npm audit --omit=dev --audit-level=high`，结果为 0 漏洞（内部镜像不支持 audit）。实现阶段早期另有 269 文件／1,492 项与 53 项相关调整测试通过。未借用用户登录会话执行私人数据测试，未启动生产 Worker。
- 最大限定角色范围实测：1,009,281 个有效结果、2,675 个去重账号，读取 1,376,059 条相关上下文，独立任务约 70 秒，匿名响应约 96.5 KB。限定武器约 25 秒、常驻武器约 9 秒，两个未开始的重构组合约 1～2 秒。测量包含数据库网络读取；本地复用已读历史后的纯计算分别约 8.3／3.6／0.7 秒。
- 批量预览在 1,536 MiB V8 堆限制下约 134 秒完成 34 单池＋5 合池＋3 旧缓存；进程 RSS 峰值约 1.34 GiB。服务配置同步限制堆，生产主机还需为运行时及数据库响应保留余量。Windows 预览读取可能短暂占用目标文件，写入脚本仅对此已复现的文件锁重试替换，不发布半截 JSON。

### 算法优化复核（2026-09-24）

- 最终回归 269 个测试文件／1,498 项通过；本轮改动 ESLint、主应用生产构建与 `git diff --check` 通过。新增测试覆盖复用结果独立性、跨池去重优先级、账号名称隔离，以及只有无效记录的账号仍须保留排除计数。
- 固定 24 万条合成记录、12 池、聚合及五个账号共 72 个范围，在独立 Node 进程内比较；峰值使用 `process.resourceUsage().maxRSS`，包含输入数据与运行时。观测统计由 9,020ms／491MiB 降至 521ms／290MiB；旧指标由 7,816ms／471MiB 降至 469ms／184MiB。所有范围的完整序列化结果摘要一致。时间会受系统负载影响，不代表网络接口提速比例。
- 同一批 1,985,909 条真实记录，新算法与优化前提交 `71fed8998cac86c9b155cc0976bd77c660477ae9` 对照，34 单池＋5 合池的观测、旧指标、成员及成员签名逐字段一致。原始记录仅在内存，不写入文件。较早静态快照已有新增数据，不能用其差异判断算法变化。
- 新算法独立真实任务：限定角色 1,009,973 个有效结果／2,676 账号，相关上下文 1,376,844 条，数据库读取约 57.3 秒、任务约 62.2 秒、进程峰值 733MiB；限定武器约 22.5 秒，常驻武器约 8.2 秒。连续五组合池的进程总峰值 810MiB，未人为触发垃圾回收。生产仍按既有串行任务和堆上限运行，未启用生产任务或修改数据库。
- 复现合成基准：`node --expose-gc --max-old-space-size=1536 scripts/benchmark-observation-statistics.mjs 240000 prepared`，模式另有 `group`、`repeated`、`legacy-single`、`legacy-repeated`、`legacy-prepared`。旧指标模式可在末尾指定参考模块路径。
- 复现真实等价核对：`node --max-old-space-size=1536 scripts/verify-statistics-optimization.mjs 71fed8998cac86c9b155cc0976bd77c660477ae9`；从 Git 读取旧算法，在同一批内存数据上比较，仅输出范围与汇总结果。独立真实占用用预览脚本 `--groups` 测量，日志包含进程累计峰值。`--verify-existing` 只适用于源数据未变化的旧快照比较。

首次按本期已导入记录计数，缺失记录仍会使成本偏低；界面已说明。现阶段受影响的大卡池仍须完整读取，并发持续上传可能导致重试和结果延迟。5/30/60 分钟是任务检查／重算间隔，不能承诺任务排队、网络异常时严格按时完成。生产需要根据实际队列延迟和最大池耗时确认主机容量。
