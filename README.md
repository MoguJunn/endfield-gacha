# Endfield Gacha Analyzer

《明日方舟：终末地》抽卡记录分析器。主站提供官方导入、公开统计、模拟器、移动端、后台管理、运营自动化和 Vercel 可观测性。

[![Version](https://img.shields.io/github/package-json/v/MoguJunn/endfield-gacha?filename=package.json)](https://github.com/MoguJunn/endfield-gacha/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![React](https://img.shields.io/badge/React-19-61DAFB.svg)
![Vite](https://img.shields.io/badge/Vite-7-646CFF.svg)
![Supabase](https://img.shields.io/badge/Supabase-Cloud-3ECF8E.svg)

**在线站点**：[ef-gacha.mogujun.icu](https://ef-gacha.mogujun.icu/)

![Homepage](docs/screenshots/homepage.png)

> 截图用于展示页面布局，画面中的版本与日期可能早于当前代码。徽章反映仓库版本，线上运行状态需以部署验证为准。

## 当前版本准备

- 目标版本：`v4.6.2`，本地实现与最终验证已完成，草稿公告已准备但未网站发布；线上仍运行 `v4.6.0`。本轮推进至发布 PR 和 CI，等待新卡池适配完成及后续指令后再合入 main；范围与发布前置条件见 [4.6.2 发布准备](docs/RELEASE_4.6.2.md)。
- 统计：单池与限定角色、限定武器、常驻武器、重构寻访、重构申领五类合池，提供十图、头像对象选择、分类排序、深色与减少动态效果；旧指标及资源概览随选择范围读取快照。合池先逐账号、逐期、逐对象计算首次，再汇总类别，账号覆盖跨期去重。
- 调度：全服与个人统计只读 `public-statistics-v4` 快照；生产迁移与 Worker 尚未执行，算法优化后仍须核对实时主机余量并完成预热再启用页面。桌面各页统一沿用首页响应式宽度；新指南仅为开发预览。
- 官方导入：浏览器提交 `import-full` 后只轮询 `import-status`；服务端内部暂存并自动原子写入，不再调用同步 `import-confirm`。官方情报书等非寻访事件不会写入历史；旧版未知占位仅在账号、区服、卡池、官方序号和时间完整吻合时自动修复。需要核对、存在漏池或云端刷新失败时，结果页会保留明确提示。
- 历史维护：支持按账号、区服、卡池和序号精确编辑 / 删除，并提供异常记录提醒与后台复核。
- 个人分析：owner/account 快照由 Supabase `pg_cron + pg_net` 异步生成；活跃用户可即时派发，页面使用轻量渐进检查并保留上次成功结果。
- 仪表盘：详细日志按需挂载，时间线与卡池阵容复用缓存；附加寻访支持重构寻访、重构申领和特殊寻访子类型。
- 公共数据：生产首屏统一走同源 `/api/*`，避免浏览器直连 Supabase 域名。
- 缓存：`CACHE-001 / ARCH-022` 已接入 `public_cache_epoch`、公共响应 `meta`、前端快照与显式失效。
- 自动化：`OPS-006` 已接入 job graph、partial 语义、重跑入口和审计详情。
- 可观测性：Vercel Analytics + Speed Insights。

## 快速开始

```bash
git clone https://github.com/MoguJunn/endfield-gacha.git
cd endfield-gacha
npm install
cp .env.contributor.example .env.local
npm run dev
```

Node.js 需要 `>=22.17.0 <27`，npm 建议使用仓库锁定的 `npm@11.2.0`。
外部贡献者默认使用 `.env.contributor.example`。模板会开启仅 Vite DEV 生效的本地内容沙盒：无需数据库 key，卡池、角色、武器和阵容优先从正式站公共 GET 接口读取，并缓存最后一次成功目录；断网首启则使用仓库内可确认的真实最小目录。

登录页会显示本地演示账号，也可以直接使用：

```text
邮箱：demo-admin@local.invalid
密码：frontend-demo
```

该账号不是 Supabase 账号，也没有真实 token。登录后可以在完整管理界面中本地新增、编辑、启停和删除公告、卡池、阵容、角色、武器、版本时间线与站点配置；修改保存到独立 `localStorage` 沙盒，刷新仍保留，也可一键重置。沙盒启动时会清理同源残留认证、禁用真实 Supabase 客户端、OAuth、邮件验证码、官方代理导入和后台执行入口；公共目录、资源主机和公开站点配置均采用显式白名单。用户密码、真实用户数据删除、邮件、开奖、密钥和自动化执行保持隔离，不会访问生产写接口。

## 桌面新版主页

`v4.6.0` 起，已验收的桌面首页、导航和个人 / 全服统计拆分成为桌面端默认体验，以 1366×768 为基准，含统一消息弹窗和可收起个人菜单。首次访问默认使用新版；新版提供“切换至经典主页”，经典主页提供“切换至新版主页”，选择写入本地偏好并在后续访问保持。旧预览链接 `/?home-demo=unified` 继续兼容并总是打开新版。布局、路由、独立版本倒计时主题接口及验证范围见 [桌面 Demo 文档](docs/DESKTOP_HOME_DEMO.md)，历史发布证据见 [4.6.0 发布说明](docs/RELEASE_4.6.0.md)。`v4.6.2` 将首页响应式宽度扩展至其他桌面页；[首次使用指南](docs/ONBOARDING_GUIDE_PLAN.md) 已有开发预览，真实登录、导入和备份动作尚未接入。

## 常用验证

```bash
npm test
npm run test:unit
npm run lint
npm run build
npm run perf:report
```

数据库新环境默认执行 `supabase/baseline/000_complete_schema.sql`，不要把已合并进 baseline 的归档迁移重复叠加执行。

## 文档入口

| 文档 | 用途 |
|------|------|
| [docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md) | 部署、环境变量、数据库、维护命令 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 整体架构、数据边界、缓存与自动化 |
| [docs/CODEMAP.md](docs/CODEMAP.md) | 代码入口和主要模块索引 |
| [docs/PERSONAL_ANALYSIS_WORKER.md](docs/PERSONAL_ANALYSIS_WORKER.md) | 个人分析快照、Worker 调度与生产核验 |
| [supabase/README.md](supabase/README.md) | Supabase baseline、迁移归档和手工 SQL 边界 |
| [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) | 发布检查清单 |
| [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md) | 从 `v4.4.1` 起执行的分支、提交和历史整理规则 |

## 仓库边界

- 公开仓库包含主站、Vercel API、Supabase schema、官方 BOT 运行层和验证脚本。
- `backend/` 仅保留兼容 helper 与测试依赖，不代表完整私有后端主链。
- 私有用户数据、后台数据、账号恢复、个人排行不进入公共缓存，响应策略保持 `no-store`。
- 不提交生产密钥、私有代理、真实后端凭据或登录态数据。

## License

MIT License. 本项目为粉丝自制工具，与游戏官方无关；游戏内容版权归 Gryphline / HyperGryph 所有。
