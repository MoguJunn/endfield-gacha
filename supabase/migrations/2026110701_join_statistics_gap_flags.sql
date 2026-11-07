-- Check historical interruptions once by account instead of scanning every
-- exclusion twice for each high-star event in the global report.
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
), resets AS MATERIALIZED (
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
), interruption_flags AS MATERIALIZED (
  SELECT r.id,
    bool_or(r.previous_six_at IS NULL OR g.ends>=r.previous_six_at) AS blocked_six,
    bool_or(r.previous_five_at IS NULL OR g.ends>=r.previous_five_at) AS blocked_five
  FROM resets r JOIN gaps g ON g.user_id=r.user_id AND g.game_uid=r.game_uid
    AND g.server_scope=r.server_scope AND (g.pity_scope=r.pity_scope OR g.pity_scope IS NULL)
    AND g.starts<=r.timestamp
  GROUP BY r.id
)
SELECT r.id,r.user_id,r.pool_id,
  CASE WHEN r.rarity=6 AND NOT COALESCE(f.blocked_six,false)
    THEN r.rn-COALESCE(r.previous_six,0) END AS six_star_pity,
  CASE WHEN NOT COALESCE(f.blocked_five,false)
    THEN r.rn-COALESCE(r.previous_five,0) END AS five_star_pity
FROM resets r LEFT JOIN interruption_flags f ON f.id=r.id;
NOTIFY pgrst,'reload schema';
COMMIT;
