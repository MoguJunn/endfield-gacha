# 数据与体验待完善项

这里列出可继续改进的范围及已有工具。已发布功能见 [项目进展](RECENT_DELIVERY_STATUS.md)；设计方案和可运行代码的状态分别说明，避免把预览当成可用功能。

## 可贡献的方向

- **首次指南**：把状态样例连接到真实登录、导入、分析和备份，支持跳过、重看与失败恢复，见 [指南设计](ONBOARDING_GUIDE_PLAN.md)。
- **手机体验**：改进首页内容、触摸滚动和返回位置，定义移动模拟器的可用范围，见 [移动首页](MOBILE_HOME_PLAN.md)。
- **数据工作台**：手动补录尚未发布，集成时验证账号隔离、幂等、审计、统计消费和备份往返。
- **导出与数据质量**：完善多卡池筛选和日期交互；混合导入重复记录需先生成可审阅候选及回退方案。对象首获与任意六星硬保底不能混为一谈。
- **工单与开发者审核**：完善未读、内部备注、最后回复人、管理队列、审核记录和用户下一步提示；邮件入队失败不阻断原业务。
- **平台绑定**：分别验证 Discord／Telegram／QQ，覆盖解绑后 BOT 查询失效、权限拒绝及公开输出隐私，见 [绑定 API](integration-api.md)。
- **共享界面**：减少双端控制器重复，完善主题、动画、无障碍和通知状态；旧首页路线图默认值应与受维护数据一致。

跨账号分析目前关闭，同账号总览和所有账号原始记录导出保留。重新开放聚合前先定义指标与来源，见 [账号范围](ACCOUNT_ALL_CLOSEOUT.md)。小游戏平台独立维护，主站只保留拼图验证码及共享题库接口。

## 官方 ID 审计

手工占位 ID 可能仍被历史、阵容和卡池目录引用。迁移到官方 ID 时保留 alias，并检查外键、导出和回退，不直接删除占位对象。

基础审计只读取数据：

```bash
npm run audit:canonical-data:supabase -- --write-json supabase/manual/data-backfill/manual-placeholder-audit.json
npm run test:manual-placeholder-audit
```

报告的 `manualPlaceholderRetirement` 给出 alias 目标、引用计数与状态。`ready_to_merge` 只表示已有唯一 canonical target；`needs_official_id`、冲突 alias 或仍指向手工 ID 的对象需补齐证据。

大型库优先生成轻量快照：只读取目录、alias、阵容并按对象计数，不下载整张历史表。

```bash
npm run audit:manual-placeholder:production-snapshot -- --write-json supabase/manual/data-backfill/manual-placeholder-production-snapshot.generated.json
npm run generate:manual-placeholder-candidate-plan -- --audit supabase/manual/data-backfill/manual-placeholder-production-snapshot.generated.json --out supabase/manual/data-backfill/manual-placeholder-production-candidate-plan.generated.json
npm run test:manual-placeholder-candidate-plan
```

候选计划按名称、类型、UP 和日期提供 `review_only` 提示，不写库。确认唯一目标并维护 alias 后，再生成正式演练计划：

```bash
npm run generate:manual-placeholder-migration-plan -- --audit supabase/manual/data-backfill/manual-placeholder-audit.json --out supabase/manual/data-backfill/manual-placeholder-migration-plan.generated.json
npm run test:manual-placeholder-migration-plan
```

计划的 `writesDatabase` 恒为 `false`。每次使用当前目标数据重新生成，不能用旧报告代替现状。

## 受控 SQL 生成

```bash
npm run generate:manual-placeholder-apply-sql -- supabase/manual/data-backfill/manual-placeholder-migration-plan.generated.json supabase/manual/data-backfill/manual-placeholder-apply.generated.sql
npm run test:manual-placeholder-apply-sql
```

只生成 `ready` 项的更新，blocked 项不进入 SQL。结果包含确认 token、source／target／alias 检查、引用归零验证与缓存刷新，并默认以 `ROLLBACK` 结束；生成器不会自动执行 SQL。

实际应用前备份、审阅最新影响范围并确定变更窗口。确认检查全部通过后才选择事务提交；保留旧 alias 和恢复材料。审计 JSON 与生成执行 SQL 含目标环境信息，按 [仓库约定](REPOSITORY_LAYOUT.md) 留在本地。
