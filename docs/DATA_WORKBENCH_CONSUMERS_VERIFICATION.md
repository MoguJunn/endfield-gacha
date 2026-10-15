# 主站数据校对工作台：统计 / 资源 / 导出消费链验证说明

> 当前更新：按新要求增加 `pool-ledger`、稳定四星推算标记与整体验证提交。渠道、覆盖和 `inferredFill` 在站内 JSON 往返保留；推算角色不进入精确分析，真实明细按覆盖扣减替代。迁移重编号为 `2026100911`、`2026100912`，新增 `2026100913`；临时 PostgreSQL 18.4 的 24 项集成验证通过，托管环境仍未应用。下文保留之前消费链验证记录，当前口径以 [DATA_WORKBENCH_IMPLEMENTATION.md](./DATA_WORKBENCH_IMPLEMENTATION.md) 为准。

本文件记录《主站数据校对工作台》计划第二阶段中，统计、资源与导出消费链的已交付改动、
实际验证结果和仍需主代理处理的真实缺口。文中结论以本机执行过的命令输出为准，未连接生产、
未提交、未推送、未应用任何数据库迁移。

## 范围与边界

已实现范围：

- 共享指标引擎与聚合 DTO：`shared/dataWorkbenchMetrics.js`、`shared/dataWorkbenchAnalytics.js`。
- 消费者：个人分析 Worker 与快照、全服统计 API 与前端缓存、站内 JSON 导出与再导入、双端统计展示。
- 测试：新增 4 个测试文件与 2 个新源文件；扩展 4 个、适配 1 个既有测试文件。

明确未触碰（归属主代理或其他阶段）：

- 工作台前端目录 `src/features/data-workbench/`、桌面/移动路由、`src/GachaAnalyzer.jsx`。
- 后台池管理（`PoolEditDialog.jsx`、`admin-pools.js`）与公共目录缓存重算。
- `api/_routes/root/data-workbench.js`、`api/_lib/dataWorkbench.js`、迁移 `2026100911_create_account_data_workbench.sql`。

## 一、已完成改动

### 1. 指标引擎（`shared/dataWorkbenchMetrics.js`）

- 支持数值时间戳：`ms()` 现在同时接受 `Date.parse` 可解析值和安全数值时间，修复官方历史记录
  （数值 `timestamp`）导致的覆盖比对失效。
- 覆盖范围按抽取方式隔离：明细、摘要、逐条重复判定都要求 `drawMethod` 一致，`gift` 明细不再让
  `normal` 摘要被判定覆盖；摘要自身为 `gift` 时按原始明细逐条扣减（含赠送武器收益路径）。
- 同池明细存在缺失时间时不再装作可覆盖：输出 `coverage_time_unknown`，该摘要不参与补充数量、
  出率与区间资源，避免把未知范围算进统计。
- 摘要与明细星级构成冲突检测：即使 `totalPulls` 不小于覆盖明细，只要“明细已知构成 + 摘要已知构成”
  超过摘要总抽数，仍按 `summary_less_than_details` 阻断，避免 2 抽 2 个六星这类自相矛盾数据。
- 资源证据与生效边界：
  - 满潜证据（`potential-evidence`）的 `evidenceRef` 若指向 `history.id`/`record_id`/`seq_id`
    或已计入的补录明细，不再重复计为新的获取，避免用重复证据堆出满潜。
  - 同一秒到达满潜边界时不反推事件顺序；边界后的补充获取才计入重复兑换收益。
  - 补充五星/六星按 `QUOTA_RULES` 计入对应资源（新增 `knownBondQuota`、`knownEndpointQuota`，
    保留 `knownWeaponAic`、`knownExcessAic`、`rangeExcessAic`）。
  - 未知四星数量不推算、不生成收益；历史可适用目录缺 `release_date` 时保留 `potential_boundary_required`。

### 2. 聚合 DTO（`shared/dataWorkbenchAnalytics.js`）

- `accountKey` 支持 `row.scope.gameUid/serverScope`（导出再导入后的条目形状），同 UID 不同区服不合并。
- 新增按卡池类型计算（`byType`）时把同账号其他池的满潜证据与全量历史作为资源上下文传入，但只累计
  当前类型的补充收益；同一次账号历史只读一次，避免筛选后满潜边界丢失。
