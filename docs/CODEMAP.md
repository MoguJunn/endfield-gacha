# Code Map

这份文件只保留“从哪里开始读代码”的索引。系统边界、数据流、缓存和数据库分层详见 [ARCHITECTURE.md](ARCHITECTURE.md)；部署、环境变量和维护命令详见 [PROJECT_GUIDE.md](PROJECT_GUIDE.md)。

## 前端入口

| 范围 | 文件 |
|------|------|
| React 挂载、Provider、观测 | `src/main.jsx` |
| 桌面 / 移动 / 法律页路由 | `src/AppRouter.jsx` |
| 桌面壳层 | `src/App.jsx`、`src/GachaAnalyzer.jsx` |
| 桌面页面映射 | `src/components/app/DesktopAppRoutes.jsx` |
| 移动壳层 | `src/mobile/MobileApp.jsx`、`src/mobile/layouts/MobileLayout.jsx` |
| 路由常量 | `src/constants/appRoutes.js` |

## 页面主入口

| 页面 | 桌面端 | 移动端 |
|------|--------|--------|
| 首页 | `src/components/home/HomePage.jsx` | `src/mobile/views/MobileHomePageView.jsx` |
| 全服统计 | `src/components/SummaryView.jsx` | `src/mobile/views/MobileSummaryView.jsx` |
| 卡池详情 | `src/components/app/DesktopDashboardWorkspace.jsx` | `src/mobile/views/MobileDashboardView.jsx` |
| 模拟器 | `src/features/simulator/GachaSimulator.jsx` | `src/mobile/views/MobileSimulatorView.jsx` |
| 设置 | `src/components/SettingsPanel.jsx` | `src/mobile/views/MobileSettingsView.jsx` |
| 工单 | `src/components/TicketPanel.jsx` | `src/mobile/views/MobileTicketView.jsx` |
| 后台 | `src/components/AdminPanel.jsx` | `src/mobile/views/MobileAdminView.jsx` |

### 本地桌面 Demo 入口

以下为已验收并于 2026-09-05 本地提交的桌面 Demo 入口，尚未推送 / 发布，仅在 Vite DEV 且 `home-demo=unified` 时激活。原页面入口继续保留；布局、路由和数据合同详见 [DESKTOP_HOME_DEMO.md](DESKTOP_HOME_DEMO.md)。

- 预览选择与消息接线：`src/GachaAnalyzer.jsx`、`src/components/app/DesktopAppRoutes.jsx`。
- 桌面首页、卡池与日程适配：`src/components/home/DesktopHomeDemo.jsx`、`desktopHomeDemo.css`、`desktopHomeData.js`。
- 顶栏、独立工单 / 管理入口、身份与主题菜单：`src/components/home/HomeLandingHeader.jsx`、`homeLandingDemo.css`。
- 原生轮换与活动卡：`src/components/home/RotationScheduleCard.jsx`、`SummerLotteryBanner.jsx`。
- 独立版本倒计时及 `--vc-*` 主题接口：`src/components/home/VersionCountdownCard.jsx`、`versionCountdownCard.css`。
- 四类消息 / 公告模型与统一弹窗：`src/components/home/DesktopMessageCenter.jsx`、`desktopMessageModel.js`、`DesktopHomeDialog.jsx`；组件测试：`src/components/home/__tests__/DesktopMessageCenter.test.jsx`。
- 个人概览 / 卡池分析二级菜单与持久化收起：`src/components/app/DesktopPersonalWorkspace.jsx`；共享宽度 / 外置菜单：`desktopPageLayout.css`。
- 路由入场与滚动重置：`src/components/app/DesktopPageMotion.jsx`；统计来源锁定：`src/components/SummaryView.jsx`、`src/hooks/summary/useSummaryViewState.js`、`src/components/summary/CharacterCatalogView.jsx`。

## 状态与数据

| 范围 | 文件 |
|------|------|
| auth / pool / history / app / 个人数据生命周期 / 分析快照状态 | `src/stores/*` |
| 启动初始化 | `src/hooks/app/useAppInitialization.js` |
| 当前卡池上下文 | `src/hooks/app/useCurrentPoolData.js` |
| 云同步 | `src/hooks/app/useCloudSync.js` |
| 个人分析、账号历史分页与精确变更 | `src/services/accountGachaDataService.js`、`src/hooks/app/useCloudSync.js`、`src/hooks/app/useHistoryOperations.js` |
| 官方导入控制器 / 完成策略 / 导入后异常入口 | `src/features/import/useOfficialImportController.js`、`src/features/import/importCompletionPolicy.js`、`src/features/import/ImportManager.jsx` |
| 历史异常客户端 | `src/services/historyAnomalyService.js` |
| 桌面 / 移动共用异常核对面板 | `src/components/records/HistoryAnomalyReview.jsx` |
| 公共资源客户端 | `src/services/publicResourceClient.js` |
| bootstrap / 卡池公开读取 | `src/services/bootstrapService.js`、`src/services/poolReadService.js` |
| 全服统计归一化 | `src/services/statsService.js` |
| 云写入 | `src/services/cloudWriteService.js` |
| 文件导入草稿恢复 | `src/hooks/app/useDataExportImport.js`、`src/utils/importPendingDraft.js` |
| Toast / 持久通知模型 | `src/hooks/useToast.js`、`src/components/ui/Toast.jsx`、`src/utils/notificationModel.js` |
| 贡献者内容沙盒 / 正式目录缓存 / 真实 fallback / synthetic 会话 | `src/dev/contributorDemoMode.js`、`src/dev/contributorDemoSandboxStore.js`、`src/dev/contributorRealFallbackCatalog.js`、`src/dev/contributorDemoRuntimeData.js`、`src/dev/contributorDemoSession.js` |
| 沙盒同步桥 / 横幅 / 本地管理控制台 | `src/hooks/app/useContributorDemoSandboxBridge.js`、`src/components/dev/ContributorDemoBanner.jsx`、`src/components/admin/ContributorDemoAdminPanel.jsx` |

