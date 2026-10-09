## 变更摘要

-

## 影响范围

-

## 验证

- [ ] `npm run lint`
- [ ] `npm run test:unit`
- [ ] `npm run build`
- [ ] `npm test`
- [ ] `git diff --check`
- [ ] 已运行受影响的生成命令，并提交仓库跟踪的生成产物（如适用）
- [ ] 已核对实际文件清单，没有环境凭据、用户导出、临时报告或纯换行差异

<!-- 纯文档整理填写链接和差异检查即可；没有执行的验证请说明原因，不继承旧测试勾选。 -->

涉及认证或数据库时：

- [ ] 已说明当前 baseline 覆盖范围、前向迁移顺序和共享生产迁移记录
- [ ] 已核对其他活动 worktree 的同号候选，且未把历史迁移尾号当作当前编号依据
- [ ] 已重新生成／验证 baseline，并在临时 PostgreSQL 中执行相关小范围真实测试／合同测试
- [ ] 已运行 Phase A/B 与 Phase C/D 认证专项验证
- [ ] 已区分本地测试、真实浏览器回归、授权后集成和生产部署状态
- [ ] 未提交 identity key、OAuth secret、邮箱 challenge、临时凭据或真实邮箱数据

涉及个人分析快照或 Worker 时：

- [ ] Worker、migration `analysis_schema_version` 与 API 投影使用同一 schema version
- [ ] owner/account、聚合 `viewKey`、全池筛选桶及 `simulatorInheritance` 合同已有针对性验证
- [ ] 存量重建已说明旧 Worker 暂停、不可变部署切换、cron／主动唤醒恢复及 revision／lease／HTTP 2xx 核验

涉及贡献者内容沙盒时：

- [ ] synthetic 身份仍无真实用户、token、Cookie Session 或生产写权限
- [ ] 公共字段／媒体主机采用白名单，本地持久化有 schema／容量保护
- [ ] 已运行 `npm run test:contributor-demo:ui`，或说明本次未运行的原因

## 截图 / 录屏

-

## 部署说明

-

## 回滚说明

-
