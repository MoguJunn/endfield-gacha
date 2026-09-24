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

2026-08-01 的真实本地 Supabase/PostgreSQL 17 空库导入已补齐两项此前静态检查未覆盖的边界：`archive/004_tickets_system.sql` 必须在表不存在时也能执行清理；Phase A/B 必须显式授予 `service_role` 访问 `profiles` 与私有 Session 撤销状态所需的 DML 权限，同时保持 `anon/authenticated` 对私有撤销状态的拒绝。`test:supabase-baseline:smoke` 与 `test:auth-hardening-phase-a` 已加入对应回归断言。

当前 baseline 覆盖到 `active/183_split_reconstruction_claim_subtype.sql`。不要再把已包含在 baseline 中的标准迁移重复叠加到同版本新环境。迁移 173–177 提供个人分析 owner/scope revision、安全租约、快照持久化、目录失效与活跃用户优先队列；迁移 178 在支持相应扩展的自建 Supabase 中通过 Vault、`pg_net` 与 `pg_cron` 每分钟触发一次 Worker；迁移 179/180 增加受节流保护的活跃用户即时派发，并避免入队前的 cron 调度错误阻塞新用户；迁移 181–183 增加附加寻访分类、首组重构寻访与重构申领数据，以及独立的重构申领产品子类。GitHub `workflow_dispatch` 仅作为人工应急入口。

### migration 编号说明

- **本分支 166：** `migrations/166_harden_admin_profile_and_oauth_transactions.sql`（认证 admin RPC + OAuth transaction）。
- **本分支 167：** `migrations/167_harden_account_credentials_and_identity_keys.sql`（认证 Phase C/D 数据库面）。
- **本分支 168：** `migrations/168_close_auth_review_findings.sql`（历史 identity 哈希兼容、直连 RLS Session 门禁和首次设密并发收口；必须先于依赖新 RPC 的 API 部署）。
- **本分支 169：** `migrations/169_add_oauth_email_artifact_merge.sql`（只针对旧版验证流程产生且经严格证据确认无任何站内数据的 Auth 空壳，提供一次性邮箱验证、显式确认、归属转移、会话撤销和补偿账本；不是通用账号合并）。
- **本分支 171：** `migrations/171_allow_consumed_magiclink_email_artifact.sql`（识别旧缺陷第二种形状：点击过旧 Magic Link 并留下占位 bcrypt 密码与原生 Session/refresh token 的空壳；要求独立证据版本 `legacy_magiclink_consumed_v2`、真实工单与 super_admin 批准人、完整证据快照哈希绑定；`service_role` 对批准表只读，claim 先锁定批准行再复核）。
- **本分支 172：** `migrations/172_quarantine_oauth_email_artifact_atomically.sql`（通过 service-role-only 的 `SECURITY DEFINER` RPC 在一个数据库事务中同时隔离 Auth 空壳用户和唯一 email identity，并用 identity 冻结触发器阻断活动 intent 期间的并发新增、删除和非预期更新；应用层对结果不明执行幂等重试，仍无法确认时进入人工协调状态）。
- **其他 worktree 仍占用同号文件名（不得与本文件一起部署）：**
  - 主脏树性能线：`159_add_history_scope_read_models.sql`
  - 邮箱候选树：`159_bind_email_verification_to_target.sql`
- 生产库没有主站应用级 migration ledger；166/167/168 的执行记录、迁移文件校验和、迁移前备份和迁移后核验结果保存在受限运维备份中。169 需另行授权和记录，性能线 159 仍未应用。

`AUTH-HARDEN-001` Phase A–D、生产迁移 166/167/168、主线合入和 API/前端部署已经完成。迁移 169 及配套自助修复流程作为后续修复独立发布；LinuxDo provider 不新增数据库迁移，其实现保持在独立分支，真实浏览器验收前保持关闭且不阻塞本修复。

`site_config.public_cache_epoch` 是公共数据缓存版本源；公共 API / 首屏不应回退成浏览器直连 Supabase 读写。
公共卡池统计读取 `public_pool_analytics_cache` 和 `public_pool_trend_cache`；受控刷新入口是 `refresh_public_analytics_cache()`，请求期不应扫描原始 `history` 生成趋势点。
认证安全审计写入私有 `auth_security_events`；表内只保存请求者 / 邮箱 hash、风险桶、CAPTCHA 摘要和脱敏 metadata，不保存原始邮箱、密码、验证码 token、`game_uid` 或用户私密标识。
邮件 outbox 入队入口是 `enqueue_mail_outbox_event()`；该函数只授权给 `service_role`，用于原子检查预算桶、写入脱敏 `mail_outbox` 行并递增 `mail_abuse_budget_counters`，不负责真实发信。
邮件登录使用 `email_login` 事件类型；该类型由 `123_add_email_login_mail_event_type.sql` 加入 `mail_outbox` 和 `mail_abuse_budget_config` 约束及默认预算。
邮件运行期开关使用 `site_config.mail_runtime_config`；该配置由 `124_seed_mail_runtime_config.sql` 预置，只能作为运行期 lower gate 暂停或缩小发信范围，不保存 SMTP 密码、Webhook secret，也不能绕过环境变量硬闸门。

