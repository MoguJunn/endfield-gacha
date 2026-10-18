# Release Checklist

这是下一次发布的可复用模板。只勾选本次实际执行的项目，并记录提交、日期和结果；按变更范围选择验证，不继承旧版本的勾选状态。

历史变化见 [v4.6.0](RELEASE_4.6.0.md)、[v4.6.2](RELEASE_4.6.2.md)、[v4.6.3](RELEASE_4.6.3.md)、[v4.6.4](RELEASE_4.6.4.md)。功能状态见 [项目进展](RECENT_DELIVERY_STATUS.md)，认证要求见 [认证专题](AUTH_SECURITY_HARDENING.md)。

## 代码与文件范围

- [ ] 版本号、构建信息和 changelog 与本次交付一致。
- [ ] 已完成受影响合同的局部测试，写明未执行的验证及原因。
- [ ] `npm run lint`。
- [ ] `npm run test:unit`（共享配置或跨模块变更需覆盖相关测试范围）。
- [ ] `npm run build`（包含主站和抽奖子应用）。
- [ ] 受影响的跟踪生成物已刷新，例如 `npm run share:renderer`。
- [ ] `git diff --check` 与 `git diff --cached --check`。
- [ ] 核对实际新增／删除文件、凭据、用户导出、一次性报告及纯换行差异，遵循 [仓库内容规范](REPOSITORY_LAYOUT.md)。

## 公共 API、缓存与自动化

只选择本次受影响的检查：

- [ ] `npm test`。
- [ ] `npm run test:public-api-boundary`。
- [ ] `npm run test:bootstrap-cache`。
- [ ] `npm run test:official-announcements-feed`／`test:pool-schedule-feed`。
- [ ] `npm run test:ops-automation`。
- [ ] `npm run perf:report`。
- [ ] 公共页面首屏、缓存版本与失效链符合当前合同。

## 数据库与个人分析

- [ ] 核对目标 schema、baseline 覆盖、前向顺序、活动候选重号及实际执行记录。
- [ ] 迁移变化后重生成 baseline，执行静态校验与必要的临时数据库真实验证。
- [ ] 相关 RPC 保持 owner、权限、timeout、原子保存、revision／lease 和作用域边界。
- [ ] 统计读端启用前，迁移、Worker 和对应计算版本快照已准备好，按 [调度合同](STATISTICS_SCHEDULING.md) 执行。
- [ ] 个人分析 schema version、投影字段与 Worker 输出一致，按 [Worker 合同](PERSONAL_ANALYSIS_WORKER.md) 核验。
- [ ] 涉及模拟器继承时核对当前个人分析 schema（目前为 5）、继承合同 2、编码 1／会话 2；覆盖零抽池共享水位、完整历史、免费／情报书使用和存档失败回滚，必要时运行 `test:simulator-v2:sql`／`test:simulator-v2:ui`。
- [ ] 涉及卡池目录或后台阵容时核对 `pool_characters` 完整关系、零记录池和超过 1,000 条的读取，运行 `test:pool-rosters:sql` 及后台／公开 API 回归；读取失败不得降级为空配置。
- [ ] 备份并同步个人分析 Vault 的不可变部署 URL，确认真实发布成功而非只有 HTTP 200；核对应急 Workflow 地址。已应用的快照失效迁移不重复执行。
- [ ] 已执行的手动数据修正不作为新环境初始化或常规发布步骤再次运行。

## 认证与私有用户数据

- [ ] 认证变更执行 `test:auth-hardening-phase-a`、`test:auth-hardening-phase-cd` 及相关 Session／provider 回归。
- [ ] 数据库权限、邮箱归属、一次性能力、撤销与并发合同符合 [认证专题](AUTH_SECURITY_HARDENING.md)。
- [ ] 每个 provider 独立完成真实浏览器验收；LinuxDo 外部条件恢复前保持关闭。
- [ ] 账号修复核对 operator 证据、用户本人验证与显式确认；不批量自动处理生产历史账号。
- [ ] 官方导入／历史编辑变化验证账号和区服作用域、原子写入、幂等、审计、乐观锁与保底重算。
- [ ] 后端变更另核对 CN／INTL 内容与健康，不能从主站版本推定私有部署完成。
- [ ] 数据回填先只读演练；实际执行满足精确范围与确认校验。

## 文件导入与手机交互

变更文件解析、保存或弹窗时选择相关检查，合同见 [文件导入恢复](FILE_IMPORT_RELIABILITY.md)：

- [ ] `node scripts/verify-data-format-registry.mjs` 与受影响的导入、导出、补录测试通过。
- [ ] 本机历史为空或只有部分记录时，仍核对服务端完整明细；owner 不符或截断响应不进入保存。
- [ ] 覆盖保存 400／2164 条后中断、回执数量不足、卡池保存失败及刷新失败；预览保留，重试只继续缺少记录，不重复并发提交。
- [ ] JSON／TXT 相互导入、倒序、半批、同批重复物品、明确／缺失免费属性及已有官方记录均按数量匹配；不同账号、区服或真实序号不误合并。
- [ ] TXT 导出再导入保留免费标记；不能把来源未提供的属性当作已确认事实。
- [ ] 手机 360×640、390×700 与横屏确认按钮能滚动到并实际接收点击，不被底部导航或通知遮挡；本机空历史配合非空账号快照时删除入口可用。
- [ ] 记录实际浏览器与模拟方式，不把 Chromium 手机模拟写成真实手机 Edge 验收；旧重复记录清理单独核对范围，不随代码发布自动执行。

## 文档与 Git

- [ ] README、专题、代码地图及数据库说明覆盖实际变化；UI 截图按需要更新。
- [ ] 符合 [Git Workflow](GIT_WORKFLOW.md) 的主题／发布分支与提交范围；不改写已推送 main。
- [ ] 部署目标、数据库变更及回退方式已由维护者确认。

## 部署与收尾

- [ ] GitHub-connected Vercel 部署成功，Production Ready，正式域名指向目标部署。
- [ ] 数据库先于依赖新字段／RPC 的 API；旧 Worker 切换、预热和恢复顺序有记录。
- [ ] 正式页面和受影响 API 已按实际权限验证，没有把登录跳转当作成功。
- [ ] 阵容 API 发布后核对 `partial / stale`、缓存版本与零记录卡池，确认旧的截断缓存已失效。
- [ ] `site_config.site_version`、`build_info` 与公共缓存版本已同步；中英文公告已发布并保留历史，两个正式域名的正文和版本与本次交付一致。
- [ ] 发布结果记录到对应版本说明及维护者交接文档，包含合并提交、CI／部署、迁移执行、快照及调度验证；不把尚未执行的操作写成已完成。
- [ ] 如有风险，备份、回退与后续观察范围明确，不把一次通过写成长期无异常保证。
