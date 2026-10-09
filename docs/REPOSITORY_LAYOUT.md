# 仓库内容与本地文件规范

2026-10-09 整理。公开仓库应能从干净检出安装、构建和执行验证；运行凭据、用户数据、机器状态和一次性产物由本地或私有运维目录保存。

## 应进入 Git 的内容

- `src / shared / api`：应用、公共与私有 API 的实现及合同测试。
- `scripts / playwright-tests`：可重复运行的维护、生成和验证入口。没有 npm 别名不等于过时，直接运行的专项脚本仍可保留，但应在文档说明输入和副作用。
- `supabase/baseline / archive / migrations`：schema 基线与完整前向迁移来源；历史日期不构成删除依据。
- `supabase/manual`：人工编写、受控执行的修复、回滚、高风险脚本及脱敏示例；既有生产日期修正保留审计用途，不加入新环境默认链。
- `public`、字体源及许可证：应用资源；截图由 README／发布文档引用，保留对应历史说明。
- 根配置、锁文件、`.github`、README／LICENSE／SECURITY／CONTRIBUTING 和 `docs`：安装、CI、维护及协作入口。
- `api/_generated/dashboardShareCardRenderer.mjs`：明确跟踪的分享渲染生成产物，源文件变化后运行 `npm run share:renderer` 并核对差异。
- `statistics-preview.html` 与对应 DEV 模块：仍用于统计／指南预览，未发布指南不等于文件废弃。
- `backend` 白名单兼容层：官方导入测试所需代码；完整私有后端、配置和独立部署包继续在 Git 外维护。

## 只保留在本地的内容

- `.env` 与其真实环境变体、私钥、证书私钥、token／Cookie／Session、服务账号凭据。
- 数据库 dump、用户历史导出、备份包、Git bundle、个人数据审计结果及原始诊断内容。
- `node_modules / dist / coverage / test-results / artifacts / scratch / .agent-tmp`、浏览器配置和预览日志。
- Supabase CLI 的 `.temp / .branches`，字体自动生成分片及不公开的字体源压缩包。
- `supabase/manual/data-backfill/*.generated.json`、`*.generated.sql`、旧审计计划，以及 `history-*.json`／`history-snapshot*.ndjson`。这些是某次输入生成的结果，运行时按当前数据重新生成；脱敏 `*.example.json` 保留。
- 本机代理规则、`docs/agent-runtime.md` 和 `scripts/run-local-task.mjs`。本机 `AGENTS.md` 经 `.git/info/exclude` 保留，不把工作区路径规则当作公共项目要求。

`.gitignore` 管理 Git 新增范围；`.vercelignore` 和 `.dockerignore` 管理各自上传上下文，不能互相替代。环境模板 `.env.example`、`.env.contributor.example` 允许进入 Git，但模板不得含真实值。新增可公开模板时明确增加例外，不用强制添加真实环境文件。

## 本轮已处理的过时内容

- 删除两份 2026-02 的 `deploy-backend` 脚本：它们要求不存在的部署说明和旧公开后端包，旧 Shell 路径还会重写 `.env`，与当前 CN／INTL 私有 Docker 发布方式冲突。
- 删除一次性 `diagnose-personal-data-failure.mjs`：依赖特定本机测试账号文件和旧候选端口，无 package／CI／文档引用。原实现由 Git 历史保留。
- 删除旧 `verify-oracle-captcha-playwright.mjs`：断言旧桌面拼图布局同时适用于手机，已与现行移动布局不符；不作为现行验证码回归入口。
- 19 份生成报告、执行 SQL 和历史摘要已解除 Git 跟踪，文件仍保留本地。人工修复／回滚与迁移链未删除。
- 清理根目录旧预览日志、已失效 PID 标记和 `nul`；环境文件和私有后端配置保留。

进一步核对初代遗留后，删除以下 11 份文件：未引用的 `public/vite.svg`、旧管理 Edge Functions 的 3 份 TypeScript 与 README、旧 Supabase 邮件模板／SMTP 指南 5 份，以及 2026-02 的失效设计审查。当前管理路由和统一邮件渲染器已替代前两套实现；初代审查中的代码位置、权限与建议不作为当前事实维护，历史由 Git 保留。

`supabase/初始数据导入.sql` 移至 `supabase/manual/legacy/20260117_initial_catalog_seed.sql`，仅供旧 ID 对照，不执行初始化。第三份重复 API 文档 `developer-api-v1.md` 收缩为双语现行文档入口，避免三份合同同时漂移。

代码引用复核后再删除 10 份闲置前端文件：

