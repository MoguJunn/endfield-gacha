# 2026-10-14 生产工作台与统计迁移记录

维护者明确授权执行迁移并检查生产数据库。目标为现有自托管 Supabase 的 `supabase-db` / `postgres`，PostgreSQL 15.8；通过数据库内部的 `supabase_admin` 管理角色执行。没有提交、推送代码或发布网站。

## 备份与执行

- 完整迁移前备份位于服务器 `/root/endfield-migration-20261014/database-before.dump`，约 447MB，`pg_restore --list` 验证可读。SHA-256：`d951c4b9eae690fe971d423fb7f9ce305f29a930b04eb1fef12319cc9d7a2288`。
- 原统计程序备份为同目录 `worker-before.mjs`，原个人分析派发函数为 `personal-dispatch-before.sql`。目录仅 root 可读；数据库备份含私有数据，不下载或提交到仓库。
- 先在事务中应用并回滚演练。普通 `postgres` 角色无法替换 `supabase_admin` 持有的函数，整次尝试回滚；使用原管理角色后演练通过。没有改变原函数所有权或放宽浏览器权限。
- 2026-10-14 10:08（北京时间）左右，以下五份迁移在一个事务中提交：`2026100911_create_account_data_workbench.sql`、`2026100912_admin_pool_catalog_roster_and_recalculation.sql`、`2026100913_atomic_workbench_workspace.sql`、`2026101400_exclude_manual_statistics.sql`、`2026101401_incremental_account_data_revisions.sql`。
- 正式库没有 `supabase_migrations.schema_migrations` 台账。本次依据实际对象、迁移内容校验值及执行结果记录完成状态，不依赖文件编号推断。已创建迁移不要重复执行。

生产验证发现并追加两份前向修复：

1. `2026101402_restore_revisions_generated_history.sql`：恢复删除记录时只写普通列，由数据库生成 `server_scope`。本机 12 项撤回数据库合同和正式库回滚事务验证通过。
2. `2026101403_bound_statistics_pity_interval_work.sql`：上次重置记录的序号、时间在窗口内一次取得，去除大账号记录间的两两匹配。初次公开汇总超时后应用；完整生产保底视图计数约 22 秒，实际全站汇总检查约 69 秒内完成。耗时为本次观测，不能作为后续性能承诺。

基线已重生成，覆盖 202 份迁移，截止 `2026101403`；静态覆盖校验通过。

## 生产计算衔接

- 正式站 API 仍读取 `public-statistics-v4`。生产 `/opt/endfield-statistics/worker.mjs` 已换为新统计计算程序，临时保留 v4 输出合同，避免旧网站出现版本不匹配。本地源码仍使用 v6，网站发布时须同步构建标准 Worker、预热并切换读取版本。
- 个人分析状态已升级到 schema 5。同机 `endfield-personal-analysis-upgrade.service` / `.timer` 运行新的个人分析程序，依然使用原 service-role 环境文件，不输出凭据或用户身份。每轮约 4 分钟，轮间 30 秒；无任务时正常结束。
- 公共统计与个人分析通过 `/run/lock/endfield-analysis-workers.lock` 串行执行，沿用无权限容器、只读文件系统、1 CPU、1200MiB 内存限制。公共服务增加 `serialization.conf`；两者 timer 已启用。
- 原 pg_cron 个人分析 job 保持启用，但 `request_personal_analysis_worker_dispatch` 暂时返回 `accepted=true, dispatched=false, reason=server_timer`，由同机 timer 接管。原 Vault 中固定部署 URL 和凭据保持原样。未来恢复远程调度前，先确保该部署包含 schema 5 算法，再恢复备份函数，确认真实发布后停止同机个人 timer，避免旧 Worker 领取新版本任务。
- `prune-account-data-revisions` 每日清理任务已创建并启用，版本保留为最近 180 天内最近 5 次。

## 后台汇总网关修复

