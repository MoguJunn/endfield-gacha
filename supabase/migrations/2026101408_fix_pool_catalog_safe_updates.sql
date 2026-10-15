-- Explicit predicates keep catalog invalidation compatible with safeupdate.
-- Every owner/scope must still be invalidated: catalog ordering can affect
-- inherited resources even when the changed pool contains no stored history.
BEGIN;
CREATE OR REPLACE FUNCTION public.invalidate_personal_analysis_after_pool_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    OLD.pool_id, OLD.name, OLD.name_en, OLD.type, OLD.locked, OLD.user_id,
    OLD.up_character, OLD.is_limited_weapon, OLD.featured_characters,
    OLD.description, OLD.banner_url, OLD.start_time, OLD.end_time,
    OLD.extra_subtype, OLD.extra_rule_profile, OLD.extra_series_key, OLD.extra_series_phase
  ) IS NOT DISTINCT FROM (
    NEW.pool_id, NEW.name, NEW.name_en, NEW.type, NEW.locked, NEW.user_id,
    NEW.up_character, NEW.is_limited_weapon, NEW.featured_characters,
    NEW.description, NEW.banner_url, NEW.start_time, NEW.end_time,
    NEW.extra_subtype, NEW.extra_rule_profile, NEW.extra_series_key, NEW.extra_series_phase
  ) THEN
    RETURN NULL;
  END IF;
  UPDATE public.personal_analysis_owner_state
  SET history_revision=history_revision+1,
      dirty_since=COALESCE(dirty_since,statement_timestamp()),last_error=NULL
  WHERE user_id IS NOT NULL;
  UPDATE public.personal_analysis_scope_state
  SET history_revision=history_revision+1,
      dirty_since=COALESCE(dirty_since,statement_timestamp()),last_error=NULL
  WHERE user_id IS NOT NULL;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.invalidate_personal_analysis_after_pool_change()
  FROM PUBLIC,anon,authenticated;

-- Saving a name must not delete/reinsert the identical roster. Every roster
-- row change otherwise updates its parent pool and repeats catalog recounts.
DO $$
DECLARE definition TEXT; original TEXT; replacement TEXT;
BEGIN
  definition:=replace(pg_get_functiondef('public.admin_save_pool_catalog(text,jsonb,jsonb,jsonb,jsonb,uuid)'::regprocedure),chr(13),'');
  original:=$old$  DELETE FROM public.pool_characters WHERE pool_id = p_pool_id;
  INSERT INTO public.pool_characters (pool_id, character_id, is_up)
  SELECT p_pool_id, r->>'character_id', COALESCE((r->>'is_up')::BOOLEAN, FALSE)
  FROM jsonb_array_elements(p_pool_character_rows) r;$old$;
  replacement:=$new$  IF EXISTS (
    SELECT character_id,is_up FROM public.pool_characters WHERE pool_id=p_pool_id
    EXCEPT SELECT r->>'character_id',COALESCE((r->>'is_up')::BOOLEAN,FALSE)
      FROM jsonb_array_elements(p_pool_character_rows) r
  ) OR EXISTS (
    SELECT r->>'character_id',COALESCE((r->>'is_up')::BOOLEAN,FALSE)
      FROM jsonb_array_elements(p_pool_character_rows) r
    EXCEPT SELECT character_id,is_up FROM public.pool_characters WHERE pool_id=p_pool_id
  ) THEN
    DELETE FROM public.pool_characters WHERE pool_id = p_pool_id;
    INSERT INTO public.pool_characters (pool_id, character_id, is_up)
    SELECT p_pool_id, r->>'character_id', COALESCE((r->>'is_up')::BOOLEAN, FALSE)
    FROM jsonb_array_elements(p_pool_character_rows) r;
  END IF;$new$;
  IF position(original IN definition)=0 THEN RAISE EXCEPTION 'pool_catalog_roster_save_definition_changed';END IF;
  EXECUTE replace(definition,original,replacement);
END $$;
COMMIT;
