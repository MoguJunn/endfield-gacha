-- Display metadata is read from the catalog, not an analysis input. Catalog
-- writes invalidate only referenced accounts and their cross-pool dependencies.
BEGIN;
CREATE FUNCTION public.statistics_pool_group(p_pool JSONB) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
  SELECT CASE
    WHEN p_pool->>'type' IN ('limited','limited_character') THEN 'group:limited'
    WHEN p_pool->>'type' IN ('weapon','limited_weapon') THEN
      CASE WHEN (p_pool->>'is_limited_weapon')::BOOLEAN IS DISTINCT FROM FALSE
        THEN 'group:weapon_limited' ELSE 'group:weapon_standard' END
    WHEN p_pool->>'type'='extra' AND p_pool->>'extra_subtype'='reconstruction'
      AND p_pool->>'extra_rule_profile'='reconstruction_weapon_v1' THEN 'group:extra:reconstruction_claim'
    WHEN p_pool->>'type'='extra' AND p_pool->>'extra_subtype' IN ('reconstruction','reconstruction_claim')
      THEN 'group:extra:'||(p_pool->>'extra_subtype') END;
$$;

CREATE FUNCTION public.invalidate_pool_statistics_dependencies(
  p_pool_ids TEXT[], p_recount_ids TEXT[] DEFAULT '{}', p_group_keys TEXT[] DEFAULT '{}'
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE accounts JSONB; dependent_ids TEXT[];
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(a)),'[]'::JSONB) INTO accounts FROM (
    SELECT DISTINCT h.user_id,btrim(h.game_uid::TEXT) AS game_uid,h.server_scope
    FROM public.history h WHERE h.pool_id=ANY(p_pool_ids)
  ) a;
  SELECT ARRAY(SELECT DISTINCT pool_id FROM (
    SELECT unnest(p_pool_ids) AS pool_id
    UNION
    SELECT d.pool_id FROM jsonb_to_recordset(accounts) a(user_id UUID,game_uid TEXT,server_scope TEXT)
    CROSS JOIN LATERAL public.statistics_account_pool_dependencies(a.user_id,a.game_uid,a.server_scope) d
    WHERE NULLIF(a.game_uid,'') IS NOT NULL
  ) dependencies WHERE NULLIF(pool_id,'') IS NOT NULL) INTO dependent_ids;

  -- Retain the history trigger's owner -> scope lock order, and include private
  -- manual/legacy accounts even when their rows are excluded from public data.
  UPDATE public.personal_analysis_owner_state s
  SET history_revision=s.history_revision+1,
      dirty_since=COALESCE(s.dirty_since,statement_timestamp()),last_error=NULL
  WHERE s.user_id IN (SELECT a.user_id FROM jsonb_to_recordset(accounts) a(user_id UUID));
  UPDATE public.personal_analysis_scope_state s
  SET history_revision=s.history_revision+1,
      dirty_since=COALESCE(s.dirty_since,statement_timestamp()),last_error=NULL
  WHERE EXISTS (SELECT 1 FROM jsonb_to_recordset(accounts) a(user_id UUID,game_uid TEXT,server_scope TEXT)
    WHERE s.user_id=a.user_id
      AND s.scope_game_uid=public.normalize_personal_analysis_game_uid(a.user_id,a.game_uid)
      AND s.server_scope=COALESCE(NULLIF(btrim(a.server_scope),''),'legacy'));

  -- Counts change only when identity/visibility changes; UP/roster edits never
  -- recount history. New IDs start with their existing eligible rows.
  INSERT INTO public.statistics_jobs(scope_key,total_pulls)
    SELECT 'pool:'||p.pool_id,(SELECT count(*) FROM public.statistics_history h
      WHERE h.pool_id=p.pool_id AND h.special_type IS DISTINCT FROM 'gift'
        AND h.rarity IN (4,5,6) AND NULLIF(btrim(h.game_uid::TEXT),'') IS NOT NULL
        AND h.timestamp>to_timestamp(0))
    FROM public.get_app_visible_pools() p WHERE p.pool_id=ANY(p_recount_ids)
    ON CONFLICT(scope_key) DO UPDATE SET total_pulls=EXCLUDED.total_pulls;
  INSERT INTO public.statistics_jobs(scope_key)
    SELECT 'pool:'||p.pool_id FROM public.get_app_visible_pools() p WHERE p.pool_id=ANY(dependent_ids)
    ON CONFLICT(scope_key) DO NOTHING;
  UPDATE public.statistics_jobs SET revision=revision+1
    WHERE scope_key=ANY(ARRAY(SELECT 'pool:'||id FROM unnest(dependent_ids) id));
  INSERT INTO public.statistics_jobs(scope_key,total_pulls)
    SELECT g.scope_key,COALESCE(sum(j.total_pulls),0)::BIGINT
    FROM public.statistics_group_keys() g(scope_key)
    LEFT JOIN public.statistics_group_members() m ON m.scope_key=g.scope_key
    LEFT JOIN public.statistics_jobs j ON j.scope_key='pool:'||m.pool_id
    WHERE g.scope_key=ANY(p_group_keys) OR EXISTS (
      SELECT 1 FROM public.statistics_group_members() affected
      WHERE affected.scope_key=g.scope_key AND affected.pool_id=ANY(dependent_ids))
    GROUP BY g.scope_key
    ON CONFLICT(scope_key) DO UPDATE SET revision=statistics_jobs.revision+1,total_pulls=EXCLUDED.total_pulls;
  INSERT INTO public.statistics_jobs(scope_key)
    SELECT DISTINCT 'owner:'||a.user_id FROM jsonb_to_recordset(accounts) a(user_id UUID)
    WHERE a.user_id IS NOT NULL ORDER BY 1
    ON CONFLICT(scope_key) DO UPDATE SET revision=statistics_jobs.revision+1;
  UPDATE public.statistics_jobs SET revision=revision+1 WHERE scope_key IN
    ('global_summary','character_ranking','character_catalog','public_analytics');
