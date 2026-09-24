-- Runs on the real baseline schema after the official-import RPC fixture.
BEGIN;
DO $test$
DECLARE
  v_user UUID := '00000000-0000-0000-0000-000000000001';
  v_task UUID := '00000000-0000-0000-0000-000000000194';
  v_invalid JSONB;
  v_record JSONB := jsonb_build_object(
    'record_id', 'period-record', 'pool_id', 'rpc_pool', 'seq_id', 'period-seq',
    'game_uid', 'period-game', 'server_id', '1', 'rarity', 4,
    'item_name', 'Period fixture', 'timestamp', '2026-09-01T12:00:00Z'
  );
  v_versions INTEGER[];
BEGIN
  INSERT INTO public.official_import_tasks (
    id, user_id, source, import_mode, game_uid, server_id, status, access_key_hash
  ) VALUES (v_task, v_user, 'cn', 'incremental', 'period-game', '1', 'confirming', 'period-fixture');

  FOR v_invalid IN SELECT value FROM jsonb_array_elements('[0,-1,1.5,"2x",true,"",2147483648,{},[]]'::JSONB)
  LOOP
    BEGIN
      PERFORM public.commit_official_import_records(v_task, v_user, '[]',
        jsonb_build_array(v_record || jsonb_build_object('pool_version', v_invalid)));
      RAISE EXCEPTION 'invalid period accepted: %', v_invalid;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      IF SQLERRM <> 'official_import_pool_version_invalid' THEN RAISE; END IF;
    END;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.history WHERE game_uid = 'period-game')
    OR (SELECT status FROM public.official_import_tasks WHERE id = v_task) <> 'confirming'
  THEN RAISE EXCEPTION 'invalid period changed history or task state'; END IF;

  PERFORM public.commit_official_import_records(v_task, v_user, '[]', jsonb_build_array(
    v_record || '{"pool_version":1}',
    v_record || '{"record_id":"period-record-2","seq_id":"period-seq-2","pool_version":2}',
    v_record || '{"record_id":"period-record-3","seq_id":"period-seq-3"}',
    v_record || '{"record_id":"period-record-4","seq_id":"period-seq-4","pool_version":null}'
  ));
  SELECT array_agg(pool_version ORDER BY seq_id) INTO v_versions
  FROM (SELECT seq_id, pool_version FROM public.history
    WHERE user_id = v_user AND game_uid = 'period-game' AND pool_id = 'rpc_pool'
    ORDER BY seq_id LIMIT 4) AS page;
  IF v_versions IS DISTINCT FROM ARRAY[1,2,NULL,NULL]::INTEGER[] THEN
    RAISE EXCEPTION 'period read contract failed: %', v_versions;
  END IF;
  IF (SELECT count(DISTINCT pool_id) FROM public.history WHERE game_uid = 'period-game') <> 1 THEN
    RAISE EXCEPTION 'periods created separate pool identities';
  END IF;

  -- A later payload without period information must not erase a known period.
  UPDATE public.official_import_tasks SET status = 'confirming' WHERE id = v_task;
  PERFORM public.commit_official_import_records(v_task, v_user, '[]', jsonb_build_array(v_record));
  IF (SELECT pool_version FROM public.history WHERE record_id = 'period-record' AND user_id = v_user) <> 1 THEN
    RAISE EXCEPTION 'missing period erased known value';
  END IF;

  BEGIN
    UPDATE public.history SET pool_version = 0 WHERE record_id = 'period-record' AND user_id = v_user;
    RAISE EXCEPTION 'history constraint accepted zero';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$test$;

