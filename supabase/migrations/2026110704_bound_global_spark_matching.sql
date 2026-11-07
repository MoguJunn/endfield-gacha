-- The materialized first-target CTE has no column statistics. On production
-- PostgreSQL chose a 13k x 10k nested-loop match. A window preserves the same
-- first-target rule without repeatedly scanning every account/banner pair.
BEGIN;
DO $patch$
DECLARE body TEXT; first_at INTEGER; after_at INTEGER;
BEGIN
  SELECT replace(pg_get_functiondef('public.get_global_stats()'::regprocedure),E'\r\n',E'\n') INTO body;
  first_at:=strpos(body,'limited_target_hits AS MATERIALIZED (');
  after_at:=strpos(body,'target_hit_counts AS MATERIALIZED (');
  IF first_at=0 OR after_at<=first_at THEN RAISE EXCEPTION 'global_summary_target_hits_changed'; END IF;
  body:=left(body,first_at-1)||$cte$
limited_target_hits AS MATERIALIZED (
  SELECT pool_id,user_id,rn,
    rn=120 AND min(rn) OVER (PARTITION BY pool_id,user_id)=120 AS is_spark
  FROM target_hit_rows WHERE classified_pool_type='limited'
),
$cte$||substr(body,after_at);
  EXECUTE body;
END;
$patch$;
-- Avoid sorting the entire materialized history to match its small high-star
-- target set. Window orderings are unchanged and still sort where required.
ALTER FUNCTION public.get_global_stats() SET enable_mergejoin='off';
NOTIFY pgrst,'reload schema';
COMMIT;
