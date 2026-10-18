-- Under sustained CPU steal, the serial full count was measured at 22.5s.
-- Keep its bound separate from expensive legacy reports, which must release
-- the shared worker slot sooner. Ordinary API/import limits are unchanged.
BEGIN;
ALTER FUNCTION public.read_statistics_history_count(TEXT[],BIGINT) SET statement_timeout='30s';
ALTER FUNCTION public.compute_and_publish_legacy_statistics(TEXT,BIGINT,UUID,TEXT) SET statement_timeout='60s';
NOTIFY pgrst,'reload schema';
COMMIT;
