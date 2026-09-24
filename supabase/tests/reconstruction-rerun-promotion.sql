-- Real-PostgreSQL contract for migration 195 and the reconstruction rerun promotion.
--
-- Scope note: this file runs against the filtered baseline (real migrations through
-- 189 plus 194/195). Lottery migrations 190-193 are skipped because their schema is
-- not part of that baseline and nothing here depends on them.
--
-- The fixture reproduces the state observed on production:
--   * rerun_wpn_yvonne already exists because the official weapon feed imported it
--     as a normal weapon pool with its own history and aliases;
--   * the temporary manual reconstruction pools seeded by migration 182 still exist.
-- Migration 195 must promote the temporary weapon pool onto the official ID without
-- losing history, roster, aliases, version bindings or the home timeline entry.

SELECT set_config('request.jwt.claim.role', 'service_role', FALSE);

INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-000000000195', 'rerun-promotion@example.com')
ON CONFLICT (id) DO NOTHING;

DO $fixture$
DECLARE
  v_user UUID := '00000000-0000-0000-0000-000000000195';
  v_manual_weapon TEXT := 'joint_manual_extra_reconstruction_arttyrant_p1';
  v_manual_character TEXT := 'joint_manual_extra_reconstruction_yvonne_p1';
  v_official_weapon TEXT := 'rerun_wpn_yvonne';
  v_official_character TEXT := 'fixture_rerun_character_yvonne';
