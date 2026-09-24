# 官方重构记录适配与部署记录

## 数据合同

- 角色重构请求使用 `E_CharacterGachaPoolType_Rerun`，继续走 `/api/record/char`。完整导入共五类角色请求与一类武器请求。
- 武器重构仍在 `/api/record/weapon` 返回，通过逐条记录的 `poolType: "rerun"` 区分。
- `poolVersion` 是记录期次；官方界面将它拼成 `poolName#N`。数据库保存为 `history.pool_version`，不加入卡池身份或抽卡记录去重键。
- 同名、同重构规则的记录共用既有卡池。新官方 ID 映射为别名；角色与武器规则不会相互合并。临时池可通过现有原子归并函数转为正式 ID。
- 网站的规则分类继续使用 `extra` 与角色/武器重构 profiles；官方来源使用 `sourcePoolType` 独立保留。精确的历史 `joint_1_2_2` 继续保留特殊寻访规则。
- 累计寻访计数接口不是逐条记录，不参与本次导入。`gift_intel_book`、武库/军列赠礼事件继续排除。
- 旧记录没有期次时保持 NULL；重新获取官方记录后可以补齐，增量获取不会因这些记录已存在而提前跳过。

## 2026-09-24 部署结果

已先完成验证，再执行共享数据库迁移 194/195，并依次部署国际服与国服私有后端。前端及站点 API 改动通过 PR 审阅发布，此次不合并 PR。

- `194_add_history_pool_version.sql`：期次列、正数约束、原子导入保存与读取；新建重构池保留四个规则字段。
- `195_reconcile_official_rerun_weapon_pool.sql`：复用迁移 183 已有的双产品归并函数，将“点绘申领”临时池归到线上实际观测的 `rerun_wpn_yvonne`。
- 归并后核验：120 条既有历史完整保留，38 条阵容配置归到正式池，临时别名及 version-6 绑定均指向正式 ID。
- 两服 `/health` 正常，Docker 健康状态均为 `healthy`。容器内确认六组请求、期次归一化以及完整导入模块可加载。
- 后端包版本仍为 1.6.7，本次部署通过内容校验值识别。两服入口 `server.js` SHA256：`3fa4502498b38bf8469a1e0fc76268b291f591db399e1b7bac500254495b8268`；`fullImportService.js` SHA256：`6c89e14cceb57772e6249e08aa34728d8cf5ac02122b79125644cf5977f2d7f0`。

私有 `backend/server.js` 不在公开仓库内，已按现有部署边界更新；公开分支保存共享请求合同及 `scripts/verify-official-gacha-server-contract.mjs` 验证入口。部署必须同时更新入口与 `shared/officialGachaRecordTypes.js`，不能只更新其中一个。

## 验证

- 完整单测：262 文件、1437 项通过；最后的导入 ID 检查另通过 31 项定向回归。
- 项目 lint、生产构建、基线内容一致性及导出导入往返通过。
- `node scripts/verify-supabase-baseline-smoke.mjs --history-pool-version` 在真实 PostgreSQL 中验证期次/非法值拒绝、重导、元数据、两类重构归并、历史/阵容/别名/版本/首页绑定保留，以及迁移重复执行。已加入 CI。
- 定向 SQL 验证使用截至 189 的真实业务 schema 加 194/195；完整空库验证在已有 190 迁移处因缺少 `summer_lottery_campaigns` 受阻。因此不声称完整空库基线通过。
- 已核实官方公开脚本合同及线上已有武器池，但本次未使用玩家 token 执行部署后的官方认证导入。线上此前的 120 条记录期次仍为空，等待正常重新导入补齐。

## 回退信息

部署前两服分别保留 `/root/rerun-20260924-backup-cn/runtime.tar.gz` 与 `/root/rerun-20260924-backup-intl/runtime.tar.gz`，旧镜像标签为 `endfield-rerun-rollback:cn-20260924` / `endfield-rerun-rollback:intl-20260924`。共享数据库备份保留在国际服备份目录的 `database.dump`，已验证备份目录可读取。

回退运行时可恢复旧代码包并重建，或使用旧镜像。新增的 nullable 期次列兼容旧服务，应保留；不要为回退代码直接覆盖整个生产数据库，以免丢失备份后正常导入的记录。

## 2026-09-24 角色正式 ID 与分析任务修复

实际导入已提供 `rerun_chr_yvonne`，但后续目录归并因先前统计触发器超时失败，只留下指向角色临时池的官方别名。迁移 198 在确认该官方别名存在后补做原子归并。线上迁移后 275 条历史、20 条阵容关系保留，角色池改为正式 ID；临时 ID 通过别名继续解析。

“伊冯”和“艺术暴君”被显示为歪的原因是定时个人分析任务固定指向旧部署。旧部署的目录查询漏读四个 `extra_*` 字段，即使数据库 `is_standard=false`，生成快照时也会因规则未识别而改成歪。此次将 Vault 中的 `personal_analysis_worker_url` 切换到已验证生产提交 `8884cabe` 对应的固定部署入口，仅更新地址，认证配置保持不变。随后标记两类重构池依赖失效并调度重建。

线上确认：工作任务返回 HTTP 200、8 个任务成功、0 失败；重建后的 4 份角色池目录与 3 份武器池目录均包含正确 profile。时间线中“艺术暴君，附带 8 次五星”和“伊冯，附带 8 次五星”均为 `stageKind=up`，非目标六星仍正确显示偏移。

管理目录中当前“点绘申领”仅有 `rerun_wpn_yvonne` 一项；`weponbox_1_0_2` 是 2–4 月的“绘涂申领”，有独立官方身份、历史阵容与普通武器规则，不能因 UP 同为艺术暴君就归并到重构池。

后续发布涉及 `personalAnalysisWorker`、快照 schema 或卡池能力时，需要同步核对数据库定时任务指向的固定部署，重建受影响快照并核验实际 `poolManifest.extra_rule_profile` 和时间线 `stageKind`；仅确认主站部署完成不能证明定时任务已使用新代码。
