-- Persistent, adaptive statistics. Public payloads contain aggregates only;
-- owner payloads are private and readable exclusively through authenticated server routes.
BEGIN;
CREATE TABLE public.statistics_jobs (
  scope_key text PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 1,
  published_revision bigint NOT NULL DEFAULT 0,
  total_pulls bigint NOT NULL DEFAULT 0,
  computed_at timestamptz,
  next_refresh_at timestamptz NOT NULL DEFAULT now(),
  refresh_minutes integer NOT NULL DEFAULT 60 CHECK (refresh_minutes IN (5,30,60)),
  lease_id uuid,
  lease_until timestamptz,
  retry_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0
);
CREATE TABLE public.statistics_activity (
  minute_at timestamptz NOT NULL,
  contributor_id uuid NOT NULL,
  changed_rows bigint NOT NULL,
  PRIMARY KEY (minute_at, contributor_id)
);
CREATE TABLE public.statistics_snapshots (
  scope_key text PRIMARY KEY,
  schema_version text NOT NULL,
  payload jsonb NOT NULL,
  computed_at timestamptz NOT NULL,
  source_revision bigint NOT NULL
);
ALTER TABLE public.statistics_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.statistics_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.statistics_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.statistics_jobs, public.statistics_activity, public.statistics_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.statistics_jobs, public.statistics_activity, public.statistics_snapshots TO service_role;

