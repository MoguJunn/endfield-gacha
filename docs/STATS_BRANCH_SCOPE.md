# 统计与指南分支范围

分支：`feat/banner-stats-and-guide`，基线 `0a35da58`。

工作目录：`D:/Learning/Endfield Gacha/_tmp/release-v4.6.0`。2026-09-19 按用户要求，在继续真实接入前从 main 建立此分支，保留本轮已有预览与计算层变更。未提交、未推送。

手动导入和数据修改任务位于另一工作副本 `gacha-analyzer`；本轮没有切换、合并或修改该副本的内容。后续合并时应特别检查双方都可能修改的 `SummaryView.jsx` 和 Stats API，不能直接用一方覆盖另一方。

## 本轮范围

已有文件的改动包含统计入口替换、API 分派、旧统计读取路径及定时结果接入：

- `src/components/SummaryView.jsx`：默认改为分卡池八图，旧资源概览和图鉴保留在独立页签。
- `src/mobile/views/MobileStatsView.jsx`：移动统计入口复用相同真实统计工作区，旧概览跟随同一数据来源。
- `api/_routes/root/stats.js`：新增 `pool_observations`、`pool_counts`、受认证保护的 `personal_statistics`；旧统计类型改读持久快照。
- `api/_lib/publicCatalog.js`、`src/services/statsService.js`：旧公开统计只读结果，删除页面失败后直接重算的路径。
- `src/hooks/summary/useSummaryStats.js`、`useSummaryViewState.js`、`src/components/summary/CharacterCatalogView.jsx`：接入个人概览／图鉴快照，避免统计页面反复拉取全历史。
- `src/components/pool/PoolGroupCardRail.jsx`：保留此前竖向参数和键盘支持，但统计页已使用专门设计的紧凑 `StatisticsPoolList`。
- `api/__tests__/rootStatsCharacterCatalog.test.js`：更新快照读取合同，保留公开字段脱敏与头像规范化验证。
- `supabase/baseline/000_complete_schema.sql`：由生成器纳入新增迁移。

本轮新增文件：

- `src/components/summary/PoolStatisticsWorkspace.jsx`
- `src/components/summary/StatisticsPoolList.jsx`
- `src/components/pool/poolGroupCardRail.css`
- `src/components/summary/PoolObservationCharts.jsx`
- `src/components/summary/PoolTargetPrediction.jsx`
- `src/components/summary/poolStatisticsWorkspace.css`
- `src/components/summary/__tests__/PoolStatisticsWorkspace.test.jsx`
- `src/components/ui/experienceFoundation.css`
- `src/utils/poolObservationStats.js`
- `src/utils/storedPoolObservations.js`
- `src/utils/targetProbabilityDistribution.js`
- `src/utils/__tests__/poolObservationStats.test.js`
- `src/utils/__tests__/storedPoolObservations.test.js`
- `src/utils/__tests__/targetProbabilityDistribution.test.js`
- `api/_lib/poolObservations.js`
- `api/__tests__/poolObservations.test.js`
- `api/_lib/scheduledStatistics.js`、`statisticsWorker.js`、`personalStatisticsSnapshot.js`
- `api/__tests__/scheduledStatistics.test.js`、`personalStatisticsSnapshot.test.js`
- `src/services/scheduledStatisticsService.js`
- `shared/statisticsRefreshPolicy.js`
- `supabase/migrations/2026092201_schedule_statistics_snapshots.sql`
- `scripts/run-statistics-worker.mjs`、`scripts/systemd/endfield-statistics.service`、`scripts/systemd/endfield-statistics.timer`
- `scripts/prepare-statistics-local-preview.mjs`、`scripts/verify-statistics-schedule-sql.mjs`
- `docs/STATISTICS_SCHEDULING.md`
- `src/dev/StatisticsExperiencePreview.jsx`
- `src/dev/statisticsPreviewData.js`
- `src/dev/statisticsPreviewEntry.jsx`
- `statistics-preview.html`
- `scripts/verify-statistics-preview-playwright.mjs`
- `scripts/verify-pool-statistics-live.mjs`
- `scripts/inspect-pool-observation-exclusions.mjs`：只读核查目录缺失原因，只输出汇总计数与公开对象编号。
- `docs/STATS_OBSERVATION_CONTRACT.md`
- 本文件。

