# Endfield Gacha Analyzer

《明日方舟：终末地》抽卡记录分析器。主站提供官方导入、公开统计、模拟器、移动端、后台管理、运营自动化和 Vercel 可观测性。

[![Version](https://img.shields.io/github/package-json/v/MoguJunn/endfield-gacha?filename=package.json)](https://github.com/MoguJunn/endfield-gacha/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![React](https://img.shields.io/badge/React-19-61DAFB.svg)
![Vite](https://img.shields.io/badge/Vite-7-646CFF.svg)
![Supabase](https://img.shields.io/badge/Supabase-Cloud-3ECF8E.svg)

**在线站点**：[ef-gacha.mogujun.icu](https://ef-gacha.mogujun.icu/)

![Homepage](docs/screenshots/homepage.png)

## 当前主线

- 版本：`v4.5.3`
- 官方导入：获取结果在服务端内部暂存后立即原子写入；可精确定位的未知角色 / 武器记录会保留并在导入完成后提示核对，缺少安全归属字段的记录会跳过。
- 历史维护：支持按账号、区服、卡池和序号精确编辑 / 删除，并提供异常记录提醒与后台复核。
- 仪表盘：详细日志按需挂载，时间线与卡池阵容复用缓存；本地账号历史采用必要列并行分页读取。
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
外部贡献者默认使用 `.env.contributor.example`，只包含公开读取所需变量；维护者调试后台、邮件、BOT 或自动化时再使用 `.env.example` 补齐服务端密钥。

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
