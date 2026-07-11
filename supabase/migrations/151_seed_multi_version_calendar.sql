-- 151: 多版本日历元数据与历史版本快照
--
-- version_number 是游戏展示版本号；revision 仍只表示同一版本快照的修订号。
-- 历史版本暂只录入已知卡池，因此 activitiesComplete=false 由前端展示“活动待补充”。

ALTER TABLE public.version_content_snapshots
  ADD COLUMN IF NOT EXISTS version_number TEXT;

COMMENT ON COLUMN public.version_content_snapshots.version_number IS
  '面向用户展示的游戏版本号，例如 1、5；与快照 revision 无关';

UPDATE public.version_content_snapshots
SET
  version_key = 'version-5',
  version_number = '5',
  title = '向渊行',
  starts_at = '2026-07-16T12:00:00+08:00'::TIMESTAMPTZ,
  ends_at = '2026-09-02T06:00:00+08:00'::TIMESTAMPTZ,
  content = jsonb_set(
    jsonb_set(content, '{activitiesComplete}', 'true'::JSONB, true),
    '{emptyMessage}',
    '"活动待补充"'::JSONB,
    true
  ),
  updated_at = NOW()
WHERE version_key = 'xiangyuan-2026';

INSERT INTO public.version_content_snapshots (
  version_key,
  version_number,
  revision,
  title,
  starts_at,
  ends_at,
  content,
  pool_bindings,
  source_meta,
  is_active,
  published_at
)
VALUES
  (
    'version-1',
    '1',
    1,
    '零号委托',
    '2026-01-22T03:00:00+00:00'::TIMESTAMPTZ,
    '2026-03-12T05:57:36+08:00'::TIMESTAMPTZ,
    '{"activitiesComplete":false,"emptyMessage":"活动待补充","events":[]}'::JSONB,
    '{}'::JSONB,
    '{"source":"site_config.home_version_timeline","note":"历史活动待继续整理"}'::JSONB,
    TRUE,
    NOW()
  ),
  (
    'version-2',
    '2',
    1,
    '新潮起，故渊离',
    '2026-03-12T04:00:00+00:00'::TIMESTAMPTZ,
    '2026-04-17T06:00:00+08:00'::TIMESTAMPTZ,
    '{"activitiesComplete":false,"emptyMessage":"活动待补充","events":[]}'::JSONB,
    '{}'::JSONB,
    '{"source":"site_config.home_version_timeline","note":"历史活动待继续整理"}'::JSONB,
    TRUE,
    NOW()
  ),
  (
    'version-3',
    '3',
    1,
    '春晓时',
    '2026-04-17T04:00:00+00:00'::TIMESTAMPTZ,
    '2026-06-05T12:00:00+08:00'::TIMESTAMPTZ,
    '{"activitiesComplete":false,"emptyMessage":"活动待补充","events":[]}'::JSONB,
    '{}'::JSONB,
    '{"source":"site_config.home_version_timeline","note":"历史活动待继续整理"}'::JSONB,
    TRUE,
    NOW()
  ),
  (
    'version-4',
    '4',
    1,
    '寻遗散记',
    '2026-06-05T04:00:00+00:00'::TIMESTAMPTZ,
    '2026-07-16T06:00:00+08:00'::TIMESTAMPTZ,
    '{"activitiesComplete":false,"emptyMessage":"活动待补充","events":[]}'::JSONB,
    '{}'::JSONB,
    '{"source":"site_config.home_version_timeline","nameEn":"Lost Heirlooms","note":"历史活动待继续整理"}'::JSONB,
    TRUE,
    NOW()
  )
ON CONFLICT (version_key, revision) DO UPDATE
SET
  version_number = EXCLUDED.version_number,
  title = EXCLUDED.title,
  starts_at = EXCLUDED.starts_at,
  ends_at = EXCLUDED.ends_at,
  content = EXCLUDED.content,
  source_meta = EXCLUDED.source_meta,
  is_active = EXCLUDED.is_active,
  published_at = COALESCE(
    public.version_content_snapshots.published_at,
    EXCLUDED.published_at
  ),
  updated_at = NOW();

-- 保证尚未升级的旧版公开接口仍会优先选择最新版本，而不是刚补录的历史快照。
UPDATE public.version_content_snapshots
SET published_at = starts_at
WHERE version_key IN ('version-1', 'version-2', 'version-3', 'version-4')
  AND revision = 1;

UPDATE public.version_content_snapshots
SET
  version_number = COALESCE(version_number, '5'),
  title = '向渊行',
  starts_at = COALESCE(starts_at, '2026-07-16T12:00:00+08:00'::TIMESTAMPTZ),
  ends_at = '2026-09-02T06:00:00+08:00'::TIMESTAMPTZ,
  content = jsonb_set(
    jsonb_set(content, '{activitiesComplete}', 'true'::JSONB, true),
    '{emptyMessage}',
    '"活动待补充"'::JSONB,
    true
  ),
  is_active = TRUE,
  updated_at = NOW()
WHERE version_key = 'version-5';

CREATE INDEX IF NOT EXISTS idx_version_content_snapshots_active_starts_at
  ON public.version_content_snapshots (starts_at)
  WHERE is_active = TRUE;
