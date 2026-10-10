# Architecture

本文档描述已发布的 `v4.6.4` 架构，包括默认新版桌面主页与经典主页切换、分池／合池统计、共享模拟器引擎与事务存档。上线证据见 [RELEASE_4.6.4.md](RELEASE_4.6.4.md)。独立 CN / INTL 后端承接官方数据获取、规范化、内部暂存与原子写入。

限定武器池通过 `pools.character_pool_id` 保存同期限定角色池；后台共用 `shared/weaponPoolSchedule.js` 识别与预览三期截止时间，经管理员填入和既有 RPC 原子保存，不自动追写截止日期。独立版本日历读取主站数据库时间，卡池时间不再由本地备份覆盖；缓存和操作边界见 [卡池时间管理](POOL_SCHEDULE_MANAGEMENT.md)。

## 1. 系统边界

```mermaid
flowchart LR
  Browser["Browser / Mobile Web"] --> PublicApi["Same-origin /api/*"]
  Browser --> SupabaseAuth["Supabase Auth\n邮箱密码 / OTP / recovery"]
  Browser --> OAuthBridge["Same-origin OAuth bridge"]
  OAuthBridge --> AuthIdentity["app_auth_identities"]
  SupabaseAuth --> SessionBootstrap["POST /api/auth/session"]
  OAuthBridge --> SiteSession["app_sessions + HttpOnly cookie"]
  SessionBootstrap --> SiteSession
  SiteSession --> PublicApi
  Browser --> ImportBackend["Private CN / INTL import backend"]
  ImportBackend --> ImportStaging["Official import staging"]
  ImportStaging --> SupabaseDb
  Browser --> AnalysisApi["/api/account-gacha-data\nanalysis mode"]
  AnalysisApi --> AnalysisSnapshot["personal_analysis_snapshots"]
  AnalysisScheduler["Supabase pg_cron + pg_net"] --> AnalysisWorker["/api/personal-analysis-worker"]
  AnalysisWorker --> AnalysisSnapshot
  Browser --> InheritanceApi["/api/account-gacha-data\nsimulator-inheritance mode"]
  InheritanceApi --> AnalysisSnapshot
  Browser --> Simulator["shared/simulator\n纯函数引擎与增量账本"]
  Simulator --> SimulatorSave["IndexedDB\n会话与历史事务"]
  PublicApi --> PublicCache["Serverless public cache"]
  PublicCache --> SupabaseDb["Supabase PostgreSQL"]
  Admin["Admin UI"] --> AdminApi["Protected admin API"]
  AdminApi --> SupabaseDb
  Ops["Vercel Cron / Manual Ops"] --> OpsApi["Ops automation API"]
  OpsApi --> SupabaseDb
  Bot["Official Bot"] --> DevApi["Protected developer API"]
  DevApi --> SupabaseDb
```

- 公共数据：生产浏览器统一请求同源 `/api/*`，由 Serverless 层访问 Supabase。
- 私有数据：用户抽卡历史、个人排行、工单、账号恢复和后台数据保持鉴权隔离与 `no-store`。
- 认证：邮箱凭据由 Supabase Auth 管理；第三方 provider 经同源 OAuth bridge 接入，两条入口都以 `auth.users` UUID 为锚点并创建 `app_sessions`。provider 各自配置与验证，未具备开放条件的保持关闭，见 [认证合同](AUTH_SECURITY_HARDENING.md)。
- 个人分析：浏览器只读取 owner/account 快照，不在请求期下载完整历史重新聚合。活跃用户通过 service-role-only RPC 排队并即时触发 `pg_net`，`pg_cron` 每分钟兜底；Worker 使用 lease / revision 防止并发覆盖和陈旧发布。
- 管理与自动化：后台写入、cron 和手动 ops 共享服务端 helper，写入成功后 best-effort 刷新公共缓存版本。
- 私有导入：CN / INTL 后端负责访问官方数据源、过滤情报书等非寻访事件、规范化、问题分类和内部暂存，随后自动通过数据库 RPC 原子提交；可定位的未知角色 / 武器记录写入后由 `history_anomalies` 提醒用户核对。再次导入时，只有被官方数据精确证明为非寻访事件的旧版四星未知占位才会原子移除并重算对应卡池保底。
- 仓库边界：`backend/` 只公开测试与数据契约需要的兼容 helper，不代表完整私有部署包。

## 2. 前端层

