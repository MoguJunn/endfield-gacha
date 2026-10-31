-- 丹青渡改为 2026-11-25 维护，下一版本同日开启。
-- 执行前备份这两个卡池及 home_version_timeline/public_cache_epoch。
-- 版本末尾的寻访和到期申领在维护开始时结束，不延续到维护后的开服时间。
-- 只修改配置和日期，不修改历史记录、别名、阵容或未来未到期的武器池。
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $body$
DECLARE
  timeline jsonb;
  current_version jsonb;
  next_version jsonb;
  pool_row record;
BEGIN
  SELECT value::jsonb INTO STRICT timeline FROM public.site_config
    WHERE key = 'home_version_timeline' FOR UPDATE;
  SELECT v INTO STRICT current_version FROM jsonb_array_elements(timeline->'versions') v WHERE v->>'id' = 'version-7';
  SELECT v INTO STRICT next_version FROM jsonb_array_elements(timeline->'versions') v WHERE v->>'id' = 'version-8';
  IF (current_version->>'name' = '丹青渡'
    AND (current_version->>'starts_at')::timestamptz = '2026-10-15T12:00:00+08:00'::timestamptz
    AND (current_version->>'ends_at')::timestamptz IN ('2026-11-26T06:00:00+08:00'::timestamptz, '2026-11-25T06:00:00+08:00'::timestamptz)
    AND (next_version->>'starts_at')::timestamptz IN ('2026-11-26T12:00:00+08:00'::timestamptz, '2026-11-25T12:00:00+08:00'::timestamptz)) IS NOT TRUE THEN
    RAISE EXCEPTION 'Version 7/8 timeline differs from the reviewed schedule';
  END IF;

  IF (SELECT count(*) FROM public.pools WHERE pool_id IN (
    'weponbox_1_5_1', 'special_manual_limited_pool_us8t52_20261105_14pdl0')) <> 2 THEN
    RAISE EXCEPTION 'Reviewed closing pools are missing';
  END IF;
  FOR pool_row IN SELECT pool_id,name,type,up_character,start_time,end_time FROM public.pools WHERE pool_id IN (
    'weponbox_1_5_1', 'special_manual_limited_pool_us8t52_20261105_14pdl0') FOR UPDATE
  LOOP
    IF pool_row.end_time IS NULL OR pool_row.end_time NOT IN (
      '2026-11-26T12:00:00+08:00'::timestamptz, '2026-11-25T06:00:00+08:00'::timestamptz)
      OR (pool_row.pool_id = 'weponbox_1_5_1' AND (pool_row.type IS DISTINCT FROM 'weapon' OR pool_row.up_character IS DISTINCT FROM '寒夜幽影'))
      OR (pool_row.pool_id = 'special_manual_limited_pool_us8t52_20261105_14pdl0' AND (pool_row.type IS DISTINCT FROM 'limited' OR pool_row.up_character IS DISTINCT FROM '明河')) THEN
      RAISE EXCEPTION 'Pool % differs from the reviewed schedule', pool_row.pool_id;
    END IF;
  END LOOP;

  UPDATE public.pools SET end_time = '2026-11-25T06:00:00+08:00', updated_at = clock_timestamp()
    WHERE pool_id IN ('weponbox_1_5_1','special_manual_limited_pool_us8t52_20261105_14pdl0')
      AND end_time IS DISTINCT FROM '2026-11-25T06:00:00+08:00'::timestamptz;

  SELECT jsonb_set(timeline, '{versions}', jsonb_agg(
    CASE v->>'id'
      WHEN 'version-7' THEN v || jsonb_build_object('ends_at','2026-11-25T06:00:00+08:00','duration_days',41)
      WHEN 'version-8' THEN v || jsonb_build_object('starts_at','2026-11-25T12:00:00+08:00')
      ELSE v END ORDER BY ordinal)) INTO timeline
    FROM jsonb_array_elements(timeline->'versions') WITH ORDINALITY t(v,ordinal);
  UPDATE public.site_config SET value = timeline::text, updated_at = clock_timestamp()
    WHERE key = 'home_version_timeline' AND value::jsonb IS DISTINCT FROM timeline;

  INSERT INTO public.site_config(key,value,label,category,updated_at)
    VALUES ('public_cache_epoch',jsonb_build_object('version',extract(epoch FROM clock_timestamp())::text,
      'scope','all','reason','version-7-schedule-20261125','updatedAt',clock_timestamp())::text,
      '公共缓存版本','system',clock_timestamp())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
END
$body$;
COMMIT;