BEGIN
  -- The official weapon pool from the live import: still a plain weapon pool.
  INSERT INTO public.pools (user_id, pool_id, name, type, is_limited_weapon, locked)
  VALUES (v_user, v_official_weapon, '点绘申领', 'weapon', TRUE, FALSE)
  ON CONFLICT (pool_id) DO UPDATE
  SET user_id = EXCLUDED.user_id, type = EXCLUDED.type, is_limited_weapon = EXCLUDED.is_limited_weapon;

  INSERT INTO public.pool_id_aliases (source, alias_id, pool_id, is_primary, note)
  VALUES ('official_api', v_official_weapon, v_official_weapon, TRUE, 'fixture official import self alias')
  ON CONFLICT (source, alias_id) DO UPDATE SET pool_id = EXCLUDED.pool_id, is_primary = TRUE;

  -- The official pool already lists the weapon as a non-UP roster entry.
  INSERT INTO public.pool_characters (pool_id, character_id, is_up)
  VALUES (v_official_weapon, 'wpn_pistol_0010', FALSE)
  ON CONFLICT (pool_id, character_id) DO UPDATE SET is_up = FALSE;

  -- Official history covering both periods plus one record that later collides
  -- with the temporary manual pool (same account, scope and seq_id).
  INSERT INTO public.history (
    user_id, record_id, pool_id, pool_version, rarity, game_uid, seq_id,
    server_id, region, item_name, timestamp
  ) VALUES
    (v_user, 'rerun-official-p1', v_official_weapon, 1, 6, 'rerun-game', '9101', '1', 'cn', '艺术暴君', '2026-09-24T04:00:00Z'),
    (v_user, 'rerun-official-p2', v_official_weapon, 2, 5, 'rerun-game', '9102', '1', 'cn', '灼痕', '2026-09-24T04:01:00Z'),
    (v_user, 'rerun-official-conflict', v_official_weapon, 2, 6, 'rerun-game', '9100', '1', 'cn', '艺术暴君', '2026-09-24T04:02:00Z')
  ON CONFLICT (user_id, record_id) DO NOTHING;

  -- Temporary manual pool history: two migratable rows, one colliding row and one
  -- legacy row without account/seq that the dedupe delete must not touch.
  INSERT INTO public.history (
    user_id, record_id, pool_id, pool_version, rarity, game_uid, seq_id,
    server_id, region, item_name, timestamp
  ) VALUES
    (v_user, 'rerun-manual-p1', v_manual_weapon, 1, 6, 'rerun-game', '9201', '1', 'cn', '艺术暴君', '2026-09-24T03:00:00Z'),
    (v_user, 'rerun-manual-conflict', v_manual_weapon, 1, 6, 'rerun-game', '9100', '1', 'cn', '艺术暴君', '2026-09-24T03:01:00Z'),
    (v_user, 'rerun-manual-legacy', v_manual_weapon, NULL, 4, NULL, NULL, NULL, NULL, '旧记录', '2026-01-01T04:00:00Z')
  ON CONFLICT (user_id, record_id) DO NOTHING;

  -- Character product fixture: the live import only confirmed the weapon ID, so the
  -- character official ID is intentionally fixture-only.
  INSERT INTO public.pools (user_id, pool_id, name, type, up_character, is_limited_weapon, locked)
  VALUES (v_user, v_official_character, '绚丽异彩', 'limited', '伊冯', TRUE, FALSE)
  ON CONFLICT (pool_id) DO UPDATE SET user_id = EXCLUDED.user_id, type = EXCLUDED.type;

  INSERT INTO public.pool_id_aliases (source, alias_id, pool_id, is_primary, note)
  VALUES ('official_api', v_official_character, v_official_character, TRUE, 'fixture official import self alias')
  ON CONFLICT (source, alias_id) DO UPDATE SET pool_id = EXCLUDED.pool_id, is_primary = TRUE;

  INSERT INTO public.history (
    user_id, record_id, pool_id, pool_version, rarity, game_uid, seq_id,
    server_id, region, item_name, timestamp
  ) VALUES
    (v_user, 'rerun-char-official-p1', v_official_character, 1, 6, 'rerun-game', '9301', '1', 'cn', '伊冯', '2026-09-24T05:00:00Z'),
    (v_user, 'rerun-char-manual-p1', v_manual_character, 1, 6, 'rerun-game', '9401', '1', 'cn', '伊冯', '2026-09-24T03:10:00Z'),
    (v_user, 'rerun-char-manual-p2', v_manual_character, 2, 4, 'rerun-game', '9402', '1', 'cn', '伊冯', '2026-09-24T03:11:00Z')
  ON CONFLICT (user_id, record_id) DO NOTHING;

  -- A second snapshot binds the temporary weapon pool together with an unrelated
  -- binding that must survive untouched.
  INSERT INTO public.version_content_snapshots (version_key, revision, title, pool_bindings, content, is_active)
  VALUES (
    'version-7',
    1,
    'rerun promotion fixture',
    jsonb_build_object('fixture-weapon-event', v_manual_weapon, 'other-event', 'unrelated_pool'),
    '{}'::JSONB,
    FALSE
  )
  ON CONFLICT (version_key, revision) DO UPDATE SET pool_bindings = EXCLUDED.pool_bindings;

  -- The home timeline lists both temporary IDs, a duplicate and an unrelated pool.
  UPDATE public.site_config
  SET value = jsonb_build_object(
    'versions', jsonb_build_array(
      jsonb_build_object(
        'id', 'version-5',
        'name', 'promotion-fixture-previous',
        'starts_at', '2026-09-02T06:00:00+08:00',
        'ends_at', '2026-09-24T12:00:00+08:00',
        'enabled', TRUE,
        'order', 50,
        'pool_ids', jsonb_build_array('unrelated_pool')
      ),
      jsonb_build_object(
        'id', 'version-6',
        'name', '雪凇幽梦',
        'starts_at', '2026-09-24T12:00:00+08:00',
        'ends_at', NULL,
        'enabled', TRUE,
        'order', 60,
        'pool_ids', jsonb_build_array(
          v_manual_weapon, v_manual_character, v_manual_weapon, 'unrelated_pool'
        )
      )
    )
  )::TEXT,
      updated_at = NOW()
  WHERE key = 'home_version_timeline';

  -- The effective promotion contract must accept the weapon claim subtype;
  -- migration 183 provides it and migration 195 only widens legacy 182 installs.
  IF position(
    '''reconstruction_claim'''
    IN pg_get_functiondef('public.promote_manual_pool_to_official_id(text,jsonb)'::REGPROCEDURE)
  ) = 0 THEN
    RAISE EXCEPTION 'migration_195_guard_not_applied';
  END IF;

  IF (SELECT extra_subtype FROM public.pools WHERE pool_id = v_manual_weapon) <> 'reconstruction_claim'
    OR (SELECT extra_rule_profile FROM public.pools WHERE pool_id = v_manual_weapon) <> 'reconstruction_weapon_v1'
    OR (SELECT extra_subtype FROM public.pools WHERE pool_id = v_manual_character) <> 'reconstruction'
    OR (SELECT extra_rule_profile FROM public.pools WHERE pool_id = v_manual_character) <> 'reconstruction_character_v1'
    OR (SELECT extra_series_key FROM public.pools WHERE pool_id = v_manual_weapon) <> 'reconstruction-xuesong-youmeng'
    OR (SELECT extra_series_phase FROM public.pools WHERE pool_id = v_manual_weapon) <> 1
  THEN
    RAISE EXCEPTION 'seeded_reconstruction_pools_invalid';
  END IF;
