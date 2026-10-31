-- Match the established bilingual release-note format without creating a new notice.
BEGIN;

UPDATE public.announcements
SET title = '终末地抽卡分析器 - v4.7.0 版本更新说明',
    content = $zh$亲爱的管理员：

终末地抽卡分析器 v4.7.0 已更新。本次更新了手机首页，新增个人手气评价与抽卡高光，并改善时间线分享、记录导入和统计刷新体验。

手机首页现已采用新版布局，将版本信息、卡池日程、常用入口和社区内容集中展示，并调整窄屏排版与触控操作，方便管理员在手机上浏览当前寻访与版本资讯。

个人概览新增手气评价与抽卡高光，可按游戏账号分别查看角色和武器的表现。已有记录已完成补算；如果历史记录缺少足够精度，页面仍会保留对应说明。限定与复刻还可合并查看 UP 均抽，方便了解跨卡池的整体表现。

本次修正了个人卡池分析、合池分析和时间线的不歪率口径。120 抽保障出货不再计入自然 UP 命中，实际出货数量与原始记录保持不变，避免保障结果影响对寻访手气的判断。

分享图现会跟随时间线的排序、卡池筛选、卡片或瀑布流模式，以及五星显示设置，并同步展示保障出货、继承保底、武器十连和出货时间，减少页面与分享图片之间的差异。

记录导入改善了第三方 Excel 的解析，修复部分分析表导入为空及样式单元格引起的卡顿。会话过期时会尝试自动恢复并保留待导入内容；官方导入也会提前检查游戏 UID，在所选区服角色资料缺失时给出更清晰的提示。

桌面与手机的卡池分类折叠已修复，并改善比例导航；卡池正式开放后，会自动移除名称中的“前瞻”后缀。公共目录和公开统计可在当前浏览器中重复使用，个人统计与卡池分析会在数据版本变化时更新，减少重复加载，公开导入高峰也不会持续触发前台刷新。

如仍看到旧页面，可先刷新一次。如遇到首页显示、手气评价、分享或导入异常，请通过站内工单反馈所在页面、所选账号区服、卡池、操作步骤、设备及浏览器信息，方便我们核对。

感谢管理员一直以来的关注与支持。

**Endfield Gacha Analyzer Dev Team**

*2026/10/31*$zh$,
    title_en = 'Endfield Gacha Analyzer - v4.7.0 Update Notes',
    content_en = $en$Dear Endministrators,

Endfield Gacha Analyzer v4.7.0 is now available. This release refreshes the mobile home, adds personal luck ratings and pull highlights, and improves timeline sharing, record imports, and statistics refreshes.

The mobile home now uses the new layout, bringing version information, banner schedules, shortcuts, and community content together. Small-screen layouts and touch controls have been adjusted to make current banners and version news easier to browse on mobile.

The personal overview now includes luck ratings and pull highlights for operators and weapons, separated by game account. Existing records have been processed; when history lacks sufficient detail, the page continues to explain those limitations. Limited and rerun banners can also be combined to show the average pulls per UP result across banners.

This update corrects UP win rates in personal banner analysis, grouped analysis, and timelines. Results from the 120-pull guarantee are excluded from natural UP wins, while actual drop counts and original records are preserved, so guaranteed results do not distort the assessment of pull luck.

Share images now follow timeline sorting, banner selection, card or waterfall mode, and the five-star visibility setting. They also show guaranteed results, inherited pity, weapon ten-pulls, and acquisition times, bringing shared images closer to the timeline shown on the page.

Third-party Excel parsing has been improved, fixing empty imports from some analysis sheets and slow parsing of styled cells. Expired sessions attempt to recover while retaining pending imports. Official imports also check game UIDs earlier and provide clearer messages when the selected server's game role is missing.

Banner category collapsing has been fixed on desktop and mobile, with improved ratio navigation. Preview suffixes are removed automatically when banners open. Public catalogs and statistics can be reused within the current browser, while personal statistics and banner analysis update when their data versions change, reducing repeated loading and avoiding continuous foreground refreshes during busy public imports.

If an old page remains visible, refresh the page once. If you encounter a home display, luck rating, sharing, or import issue, please submit a support ticket with the page, selected account's server, banner, steps, device, and browser.

Thank you for your continued support.

**Endfield Gacha Analyzer Dev Team**

*2026/10/31*$en$,
    priority = 1,
    published_at = COALESCE(published_at, created_at),
    updated_at = now()
WHERE id = '47000000-2026-4031-8470-000000000001' AND version = '4.7.0';

UPDATE public.site_config
SET value = jsonb_build_object(
      'version', ((extract(epoch FROM clock_timestamp()) * 1000)::bigint)::text,
      'scope', 'announcements',
      'reason', 'release:4.7.0-announcement-format',
      'updatedAt', now()
    )::text,
    updated_at = now()
WHERE key = 'public_cache_epoch';

COMMIT;
