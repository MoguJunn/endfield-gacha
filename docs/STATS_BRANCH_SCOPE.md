# 统计与指南维护入口

原 `feat/banner-stats-and-guide` 已随 PR #37 发布。分支提交、首次隔离范围、交付与验证统一收口到 [v4.6.2 发布记录](RELEASE_4.6.2.md)，本页保留旧链接的入口，不再重复维护阶段测试数字与文件清单。

## 当前维护

- [统计观测合同](STATS_OBSERVATION_CONTRACT.md)：单池／合池、固定本期首次、覆盖与未知成本口径。
- [统计调度](STATISTICS_SCHEDULING.md)：持久快照、Worker、部署顺序与只读预览。
- [代码地图](CODEMAP.md)：算法、API、工作区与验证脚本的实际入口。
- [首次指南计划](ONBOARDING_GUIDE_PLAN.md)：`/statistics-preview.html` 仍仅供 Vite DEV，真实登录／导入／备份与完成状态尚未接入。
- [近期状态](RECENT_DELIVERY_STATUS.md)：已上线统计、未实施重复修正、独立数据工作台和导出任务的当前边界。

主站当前 main 已在源目录维护，旧分支与混合候选只作历史追溯。数据工作台集成须合并现行 `SummaryView`、Stats API 和数据库合同，不用旧分支整体覆盖。
