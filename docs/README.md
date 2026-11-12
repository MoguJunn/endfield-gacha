# 文档导航

第一次使用请从[项目首页](../README.md)开始；准备参与开发时阅读[贡献指南](../CONTRIBUTING.md)。这里按阅读目的整理专题。

当前版本为 **v4.7.1 / Build 2026.11.07**，扫码导入、读取完整性与发布顺序见 [发布记录](RELEASE_4.7.1.md)。

现行说明核对至 `85e1ca87`（2026-11-08）：包含 v4.7.1、手机新版首页、自托管入口、本期抽奖及登录延续。当前状态见 [项目进展](RECENT_DELIVERY_STATUS.md)；版本记录和生产执行记录保留各自当时的验证范围，不能据此推定服务实时健康。

## 使用与项目进展

- [项目进展](RECENT_DELIVERY_STATUS.md)：可用功能、已知限制与开发方向。
- [官方导入与扫码](OFFICIAL_IMPORT.md)：站内登录、扫码／Token、账号区服、任务进度与失败恢复。
- [第三方历史记录迁入](RESCUE_FILE_IMPORT.md)：endgacha.kwer.top、小助手高星 Excel 与离愁轩 Wiki 的格式和资料边界。
- [文件导入、去重与失败恢复](FILE_IMPORT_RELIABILITY.md)：服务器保存进度、跨格式逐条匹配、草稿有效期、手机弹窗与删除入口。
- [统计指标](STATS_OBSERVATION_CONTRACT.md)：单池／合池、首次样本、账号覆盖与未知数据的解释。
- [个人手气与高光](PERSONAL_LUCK.md)：评价分档、最近三个版本、奖励跳号与后台快照更新。
- [卡池与日历时间](POOL_SCHEDULE_MANAGEMENT.md)：武器池关联、重构期次、官方日期与缓存传播。
- [桌面界面](DESKTOP_HOME_DEMO.md)：新版／经典主页、导航、消息与响应式布局。
- [移动首页](MOBILE_HOME_PLAN.md)：已发布的共享首页入口、验证范围及后续工作。
- [首次指南设计](ONBOARDING_GUIDE_PLAN.md)：尚待连接真实业务的交互方案与验收要求。
- [账号分析范围](ACCOUNT_ALL_CLOSEOUT.md)：同账号总览、跨账号限制与原始记录导出。
- [模拟器使用与存档](SIMULATOR_ENGINE.md#使用与问题恢复)：明确账号后继承、本地保存、页面竞争与故障提示。

## 开发与架构

- [开发与部署指南](PROJECT_GUIDE.md)：环境、命令及部署顺序。
- [独立自托管部署](STANDALONE_DEPLOYMENT.md)、[站点维护模式](SITE_MAINTENANCE.md)：网页／API 入口切换与维护提示。
- [代码地图](CODEMAP.md)、[架构](ARCHITECTURE.md)：定位模块，理解数据流与权限边界。
- [仓库结构](REPOSITORY_LAYOUT.md)、[Git 工作流](GIT_WORKFLOW.md)：文件职责、生成物及贡献流程。
- [认证与会话](AUTH_SECURITY_HARDENING.md)：身份归属、邮箱验证、凭据撤销与 provider 集成。
- [浏览器认证锁](SUPABASE_AUTH_LOCK_FIX.md)：后台刷新与 SDK 升级验证。
- [个人分析 Worker](PERSONAL_ANALYSIS_WORKER.md)、[统计快照调度](STATISTICS_SCHEDULING.md)：异步计算、部署与诊断。
- [个人补录分析](PERSONAL_MANUAL_ANALYSIS.md)、[手动资料与全服隔离](MANUAL_DATA_STATISTICS_EXCLUSION.md)：已知量、未知量及统计资格。
- [模拟器引擎](SIMULATOR_ENGINE.md)：统一水位、完整继承历史、增量资源、事务存档与版本迁移。
- [卡池阵容读取](POOL_ROSTER_READS.md)：超过 1,000 条关系的完整读取、后台失败反馈与工作台接口合同。
- [卡池保存与统计更新](POOL_CATALOG_STATISTICS_UPDATES.md)：展示字段、ID 归并、定向失效与迁移部署顺序。
- [数据与体验待完善项](CLOSEOUT_LEDGER.md)：可贡献的工作和现行数据审计工具。

## API 与官方数据

- [开发者 API：中文](developer-api-v1.zh-CN.md) / [English](developer-api-v1.en-US.md)。
- [绑定与官方 BOT API](integration-api.md)：私有查询范围及平台身份验证。
- [重构导入](official-rerun-import.md)、[赠送记录处理](OFFICIAL_TRUST_TOKEN_FIX.md)：官方数据规范化与统计约束。

公开开发者 API、BOT API 和官方记录获取后端使用不同凭据与权限。开发者 Key 不赋予官方导入或任意用户历史读取权限；新客户端的受控接入由维护者另行提供私有接口说明。

## 数据库与运营部署

- [数据库指南](../supabase/README.md)：baseline、前向迁移、手动修复与回滚。
- [邮件架构](SELF_HOSTED_MAIL.md)、[Stalwart 部署](STALWART_DEPLOYMENT_GUIDE.md)：发信开关、队列、防刷和邮件服务器配置。
- [本期抽奖](REGULATION_LOTTERY_202611.md)、[抽奖运营](SUMMER_LOTTERY_OPERATIONS.md)：配置、实际开放记录、归档、SSO、人工开奖与联系方式保护。
- [11 月数据库执行记录](PRODUCTION_MIGRATIONS_20261107.md)：概览性能与迁移补漏；[4.7.1 发布记录](RELEASE_4.7.1.md)另记版本和公告发布。
- [发布检查](RELEASE_CHECKLIST.md)：按修改范围选择验证与部署检查。

## 发布记录

- [v4.7.1](RELEASE_4.7.1.md)：国服扫码导入、导入窗口统一、目录与暂存完整读取，以及网络异常处理。
- [v4.7.0](RELEASE_4.7.0.md)：手机新版首页、手气评价与合并 UP 均抽、分享时间线、导入修复及版本缓存。
- [v4.6.4](RELEASE_4.6.4.md)：模拟器完整重写、仓库／文档整理、本地统计与沙盒修复，包含迁移、调度、生产部署及公告验收。
- [v4.6.3](RELEASE_4.6.3.md)：官方版本导览、管理与后续日程维护。
- [v4.6.2](RELEASE_4.6.2.md)：统计快照、五类合池、十图与桌面宽度。
- [v4.6.0](RELEASE_4.6.0.md)：默认新版桌面与经典主页切换。

发布记录保存对应版本的变化与验证；配置与运行要求以现行专题为准。截图位于 `docs/screenshots/`，游戏图片、字体及许可证按各资源目录维护。
