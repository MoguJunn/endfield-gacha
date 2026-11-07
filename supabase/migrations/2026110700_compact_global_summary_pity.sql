-- Keep all eligible pulls in the numbering pass, but retain only reset events
-- for the second window and exclusion checks. Low stars still count toward pity.
BEGIN;
CREATE OR REPLACE VIEW public.statistics_pity_intervals WITH (security_barrier=true) AS
WITH catalog AS MATERIALIZED (
  SELECT p.pool_id,p.start_time,p.end_time,public.statistics_pity_scope(p) AS pity_scope FROM public.pools p
), numbered AS NOT MATERIALIZED (
  SELECT h.id,h.user_id,COALESCE(NULLIF(btrim(h.game_uid),''),'legacy') AS game_uid,h.server_scope,
    h.pool_id,h.rarity,h.timestamp,p.pity_scope,
    row_number() OVER (PARTITION BY h.user_id,h.game_uid,h.server_scope,p.pity_scope
      ORDER BY h.timestamp,CASE WHEN h.seq_id ~ '^[0-9]+$' THEN h.seq_id::numeric END,h.id) AS rn
  FROM public.statistics_history h JOIN catalog p ON p.pool_id=h.pool_id
  WHERE h.special_type IS DISTINCT FROM 'gift' AND h.is_free IS NOT TRUE
    AND h.rarity IN (4,5,6) AND h.timestamp>to_timestamp(0) AND nullif(btrim(h.game_uid),'') IS NOT NULL
), high_star_rows AS MATERIALIZED (
  SELECT * FROM numbered WHERE rarity>=5
), resets AS NOT MATERIALIZED (
  SELECT *,max(rn) FILTER(WHERE rarity=6) OVER w AS previous_six,
    max(rn) OVER w AS previous_five,
    max(timestamp) FILTER(WHERE rarity=6) OVER w AS previous_six_at,
    max(timestamp) OVER w AS previous_five_at
  FROM high_star_rows WINDOW w AS (PARTITION BY user_id,game_uid,server_scope,pity_scope
    ORDER BY rn ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
), gaps AS MATERIALIZED (
  SELECT e.*,p.pity_scope,
    COALESCE(LEAST(e.history_start_at,p.start_time),'-infinity'::timestamptz) AS starts,
    CASE WHEN e.history_time_unknown THEN 'infinity'::timestamptz
      ELSE COALESCE(GREATEST(e.history_end_at,p.end_time),'infinity'::timestamptz) END AS ends
  FROM public.account_statistics_exclusions e LEFT JOIN catalog p ON p.pool_id=e.pool_id
)
SELECT r.id,r.user_id,r.pool_id,
  CASE WHEN r.rarity=6 AND NOT EXISTS(SELECT 1 FROM gaps g WHERE g.user_id=r.user_id
    AND g.game_uid=r.game_uid AND g.server_scope=r.server_scope AND (g.pity_scope=r.pity_scope OR g.pity_scope IS NULL)
    AND g.starts<=r.timestamp AND (r.previous_six_at IS NULL OR g.ends>=r.previous_six_at))
    THEN r.rn-COALESCE(r.previous_six,0) END AS six_star_pity,
  CASE WHEN r.rarity>=5 AND NOT EXISTS(SELECT 1 FROM gaps g WHERE g.user_id=r.user_id
    AND g.game_uid=r.game_uid AND g.server_scope=r.server_scope AND (g.pity_scope=r.pity_scope OR g.pity_scope IS NULL)
    AND g.starts<=r.timestamp AND (r.previous_five_at IS NULL OR g.ends>=r.previous_five_at))
    THEN r.rn-COALESCE(r.previous_five,0) END AS five_star_pity
FROM resets r;

-- Preserve the existing overview's classification, resources, target order and
-- JSON contract. Move its trusted interval join after the six-star filter so
-- uncertain join estimates cannot multiply the full-history aggregate pipeline.
DO $patch$
DECLARE v_definition TEXT; v_original TEXT; v_start INTEGER; v_end INTEGER;
BEGIN
  SELECT replace(pg_get_functiondef('public.get_global_stats()'::regprocedure),E'\r\n',E'\n') INTO v_original;
  v_definition := replace(v_original,
    'FROM public.statistics_history AS h LEFT JOIN trusted_pity ti ON ti.id=h.id AND ti.user_id=h.user_id',
    'FROM public.statistics_history AS h');
  IF v_definition = v_original THEN RAISE EXCEPTION 'global_summary_pity_join_changed'; END IF;
  v_definition := replace(v_definition,
    'trusted_pity AS MATERIALIZED (SELECT * FROM public.statistics_pity_intervals)',
    'trusted_pity AS MATERIALIZED (SELECT id,user_id,six_star_pity FROM public.statistics_pity_intervals)');
  v_definition := replace(v_definition,
    'h.record_id, ti.six_star_pity AS statistics_six_star_pity, ti.five_star_pity AS statistics_five_star_pity,',
    'h.record_id, h.id AS statistics_history_id,');
  v_definition := replace(v_definition,
    'hb.record_id, hb.statistics_six_star_pity, hb.statistics_five_star_pity,',
    'hb.record_id, hb.statistics_history_id,');
  v_definition := replace(v_definition,
    'record_id, statistics_six_star_pity, statistics_five_star_pity,',
    'record_id, statistics_history_id,');
  v_start := strpos(v_definition,'six_star_pity AS MATERIALIZED (');
  v_end := strpos(v_definition,'target_hit_rows AS MATERIALIZED (');
  IF v_start=0 OR v_end<=v_start THEN RAISE EXCEPTION 'global_summary_six_star_cte_changed'; END IF;
  v_definition := left(v_definition,v_start-1) || $cte$
six_star_numbered AS MATERIALIZED (
  SELECT * FROM (
    SELECT statistics_history_id,pool_id,user_id,rarity,is_standard_calc,is_target_calc,classified_pool_type,
      ROW_NUMBER() OVER (PARTITION BY pool_id,user_id ORDER BY record_id) AS rn
    FROM valid_pulls
  ) AS all_numbered WHERE rarity=6
),
six_star_pity AS MATERIALIZED (
  SELECT n.pool_id,n.user_id,n.is_standard_calc,n.is_target_calc,n.classified_pool_type,n.rn,
    ti.six_star_pity AS pity
  FROM six_star_numbered n LEFT JOIN trusted_pity ti ON ti.id=n.statistics_history_id AND ti.user_id=n.user_id
),
$cte$ || substr(v_definition,v_end);
  IF strpos(v_definition,'statistics_six_star_pity')>0 OR strpos(v_definition,'statistics_five_star_pity')>0
    OR strpos(v_definition,'h.id AS statistics_history_id')=0
    OR strpos(v_definition,'hb.record_id, hb.statistics_history_id,')=0
    OR strpos(v_definition,'record_id, statistics_history_id,')=0 THEN
    RAISE EXCEPTION 'global_summary_pity_columns_changed';
  END IF;
  EXECUTE v_definition;
END;
$patch$;
NOTIFY pgrst, 'reload schema';
COMMIT;