END;
$$;

CREATE OR REPLACE FUNCTION public.invalidate_personal_analysis_after_pool_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE before_row JSONB; after_row JSONB; ids TEXT[]; recount TEXT[] := '{}'; boundary JSONB;
BEGIN
  before_row:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  after_row:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  IF TG_OP = 'UPDATE' AND (
    OLD.pool_id, OLD.type, OLD.locked, OLD.user_id,
    OLD.up_character, OLD.is_limited_weapon, OLD.featured_characters,
    OLD.start_time, OLD.end_time, OLD.created_at, OLD.roster_status,
    OLD.extra_subtype, OLD.extra_rule_profile, OLD.extra_series_key, OLD.extra_series_phase
  ) IS NOT DISTINCT FROM (
    NEW.pool_id, NEW.type, NEW.locked, NEW.user_id,
    NEW.up_character, NEW.is_limited_weapon, NEW.featured_characters,
    NEW.start_time, NEW.end_time, NEW.created_at, NEW.roster_status,
    NEW.extra_subtype, NEW.extra_rule_profile, NEW.extra_series_key, NEW.extra_series_phase
  ) THEN
    RETURN NULL;
  END IF;
  ids:=ARRAY_REMOVE(ARRAY[before_row->>'pool_id',after_row->>'pool_id'],NULL);
  IF TG_OP<>'UPDATE' OR (OLD.pool_id,OLD.locked,OLD.user_id) IS DISTINCT FROM
      (NEW.pool_id,NEW.locked,NEW.user_id) THEN recount:=ids; END IF;
  IF TG_OP<>'UPDATE' OR (OLD.pool_id,OLD.type,OLD.start_time,OLD.created_at,OLD.locked,OLD.user_id)
      IS DISTINCT FROM (NEW.pool_id,NEW.type,NEW.start_time,NEW.created_at,NEW.locked,NEW.user_id) THEN
    -- An empty new period can redirect an info book. Include neighbors at both
    -- old and new positions, not every owner merely because the catalog changed.
    FOR boundary IN SELECT value FROM jsonb_array_elements(jsonb_build_array(before_row,after_row))
      WHERE value->>'type' IN ('limited','limited_character') LOOP
      ids:=ids||ARRAY(SELECT p.pool_id FROM public.pools p
        WHERE p.type IN ('limited','limited_character') AND NOT p.pool_id=ANY(ids)
          AND COALESCE(p.start_time,p.created_at,to_timestamp(0)) IN (
            (SELECT max(COALESCE(q.start_time,q.created_at,to_timestamp(0))) FROM public.pools q
              WHERE q.type IN ('limited','limited_character') AND q.pool_id<>ALL(ARRAY_REMOVE(
                ARRAY[before_row->>'pool_id',after_row->>'pool_id'],NULL))
              AND COALESCE(q.start_time,q.created_at,to_timestamp(0))<=
                COALESCE((boundary->>'start_time')::TIMESTAMPTZ,(boundary->>'created_at')::TIMESTAMPTZ,to_timestamp(0))),
            (SELECT min(COALESCE(q.start_time,q.created_at,to_timestamp(0))) FROM public.pools q
              WHERE q.type IN ('limited','limited_character') AND q.pool_id<>ALL(ARRAY_REMOVE(
                ARRAY[before_row->>'pool_id',after_row->>'pool_id'],NULL))
              AND COALESCE(q.start_time,q.created_at,to_timestamp(0))>=
                COALESCE((boundary->>'start_time')::TIMESTAMPTZ,(boundary->>'created_at')::TIMESTAMPTZ,to_timestamp(0)))));
    END LOOP;
  END IF;
  -- Reconstruction periods share a series pity chain. An empty/new phase or
  -- series reassignment can change it without any history in the edited pool.
  FOR boundary IN SELECT value FROM jsonb_array_elements(jsonb_build_array(before_row,after_row))
    WHERE value->>'type'='extra' AND value->>'extra_rule_profile'='reconstruction_character_v1'
      AND NULLIF(btrim(value->>'extra_series_key'),'') IS NOT NULL LOOP
    ids:=ids||ARRAY(SELECT p.pool_id FROM public.pools p WHERE p.type='extra'
      AND p.extra_rule_profile=boundary->>'extra_rule_profile'
      AND p.extra_series_key=boundary->>'extra_series_key' AND NOT p.pool_id=ANY(ids));
  END LOOP;
  PERFORM public.invalidate_pool_statistics_dependencies(ids,recount,
    ARRAY_REMOVE(ARRAY[public.statistics_pool_group(before_row),public.statistics_pool_group(after_row)],NULL));
  RETURN NULL;
