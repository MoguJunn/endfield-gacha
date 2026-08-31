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

涉及认证或数据库时：

- [ ] 已说明当前 baseline 覆盖范围、前向迁移顺序和共享生产迁移记录
- [ ] 已核对其他活动 worktree 的同号候选，且未把历史迁移尾号当作当前编号依据
- [ ] 已重新生成/验证 baseline，并在临时 PostgreSQL 中执行相关 smoke / 合同测试
- [ ] 已运行 Phase A/B 与 Phase C/D 认证专项验证
- [ ] 已区分本地测试、真实浏览器回归、授权后集成和生产部署状态
- [ ] 未提交 identity key、OAuth secret、邮箱 challenge、临时凭据或真实邮箱数据

## 截图 / 录屏

-

## 部署说明

-

## 回滚说明

-