- `src/LoadingScreen.jsx`、`src/mobile/components/MobileLoadingScreen.jsx`：启动与路由占位已由 `AppStartupGate`／路由内的 fallback 承担。
- `src/mobile/components/MobilePoolSelector.jsx`：当前移动卡池页使用 `MobilePoolRailSelector`。
- `src/components/dashboard/CharacterWaterfallChart.jsx`、`src/mobile/components/MobileCharacterWaterfallChart.jsx`：两端当前仪表盘均不再挂载旧瀑布图。
- `src/components/TerminalCaptcha.jsx`：现行验证码通过 `OracleCaptchaHubImpl` 选择具体实现。
- `src/components/index.js`、`src/components/InputSection.jsx`：无人导入的旧组件汇总与仅由其导出的旧录入组件。
- `src/mobile/components/MobileStatsCard.jsx`、`src/mobile/components/MobilePityProgress.jsx`：没有导入或页面挂载的旧展示组件。

本次累计额外删除 21 份文件，移动 1 份旧种子并收缩 1 份重复文档；这些是上一轮整理之外的增量。仅检查和修改 `gacha-analyzer`，原有未提交差异继续保留。

仍有现行用途的旧发布记录、许可证、迁移和兼容入口继续保留。当前状态统一从 [近期交付](RECENT_DELIVERY_STATUS.md)、[文档索引](README.md) 和对应专题进入；最后修改时间只能帮助发现候选，实际删除依据是依赖关系与现行替代实现。

## 按时间复核根配置与文档

本次按当前 HEAD 的首次／最近提交日期筛选，再核对自动加载、显式引用和现行替代入口；日期不包含本地未提交整理，也不单凭文件名和最后修改时间判定废弃。

- **2025-11-28 初始构建配置**：`postcss.config.js` 自初始提交后未改，但此前仍被 Vite 自动加载。现将 Tailwind／Autoprefixer 按原顺序内联到 `vite.config.js`，移除独立文件；抽奖构建在 `scripts/build-lottery-subapp.mjs` 显式保留 Autoprefixer，不再依赖父目录配置发现。
- **同日建立的 Tailwind JS 配置**：最后修改于 2026-04-14，但 Tailwind 4 没有自动读取该 JS 文件，源码也无 `@config` 引用。当前主题／暗色变体由 `src/index.css` 的 CSS 配置维护，删除重复且不生效的 `tailwind.config.js`。
- **2026-02-25 格式化配置**：`.prettierrc` 选项完整并入 `package.json.prettier`，移除独立文件。`.prettierignore` 保留，因为忽略规则有独立发现机制，不能用 package 配置代替。
- **2026-04-15 测试底座**：`vitest.setup.js` 的初始化内容完整移至 `tests/setup.js`，更新 `vitest.config.js` 路径，根目录减少一份执行代码。Vitest 继续独立配置，避免单测加载含服务端环境和 API middleware 的开发 Vite 配置。
- **早期数据库指南**：FEAT-007 长篇指南改为 `027–030` 历史来源与现行维护链接，删除单独推送旧迁移、旧 ID 插入和删表回滚教学。路径保留给退役审计脚本读取，schema／数据退役仍看真实依赖。
- **后续重复文档**：统计分支历史与范围并入 v4.6.2 发布记录，旧分支说明只保留专题导航；发布清单统一为下次发布模板，不混放多代历史勾选；邮件实施流水收敛为现行能力／开关边界并链接代码地图和部署指南。

本次根目录减少 4 份文件，没有批量改变源码格式或修改依赖版本。`vite.config.js`、`vitest.config.js`、`eslint.config.js`、`vercel.json`、`.npmrc`、`.nvmrc`、Git／Vercel／Docker 忽略文件及 GitHub 顶层文档继续留在工具或平台识别的位置；这些文件职责不同，不为了数量少强行合并。

## 提交前核对

```bash
git status --short
git diff --stat
git diff --cached --stat
git diff --check
git diff --cached --check
git ls-files -ci --exclude-standard
```

最后一条列出“已跟踪但命中忽略规则”的文件，正常应为空；确需公开的兼容层采用明确例外。新增忽略规则不会自动解除已跟踪文件，移出 Git 时使用 `git rm --cached -- <精确路径>` 并确认本地仍存在。

代码改动按 [贡献指南](../CONTRIBUTING.md) 验证；纯文档整理核对引用和差异即可。本轮源目录已经恢复当前 main，未发布数据工作台留在独立候选与可恢复备份中，不将其旧迁移或旧 baseline 混入当前提交。
