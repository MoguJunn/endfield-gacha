-- Rebuild private analysis snapshots for the simulator inheritance v2 contract.
-- Keep source identities, snapshot ACLs and active worker leases unchanged.

BEGIN;

ALTER TABLE public.personal_analysis_owner_state
  ALTER COLUMN analysis_schema_version SET DEFAULT 3;
ALTER TABLE public.personal_analysis_scope_state
  ALTER COLUMN analysis_schema_version SET DEFAULT 3;

CREATE OR REPLACE FUNCTION public.enforce_personal_analysis_schema_v3()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.analysis_schema_version := GREATEST(COALESCE(NEW.analysis_schema_version, 3), 3);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_personal_analysis_owner_schema_v2
  ON public.personal_analysis_owner_state;
DROP TRIGGER IF EXISTS enforce_personal_analysis_scope_schema_v2
  ON public.personal_analysis_scope_state;
DROP TRIGGER IF EXISTS enforce_personal_analysis_owner_schema_v3
  ON public.personal_analysis_owner_state;
CREATE TRIGGER enforce_personal_analysis_owner_schema_v3
  BEFORE INSERT ON public.personal_analysis_owner_state
  FOR EACH ROW EXECUTE FUNCTION public.enforce_personal_analysis_schema_v3();
DROP TRIGGER IF EXISTS enforce_personal_analysis_scope_schema_v3
  ON public.personal_analysis_scope_state;
CREATE TRIGGER enforce_personal_analysis_scope_schema_v3
  BEFORE INSERT ON public.personal_analysis_scope_state
  FOR EACH ROW EXECUTE FUNCTION public.enforce_personal_analysis_schema_v3();

UPDATE public.personal_analysis_owner_state
SET
  analysis_schema_version = GREATEST(analysis_schema_version, 3),
  history_revision = history_revision + 1,
  dirty_since = COALESCE(dirty_since, statement_timestamp()),
  last_error = NULL,
  next_attempt_at = NULL;

UPDATE public.personal_analysis_scope_state
SET
  analysis_schema_version = GREATEST(analysis_schema_version, 3),
  history_revision = history_revision + 1,
  dirty_since = COALESCE(dirty_since, statement_timestamp()),
  last_error = NULL,
  next_attempt_at = NULL;

-- The complete catalog determines an info book's next pool, even when that
-- pool has zero history. Referenced-pool-only invalidation misses new pools.
-- Reuse the existing catalog trigger and the owner -> scope lock order.
CREATE OR REPLACE FUNCTION public.invalidate_personal_analysis_after_pool_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    OLD.pool_id, OLD.name, OLD.name_en, OLD.type, OLD.locked, OLD.user_id,
    OLD.up_character, OLD.is_limited_weapon, OLD.featured_characters,
    OLD.description, OLD.banner_url, OLD.start_time, OLD.end_time,
    OLD.extra_subtype, OLD.extra_rule_profile, OLD.extra_series_key, OLD.extra_series_phase
  ) IS NOT DISTINCT FROM (
    NEW.pool_id, NEW.name, NEW.name_en, NEW.type, NEW.locked, NEW.user_id,
    NEW.up_character, NEW.is_limited_weapon, NEW.featured_characters,
    NEW.description, NEW.banner_url, NEW.start_time, NEW.end_time,
    NEW.extra_subtype, NEW.extra_rule_profile, NEW.extra_series_key, NEW.extra_series_phase
  ) THEN
    RETURN NULL;
  END IF;

  UPDATE public.personal_analysis_owner_state
  SET history_revision = history_revision + 1,
      dirty_since = COALESCE(dirty_since, statement_timestamp()),
      last_error = NULL;
  UPDATE public.personal_analysis_scope_state
  SET history_revision = history_revision + 1,
      dirty_since = COALESCE(dirty_since, statement_timestamp()),
      last_error = NULL;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_personal_analysis_schema_v3()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invalidate_personal_analysis_after_pool_change()
  FROM PUBLIC, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