END;
$fixture$;

DO $weapon_promotion$
DECLARE
  v_user UUID := '00000000-0000-0000-0000-000000000195';
  v_manual_weapon TEXT := 'joint_manual_extra_reconstruction_arttyrant_p1';
  v_manual_character TEXT := 'joint_manual_extra_reconstruction_yvonne_p1';
  v_official_weapon TEXT := 'rerun_wpn_yvonne';
  v_manual_start TIMESTAMPTZ;
  v_manual_featured TEXT[];
  v_result JSONB;
  v_timeline JSONB;
  v_pool_ids JSONB;
BEGIN
  SELECT start_time, featured_characters
  INTO v_manual_start, v_manual_featured
  FROM public.pools
  WHERE pool_id = v_manual_weapon;

  SELECT public.promote_manual_pool_to_official_id(
    v_manual_weapon,
    jsonb_build_object('pool_id', v_official_weapon, 'name', '点绘申领')
  ) INTO v_result;

  IF v_result ->> 'promoted' IS DISTINCT FROM 'true'
    OR v_result ->> 'officialPoolId' IS DISTINCT FROM v_official_weapon
  THEN
    RAISE EXCEPTION 'rerun_weapon_promotion_result_invalid: %', v_result;
  END IF;

  IF EXISTS (SELECT 1 FROM public.pools WHERE pool_id = v_manual_weapon) THEN
    RAISE EXCEPTION 'rerun_weapon_manual_pool_still_exists';
  END IF;

  -- The official row adopts the reconstruction contract of the temporary pool while
  -- keeping the official-ID attributes the promotion must not lose.
  IF NOT EXISTS (
    SELECT 1
    FROM public.pools
    WHERE pool_id = v_official_weapon
      AND name = '点绘申领'
      AND type = 'extra'
      AND extra_subtype = 'reconstruction_claim'
      AND extra_rule_profile = 'reconstruction_weapon_v1'
      AND extra_series_key = 'reconstruction-xuesong-youmeng'
      AND extra_series_phase = 1
      AND is_limited_weapon IS TRUE
      AND locked IS TRUE
      AND user_id IS NULL
      AND start_time IS NOT DISTINCT FROM v_manual_start
      AND featured_characters IS NOT DISTINCT FROM v_manual_featured
  ) THEN
    RAISE EXCEPTION 'rerun_weapon_promoted_pool_invalid';
  END IF;

  IF (SELECT COUNT(*) FROM public.history WHERE pool_id = v_manual_weapon) <> 0
    OR (SELECT COUNT(*) FROM public.history WHERE user_id = v_user AND pool_id = v_official_weapon) <> 5
    OR (SELECT COUNT(*) FROM public.history WHERE user_id = v_user AND seq_id = '9100') <> 1
  THEN
    RAISE EXCEPTION 'rerun_weapon_history_migration_invalid';
  END IF;

  -- The existing official copy wins the collision; its period information survives.
  IF NOT EXISTS (
    SELECT 1
    FROM public.history
    WHERE user_id = v_user
      AND pool_id = v_official_weapon
      AND seq_id = '9100'
      AND record_id = 'rerun-official-conflict'
      AND pool_version = 2
  ) THEN
    RAISE EXCEPTION 'rerun_weapon_history_conflict_merge_invalid';
  END IF;

  -- Migrated rows keep their own period, including the row without account context.
  IF NOT EXISTS (
    SELECT 1 FROM public.history
    WHERE record_id = 'rerun-manual-p1' AND pool_id = v_official_weapon AND pool_version = 1
  ) OR NOT EXISTS (
    SELECT 1 FROM public.history
    WHERE record_id = 'rerun-manual-legacy' AND pool_id = v_official_weapon
      AND game_uid IS NULL AND seq_id IS NULL AND pool_version IS NULL
      AND timestamp = '2026-01-01T04:00:00Z'::TIMESTAMPTZ
  ) THEN
    RAISE EXCEPTION 'rerun_weapon_history_data_loss';
  END IF;

  IF EXISTS (SELECT 1 FROM public.pool_characters WHERE pool_id = v_manual_weapon)
    OR (SELECT COUNT(*) FROM public.pool_characters WHERE pool_id = v_official_weapon) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM public.pool_characters
      WHERE pool_id = v_official_weapon AND character_id = 'wpn_pistol_0010' AND is_up IS TRUE
    )
  THEN
    RAISE EXCEPTION 'rerun_weapon_roster_migration_invalid';
  END IF;

  IF EXISTS (SELECT 1 FROM public.pool_id_aliases WHERE pool_id = v_manual_weapon)
    OR NOT EXISTS (
      SELECT 1 FROM public.pool_id_aliases
      WHERE source = 'manual_placeholder' AND alias_id = v_manual_weapon
        AND pool_id = v_official_weapon AND is_primary IS FALSE
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.pool_id_aliases
      WHERE source = 'official_api' AND alias_id = v_official_weapon
        AND pool_id = v_official_weapon AND is_primary IS TRUE
    )
    OR (SELECT COUNT(*) FROM public.pool_id_aliases
        WHERE source = 'internal' AND alias_id = v_official_weapon AND pool_id = v_official_weapon) <> 1
  THEN
    RAISE EXCEPTION 'rerun_weapon_alias_migration_invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.version_content_snapshots AS snapshot
    WHERE EXISTS (
      SELECT 1
      FROM jsonb_each(snapshot.pool_bindings) AS binding(binding_key, binding_value)
      WHERE binding_value = to_jsonb(v_manual_weapon::TEXT)
    )
  ) OR NOT EXISTS (
    SELECT 1 FROM public.version_content_snapshots
    WHERE version_key = 'version-6' AND revision = 1
      AND pool_bindings ->> 'reconstruction-xuesong-youmeng-weapon-p1' = v_official_weapon
      AND pool_bindings ->> 'reconstruction-xuesong-youmeng-character-p1' = v_manual_character
  ) OR NOT EXISTS (
    SELECT 1 FROM public.version_content_snapshots
    WHERE version_key = 'version-7' AND revision = 1
      AND pool_bindings ->> 'fixture-weapon-event' = v_official_weapon
      AND pool_bindings ->> 'other-event' = 'unrelated_pool'
  ) THEN
    RAISE EXCEPTION 'rerun_weapon_binding_migration_invalid';
  END IF;

  SELECT value::JSONB INTO v_timeline
  FROM public.site_config
  WHERE key = 'home_version_timeline';

  SELECT version_row -> 'pool_ids' INTO v_pool_ids
  FROM jsonb_array_elements(v_timeline -> 'versions') AS version_row
  WHERE version_row ->> 'id' = 'version-6';

  IF v_pool_ids IS DISTINCT FROM jsonb_build_array(
    v_official_weapon, v_manual_character, 'unrelated_pool'
  ) THEN
    RAISE EXCEPTION 'rerun_weapon_home_timeline_invalid: %', v_pool_ids;
  END IF;

  SELECT version_row -> 'pool_ids' INTO v_pool_ids
  FROM jsonb_array_elements(v_timeline -> 'versions') AS version_row
  WHERE version_row ->> 'id' = 'version-5';

  IF v_pool_ids IS DISTINCT FROM jsonb_build_array('unrelated_pool') THEN
    RAISE EXCEPTION 'rerun_promotion_untouched_version_changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.site_config
    WHERE key = 'public_cache_epoch'
      AND (value::JSONB ->> 'scope') = 'pool-id-promotion'
  ) THEN
    RAISE EXCEPTION 'rerun_weapon_cache_epoch_invalid';
  END IF;
