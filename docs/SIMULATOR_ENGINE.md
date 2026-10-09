# 模拟器引擎与继承合同

v4.6.4 使用共享 JavaScript 引擎，桌面界面及分享入口保持原有形式；移动端仍引导使用桌面模拟器。

## 状态与抽取

`shared/simulator/engine.js` 提供 `applyCommand(session, command, context)`，返回 `{ session, events }`。调用方注入规范化阵容、随机源和时间，核心不读取浏览器存储、网络或 React。

会话版本为 2，按站点用户及完整游戏账号／区服键隔离。普通限定的五星／六星水位只存在 `sharedPityState`；重构按 `profile + seriesKey` 共享指定进度；各池保存自己的抽数、目标保障或申领计数。初始化、切池、继承和刷新统一通过 `getPoolState()` 装配，零抽池也能取得正确的共享水位。

卡池能力由 `src/utils/poolCapabilities.js` 解析。限定角色的 120 抽目标保障仅一次，武器一次申领十件；重构角色共享水位／目标／奖励，重构武器仅共享目标／奖励，六星水位按期独立。显式常驻武器没有 UP 目标或限定赠送；未知附加规则和缺失系列标识禁止抽取。

## 记录与资源

`records.js` 统一识别普通抽取、免费抽、情报书和赠送。免费抽不推进普通／目标保底及奖励进度；情报书推进保底及奖励、不扣嵌金玉；赠送不推进抽数。记录保留独立展示序号、批次及抽取前水位，保底分布不再从混合免费记录的编号差推断。

资源与持有数在追加结果时增量累计。读取账本不遍历所有池历史；角色出货产生武库配额，武器申领消耗配额，源石转换、有限／无限资源保持既有数值。统计展示继续按各指标口径区分有效抽数与全部历史条数。

## 继承快照

个人分析快照 schema 为 3，继承合同为 2。Worker 使用完整可见目录及当前用户个人池确定作用域和情报书相邻目标；归一化、排序后按时间线累积。快照保存必要状态和完整紧凑历史，免费、情报书及赠送标记保留。

```mermaid
flowchart LR
  History[账号历史与完整目录] --> Worker[个人分析 Worker]
  Worker --> Snapshot[schema 3 继承快照]
  Snapshot --> Api[同源专用读取]
  Api --> Session[本地会话与历史]
  Session --> Command[共享引擎命令]
  Command --> Transaction[IndexedDB 事务提交]
  Transaction --> View[界面、统计与导出]
```

`GET /api/account-gacha-data?mode=simulator-inheritance&accountKey=…` 沿用现有鉴权，只有账号、来源区服、契约与修订匹配才返回 `ready`。构建中返回 202，不能用旧水位覆盖存档；该读取不扫描原始历史。普通 `mode=analysis` 不附带完整继承历史。

历史编码使用实体字典与列式行，客户端还原后冻结继承基线，再追加模拟结果。目录指纹用于检查快照与当前目录是否一致，不承担鉴权。JSON／CSV 导出保留真实池、免费／情报书标记、赠送类型与序号。

## 存储与兼容

`simulatorRepository.js` 使用 IndexedDB 的会话和历史两个 store。写入先检查修订号，状态与历史在同一事务保存；竞争或写入失败时整笔回滚，界面不会宣称成功。刷新可继续模拟，其他账号的存档不受覆盖或重置影响。

已知 localStorage 存档由 `simulatorLegacyMigration.js` 读取并迁移，原键保留；未知版本阻止迁移并提示，不静默删除。无作用域的旧存档仅归游客，不自动分配给首个登录账号。偏好仍在 localStorage。

旧 `GachaSimulator` 和 `probabilityEngine` 的公开模拟函数保留薄适配；实际抽取统一交给共享引擎，构造器不再启动角色网络加载。全服统计的概率函数及现有测试入口继续使用。

## 验证与部署

```bash
npm run test:unit
npm test
npm run test:simulator-v2:ui   # 已启动的 Vite DEV 内容沙盒，默认 5174
npm run test:simulator-v2:sql  # 全新一次性本地 PostgreSQL 容器
node scripts/benchmark-simulator.mjs
```

浏览器验证只使用独立测试上下文及演示身份，真实目录 GET 可联网；不执行私有 API、官方导入或生产写入。SQL 验证默认 Docker，也可显式设置 `SIMULATOR_PG_BIN` 指向本机 PostgreSQL bin；两条路径都创建全新实例并在结束后停止，不能指向已有数据库。

已有数据库部署前需应用 `2026100901_simulator_inheritance_v2.sql`，由 schema 3 Worker 重建个人快照；新环境使用包含 194 迁移的完整 baseline。迁移保留旧快照、ACL、来源与租约，通过修订失效避免旧作业发布。先在隔离环境验证，正式执行及 Worker／主站切换按发布流程操作。代码合入不表示生产已应用迁移，构建中继承暂不可用。
