-- Publish the statistics-only RPC contract required by the public worker and
-- pool catalog triggers. No private import executor or credentials are needed.
-- CREATE OR REPLACE also supports installations with the earlier ops rollout.
BEGIN;
CREATE OR REPLACE FUNCTION public.statistics_account_pool_dependencies(
  p_user_id UUID, p_game_uid TEXT, p_server_scope TEXT,
  p_legacy_game BOOLEAN DEFAULT false, p_legacy_server BOOLEAN DEFAULT false
) RETURNS TABLE(pool_id TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN QUERY SELECT DISTINCT h.pool_id FROM public.statistics_history h
      WHERE h.user_id IS NULL
        AND (CASE WHEN p_legacy_game THEN COALESCE(NULLIF(btrim(h.game_uid::text),''),'legacy')
          ELSE btrim(h.game_uid::text) END)=p_game_uid
        AND (CASE WHEN p_legacy_server THEN COALESCE(h.server_scope,'legacy')
          ELSE h.server_scope END) IS NOT DISTINCT FROM p_server_scope;
  ELSE
    RETURN QUERY SELECT DISTINCT h.pool_id FROM public.statistics_history h
      WHERE h.user_id=p_user_id
        AND (CASE WHEN p_legacy_game THEN COALESCE(NULLIF(btrim(h.game_uid::text),''),'legacy')
          ELSE btrim(h.game_uid::text) END)=p_game_uid
        AND (CASE WHEN p_legacy_server THEN COALESCE(h.server_scope,'legacy')
          ELSE h.server_scope END) IS NOT DISTINCT FROM p_server_scope;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.read_statistics_history_page(
  p_pool_ids TEXT[],p_after BIGINT,p_upper BIGINT,p_limit INTEGER DEFAULT 1000
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
SET max_parallel_workers_per_gather=0 AS $$
DECLARE result JSONB;
BEGIN
  IF p_pool_ids IS NULL OR p_after IS NULL OR p_after<0 OR p_upper IS NULL OR p_upper<p_after
    OR p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_statistics_page_parameters';
  END IF;
  SELECT coalesce(jsonb_agg(page ORDER BY page.id),'[]'::jsonb) INTO result FROM (
    SELECT h.id,h.record_id,h.user_id,h.game_uid,h.server_scope,h.server_id,h.region,
      h.pool_id,h.pool_version,h.character_id,h.character_name,h.rarity,h.timestamp,h.seq_id,
      h.is_new,h.is_free,h.is_info_book,h.special_type
    FROM public.history h
    WHERE h.id>p_after AND h.id<=p_upper AND h.pool_id=ANY(p_pool_ids)
      AND NOT h.statistics_excluded AND NOT EXISTS (
        SELECT 1 FROM public.account_statistics_exclusions e WHERE e.user_id=h.user_id
          AND e.game_uid=COALESCE(NULLIF(btrim(h.game_uid),''),'legacy')
          AND e.server_scope=COALESCE(h.server_scope,'legacy') AND e.pool_id=h.pool_id
      )
    ORDER BY h.id LIMIT p_limit
  ) page;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.read_statistics_job_revisions() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT coalesce(jsonb_object_agg(scope_key,revision::text),'{}'::jsonb)
    FROM public.statistics_jobs WHERE scope_key LIKE 'pool:%' OR scope_key LIKE 'group:%';
$$;

ALTER TABLE public.statistics_jobs DROP CONSTRAINT statistics_jobs_refresh_minutes_check;
ALTER TABLE public.statistics_jobs ADD CONSTRAINT statistics_jobs_refresh_minutes_check
  CHECK (refresh_minutes IN (5,15,30,60));

CREATE OR REPLACE FUNCTION public.claim_statistics_job(p_lease UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_minutes INTEGER; v_rows10 BIGINT; v_rows60 BIGINT; v_users BIGINT; v_job public.statistics_jobs;
BEGIN
  SELECT coalesce(sum(changed_rows) FILTER (WHERE minute_at>=now()-interval '10 minutes'),0),
    coalesce(sum(changed_rows),0),count(DISTINCT contributor_id) FILTER (WHERE minute_at>=now()-interval '10 minutes')
    INTO v_rows10,v_rows60,v_users FROM public.statistics_activity WHERE minute_at>=now()-interval '60 minutes';
  v_minutes:=CASE WHEN v_users>=5 OR v_rows10>=1000 THEN 15 WHEN v_rows60>0 THEN 30 ELSE 60 END;
  DELETE FROM public.statistics_activity WHERE minute_at<now()-interval '65 minutes';
  UPDATE public.statistics_jobs SET
    refresh_minutes=CASE WHEN scope_key LIKE 'owner:%' AND v_minutes=15 THEN 5 ELSE v_minutes END,
    next_refresh_at=coalesce(computed_at,now())+make_interval(mins=>
      CASE WHEN scope_key LIKE 'owner:%' AND v_minutes=15 THEN 5 ELSE v_minutes END)
    WHERE refresh_minutes IS DISTINCT FROM
      CASE WHEN scope_key LIKE 'owner:%' AND v_minutes=15 THEN 5 ELSE v_minutes END
      AND computed_at IS NOT NULL;
  DELETE FROM public.statistics_jobs j WHERE
    (scope_key LIKE 'pool:%' AND NOT EXISTS(SELECT 1 FROM public.get_app_visible_pools() p WHERE 'pool:'||p.pool_id=j.scope_key))
    OR (scope_key LIKE 'group:%' AND NOT EXISTS(SELECT 1 FROM public.statistics_group_keys() g(scope_key) WHERE g.scope_key=j.scope_key))
    OR (scope_key LIKE 'owner:%' AND NOT EXISTS(SELECT 1 FROM public.profiles p WHERE 'owner:'||p.id=j.scope_key));
  DELETE FROM public.statistics_snapshots s WHERE NOT EXISTS(SELECT 1 FROM public.statistics_jobs j WHERE j.scope_key=s.scope_key);
  UPDATE public.statistics_jobs SET next_refresh_at=now()+make_interval(mins=>refresh_minutes)
    WHERE revision=published_revision AND scope_key<>'global_summary' AND next_refresh_at<=now();
  SELECT * INTO v_job FROM public.statistics_jobs j
    WHERE (revision<>published_revision OR scope_key='global_summary')
      AND (computed_at IS NULL OR next_refresh_at<=now())
      AND (lease_until IS NULL OR lease_until<now()) AND (retry_at IS NULL OR retry_at<=now())
    ORDER BY next_refresh_at,CASE WHEN scope_key LIKE 'owner:%' THEN 2
      WHEN scope_key LIKE 'pool:%' OR scope_key LIKE 'group:%' THEN 1 ELSE 0 END,scope_key
    FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_job.scope_key LIKE 'owner:%' AND v_minutes=15 THEN v_minutes:=5; END IF;
  UPDATE public.statistics_jobs SET lease_id=p_lease,lease_until=now()+interval '5 minutes',refresh_minutes=v_minutes
    WHERE scope_key=v_job.scope_key;
  RETURN jsonb_build_object('scopeKey',v_job.scope_key,'revision',v_job.revision,'refreshMinutes',v_minutes);
END $$;

DO $$
DECLARE definition TEXT; signature TEXT;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.publish_statistics_snapshot(text,bigint,uuid,jsonb,text)',
    'public.compute_and_publish_legacy_statistics(text,bigint,uuid,text)'
  ] LOOP
    definition:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
    IF position('retry_at=now()+make_interval(mins=>greatest(5,refresh_minutes))' IN definition)>0 THEN
      CONTINUE;
    END IF;
    IF position('retry_at=now()+interval ''1 minute''' IN definition)=0 THEN
      RAISE EXCEPTION 'statistics_conflict_retry_definition_changed: %',signature;
    END IF;
    EXECUTE replace(definition,'retry_at=now()+interval ''1 minute''',
      'retry_at=now()+make_interval(mins=>greatest(5,refresh_minutes))');
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.statistics_account_pool_dependencies(UUID,TEXT,TEXT,BOOLEAN,BOOLEAN),
  public.read_statistics_history_page(TEXT[],BIGINT,BIGINT,INTEGER),
  public.read_statistics_job_revisions(),public.claim_statistics_job(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.statistics_account_pool_dependencies(UUID,TEXT,TEXT,BOOLEAN,BOOLEAN),
  public.read_statistics_history_page(TEXT[],BIGINT,BIGINT,INTEGER),
  public.read_statistics_job_revisions(),public.claim_statistics_job(UUID) TO service_role;

UPDATE public.statistics_jobs SET refresh_minutes=15,
  next_refresh_at=CASE WHEN computed_at IS NULL THEN next_refresh_at
    ELSE greatest(next_refresh_at,computed_at+interval '15 minutes') END
  WHERE scope_key NOT LIKE 'owner:%' AND refresh_minutes=5;
NOTIFY pgrst,'reload schema';
COMMIT;
