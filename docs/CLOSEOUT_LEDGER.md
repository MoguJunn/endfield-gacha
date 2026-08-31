# 半收口功能清理总账

本文件追踪已经进入主链或接近主链，但仍依赖 placeholder、fallback、隐藏入口或不完整审核链路的功能。它不重新打开已完成归档任务，只记录当前代码证据、目标收口状态和后续实现归属。

## 状态口径

- `保留`：当前 fallback 是明确的长期产品选择，需要写清楚原因和验证边界。
- `完成`：功能具备真实实现、测试或运行证据，并且用户侧 / 管理侧闭环成立。
- `退役`：删除入口、文案、兼容字段或过渡路径。
- `拆分`：范围过大，必须拆成更小的实现任务。

## 收口地图

| 范围 | 当前证据 | 收口目标 | 归属任务 |
| --- | --- | --- | --- |
| 个人分析快照 | owner/account revision、持久快照、活跃用户 FIFO、`pg_cron + pg_net` 即时派发、45 秒多批 Worker、渐进检查与同 owner Session 保护已由 PR #23–#25 合入并完成生产 E2E；含冒号 viewKey 已有回归测试和生产 HTTP 200 证据。 | `完成`。后续只做 dispatch / HTTP 2xx 和生产 Web Vitals 低频观察；出现具体回归再拆 BUG，不重新打开旧 PERF 候选。 | `PERF-013 / UX-FLOW-001 / PROD-OBS-001` |
| 附加寻访子类型 | migrations 181–183、管理写入、官方导入、版本绑定、个人分析、模拟器和桌面 / 移动展示均区分 `reconstruction`、`reconstruction_claim`、`special`；生产最终字段、约束、触发器、受限晋升 RPC、种子卡池与绑定已只读核验。 | `完成`。保留 `type=extra` 作为粗粒度兼容；未来增加新规则模板时必须扩展统一 capability / profile 合同，不能只按 ID 前缀猜测。 | `EXTRA-POOL-SUBTYPE-001 / PROD-OBS-001` |
| 官方 ID 回填 | `src/utils/canonicalEntityUtils.js` 仍将 `char_manual_*`、`weapon_manual_*` 和 `*_manual_*` 卡池 ID 归类为 `manual_placeholder`；admin 卡池测试仍创建 `special_manual_*` alias。 | 先提供非破坏性审计，再把 placeholder 映射到官方 ID，保留 alias，更新外键，校验导出兼容，并产出回滚报告。 | `DATA-NEW-017` |
| 公共卡池分析 | 已新增 `public_pool_analytics_cache` / `public_pool_trend_cache` 与 `refresh_public_analytics_cache()`；`api/_lib/publicAnalytics.js` 优先读取预聚合缓存，单池指标和趋势点都带 `analyticsMeta.partial / cacheKey / cacheVersion / warning`。缺表或缺行时，趋势端点返回空 `points`，单池端点只降级为 bounded count。 | 后续补生产迁移应用、真实 refresh 耗时观测、长期 source/meta 看板，以及更多安全 admin/ops 写入点接线；继续避免请求期扫描原始 history。 | `API-003 / STATS-004` |
| 开发者 API 审核 | admin 路由支持 `reviewNote`，设置页展示 `review_note`；`DeveloperApiPanel.jsx` 审核、拒绝、撤销和重新启用时会提示填写备注。审核结果通知已能在 `DEVELOPER_API_REVIEW_MAIL_OUTBOX_ENABLED=true` 且 `MAIL_OUTBOX_WORKER_ENABLED=true` 时写入邮件 outbox，且邮件入队失败不会阻断审核。 | 后续补用户设置页更明确的下一步动作、历史审核记录、管理员风险提示和更完整责任链；邮件真实投递仍受队列处理器、演练模式、紧急停发开关和投递监控保护。 | `DEVAPI-004` |
| 工单闭环 | 桌面和移动工单已支持创建、回复和状态变更；回复写入已从前端直连 Supabase 改为同源 `/api/tickets/reply`，服务端校验 owner / admin / super_admin 权限，staff 回复可在 `TICKET_REPLY_MAIL_OUTBOX_ENABLED=true` 且 `MAIL_OUTBOX_WORKER_ENABLED=true` 时写入 `ticket.reply` outbox。schema 有 `is_internal`，但 UI 还没有完整未读、内部备注、最后回复人和管理员待处理队列。 | 补齐未读状态、最后回复人、内部备注、管理员队列、移动端失败反馈和私有数据边界；真实邮件投递仍必须经过队列处理器、演练模式、紧急停发开关、预算和投递监控。 | `SUPPORT-001` |
| 移动模拟器 | `src/mobile/views/MobileSimulatorView.jsx` 仍只是切换到桌面端的提示页。 | 明确选择轻量移动模拟器或规划型只读模式，至少能查看目标、预算和继承状态，不能长期只保留跳转提示。 | `MOBILE-004 / SIM-005` |
| 全部账号汇总 | `docs/ACCOUNT_ALL_CLOSEOUT.md` 已明确保留同账号“全部卡池总览”和显式“所有账号记录”导出；分析入口通过有效账号回退关闭未选账号时的隐式跨账号合并。 | 若重新开放，先定义跨账号指标、桌面 / 移动 / 分享 / 导出口径；短期内继续避免把“全部账号”作为分析视图展示。 | `ACCOUNT-ALL-001` |
| 小游戏平台 | 小游戏站（`endfield-games`）已独立闭环：邮箱+密码直连自建 Supabase 登录（不再使用 SSO ticket），`game_*` 表与 `apply_game_currency_delta` RPC 由迁移 `140`-`143` 建于自建实例；钱包流水、每日挑战、拼图制作/游玩与折金票奖励结算均在小游戏站内完成。主站侧仅保留拼图验证码所用的同源 `/api/puzzles` 与共享 `puzzles` 题库，二者共用同一张表。 | 维持主站验证码与小游戏站共享 `puzzles` 题库；新增玩法（UNO / 挖矿 / 放置）在小游戏站继续扩展，与主站解耦。 | `GAMES-001 / GAMES-002` |
| 首页路线图 | 路线图已读取 `site_config.home_roadmap_items`，并能规避旧 `virtual-scroll` 默认项；但 fallback 默认值仍在代码和 i18n 中重复任务状态。 | 从 site config 或受维护的发布 / 任务状态源生成路线图，避免每次 todo 重排后再次漂移。 | `ROADMAP-001` |
| 平台绑定 | 绑定接口和设置页入口已存在；root `todo` 仍要求 Discord / Telegram / QQ 实测、解绑后 BOT 查询失效、RLS 直连拒绝和公开输出隐私校验。 | 三个平台逐项完成真实验证和隐私检查后，才把绑定链路视为完成。 | `PROFILE-001` |
| 导入恢复 | 官方导入已支持 Token / JSON 解析、剪贴板读取、同一 Token 重试、CN / INTL 互换、文件导入 30 分钟 `sessionStorage` 草稿恢复，以及可复制脱敏诊断；后端增量模式已加入保守 early-stop 守卫。导入完成后现在会生成统一的结果摘要：显示新增 / 重复 / 卡池变化、遮罩后的账号、同步状态、最后记录时间，并在 toast / 持久通知里提供“查看已导入数据”入口。 | 本地导入后结果详情切片已完成；后续仍需生产官方导入实测、更多池级差异明细页面，以及别名迁移后 raw pool id 与 canonical pool id 不一致时的增量回退观测。 | `IMPORT-UX-001` |

