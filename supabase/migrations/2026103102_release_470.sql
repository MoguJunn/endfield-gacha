-- v4.7.0: synchronize runtime metadata and publish the bilingual release notice.
-- A stable notice ID makes this migration safe to apply again without duplicates.
BEGIN;

INSERT INTO public.site_config (key, value, label, category, updated_at)
VALUES
  ('site_version', 'v4.7.0', '站点版本', 'general', now()),
  ('build_info', 'Build 2026.10.31', '构建信息', 'general', now())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;

INSERT INTO public.announcements (
  id, title, content, title_en, content_en, version, is_active, priority
)
VALUES (
  '47000000-2026-4031-8470-000000000001',
  'v4.7.0 更新：手机新版首页、手气评价与统计优化',
  $zh$## 手机首页焕新

手机首页现已接入新版布局，集中展示版本信息、卡池日程、常用入口和社区内容，并优化窄屏浏览与触控操作。

## 个人统计与分享

- 个人概览新增手气评价与抽卡高光，可按账号查看角色、武器的表现。已有记录已完成后台补算，记录精度不足时仍会保留说明。
- 新增限定与复刻合并 UP 均抽，方便查看跨卡池的整体表现。
- 修正个人卡池分析、合池分析和时间线的不歪率：120 抽保障出货不再计入自然 UP 命中；不会改变实际出货数量和原始记录。
- 分享图同步时间线的排序、卡池筛选、卡片／瀑布流模式及五星显示设置，并补充保障、继承保底和武器十连信息。

## 导入与卡池浏览

- 改进第三方 Excel 解析，修复部分分析表导入为空和样式单元格导致的卡顿。
- 会话过期时自动尝试恢复，并保留待导入内容；官方导入提前检查游戏 UID，给出更清晰的角色缺失提示。
- 修复桌面与手机卡池分类折叠，优化比例导航；卡池正式开放后自动移除“前瞻”后缀。

## 缓存与刷新

公共目录和公开统计可保存在浏览器中重复使用；个人统计和卡池分析按快照版本更新。减少没有数据变化时的重复请求，公开导入高峰也不会持续触发前台刷新。

如仍看到旧页面，可刷新一次页面后再查看。感谢大家持续反馈问题。$zh$,
  'v4.7.0: New mobile home, luck ratings and statistics improvements',
  $en$## A refreshed mobile home

The mobile home now uses the new layout, bringing version information, banner schedules, shortcuts and community content together with improved small-screen and touch support.

## Personal statistics and sharing

- The personal overview now includes luck ratings and pull highlights for characters and weapons by account. Existing records have been processed in the background; limitations remain visible when the history lacks sufficient detail.
- Added a combined average pulls per UP result across limited and rerun banners.
- Corrected UP win rates in personal banner analysis, grouped analysis and timelines: the 120-pull guarantee is excluded from natural UP wins. Actual drop counts and original records are preserved.
- Share images now follow timeline sorting, banner selection, card/waterfall mode and the five-star visibility setting, with additional guarantee, inherited pity and weapon ten-pull details.

## Imports and banner browsing

- Improved third-party Excel parsing, fixing empty imports from some analysis sheets and slow parsing of styled cells.
- Expired sessions attempt to recover while retaining pending imports. Official imports check game UIDs earlier and explain missing game roles more clearly.
- Fixed banner category collapsing on desktop and mobile, improved ratio navigation, and automatically remove preview suffixes when banners open.

## Caching and refreshes

Public catalogs and statistics can be reused from browser storage. Personal statistics and banner analysis update when snapshot versions change, reducing repeated requests when data is unchanged and avoiding continuous foreground refreshes during busy public imports.

If an old page remains visible, refresh the page once. Thank you for your feedback.$en$,
  '4.7.0', true, 100
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  title_en = EXCLUDED.title_en,
  content_en = EXCLUDED.content_en,
  version = EXCLUDED.version,
  is_active = EXCLUDED.is_active,
  priority = EXCLUDED.priority,
  updated_at = now();

INSERT INTO public.site_config (key, value, label, category, updated_at)
VALUES (
  'public_cache_epoch',
  jsonb_build_object(
    'version', ((extract(epoch FROM clock_timestamp()) * 1000)::bigint)::text,
    'scope', 'public',
    'reason', 'release:4.7.0',
    'updatedAt', now()
  )::text,
  '公共缓存版本', 'system', now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;

NOTIFY pgrst, 'reload schema';
COMMIT;
