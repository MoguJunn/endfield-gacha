-- 189: remove the leaked limited_character placeholder and reject pool type
-- names when they are submitted as globally visible pool IDs.

BEGIN;

DO $$
DECLARE
  dependent_row_count BIGINT;
BEGIN
  SELECT
    (SELECT COUNT(*) FROM public.history WHERE pool_id = 'limited_character')
    + (SELECT COUNT(*) FROM public.history_anomalies WHERE pool_id = 'limited_character')
    + (SELECT COUNT(*) FROM public.official_import_staged_records WHERE pool_id = 'limited_character')
    + (SELECT COUNT(*) FROM public.pool_characters WHERE pool_id = 'limited_character')
    + (SELECT COUNT(*) FROM public.public_pool_analytics_cache WHERE pool_id = 'limited_character')
    + (SELECT COUNT(*) FROM public.public_pool_trend_cache WHERE pool_id = 'limited_character')
  INTO dependent_row_count;

  IF dependent_row_count > 0 THEN
    RAISE EXCEPTION
      'Refusing to remove limited_character: found % dependent business rows',
      dependent_row_count;
  END IF;
END;
$$;

DELETE FROM public.pools
WHERE pool_id = 'limited_character'
  AND name = 'limited_character'
  AND type = 'limited'
  AND locked = FALSE
  AND up_character IS NULL
  AND featured_characters IS NULL
  AND start_time IS NULL
  AND end_time IS NULL;

ALTER TABLE public.pools
  DROP CONSTRAINT IF EXISTS pools_reject_type_sentinel_ids_check;

ALTER TABLE public.pools
  ADD CONSTRAINT pools_reject_type_sentinel_ids_check
  CHECK (
    LOWER(BTRIM(pool_id)) <> ALL (
      ARRAY[
        'limited',
        'limited_character',
        'limited_weapon',
        'weapon',
        'extra',
        'joint'
      ]::TEXT[]
    )
  );

UPDATE public.site_config
SET
  value = jsonb_build_object(
    'version', ((EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT)::TEXT,
    'scope', 'pool-catalog',
    'reason', 'migration:189_remove_pool_type_sentinel_record',
    'updatedAt', clock_timestamp()
  )::TEXT,
  updated_at = NOW()
WHERE key = 'public_cache_epoch';

COMMIT;

NOTIFY pgrst, 'reload schema';
