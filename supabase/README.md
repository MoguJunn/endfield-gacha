# Supabase Schema Guide

`supabase/` 按“可重复前向部署”和“仅手工执行”分层维护：

- `baseline/`
  - 新环境的基线 schema。当前入口是 `baseline/000_complete_schema.sql`
  - 由 `npm run generate:supabase-baseline` 从 `archive/` + `migrations/` 自动生成
- `archive/`
  - 已归档的历史标准迁移链，仅用于审计与重新生成 baseline
- `migrations/`
  - 当前 active 标准迁移源文件，以及未来新增、尚未合并进当前 baseline 的前向迁移
- `manual/`
  - 不进入默认部署链的脚本
  - `destructive/`：会清空或重建数据结构
  - `high-risk/`：会改主键、删列或要求人工审查
  - `data-backfill/`：数据回填 / 搬运脚本
  - `legacy/`：历史重构脚本，仅供排障参考
  - `rollbacks/`：回滚脚本，不应作为前向迁移执行
- `docs/`
  - 迁移说明、历史功能指南
- `functions/`
  - 旧 Edge Functions 代码与说明，当前不是公开主链

## 新环境部署

1. 先查看 `baseline/000_complete_schema.sql` 头部的“覆盖范围”
2. 新环境默认直接执行 `baseline/000_complete_schema.sql`
3. 仅当仓库里存在“编号高于 baseline 覆盖范围”的新迁移时，再补执行这些较新的 `migrations/` 文件
4. 仅在明确场景下手工执行 `manual/` 中的脚本

当前仓库内的 baseline 已覆盖到 `active/156_bump_site_version_453.sql`，因此不要再把 `001~156` 这批标准迁移重复叠加执行在同版本 baseline 上。`supabase/migrations/` 保留当前 active 前向迁移源文件供审计与重新生成 baseline；下一次新增迁移应从 `157_*.sql` 开始。

`site_config.public_cache_epoch` 是公共数据缓存版本源；公共 API / 首屏不应回退成浏览器直连 Supabase 读写。
公共卡池统计读取 `public_pool_analytics_cache` 和 `public_pool_trend_cache`；受控刷新入口是 `refresh_public_analytics_cache()`，请求期不应扫描原始 `history` 生成趋势点。
认证安全审计写入私有 `auth_security_events`；表内只保存请求者 / 邮箱 hash、风险桶、CAPTCHA 摘要和脱敏 metadata，不保存原始邮箱、密码、验证码 token、`game_uid` 或用户私密标识。
邮件 outbox 入队入口是 `enqueue_mail_outbox_event()`；该函数只授权给 `service_role`，用于原子检查预算桶、写入脱敏 `mail_outbox` 行并递增 `mail_abuse_budget_counters`，不负责真实发信。
邮件登录使用 `email_login` 事件类型；该类型由 `123_add_email_login_mail_event_type.sql` 加入 `mail_outbox` 和 `mail_abuse_budget_config` 约束及默认预算。
邮件运行期开关使用 `site_config.mail_runtime_config`；该配置由 `124_seed_mail_runtime_config.sql` 预置，只能作为运行期 lower gate 暂停或缩小发信范围，不保存 SMTP 密码、Webhook secret，也不能绕过环境变量硬闸门。

历史审阅由 `152_add_history_review_and_import_staging.sql` 提供：

- `history_anomalies`：按用户、游戏账号、区服、卡池和官方序号精确标记待核对记录；
- `history_change_log`：记录受控编辑 / 删除审计；
- `official_import_tasks`、`official_import_staged_records`：保存短期官方导入内部暂存任务；
- 受控历史修改 RPC：校验完整记录作用域、编辑版本并重算受影响卡池保底。

官方导入最终确认由 `153_commit_official_import_records_atomically.sql` 提供的 `commit_official_import_records()` 完成。`v4.5.3` 的服务端导入路径先完成安全分类，再自动提交标记为保留的暂存记录，并以数据库事务保证卡池、历史和任务状态一致；旧的逐条审阅接口只保留兼容。

`154_bump_site_version_452.sql` 将运行时 `site_config.site_version` 提升到 `v4.5.2`，并更新 `public_cache_epoch` 使 bootstrap 与站点配置缓存失效。

`155_guard_ambiguous_history_batch_delete.sql` 加固旧客户端的仅 ID 批量删除：先锁定并快照本次命中的完整记录，若同一 ID 横跨多个游戏账号作用域则整笔拒绝，避免误删其他账号的同 ID 记录。

`156_bump_site_version_453.sql` 将运行时 `site_config.site_version` 提升到 `v4.5.3`，并更新 `public_cache_epoch` 使 bootstrap 与站点配置缓存失效；它不增加业务表或接口。

`scripts/backfill-history-anomalies.mjs` 是已知异常扫描 / 回填入口。默认模式只读；正式写入必须同时提供 `--apply` 和脚本要求的 `CONFIRM_HISTORY_ANOMALY_BACKFILL=<记录数>:<用户数>` 精确快照。记录数或用户数变化时应停止、重新审计候选范围，不得跳过 guard。

## 维护约束

- 不要把说明文档放回 `migrations/`
- 不要把 destructive / rollback SQL 放回标准链
- 新迁移必须保持编号唯一
- 修改 `archive/` 或 `migrations/` 后，如果希望刷新新环境基线，请执行 `npm run generate:supabase-baseline`
- baseline 刷新后请同步执行 `npm run test:supabase-baseline`，确认头部覆盖范围与首尾 migration 标记一致
- `generate-supabase-baseline` 与 `verify-supabase-baseline` 现已统一输出 POSIX 路径；不要再手工把 `archive/001...` 改回 Windows 反斜杠，否则 GitHub Actions 会在 Linux 上失败
- 已验证 `npm run test:supabase-baseline:smoke` 可在临时 PostgreSQL 容器内注入最小 Supabase `auth` stub 后真实运行 baseline；如需复跑，请先确保 Docker daemon 可访问
- 若要评估 `history.character_id / legacy_pool_id` 的退役准备度，请执行 `npm run audit:canonical-retirement-readiness`；当前 canonical 数据审计与兼容字段退场窗口以这支脚本和 `DATA-NEW-008` 为准，而不是旧的 FEAT-007 历史文档

## 当前与部署相关的边界

- 当前管理后台主链使用的是 Vercel Serverless `api/admin.js`，通过 `vercel.json` rewrite 兼容旧的 `admin-*` 路径
- 不要在部署说明里再要求额外部署旧 Supabase Edge Function
- `supabase/functions/` 仍保留其他确有需要的 Edge Function 说明，但它们不再是当前后台用户管理主路径
