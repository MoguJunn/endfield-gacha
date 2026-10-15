-- pools.id exists in production. Never reuse it as an unqualified PL/pgSQL
-- variable: catalog saves with a changed roster otherwise fail with 42702.
BEGIN;
CREATE OR REPLACE FUNCTION public.invalidate_changed_pool_roster() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_pool_id TEXT; v_roster_status TEXT;
BEGIN
  IF TG_OP='UPDATE' AND (OLD.pool_id,OLD.character_id,OLD.is_up) IS NOT DISTINCT FROM
      (NEW.pool_id,NEW.character_id,NEW.is_up) THEN RETURN NULL; END IF;
  FOR v_pool_id IN SELECT DISTINCT changed.pool_id FROM unnest(ARRAY_REMOVE(ARRAY[
    CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.pool_id END,
    CASE WHEN TG_OP='DELETE' THEN NULL ELSE NEW.pool_id END],NULL)) AS changed(pool_id) LOOP
    v_roster_status:=CASE WHEN EXISTS(
      SELECT 1 FROM public.pool_characters AS pc WHERE pc.pool_id=v_pool_id
    ) THEN 'partial' ELSE 'missing' END;
    UPDATE public.pools AS p SET roster_status=v_roster_status
    WHERE p.pool_id=v_pool_id AND p.roster_status IS DISTINCT FROM v_roster_status;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.invalidate_changed_pool_roster() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
