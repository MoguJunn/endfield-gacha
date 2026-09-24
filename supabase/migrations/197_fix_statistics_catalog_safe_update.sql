-- The optional statistics rollout can remain deployed after the application
-- rollback. Its catalog trigger must work under PostgREST's safeupdate library.
DO $migration$
DECLARE
  v_function REGPROCEDURE := to_regprocedure('public.invalidate_statistics_catalog()');
  v_definition TEXT;
  v_old TEXT := 'UPDATE public.statistics_jobs SET revision=revision+1;';
  v_new TEXT := 'UPDATE public.statistics_jobs SET revision=revision+1 WHERE scope_key IS NOT NULL;';
BEGIN
  IF v_function IS NULL THEN RETURN; END IF;
  v_definition := pg_get_functiondef(v_function);
  IF position(v_new IN v_definition) > 0 THEN RETURN; END IF;
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'statistics catalog revision update contract unrecognized';
  END IF;
  -- scope_key is the non-null primary key: every job is still invalidated.
  EXECUTE replace(v_definition, v_old, v_new);
END;
$migration$;
NOTIFY pgrst, 'reload schema';