## 收口规则

1. 隐藏 UI 不等于完成。隐藏状态必须明确为 `保留`、`退役` 或带日期的后续任务。
2. 兼容 alias 和 fallback 字段可以保留，但必须写清保留原因，并有测试覆盖。
3. placeholder API 字段存在期间必须带 source / meta 说明，并有迁移到真实值或正式废弃的路径。
4. 管理员审核、撤销和回滚动作必须留下可追责原因。
5. 公共、私有和 admin 数据边界要分别验证；admin UI 成功不等于公开隐私边界安全。

## DATA-NEW-017 审计入口

手动主键退场的第一阶段只做非破坏性审计，不直接写库，也不生成可执行迁移 SQL。运行：

```bash
npm run audit:canonical-data:supabase -- --write-json supabase/manual/data-backfill/manual-placeholder-audit.json
npm run test:manual-placeholder-audit
```

JSON 报告中的 `manualPlaceholderRetirement` 会列出 `char_manual_*`、`weapon_manual_*`、`special_manual_*`、`joint_manual_*`、`weaponbox_manual_*` 等 placeholder 的 alias 目标、引用计数和退场状态。`ready_to_merge` 只能说明已有唯一非手动 canonical target；真正迁移前仍必须生成可回滚计划，覆盖 alias 保留、`history`、`pool_characters`、`featured_characters` 和导出兼容校验。

