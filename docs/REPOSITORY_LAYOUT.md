# 仓库结构与文件约定

本仓库包含前端、同源 API、数据库 schema、BOT 和验证工具。了解模块入口可继续阅读 [代码地图](CODEMAP.md)。

## 主要目录

- `src/`：桌面与移动界面、状态、业务服务、资源和组件测试。
- `shared/`：前后端共用的数据类型、寻访规则与规范化逻辑。
- `api/`：公共读取、认证、私有账号数据、管理和 Worker 接口。
- `bots/official/`：官方 BOT 适配器与运行入口。
- `backend/`：官方导入共享合同及测试依赖，完整记录获取服务独立维护。
- `scripts/`：构建、生成、维护与专项验证；`playwright-tests/`、`tests/` 保存浏览器测试和测试初始化。
- `supabase/`：基线、迁移、数据修复和说明，见 [数据库指南](../supabase/README.md)。
- `public/`：直接提供的静态资源；`docs/` 保存专题和发布说明。

## 配置放在哪里

- `vite.config.js`：开发服务、分包与 PostCSS 插件；抽奖子应用由 `scripts/build-lottery-subapp.mjs` 构建。
- `src/index.css`：Tailwind 4 主题与暗色变体，无需额外 Tailwind JS 配置。
- `vitest.config.js`、`tests/setup.js`：测试范围、环境和初始化。
- `eslint.config.js`：代码检查；`package.json.prettier` 与 `.prettierignore`：格式和忽略范围。
- `.editorconfig`：编辑器换行与缩进约定；`.npmrc`、`.nvmrc`：安装与 Node 环境。
- `vercel.json`：部署路由、响应头与定时任务。旧移动客户端所需 Service Worker／资源兼容入口仍由此维护。

## 生成物与静态资源

`api/_generated/dashboardShareCardRenderer.mjs` 是明确跟踪的生成物。分享组件变化后运行 `npm run share:renderer`，将对应生成差异一起提交。

字体源与许可证进入仓库，自动分片由 `fonts:prepare` 生成。`dist/`、依赖目录、覆盖率和浏览器测试报告不提交。`statistics-preview.html` 是开发预览入口，尚未接入生产不代表它已废弃。

历史迁移参与基线重建，手写修复和回滚脚本保留其用途；数据库审计 JSON、用户导出和某次输入生成的执行 SQL 留在本地。脱敏示例可以提交。

## 保护本地数据

真实环境文件、私钥、服务账号、token／Cookie、数据库备份和用户记录不能进入公开仓库。环境模板 `.env.example`、`.env.contributor.example` 只提供字段和占位值。

`.gitignore` 控制新增跟踪范围，`.vercelignore` 和 `.dockerignore` 控制各自上传内容。忽略规则不会移除已跟踪文件，检查实际差异：

```bash
git status --short
git diff --stat
git diff --cached --stat
git diff --check
git diff --cached --check
git ls-files -ci --exclude-standard
```

最后一条列出已跟踪却命中忽略规则的文件。需要公开的共享代码使用明确例外；移除已跟踪的本地产物时，确认本地仍保留所需数据。

文件是否保留取决于实际依赖和使用说明。已替代的实现可从 Git 历史追溯，不在当前目录重复保存；许可证、数据库迁移和客户端兼容入口按各自合同维护。
