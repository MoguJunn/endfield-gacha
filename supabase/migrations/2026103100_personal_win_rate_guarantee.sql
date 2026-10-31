BEGIN;

-- Keep existing snapshots available while the worker rebuilds corrected rates.
UPDATE public.personal_analysis_owner_state
SET history_revision = history_revision + 1,
    analysis_schema_version = 6,
    dirty_since = COALESCE(dirty_since, now()),
    last_error = NULL,
    next_attempt_at = NULL
WHERE analysis_schema_version < 6;

UPDATE public.personal_analysis_scope_state
SET history_revision = history_revision + 1,
    analysis_schema_version = 6,
    dirty_since = COALESCE(dirty_since, now()),
    last_error = NULL,
    next_attempt_at = NULL
WHERE analysis_schema_version < 6;

ALTER TABLE public.personal_analysis_owner_state ALTER COLUMN analysis_schema_version SET DEFAULT 6;
ALTER TABLE public.personal_analysis_scope_state ALTER COLUMN analysis_schema_version SET DEFAULT 6;

CREATE FUNCTION public.enforce_personal_analysis_schema_v6() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.analysis_schema_version := GREATEST(COALESCE(NEW.analysis_schema_version, 6), 6);
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_personal_analysis_owner_schema_v6 BEFORE INSERT ON public.personal_analysis_owner_state
  FOR EACH ROW EXECUTE FUNCTION public.enforce_personal_analysis_schema_v6();
CREATE TRIGGER enforce_personal_analysis_scope_schema_v6 BEFORE INSERT ON public.personal_analysis_scope_state
  FOR EACH ROW EXECUTE FUNCTION public.enforce_personal_analysis_schema_v6();
REVOKE ALL ON FUNCTION public.enforce_personal_analysis_schema_v6() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
