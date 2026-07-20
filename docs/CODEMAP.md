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

## 状态与数据

| 范围 | 文件 |
|------|------|
| auth / pool / history / app 状态 | `src/stores/*` |
| 启动初始化 | `src/hooks/app/useAppInitialization.js` |
| 当前卡池上下文 | `src/hooks/app/useCurrentPoolData.js` |
| 云同步 | `src/hooks/app/useCloudSync.js` |
| 账号历史读取与精确变更 | `src/services/accountGachaDataService.js`、`src/hooks/app/useHistoryOperations.js` |
| 官方导入控制器 / 完成策略 / 导入后异常入口 | `src/features/import/useOfficialImportController.js`、`src/features/import/importCompletionPolicy.js`、`src/features/import/ImportManager.jsx` |
| 历史异常客户端 | `src/services/historyAnomalyService.js` |
| 桌面 / 移动共用异常核对面板 | `src/components/records/HistoryAnomalyReview.jsx` |
| 公共资源客户端 | `src/services/publicResourceClient.js` |
| bootstrap / 卡池公开读取 | `src/services/bootstrapService.js`、`src/services/poolReadService.js` |
| 全服统计归一化 | `src/services/statsService.js` |
| 云写入 | `src/services/cloudWriteService.js` |
| 文件导入草稿恢复 | `src/hooks/app/useDataExportImport.js`、`src/utils/importPendingDraft.js` |
| Toast / 持久通知模型 | `src/hooks/useToast.js`、`src/components/ui/Toast.jsx`、`src/utils/notificationModel.js` |

## Vercel API

| 范围 | 文件 |
|------|------|
| 单一 API 入口 | `api/router.js` |
| 路由表 | `api/_routes/index.js` |
| 公共缓存 helper | `api/_lib/publicCache.js` |
| 邮件防刷 / 入队 / worker / webhook / 模板 / 运行期开关 | `api/_lib/mailAbuseGuards.js`、`api/_lib/mailOutbox.js`、`api/_lib/mailOutboxWorker.js`、`api/_lib/mailProviderAdapter.js`、`api/_lib/mailTemplateRenderer.js`、`api/_lib/mailDeliveryFeedback.js`、`api/_lib/mailInboundEvents.js`、`api/_lib/mailSmokeTest.js`、`api/_lib/mailRuntimeConfig.js` |
| 认证 CAPTCHA / 风险桶 / 脱敏审计 | `api/_lib/authSecurityGuards.js` |
| 认证邮件 / 账号恢复状态 | `api/_routes/root/auth-email-action.js`、`api/_routes/root/account-recovery-request.js`、`api/_routes/root/account-security-state.js` |
| 第三方一键登录 / 桥接 | `src/services/authOAuthService.js`、`src/services/authIdentityService.js`、`src/components/auth/AuthCallbackPage.jsx`、`src/components/settings/LoginIdentitiesSection.jsx`、`api/_routes/root/auth-oauth.js`、`api/_lib/oauthProviders.js`、`api/_lib/oauthState.js`、`src/hooks/auth/useOAuthCallbackNotice.js` |
| bootstrap / stats / announcements / pool-rosters | `api/_routes/root/*.js` |
| 私有账号历史 / 精确编辑删除 | `api/_routes/root/account-gacha-data.js` |
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
| 历史批量删除歧义保护验证 | `scripts/verify-history-batch-delete-guard.mjs` |
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
| 静态头像 | `public/avatars/` |
| 版本日历静态图 | `public/game-calendar/` |

## 仍需治理的复杂点

- `SIM-004`：`src/features/simulator/useGachaSimulatorController.js` 仍承担较多模拟器 UI、资源、继承和分享状态。
- `ARCH-021`：桌面 / 移动端 dashboard 与 settings 仍有重复控制器逻辑。
- `DB-OPTIMIZE-001`：线上数据库体积治理要先做索引使用审计和查询计划验证，本轮未直接变更生产 schema 语义。

## 独立导入后端兼容层

| 范围 | 文件 |
|------|------|
| 官方数据规范化、`import-full` 后台任务、内部暂存、自动原子提交和异常标记编排 | `backend/fullImportService.js` |
| 内部暂存任务访问控制与自动提交状态机 | `backend/lib/officialImportStaging.js` |
| 前后端共享保底计算 | `shared/historyPity.js` |
| 前后端共享官方记录规范化 | `shared/officialImportRecordNormalizer.js` |

完整 CN / INTL 私有部署包不属于公开仓库边界；这里仅索引测试和数据契约所需的兼容代码。
