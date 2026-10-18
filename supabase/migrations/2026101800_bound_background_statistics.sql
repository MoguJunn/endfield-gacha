-- Reduce background reads without changing eligible rows or publication rules.
BEGIN;
CREATE OR REPLACE FUNCTION public.read_statistics_history_count(p_pool_ids TEXT[],p_upper BIGINT)
RETURNS BIGINT LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public SET max_parallel_workers_per_gather=0 SET jit=off AS $$
DECLARE result BIGINT;
BEGIN
  IF p_pool_ids IS NULL OR p_upper IS NULL OR p_upper<0 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_statistics_count_parameters';
  END IF;
  SELECT count(*) INTO result FROM public.history h
    WHERE h.id<=p_upper AND h.pool_id=ANY(p_pool_ids)
      AND NOT h.statistics_excluded AND NOT EXISTS (
        SELECT 1 FROM public.account_statistics_exclusions e WHERE e.user_id=h.user_id
          AND e.game_uid=COALESCE(NULLIF(btrim(h.game_uid),''),'legacy')
          AND e.server_scope=COALESCE(h.server_scope,'legacy') AND e.pool_id=h.pool_id
      );
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.read_statistics_history_page(
  p_pool_ids TEXT[],p_after BIGINT,p_upper BIGINT,p_limit INTEGER DEFAULT 1000
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public SET max_parallel_workers_per_gather=0 SET jit=off AS $$
DECLARE result JSONB;
BEGIN
  IF p_pool_ids IS NULL OR p_after IS NULL OR p_after<0 OR p_upper IS NULL OR p_upper<p_after
    OR p_limit IS NULL OR p_limit<1 OR p_limit>5000 THEN
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

CREATE OR REPLACE FUNCTION public.statistics_personal_analysis_pending()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS(SELECT 1 FROM public.personal_analysis_owner_state
    WHERE snapshot_revision<history_revision AND (next_attempt_at IS NULL OR next_attempt_at<=now()))
    OR EXISTS(SELECT 1 FROM public.personal_analysis_scope_state
    WHERE snapshot_revision<history_revision AND (next_attempt_at IS NULL OR next_attempt_at<=now()));
$$;

CREATE OR REPLACE FUNCTION public.defer_statistics_job(p_scope TEXT,p_lease UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  UPDATE public.statistics_jobs SET lease_id=NULL,lease_until=NULL,retry_at=now()+interval '30 seconds'
    WHERE scope_key=p_scope AND p_lease IS NOT NULL AND lease_id=p_lease;
$$;

-- Only the background legacy entry gets these limits. API/import sessions keep
-- their original settings; nested functions inherit and restore these settings.
ALTER FUNCTION public.compute_and_publish_legacy_statistics(TEXT,BIGINT,UUID,TEXT)
  SET max_parallel_workers_per_gather=0;
ALTER FUNCTION public.compute_and_publish_legacy_statistics(TEXT,BIGINT,UUID,TEXT) SET jit=off;
ALTER FUNCTION public.compute_and_publish_legacy_statistics(TEXT,BIGINT,UUID,TEXT) SET work_mem='16MB';

REVOKE ALL ON FUNCTION public.read_statistics_history_count(TEXT[],BIGINT),
  public.read_statistics_history_page(TEXT[],BIGINT,BIGINT,INTEGER),
  public.statistics_personal_analysis_pending(),public.defer_statistics_job(TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_statistics_history_count(TEXT[],BIGINT),
  public.read_statistics_history_page(TEXT[],BIGINT,BIGINT,INTEGER),
  public.statistics_personal_analysis_pending(),public.defer_statistics_job(TEXT,UUID) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
