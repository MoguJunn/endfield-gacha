-- Publish v4.7.1 runtime metadata and the established bilingual prose notice.
-- Deploy the CN QR service and frontend before applying this release notice.
BEGIN;

INSERT INTO public.site_config (key, value, label, category, updated_at)
VALUES
  ('site_version', 'v4.7.1', '站点版本', 'general', now()),
  ('build_info', 'Build 2026.11.07', '构建信息', 'general', now())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;

INSERT INTO public.announcements (
  id, title, content, title_en, content_en, version, is_active, priority, published_at
)
VALUES (
  '47100000-2026-4107-8471-000000000001',
  '终末地抽卡分析器 - v4.7.1 版本更新说明',
  $zh$亲爱的管理员：

终末地抽卡分析器 v4.7.1 已更新。本次新增国服扫码导入，调整了导入窗口与账号确认流程，并改善记录读取、文件导入和网络异常时的提示。

登录本站后，可在国服官方导入中选择扫码登录，使用森空岛、终末地或云·终末地 App 扫描二维码并在手机端确认。确认后，请核对游戏账号与区服，再开始导入记录，减少手动复制 Token 的操作。原有 Token 和文件导入方式继续保留，国际服仍使用原有导入方式。

扫码仅用于本次导入，不会在浏览器中保存官方登录凭证。离开导入窗口、取消或二维码过期后，临时扫码会话会清理；这不代表退出其他设备或撤销官方账号授权。如二维码失效，可重新生成后扫码。

导入窗口统一了扫码与 Token 登录的布局，将区服、导入模式、账号确认和处理进度整理到同一流程，并改善手机排版及深浅主题下提示文字的可读性。

本次加强了卡池目录与待保存记录的完整读取检查。遇到分页缺失、记录数量或顺序不一致时，会停止处理并给出提示，避免把未读完整的内容当作全部结果。所选官方账号缺少对应区服角色时，也会在导入前说明原因，方便管理员检查账号和区服。

文件导入现在会保留站内备份中缺少名称但仍有星级、时间或序号的记录，不会猜测其对应角色、武器或赠送类型；导入确认时会补充说明账号区服差异。网络超时、取消和跨区转发异常的处理也已改进，减少请求中断后含糊不清的提示。

如仍看到旧页面，可先刷新一次。如遇到扫码、账号选择或记录导入异常，请通过站内工单反馈发生时间、所选区服、操作步骤、设备及浏览器信息，方便我们核对；请勿在工单中提交 Token、登录凭证或二维码截图。

感谢管理员一直以来的关注与支持。

**Endfield Gacha Analyzer Dev Team**

*2026/11/07*$zh$,
  'Endfield Gacha Analyzer - v4.7.1 Update Notes',
  $en$Dear Endministrators,

Endfield Gacha Analyzer v4.7.1 is now available. This release adds QR sign-in for CN imports, refreshes the import window and account confirmation flow, and improves record loading, file imports, and messages when network requests fail.

After signing in to this site, select QR sign-in in the CN official import window and scan the code with the Skland, Endfield, or Cloud Endfield app. Confirm on your phone, then check the game account and server before importing records. This reduces the need to copy a Token manually. Token and file imports remain available, while international accounts continue to use the existing import methods.

QR sign-in is used only for the current import, and official sign-in credentials are not saved in the browser. Temporary QR sessions are cleared when you leave the import window, cancel, or the code expires; this does not sign out other devices or revoke authorization on your official account. If a code expires, generate a new one and scan again.

The import window now brings QR and Token sign-in into a consistent layout, with server selection, import mode, account confirmation, and progress in one flow. Mobile layouts and message readability in light and dark themes have also been improved.

This update strengthens completeness checks when reading banner catalogs and records waiting to be saved. Missing pages or inconsistent record counts or ordering stop processing with an explanation, so an incomplete response is not treated as a complete result. If the selected official account has no game role on the chosen server, the import now explains this before proceeding.

File imports now preserve site-backup records that have no item name but still contain rarity, time, or sequence information, without guessing an operator, weapon, or gift type. Import confirmation also explains account and server differences. Timeout, cancellation, and cross-region forwarding error handling have been improved to make interrupted requests easier to understand.

If an old page remains visible, refresh the page once. If you encounter a QR sign-in, account selection, or import issue, please submit a support ticket with the time, selected server, steps, device, and browser. Please do not include Tokens, sign-in credentials, or QR screenshots.

Thank you for your continued support.

**Endfield Gacha Analyzer Dev Team**

*2026/11/07*$en$,
  '4.7.1', true, 1, now()
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  title_en = EXCLUDED.title_en,
  content_en = EXCLUDED.content_en,
  version = EXCLUDED.version,
  is_active = EXCLUDED.is_active,
  priority = EXCLUDED.priority,
  published_at = COALESCE(public.announcements.published_at, EXCLUDED.published_at),
  updated_at = now();

INSERT INTO public.site_config (key, value, label, category, updated_at)
VALUES (
  'public_cache_epoch',
  jsonb_build_object(
    'version', ((extract(epoch FROM clock_timestamp()) * 1000)::bigint)::text,
    'scope', 'public',
    'reason', 'release:4.7.1',
    'updatedAt', now()
  )::text,
  '公共缓存版本', 'system', now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;

COMMIT;
