-- 187: rebuild personal analysis snapshots with all-overview filter projections.

BEGIN;

ALTER TABLE public.personal_analysis_owner_state
  ALTER COLUMN analysis_schema_version SET DEFAULT 2;

ALTER TABLE public.personal_analysis_scope_state
  ALTER COLUMN analysis_schema_version SET DEFAULT 2;

CREATE OR REPLACE FUNCTION public.enforce_personal_analysis_schema_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.analysis_schema_version := GREATEST(COALESCE(NEW.analysis_schema_version, 2), 2);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_personal_analysis_owner_schema_v2
  ON public.personal_analysis_owner_state;
CREATE TRIGGER enforce_personal_analysis_owner_schema_v2
  BEFORE INSERT ON public.personal_analysis_owner_state
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_personal_analysis_schema_v2();

DROP TRIGGER IF EXISTS enforce_personal_analysis_scope_schema_v2
  ON public.personal_analysis_scope_state;
CREATE TRIGGER enforce_personal_analysis_scope_schema_v2
  BEFORE INSERT ON public.personal_analysis_scope_state
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_personal_analysis_schema_v2();

UPDATE public.personal_analysis_owner_state
SET
  analysis_schema_version = GREATEST(analysis_schema_version, 2),
  history_revision = history_revision + 1,
  dirty_since = COALESCE(dirty_since, statement_timestamp()),
  last_error = NULL,
  next_attempt_at = NULL;

UPDATE public.personal_analysis_scope_state
SET
  analysis_schema_version = GREATEST(analysis_schema_version, 2),
  history_revision = history_revision + 1,
  dirty_since = COALESCE(dirty_since, statement_timestamp()),
  last_error = NULL,
  next_attempt_at = NULL;

REVOKE ALL ON FUNCTION public.enforce_personal_analysis_schema_v2()
  FROM PUBLIC, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