END;
$weapon_promotion$;

DO $character_promotion$
DECLARE
  v_user UUID := '00000000-0000-0000-0000-000000000195';
  v_manual_weapon TEXT := 'joint_manual_extra_reconstruction_arttyrant_p1';
  v_manual_character TEXT := 'joint_manual_extra_reconstruction_yvonne_p1';
  v_official_character TEXT := 'fixture_rerun_character_yvonne';
  v_timeline JSONB;
  v_pool_ids JSONB;
BEGIN
  PERFORM public.promote_manual_pool_to_official_id(
    v_manual_character,
    jsonb_build_object('pool_id', v_official_character, 'name', '绚丽异彩')
  );

  IF EXISTS (SELECT 1 FROM public.pools WHERE pool_id = v_manual_character)
    OR NOT EXISTS (
      SELECT 1 FROM public.pools
      WHERE pool_id = v_official_character
        AND name = '绚丽异彩'
        AND type = 'extra'
        AND extra_subtype = 'reconstruction'
        AND extra_rule_profile = 'reconstruction_character_v1'
        AND extra_series_key = 'reconstruction-xuesong-youmeng'
        AND extra_series_phase = 1
        AND up_character = '伊冯'
        AND featured_characters = ARRAY['chr_0017_yvonne']::TEXT[]
        AND locked IS TRUE
    )
  THEN
    RAISE EXCEPTION 'rerun_character_promoted_pool_invalid';
  END IF;

  IF (SELECT COUNT(*) FROM public.history WHERE user_id = v_user AND pool_id = v_official_character) <> 3
    OR (SELECT COUNT(*) FROM public.history WHERE pool_id = v_manual_character) <> 0
    OR NOT EXISTS (
      SELECT 1 FROM public.history
      WHERE record_id = 'rerun-char-manual-p2' AND pool_id = v_official_character AND pool_version = 2
    )
  THEN
    RAISE EXCEPTION 'rerun_character_history_migration_invalid';
  END IF;

  IF (SELECT COUNT(*) FROM public.pool_characters WHERE pool_id = v_official_character) <> 6
    OR EXISTS (SELECT 1 FROM public.pool_characters WHERE pool_id = v_manual_character)
  THEN
    RAISE EXCEPTION 'rerun_character_roster_migration_invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.version_content_snapshots AS snapshot
    WHERE EXISTS (
      SELECT 1
      FROM jsonb_each(snapshot.pool_bindings) AS binding(binding_key, binding_value)
      WHERE binding_value = to_jsonb(v_manual_character::TEXT)
    )
  ) OR NOT EXISTS (
    SELECT 1 FROM public.version_content_snapshots
    WHERE version_key = 'version-6' AND revision = 1
      AND pool_bindings ->> 'reconstruction-xuesong-youmeng-character-p1' = v_official_character
  ) THEN
    RAISE EXCEPTION 'rerun_character_binding_migration_invalid';
  END IF;

  SELECT value::JSONB INTO v_timeline
  FROM public.site_config
  WHERE key = 'home_version_timeline';

  SELECT version_row -> 'pool_ids' INTO v_pool_ids
  FROM jsonb_array_elements(v_timeline -> 'versions') AS version_row
  WHERE version_row ->> 'id' = 'version-6';

  IF v_pool_ids IS DISTINCT FROM jsonb_build_array(
    'rerun_wpn_yvonne', v_official_character, 'unrelated_pool'
  ) THEN
    RAISE EXCEPTION 'rerun_character_home_timeline_invalid: %', v_pool_ids;
  END IF;

  IF EXISTS (SELECT 1 FROM public.pools WHERE pool_id = 'unrelated_pool') THEN
    RAISE EXCEPTION 'promotion_created_unrelated_pool_row';
  END IF;