| 层级 | 主要文件 | 职责 |
|------|----------|------|
| 入口 | `src/main.jsx`、`src/AppRouter.jsx` | React 挂载、主题、双端路由、Speed Insights |
| 桌面端 | `src/App.jsx`、`src/GachaAnalyzer.jsx`、`src/components/app/DesktopAppRoutes.jsx` | 桌面壳层、初始化、主导航 |
| 移动端 | `src/mobile/MobileApp.jsx`、`src/mobile/layouts/MobileLayout.jsx` | 移动壳层、底栏、移动页面 |
| 状态 | `src/stores/*` | auth、pool、history、个人数据请求生命周期与个人分析快照 |
| 公共读取 | `src/services/publicResourceClient.js` | 同源请求、公共版本、内存缓存、localStorage snapshot |
| 私有读取 / 写入 | `src/services/accountGachaDataService.js`、`src/hooks/app/useCloudSync.js`、`src/utils/cloudDataSync.js` | 个人分析读取、历史分页、精确变更、池信息和 owner 隔离同步 |
| 官方导入 | `src/features/import/useOfficialImportController.js`、`src/features/import/ImportManager.jsx` | 创建 `import-full` 后台任务、轮询 `import-status`、结果刷新、导入后异常提示，以及兼容期遗留审阅元数据清理 |

模拟器已分为共享纯引擎、专用继承投影、IndexedDB 事务仓库、展示与分享适配；资源增量累计，scope 状态统一装配。个人快照 schema 3 与部署要求见 [模拟器合同](SIMULATOR_ENGINE.md)。桌面／移动 dashboard、settings 仍可进一步共享控制器逻辑。

### 2.1 新版桌面主页与经典主页切换

`GachaAnalyzer` 通过 `src/utils/homeExperience.js` 解析浏览器偏好，默认选择新顶栏、`DesktopHomeDemo`、统一消息中心、个人工作区和页面动效，并把选择传入 `DesktopAppRoutes`。组件使用生产可用的懒加载；`gacha_home_experience_v1` 保存 `latest / classic`，旧 `home-demo=unified` 链接显式选择新版，切换时清理旧参数。共享 `SummaryView`、图鉴和原生卡片继续兼容经典入口，移动布局保持原行为。主页偏好不替代贡献者沙盒的数据隔离或现有认证权限。

`DesktopPersonalWorkspace` 把 `/dashboard` 分为个人概览与卡池分析：前者在 `PersonalDataBoundary` 内复用 `SummaryView lockedDataSource="local"`，后者保留原卡池工作区。新版 `/summary` 直接使用 `lockedDataSource="global"`，不受个人读取状态阻塞。图鉴同样锁定来源，个人概览不再等待无关全服加载；v4.6.0 的桌面拆分本身未改变统计计算，v4.6.2 新统计链路见下一节。

`desktopPageLayout.css` 将首页响应式宽度统一到各桌面路由、顶栏与底栏：常规上限 1366px，1920px 以上为 `clamp(1366px, 78vw, 1920px)`，3000px 以上为 `min(74vw, 2560px)`；经典入口和长内容页使用同一壳层尺度。首页通过固定卡片区与可伸展引导区适配 1366×768，较小容器使用分区页签。`DesktopPageMotion` 以路径和个人 `view` 管理入场 / 滚动重置，其他查询参数不触发整页重挂载，并尊重减少动态效果。

`DesktopMessageCenter` 与 `desktopMessageModel` 统一四类公告 / 通知呈现，继续使用现有持久通知数据及业务回调。`VersionCountdownCard` 只接收日期、名称和动作，通过独立 `--vc-*` 主题变量适配视觉。独立的 `VersionBriefingCard` 在前瞻结束后展示，下一次前瞻配置生效时恢复倒计时；`officialAnnouncementsFeed` 保留按中文版本名匹配的官网封面，浏览器直连官方 CDN 原图。详细合同与验证边界见 [DESKTOP_HOME_DEMO.md](DESKTOP_HOME_DEMO.md)。

### 2.2 分池与合池统计（v4.6.2 已发布）

`SummaryView` 和移动统计入口复用 `PoolStatisticsWorkspace`，提供单池及限定角色、限定武器、常驻武器、重构寻访、重构申领五类范围。十图、头像选择、分类排序与旧指标／资源读取同一选择范围。合池先逐账号、逐期、逐对象计算首次，再按当期身份汇总类别；账号覆盖跨期去重，不能相加各池账号数。

`statistics_jobs`、`statistics_snapshots` 与 `statistics_activity` 由常驻 `statisticsWorker` 按 5/30/60 分钟策略处理。公共与认证后的个人读取仅返回 `public-statistics-v4` 快照；GET 不扫描历史、不触发重算。目录成员或目标签名变化、租约与修订冲突、分页不完整均阻止发布不完整结果。旧 `metrics` / `resources` 随范围迁入快照，资源次序仍读取完整相关账号上下文；已有 owner/account 个人分析 Worker 保持独立职责。

