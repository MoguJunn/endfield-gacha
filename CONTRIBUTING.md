# Contributing

欢迎提交 Issue 和 Pull Request。

## 提交前

- 先确认改动是否属于当前公开主链，还是只应该留在私有环境。
- 触及公开页面、统计、导入、缓存、自动化或部署配置时，优先对齐现有代码和文档边界。
- 不要提交秘密、真实 token、生产数据库连接串、私有后端地址或能登录真实后端的调试账号。公开 synthetic 沙盒身份须保持无真实 token 与生产权限。
- 文件范围、生成物及本地恢复材料按 [仓库内容规范](docs/REPOSITORY_LAYOUT.md) 维护；提交前同时核对已暂存与未暂存差异。

## 本地环境

外部贡献者请复制安全模板：

```bash
cp .env.contributor.example .env.local
```

模板默认启用仅 Vite DEV 生效的内容沙盒，无需数据库 key。目录读取正式站公共 GET，成功后缓存，离线使用最小真实目录。只有关闭沙盒并调试真实认证时，才需要低权限 publishable key 或自己的隔离 Supabase；不向贡献者提供 service role、JWT／SMTP／OAuth／BOT／Cron 等服务端秘密。

新版桌面首页已在 v4.6.0 成为默认入口，`/?home-demo=unified` 保留兼容。当前 v4.6.3 已包含 PR #37 的统计与宽度更新及 PR #43 的版本导览；统计迁移、Worker 与首次预热已完成。调整相关入口前，请对齐 [桌面合同](docs/DESKTOP_HOME_DEMO.md)、[统计合同](docs/STATS_OBSERVATION_CONTRACT.md) 和 [近期交付](docs/RECENT_DELIVERY_STATUS.md)，保留 1366×768 基线、独立组件和移动端边界。

指南样例位于开发服务器的 `/statistics-preview.html`，仅在 Vite DEV 中渲染，未接入真实登录、导入或备份动作。它与贡献者数据沙盒是独立入口；真实统计的只读本地预览按 [统计调度说明](docs/STATISTICS_SCHEDULING.md) 准备，不代表生产 Worker 已启用。

修改卡池时间时对齐 [时间管理合同](docs/POOL_SCHEDULE_MANAGEMENT.md)：限定武器三期规则与重构申领分开，数据库明确空值不由离线备份覆盖，重构期次来自后台设置。独立日历在另一仓库维护，两边分别验证与部署。活动名称、时间和图片应保留官方来源；维护开始与版本开启不能混用，未公布日期保持未知，限定武器既有估算规则除外。

根配置按工具加载边界维护：CSS 处理在 `vite.config.js`，Tailwind 4 主题在 `src/index.css`；Prettier 选项在 `package.json.prettier`，测试初始化在 `tests/setup.js`。不再新建重复的 PostCSS／Tailwind JS 配置；抽奖子应用的 CSS 处理由构建脚本显式指定。整理配置后核对构建和相关测试，不批量格式化无关源码。

## 最低验证

公开主链改动建议至少跑：

```bash
npm run lint
npm run test:unit
npm run build
git diff --check
```

如果改到了公共数据、缓存或自动化，再补跑对应的专项验证，例如：

```bash
npm test
npm run test:public-api-boundary
npm run test:bootstrap-cache
npm run test:ops-automation
npm run test:official-announcements-feed
```

如果改到了邮箱、密码、OAuth、站点 Session、身份 key 或认证迁移，还必须补跑：

```bash
npm run test:auth-hardening-phase-a
npm run test:auth-hardening-phase-cd
npm run test:supabase-baseline
npm run test:supabase-baseline:smoke
```

认证迁移编号改变后必须重新生成并验证 baseline；本地测试通过不代表真实浏览器回归、生产迁移或部署已经完成。真实 OAuth secret、identity hash key、邮箱 challenge 和临时凭据不得进入提交。

## 文档要求

- UI 或路由变更请同步更新 README、截图或代码地图。
- 桌面 Demo 改动同步 `docs/DESKTOP_HOME_DEMO.md`；区分本地验收、最终改动验证和正式发布，预览阶段不替换 README 的正式站截图。
- 环境变量、部署方式、Supabase baseline、公共缓存版本和自动化入口变更时，请同步更新对应文档。
- 如果改动会影响 GitHub 页面展示，优先更新 README 顶部、预览图和更新日志。
- 发布事实写清对应提交、PR／CI、生产核验与测试时间；本地候选不写成已上线，旧验证数量不冒充本轮重跑。工作区 todo／handoff 位于仓库外，应同步任务入口但不复制私有运维信息进公开文档。
- 迁移按文件内容与目标数据库合同核对，不仅比较编号。独立候选若与 main 同号，先重编号、同步引用并生成 baseline；已执行的手动数据修正不加入新环境默认部署。

## 提交建议

- 单个 PR 聚焦一个主题，避免把功能、修复、依赖和文档整理混在一起。
- 从 `v4.4.1` 起按 [Git Workflow](docs/GIT_WORKFLOW.md) 执行：功能走 `feat/vX.Y-*`，修复走 `fix/vX.Y-*`，版本收口走 `release/vX.Y.Z`。
- 提交信息保持简洁明确，优先使用 `feat:`、`fix:`、`perf:`、`docs:`、`test:`、`chore:`。
- 功能分支合入发布分支前整理为 1 个主题清晰的提交；修复分支按问题保持小提交。
- 如果改动只影响文档，也请说明测试未运行或为何不需要运行。