END;
$character_promotion$;

DO $rejection_contract$
DECLARE
  v_special_manual TEXT := 'joint_manual_extra_special_fixture';
BEGIN
  INSERT INTO public.pools (user_id, pool_id, name, type, extra_subtype, extra_rule_profile, locked)
  VALUES (NULL, v_special_manual, 'Special fixture', 'extra', 'special', 'brilliance_festival_v1', FALSE)
  ON CONFLICT (pool_id) DO NOTHING;

  BEGIN
    PERFORM public.promote_manual_pool_to_official_id(
      v_special_manual,
      jsonb_build_object('pool_id', 'unrelated_pool')
    );
    RAISE EXCEPTION 'non_reconstruction_manual_pool_was_promoted';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      IF SQLERRM <> 'manual_reconstruction_pool_invalid' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.promote_manual_pool_to_official_id(
      'joint_manual_extra_reconstruction_arttyrant_p1',
      jsonb_build_object('pool_id', 'joint_manual_extra_reconstruction_arttyrant_p1')
    );
    RAISE EXCEPTION 'manual_official_id_was_accepted';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      IF SQLERRM <> 'official_pool_id_invalid' THEN
        RAISE;
      END IF;
  END;

  IF NOT EXISTS (SELECT 1 FROM public.pools WHERE pool_id = v_special_manual)
    OR EXISTS (SELECT 1 FROM public.pools WHERE pool_id = 'unrelated_pool')
  THEN
    RAISE EXCEPTION 'rejected_promotion_changed_catalog';
  END IF;
