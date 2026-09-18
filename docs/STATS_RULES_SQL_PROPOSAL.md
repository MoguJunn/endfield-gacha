# 统计口径统一：服务端 SQL 迁移提案（STATS-007A）

> 状态：提案，**未执行**。生产应用需要单独授权。
> 前端规则层已统一（`src/utils/gachaRuleContracts.js`），本文档给出让全服统计与个人统计口径收敛所需的服务端变更。

## 背景

前端六个统计面已统一到同一规则合同：

- 硬保底强制 UP（吃井）：限定角色池第 120 付费抽；武器池第 8 次申领（第 71~80 付费抽）。按期（目标作用域）判定，每期最多一次，首个目标命中后本期判定结束。
- 不歪率：分子分母同时剔除吃井命中（真 50/50 口径）。
- 免费抽 / 赠送抽：不计入付费抽数与保底累计；免费字段统一识别 `isFree / is_free / isFreePull / is_free_pull`。
- 「平均出货」：统一为 total/count。

服务端统计函数仍是旧口径，导致「全服数据」与「我的数据」同名指标不一致。本提案收敛这些差异。

## 变更 1：真不歪率（剔除硬保底强制 UP）

目标函数（以 baseline 最后定义为准，**用前向迁移 + CREATE OR REPLACE 覆盖，不直接改 baseline**）：

- `get_character_ranking_stats()` 及 `get_character_ranking_stats_cached(INT)`
- `get_user_ranking_stats(p_user_id)` 及 `get_user_ranking_stats_cached`（现行为 migration 168 的简化版，无 up/off 分组，需一并补齐）

要点（相对旧 PR #9 草案的修正）：

1. `history_with_info` 增补 `h.user_id, h.game_uid, h.server_scope, h.seq_id`。
2. 分区键必须包含 `server_scope`：`PARTITION BY user_id, game_uid, server_scope, pool_id`（`history` 唯一键自 migration 147 起含 `server_scope`；旧草案漏掉会串区服）。`game_uid` 可空时需 `COALESCE` 兜底。
3. 新增 CTE：
   - `pulls_with_cum`：按分区 `ORDER BY seq_id` 累计非免费抽数（`is_free` 不计）；
   - `up_six_ranked`：每期内目标 UP 6★ 按序编号；
   - `forced_up`：`up_seq = 1 AND cum_pull >= CASE pool_type WHEN 'limited' THEN 120 WHEN 'weapon' THEN 71 ELSE 2147483647 END`。
   - 武器 floor 是 **71**（第 8 次申领覆盖 71~80），不是 80。
4. `limited_six_counts` / `weapon_six_counts` 增加 `spark_count` 与 `up_excluding_spark`；JSON 输出新增 `sixStarUpExcludingSpark` 与 `sparkCount`（保留既有字段不删）。
5. 武器桶补齐 `excluding_free` 系列计数（当前只有角色桶有）。

前端配套（字段就位后再改）：`LimitedUpAnalysisStrip` 的 `upCount` 改用 `sixStarUpExcludingSpark ?? sixStarUpCount`，不歪率 = `upExclSpark / (upExclSpark + offCount)`，吃井次数读 `sparkCount`。

## 变更 2：「平均出货」收敛为 total/count

`get_global_stats` 及各 per-type 平均当前是区间均值（`AVG(rn - prev_rn)` / `AVG(pity)`），与前端统一后的 total/count 不一致。

- 将「平均出货」族改为 `范围内有效总抽数 / 6★ 数`（NULLIF 防除零）。
- `pityStats` 分布的 min/max/avg 属于分布描述统计，保持区间口径并在元数据中标注，不属于本变更。

## 变更 3：缓存版本化

- `get_global_stats_cached` 的缓存 key 从 `global_stats:v5` 升到 `v6`（字段新增 + 口径变化，不能静默复用旧缓存）。
- `user_ranking:v2:*` 升到 `v3`。
- 旧 key 保留到期自然失效；前端读取侧按新 key 请求。

## 变更 4：个人分析快照口径重算

个人分析快照（schema v2，`owner.summary` / `views[*]`）由 Worker 用共享前端规则计算。本次规则层变化会改变既有快照的**数值**（不歪率、平均出货、sparkCount、avgPity 系列），schema 形状未变。

- 需要一次存量重排队（参考 migration 187 的做法），否则用户在新部署后仍看到旧口径快照，直到下次自然重建。
- 重排队只更新派生数据，不改用户原始记录；执行前需备份并按既有流程小批验证。

## 不在本次范围

- 分卡池全服图表所需的按 `pool_id`（× 角色 × 首获）聚合：属于 STATS-007 全服侧扩展，待个人侧分池形态验收后另行提案。
- 「首次/非首次获得」服务端判定：需要 `is_new` 进入统计函数与首现派生兜底，随 STATS-007 一并设计。

## 验证要求（应用前）

- 本地 PostgreSQL 空库全量迁移链执行通过；
- 用含 120 抽吃井、武器 71~79 强制 UP、免费十连、分期系列、多区服账号的合成数据做前后对照；
- `EXPLAIN` 确认窗口函数分区无全表放大；缓存刷新路径验证。
