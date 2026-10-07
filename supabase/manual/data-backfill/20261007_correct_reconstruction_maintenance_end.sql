-- 用户确认：10/15 06:00 开始维护，12:00 开启新版本。
-- 只修正绚丽异彩与点绘申领误填的版本开启时间，执行前备份 pools/site_config。
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.pools IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE
  pool public.pools;
  affected integer := 0;
BEGIN
  FOR pool IN SELECT * FROM public.pools
    WHERE pool_id IN ('rerun_chr_yvonne', 'rerun_wpn_yvonne') LOOP
    IF pool.type IS DISTINCT FROM 'extra'
      OR pool.extra_subtype NOT IN ('reconstruction', 'reconstruction_claim')
      OR pool.extra_subtype IS NULL
      OR pool.start_time IS DISTINCT FROM '2026-09-24T12:00:00+08:00'::timestamptz
      OR pool.end_time IS NULL
      OR pool.end_time NOT IN ('2026-10-15T12:00:00+08:00'::timestamptz,
                              '2026-10-15T06:00:00+08:00'::timestamptz) THEN
      RAISE EXCEPTION 'Pool contract changed: %', pool.pool_id;
    END IF;
    affected := affected + 1;
  END LOOP;
  IF affected <> 2 THEN
    RAISE EXCEPTION 'Expected two reconstruction pools, got %', affected;
  END IF;
  UPDATE public.pools
  SET end_time = '2026-10-15T06:00:00+08:00'::timestamptz, updated_at = now()
  WHERE pool_id IN ('rerun_chr_yvonne', 'rerun_wpn_yvonne')
    AND end_time = '2026-10-15T12:00:00+08:00'::timestamptz;
  UPDATE public.site_config
  SET value = jsonb_build_object(
    'version', floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint::text,
    'scope', 'public', 'reason', 'correct-reconstruction-maintenance-end', 'updatedAt', now()),
    updated_at = now()
  WHERE key = 'public_cache_epoch';
END;
$$;
COMMIT;
