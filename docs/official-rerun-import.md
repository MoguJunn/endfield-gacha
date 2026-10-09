# 官方重构记录适配与部署

此适配随 PR #35 与角色正式归并 PR #39 发布。日历分类与期次维护见 [卡池时间管理](POOL_SCHEDULE_MANAGEMENT.md)。

## 数据合同

- 角色重构请求使用 `E_CharacterGachaPoolType_Rerun`，继续走 `/api/record/char`。完整导入共五类角色请求与一类武器请求。
- 武器重构仍在 `/api/record/weapon` 返回，通过逐条记录的 `poolType: "rerun"` 区分。
- `poolVersion` 是记录期次；官方界面将它拼成 `poolName#N`。数据库保存为 `history.pool_version`，不加入卡池身份或抽卡记录去重键。
- 同名、同重构规则的记录共用既有卡池。新官方 ID 映射为别名；角色与武器规则不会相互合并。临时池可通过现有原子归并函数转为正式 ID。
- 网站的规则分类继续使用 `extra` 与角色/武器重构 profiles；官方来源使用 `sourcePoolType` 独立保留。精确的历史 `joint_1_2_2` 继续保留特殊寻访规则。
- 累计寻访计数接口不是逐条记录，不参与记录导入。`gift_intel_book`、武库/军列赠礼事件继续排除。
- 旧记录没有期次时保持 NULL；重新获取官方记录后可以补齐，增量获取不会因这些记录已存在而提前跳过。

`history.pool_version` 是逐条官方历史的期次，用于统计分期；日历的 `extraSeriesPhase` 来自卡池后台 `extra_series_phase`，用于显示系列第 N 期。两者不能相互推测或覆盖。重构武器显示“重构申领”，不采用限定武器的三期规则。

## 数据库与后端部署

先验证并备份目标数据库，再依次执行迁移 194/195，部署各区私有后端，最后发布对应前端与站点 API。既有环境先核对迁移记录，避免重复处理已归并数据。

- `194_add_history_pool_version.sql`：期次列、正数约束、原子导入保存与读取；新建重构池保留四个规则字段。
- `195_reconcile_official_rerun_weapon_pool.sql`：复用迁移 183 已有的双产品归并函数，将“点绘申领”临时池归到线上实际观测的 `rerun_wpn_yvonne`。
- 归并后核对历史、阵容配置、临时别名、版本与首页绑定均保留，并指向正式 ID。
- 后端部署后检查 `/health`、容器健康状态、六组请求、期次归一化和完整导入模块加载。

私有 `backend/server.js` 不在公开仓库内；公开仓库提供共享请求合同及 `scripts/verify-official-gacha-server-contract.mjs` 验证入口。部署必须同时更新入口与 `shared/officialGachaRecordTypes.js`，不能只更新其中一个。

## 验证

- `node scripts/verify-supabase-baseline-smoke.mjs --history-pool-version` 在真实 PostgreSQL 中验证期次/非法值拒绝、重导、元数据、两类重构归并、历史/阵容/别名/版本/首页绑定保留，以及迁移重复执行。已加入 CI。
- 同时核对导出导入往返、官方 ID 解析及归并后的目录读取。定向迁移验证不能代替完整空库 baseline 验证。
- 新期次列不会凭空补齐旧记录；需要用户正常重新导入官方历史。公开合同和模块加载检查不能代替实际认证导入验证。

## 回退要求

部署前保存可读取的数据库备份、代码包和镜像。回退运行时可恢复旧代码包并重建，或使用旧镜像。新增的 nullable 期次列兼容旧服务，应保留；不要为回退代码直接覆盖整个生产数据库，以免丢失备份后正常导入的记录。

## 正式 ID 归并与分析 Worker 同步

若官方 ID 已写入别名但目录归并失败，应在确认映射后使用原子归并。迁移 198 针对 `rerun_chr_yvonne` 补做此操作，保留历史与阵容关系，临时 ID 通过别名继续解析。

定时个人分析任务固定指向旧部署时，漏读四个 `extra_*` 字段可能导致重构 UP 被显示为偏移，即使数据库已有 `is_standard=false`。修正时将 Vault 中的 `personal_analysis_worker_url` 指向包含新规则的不可变部署入口，再标记受影响依赖失效并调度重建。核对重建快照中的 profile、目标六星 `stageKind=up` 和非目标六星分类，不以历史任务成功次数推定当前队列状态。

“点绘申领”的正式 ID 为 `rerun_wpn_yvonne`；`weponbox_1_0_2` 是“绘涂申领”，有独立官方身份、历史阵容与普通武器规则，不能因 UP 同为艺术暴君就归并到重构池。

后续发布涉及 `personalAnalysisWorker`、快照 schema 或卡池能力时，需要同步核对数据库定时任务指向的固定部署，重建受影响快照并核验实际 `poolManifest.extra_rule_profile` 和时间线 `stageKind`；仅确认主站部署完成不能证明定时任务已使用新代码。
