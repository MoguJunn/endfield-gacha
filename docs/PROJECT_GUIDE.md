# 开发与部署指南

本文帮助贡献者启动项目、选择调试环境，并帮助自建部署者配置服务。功能概览见 [README](../README.md)，模块入口见 [CODEMAP](CODEMAP.md)。

## 本地开发

```bash
npm ci
cp .env.contributor.example .env.local
npm run dev
```

运行要求：Node.js `>=22.17.0 <27`、npm `>=10`。安装使用仓库锁文件；`predev` 会准备字体与分享渲染器。

### 贡献者内容沙盒

`VITE_CONTRIBUTOR_DEMO_MODE=true` 仅在 Vite DEV 生效。默认从公共只读 API 获取卡池、角色、武器和阵容，缓存最后一次成功目录；离线首启使用内置最小目录。

演示身份：`demo-admin@local.invalid` / `frontend-demo`。登录页可一键填入，管理界面支持公告、卡池、阵容、角色、版本时间线与站点配置的本地编辑。会话保存在当前标签页，内容保存到独立 `localStorage`，顶部提供刷新目录和重置操作。

该身份没有数据库用户、Bearer token 或生产权限。沙盒禁用真实认证、OAuth、邮件、身份绑定、官方导入和后台执行，目录请求不携带凭据。生产构建不会激活沙盒。

沙盒个人／合池统计和模拟器继承使用本地演示历史。模拟器会话与结果保存到 IndexedDB，内容编辑与目录缓存仍在独立 localStorage；清理网站存储会删除这些本地数据。完整模拟器合同见 [SIMULATOR_ENGINE.md](SIMULATOR_ENGINE.md)。

只读镜像可用 `VITE_CONTRIBUTOR_CATALOG_API_BASE` 配置，额外资源与目录主机需加入明确白名单。调试真实认证或 RLS 时，关闭沙盒并使用自己的隔离 Supabase。

### 页面入口

- `/`：默认新版桌面首页，可切换经典主页并保存浏览器偏好。
- `/dashboard`：个人卡池分析；`?view=overview` 打开个人概览。
- `/summary`：全服统计，私有数据读取失败不应阻塞该页面。
- `/simulator`：桌面模拟器；`/m/simulator` 保持使用桌面版的引导提示。
- `/m/`：手机入口；`/m/stats` 为手机统计。
- `/statistics-preview.html`：开发专用统计与指南样例，按钮不执行真实登录、导入或备份。

布局与消息合同见 [桌面界面](DESKTOP_HOME_DEMO.md)，统计口径见 [统计指标](STATS_OBSERVATION_CONTRACT.md)。

## 环境变量

前端开发使用 [.env.contributor.example](../.env.contributor.example)。完整服务端部署参考 [.env.example](../.env.example)，真实值保存在本地环境文件或部署平台的秘密存储中。

- `VITE_*` 会进入浏览器构建，只用于可公开的 URL、publishable key 和界面开关。
- `SUPABASE_URL`、`SUPABASE_SECRET_KEY` 供服务端使用；旧 `SUPABASE_SERVICE_ROLE_KEY` 别名仍可兼容。
- OAuth Client Secret、`OAUTH_STATE_SECRET`、identity keyring 和 Session 密钥只放服务端，配置见 [认证专题](AUTH_SECURITY_HARDENING.md)。
- 个人分析 Worker 需要 `PERSONAL_ANALYSIS_WORKER_ENABLED` 和独立 secret；详细调度见 [Worker 指南](PERSONAL_ANALYSIS_WORKER.md)。
- 邮件默认演练且真实发送关闭。SMTP、业务开关、Webhook 与紧急停发规则见 [邮件架构](SELF_HOSTED_MAIL.md)。
- `CRON_SECRET` 和 BOT token 只用于受保护服务入口；官方 BOT 调用规则见 [绑定与 BOT API](integration-api.md)。

`VITE_PUBLIC_DATA_DIRECT_SUPABASE_FALLBACK` 默认关闭，生产公共读取使用同源 API。浏览器 Realtime 也默认关闭，仅在隔离环境需要时启用。变更环境后重新启动开发服务器，生产前端变量变化需要重新构建。

Vite 开发及构建预览的 API 环境按项目目录加载，不依赖启动进程的工作目录；运行 npm 仍应以仓库目录为准。`.agent-tmp` 测试生成物已从开发监视范围排除，避免浏览器临时文件锁导致预览退出。