- 资源字段扩展到 `knownBondQuota`、`knownEndpointQuota`。

### 3. 消费者

- `api/_lib/dataWorkbenchAnalytics.js`
  - 公共聚合读取后统一做卡池/实体别名归一化（`resolvePoolAliasMap`、`resolveCharacterAliasMap`），
    避免历史别名与工作台规范 ID 被当成两个池/实体。
  - 仍保持“读失败返回 `unavailable`”，不把半成品结果当作有效补录统计。
- `api/_lib/personalAnalysisWorker.js`
  - 个人模型构建时同样对补录条目做别名归一化，再参与规范池清单与快照构建。
- `api/_lib/publicCatalog.js` / `api/_lib/publicAnalytics.js`
  - `fetchGlobalSummary` 已附带 `workbench`；`fetchPublicAnalytics`、`buildPublicGlobalStats`
    的 analytics 输出保留 `workbench` 透传（DTO 不新增私有字段）。
- `api/_routes/root/stats.js`
  - 已有改动继续生效：`global_summary` 直接使用 `fetchGlobalSummary`，内存缓存的读写包含完整
    `workbench` DTO；补录编辑/删除不改变 `history` 行数，因此缓存到期（60 秒）后必刷新。
- `src/services/statsService.js`
  - `normalizeGlobalStats` 保留 `workbench` 字段，保证 API 归一化和 localStorage 快照不丢补录统计。
- `src/hooks/summary/useSummaryViewState.js`
  - `currentStats.workbench`（全池）与按类型 `workbench.byType[type]` 暴露给双端展示。
- 展示：
  - 新增 `src/components/summary/WorkbenchMetricsPanel.jsx`，接入 `src/components/SummaryView.jsx`
    与 `src/mobile/views/MobileStatsView.jsx`。
  - 只展示可确认口径：去重补充抽数、与匹配分母一致的出率、明确间隔抽样、可确认补充资源，以及
    未知四星 / 待核对覆盖 / 证据不足数量；`status !== 'ready'` 时降级提示，不阻塞既有统计。

### 4. 导出与再导入

- `src/utils/dataExport.js`
  - 站内 JSON（`internal_json_v3`）新增可选 `supplements`（`schemaVersion: 1` + `workbenchEntries`），
    输出补录稳定身份、账号区服、池、类型、时间精度与已知值；不输出数据库 ID、`seq_id`、`user_id`。
  - 补录条目参与卡池/账号引用收集，纯摘要账号也能导出其引用池和账号元数据。
  - 日期筛选只保留完全落在所选范围内的摘要；部分区间不裁剪、不猜总数。
  - 账号作用域按 `serverScope` 识别同 UID 不同区服（`withExplicitServerScope`），
    修复“同 UID 双区服只导出其中一份补录”的问题。
  - 新增 `isInfoBook` 序列化，避免情报书记录被当作普通抽卡。
- `src/utils/dataImport.js`
  - 识别并校验 `supplements`（版本、身份、区服、`knownPoolIds`、重复身份），失败时作为整体错误
    阻止导入，不产生半份数据。
  - 导入后保留 `serverScope`，并把它纳入 `getHistoryImportDedupKey`（新增 `server:` 前缀），
    同 UID 不同区服的明细不再互相判重。
- `src/services/workbenchTransferService.js`（新增）
  - `loadWorkbenchEntriesForExport`：按账号区服读取现有补录，每个作用域只请求一次。
  - `importWorkbenchEntries`：按 `scope + draftId` 分组，每批最多 100 条走现有
    `/api/data-workbench` 的 `commit`；提交 ID 由 `scope + draftId + 条目` 规范化哈希生成，
    失败重试与历史重试幂等；已存在条目按规范化内容比对，内容不同即抛出“已被修改”并保留原记录；
    保存后（含历史幂等重放）重新读取作用域确认条目仍存在，删除过的旧提交不会被当成新保存。