-- Statement-level transition tables keep a thousand-row upload to one invalidation per pool.
CREATE FUNCTION public.track_statistics_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_sql text; v_activity_source text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_sql := 'SELECT pool_id,user_id,game_uid,rarity,timestamp,special_type,1 AS delta FROM new_rows';
  ELSIF TG_OP = 'DELETE' THEN
    v_sql := 'SELECT pool_id,user_id,game_uid,rarity,timestamp,special_type,-1 AS delta FROM old_rows';
  ELSE
    v_sql := 'SELECT pool_id,user_id,game_uid,rarity,timestamp,special_type,1 AS delta FROM new_rows UNION ALL SELECT pool_id,user_id,game_uid,rarity,timestamp,special_type,-1 AS delta FROM old_rows';
  END IF;
  EXECUTE 'INSERT INTO public.statistics_jobs(scope_key,total_pulls)
    SELECT ''pool:''||pool_id, sum(CASE WHEN special_type IS DISTINCT FROM ''gift'' AND rarity IN (4,5,6)
      AND nullif(btrim(game_uid::text),'''') IS NOT NULL AND timestamp > to_timestamp(0) THEN delta ELSE 0 END)
    FROM ('||v_sql||') changes WHERE nullif(pool_id,'''') IS NOT NULL GROUP BY pool_id ORDER BY pool_id
    ON CONFLICT(scope_key) DO UPDATE SET revision=statistics_jobs.revision+1,
      total_pulls=statistics_jobs.total_pulls+EXCLUDED.total_pulls';
  v_activity_source := CASE WHEN TG_OP='DELETE' THEN 'old_rows' ELSE 'new_rows' END;
  EXECUTE 'INSERT INTO public.statistics_activity(minute_at,contributor_id,changed_rows)
    SELECT date_trunc(''minute'',clock_timestamp()),user_id,count(*) FROM '||v_activity_source||'
    WHERE user_id IS NOT NULL GROUP BY user_id
    ON CONFLICT(minute_at,contributor_id) DO UPDATE SET changed_rows=statistics_activity.changed_rows+EXCLUDED.changed_rows';
  EXECUTE 'INSERT INTO public.statistics_jobs(scope_key) SELECT ''owner:''||user_id FROM ('||v_sql||') changes
    WHERE user_id IS NOT NULL GROUP BY user_id ORDER BY user_id
    ON CONFLICT(scope_key) DO UPDATE SET revision=statistics_jobs.revision+1';
  UPDATE public.statistics_jobs SET revision=revision+1 WHERE scope_key IN
    ('global_summary','character_ranking','character_catalog','public_analytics');
  RETURN NULL;
END $$;
CREATE TRIGGER statistics_history_insert AFTER INSERT ON public.history REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.track_statistics_history();
CREATE TRIGGER statistics_history_update AFTER UPDATE ON public.history REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.track_statistics_history();
CREATE TRIGGER statistics_history_delete AFTER DELETE ON public.history REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.track_statistics_history();

CREATE FUNCTION public.invalidate_statistics_catalog() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.statistics_jobs(scope_key) SELECT DISTINCT 'pool:'||pool_id FROM public.get_app_visible_pools()
    WHERE nullif(pool_id,'') IS NOT NULL ON CONFLICT DO NOTHING;
  UPDATE public.statistics_jobs SET revision=revision+1;
  RETURN NULL;
END $$;
CREATE TRIGGER statistics_pool_catalog AFTER INSERT OR UPDATE OR DELETE ON public.pools FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_statistics_catalog();
CREATE TRIGGER statistics_item_catalog AFTER INSERT OR UPDATE OR DELETE ON public.characters FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_statistics_catalog();
CREATE TRIGGER statistics_pool_roster AFTER INSERT OR UPDATE OR DELETE ON public.pool_characters FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_statistics_catalog();
-- Role changes can change public pool visibility. Do not persist invisible pool labels.
CREATE TRIGGER statistics_profile_catalog AFTER UPDATE OF role OR DELETE ON public.profiles FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_statistics_catalog();

INSERT INTO public.statistics_jobs(scope_key,total_pulls)
SELECT 'pool:'||p.pool_id,count(h.id) FILTER (WHERE h.special_type IS DISTINCT FROM 'gift' AND h.rarity IN (4,5,6)
  AND nullif(btrim(h.game_uid::text),'') IS NOT NULL AND h.timestamp > to_timestamp(0))
FROM (SELECT DISTINCT pool_id FROM public.get_app_visible_pools() WHERE nullif(pool_id,'') IS NOT NULL) p
LEFT JOIN public.history h ON h.pool_id=p.pool_id GROUP BY p.pool_id;
INSERT INTO public.statistics_jobs(scope_key) VALUES ('global_summary'),('character_ranking'),('character_catalog'),('public_analytics');
INSERT INTO public.statistics_jobs(scope_key) SELECT 'owner:'||id FROM public.profiles;
CREATE FUNCTION public.initialize_personal_statistics() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.statistics_jobs(scope_key) VALUES('owner:'||NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER initialize_personal_statistics AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.initialize_personal_statistics();

CREATE FUNCTION public.purge_personal_statistics() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  DELETE FROM public.statistics_snapshots WHERE scope_key='owner:'||OLD.id;
  DELETE FROM public.statistics_jobs WHERE scope_key='owner:'||OLD.id;
  DELETE FROM public.statistics_activity WHERE contributor_id=OLD.id;
  RETURN OLD;
END $$;
CREATE TRIGGER purge_personal_statistics BEFORE DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.purge_personal_statistics();

CREATE FUNCTION public.claim_statistics_job(p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_minutes integer; v_rows10 bigint; v_rows60 bigint; v_users bigint; v_job public.statistics_jobs;
BEGIN
  SELECT coalesce(sum(changed_rows) FILTER (WHERE minute_at >= now()-interval '10 minutes'),0),
    coalesce(sum(changed_rows),0),count(DISTINCT contributor_id) FILTER (WHERE minute_at >= now()-interval '10 minutes')
  INTO v_rows10,v_rows60,v_users FROM public.statistics_activity WHERE minute_at >= now()-interval '60 minutes';
  v_minutes := CASE WHEN v_users>=5 OR v_rows10>=1000 THEN 5 WHEN v_rows60>0 THEN 30 ELSE 60 END;
  DELETE FROM public.statistics_activity WHERE minute_at < now()-interval '65 minutes';
  UPDATE public.statistics_jobs SET refresh_minutes=v_minutes,
    next_refresh_at=coalesce(computed_at,now())+make_interval(mins=>v_minutes)
    WHERE refresh_minutes IS DISTINCT FROM v_minutes AND computed_at IS NOT NULL;
  -- Remove scopes which became invisible/deleted, including cascade-created owner jobs.
  DELETE FROM public.statistics_jobs j WHERE
    (scope_key LIKE 'pool:%' AND NOT EXISTS(SELECT 1 FROM public.get_app_visible_pools() p WHERE 'pool:'||p.pool_id=j.scope_key))
    OR (scope_key LIKE 'owner:%' AND NOT EXISTS(SELECT 1 FROM public.profiles p WHERE 'owner:'||p.id=j.scope_key));
  DELETE FROM public.statistics_snapshots s WHERE NOT EXISTS(SELECT 1 FROM public.statistics_jobs j WHERE j.scope_key=s.scope_key);
  -- Advance completed, unchanged scopes on the worker clock, preserving their calculation time.
  UPDATE public.statistics_jobs SET next_refresh_at=now()+make_interval(mins=>refresh_minutes)
    WHERE revision=published_revision AND scope_key<>'global_summary' AND next_refresh_at<=now();
  -- Time-based contributor metrics expire even without uploads; other jobs skip unchanged scopes.
  SELECT * INTO v_job FROM public.statistics_jobs j
    WHERE (revision<>published_revision OR scope_key='global_summary')
      AND (computed_at IS NULL OR next_refresh_at<=now())
      AND (lease_until IS NULL OR lease_until<now()) AND (retry_at IS NULL OR retry_at<=now())
    ORDER BY next_refresh_at,CASE WHEN scope_key LIKE 'owner:%' THEN 2 WHEN scope_key LIKE 'pool:%' THEN 1 ELSE 0 END,scope_key
    FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.statistics_jobs SET lease_id=p_lease,lease_until=now()+interval '5 minutes',refresh_minutes=v_minutes
    WHERE scope_key=v_job.scope_key;
  RETURN jsonb_build_object('scopeKey',v_job.scope_key,'revision',v_job.revision,'refreshMinutes',v_minutes);
END $$;

CREATE FUNCTION public.publish_statistics_snapshot(p_scope text,p_revision bigint,p_lease uuid,p_payload jsonb,p_schema text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job public.statistics_jobs;
BEGIN
  SELECT * INTO v_job FROM public.statistics_jobs WHERE scope_key=p_scope FOR UPDATE;
  IF NOT FOUND OR p_lease IS NULL OR v_job.lease_id IS DISTINCT FROM p_lease OR v_job.lease_until IS NULL OR v_job.lease_until<now() THEN RETURN false; END IF;
  IF v_job.revision<>p_revision THEN
    UPDATE public.statistics_jobs SET lease_id=NULL,lease_until=NULL,retry_at=now()+interval '1 minute' WHERE scope_key=p_scope;
    RETURN false;
  END IF;
  INSERT INTO public.statistics_snapshots VALUES(p_scope,p_schema,p_payload,clock_timestamp(),p_revision)
    ON CONFLICT(scope_key) DO UPDATE SET schema_version=EXCLUDED.schema_version,payload=EXCLUDED.payload,
      computed_at=EXCLUDED.computed_at,source_revision=EXCLUDED.source_revision;
  UPDATE public.statistics_jobs SET published_revision=p_revision,computed_at=clock_timestamp(),
    next_refresh_at=clock_timestamp()+make_interval(mins=>refresh_minutes),lease_id=NULL,lease_until=NULL,retry_at=NULL,failure_count=0
    WHERE scope_key=p_scope;
  RETURN true;
END $$;
CREATE FUNCTION public.fail_statistics_job(p_scope text,p_lease uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  UPDATE public.statistics_jobs SET lease_id=NULL,lease_until=NULL,failure_count=failure_count+1,
    retry_at=now()+make_interval(mins=>least(60,5*(failure_count+1))) WHERE scope_key=p_scope AND lease_id=p_lease;
$$;

-- Old statistics are computed only by the worker. Delete their internal caches
-- in the SAME transaction; a computation failure rolls these deletions back.
-- Existing import callbacks keep their RPC contract but now only enqueue work.
ALTER FUNCTION public.refresh_public_analytics_cache() RENAME TO recompute_public_analytics_for_worker;
REVOKE ALL ON FUNCTION public.recompute_public_analytics_for_worker() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.refresh_public_analytics_cache() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.statistics_jobs SET revision=revision+1 WHERE scope_key IN
    ('global_summary','character_ranking','character_catalog','public_analytics');
  RETURN jsonb_build_object('success',true,'queued',true,'refreshedPools',0,'refreshedTrendRows',0);
END $$;
REVOKE ALL ON FUNCTION public.refresh_public_analytics_cache() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_public_analytics_cache() TO service_role;

CREATE FUNCTION public.compute_legacy_statistics(p_scope text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET statement_timeout='180s' AS $$
DECLARE v_result jsonb;
BEGIN
  IF p_scope='global_summary' THEN
    DELETE FROM public.stats_cache WHERE cache_key LIKE 'global_stats%';
    v_result:=public.get_global_stats_cached(0)::jsonb;
  ELSIF p_scope='character_ranking' THEN
    DELETE FROM public.stats_cache WHERE cache_key LIKE 'character_ranking%';
    v_result:=public.get_character_ranking_stats_cached(0)::jsonb;
  ELSIF p_scope='character_catalog' THEN
    DELETE FROM public.stats_cache WHERE cache_key LIKE 'character_catalog%';
    v_result:=public.get_character_catalog_stats_cached(0)::jsonb;
  ELSIF p_scope='public_analytics' THEN
    v_result:=public.recompute_public_analytics_for_worker();
  ELSE RAISE EXCEPTION 'Invalid statistics scope'; END IF;
  RETURN v_result;
END $$;

-- Legacy cache tables and the new snapshot must publish in the same transaction.
-- A revision conflict rolls back ALL cache writes before scheduling the retry.
CREATE FUNCTION public.compute_and_publish_legacy_statistics(p_scope text,p_revision bigint,p_lease uuid,p_schema text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET statement_timeout='180s' AS $$
DECLARE v_payload jsonb;
BEGIN
  BEGIN
    v_payload := public.compute_legacy_statistics(p_scope);
    IF v_payload IS NULL THEN RAISE EXCEPTION 'Empty statistics result'; END IF;
    IF NOT public.publish_statistics_snapshot(p_scope,p_revision,p_lease,v_payload,p_schema) THEN
      RAISE EXCEPTION USING ERRCODE='PST01',MESSAGE='Statistics revision changed';
    END IF;
  EXCEPTION WHEN SQLSTATE 'PST01' THEN
    UPDATE public.statistics_jobs SET lease_id=NULL,lease_until=NULL,retry_at=now()+interval '1 minute'
      WHERE scope_key=p_scope AND lease_id=p_lease;
    RETURN false;
  END;
  RETURN true;
END $$;

CREATE FUNCTION public.read_statistics_snapshot(p_scope text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object('payload',s.payload,'schema_version',s.schema_version,'computed_at',s.computed_at,
    'next_refresh_at', greatest(j.next_refresh_at,j.retry_at),
    'refresh_minutes',j.refresh_minutes,'pending_changes',j.revision<>j.published_revision)
  FROM public.statistics_snapshots s JOIN public.statistics_jobs j USING(scope_key) WHERE s.scope_key=p_scope;
$$;
CREATE FUNCTION public.read_statistics_pool_counts() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce(jsonb_object_agg(p.pool_id, greatest(0,coalesce((s.payload->'observations'->>'total')::bigint,j.total_pulls,0))),'{}'::jsonb)
  FROM public.get_app_visible_pools() p LEFT JOIN public.statistics_jobs j ON j.scope_key='pool:'||p.pool_id
    LEFT JOIN public.statistics_snapshots s ON s.scope_key=j.scope_key;
$$;

REVOKE ALL ON FUNCTION public.track_statistics_history(),public.invalidate_statistics_catalog(),public.claim_statistics_job(uuid),
  public.publish_statistics_snapshot(text,bigint,uuid,jsonb,text),public.fail_statistics_job(text,uuid),
  public.compute_legacy_statistics(text),public.compute_and_publish_legacy_statistics(text,bigint,uuid,text),
  public.read_statistics_snapshot(text),public.read_statistics_pool_counts(),public.purge_personal_statistics(),public.initialize_personal_statistics() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_statistics_job(uuid),public.publish_statistics_snapshot(text,bigint,uuid,jsonb,text),
  public.fail_statistics_job(text,uuid),public.compute_and_publish_legacy_statistics(text,bigint,uuid,text),
  public.read_statistics_snapshot(text),public.read_statistics_pool_counts() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