详情见 [统计合同](STATS_OBSERVATION_CONTRACT.md) 与 [调度说明](STATISTICS_SCHEDULING.md)。指南仅存在于 Vite DEV 的 `/statistics-preview.html`，不属于生产业务路由。

### 2.3 模拟器与完整历史继承（v4.6.4 已发布）

`shared/simulator/engine.js` 以外部随机源、时间与目录执行纯函数命令。普通限定共享五星／六星水位，单池目标与重构系列进度由能力解析指定；零抽池通过同一 selector 读取状态。免费、情报书和赠送记录统一分类，资源与持有数在追加时累计，账本读取不扫描全部历史。

专用继承 GET 只读匹配账号、来源、契约与修订的 schema 3 快照，返回合同 2 的状态和编码 1 的完整历史；普通分析不附带它。游客本地历史也通过相同投影继承。会话按用户／完整游戏账号键隔离，IndexedDB 同一事务校验 revision 并保存状态与历史，成功后更新 UI；旧 localStorage 只读迁移并保留原键。移动端保持引导提示。

## 3. API 层

| 路径 | 入口 | 说明 |
|------|------|------|
| `/api/*` | `api/router.js` + `api/_routes/index.js` | Vercel 单入口，规避函数数量膨胀 |
| 公共 API | `api/_routes/root/bootstrap.js`、`announcements.js`、`stats.js`、`pool-rosters.js` | 公共数据读取和缓存 meta |
| 后台 API | `api/_routes/root/admin.js` | 管理面板统一入口 |
| 自动化 API | `api/_routes/root/ops-automation.js`、`api/_lib/runOpsAutomation.js` | cron、manual、job graph、review bundle |
| BOT / 开发者 API | `api/_routes/dev/**/*`、`api/_routes/integrations/**/*` | 受保护只读接口和平台绑定 |
| 账号历史与个人分析 | `api/_routes/root/account-gacha-data.js` | 私有历史分页、owner/account 分析与模拟器专用继承、活跃排队、精确编辑 / 删除和别名解析 |
| 个人分析 Worker | `api/_routes/root/personal-analysis-worker.js`、`api/_lib/personalAnalysisWorker.js` | 受保护 Worker、按用户领取 owner/scope、构建并发布 revision 快照 |
| 历史异常 | `api/_routes/root/history-anomalies.js`、`admin-history-anomalies.js` | 用户当前作用域提醒与超级管理员复核 |
| 认证与会话 | `api/_routes/root/auth-oauth.js`、`api/_lib/oauthProviders.js`、`auth-session.js`、`account-email-action.js`、`account-email-verify.js`、`account-password-setup.js`、`account-security-state.js` | OAuth transaction、provider 编排、统一站点 Session、邮箱归属、首次设密与凭据状态 |

公共 API 的兼容响应字段保留 `success / data / cached / partial`，新增 `meta.source / meta.age / meta.partial / meta.stale / meta.cacheKey / meta.cacheVersion` 用于诊断。

## 4. 公共缓存与刷新

- 服务端缓存 helper：`api/_lib/publicCache.js`。
- 全局版本源：`site_config.public_cache_epoch`。
- 版本读取：`/api/public-cache-version`，响应 `no-store`。
- 显式刷新：`/api/admin-public-cache-bump` 和写入侧 best-effort bump。
- 前端降级：公共读取失败时使用最近一次 localStorage snapshot；生产环境不默认回退到 Supabase 浏览器直连。

公共缓存只覆盖首屏、公告、全服统计、卡池目录、阵容和公开 catalog。用户私有数据、后台数据、个人排行和恢复工单不得进入该缓存层。

主站版本日历 DTO 由 `versionCalendarSnapshot.js` 返回数据库日期及 `poolKind / extraSubtype / extraSeriesKey / extraSeriesPhase`；独立日历通过公开 API 合并，保留明确空值和后台期次。独立站的本地活动用于非卡池资料与离线备份。主站公共 CDN 为 `s-maxage=300, stale-while-revalidate=3600`，日历为 `s-maxage=60, stale-while-revalidate=300`；响应正文的 `source` 不能替代 `Age / X-Vercel-Cache` 等缓存头，数据库修正也不表示已打开页面实时重拉。

## 5. 数据库层

Supabase 目录采用“baseline + 归档迁移 + 手工脚本”结构：

- `supabase/baseline/000_complete_schema.sql`：新环境唯一默认入口。
- `supabase/archive/migrations/`：已合并进 baseline 的标准迁移，仅用于审计和重建 baseline。
- `supabase/migrations/`：活跃标准迁移与后续前向变更，其中部分已包含在 baseline。
- `supabase/manual/`：危险、回滚、回填和历史诊断脚本，不进默认部署链。