- `src/hooks/app/useDataExportImport.js`
  - 登录用户导出站内 JSON 时附带补录；补录条目也参与账号覆盖解析。
  - 再导入：未登录时保留预览并提示需登录；确认导入时调用 `importWorkbenchEntries`，
    仅当全部成功才清除待确认草稿；失败保留预览、提示“补录预览已保留”，与明细导入的
    “部分成功/云端失败”提示区分开。
  - 仅补录、没有明细的文件也允许确认导入（不再被 `history.length === 0` 提前拦截）。
  - 账号覆盖（`accountOverride`）同步改写补录账号，保持与明细同一账号。

## 二、实际验证命令与结果

以下命令均在本机执行，未连接生产、未应用迁移、未提交。

1. 针对性单元测试（10 个文件）：

```text
npm --prefix "D:\Learning\Endfield Gacha\gacha-analyzer" run test:unit -- src/utils/__tests__/workbenchTransfer.test.js api/__tests__/dataWorkbenchMetrics.test.js api/__tests__/dataWorkbenchConsumers.test.js api/__tests__/dataWorkbenchStatsCache.test.js api/__tests__/personalAnalysisWorker.test.js src/utils/__tests__/personalAnalysisSnapshot.test.js src/services/__tests__/workbenchTransferService.test.js src/hooks/app/__tests__/useDataExportImport.test.jsx src/hooks/summary/__tests__/useSummaryViewState.test.jsx src/services/__tests__/statsService.test.js
```

结果：`Test Files 10 passed (10)`、`Tests 70 passed (70)`。

关键覆盖：

- `dataWorkbenchMetrics.test.js`（17 项）：180 抽摘要覆盖 100 条明细只补 80；赠送不计入出率分母；
  数值/缺失时间戳；摘要构成冲突；满潜边界与重复证据；赠送武器摘要去重。
- `dataWorkbenchConsumers.test.js`（7 项）：按 owner + UID + 区服隔离；纯摘要个人快照；跨池满潜证据；
  公共 DTO 不泄漏私有字段；历史别名归一化扣减；读取失败时不输出半成品；跨分页（1001 条）聚合。
- `dataWorkbenchStatsCache.test.js`（1 项）：60 秒缓存命中后，补录编辑在同一 `history` 总行数下
  仍会在缓存到期后重新计算（补录 80 → 0）。
- `personalAnalysisWorker.test.js`（10 项）：无任何历史、仅补录账号也能构建 owner/scope 快照并进行
  别名归一化；既有分页/发布/失败码用例保持通过。
- `workbenchTransfer.test.js`（5 项）：站内 JSON 往返保留覆盖与来源、不泄漏私有字段、不伪造明细或四星；
  纯摘要账号可导出其引用池；部分日期区间不裁剪；同 UID 双区服隔离；重复身份与不支持版本被拒绝。
- `workbenchTransferService.test.js`（5 项）：跨传输重试复用同一幂等提交；命中已删除内容的旧提交不被
  当作成功；重复导入跳过、被修改条目阻断；每个作用域只读一次；请求批次不超过 100。
- `useDataExportImport.test.jsx`（6 项）：导出附带补录读取；仅补录也能确认导入并触发个人分析刷新；
  补录校验失败保留预览。

2. 静态检查：

```text
Set-Location -LiteralPath "D:\Learning\Endfield Gacha\gacha-analyzer"; npx --no-install eslint shared/dataWorkbenchMetrics.js shared/dataWorkbenchAnalytics.js api/_lib/dataWorkbenchAnalytics.js api/_lib/personalAnalysisWorker.js api/_lib/publicAnalytics.js src/utils/dataExport.js src/utils/dataImport.js src/services/workbenchTransferService.js src/services/statsService.js src/hooks/app/useDataExportImport.js src/hooks/summary/useSummaryViewState.js src/components/summary/WorkbenchMetricsPanel.jsx src/components/SummaryView.jsx src/mobile/views/MobileStatsView.jsx
```

结果：`exit_code 0`，无 error、无 warning（循环内 `await` 已按仓库约定注明原因）。

3. 既有导出/导入往返脚本：

```text
npm --prefix "D:\Learning\Endfield Gacha\gacha-analyzer" run test:export-import
```

结果：`BUG-030 export/import round-trip verification passed`（未回退官方/文件导入合同）。

4. 构建：

