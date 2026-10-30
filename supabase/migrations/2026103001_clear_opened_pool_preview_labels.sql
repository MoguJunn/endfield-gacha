-- 开池后的“前瞻”只属于展示标记；名称更新不改变卡池身份、别名或历史。
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.strip_pool_preview_label(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog AS $$
  SELECT COALESCE(NULLIF(btrim(regexp_replace(p_name,
    '([[:space:]]*[(（][[:space:]]*前瞻[[:space:]]*[)）][[:space:]]*)+$', '')), ''), p_name)
$$;

CREATE OR REPLACE FUNCTION public.normalize_opened_pool_preview_label()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.start_time IS NOT NULL AND NEW.start_time <= statement_timestamp() THEN
    NEW.name := public.strip_pool_preview_label(NEW.name);
    NEW.name_en := public.strip_pool_preview_label(NEW.name_en);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_opened_pool_preview_label ON public.pools;
CREATE TRIGGER normalize_opened_pool_preview_label
  BEFORE INSERT OR UPDATE OF name, name_en, start_time ON public.pools
  FOR EACH ROW EXECUTE FUNCTION public.normalize_opened_pool_preview_label();

CREATE OR REPLACE FUNCTION public.clear_opened_pool_preview_labels()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public SET lock_timeout = '5s' AS $$
DECLARE
  changed integer;
  checked_at timestamptz := clock_timestamp();
BEGIN
  UPDATE public.pools
  SET name = public.strip_pool_preview_label(name),
      name_en = public.strip_pool_preview_label(name_en),
      updated_at = checked_at
  WHERE start_time IS NOT NULL AND start_time <= checked_at
    AND (name IS DISTINCT FROM public.strip_pool_preview_label(name)
      OR name_en IS DISTINCT FROM public.strip_pool_preview_label(name_en));
  GET DIAGNOSTICS changed = ROW_COUNT;

  IF changed > 0 THEN
    INSERT INTO public.site_config(key, value, label, category, updated_at)
    VALUES ('public_cache_epoch', jsonb_build_object(
      'version', extract(epoch FROM checked_at)::text,
      'scope', 'pools', 'reason', 'opened-pool-preview-labels', 'updatedAt', checked_at)::text,
      '公共缓存版本', 'system', checked_at)
    ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
  END IF;
  RETURN changed;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_opened_pool_preview_label(), public.clear_opened_pool_preview_labels()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_opened_pool_preview_labels()
  TO service_role;

-- 补齐当前已开池；之后每分钟处理时间跨过开池点的条目。
SELECT public.clear_opened_pool_preview_labels();
DO $schedule$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('clear-opened-pool-preview-labels', '* * * * *',
      'SET statement_timeout = ''30s''; SELECT public.clear_opened_pool_preview_labels();');
  ELSE
    -- 与现有 baseline 验证保持一致：无 pg_cron 的隔离测试库不创建调度。
    RAISE NOTICE 'pg_cron unavailable: opened pool preview label scheduler not installed';
  END IF;
END;
$schedule$;
COMMIT;