## 先前存在、不得误收入本任务的改动

以下 11 个文件在本轮分支创建前已经修改，属于保留的首页／文档等工作；本轮接入没有编辑它们的业务内容。构建只重生成现有分享渲染器。

```text
api/_generated/dashboardShareCardRenderer.mjs
docs/ARCHITECTURE.md
docs/CLOSEOUT_LEDGER.md
docs/CODEMAP.md
docs/PROJECT_GUIDE.md
docs/README.md
docs/RELEASE_4.6.0.md
docs/RELEASE_CHECKLIST.md
src/GachaAnalyzer.jsx
src/components/app/DesktopAppRoutes.jsx
src/utils/storageUtils.js
```

不要使用 `git add .` 把上述保留改动、环境文件或其他任务内容混进统计提交。工作区 `_docs/tasks` 的任务状态与 Cursor 计划不属于仓库提交内容。

## 已接入入口与验证

- 桌面全服：`/summary`。
- 桌面个人：`/dashboard?view=overview`，使用现有登录与个人数据边界。
- 手机统计：`/m/stats`。
- 原构造样例入口 `/statistics-preview.html` 仍保留，仅用于指南和布局参考；真实页面不引用其构造记录。

主站原统计入口默认呈现八图和左侧竖向筛选；账号与区服位于上方，具体卡池使用“小头像＋名称＋抽数”的紧凑行，支持搜索和分组收起。首次固定为“本期卡池内首次”，正式页、预览和计算层已移除历史首次分支。窄屏可展开筛选。真实聚合保留来源和计算时间；首次等待、读取失败和真实零记录分别显示。页面按本期已导入记录的首条计数，同时说明缺失记录的影响。

实测：`special_1_5_1` 冬猎，45,905 条保存记录，45,904 个有效抽取结果、443 个参与账号。原排除的 429 条均为对象编号缺失，380 条经名称／星级／类型精确匹配纳入具体对象，49 条无名称四星记录保留在总数与星级中，同星级受影响花费间隔列为未知；排除数为 0，另有 1 条直接赠送不计抽取。该数值只是验证时刻的结果，会随导入与缓存更新变化。公开响应没有用户 ID、游戏 UID、记录 ID 或原始历史；未匹配的用户文本不会返回。

本次反馈修正验证：36 项相关测试通过，覆盖目录匹配、未知对象、固定本期首次、账号隔离和原卡片键盘切换；全量 ESLint 的唯一 React 缓存检查问题已修正并单独复查通过，修改后再次通过全部 6 项工作区组件测试。真实页面的 360/390/768/1366/1920 宽度、原卡片竖向排列、搜索与切池、空池、理论边界、旧概览、英文深色、手机路由及独立预览通过。主应用与抽奖子应用构建通过。没有借用用户会话自动登录检查私人记录。

2026-09-22 后续反馈已实现：34 个公开卡池的本地真实结果、全量列表抽数、首次曲线、5/30/60 分钟持久队列、旧统计及个人统计读取、最后计算时间与下次检查。冬猎当前预览为 47,473 条有效结果、459 个账号、746 个六星首次样本。全套 ESLint、相关单测、PGlite 调度 SQL 和真实浏览器验证通过；运行说明见 [STATISTICS_SCHEDULING.md](./STATISTICS_SCHEDULING.md)。本地依赖和结果文件在 `.agent-tmp` 中，不进入提交。

当前仍未部署或执行生产迁移。首获完整前缀证据、原始规则来源以及生产任务耗时验收仍待完善；本轮已准备持久缓存及按受影响范围重算，不再将它们列为未实现设计。
