# Architecture

本文档描述当前 `v4.5.4` 主线架构。历史计划和退役部署方式不再作为主路径记录；独立 CN / INTL 后端仅保留官方数据获取、规范化、内部暂存与原子写入职责。

## 1. 系统边界

```mermaid
flowchart LR
  Browser["Browser / Mobile Web"] --> PublicApi["Same-origin /api/*"]
  Browser --> SupabaseAuth["Supabase Auth client"]
  Browser --> ImportBackend["Private CN / INTL import backend"]
  ImportBackend --> ImportStaging["Official import staging"]
  ImportStaging --> SupabaseDb
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
- 管理与自动化：后台写入、cron 和手动 ops 共享服务端 helper，写入成功后 best-effort 刷新公共缓存版本。
- 私有导入：CN / INTL 后端负责访问官方数据源、过滤情报书等非寻访事件、规范化、问题分类和内部暂存，随后自动通过数据库 RPC 原子提交；可定位的未知角色 / 武器记录写入后由 `history_anomalies` 提醒用户核对。再次导入时，只有被官方数据精确证明为非寻访事件的旧版四星未知占位才会原子移除并重算对应卡池保底。
- 仓库边界：`backend/` 只公开测试与数据契约需要的兼容 helper，不代表完整私有部署包。

## 2. 前端层

| 层级 | 主要文件 | 职责 |
|------|----------|------|
| 入口 | `src/main.jsx`、`src/AppRouter.jsx` | React 挂载、主题、双端路由、Speed Insights |
| 桌面端 | `src/App.jsx`、`src/GachaAnalyzer.jsx`、`src/components/app/DesktopAppRoutes.jsx` | 桌面壳层、初始化、主导航 |
| 移动端 | `src/mobile/MobileApp.jsx`、`src/mobile/layouts/MobileLayout.jsx` | 移动壳层、底栏、移动页面 |
| 状态 | `src/stores/*` | auth、pool、history、app 公共状态 |
| 公共读取 | `src/services/publicResourceClient.js` | 同源请求、公共版本、内存缓存、localStorage snapshot |
| 私有写入 | `src/services/accountGachaDataService.js`、`src/hooks/app/useCloudSync.js`、`src/utils/cloudDataSync.js` | 账号历史读取、精确变更、池信息和账号数据同步 |
| 官方导入 | `src/features/import/useOfficialImportController.js`、`src/features/import/ImportManager.jsx` | 创建 `import-full` 后台任务、轮询 `import-status`、结果刷新、导入后异常提示，以及兼容期遗留审阅元数据清理 |

当前仍需后续治理的前端复杂点：

- `SIM-004`：模拟器控制器仍承担过多 UI、资源、继承和分享状态。
- `ARCH-021`：桌面 / 移动端 dashboard、settings 仍有重复控制器逻辑。

## 3. API 层

| 路径 | 入口 | 说明 |
|------|------|------|
| `/api/*` | `api/router.js` + `api/_routes/index.js` | Vercel 单入口，规避函数数量膨胀 |
| 公共 API | `api/_routes/root/bootstrap.js`、`announcements.js`、`stats.js`、`pool-rosters.js` | 公共数据读取和缓存 meta |
| 后台 API | `api/_routes/root/admin.js` | 管理面板统一入口 |
| 自动化 API | `api/_routes/root/ops-automation.js`、`api/_lib/runOpsAutomation.js` | cron、manual、job graph、review bundle |
| BOT / 开发者 API | `api/_routes/dev/**/*`、`api/_routes/integrations/**/*` | 受保护只读接口和平台绑定 |
| 账号历史 | `api/_routes/root/account-gacha-data.js` | 私有历史并行分页读取、精确编辑 / 删除和别名解析 |
| 历史异常 | `api/_routes/root/history-anomalies.js`、`admin-history-anomalies.js` | 用户当前作用域提醒与超级管理员复核 |

公共 API 的兼容响应字段保留 `success / data / cached / partial`，新增 `meta.source / meta.age / meta.partial / meta.stale / meta.cacheKey / meta.cacheVersion` 用于诊断。

## 4. 公共缓存与刷新

- 服务端缓存 helper：`api/_lib/publicCache.js`。
- 全局版本源：`site_config.public_cache_epoch`。
- 版本读取：`/api/public-cache-version`，响应 `no-store`。
- 显式刷新：`/api/admin-public-cache-bump` 和写入侧 best-effort bump。
- 前端降级：公共读取失败时使用最近一次 localStorage snapshot；生产环境不默认回退到 Supabase 浏览器直连。

公共缓存只覆盖首屏、公告、全服统计、卡池目录、阵容和公开 catalog。用户私有数据、后台数据、个人排行和恢复工单不得进入该缓存层。

## 5. 数据库层

Supabase 目录采用“baseline + 归档迁移 + 手工脚本”结构：

- `supabase/baseline/000_complete_schema.sql`：新环境唯一默认入口。
- `supabase/archive/migrations/`：已合并进 baseline 的标准迁移，仅用于审计和重建 baseline。
- `supabase/migrations/`：未来新增且尚未合并的前向迁移。
- `supabase/manual/`：危险、回滚、回填和历史诊断脚本，不进默认部署链。

DB-OPTIMIZE-001 的当前结论：线上 `history` 体积主要来自索引，字段或索引删除需要先完成查询计划、读写路径、回滚脚本和线上基准。本轮只整理迁移归档与 baseline，不直接改变生产 schema 语义。

异常核对与官方导入内部提交基础由迁移 152、153 提供：`history_anomalies` 记录待核对作用域，`history_change_log` 保存受控变更审计，`official_import_tasks` / `official_import_staged_records` 保存短期内部暂存任务，`commit_official_import_records()` 负责最终原子提交。`v4.5.4` 主路径由浏览器创建 `import-full` 后台任务，服务端过滤情报书等非寻访事件，完成安全分类、内部暂存和自动原子提交，浏览器只轮询 `import-status`，不调用同步 `import-confirm`。可精确定位的未知角色 / 武器记录写入并创建异常标记，缺少安全归属字段的记录跳过；迁移 157 提供 service-role-only 的精确修复 RPC，仅在历史记录与待处理异常的账号、区服、卡池、官方序号、时间和四星未知占位条件全部吻合时删除旧错误占位并重算保底。旧逐条审阅接口仅作为兼容接口保留。迁移 155 为旧客户端的仅 ID 批量删除增加锁定快照与重复作用域拒绝，新的单条和整组删除仍使用完整记录作用域。私有历史响应始终 `no-store`，不得进入公共缓存或公开统计快照。

账号历史读取先取得用户精确记录数，再以固定并发分页读取必要列；卡池目录、可见池和账号历史在前端同步阶段并行等待。该优化不改变完整作用域定位、审计或保底重算语义。

## 6. 运营自动化

`OPS-006` 当前 graph：

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
npm run test:public-api-boundary
```