历史异常核对、变更审计与官方导入内部暂存基础由 `152_add_history_review_and_import_staging.sql` 提供：

- `history_anomalies`：按用户、游戏账号、区服、卡池和官方序号精确标记待核对记录；
- `history_change_log`：记录受控编辑 / 删除审计；
- `official_import_tasks`、`official_import_staged_records`：保存短期官方导入内部暂存任务；
- 受控历史修改 RPC：校验完整记录作用域、编辑版本并重算受影响卡池保底。

官方导入最终原子提交由 `153_commit_official_import_records_atomically.sql` 提供的 `commit_official_import_records()` 完成。`v4.5.4` 中浏览器提交 `import-full` 后只轮询 `import-status`；服务端先过滤情报书等非寻访事件并完成安全分类，再自动提交标记为保留的暂存记录，并以数据库事务保证卡池、历史和任务状态一致。浏览器不再调用同步 `import-confirm`，旧逐条审阅接口只保留兼容。

历史版本迁移 `154_bump_site_version_452.sql` 将当时的运行时 `site_config.site_version` 提升到 `v4.5.2`，并更新 `public_cache_epoch` 使 bootstrap 与站点配置缓存失效。

`155_guard_ambiguous_history_batch_delete.sql` 加固旧客户端的仅 ID 批量删除：先锁定并快照本次命中的完整记录，若同一 ID 横跨多个游戏账号作用域则整笔拒绝，避免误删其他账号的同 ID 记录。

`156_bump_site_version_453.sql` 将运行时 `site_config.site_version` 提升到 `v4.5.3`，并更新 `public_cache_epoch` 使 bootstrap 与站点配置缓存失效；它不增加业务表或接口。

`157_repair_official_non_pull_artifact.sql` 提供仅限 `service_role` 的精确修复 RPC：只有历史记录与待处理异常在用户、游戏账号、区服、卡池、官方序号、时间及四星未知占位条件全部吻合时，才原子删除旧错误占位、写入变更审计并重算对应卡池保底。该迁移不会主动扫描或批量修改生产记录。

`158_bump_site_version_454.sql` 将运行时 `site_config.site_version` 提升到 `v4.5.4`，并更新 `public_cache_epoch` 使 bootstrap 与站点配置缓存失效；它不增加业务表或接口。

`166_harden_admin_profile_and_oauth_transactions.sql`（认证 Phase A/B 数据库面）：撤销 `PUBLIC / anon / authenticated` 对 `admin_update_profile` 的执行权，只保留 service-role 同源后台路径；同时新增 service-role-only 的短期 `app_oauth_transactions`，保存浏览器绑定 hash、PKCE verifier 和 link 发起 session/user。callback 通过条件 `DELETE ... RETURNING` 原子取走 transaction，创建新 transaction 前清理已过期行，因此成功、取消和重放都不会留下可再次消费的 PKCE 凭据。该迁移还提供用户级 Session 撤销边界：`auth.users.email / encrypted_password` 真正变化时在同一数据库事务内撤销活动站点 Session，旧 Auth session 后续刷新出的 Bearer 也不能绕过；发送邮箱确认邮件本身不会触发撤销。原生 Bearer bootstrap 按 `auth.sessions.id` 幂等创建，拒绝兼容 JWT 自我派生，限制每用户最多 20 个活动站点 Session，并清理已到期或长期撤销记录。OAuth identity 的首个 owner 在数据库和应用层均不可改写，并发认领失败方会清理刚创建的孤儿 Auth user。该迁移不扫描或主动修改生产账号资料。

`167_harden_account_credentials_and_identity_keys.sql`（认证 Phase C/D 数据库面）：