## 验证

```bash
npm test
npm run test:unit
npm run lint
npm run build
npm run perf:report
```

`npm test` 覆盖公开验证脚本，`test:unit` 运行 Vitest。专项 `test:*` 命令在 `package.json` 中登记，包括公共读取、认证、数据库、导入、邮件和自动化。

沙盒浏览器验证使用 `npm run test:contributor-demo:ui`，运行前启动开发服务器。需要数据库的检查使用临时 PostgreSQL 或隔离环境，不直接以生产配置运行测试。纯文档修改核对引用与差异即可。

模拟器专项检查为 `npm run test:simulator-v2:ui`、`npm run test:simulator-v2:sql`；浏览器检查需启动 DEV 内容沙盒，SQL 检查使用新建隔离实例。`node scripts/benchmark-simulator.mjs` 生成合成计算与载荷基准，不读取生产用户数据。

## 自建部署

1. 配置 Supabase/PostgreSQL，按 [数据库指南](../supabase/README.md) 执行完整 baseline；不要重复执行已包含的历史迁移。
2. 在服务端配置 Supabase secret、会话密钥与所需功能变量；浏览器只接收公开变量。
3. 配置个人分析 schema 3 队列及 `pg_cron + pg_net` 调度。部署目标 Worker 后同步 Vault 中不可变 `personal_analysis_worker_url`，确认可以领取并发布匹配版本的任务；不能只验证 HTTP 200。
4. 按 [统计调度](STATISTICS_SCHEDULING.md) 部署常驻统计 Worker，并完成对应计算版本的公开／个人快照预热。
5. 构建并部署主站与 API，配置 `vercel.json` 的路由和响应头；数据库必须先于依赖新字段／RPC 的代码。
6. 核对正式域名、版本、公共页面、认证边界、快照读取与缓存失效。需要的邮件、BOT 和代理逐项配置及验证。

仓库默认使用 GitHub-connected Vercel：推送 `main` 触发生产构建。发布前准备数据库与后台计算，发布后确认部署 Ready 和正式域名指向正确版本，流程见 [发布检查](RELEASE_CHECKLIST.md)。

当前 v4.6.4 已发布，既有自托管环境已应用模拟器迁移并重建快照，生产个人分析调度已同步至新部署，见 [发布记录](RELEASE_4.6.4.md)。其他已有环境升级时核对 `2026100901_simulator_inheritance_v2.sql` 是否缺失；它递增修订以触发重建，已执行环境不要重跑。运行版本优先读取 `site_config.site_version`，发布时同步 `build_info` 和公共缓存，再核对中英文公告及实际页面。

管理后台使用同源 `/api/admin`，兼容 URL 由路由表映射；无需部署旧 Supabase 管理 Edge Functions。

## 官方导入与数据维护

官方数据获取由独立 CN／INTL 后端承接。浏览器提交 `import-full` 后轮询 `import-status`；后端规范化、过滤非寻访事件、内部暂存并通过 RPC 原子写入。可精确定位的未知记录产生核对提醒，缺少账号／区服／卡池／序号等安全归属的记录跳过。

公开仓库保留共享导入合同与测试，不提供完整服务包。后端集成须携带相同的 normalizer、保底规则与暂存／增量模块，分别验证地区健康、CORS 和导入行为。重构与赠送规则见 [重构导入](official-rerun-import.md)、[赠送记录](OFFICIAL_TRUST_TOKEN_FIX.md)。

历史编辑与删除使用完整账号作用域、乐观锁和变更审计；旧仅 ID 批量删除遇到跨账号重复 ID 时整笔拒绝。修复或回填前生成最新审阅计划、备份并核对精确影响范围，工具见 [数据待完善项](CLOSEOUT_LEDGER.md)。

## 静态资源与缓存

字体源和许可证随仓库维护，分片由 `npm run fonts:prepare` 生成。分享卡源变化后运行 `npm run share:renderer`，对应跟踪产物一起提交。

公共缓存使用 `site_config.public_cache_epoch`，读取失败可展示最近公共快照；用户历史、个人分析、工单与后台响应保持鉴权和 `no-store`。日历日期与 CDN 传播见 [卡池时间管理](POOL_SCHEDULE_MANAGEMENT.md)。

日常诊断优先查看脱敏错误、请求状态、计算时间和缓存响应头。反馈问题时提供最小复现，不公开用户导出、认证令牌或服务器秘密。
