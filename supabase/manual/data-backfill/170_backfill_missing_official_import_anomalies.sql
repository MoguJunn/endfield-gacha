-- 170 production repair: restore review markers that were lost when one
-- invalid child key caused a whole history_anomalies upsert batch to fail.
--
-- This is intentionally a guarded, one-time data repair and is excluded from
-- the generated baseline. It inserts from the existing history parent rows so
-- every composite foreign key is guaranteed to match.

DO $$
DECLARE
  v_candidate_count INTEGER;
  v_inserted_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_candidate_count
  FROM public.history AS history_row
  LEFT JOIN public.history_anomalies AS anomaly
    ON anomaly.user_id = history_row.user_id
   AND anomaly.game_uid = history_row.game_uid
   AND anomaly.server_scope = history_row.server_scope
   AND anomaly.pool_id = history_row.pool_id
   AND anomaly.seq_id = history_row.seq_id
   AND anomaly.issue_code = 'OFFICIAL_IMPORT_UNKNOWN_ITEM'
  WHERE anomaly.id IS NULL
    AND NULLIF(btrim(history_row.character_id), '') IS NULL
    AND NULLIF(btrim(history_row.item_name), '') IS NULL
    AND history_row.rarity = 4
    AND history_row.special_type IS NULL;

  IF v_candidate_count <> 10 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = FORMAT(
        'official_import_anomaly_backfill_snapshot_mismatch: expected=10 actual=%s',
        v_candidate_count
      );
  END IF;

  WITH inserted AS (
    INSERT INTO public.history_anomalies (
      user_id,
      record_id,
      game_uid,
      server_scope,
      pool_id,
      seq_id,
      issue_code,
      status,
      details
    )
    SELECT
      history_row.user_id,
      history_row.record_id,
      history_row.game_uid,
      history_row.server_scope,
      history_row.pool_id,
      history_row.seq_id,
      'OFFICIAL_IMPORT_UNKNOWN_ITEM',
      'pending',
      jsonb_strip_nulls(jsonb_build_object(
        'message', '本次官方导入没有完整识别这条记录的角色或武器，请确认它是否正确。',
        'itemName', COALESCE(
          NULLIF(btrim(history_row.item_name), ''),
          NULLIF(btrim(history_row.character_name), ''),
          '未知角色或武器'
        ),
        'rarity', history_row.rarity,
        'timestamp', history_row.timestamp,
        'pity', history_row.pity,
        'serverId', history_row.server_id,
        'region', history_row.region,
        'issueCodes', jsonb_build_array('MISSING_ITEM_ID_AND_NAME'),
        'repairSource', 'production_repair_2026_08_03'
      ))
    FROM public.history AS history_row
    LEFT JOIN public.history_anomalies AS anomaly
      ON anomaly.user_id = history_row.user_id
     AND anomaly.game_uid = history_row.game_uid
     AND anomaly.server_scope = history_row.server_scope
     AND anomaly.pool_id = history_row.pool_id
     AND anomaly.seq_id = history_row.seq_id
     AND anomaly.issue_code = 'OFFICIAL_IMPORT_UNKNOWN_ITEM'
    WHERE anomaly.id IS NULL
      AND NULLIF(btrim(history_row.character_id), '') IS NULL
      AND NULLIF(btrim(history_row.item_name), '') IS NULL
      AND history_row.rarity = 4
      AND history_row.special_type IS NULL
    ON CONFLICT (user_id, game_uid, server_scope, pool_id, seq_id, issue_code)
      DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*)
  INTO v_inserted_count
  FROM inserted;

  IF v_inserted_count <> v_candidate_count THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = FORMAT(
        'official_import_anomaly_backfill_write_mismatch: expected=%s actual=%s',
        v_candidate_count,
        v_inserted_count
      );
  END IF;
END;
$$;
