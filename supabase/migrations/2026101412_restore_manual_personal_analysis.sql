-- Manual data remains excluded from community statistics. Rebuild only affected
-- private analyses after deploying the worker that includes saved personal data.
-- The snapshot JSON contract remains schema 5; personalData fields are additive.
BEGIN;

CREATE TEMP TABLE manual_personal_analysis_owners ON COMMIT DROP AS
  SELECT DISTINCT user_id FROM public.account_statistics_exclusions
  UNION SELECT DISTINCT user_id FROM public.account_data_workbench_entries
  UNION SELECT DISTINCT user_id FROM public.history WHERE statistics_excluded OR edit_version > 1;

UPDATE public.personal_analysis_owner_state AS s
SET history_revision = s.history_revision + 1,
    dirty_since = COALESCE(s.dirty_since, now()),
    priority_requested_at = COALESCE(s.priority_requested_at, now()),
    last_error = NULL, next_attempt_at = NULL
WHERE s.user_id IN (SELECT user_id FROM manual_personal_analysis_owners);

UPDATE public.personal_analysis_scope_state AS s
SET history_revision = s.history_revision + 1,
    dirty_since = COALESCE(s.dirty_since, now()),
    priority_requested_at = COALESCE(s.priority_requested_at, now()),
    last_error = NULL, next_attempt_at = NULL
WHERE s.user_id IN (SELECT user_id FROM manual_personal_analysis_owners);

INSERT INTO public.statistics_jobs(scope_key)
SELECT 'owner:' || user_id FROM manual_personal_analysis_owners ORDER BY user_id
ON CONFLICT(scope_key) DO UPDATE SET revision = statistics_jobs.revision + 1;

-- The community history tracker skips excluded rows. Keep the private scheduled
-- owner snapshot dirty for those writes, including supplement updates/reverts.
CREATE FUNCTION public.invalidate_manual_personal_statistics() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_rows TEXT; v_filter TEXT;
BEGIN
  v_rows := CASE WHEN TG_OP = 'INSERT' THEN 'SELECT * FROM new_rows'
    WHEN TG_OP = 'DELETE' THEN 'SELECT * FROM old_rows'
    ELSE 'SELECT * FROM new_rows UNION ALL SELECT * FROM old_rows' END;
  v_filter := CASE WHEN TG_TABLE_NAME = 'history' THEN
    ' AND (r.statistics_excluded OR public.account_pool_statistics_excluded(r.user_id,r.game_uid,r.server_scope,r.pool_id))'
    ELSE '' END;
  EXECUTE 'INSERT INTO public.statistics_jobs(scope_key)
    SELECT ''owner:''||r.user_id FROM ('||v_rows||') r
    WHERE r.user_id IS NOT NULL'||v_filter||' GROUP BY r.user_id ORDER BY r.user_id
    ON CONFLICT(scope_key) DO UPDATE SET revision=statistics_jobs.revision+1';
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.invalidate_manual_personal_statistics() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER manual_personal_statistics_insert AFTER INSERT ON public.history
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_manual_personal_statistics();
CREATE TRIGGER manual_personal_statistics_update AFTER UPDATE ON public.history
  REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_manual_personal_statistics();
CREATE TRIGGER manual_personal_statistics_delete AFTER DELETE ON public.history
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_manual_personal_statistics();
CREATE TRIGGER supplement_personal_statistics_insert AFTER INSERT ON public.account_data_workbench_entries
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_manual_personal_statistics();
CREATE TRIGGER supplement_personal_statistics_update AFTER UPDATE ON public.account_data_workbench_entries
  REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_manual_personal_statistics();
CREATE TRIGGER supplement_personal_statistics_delete AFTER DELETE ON public.account_data_workbench_entries
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_manual_personal_statistics();

COMMIT;
