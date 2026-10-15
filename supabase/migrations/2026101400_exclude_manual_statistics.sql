-- Pending rollout: scope exclusions persist after deletes, imports and reverts.
BEGIN;
ALTER TABLE public.history ADD COLUMN statistics_excluded BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.history.statistics_excluded IS
  'Row evidence of a manual edit; the owner/account/server/pool exclusion persists independently of this row.';

-- edit_version is incremented only by the controlled user editor in the existing schema.
UPDATE public.history SET statistics_excluded = true
  WHERE edit_version > 1 OR left(record_id, 7) = 'manual_';

CREATE TABLE public.account_statistics_exclusions (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  game_uid TEXT NOT NULL,
  server_scope TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  first_modified_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  history_start_at TIMESTAMPTZ,
  history_end_at TIMESTAMPTZ,
  history_time_unknown BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY(user_id, game_uid, server_scope, pool_id)
);
ALTER TABLE public.account_statistics_exclusions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_statistics_exclusions FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX account_statistics_history_scope_idx ON public.history
  (user_id, (COALESCE(NULLIF(btrim(game_uid), ''), 'legacy')), server_scope, pool_id)
  WHERE NOT statistics_excluded;

INSERT INTO public.account_statistics_exclusions(user_id, game_uid, server_scope, pool_id)
  SELECT user_id, COALESCE(NULLIF(btrim(game_uid), ''), 'legacy'), COALESCE(server_scope, 'legacy'), pool_id
  FROM public.history WHERE statistics_excluded AND pool_id IS NOT NULL
  UNION SELECT user_id, game_uid, server_scope, pool_id
  FROM public.account_data_workbench_entries WHERE pool_id IS NOT NULL
  ON CONFLICT DO NOTHING;
-- Recover the original pool of old moves when the audit has an unambiguous account locator.
INSERT INTO public.account_statistics_exclusions(user_id, game_uid, server_scope, pool_id)
  SELECT DISTINCT h.user_id, COALESCE(NULLIF(btrim(h.game_uid), ''), 'legacy'), COALESCE(h.server_scope, 'legacy'), a.old_values->>'pool_id'
  FROM public.history_change_log a JOIN public.history h ON h.user_id = a.user_id AND h.record_id = a.record_id
  WHERE a.old_values->>'pool_id' IS NOT NULL AND h.statistics_excluded
    AND (SELECT count(*) FROM public.history x WHERE x.user_id = a.user_id AND x.record_id = a.record_id) = 1
  ON CONFLICT DO NOTHING;

UPDATE public.account_statistics_exclusions e SET
  history_start_at = b.first_at, history_end_at = b.last_at, history_time_unknown = b.unknown_time
FROM (SELECT e.user_id,e.game_uid,e.server_scope,e.pool_id,min(h.timestamp) AS first_at,max(h.timestamp) AS last_at,
  COALESCE(bool_or(h.id IS NOT NULL AND h.timestamp IS NULL),false) AS unknown_time
  FROM public.account_statistics_exclusions e LEFT JOIN public.history h ON h.user_id=e.user_id
    AND COALESCE(NULLIF(btrim(h.game_uid),''),'legacy')=e.game_uid AND h.server_scope=e.server_scope AND h.pool_id=e.pool_id
  GROUP BY e.user_id,e.game_uid,e.server_scope,e.pool_id) b
WHERE (e.user_id,e.game_uid,e.server_scope,e.pool_id)=(b.user_id,b.game_uid,b.server_scope,b.pool_id);
CREATE VIEW public.statistics_history_gaps WITH (security_barrier=true) AS
  SELECT user_id,game_uid,server_scope,pool_id,history_start_at,history_end_at,history_time_unknown
  FROM public.account_statistics_exclusions;
REVOKE ALL ON public.statistics_history_gaps FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.statistics_history_gaps TO service_role;

CREATE VIEW public.statistics_history WITH (security_barrier = true) AS
  SELECT h.* FROM public.history h WHERE NOT h.statistics_excluded AND NOT EXISTS (
    SELECT 1 FROM public.account_statistics_exclusions e WHERE e.user_id = h.user_id
      AND e.game_uid = COALESCE(NULLIF(btrim(h.game_uid), ''), 'legacy')
      AND e.server_scope = COALESCE(h.server_scope, 'legacy') AND e.pool_id = h.pool_id
  );
