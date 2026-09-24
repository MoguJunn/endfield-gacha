-- Reconcile the official rerun weapon pool with its temporary manual catalog entry.
--
-- Migration 183 already supports both reconstruction products. Require that
-- contract and reuse its history, roster, aliases and version-binding migration.
BEGIN;

DO $guard$
DECLARE
  v_definition TEXT;
BEGIN
  SELECT pg_get_functiondef('public.promote_manual_pool_to_official_id(text,jsonb)'::REGPROCEDURE)
    INTO v_definition;

  IF position('''reconstruction_claim''' IN v_definition) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'migration_183_required_for_rerun_promotion';
  END IF;
END;
$guard$;

-- This ID was observed in the live official import; no character ID is guessed.
-- The merge only runs while both the official pool and the temporary catalog entry
-- still exist, which keeps the migration idempotent on already-promoted databases.
DO $promote$
DECLARE
  v_previous_role TEXT := current_setting('request.jwt.claim.role', TRUE);
BEGIN
  IF EXISTS (SELECT 1 FROM public.pools WHERE pool_id = 'rerun_wpn_yvonne' AND name = '点绘申领')
    AND EXISTS (SELECT 1 FROM public.pools WHERE pool_id = 'joint_manual_extra_reconstruction_arttyrant_p1')
  THEN
    PERFORM set_config('request.jwt.claim.role', 'service_role', TRUE);
    PERFORM public.promote_manual_pool_to_official_id(
      'joint_manual_extra_reconstruction_arttyrant_p1',
      jsonb_build_object('pool_id', 'rerun_wpn_yvonne', 'name', '点绘申领')
    );
    PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_role, ''), TRUE);
  END IF;
END;
$promote$;

NOTIFY pgrst, 'reload schema';
COMMIT;