- 邮箱归属与挑战：`account_email_ownerships`（规范化邮箱唯一归属，回填已确认 Auth 邮箱）与 `account_email_challenges`（一次性挑战，绑定用户、目标邮箱、token/code hash 与版本）；`start_account_email_challenge()` 原子占用目标邮箱并取消旧挑战，`consume_account_email_challenge()` 在 advisory lock + 条件更新下只成功一次，验证成功后才把邮箱提升为 canonical `profiles.email`。`auth.users` 确认邮箱变化时同步归属。
- 首次设密一次性能力：`claim_oauth_password_setup_capability()` 原子占用（要求邮箱已验证且与归属一致），`finish_oauth_password_setup_capability()` 收尾为 `completed / coordination_required`，失败不再重新开放免旧密码入口。
- 临时密码认证层到期：`is_account_credential_allowed()` 检查恢复临时密码是否已过期；`auth.sessions` 插入/更新前由 `reject_expired_temporary_password_auth_session()` 拒绝过期用户。管理员发放临时密码时，到期元数据随 Auth 用户更新原子写入，`revoke_app_sessions_on_auth_password_change()` 触发器同步安全状态并在改密后清除。
- OAuth identity key 版本化：`app_auth_identities.provider_subject_hash_key_version`；`claim_oauth_identity()` 按新旧 hash 双读并原子迁移（owner 不可变、hash split 拒绝）；owner/provider/hash/版本字段被触发器锁定，只允许受控 RPC 修改。
- 原子解绑：`unlink_oauth_identity_atomically()` 在用户级锁内检查提交后的真实登录方式，拒绝解绑最后一个可用方式。
- 以上表与 RPC 全部 service-role-only；`authenticated` 不可读私密归属/挑战表，也不可执行私密 RPC。

`168_close_auth_review_findings.sql`（远端审查修复）：

- `claim_oauth_identity_v2()` 同时锁定 current、previous 和旧主线真实 state-secret HMAC 候选；唯一 owner 匹配后迁移到当前专用 key/version，候选分裂或跨 owner 时拒绝。
- `is_request_auth_session_allowed()` 读取 JWT 的 `sub/session_id/iat`，同时核对站点兼容 Session 或原生 Auth Session、用户撤销边界与临时凭据状态。迁移为 `public/storage` 中所有已启用 RLS 的现有表附加 `AS RESTRICTIVE TO authenticated` 策略，旧 JWT 不能绕过同源 API 直连 PostgREST。
- `refresh_oauth_account_security_state()` 与首次设密 claim/finish 共用用户级 advisory lock，并在锁内重新检查 `has_verified_password_login()`，避免陈旧 OAuth callback 把已完成能力回退为待设密。
- 新 API 会调用本迁移新增 RPC，因此发布顺序固定为：先执行并核验 168，再部署 API；不得反序。

`169_add_oauth_email_artifact_merge.sql`（OAuth 邮箱旧空壳自助修复）：

- `inspect_oauth_email_artifact_merge()` 只对白名单化历史事故形态返回可修复：当前账号必须是待首次设密的 GitHub OAuth 合成账号；冲突方必须位于已知事故窗口、只有 email provider（`providers` 精确等于 `["email"]` 且 `auth.identities` 恰好一条 email identity）、无密码/MFA/登录活动/Profile/业务外键/封禁/异常角色/Session，并有收件人脱敏值、事件类型和时间完全匹配的旧验证事件。
- 所有可修复判定还要求 `account_email_artifact_merge_approvals` 中存在 operator 人工批准（绑定邮箱 SHA-256、证据版本 `legacy_magiclink_v1`、批准引用与有效期）；没有批准一律拒绝，避免仅凭有损脱敏值判定归属。
- `account_email_merge_intents` 保存一次性验证码 hash、阶段、过期时间、补偿快照和发起站点会话；`account_email_merge_budgets` 按“源用户 + 目标邮箱”持久累计发送（≤5 次/24h）与失败（≤8 次后锁定 24h），更换 intent 无法绕过。
- 验证邮箱后仍需在桌面或移动端再次明确确认。确认先由 `claim_oauth_email_artifact_merge()` 在数据库内重新执行完整空壳检查并原子占用（同时撤销双方原生 Auth Session、冻结空壳），再隔离空壳 Auth 用户、原子转移 `account_email_ownerships`、更新当前 OAuth 用户 canonical email，最后建立新站点会话并撤销发起会话。
- claim 后通过 `auth.users` 与全部业务外键表触发器冻结空壳，普通注册或业务写入无法占用保留邮箱；完成后的确认重试会撤销旧 handoff 会话并重建新会话，响应丢失可恢复。
- Auth Admin API 与 PostgreSQL 无法组成同一事务，因此实现包含结果核对、可重试账本和反向补偿；无法确定最终状态时进入 `coordination_required`，不得自动重开或覆盖。
- 任一真实账号数据、MFA、额外 provider、非事故时间窗或证据不完整都会继续安全拒绝，并转人工处理；本迁移不会自动扫描或批量修改生产账号。

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
