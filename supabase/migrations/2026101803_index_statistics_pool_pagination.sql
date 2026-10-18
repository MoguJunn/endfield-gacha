-- On a live database build this same index CONCURRENTLY before applying the
-- migration, so imports do not wait for index construction. IF NOT EXISTS then
-- keeps the installed index. Fresh databases can build it normally.
CREATE INDEX IF NOT EXISTS idx_history_statistics_pool_page
  ON public.history(pool_id,id) WHERE NOT statistics_excluded;

BEGIN;
-- Pool selectivity varies from a handful of rows to nearly the entire table.
-- A generic PL/pgSQL plan can choose the wrong access path after a few calls.
ALTER FUNCTION public.read_statistics_history_compact_page(TEXT[],BIGINT,BIGINT,INTEGER)
  SET plan_cache_mode=force_custom_plan;
ALTER FUNCTION public.read_statistics_history_count(TEXT[],BIGINT)
  SET plan_cache_mode=force_custom_plan;
NOTIFY pgrst,'reload schema';
COMMIT;
