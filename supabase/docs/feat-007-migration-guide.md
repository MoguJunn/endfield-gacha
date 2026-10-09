# 早期目录与卡池 ID 迁移索引

本文记录早期 `027–030` 的结构演变。现行初始化与数据维护使用下方专题，不单独执行这些历史迁移。

## 历史来源

- [027_add_character_info.sql](../archive/migrations/027_add_character_info.sql)：当时为历史增加角色显示字段。
- [028_create_characters_table.sql](../archive/migrations/028_create_characters_table.sql)：建立角色／武器目录。
- [029_enhance_pools_metadata.sql](../archive/migrations/029_enhance_pools_metadata.sql)：补充卡池元数据。
- [030_migrate_pool_ids.sql](../archive/migrations/030_migrate_pool_ids.sql)：当时的池 ID 迁移兼容层。

这些来源已经纳入完整基线，不单独复制到当前数据库执行。初代种子仅供旧 ID 对照，位于 [manual/legacy](../manual/legacy/20260117_initial_catalog_seed.sql)。

## 现行维护入口

- 新环境 schema 与前向顺序：[Supabase Schema Guide](../README.md)。
- ID 审计、人工映射、演练计划与受控回填：[数据待完善项](../../docs/CLOSEOUT_LEDGER.md)。
- 退役就绪检查：`npm run audit:canonical-retirement-readiness`。报告结合真实审计、运行时、schema 与工具引用，不能仅凭本文变短认定字段可以移除。

`history.character_id`／`legacy_pool_id` 的保留与退役必须核对当前 schema、实际引用和数据审计。本文不提供生产执行步骤，不再维护独立于上述入口的部署合同。