REVOKE ALL ON public.statistics_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.statistics_history TO service_role;

CREATE FUNCTION public.statistics_pity_scope(p public.pools) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
  SELECT CASE WHEN p.type IN ('limited','limited_character') THEN 'shared'
    WHEN p.type='extra' AND p.extra_rule_profile='reconstruction_character_v1'
      AND NULLIF(btrim(p.extra_series_key),'') IS NOT NULL
      THEN 'series:'||p.extra_rule_profile||':'||p.extra_series_key
    ELSE 'pool:'||p.pool_id END;
$$;
REVOKE ALL ON FUNCTION public.statistics_pity_scope(public.pools) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.statistics_pity_scope(public.pools) TO service_role;

-- The old overview/cache RPCs use the same trusted-reset rule as the JS worker.
-- A view has no persisted copy of the history or excluded results.
CREATE VIEW public.statistics_pity_intervals WITH (security_barrier=true) AS
WITH numbered AS MATERIALIZED (
  SELECT h.id,h.user_id,COALESCE(NULLIF(btrim(h.game_uid),''),'legacy') AS game_uid,h.server_scope,
    h.pool_id,h.rarity,h.timestamp,public.statistics_pity_scope(p) AS pity_scope,
    row_number() OVER (PARTITION BY h.user_id,h.game_uid,h.server_scope,public.statistics_pity_scope(p)
      ORDER BY h.timestamp,CASE WHEN h.seq_id ~ '^[0-9]+$' THEN h.seq_id::numeric END,h.id) AS rn
  FROM public.statistics_history h JOIN public.pools p ON p.pool_id=h.pool_id
  WHERE h.special_type IS DISTINCT FROM 'gift' AND h.is_free IS NOT TRUE
    AND h.rarity IN (4,5,6) AND h.timestamp>to_timestamp(0) AND nullif(btrim(h.game_uid),'') IS NOT NULL
), resets AS MATERIALIZED (
  SELECT *,max(rn) FILTER(WHERE rarity=6) OVER w AS previous_six,
    max(rn) FILTER(WHERE rarity>=5) OVER w AS previous_five
  FROM numbered WINDOW w AS (PARTITION BY user_id,game_uid,server_scope,pity_scope
    ORDER BY rn ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
), gaps AS MATERIALIZED (
  SELECT e.*,public.statistics_pity_scope(p) AS pity_scope,
    COALESCE(LEAST(e.history_start_at,p.start_time),'-infinity'::timestamptz) AS starts,
    CASE WHEN e.history_time_unknown THEN 'infinity'::timestamptz
      ELSE COALESCE(GREATEST(e.history_end_at,p.end_time),'infinity'::timestamptz) END AS ends
  FROM public.account_statistics_exclusions e LEFT JOIN public.pools p ON p.pool_id=e.pool_id
)
SELECT r.id,r.user_id,r.pool_id,
  CASE WHEN r.rarity=6 AND NOT EXISTS(SELECT 1 FROM gaps g WHERE g.user_id=r.user_id
    AND g.game_uid=r.game_uid AND g.server_scope=r.server_scope AND (g.pity_scope=r.pity_scope OR g.pity_scope IS NULL)
    AND g.starts<=r.timestamp AND (s.timestamp IS NULL OR g.ends>=s.timestamp))
    THEN r.rn-COALESCE(r.previous_six,0) END AS six_star_pity,
  CASE WHEN r.rarity>=5 AND NOT EXISTS(SELECT 1 FROM gaps g WHERE g.user_id=r.user_id
    AND g.game_uid=r.game_uid AND g.server_scope=r.server_scope AND (g.pity_scope=r.pity_scope OR g.pity_scope IS NULL)
    AND g.starts<=r.timestamp AND (f.timestamp IS NULL OR g.ends>=f.timestamp))
    THEN r.rn-COALESCE(r.previous_five,0) END AS five_star_pity
FROM resets r LEFT JOIN numbered s ON s.user_id=r.user_id AND s.game_uid=r.game_uid AND s.server_scope=r.server_scope
  AND s.pity_scope=r.pity_scope AND s.rn=r.previous_six
LEFT JOIN numbered f ON f.user_id=r.user_id AND f.game_uid=r.game_uid AND f.server_scope=r.server_scope
  AND f.pity_scope=r.pity_scope AND f.rn=r.previous_five
WHERE r.rarity>=5;
REVOKE ALL ON public.statistics_pity_intervals FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.statistics_pity_intervals TO service_role;

-- Ownership totals cannot establish copy order across a missing character pool.
CREATE VIEW public.statistics_copy_history WITH (security_barrier=true) AS
SELECT h.* FROM public.statistics_history h JOIN public.pools p ON p.pool_id=h.pool_id
WHERE p.type IN ('weapon','limited_weapon') OR p.extra_rule_profile='reconstruction_weapon_v1' OR NOT EXISTS (
  SELECT 1 FROM public.account_statistics_exclusions e LEFT JOIN public.pools ep ON ep.pool_id=e.pool_id
  WHERE e.user_id=h.user_id AND e.game_uid=COALESCE(NULLIF(btrim(h.game_uid),''),'legacy') AND e.server_scope=h.server_scope
    AND (ep.pool_id IS NULL OR ep.type NOT IN ('weapon','limited_weapon')
      AND ep.extra_rule_profile IS DISTINCT FROM 'reconstruction_weapon_v1')
);
REVOKE ALL ON public.statistics_copy_history FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.statistics_copy_history TO service_role;

CREATE FUNCTION public.account_pool_statistics_excluded(p_user_id UUID, p_uid TEXT, p_server TEXT, p_pool TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS(SELECT 1 FROM public.account_statistics_exclusions e WHERE e.user_id=p_user_id
    AND e.game_uid=COALESCE(NULLIF(btrim(p_uid),''),'legacy')
    AND e.server_scope=COALESCE(p_server,'legacy') AND e.pool_id=p_pool);
$$;
REVOKE ALL ON FUNCTION public.account_pool_statistics_excluded(UUID,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.read_account_statistics_exclusions(p_user_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(e)) FROM public.account_statistics_exclusions e WHERE e.user_id = p_user_id), '[]'::JSONB);
END;
$$;
REVOKE ALL ON FUNCTION public.read_account_statistics_exclusions(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_account_statistics_exclusions(UUID) TO service_role;

-- Called before changing history: the new scope removes its entire old
-- contribution once; subsequent excluded writes cannot add it back.
CREATE FUNCTION public.mark_account_statistics_scope(p_user_id UUID, p_uid TEXT, p_server TEXT, p_pool TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_uid TEXT := COALESCE(NULLIF(btrim(p_uid), ''), 'legacy'); v_server TEXT := COALESCE(p_server, 'legacy');
BEGIN
  IF p_pool IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM public.account_statistics_exclusions WHERE user_id=p_user_id
    AND game_uid=v_uid AND server_scope=v_server AND pool_id=p_pool) THEN RETURN; END IF;
  INSERT INTO public.account_statistics_exclusions(user_id, game_uid, server_scope, pool_id,
    history_start_at,history_end_at,history_time_unknown)
    SELECT p_user_id,v_uid,v_server,p_pool,min(timestamp),max(timestamp),COALESCE(bool_or(timestamp IS NULL),false)
    FROM public.history WHERE user_id=p_user_id AND COALESCE(NULLIF(btrim(game_uid),''),'legacy')=v_uid
      AND server_scope=v_server AND pool_id=p_pool ON CONFLICT DO NOTHING;
END;
$$;

CREATE FUNCTION public.capture_manual_statistics_scope() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_manual BOOLEAN := TG_TABLE_NAME <> 'history';
BEGIN
  IF TG_TABLE_NAME = 'history' THEN
    IF TG_OP <> 'INSERT' THEN v_manual := OLD.statistics_excluded; END IF;
    IF TG_OP <> 'DELETE' THEN v_manual := v_manual OR NEW.statistics_excluded OR left(NEW.record_id, 7) = 'manual_'; END IF;
  END IF;
  IF v_manual THEN
    IF TG_OP <> 'INSERT' THEN PERFORM public.mark_account_statistics_scope(OLD.user_id, OLD.game_uid, OLD.server_scope, OLD.pool_id); END IF;
    IF TG_OP <> 'DELETE' THEN
      IF TG_TABLE_NAME = 'history' THEN
        -- server_scope is generated on production history; its new value is
        -- not available until AFTER a BEFORE trigger has returned.
        PERFORM public.mark_account_statistics_scope(NEW.user_id, NEW.game_uid,
          COALESCE(NEW.server_scope, NULLIF(btrim(NEW.server_id),''), 'legacy'), NEW.pool_id);
      ELSE
        PERFORM public.mark_account_statistics_scope(NEW.user_id, NEW.game_uid, NEW.server_scope, NEW.pool_id);
      END IF;
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER capture_manual_statistics_scope BEFORE INSERT OR UPDATE OR DELETE ON public.history
  FOR EACH ROW EXECUTE FUNCTION public.capture_manual_statistics_scope();
CREATE TRIGGER capture_manual_statistics_scope BEFORE INSERT OR UPDATE OR DELETE ON public.account_data_workbench_entries
  FOR EACH ROW EXECUTE FUNCTION public.capture_manual_statistics_scope();
REVOKE ALL ON FUNCTION public.mark_account_statistics_scope(UUID,TEXT,TEXT,TEXT), public.capture_manual_statistics_scope()
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.mark_manual_history_insert() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF left(NEW.record_id, 7) = 'manual_' THEN NEW.statistics_excluded := true; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER mark_manual_history_insert BEFORE INSERT ON public.history
  FOR EACH ROW EXECUTE FUNCTION public.mark_manual_history_insert();
REVOKE ALL ON FUNCTION public.mark_manual_history_insert() FROM PUBLIC, anon, authenticated;

-- Store only temporal boundaries, never excluded outcomes or pull counts.
-- Deleting the manual row cannot remove evidence of a missing history interval.
CREATE FUNCTION public.track_statistics_gap_bounds() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_rows TEXT;
BEGIN
  v_rows := CASE WHEN TG_OP='INSERT' THEN 'SELECT * FROM new_rows'
    WHEN TG_OP='DELETE' THEN 'SELECT * FROM old_rows'
    ELSE 'SELECT * FROM new_rows UNION ALL SELECT * FROM old_rows' END;
  EXECUTE 'WITH bounds AS (SELECT user_id,COALESCE(NULLIF(btrim(game_uid),''''),''legacy'') AS game_uid,
    COALESCE(server_scope,''legacy'') AS server_scope,pool_id,min(timestamp) AS first_at,max(timestamp) AS last_at,
    bool_or(timestamp IS NULL) AS unknown_time FROM ('||v_rows||') r GROUP BY 1,2,3,4)
    UPDATE public.account_statistics_exclusions e SET history_start_at=LEAST(e.history_start_at,b.first_at),
      history_end_at=GREATEST(e.history_end_at,b.last_at),history_time_unknown=e.history_time_unknown OR b.unknown_time
    FROM bounds b WHERE (e.user_id,e.game_uid,e.server_scope,e.pool_id)=(b.user_id,b.game_uid,b.server_scope,b.pool_id)
      AND (e.history_start_at IS NULL OR b.first_at<e.history_start_at OR e.history_end_at IS NULL
        OR b.last_at>e.history_end_at OR b.unknown_time AND NOT e.history_time_unknown)';
  RETURN NULL;
END;
$$;
CREATE TRIGGER statistics_gap_bounds_insert AFTER INSERT ON public.history REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.track_statistics_gap_bounds();
CREATE TRIGGER statistics_gap_bounds_update AFTER UPDATE ON public.history REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.track_statistics_gap_bounds();
CREATE TRIGGER statistics_gap_bounds_delete AFTER DELETE ON public.history REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.track_statistics_gap_bounds();
REVOKE ALL ON FUNCTION public.track_statistics_gap_bounds() FROM PUBLIC,anon,authenticated;

-- The eligibility flag is owned by the server, never supplied as a user-editable field.
DO $$ DECLARE v_definition TEXT; BEGIN
  SELECT pg_get_functiondef('public.update_history_record_controlled(uuid,text,text,text,text,text,bigint,jsonb,text)'::regprocedure)
    INTO v_definition;
  IF position('edit_version = p_expected_version + 1' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'controlled_history_definition_changed';
  END IF;
  EXECUTE replace(v_definition, 'edit_version = p_expected_version + 1',
    'statistics_excluded = true, edit_version = p_expected_version + 1');
  SELECT pg_get_functiondef('public.read_account_data_workbench_context(uuid,text,text)'::regprocedure)
    INTO v_definition;
  IF position('h.updated_at' IN v_definition) = 0 THEN RAISE EXCEPTION 'workbench_context_definition_changed'; END IF;
  EXECUTE replace(v_definition, 'h.updated_at', 'h.updated_at, (h.statistics_excluded OR EXISTS(
    SELECT 1 FROM public.account_statistics_exclusions e WHERE e.user_id=h.user_id
      AND e.game_uid=COALESCE(NULLIF(btrim(h.game_uid),''''),''legacy'')
      AND e.server_scope=COALESCE(h.server_scope,''legacy'') AND e.pool_id=h.pool_id)) AS statistics_excluded');
