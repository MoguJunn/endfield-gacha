\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
\i /tmp/2026100701_weapon_character_pool_schedule.sql
\i /tmp/2026100701_weapon_character_pool_schedule.sql
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $$
DECLARE w public.pools; c text; rejected boolean := false;
BEGIN
  SELECT * INTO STRICT w FROM public.pools WHERE type='weapon' AND is_limited_weapon=true ORDER BY start_time LIMIT 1;
  SELECT pool_id INTO STRICT c FROM public.pools WHERE type='limited' ORDER BY start_time DESC LIMIT 1;
  PERFORM public.admin_upsert_pool_with_aliases(w.pool_id,to_jsonb(w),jsonb_build_object('character_pool_id',c),'[]','[]',w.user_id);
  IF (SELECT character_pool_id FROM public.pools WHERE pool_id=w.pool_id) IS DISTINCT FROM c THEN RAISE EXCEPTION 'RPC did not persist association'; END IF;
  BEGIN
    PERFORM public.admin_upsert_pool_with_aliases(w.pool_id,to_jsonb(w),jsonb_build_object('character_pool_id','standard'),'[]','[]',w.user_id);
  EXCEPTION WHEN SQLSTATE '22023' THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Non-limited association accepted'; END IF;
  PERFORM public.admin_upsert_pool_with_aliases(w.pool_id,to_jsonb(w),jsonb_build_object('character_pool_id',NULL,'is_limited_weapon',false),'[]','[]',w.user_id);
  IF (SELECT character_pool_id FROM public.pools WHERE pool_id=w.pool_id) IS NOT NULL THEN RAISE EXCEPTION 'Association was not cleared'; END IF;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
  rejected := false;
  BEGIN
    PERFORM public.admin_upsert_pool_with_aliases(w.pool_id,to_jsonb(w),'{}','[]','[]',w.user_id);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%super_admin%' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Anonymous RPC accepted'; END IF;
END;
$$;
ROLLBACK;
\echo 'weapon character pool association rollback verification passed'
