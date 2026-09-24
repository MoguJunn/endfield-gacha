-- Promote the observed official character rerun ID while preserving the
-- temporary catalog's history, roster, aliases and version bindings.
DO $migration$
DECLARE
  v_previous_role TEXT := current_setting('request.jwt.claim.role', TRUE);
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.pools
    WHERE pool_id = 'joint_manual_extra_reconstruction_yvonne_p1'
      AND type = 'extra'
      AND extra_rule_profile = 'reconstruction_character_v1'
  ) AND EXISTS (
    SELECT 1 FROM public.pool_id_aliases
    WHERE source = 'official_api' AND alias_id = 'rerun_chr_yvonne'
      AND pool_id = 'joint_manual_extra_reconstruction_yvonne_p1'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.pools WHERE pool_id = 'rerun_chr_yvonne'
  ) THEN
    PERFORM set_config('request.jwt.claim.role', 'service_role', TRUE);
    PERFORM public.promote_manual_pool_to_official_id(
      'joint_manual_extra_reconstruction_yvonne_p1',
      jsonb_build_object(
        'pool_id', 'rerun_chr_yvonne',
        'name', '绚丽异彩'
      )
    );
    PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_role, ''), TRUE);
  END IF;
END;
$migration$;

NOTIFY pgrst, 'reload schema';
