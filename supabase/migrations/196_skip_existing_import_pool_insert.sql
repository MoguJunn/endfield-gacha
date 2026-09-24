-- An INSERT ... ON CONFLICT DO NOTHING still fires statement-level catalog
-- triggers when every pool exists. Avoid that statement entirely on reimports.
-- Preserve the deployed atomic history/task and pool-version contracts.
DO $migration$
DECLARE
  v_definition TEXT;
  v_original TEXT := '  INSERT INTO public.pools (';
  v_guard TEXT := $guard$  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_pools) AS candidate(value)
    WHERE NULLIF(btrim(candidate.value->>'pool_id'), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.pools AS existing
        WHERE existing.pool_id = candidate.value->>'pool_id'
      )
  ) THEN
  INSERT INTO public.pools ($guard$;
BEGIN
  v_definition := pg_get_functiondef('public.commit_official_import_records(uuid,uuid,jsonb,jsonb)'::REGPROCEDURE);
  IF position('FROM jsonb_array_elements(v_pools) AS candidate(value)' IN v_definition) > 0 THEN
    RETURN;
  END IF;
  IF position(v_original IN v_definition) = 0
    OR position('  GET DIAGNOSTICS v_pool_count = ROW_COUNT;' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'official import pool insertion contract unrecognized';
  END IF;
  v_definition := replace(v_definition, v_original, v_guard);
  v_definition := replace(v_definition,
    '  GET DIAGNOSTICS v_pool_count = ROW_COUNT;',
    E'  GET DIAGNOSTICS v_pool_count = ROW_COUNT;\n  END IF;');
  EXECUTE v_definition;
END;
$migration$;

NOTIFY pgrst, 'reload schema';