END;
$rejection_contract$;

-- Re-stage the temporary weapon catalog entry the way a pre-migration database looks,
-- so the second run of migration 195 performs its inline merge with the same RPC.
DO $reseed$
DECLARE
  v_user UUID := '00000000-0000-0000-0000-000000000195';
  v_manual_weapon TEXT := 'joint_manual_extra_reconstruction_arttyrant_p1';
  v_official_weapon TEXT := 'rerun_wpn_yvonne';
  v_official_character TEXT := 'fixture_rerun_character_yvonne';
  v_timeline JSONB;
  v_versions JSONB;
  v_version JSONB;
  v_version_result JSONB := '[]'::JSONB;
BEGIN
  INSERT INTO public.pools (
    user_id, pool_id, name, type,
    extra_subtype, extra_rule_profile, extra_series_key, extra_series_phase,
    locked, up_character, featured_characters
  ) VALUES (
    NULL, v_manual_weapon, '点绘申领', 'extra',
    'reconstruction', 'reconstruction_weapon_v1', 'reconstruction-xuesong-youmeng', 1,
    TRUE, '艺术暴君', ARRAY['wpn_pistol_0010']::TEXT[]
  );

  INSERT INTO public.pool_characters (pool_id, character_id, is_up)
  VALUES (v_manual_weapon, 'wpn_pistol_0010', TRUE);

  INSERT INTO public.history (
    user_id, record_id, pool_id, pool_version, rarity, game_uid, seq_id,
    server_id, region, item_name, timestamp
  ) VALUES
    (v_user, 'rerun-manual-reseed-p1', v_manual_weapon, 2, 6, 'rerun-game', '9202', '1', 'cn', '艺术暴君', '2026-09-24T03:30:00Z');

  INSERT INTO public.version_content_snapshots (version_key, revision, title, pool_bindings, content, is_active)
  VALUES (
    'version-8',
    1,
    'rerun reseed fixture',
    jsonb_build_object('reseed-weapon-event', v_manual_weapon, 'other-event', 'unrelated_pool'),
    '{}'::JSONB,
    FALSE
  )
  ON CONFLICT (version_key, revision) DO UPDATE SET pool_bindings = EXCLUDED.pool_bindings;

  SELECT value::JSONB INTO v_timeline
  FROM public.site_config
  WHERE key = 'home_version_timeline';

  FOR v_version IN SELECT version_row FROM jsonb_array_elements(v_timeline -> 'versions') AS version_row
  LOOP
    IF v_version ->> 'id' = 'version-6' THEN
      v_version := jsonb_set(
        v_version,
        '{pool_ids}',
        jsonb_build_array(v_official_weapon, v_manual_weapon, v_official_character, 'unrelated_pool')
      );
    END IF;
    v_version_result := v_version_result || jsonb_build_array(v_version);
  END LOOP;

  UPDATE public.site_config
  SET value = jsonb_set(v_timeline, '{versions}', v_version_result, TRUE)::TEXT,
      updated_at = NOW()
  WHERE key = 'home_version_timeline';
END;
$reseed$;

SELECT 'reconstruction_rerun_promotion=ok';