评估 `history` 体积时区分表与索引。字段或索引删除前核对查询计划、读写路径、实际引用、基准与回退措施，不能仅按历史日期删除迁移或结构。

异常核对与官方导入内部提交基础由迁移 152、153 提供：`history_anomalies` 记录待核对作用域，`history_change_log` 保存受控变更审计，`official_import_tasks` / `official_import_staged_records` 保存短期内部暂存任务，`commit_official_import_records()` 负责最终原子提交。`v4.5.4` 主路径由浏览器创建 `import-full` 后台任务，服务端过滤情报书等非寻访事件，完成安全分类、内部暂存和自动原子提交，浏览器只轮询 `import-status`，不调用同步 `import-confirm`。可精确定位的未知角色 / 武器记录写入并创建异常标记，缺少安全归属字段的记录跳过；迁移 157 提供 service-role-only 的精确修复 RPC，仅在历史记录与待处理异常的账号、区服、卡池、官方序号、时间和四星未知占位条件全部吻合时删除旧错误占位并重算保底。旧逐条审阅接口仅作为兼容接口保留。迁移 155 为旧客户端的仅 ID 批量删除增加锁定快照与重复作用域拒绝，新的单条和整组删除仍使用完整记录作用域。私有历史响应始终 `no-store`，不得进入公共缓存或公开统计快照。

账号历史读取先取得用户精确记录数，再以固定并发分页读取必要列；卡池目录、可见池和账号历史在前端同步阶段并行等待。该优化不改变完整作用域定位、审计或保底重算语义。

认证数据库面由 166–172 提供：admin RPC 权限、OAuth transaction、Session 撤销、规范化邮箱唯一归属、一次性 challenge、首次设密、凭据到期、identity keyring，以及受证据约束的旧空壳修复与隔离。结构和安装顺序见数据库指南，不从文件存在推定某个部署已应用。

个人分析数据库面由 173–180 提供：owner/scope revision、快照队列、catalog 依赖失效、活跃用户优先级、Worker lease、`pg_cron + pg_net` 调度、5 秒全局节流和优先级感知即时派发。常规 Worker 保持 `PERSONAL_ANALYSIS_WORKER_BACKFILL_ENABLED=false`，历史回填只能在维护窗口显式开启。

附加寻访数据库面由 181–183 提供：`extra_subtype / extra_rule_profile / extra_series_key / extra_series_phase`，并把产品语义区分为 `reconstruction`、`reconstruction_claim` 和 `special`。相同分类贯穿可见卡池 RPC、管理写入、官方导入、版本绑定、分析与模拟器；旧 `type=extra` 仍作为粗粒度兼容类型。

统计队列和五类合池由 PR #37 引入。`2026100601_reuse_pool_counts_for_catalog_groups.sql` 使角色／阵容写入仅递增统计 revision，卡池／权限变化复用同事务单池计数生成组合计数，保留原超时与 ACL；`2026100701_weapon_character_pool_schedule.sql` 保存限定武器同期角色关联。`2026100901_simulator_inheritance_v2.sql` 更新个人分析快照 schema 3 与目录失效，baseline 当前包含 194 个迁移；手动补录工作台尚未成为正式数据入口。

## 6. 运营自动化

运营任务依赖关系：

```mermaid
flowchart LR
  A["official-announcements"] --> B["pool-schedule"]
  B --> C["wiki-catalog"]
```

每个节点记录依赖、输入源、输出摘要、耗时、attempts、failureType、warnings、cacheInvalidation、requiresReview 和 published。数据库仍复用 `ops_automation_runs`，`status` 只使用 `success / failure / skipped`；“部分成功”由 `summary.ops.presentationStatus = "partial"` 派生。

## 7. 可观测性与体积预算

- 前端观测：`@vercel/analytics`、`@vercel/speed-insights`。
- 构建预算：`npm run perf:report`。
- 公共网络边界：`npm run test:public-api-boundary`。
- 资源治理：大图优先压缩为 Web 友好格式，截图只保留 README 所需视图；字体 source 与 generated subset 分层维护。
- 已知热点：Serverless 分享图依赖 Chromium，Vercel output 体积仍需长期观察。

## 8. 验证入口

```bash
npm test
npm run test:unit
npm run lint
npm run build
npm run perf:report
npm run test:supabase-baseline
npm run test:supabase-baseline:smoke
npm run test:personal-analysis-queue
npm run test:simulator-v2:sql
npm run test:auth-hardening-phase-a
npm run test:auth-hardening-phase-cd
npm run test:public-api-boundary
```