```text
npm --prefix "D:\Learning\Endfield Gacha\gacha-analyzer" run build
```

结果：`exit_code 0`；`vite build` 成功（3104 modules，17.28s），`lottery:build` 成功（4.78s）。

5. 变更空白检查：

```text
git -C "D:\Learning\Endfield Gacha\gacha-analyzer" diff --check -- <本次相关文件>
```

结果：`exit_code 0`，无空白错误。

6. 中间批次复跑：一次较早的批量运行中 `api/__tests__/rootStatsPoolCatalog.test.js`
   出现 1 个断言失败；随后以相同源码复跑该批次（含该文件）：

```text
npm --prefix "D:\Learning\Endfield Gacha\gacha-analyzer" run test:unit -- src/hooks/app/__tests__/useDataExportImport.test.jsx api/__tests__/personalAnalysisWorker.test.js src/utils/__tests__/personalAnalysisSnapshot.test.js src/hooks/summary/__tests__/useSummaryViewState.test.jsx src/services/__tests__/statsService.test.js api/__tests__/rootStatsPoolCatalog.test.js
```

结果：`Test Files 6 passed (6)`、`Tests 38 passed (38)`，该失败未再现。合并前仍建议跑一次
全量 `npm --prefix ... run test:unit` 确认无跨文件顺序问题。

## 三、历史交接缺口

以下是当时交接记录：第 1、2 项以及第 5 项的浏览器流程已解决；目标托管环境和当前主线集成仍需验收。当前状态见文件开头链接。

1. **补录保存未触发个人/全服统计失效（阻塞项，归属主代理保存链）。**
   当前检查到的迁移 190 与 `api/_routes/root/data-workbench.js` 的 commit/mutate 路径，没有把补录
   增删改写入 `personal_analysis_owner_states` / `personal_analysis_scope_states` 的 revision 或
   `dirty_since`，也未触发即时派发。消费端（Worker 读取、快照构建、公共聚合）已就绪，但没有触发
   时，保存后个人快照与全服结果仍停留在旧数据；这也是前端“保存成功、统计待刷新”语义能否兑现的
   前提。需在保存事务内补齐（触发器或 RPC 内），并验证删除同样触发。
2. **`coverage_time_unknown` 未进入预览阻断码集合（需主代理决策）。**
   `api/_lib/dataWorkbench.js` 的 `METRICS_BLOCKING_CODES` 决定哪些指标问题阻断提交。新增码目前
   不在其中：提交可成功，但该摘要在统计中被静默排除（不贡献补充数量/出率/区间资源）。请确认产品
   期望是“提交时阻断并提示补充时间”，还是“允许保存、仅在统计处标注未知”；若选前者，需把该码并入
   集合并补 `api/__tests__/dataWorkbench.test.js` 断言。
3. **公共补录口径是“已补录账号样本”。** 公共 API 输出 `scope: 'supplemented-accounts'`，出率分母
   只含补录账号范围内有匹配分母的抽数，没有混入旧 SQL 全体玩家分母，也不改 `byType` 的既有语义。
   面板已标注范围，但若要“全服直接合计补录”，需要产品确认口径并新增缓存/SQL 预聚合，属于后续阶段
   范围，本次未实现。
4. **完整补录往返仅支持站内 JSON。** CSV、`endfield_gacha_helper_*`、`endgacha_kwer_top_*` 等格式
   保持既有明细合同，不含 `supplements`；跨格式往返不会带补录。如需支持，应单独立项。
5. **未执行的验证：** 未在真实 Supabase 上应用迁移 190 并跑端到端；未运行双端浏览器（Playwright）
   保存/编辑/删除闭环；未运行全量 `npm test`。这些需要主代理在合并网关统一执行。

## 四、复跑与交接建议

- 合并前建议按顺序执行：针对性 10 文件测试 → `test:export-import` → 全量 `test:unit` →
  `npm run build`；如涉及保存链改动，再补迁移 190 的真实环境验证与双端浏览器闭环。
- 保存链修复后，建议新增一条集成断言：补录 commit 后 owner/scope revision 被标脏，Worker 运行后
  `owner.summary.workbench` 与公共 `workbench.supplemental` 反映新值；删除补录后同样回落。
