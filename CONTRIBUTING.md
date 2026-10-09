# 贡献指南

欢迎报告问题、改进文档或提交代码。较大的功能和交互调整建议先开 Issue 说明目标，便于确认范围；小修复可以直接提交 Pull Request。

## 准备开发环境

```bash
npm ci
cp .env.contributor.example .env.local
npm run dev
```

Node.js 与 npm 要求见 [README](README.md)。默认贡献者模板提供本地内容沙盒，读取公共目录，内容修改只保存在浏览器，无需数据库密钥。演示身份为 `demo-admin@local.invalid` / `frontend-demo`。

调试真实认证或数据库时，关闭沙盒并使用自己的隔离环境。真实密钥、用户记录和可登录后端的测试身份不要放入代码、截图或 Issue；公开演示身份没有生产权限，允许随文档提供。

详细环境和启动说明见 [PROJECT_GUIDE](docs/PROJECT_GUIDE.md)。

## 找到修改入口

- 页面、路由和状态：[代码地图](docs/CODEMAP.md)。
- 数据读取、私有边界和后台计算：[架构](docs/ARCHITECTURE.md)。
- 首页布局、导航和消息交互：[桌面界面合同](docs/DESKTOP_HOME_DEMO.md)。
- 统计定义与调度：[观测合同](docs/STATS_OBSERVATION_CONTRACT.md)、[快照调度](docs/STATISTICS_SCHEDULING.md)。
- 卡池日期和官方来源：[时间管理](docs/POOL_SCHEDULE_MANAGEMENT.md)。

`/statistics-preview.html` 是开发预览，指南按钮尚未连接真实登录、导入或备份。请按 [项目进展](docs/RECENT_DELIVERY_STATUS.md) 区分可用功能和设计方案。

## 验证修改

代码改动通常执行：

```bash
npm run lint
npm run test:unit
npm run build
git diff --check
```

优先覆盖受影响的合同。公共 API、缓存或自动化变更补运行 `npm test` 和相应 `test:*` 脚本；认证变更运行 `test:auth-hardening-phase-a`、`test:auth-hardening-phase-cd` 并验证相关 Session／provider 行为。

数据库迁移需重新生成并验证 baseline，必要时使用临时 PostgreSQL 做真实执行验证，见 [数据库指南](supabase/README.md)。文档修改检查链接、命令和内容一致性即可；在 PR 中说明已执行的检查和环境限制。

## 文件与文档

- 每个 PR 聚焦一个主题，避免批量格式化无关源码。
- 更新页面、API、环境变量或部署方式时，同时更新对应说明；README 保持简短，细节放入专题。
- 公共文档直接说明功能、使用方法与维护要求，不要求读者访问维护者的个人目录、内部任务账本或会话记录。
- CSS 处理在 `vite.config.js`，Tailwind 主题在 `src/index.css`；Prettier 选项在 `package.json`，测试初始化在 `tests/setup.js`。
- 跟踪的生成物随源文件刷新，例如 `npm run share:renderer`；构建输出、临时报告和真实环境文件不进入提交，范围见 [仓库结构](docs/REPOSITORY_LAYOUT.md)。

## 提交 Pull Request

从最新主线建立主题分支，说明问题、改后行为和验证结果；UI 调整附上相关截图。标题使用 `feat:`、`fix:`、`docs:`、`test:`、`perf:` 或 `chore:`，概括修改的目的。

分支与发布流程见 [Git Workflow](docs/GIT_WORKFLOW.md)。安全漏洞请按 [Security Policy](SECURITY.md) 私密报告，不在公开 Issue 附带凭据或用户数据。
