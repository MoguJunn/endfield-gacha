# 卡池阵容完整读取

卡池配置由 `pools`、`characters` 和 `pool_characters` 提供，与账号有没有抽卡记录无关。2026-10-11 核对时，40 个卡池共有 1,227 条关系；旧整批 REST 查询只返回前 1,000 条，使部分卡池显示为空或缺少成员，数据库内配置仍完整。

## 数据库与服务端

`2026101101_complete_pool_roster_reads.sql` 新增 `read_pool_roster_catalog(p_pool_ids text[])`。返回单个 JSON 对象 `{ rowCount, rows }`，所有关系和实体字段在同一语句快照中聚合，按 `pool_id, character_id` 排序。单个 JSON 值不受 PostgREST 对结果行数的 1,000 行限制。

- `NULL` 读取全部关系，仅供超级管理员 API 已鉴权后的调用。
- ID 数组限定读取范围，重复 ID 不复制行，空数组返回 `{ rowCount: 0, rows: [] }`。
- 使用调用者原有表权限，`anon`／`authenticated` 无执行权限，只有 `service_role` 可调用；浏览器继续通过同源 API 获取数据。
- 不修改卡池内容、阵容关系、历史、API 全局行数上限、统计 revision 或个人分析队列。

`api/_lib/poolRosterRead.js` 检查返回条数、重复键和请求范围。后台全池列表与单池编辑均使用该完整读取；公开 `/api/pool-rosters?poolIds=…` 保持 `data.poolRosters` 及既有实体字段不变。零记录池仍返回已配置名单，真正无配置的池才返回空数组。

公开读取失败且没有已验证完整缓存时返回 HTTP 503、`success=false`、`code=pool_rosters_unavailable` 和 `Cache-Control: no-store`，不返回伪造空名单。已有完整缓存时沿用旧快照并标记 `partial / stale`。客户端应检查 HTTP 状态和这两个标记，不能将不可用数据作为最新目录。

## 后台表现与升级

后台区分名单加载、读取失败及真正空配置。失败时显示“重新读取名单”；列表名单不可用时禁用编辑／推送预览，单池读取失败也不会打开空草稿，避免覆盖已有阵容。

部署 API 前应用该迁移；新环境使用包含 195 个迁移的完整 baseline，不重复叠加已包含来源。现有自托管环境已备份并于 2026-10-11 应用，数据库／真实 PostgREST 与本地新 API 均核验 1,227 条，冬猎 22 条、点绘申领 38 条。后台与 API 修复已由 `f8fef959` 单独提交并推送到 `main`，待 GitHub-connected Vercel 完成正式部署后才在正式页面生效；发布完成后更新公共缓存版本，清除先前被误标完整的截断目录。数据库函数存在不代表旧部署已自动改用它。

并行数据工作台可继续调用原公开接口，无需改请求参数或响应字段。工作台独立工作树集成时，纳入本次公共接口及 helper，或从最新主线合并；同时核对上述 503 和旧缓存提示。工作台业务代码由其独立任务维护。

## 验证

`npm run test:pool-rosters:sql` 默认创建全新本地 PostgreSQL 容器，检查 1,227 条完整返回、源数据相等、范围／空集、实体字段、权限与重复应用。也可显式设置 `POOL_ROSTER_PG_BIN` 为本机 PostgreSQL 的绝对 bin 路径，创建并停止独立集群；不读取应用凭据，不连接已有数据库。

API 回归位于 `api/__tests__/poolRosterRead.test.js`、`poolRosters.test.js` 与 `adminPools.test.js`，UI／控制器回归覆盖失败提示、重试和空编辑保护。迁移来源及生成验证见 [数据库指南](../supabase/README.md)。
