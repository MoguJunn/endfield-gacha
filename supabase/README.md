# 数据库 Schema 与迁移指南

新环境入口是 `baseline/000_complete_schema.sql`。当前基线包含 193 个迁移，覆盖 `archive/001_init_tables.sql` 至 `active/2026100701_weapon_character_pool_schedule.sql`；精确范围以文件头和生成校验为准。

## 目录职责

- `baseline/`：由标准迁移源生成的完整 schema。
- `archive/migrations/`：已归档的标准迁移来源，参与基线重建。
- `migrations/`：活跃迁移来源与后续前向变更；其中部分已包含在基线中。
- `manual/data-backfill/`：针对具体数据的修复、回填和脱敏示例。
- `manual/rollbacks/`、`destructive/`、`high-risk/`：回滚或高风险操作，需明确目标和影响。
- `manual/legacy/`、`docs/`：旧数据对照和历史设计索引，不作为常规初始化步骤。
- `tests/`：数据库合同验证。

数据库报告、导出和生成执行 SQL 留在本地，当前数据变化后重新生成；手写修复与回滚来源保留在 Git 中。

## 新环境与升级

1. 确认目标 Supabase/PostgreSQL、所需扩展和角色。
2. 新环境执行完整 baseline，不重复叠加其已包含的历史迁移。
3. 升级已有环境时，依据实际 schema 与执行记录选择尚未应用的前向变更；不要仅看编号或 Git 文件是否存在。
4. 数据库新字段／RPC 先于依赖代码。统计及个人分析按各自 Worker 指南配置、预热，再启用读端。
5. `manual/` 只用于明确的修复场景，先备份和验证范围，不进入默认部署链。

仓库内的历史迁移描述结构演变，不意味着每个文件都应在现有数据库重跑。初始目录种子 `manual/legacy/20260117_initial_catalog_seed.sql` 只用于旧 ID 对照。

## 生成与验证

```bash
npm run generate:supabase-baseline
npm run test:supabase-baseline
npm run test:supabase-baseline:smoke
```

前两条从归档与活跃迁移生成并核对覆盖内容，第三条在临时 PostgreSQL 中真实执行，需要可用的 Docker 环境。路径统一为 POSIX 格式，以兼容 Windows 和 Linux CI。

迁移保持唯一编号，整合多个分支前检查冲突、更新引用并重生成基线。不要用旧分支的完整 baseline 覆盖现行来源，也不要把回滚 SQL 放进标准链。

## 主要数据合同

### 官方导入与历史

迁移 152／153 提供 `history_anomalies`、`history_change_log`、导入任务／暂存与 `commit_official_import_records()`。服务端过滤非寻访事件后原子提交，浏览器轮询任务状态；可定位的未知对象写入异常提醒，缺少安全归属字段的记录跳过。

历史修改核对用户、游戏账号、区服、卡池、序号与编辑版本，并重算受影响保底。迁移 155 对仅 ID 的旧批量删除做跨作用域重复拒绝；迁移 157 的服务端修复 RPC 只处理与官方非寻访证据精确吻合的旧占位，不主动扫描或批量删除历史。

### 认证与邮件

迁移 166–168 提供管理员 RPC、OAuth transaction、Session 撤销、邮箱唯一归属、一次性能力、临时凭据到期、identity keyring 与 restrictive RLS。169／171／172 处理有完整证据和用户显式确认的旧邮箱空壳，170 保持官方导入原子提交；具体不变量见 [认证专题](../docs/AUTH_SECURITY_HARDENING.md)。

`auth_security_events`、邮箱挑战与会话管理数据属于私有层。邮件通过 `enqueue_mail_outbox_event()` 入队，预算、幂等与 suppression 在事务中核对；`mail_runtime_config` 只收紧发信范围，不能保存 SMTP 秘密或绕过环境开关，见 [邮件说明](../docs/SELF_HOSTED_MAIL.md)。

### 分析、卡池与缓存

173–180 提供个人分析 revision、快照队列、租约、活跃优先与 `pg_cron + pg_net` 派发。181–183 定义 `reconstruction / reconstruction_claim / special`，沿用粗粒度 `type=extra` 兼容。

统计迁移 `2026092201`／`2026092401` 提供任务、快照、活动与五类合池。公开 GET 只读结果，不扫描历史；`refresh_public_analytics_cache()` 排队计算，旧缓存与新版快照同事务发布。调度与预热见 [统计说明](../docs/STATISTICS_SCHEDULING.md)，个人投影见 [Worker 指南](../docs/PERSONAL_ANALYSIS_WORKER.md)。

`2026100601` 复用单池计数处理目录保存，保留原权限与超时；`2026100701` 提供 `pools.character_pool_id`，持久保存限定武器的同期角色关联。两份 `manual/data-backfill/20261007_*.sql` 是特定日期修正，不能作为新环境通用种子重复执行，操作合同见 [卡池时间管理](../docs/POOL_SCHEDULE_MANAGEMENT.md)。

`site_config.public_cache_epoch` 是公共缓存版本源。用户历史、个人分析、恢复和后台数据不得进入公共缓存。管理员写入通过同源 API，不需旧管理 Edge Functions。

## 数据审计与修复

ID 审计和演练计划见 [数据待完善项](../docs/CLOSEOUT_LEDGER.md)。字段退役使用 `npm run audit:canonical-retirement-readiness` 核对真实 schema、运行时和工具引用，历史说明变短不代表可以删列。

`scripts/backfill-history-anomalies.mjs` 默认只读；写入需 `--apply` 和 `CONFIRM_HISTORY_ANOMALY_BACKFILL=<记录数>:<用户数>` 精确校验。目标数量变化时重新审阅，不跳过检查。实际修复保留备份、执行记录与回退措施，公开材料使用脱敏示例。