## Vercel API

| 范围 | 文件 |
|------|------|
| 单一 API 入口 | `api/router.js` |
| 路由表 | `api/_routes/index.js` |
| 公共缓存 helper | `api/_lib/publicCache.js` |
| 邮件防刷 / 入队 / worker / webhook / 模板 / 运行期开关 | `api/_lib/mailAbuseGuards.js`、`api/_lib/mailOutbox.js`、`api/_lib/mailOutboxWorker.js`、`api/_lib/mailProviderAdapter.js`、`api/_lib/mailTemplateRenderer.js`、`api/_lib/mailDeliveryFeedback.js`、`api/_lib/mailInboundEvents.js`、`api/_lib/mailSmokeTest.js`、`api/_lib/mailRuntimeConfig.js` |
| 认证 CAPTCHA / 风险桶 / 脱敏审计 | `api/_lib/authSecurityGuards.js` |
| 认证邮件 / 邮箱归属 / 首次设密 / 账号恢复状态 | `api/_routes/root/auth-email-action.js`、`account-email-action.js`、`account-email-verify.js`、`account-password-setup.js`、`account-recovery-request.js`、`account-security-state.js` |
| 第三方一键登录 / 桥接 | `src/services/authOAuthService.js`、`src/services/authIdentityService.js`、`src/components/auth/AuthCallbackPage.jsx`、`src/components/settings/LoginIdentitiesSection.jsx`、`api/_routes/root/auth-oauth.js`、`api/_lib/oauthProviders.js`、`api/_lib/oauthState.js`、`src/hooks/auth/useOAuthCallbackNotice.js` |
| Identity hash keyring / 统一认证解析 | `api/_lib/identityHash.js`、`api/_lib/siteAuth.js`、`api/_lib/siteSession.js`、`api/_routes/root/auth-session.js` |
| bootstrap / stats / announcements / pool-rosters | `api/_routes/root/*.js` |
| 私有账号历史 / 精确编辑删除 | `api/_routes/root/account-gacha-data.js` |
| 个人分析 Worker / 队列构建 | `api/_routes/root/personal-analysis-worker.js`、`api/_lib/personalAnalysisWorker.js` |
| 用户异常提醒 / 后台异常复核 | `api/_routes/root/history-anomalies.js`、`api/_routes/root/admin-history-anomalies.js` |
| 后台管理 | `api/_routes/root/admin.js` |
| 运营自动化 | `api/_routes/root/ops-automation.js`、`api/_lib/runOpsAutomation.js` |
| BOT / 开发者接口 | `api/_routes/dev/**/*`、`api/_routes/integrations/**/*` |

## 维护脚本

| 范围 | 文件 |
|------|------|
| 邮件防刷 / 入队验证 | `scripts/verify-mail-abuse-guards.mjs`、`scripts/verify-mail-outbox-enqueue.mjs` |
| 邮件 worker / webhook 验证 / 手动入口 | `scripts/verify-mail-outbox-worker.mjs`、`scripts/verify-mail-delivery-feedback.mjs`、`scripts/verify-mail-inbound.mjs`、`scripts/verify-mail-service-entrypoints.mjs`、`scripts/run-mail-outbox-worker.mjs` |
| 公共 API / cache 验证 | `scripts/verify-public-api-boundary.mjs`、`scripts/verify-bootstrap-cache-partial.mjs`、`scripts/verify-public-pool-analytics-cache.mjs` |
| baseline / 数据库验证 | `scripts/verify-supabase-baseline.mjs`、`scripts/verify-supabase-baseline-smoke.mjs` |
| 个人分析队列 SQL 合同 | `scripts/verify-personal-analysis-queue-sql.mjs` |
| 认证 Phase A/B 与 C/D 专项 | `scripts/verify-auth-hardening-phase-a.mjs`、`scripts/verify-auth-hardening-phase-cd.mjs` |
| 历史批量删除歧义保护验证 | `scripts/verify-history-batch-delete-guard.mjs` |
| 贡献者沙盒真实目录、内容持久化与零私有请求验证 | `scripts/verify-contributor-demo-playwright.mjs` |
| 生产历史异常扫描 / 受保护回填 | `scripts/backfill-history-anomalies.mjs` |

