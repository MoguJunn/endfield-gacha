-- Second-run idempotency check for migration 195: the migration is executed again
-- right before this file, so every assertion here also proves the rerun changed
-- nothing. Scope matches reconstruction-rerun-promotion.sql: filtered baseline
-- (through 189 plus 194/195) with lottery migrations 190-193 skipped.

DO $idempotency$
DECLARE
  v_user UUID := '00000000-0000-0000-0000-000000000195';
  v_manual_weapon TEXT := 'joint_manual_extra_reconstruction_arttyrant_p1';
  v_manual_character TEXT := 'joint_manual_extra_reconstruction_yvonne_p1';
  v_official_weapon TEXT := 'rerun_wpn_yvonne';
  v_official_character TEXT := 'fixture_rerun_character_yvonne';
  v_timeline JSONB;
  v_pool_ids JSONB;
BEGIN
  IF position(
    '''reconstruction_claim'''
    IN pg_get_functiondef('public.promote_manual_pool_to_official_id(text,jsonb)'::REGPROCEDURE)
  ) = 0 THEN
    RAISE EXCEPTION 'rerun_migration_rerun_lost_guard';
  END IF;

  -- The temporary pools stay gone and the rerun must not recreate them.
  IF EXISTS (
    SELECT 1 FROM public.pools
    WHERE pool_id IN (v_manual_weapon, v_manual_character)
  ) THEN
    RAISE EXCEPTION 'rerun_migration_recreated_manual_pool';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pools
    WHERE pool_id = v_official_weapon
      AND name = '点绘申领'
      AND type = 'extra'
      AND extra_subtype = 'reconstruction_claim'
      AND extra_rule_profile = 'reconstruction_weapon_v1'
      AND extra_series_key = 'reconstruction-xuesong-youmeng'
      AND extra_series_phase = 1
      AND is_limited_weapon IS TRUE
      AND locked IS TRUE
  ) OR NOT EXISTS (
    SELECT 1 FROM public.pools
    WHERE pool_id = v_official_character
      AND type = 'extra'
      AND extra_subtype = 'reconstruction'
      AND extra_rule_profile = 'reconstruction_character_v1'
      AND extra_series_key = 'reconstruction-xuesong-youmeng'
      AND extra_series_phase = 1
  ) THEN
    RAISE EXCEPTION 'rerun_migration_pool_metadata_drifted';
  END IF;

  -- History counts match the state after the first file: the reseeded manual row was
  -- merged into the official pool by the rerun instead of being dropped.
  IF (SELECT COUNT(*) FROM public.history WHERE user_id = v_user AND pool_id = v_official_weapon) <> 6
    OR (SELECT COUNT(*) FROM public.history WHERE user_id = v_user AND pool_id = v_official_character) <> 3
    OR (SELECT COUNT(*) FROM public.history WHERE user_id = v_user) <> 9
    OR (SELECT COUNT(*) FROM public.history WHERE user_id = v_user AND seq_id = '9100') <> 1
    OR NOT EXISTS (
      SELECT 1 FROM public.history
      WHERE record_id = 'rerun-manual-reseed-p1' AND pool_id = v_official_weapon AND pool_version = 2
    )
    OR EXISTS (
      SELECT 1 FROM public.history
      WHERE pool_id IN (v_manual_weapon, v_manual_character)
    )
  THEN
    RAISE EXCEPTION 'rerun_migration_history_drifted';
  END IF;

  IF (SELECT COUNT(*) FROM public.pool_characters WHERE pool_id = v_official_weapon) <> 1
    OR (SELECT COUNT(*) FROM public.pool_characters WHERE pool_id = v_official_character) <> 6
    OR EXISTS (
      SELECT 1 FROM public.pool_characters
      WHERE pool_id IN (v_manual_weapon, v_manual_character)
    )
  THEN
    RAISE EXCEPTION 'rerun_migration_roster_drifted';
  END IF;

  -- Alias rows: the two seeded temporary aliases plus the two official self aliases
  -- per pool; the rerun must not duplicate them.
  IF (SELECT COUNT(*) FROM public.pool_id_aliases WHERE pool_id = v_official_weapon) <> 4
    OR (SELECT COUNT(*) FROM public.pool_id_aliases WHERE pool_id = v_official_character) <> 4
    OR EXISTS (
      SELECT 1 FROM public.pool_id_aliases
      WHERE pool_id IN (v_manual_weapon, v_manual_character)
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.pool_id_aliases
      WHERE source = 'internal' AND alias_id = v_manual_weapon
        AND pool_id = v_official_weapon AND is_primary IS FALSE
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.pool_id_aliases
      WHERE source = 'manual_placeholder' AND alias_id = v_manual_character
        AND pool_id = v_official_character AND is_primary IS FALSE
    )
  THEN
    RAISE EXCEPTION 'rerun_migration_alias_drifted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.version_content_snapshots AS snapshot
    WHERE EXISTS (
      SELECT 1
      FROM jsonb_each(snapshot.pool_bindings) AS binding(binding_key, binding_value)
      WHERE binding_value IN (
        to_jsonb(v_manual_weapon::TEXT),
        to_jsonb(v_manual_character::TEXT)
      )
    )
  ) OR NOT EXISTS (
    SELECT 1 FROM public.version_content_snapshots
    WHERE version_key = 'version-6' AND revision = 1
      AND pool_bindings ->> 'reconstruction-xuesong-youmeng-weapon-p1' = v_official_weapon
      AND pool_bindings ->> 'reconstruction-xuesong-youmeng-character-p1' = v_official_character
  ) OR NOT EXISTS (
    SELECT 1 FROM public.version_content_snapshots
    WHERE version_key = 'version-7' AND revision = 1
      AND pool_bindings ->> 'fixture-weapon-event' = v_official_weapon
      AND pool_bindings ->> 'other-event' = 'unrelated_pool'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.version_content_snapshots
    WHERE version_key = 'version-8' AND revision = 1
      AND pool_bindings ->> 'reseed-weapon-event' = v_official_weapon
      AND pool_bindings ->> 'other-event' = 'unrelated_pool'
  ) THEN
    RAISE EXCEPTION 'rerun_migration_binding_drifted';
  END IF;

  SELECT value::JSONB INTO v_timeline
  FROM public.site_config
  WHERE key = 'home_version_timeline';

  SELECT version_row -> 'pool_ids' INTO v_pool_ids
  FROM jsonb_array_elements(v_timeline -> 'versions') AS version_row
  WHERE version_row ->> 'id' = 'version-6';

  IF v_pool_ids IS DISTINCT FROM jsonb_build_array(
    v_official_weapon, v_official_character, 'unrelated_pool'
  ) THEN
    RAISE EXCEPTION 'rerun_migration_home_timeline_drifted: %', v_pool_ids;
  END IF;

  SELECT version_row -> 'pool_ids' INTO v_pool_ids
  FROM jsonb_array_elements(v_timeline -> 'versions') AS version_row
  WHERE version_row ->> 'id' = 'version-5';

  IF v_pool_ids IS DISTINCT FROM jsonb_build_array('unrelated_pool') THEN
    RAISE EXCEPTION 'rerun_migration_untouched_version_drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.site_config
    WHERE key = 'public_cache_epoch'
      AND (value::JSONB ->> 'scope') = 'pool-id-promotion'
  ) THEN
    RAISE EXCEPTION 'rerun_migration_cache_epoch_drifted';
  END IF;

  -- Rejected promotion candidates from the first file must still be untouched.
  IF NOT EXISTS (SELECT 1 FROM public.pools WHERE pool_id = 'joint_manual_extra_special_fixture')
    OR EXISTS (SELECT 1 FROM public.pools WHERE pool_id = 'unrelated_pool')
  THEN
    RAISE EXCEPTION 'rerun_migration_rejection_state_drifted';
  END IF;
END;
$idempotency$;

SELECT 'reconstruction_rerun_promotion_idempotent=ok';