`DATA-NEW-018` 生产前复核优先使用轻量快照命令。它不拉取整张 `history`，只读取角色、卡池、alias、卡池阵容，并对 placeholder 逐项做引用计数查询，适合版本更新前快速确认是否有可迁移项：

```bash
npm run audit:manual-placeholder:production-snapshot -- --write-json supabase/manual/data-backfill/manual-placeholder-production-snapshot.generated.json
npm run generate:manual-placeholder-candidate-plan -- --audit supabase/manual/data-backfill/manual-placeholder-production-snapshot.generated.json --out supabase/manual/data-backfill/manual-placeholder-production-candidate-plan.generated.json
npm run generate:manual-placeholder-migration-plan -- --audit supabase/manual/data-backfill/manual-placeholder-production-snapshot.generated.json --out supabase/manual/data-backfill/manual-placeholder-production-migration-plan.generated.json
npm run test:manual-placeholder-candidate-plan
```

2026-06-03 21:10:49 的轻量生产快照显示：角色 / 武器 placeholder 6 个、卡池 placeholder 4 个，全部仍为 `needs_official_id`，可迁移项为 0。因此当前不能执行真实生产回填；下一步必须等待官方 ID 或由管理员人工提供 placeholder -> canonical ID 映射，并重新生成审阅计划。

补充阶段增加官方 ID 候选审阅计划，解决“当前 alias 尚未写入 canonical target，但导入或同步数据里可能已经出现同名官方 ID”的情况。审阅计划会读取轻量快照中的角色、卡池和 alias 源行，按 alias、同名角色 / 武器、同类型 UP 与开始日期匹配出候选，但只输出 `review_only` JSON，不写库、不生成执行 SQL。管理员确认唯一目标后，应先写入 alias，再重新生成正式迁移计划。

第二阶段增加演练迁移规划器，仍然不写库。它只读取审计 JSON 中的 `manualPlaceholderRetirement`，为 `ready_to_merge` 生成影响表、引用更新、alias 保留、执行顺序和回滚快照要求；`conflicting_alias_targets`、`manual_target_only`、`needs_official_id` 会被明确列入 blocked，不会生成自动迁移操作：

```bash
npm run generate:manual-placeholder-migration-plan -- --audit supabase/manual/data-backfill/manual-placeholder-audit.json --out supabase/manual/data-backfill/manual-placeholder-migration-plan.generated.json
npm run test:manual-placeholder-migration-plan
```

该 JSON 计划的 `writesDatabase` 必须恒为 `false`。真正 apply 前仍需要最新生产审计、人工审核、数据库快照和单独的受控 SQL / RPC 实现。

第三阶段增加受控执行 SQL 审核工件生成器。它只读取第二阶段演练计划中的 `status: "ready"` 项，blocked 项不会进入实际 `UPDATE`；SQL 内含人工确认 token、source / target / alias guard、引用归零检查、公共缓存刷新尝试，并默认以 `ROLLBACK` 结束。首版不会删除源 placeholder 主记录，只迁移 `history`、`pool_characters`、`pools.featured_characters` 引用并保留旧 ID alias：

```bash
npm run generate:manual-placeholder-apply-sql -- supabase/manual/data-backfill/manual-placeholder-migration-plan.generated.json supabase/manual/data-backfill/manual-placeholder-apply.generated.sql
npm run test:manual-placeholder-apply-sql
```

该 SQL 是审阅 / 演练工件，不会被脚本自动执行。真正应用前仍需重新拉取生产审计、保存数据库快照、管理员确认变更窗口，并人工把结尾 `ROLLBACK` 改为 `COMMIT`。

## 下一批实现顺序

除非用户重新调整优先级，后续按以下顺序推进：

1. `DATA-NEW-017`：新增非破坏性 placeholder ID 审计和迁移就绪报告。
2. `API-003 / STATS-004`：继续补生产迁移应用、刷新耗时观测和更多写入点的统计刷新验收。
3. `DEVAPI-004` 和 `SUPPORT-001`：先关闭管理员决策链路，再接入持久通知。
4. `MOBILE-004 / SIM-005`：替换或移除仍可见的 fallback 体验。
5. `ACCOUNT-ALL-001`：如需重新开放跨账号汇总，先按 `docs/ACCOUNT_ALL_CLOSEOUT.md` 补指标契约。
