BEGIN;

-- Existing owner snapshots predate luck v1 while already using statistics v6.
-- Limit by metadata before inspecting large JSON snapshots. Filtering payloads
-- before LIMIT causes a full TOAST scan even when asking for one owner.
CREATE OR REPLACE FUNCTION public.read_personal_luck_backfill_batch(p_after_scope text DEFAULT '', p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH candidates AS MATERIALIZED (
    SELECT j.scope_key, j.revision
    FROM public.statistics_jobs j JOIN public.statistics_snapshots s USING (scope_key)
    WHERE j.scope_key LIKE 'owner:%' AND j.scope_key > COALESCE(p_after_scope, '')
      AND s.schema_version = 'public-statistics-v6'
      AND j.revision = j.published_revision AND s.source_revision = j.revision
      AND (j.lease_until IS NULL OR j.lease_until < now())
    ORDER BY j.scope_key LIMIT LEAST(20, GREATEST(1, p_limit))
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('scopeKey', q.scope_key, 'revision', q.revision,
    'needsLuck', jsonb_typeof(s.payload) = 'object' AND COALESCE(s.payload->'luck'->>'version', '') <> '1',
    'hasAccounts', CASE WHEN jsonb_typeof(s.payload->'accounts') = 'array'
      THEN jsonb_array_length(s.payload->'accounts') > 0 ELSE true END) ORDER BY q.scope_key), '[]'::jsonb)
  FROM candidates q JOIN public.statistics_snapshots s USING (scope_key);
$$;

CREATE OR REPLACE FUNCTION public.publish_personal_luck_backfill(p_scope text, p_revision bigint, p_luck jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_job public.statistics_jobs; v_snapshot public.statistics_snapshots;
BEGIN
  IF p_scope IS NULL OR p_scope NOT LIKE 'owner:%'
    OR p_luck IS NULL OR jsonb_typeof(p_luck) <> 'object'
    OR p_luck->>'version' IS DISTINCT FROM '1'
    OR jsonb_typeof(p_luck->'accounts') IS DISTINCT FROM 'array'
    OR NULLIF(p_luck->>'fetchedAt', '') IS NULL THEN
    RAISE EXCEPTION 'Invalid personal luck result';
  END IF;
  -- Same lock order as normal statistics publication. Any import/catalog edit,
  -- active lease or concurrent publication prevents merging into older results.
  SELECT * INTO v_job FROM public.statistics_jobs WHERE scope_key = p_scope FOR UPDATE;
  IF NOT FOUND OR v_job.revision IS DISTINCT FROM p_revision
    OR v_job.published_revision IS DISTINCT FROM p_revision
    OR v_job.lease_until > now() THEN RETURN false; END IF;
  SELECT * INTO v_snapshot FROM public.statistics_snapshots WHERE scope_key = p_scope FOR UPDATE;
  IF NOT FOUND OR v_snapshot.schema_version <> 'public-statistics-v6'
    OR v_snapshot.source_revision IS DISTINCT FROM p_revision
    OR jsonb_typeof(v_snapshot.payload) IS DISTINCT FROM 'object'
    OR v_snapshot.payload->'luck'->>'version' = '1' THEN RETURN false; END IF;

  UPDATE public.statistics_snapshots
  SET payload = jsonb_set(payload, '{luck}', p_luck), source_revision = p_revision + 1
  WHERE scope_key = p_scope;
  UPDATE public.statistics_jobs SET revision = p_revision + 1, published_revision = p_revision + 1
  WHERE scope_key = p_scope;
  -- Preserve the other metrics' original computed_at/next_refresh_at. Luck has
  -- its own fetchedAt; the changed source revision invalidates browser caches.
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.read_personal_luck_backfill_batch(text, integer),
  public.publish_personal_luck_backfill(text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_personal_luck_backfill_batch(text, integer),
  public.publish_personal_luck_backfill(text, bigint, jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
