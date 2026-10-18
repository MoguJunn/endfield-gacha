-- Internal worker transport: avoid repeating object keys and serializing
-- unused fields for every history row. Keep the original object RPC intact.
BEGIN;
CREATE OR REPLACE FUNCTION public.read_statistics_history_compact_page(
  p_pool_ids TEXT[],p_after BIGINT,p_upper BIGINT,p_limit INTEGER DEFAULT 10000
) RETURNS JSON LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public SET max_parallel_workers_per_gather=0 SET jit=off AS $$
DECLARE result JSON;
BEGIN
  IF p_pool_ids IS NULL OR p_after IS NULL OR p_after<0 OR p_upper IS NULL OR p_upper<p_after
    OR p_limit IS NULL OR p_limit<1 OR p_limit>10000 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_statistics_page_parameters';
  END IF;
  -- Tuple order is the worker transport contract, tested against object pages.
  SELECT coalesce(json_agg(json_build_array(
    page.id,page.record_id,page.user_id,page.game_uid,page.server_scope,
    page.pool_id,page.pool_version,page.character_id,page.character_name,
    page.rarity,page.timestamp,page.seq_id,page.is_new,page.is_free,page.is_info_book,page.special_type
  ) ORDER BY page.id),'[]'::json) INTO result FROM (
    SELECT h.id,h.record_id,h.user_id,h.game_uid,coalesce(h.server_scope,h.server_id,h.region,'unknown') AS server_scope,
      h.pool_id,h.pool_version,h.character_id,
      CASE WHEN coalesce(h.character_id,'')<>'' THEN '' ELSE h.character_name END AS character_name,
      h.rarity,h.timestamp,h.seq_id,h.is_new,h.is_free,h.is_info_book,h.special_type
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
REVOKE ALL ON FUNCTION public.read_statistics_history_compact_page(TEXT[],BIGINT,BIGINT,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_statistics_history_compact_page(TEXT[],BIGINT,BIGINT,INTEGER) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