END $$;

-- All existing SQL statistics use the same filtered view, including legacy
-- rates, resources, ranks, contributor counts, catalogs and public trends.
-- Only statistical readers are rewritten; import/edit/revert keep the real table.
DO $$ DECLARE v_function RECORD; v_definition TEXT; BEGIN
  FOR v_function IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(ARRAY[
      'get_global_stats', 'get_global_stats_cached', 'get_contributor_activity_stats',
      'get_character_ranking_stats', 'get_character_ranking_stats_cached',
      'get_user_ranking_stats', 'get_user_ranking_stats_cached',
      'get_character_catalog_stats', 'get_character_catalog_stats_cached',
      'get_pool_type_quota_stats', 'refresh_public_pool_analytics_cache',
      'refresh_public_pool_trend_cache', 'invalidate_statistics_catalog', 'track_statistics_history'
    ]) LOOP
    v_definition := pg_get_functiondef(v_function.oid);
    v_definition := regexp_replace(v_definition, '(\mFROM|\mJOIN)(\s+)(public\.)?history\M',
      '\1\2public.statistics_history', 'gi');
    IF v_function.proname IN ('get_character_catalog_stats','get_pool_type_quota_stats') THEN
      v_definition := replace(v_definition,'public.statistics_history','public.statistics_copy_history');
    END IF;
    IF v_function.proname IN ('get_global_stats','refresh_public_pool_analytics_cache') THEN
      IF position('six_star_pity AS MATERIALIZED' IN v_definition)=0 THEN
        RAISE EXCEPTION 'legacy_pity_definition_changed: %',v_function.proname;
      END IF;
      v_definition := replace(v_definition,'WITH history_base AS MATERIALIZED',
        'WITH trusted_pity AS MATERIALIZED (SELECT * FROM public.statistics_pity_intervals), history_base AS MATERIALIZED');
      v_definition := replace(v_definition,'FROM public.statistics_history AS h',
        'FROM public.statistics_history AS h LEFT JOIN trusted_pity ti ON ti.id=h.id AND ti.user_id=h.user_id');
      v_definition := replace(v_definition,'h.record_id,',
        'h.record_id, ti.six_star_pity AS statistics_six_star_pity, ti.five_star_pity AS statistics_five_star_pity,');
      IF v_function.proname='get_global_stats' THEN
        v_definition := replace(v_definition,'hb.record_id,','hb.record_id, hb.statistics_six_star_pity, hb.statistics_five_star_pity,');
        v_definition := regexp_replace(v_definition,'(\n\s*)record_id,','\1record_id, statistics_six_star_pity, statistics_five_star_pity,','g');
        v_definition := replace(v_definition,'pool_id, user_id, rarity,',
          'pool_id, user_id, statistics_six_star_pity, statistics_five_star_pity, rarity,');
      END IF;
      v_definition := regexp_replace(v_definition,
        'LEAST\(\s*rn - COALESCE\(LAG\(rn\) OVER \(PARTITION BY pool_id, user_id ORDER BY rn\), 0\),\s*80\s*\) AS pity',
        'statistics_six_star_pity AS pity','g');
      v_definition := regexp_replace(v_definition,
        'LEAST\(\s*rn - COALESCE\(LAG\(rn\) OVER \(PARTITION BY pool_id, user_id ORDER BY rn\), 0\),\s*10\s*\) AS pity',
        'statistics_five_star_pity AS pity','g');
      IF position('statistics_six_star_pity AS pity' IN v_definition)=0
        OR position('LEFT JOIN trusted_pity' IN v_definition)=0 THEN RAISE EXCEPTION 'legacy_pity_expression_changed'; END IF;
      v_definition := regexp_replace(v_definition,'(FROM six_star_pity\s*)(\),\s*\w*distribution)',
        '\1 WHERE pity IS NOT NULL \2','g');
      IF v_function.proname='get_global_stats' THEN
        v_definition := replace(v_definition,'COALESCE(gap.avg_pity, 0)','gap.avg_pity');
        v_definition := regexp_replace(v_definition,'COALESCE\((tps_\w+\.avg_pity), 0\)','\1','g');
        v_definition := replace(v_definition,'''avgPity'', gap.avg_pity,',
          '''statisticsContinuity'', json_build_object(''unknownInheritedIntervalCount'',
            (SELECT count(*) FROM trusted_pity WHERE six_star_pity IS NULL AND id IN
              (SELECT id FROM public.statistics_history WHERE rarity=6))), ''avgPity'', gap.avg_pity,');
      END IF;
    END IF;
    -- Scope invalidation has already removed its old contribution before the
    -- manual row change; neither side of that change may contribute again.
    v_definition := replace(v_definition, 'FROM new_rows', 'FROM new_rows r WHERE NOT statistics_excluded
      AND NOT public.account_pool_statistics_excluded(r.user_id,r.game_uid,r.server_scope,r.pool_id)');
    v_definition := replace(v_definition, 'FROM old_rows', 'FROM old_rows r WHERE NOT statistics_excluded
      AND NOT public.account_pool_statistics_excluded(r.user_id,r.game_uid,r.server_scope,r.pool_id)');
    IF v_function.proname = 'track_statistics_history' THEN
      -- An already-excluded edit or addition cannot dirty statistical samples
      -- or accelerate the worker cadence. Exclusion invalidation subtracts
      -- the entire prior scope contribution separately.
      v_definition := replace(v_definition, 'v_activity_source text;', 'v_activity_source text; v_has_eligible boolean;');
      IF position('v_has_eligible boolean' IN v_definition) = 0 THEN RAISE EXCEPTION 'statistics_tracker_definition_changed'; END IF;
      v_definition := regexp_replace(v_definition, '(END IF;)(\s*)(-- Ownership|EXECUTE)',
        '\1\2EXECUTE ''SELECT EXISTS(SELECT 1 FROM (''||v_sql||'') changes)'' INTO v_has_eligible;' || chr(10)
          || '  IF NOT v_has_eligible THEN RETURN NULL; END IF;' || chr(10) || '  \3');
      IF position('INTO v_has_eligible;' IN v_definition) = 0 THEN RAISE EXCEPTION 'statistics_tracker_body_changed'; END IF;
    END IF;
    EXECUTE v_definition;
  END LOOP;
END $$;

CREATE FUNCTION public.invalidate_account_statistics_exclusions() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF to_regclass('public.statistics_jobs') IS NULL OR NOT EXISTS(SELECT 1 FROM inserted_exclusions) THEN RETURN NULL; END IF;
  -- This runs BEFORE the corresponding manual history change. Scan only the
  -- newly excluded account scopes, subtracting their old contribution once.
  WITH accounts AS (SELECT DISTINCT user_id, game_uid, server_scope FROM inserted_exclusions),
  affected AS (
    SELECT pool_id FROM inserted_exclusions
    UNION SELECT h.pool_id FROM public.statistics_history h JOIN accounts a ON h.user_id=a.user_id
      AND COALESCE(NULLIF(btrim(h.game_uid),''),'legacy')=a.game_uid AND COALESCE(h.server_scope,'legacy')=a.server_scope
  ), deltas AS (
    SELECT e.pool_id, -count(h.id) FILTER (WHERE h.special_type IS DISTINCT FROM 'gift' AND h.rarity IN (4,5,6)
      AND nullif(btrim(h.game_uid),'') IS NOT NULL AND h.timestamp>to_timestamp(0)) AS delta
    FROM inserted_exclusions e LEFT JOIN public.history h ON h.user_id=e.user_id
      AND COALESCE(NULLIF(btrim(h.game_uid),''),'legacy')=e.game_uid
      AND COALESCE(h.server_scope,'legacy')=e.server_scope AND h.pool_id=e.pool_id AND NOT h.statistics_excluded
    GROUP BY e.pool_id
  ), scope_deltas AS (
    SELECT 'pool:'||a.pool_id AS scope_key, COALESCE(d.delta,0) AS delta FROM affected a LEFT JOIN deltas d USING(pool_id)
    UNION ALL SELECT m.scope_key, sum(COALESCE(d.delta,0)) FROM public.statistics_group_members() m
      JOIN affected a USING(pool_id) LEFT JOIN deltas d USING(pool_id) GROUP BY m.scope_key
  )
  INSERT INTO public.statistics_jobs(scope_key,total_pulls)
    SELECT scope_key,delta FROM scope_deltas WHERE scope_key IS NOT NULL ORDER BY scope_key
    ON CONFLICT(scope_key) DO UPDATE SET revision=statistics_jobs.revision+1,
      total_pulls=GREATEST(0,statistics_jobs.total_pulls+EXCLUDED.total_pulls);
  INSERT INTO public.statistics_jobs(scope_key)
    SELECT DISTINCT 'owner:'||user_id FROM inserted_exclusions ORDER BY 1
    ON CONFLICT(scope_key) DO UPDATE SET revision=statistics_jobs.revision+1;
  UPDATE public.statistics_jobs SET revision=revision+1 WHERE scope_key IN
    ('global_summary','character_ranking','character_catalog','public_analytics');
  RETURN NULL;
END;
$$;
CREATE TRIGGER invalidate_account_statistics_exclusions AFTER INSERT ON public.account_statistics_exclusions
  REFERENCING NEW TABLE AS inserted_exclusions FOR EACH STATEMENT
  EXECUTE FUNCTION public.invalidate_account_statistics_exclusions();
REVOKE ALL ON FUNCTION public.invalidate_account_statistics_exclusions() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.invalidate_statistics_gap_updates() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF to_regclass('public.statistics_jobs') IS NULL THEN RETURN NULL; END IF;
  WITH changed AS (
    SELECT n.* FROM new_gaps n JOIN old_gaps o USING(user_id,game_uid,server_scope,pool_id)
    WHERE (n.history_start_at,n.history_end_at,n.history_time_unknown)
      IS DISTINCT FROM (o.history_start_at,o.history_end_at,o.history_time_unknown)
  ), affected AS (
    SELECT pool_id FROM changed UNION SELECT h.pool_id FROM public.statistics_history h JOIN changed c
      ON h.user_id=c.user_id AND COALESCE(NULLIF(btrim(h.game_uid),''),'legacy')=c.game_uid AND h.server_scope=c.server_scope
  ), scopes AS (
    SELECT 'pool:'||pool_id AS scope_key FROM affected UNION SELECT m.scope_key
      FROM public.statistics_group_members() m JOIN affected a USING(pool_id)
    UNION SELECT 'owner:'||user_id FROM changed
    UNION SELECT scope_key FROM public.statistics_jobs WHERE scope_key IN
      ('global_summary','character_ranking','character_catalog','public_analytics') AND EXISTS(SELECT 1 FROM changed)
  )
  INSERT INTO public.statistics_jobs(scope_key) SELECT scope_key FROM scopes ORDER BY scope_key
    ON CONFLICT(scope_key) DO UPDATE SET revision=statistics_jobs.revision+1;
  RETURN NULL;
END;
$$;
CREATE TRIGGER invalidate_statistics_gap_updates AFTER UPDATE ON public.account_statistics_exclusions
  REFERENCING NEW TABLE AS new_gaps OLD TABLE AS old_gaps FOR EACH STATEMENT
  EXECUTE FUNCTION public.invalidate_statistics_gap_updates();
REVOKE ALL ON FUNCTION public.invalidate_statistics_gap_updates() FROM PUBLIC,anon,authenticated;

-- Only stored counts need an initial pass; payloads are recomputed by the
-- existing scheduled worker. The schema version prevents serving old samples.
DO $$ BEGIN
  IF to_regclass('public.statistics_jobs') IS NOT NULL THEN
    INSERT INTO public.statistics_jobs(scope_key, total_pulls)
      SELECT 'pool:' || p.pool_id, count(h.id) FILTER (WHERE h.special_type IS DISTINCT FROM 'gift'
        AND h.rarity IN (4,5,6) AND nullif(btrim(h.game_uid::text),'') IS NOT NULL AND h.timestamp > to_timestamp(0))
      FROM public.get_app_visible_pools() p LEFT JOIN public.statistics_history h ON h.pool_id = p.pool_id
      GROUP BY p.pool_id
      ON CONFLICT(scope_key) DO UPDATE SET total_pulls = EXCLUDED.total_pulls;
    IF to_regprocedure('public.statistics_group_members()') IS NOT NULL THEN
      INSERT INTO public.statistics_jobs(scope_key, total_pulls)
        SELECT g.scope_key, count(h.id) FILTER (WHERE h.special_type IS DISTINCT FROM 'gift'
          AND h.rarity IN (4,5,6) AND nullif(btrim(h.game_uid::text),'') IS NOT NULL AND h.timestamp > to_timestamp(0))
        FROM public.statistics_group_keys() g(scope_key)
        LEFT JOIN public.statistics_group_members() m ON m.scope_key = g.scope_key
        LEFT JOIN public.statistics_history h ON h.pool_id = m.pool_id GROUP BY g.scope_key
        ON CONFLICT(scope_key) DO UPDATE SET total_pulls = EXCLUDED.total_pulls;
    END IF;
    UPDATE public.statistics_jobs SET revision = revision + 1, computed_at = NULL,
      next_refresh_at = now(), retry_at = NULL WHERE true;
  END IF;
  IF to_regclass('public.personal_analysis_owner_state') IS NOT NULL THEN
    UPDATE public.personal_analysis_owner_state SET history_revision = history_revision + 1,
      analysis_schema_version = GREATEST(analysis_schema_version, 5),
      dirty_since = COALESCE(dirty_since, now()), last_error = NULL, next_attempt_at = NULL;
    UPDATE public.personal_analysis_scope_state SET history_revision = history_revision + 1,
      analysis_schema_version = GREATEST(analysis_schema_version, 5),
      dirty_since = COALESCE(dirty_since, now()), last_error = NULL, next_attempt_at = NULL;
  END IF;
END $$;
ALTER TABLE public.personal_analysis_owner_state ALTER COLUMN analysis_schema_version SET DEFAULT 5;
ALTER TABLE public.personal_analysis_scope_state ALTER COLUMN analysis_schema_version SET DEFAULT 5;
CREATE FUNCTION public.enforce_personal_analysis_schema_v5() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN NEW.analysis_schema_version := GREATEST(COALESCE(NEW.analysis_schema_version, 5), 5); RETURN NEW; END;
$$;
CREATE TRIGGER enforce_personal_analysis_owner_schema_v5 BEFORE INSERT ON public.personal_analysis_owner_state
  FOR EACH ROW EXECUTE FUNCTION public.enforce_personal_analysis_schema_v5();
CREATE TRIGGER enforce_personal_analysis_scope_schema_v5 BEFORE INSERT ON public.personal_analysis_scope_state
  FOR EACH ROW EXECUTE FUNCTION public.enforce_personal_analysis_schema_v5();
REVOKE ALL ON FUNCTION public.enforce_personal_analysis_schema_v5() FROM PUBLIC, anon, authenticated;
DELETE FROM public.stats_cache WHERE cache_key LIKE 'global_stats%' OR cache_key LIKE 'character_ranking%'
  OR cache_key LIKE 'character_catalog%' OR cache_key LIKE 'user_ranking%';
DO $$ BEGIN
  IF to_regclass('public.public_pool_analytics_cache') IS NOT NULL THEN DELETE FROM public.public_pool_analytics_cache WHERE true; END IF;
  IF to_regclass('public.public_pool_trend_cache') IS NOT NULL THEN DELETE FROM public.public_pool_trend_cache WHERE true; END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