END;
$$;
-- The row trigger above replaces the unconditional statement-level recount.
DROP TRIGGER statistics_pool_catalog ON public.pools;

CREATE OR REPLACE FUNCTION public.invalidate_changed_pool_roster() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE id TEXT; status TEXT;
BEGIN
  IF TG_OP='UPDATE' AND (OLD.pool_id,OLD.character_id,OLD.is_up) IS NOT DISTINCT FROM
      (NEW.pool_id,NEW.character_id,NEW.is_up) THEN RETURN NULL; END IF;
  FOR id IN SELECT DISTINCT value FROM unnest(ARRAY_REMOVE(ARRAY[
    CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.pool_id END,
    CASE WHEN TG_OP='DELETE' THEN NULL ELSE NEW.pool_id END],NULL)) value LOOP
    status:=CASE WHEN EXISTS(SELECT 1 FROM public.pool_characters WHERE pool_id=id)
      THEN 'partial' ELSE 'missing' END;
    UPDATE public.pools SET roster_status=status WHERE pool_id=id AND roster_status IS DISTINCT FROM status;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.invalidate_statistics_roster_changes() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ids TEXT[];
BEGIN
  IF TG_OP='UPDATE' THEN
    SELECT ARRAY(SELECT DISTINCT pool_id FROM (
      (SELECT pool_id,character_id,is_up FROM old_roster EXCEPT SELECT pool_id,character_id,is_up FROM new_roster)
      UNION (SELECT pool_id,character_id,is_up FROM new_roster EXCEPT SELECT pool_id,character_id,is_up FROM old_roster)
    ) changed) INTO ids;
  ELSIF TG_OP='DELETE' THEN SELECT ARRAY(SELECT DISTINCT pool_id FROM old_roster) INTO ids;
  ELSE SELECT ARRAY(SELECT DISTINCT pool_id FROM new_roster) INTO ids; END IF;
  IF cardinality(ids)>0 THEN PERFORM public.invalidate_pool_statistics_dependencies(ids); END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER statistics_pool_roster ON public.pool_characters;
CREATE TRIGGER statistics_pool_roster_insert AFTER INSERT ON public.pool_characters
  REFERENCING NEW TABLE AS new_roster FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_statistics_roster_changes();
CREATE TRIGGER statistics_pool_roster_update AFTER UPDATE ON public.pool_characters
  REFERENCING OLD TABLE AS old_roster NEW TABLE AS new_roster FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_statistics_roster_changes();
CREATE TRIGGER statistics_pool_roster_delete AFTER DELETE ON public.pool_characters
  REFERENCING OLD TABLE AS old_roster FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_statistics_roster_changes();
REVOKE ALL ON FUNCTION public.statistics_pool_group(JSONB),
  public.invalidate_pool_statistics_dependencies(TEXT[],TEXT[],TEXT[]),
  public.invalidate_statistics_roster_changes(),public.invalidate_changed_pool_roster(),
  public.invalidate_personal_analysis_after_pool_change()
  FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