## Supabase 与资源

| 范围 | 路径 |
|------|------|
| 新环境 schema 入口 | `supabase/baseline/000_complete_schema.sql` |
| 已合并进 baseline 的迁移 | `supabase/archive/migrations/` |
| 未来新增迁移 | `supabase/migrations/` |
| 手工危险 / 回填 / 回滚脚本 | `supabase/manual/` |
| 邮件 outbox / suppression / 预算表 | `supabase/migrations/116_add_mail_outbox_and_abuse_controls.sql` |
| 账号恢复强制改密状态 | `supabase/migrations/117_add_account_recovery_state_metadata.sql` |
| 认证安全审计事件 | `supabase/migrations/119_add_auth_security_events.sql` |
| 邮件 outbox 原子入队 RPC | `supabase/migrations/120_add_mail_outbox_enqueue_rpc.sql` |
| 邮件登录事件与运行期开关 | `supabase/migrations/123_add_email_login_mail_event_type.sql`、`supabase/migrations/124_seed_mail_runtime_config.sql` |
| 历史异常、审计与导入暂存 | `supabase/migrations/152_add_history_review_and_import_staging.sql` |
| 官方导入自动原子提交 RPC | `supabase/migrations/153_commit_official_import_records_atomically.sql` |
| 历史 v4.5.2 运行时版本与缓存失效 | `supabase/migrations/154_bump_site_version_452.sql` |
| 旧批量删除歧义保护 | `supabase/migrations/155_guard_ambiguous_history_batch_delete.sql` |
| 历史 v4.5.3 运行时版本与缓存失效 | `supabase/migrations/156_bump_site_version_453.sql` |
| 官方非寻访事件旧占位精确修复 RPC | `supabase/migrations/157_repair_official_non_pull_artifact.sql` |
| 当前 v4.5.4 运行时版本与缓存失效 | `supabase/migrations/158_bump_site_version_454.sql` |
| 认证 Phase A/B | `supabase/migrations/166_harden_admin_profile_and_oauth_transactions.sql` |
| 认证 Phase C/D | `supabase/migrations/167_harden_account_credentials_and_identity_keys.sql` |
| 认证审查与旧邮箱空壳修复 | `supabase/migrations/168_close_auth_review_findings.sql`–`172_quarantine_oauth_email_artifact_atomically.sql` |
| 个人分析 revision / 快照 / 活跃队列 | `supabase/migrations/173_add_personal_analysis_scope_revisions.sql`–`177_prioritize_active_personal_analysis_jobs.sql` |
| 个人分析 `pg_cron + pg_net` 调度与即时派发 | `supabase/migrations/178_schedule_personal_analysis_worker_with_pg_cron.sql`–`180_prioritize_immediate_personal_analysis_dispatch.sql` |
| 附加寻访、重构寻访与重构申领 | `supabase/migrations/181_add_extra_pool_subtypes.sql`–`183_split_reconstruction_claim_subtype.sql` |
| 静态头像 | `public/avatars/` |
| 版本日历静态图 | `public/game-calendar/` |

## 仍需治理的复杂点

- `SIM-004`：`src/features/simulator/useGachaSimulatorController.js` 仍承担较多模拟器 UI、资源、继承和分享状态。
- `ARCH-021`：桌面 / 移动端 dashboard 与 settings 仍有重复控制器逻辑。
- `DB-OPTIMIZE-001`：线上数据库体积治理要先做索引使用审计和查询计划验证，本轮未直接变更生产 schema 语义。
- `AUTH-HARDEN-001`：Phase A–D、PR #14、邮箱/凭据状态机、安全属性专项和 GitHub 核心浏览器闭环已完成；生产数据库已确认 166–168，API / 主线已发布。LinuxDo 保持在独立分支 `feat/linuxdo-oauth`，已下调为 P3 且不阻塞认证发布。
- `PERF-013 / UX-FLOW-001`：个人数据与分析可用性主链已由 PR #23–#25 收口；更广的桌面 / 移动重复控制器和视觉密度治理继续由 `ARCH-021`、`UI-*`、`MOBILE-006` 跟踪。

## 独立导入后端兼容层

| 范围 | 文件 |
|------|------|
| 官方数据规范化、`import-full` 后台任务、内部暂存、自动原子提交和异常标记编排 | `backend/fullImportService.js` |
| 内部暂存任务访问控制与自动提交状态机 | `backend/lib/officialImportStaging.js` |
| 前后端共享保底计算 | `shared/historyPity.js` |
| 前后端共享官方记录规范化 | `shared/officialImportRecordNormalizer.js` |

完整 CN / INTL 私有部署包不属于公开仓库边界；这里仅索引测试和数据契约所需的兼容代码。
