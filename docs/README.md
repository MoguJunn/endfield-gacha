# 文档导航

第一次使用请从[项目首页](../README.md)开始；准备参与开发时阅读[贡献指南](../CONTRIBUTING.md)。这里按阅读目的整理专题。

## 使用与项目进展

- [项目进展](RECENT_DELIVERY_STATUS.md)：可用功能、已知限制与开发方向。
- [统计指标](STATS_OBSERVATION_CONTRACT.md)：单池／合池、首次样本、账号覆盖与未知数据的解释。
- [卡池与日历时间](POOL_SCHEDULE_MANAGEMENT.md)：武器池关联、重构期次、官方日期与缓存传播。
- [桌面界面](DESKTOP_HOME_DEMO.md)：新版／经典主页、导航、消息与响应式布局。
- [首次指南设计](ONBOARDING_GUIDE_PLAN.md)、[移动首页设计](MOBILE_HOME_PLAN.md)：尚未完成的交互方案与验收要求。
- [账号分析范围](ACCOUNT_ALL_CLOSEOUT.md)：同账号总览、跨账号限制与原始记录导出。

## 开发与架构

- [开发与部署指南](PROJECT_GUIDE.md)：环境、命令及部署顺序。
- [代码地图](CODEMAP.md)、[架构](ARCHITECTURE.md)：定位模块，理解数据流与权限边界。
- [仓库结构](REPOSITORY_LAYOUT.md)、[Git 工作流](GIT_WORKFLOW.md)：文件职责、生成物及贡献流程。
- [认证与会话](AUTH_SECURITY_HARDENING.md)：身份归属、邮箱验证、凭据撤销与 provider 集成。
- [浏览器认证锁](SUPABASE_AUTH_LOCK_FIX.md)：后台刷新与 SDK 升级验证。
- [个人分析 Worker](PERSONAL_ANALYSIS_WORKER.md)、[统计快照调度](STATISTICS_SCHEDULING.md)：异步计算、部署与诊断。
- [数据与体验待完善项](CLOSEOUT_LEDGER.md)：可贡献的工作和现行数据审计工具。

## API 与官方数据

- [开发者 API：中文](developer-api-v1.zh-CN.md) / [English](developer-api-v1.en-US.md)。
- [绑定与官方 BOT API](integration-api.md)：私有查询范围及平台身份验证。
- [重构导入](official-rerun-import.md)、[赠送记录处理](OFFICIAL_TRUST_TOKEN_FIX.md)：官方数据规范化与统计约束。

## 数据库与运营部署

- [数据库指南](../supabase/README.md)：baseline、前向迁移、手动修复与回滚。
- [邮件架构](SELF_HOSTED_MAIL.md)、[Stalwart 部署](STALWART_DEPLOYMENT_GUIDE.md)：发信开关、队列、防刷和邮件服务器配置。
- [抽奖运营](SUMMER_LOTTERY_OPERATIONS.md)：资格、开奖、公示、履约与联系信息保护。
- [发布检查](RELEASE_CHECKLIST.md)：按修改范围选择验证与部署检查。

## 发布记录

- [v4.6.4](RELEASE_4.6.4.md)：仓库／文档整理、本地统计与沙盒修复、验证及发布准备。
- [v4.6.3](RELEASE_4.6.3.md)：官方版本导览、管理与后续日程维护。
- [v4.6.2](RELEASE_4.6.2.md)：统计快照、五类合池、十图与桌面宽度。
- [v4.6.0](RELEASE_4.6.0.md)：默认新版桌面与经典主页切换。

发布记录保存对应版本的变化与验证；配置与运行要求以现行专题为准。截图位于 `docs/screenshots/`，游戏图片、字体及许可证按各资源目录维护。