- 生产 Worker 已直接连接同机 `127.0.0.1:8010`，但 Kong 原 REST 服务的默认等待时间为 60 秒。实际请求复现约 60 秒时返回 HTTP 504、`The upstream server is timing out`；此时数据库仍在计算，因此只验证数据库 SQL 成功不足以证明任务可以发布。
- 在原 Kong 配置中增加 `rest-v1-statistics-worker` 服务，仅匹配 `POST /rest/v1/rpc/compute_and_publish_legacy_statistics`，`read_timeout=210000`、`retries=0`。数据库原 180 秒计算上限保留。继承原 REST 服务的鉴权／请求转换插件，ACL 仅允许 `admin` 组；其他路由的配置与等待时间保持原样。
- 原模板与运行配置已备份为服务器迁移目录内的 `kong-template-before.yml`、`kong-rendered-before.yml`，含凭据，只保存在 root 可读目录。新配置通过 `kong config parse` 校验后由网关内部管理接口加载，未重启网关。模板和容器运行配置均已保存，避免重启后丢失。
- 实际权限核对：匿名调用专用 RPC 返回 HTTP 403；service-role 调用到达数据库，由故意无效的整数参数返回 HTTP 400 / `22P02`。Auth 健康、公开卡池目录、正式站图鉴和限定合池统计读取通过。
- 2026-10-14 13:10:59（北京时间），`global_summary` 真实发布修订 1326，失败计数归零。此前计算期间真实上传触发修订变化，旧计算结果按原有校验回滚并重新排队；没有绕过修订或租约检查。
- 2026-10-14 13:12:02（北京时间），`public_analytics` 同样真实发布修订 1326，失败计数归零；卡池分析缓存 34 行、趋势缓存 11,862 行，均由同一次成功计算提交。Worker 日志确认两项任务的结果均为 `published`。

## 验证与当前边界

- 迁移前后 `history` 总量均为 2,057,460；回填 236 条手动证据，永久排除范围 12 个。统计过滤视图有 2,053,859 条记录，整池排除使 3,601 条退出统计；记录仍在原表。
- 新工作台、原子保存、增量列表／预览／撤回及排除读取 RPC 均出现在生产 REST 元数据。列表及排除读取通过实际服务端请求，HTTP 200。
- 回滚事务验证普通导入、受控修改、整池排除、中断边界、工作台上下文、撤回新增与恢复删除。验证结束后测试历史和测试排除标记均为 0；序列号码可能因回滚验证产生间隙，不影响数据定位。
- 匿名访问增量表、排除表和中断视图被拒绝；浏览器角色无撤回函数直接执行权限，service_role 保留必要调用权限。
- Auth 健康和正式统计 API 返回 HTTP 200；统计响应为 `success=true, partial=false, availability=ready`。重建期间保留上次有效快照，不清空用户结果。
- 2026-10-14 13:14:35（北京时间）核对：公共任务共 4,105 个，失败为 0；仍有 18 个因近期写入待更新，队列继续消化。所有卡池、分组及公开汇总均已有迁移后的计算结果；唯一 `computed_at IS NULL` 的任务属于 12:41:43 注册的新用户，创建时间晚于迁移，已有历史记录，等待首次计算。
- 2026-10-14 13:17:15（北京时间）再次核对：公共失败仍为 0，待更新减少到 17 个；新用户首次计算任务仍在队列中。两项曾失败的公开汇总已完成发布，余下属于运行中的正常更新任务。
- 个人分析有 2,697 个用户状态、2,833 个游戏账号状态，全部为 schema 5，待重建与错误均为 0。公共快照 4,104 份，输出合同全部为当前正式站读取的 v4。正式站全站概览实际响应的 `updatedAt` 已更新为 `2026-10-14T05:10:59.577362+00:00`，权限及公开读取复核通过。
- 两个同机 timer 均启用，服务执行状态为 0；版本清理与原个人派发 cron 均启用。生产仍有真实写入，后续正常更新队列会随上传变化，不能把瞬时待更新数量视为固定值。

生产旧快照、备份和原调度均保留。不要通过恢复整库覆盖迁移后的真实用户写入；需要回退时先明确数据时间边界，再使用保留的函数／程序备份或前向修正处理。
