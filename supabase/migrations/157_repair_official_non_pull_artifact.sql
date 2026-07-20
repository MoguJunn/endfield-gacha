-- 157: atomically remove legacy unknown placeholders that the official API now
-- identifies as non-pull Intel Book events.

CREATE OR REPLACE FUNCTION public.repair_official_non_pull_artifact(
  p_user_id UUID,
  p_record_id TEXT,
  p_game_uid TEXT,
  p_server_scope TEXT,
  p_pool_id TEXT,
  p_seq_id TEXT,
  p_marker_timestamp TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current public.history%ROWTYPE;
  v_anomaly_id UUID;
  v_snapshot JSONB;
BEGIN
  IF p_user_id IS NULL
    OR NULLIF(btrim(COALESCE(p_record_id, '')), '') IS NULL
    OR NULLIF(btrim(COALESCE(p_game_uid, '')), '') IS NULL
    OR NULLIF(btrim(COALESCE(p_server_scope, '')), '') IS NULL
    OR NULLIF(btrim(COALESCE(p_pool_id, '')), '') IS NULL
    OR NULLIF(btrim(COALESCE(p_seq_id, '')), '') IS NULL
    OR p_marker_timestamp IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'official_non_pull_artifact_scope_required';
  END IF;

  SELECT *
  INTO v_current
  FROM public.history
  WHERE user_id = p_user_id
    AND record_id = p_record_id
    AND game_uid = p_game_uid
    AND server_scope = p_server_scope
    AND pool_id = p_pool_id
    AND seq_id = p_seq_id
    AND timestamp = p_marker_timestamp
    AND rarity = 4
    AND COALESCE(btrim(character_id), '') = ''
    AND lower(COALESCE(btrim(character_name), '')) = ANY (
      ARRAY['', '未知', 'unknown', '未知目标', '未知角色或武器']::TEXT[]
    )
    AND lower(COALESCE(btrim(item_name), '')) = ANY (
      ARRAY['', '未知', 'unknown', '未知目标', '未知角色或武器']::TEXT[]
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('repaired', 0, 'reason', 'artifact_not_found');
  END IF;

  SELECT id
  INTO v_anomaly_id
  FROM public.history_anomalies
  WHERE user_id = p_user_id
    AND record_id = p_record_id
    AND game_uid = p_game_uid
    AND server_scope = p_server_scope
    AND pool_id = p_pool_id
    AND seq_id = p_seq_id
    AND issue_code = 'OFFICIAL_IMPORT_UNKNOWN_ITEM'
    AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('repaired', 0, 'reason', 'pending_anomaly_not_found');
  END IF;

  v_snapshot := jsonb_build_object(
    'record_id', v_current.record_id,
    'game_uid', v_current.game_uid,
    'server_scope', v_current.server_scope,
    'pool_id', v_current.pool_id,
    'seq_id', v_current.seq_id,
    'timestamp', v_current.timestamp,
    'character_id', v_current.character_id,
    'character_name', v_current.character_name,
    'item_name', v_current.item_name,
    'rarity', v_current.rarity,
    'is_free', COALESCE(v_current.is_free, FALSE),
    'is_info_book', COALESCE(v_current.is_info_book, FALSE),
    'is_standard', COALESCE(v_current.is_standard, FALSE),
    'special_type', v_current.special_type,
    'anomaly_id', v_anomaly_id
  );

  INSERT INTO public.history_change_log (
    user_id,
    record_id,
    actor_user_id,
    operation,
    changed_fields,
    old_values,
    new_values,
    reason,
    source
  ) VALUES (
    p_user_id,
    p_record_id,
    p_user_id,
    'delete',
    '[]'::JSONB,
    v_snapshot,
    '{}'::JSONB,
    '官方记录已确认为寻访情报书事件，移除旧版错误占位',
    'official_import_repair'
  );

  DELETE FROM public.history
  WHERE user_id = v_current.user_id
    AND record_id = v_current.record_id
    AND game_uid = v_current.game_uid
    AND server_scope = v_current.server_scope
    AND pool_id = v_current.pool_id
    AND seq_id = v_current.seq_id;

  PERFORM public.recompute_history_scope(
    v_current.user_id,
    v_current.game_uid,
    v_current.server_scope,
    v_current.pool_id
  );

  RETURN jsonb_build_object('repaired', 1, 'record', v_snapshot);
END;
$$;

REVOKE ALL ON FUNCTION public.repair_official_non_pull_artifact(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_official_non_pull_artifact(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;

COMMENT ON FUNCTION public.repair_official_non_pull_artifact(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) IS '仅在官方非抽卡事件精确定位且异常仍待处理时，原子删除旧版未知占位并重算保底。';

NOTIFY pgrst, 'reload schema';
