# Docs Layout

仓库内的补充文档统一收口到 `docs/`：

当前准备版本为 `v4.6.2`：本地实现已准备，生产迁移、Worker、v4 快照预热及发布证据仍待完成。历史版本文档保留当时事实。

- `docs/ARCHITECTURE.md`：整体架构、公共 / 私有 / admin 边界、缓存、自动化和数据库分层
- `docs/AUTH_SECURITY_HARDENING.md`：Phase A–D 本地候选、认证不变量、迁移重编号、真实浏览器回归和发布门禁
- `docs/PROJECT_GUIDE.md`：部署、环境变量、数据库维护、静态资源和 changelog 摘要
- `docs/CODEMAP.md`：代码入口和主要模块索引
- `docs/DESKTOP_HOME_DEMO.md`：默认新版桌面主页与经典版切换、1366×768 布局、个人与全服统计拆分、统一消息弹窗及独立版本主题接口
- `docs/MOBILE_HOME_PLAN.md`：手机首页 P1 改版任务、内容顺序、触摸滚动与正式启用验收标准
- `docs/RELEASE_4.6.0.md`：v4.6.0 交付范围、贡献署名、版本验证及运行时配置同步
- `docs/RELEASE_4.6.2.md`：本轮五类合池、十图、旧指标迁移、全页宽度、已有验证与生产启用门禁
- `docs/STATS_OBSERVATION_CONTRACT.md`：单池／合池首次样本、去重账号覆盖、旧指标与资源口径、理论边界
- `docs/STATISTICS_SCHEDULING.md`：v4 快照、5/30/60 分钟调度、生产迁移和预热顺序、只读本地预览
- `docs/STATS_BRANCH_SCOPE.md`：统计与指南实现范围、阶段提交和未完成边界
- `docs/ONBOARDING_GUIDE_PLAN.md`：首次使用教程与首页指南优化任务；已有开发预览，真实业务动作待接入
- `docs/PERSONAL_ANALYSIS_WORKER.md`：个人分析快照队列、Supabase `pg_cron + pg_net` 调度、应急入口与生产核验
- `docs/CLOSEOUT_LEDGER.md`：已上线但仍依赖 placeholder / fallback / 隐藏入口的功能收口总账
- `docs/ACCOUNT_ALL_CLOSEOUT.md`：全部账号汇总的保留、关闭和重新开放条件
- `docs/SELF_HOSTED_MAIL.md`：自建邮件平台选型、投递基础设施、outbox / suppression / 防刷预算边界和后续决策点
- `docs/STALWART_DEPLOYMENT_GUIDE.md`：Stalwart-first 自建邮件部署步骤、同机资源边界、DNS 清单和 Cloudflare Email 边界
- `docs/RELEASE_CHECKLIST.md`：发布前检查清单
- `docs/GIT_WORKFLOW.md`：从 `v4.4.1` 起执行的分支、提交、发布和历史整理规则
- `docs/developer-api-v1.zh-CN.md` / `docs/developer-api-v1.en-US.md`：开发者 API v1 双语 Wiki 源文档
- `docs/integration-api.md`：平台绑定与官方 BOT 私有接口边界
- `docs/screenshots/`：README 和发布页引用的产品截图
- `docs/reviews/`：设计评审、架构审计、阶段性复盘
- `docs/email-template/`：历史认证邮件模板与 SMTP 配置说明；后续账号邮件主线以 `docs/SELF_HOSTED_MAIL.md` 为准

公开文档的职责边界如下：

- 根目录 `README.md` 只负责 GitHub 首页摘要：项目定位、主线状态、快速开始、常用验证和文档入口
- 部署、环境变量、数据库和长 changelog 放在 `docs/PROJECT_GUIDE.md`
- 整体架构、公共缓存、自动化和数据库边界放在 `docs/ARCHITECTURE.md`
- 认证目标架构、候选验证证据、GitHub 回归和生产边界放在 `docs/AUTH_SECURITY_HARDENING.md`
- `supabase/README.md` 负责数据库迁移链、baseline 与手工脚本说明
- 新版桌面的布局、路由、主页偏好与验收维护在 `docs/DESKTOP_HOME_DEMO.md`；本轮发布提交、CI 与生产验证维护在 `docs/RELEASE_4.6.2.md`，`docs/RELEASE_4.6.0.md` 与早期预览截图保留历史含义
- 与当前运行状态冲突的“历史计划 / 旧部署方式”不要继续保留在主文档正文里
- 认证文档必须区分本地候选、真实浏览器回归、授权后集成与生产部署；候选 migration 文件名不等于最终生产编号
- 新增迁移、CI、Serverless 路由、字体链、公告采集链或公共缓存版本后，应同步更新对应专题文档，而不是把细节塞回根 README
- 官方导入后台任务、内部暂存 / 自动原子提交、写入后异常核对与受控编辑属于“私有账号数据”主链：用户操作写入 `docs/PROJECT_GUIDE.md`，服务与数据边界写入 `docs/ARCHITECTURE.md`，入口索引写入 `docs/CODEMAP.md`，表 / RPC / 迁移状态写入 `supabase/README.md`

源码根目录只保留真实入口、构建配置和面向开发者的顶层说明。一次性分析、归档材料和构建产物不要再直接堆在仓库根目录。