-- Migration 194 keeps the four extra-pool metadata fields in the atomic import,
-- including the canonical reconstruction_claim subtype for weapon products.
DO $metadata$
DECLARE
  v_user UUID := '00000000-0000-0000-0000-000000000001';
  v_task UUID := '00000000-0000-0000-0000-000000000195';
  v_rerun_task UUID := '00000000-0000-0000-0000-000000000196';
  v_pools JSONB := jsonb_build_array(
    jsonb_build_object(
      'pool_id', 'rerun_meta_wpn_fixture',
      'name', '点绘申领',
      'type', 'extra',
      'extra_subtype', 'reconstruction',
      'extra_rule_profile', 'reconstruction_weapon_v1',
      'extra_series_key', 'reconstruction-yvonne-fixture',
      'extra_series_phase', 2
    ),
    jsonb_build_object(
      'pool_id', 'rerun_meta_char_fixture',
      'name', '绚丽异彩',
      'type', 'extra',
      'extra_subtype', 'reconstruction',
      'extra_rule_profile', 'reconstruction_character_v1',
      'extra_series_key', 'reconstruction-yvonne-fixture',
      'extra_series_phase', 1
    ),
    jsonb_build_object('pool_id', 'rerun_meta_plain_fixture', 'name', '普通武器池', 'type', 'weapon')
  );
BEGIN
  INSERT INTO public.official_import_tasks (
    id, user_id, source, import_mode, game_uid, server_id, status, access_key_hash
  ) VALUES (v_task, v_user, 'cn', 'incremental', 'metadata-game', '1', 'confirming', 'metadata-fixture');

  PERFORM public.commit_official_import_records(v_task, v_user, v_pools, '[]'::JSONB);

  IF NOT EXISTS (
    SELECT 1 FROM public.pools
    WHERE pool_id = 'rerun_meta_wpn_fixture'
      AND extra_subtype = 'reconstruction_claim'
      AND extra_rule_profile = 'reconstruction_weapon_v1'
      AND extra_series_key = 'reconstruction-yvonne-fixture'
      AND extra_series_phase = 2
  ) OR NOT EXISTS (
    SELECT 1 FROM public.pools
    WHERE pool_id = 'rerun_meta_char_fixture'
      AND extra_subtype = 'reconstruction'
      AND extra_rule_profile = 'reconstruction_character_v1'
      AND extra_series_key = 'reconstruction-yvonne-fixture'
      AND extra_series_phase = 1
  ) OR NOT EXISTS (
    SELECT 1 FROM public.pools
    WHERE pool_id = 'rerun_meta_plain_fixture'
      AND extra_subtype IS NULL
      AND extra_rule_profile IS NULL
      AND extra_series_key IS NULL
      AND extra_series_phase IS NULL
  ) THEN
    RAISE EXCEPTION 'official_import_extra_pool_metadata_missing';
  END IF;

  -- A later import that omits the metadata must not erase what is already stored.
  INSERT INTO public.official_import_tasks (
    id, user_id, source, import_mode, game_uid, server_id, status, access_key_hash
  ) VALUES (v_rerun_task, v_user, 'cn', 'incremental', 'metadata-game', '1', 'confirming', 'metadata-rerun-fixture');

  PERFORM public.commit_official_import_records(
    v_rerun_task,
    v_user,
    jsonb_build_array(
      jsonb_build_object('pool_id', 'rerun_meta_wpn_fixture', 'name', '点绘申领', 'type', 'extra'),
      jsonb_build_object('pool_id', 'rerun_meta_char_fixture', 'name', '绚丽异彩', 'type', 'extra')
    ),
    '[]'::JSONB
  );

  IF (SELECT COUNT(*) FROM public.pools WHERE pool_id IN ('rerun_meta_wpn_fixture', 'rerun_meta_char_fixture')) <> 2
    OR NOT EXISTS (
      SELECT 1 FROM public.pools
      WHERE pool_id = 'rerun_meta_wpn_fixture'
        AND extra_subtype = 'reconstruction_claim'
        AND extra_series_key = 'reconstruction-yvonne-fixture'
        AND extra_series_phase = 2
    )
  THEN
    RAISE EXCEPTION 'official_import_extra_pool_metadata_erased';
  END IF;
END;
$metadata$;
ROLLBACK;
