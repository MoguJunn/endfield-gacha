-- Catalog upserts fire both INSERT and UPDATE statement triggers. Recounting
-- all history again for groups can exceed PostgREST's 10-second timeout.
-- The preceding pool recount has already applied the exact eligibility filter;
-- sum those fresh counts for current visible members in the same transaction.
-- Character/roster edits change payloads, not eligible rows or visible members:
-- invalidate their revisions without recounting either pools or groups.
-- This rollout is optional; installations without its function remain unchanged.
BEGIN;
DO $migration$
DECLARE
  v_function regprocedure := to_regprocedure('public.invalidate_statistics_catalog()');
  v_definition text;
  v_entry text := E'BEGIN\n  INSERT INTO public.statistics_jobs(scope_key,total_pulls)';
  v_fast_path text := $fast$BEGIN
  IF TG_TABLE_NAME IN ('characters','pool_characters') THEN
    UPDATE public.statistics_jobs SET revision=revision+1 WHERE scope_key IS NOT NULL;
    RETURN NULL;
  END IF;
  INSERT INTO public.statistics_jobs(scope_key,total_pulls)$fast$;
  v_old text := $old$SELECT g.scope_key,count(h.id) FILTER (WHERE h.special_type IS DISTINCT FROM 'gift'
      AND h.rarity IN (4,5,6) AND nullif(btrim(h.game_uid::text),'') IS NOT NULL AND h.timestamp>to_timestamp(0))
    FROM public.statistics_group_keys() AS g(scope_key)
    LEFT JOIN public.statistics_group_members() m ON m.scope_key=g.scope_key
    LEFT JOIN public.history h ON h.pool_id=m.pool_id GROUP BY g.scope_key$old$;
  v_new text := $new$SELECT g.scope_key,COALESCE(sum(j.total_pulls),0)::bigint
    FROM public.statistics_group_keys() AS g(scope_key)
    LEFT JOIN public.statistics_group_members() m ON m.scope_key=g.scope_key
    LEFT JOIN public.statistics_jobs j ON j.scope_key='pool:'||m.pool_id
    GROUP BY g.scope_key$new$;
BEGIN
  IF v_function IS NULL THEN RETURN; END IF;
  v_definition := pg_get_functiondef(v_function);
  IF position(v_new IN v_definition)>0 AND position(v_fast_path IN v_definition)>0 THEN RETURN; END IF;
  -- The pre-group rollout has no group recount to optimize.
  IF position('statistics_group_members' IN v_definition)=0 THEN RETURN; END IF;
  IF position(v_old IN v_definition)=0 OR position(v_entry IN v_definition)=0 THEN
    RAISE EXCEPTION 'statistics catalog group recount contract unrecognized';
  END IF;
  EXECUTE replace(replace(v_definition,v_old,v_new),v_entry,v_fast_path);
END;
$migration$;
COMMIT;
NOTIFY pgrst, 'reload schema';
