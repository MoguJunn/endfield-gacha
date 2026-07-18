-- 155: prevent legacy record-id-only batch deletion from crossing account scopes.

CREATE OR REPLACE FUNCTION public.delete_history_records_controlled(
  p_user_id UUID,
  p_record_ids TEXT[],
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current public.history%ROWTYPE;
  v_records JSONB := '[]'::JSONB;
  v_snapshot JSONB;
  v_deleted INTEGER := 0;
BEGIN
  IF p_user_id IS NULL OR COALESCE(array_length(p_record_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('deleted', 0);
  END IF;
  IF array_length(p_record_ids, 1) > 1000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'too_many_history_record_ids';
  END IF;

  -- Lock and snapshot the exact rows first. A concurrent insert after this point
  -- cannot expand the set deleted by this transaction.
  FOR v_current IN
    SELECT *
    FROM public.history
    WHERE user_id = p_user_id
      AND record_id = ANY(p_record_ids)
    ORDER BY game_uid, server_scope, pool_id, seq_id, record_id
    FOR UPDATE
  LOOP
    v_records := v_records || jsonb_build_array(to_jsonb(v_current));
  END LOOP;

  -- Older clients submit only record_id values. Refuse the whole transaction when
  -- one value maps to multiple game-account scopes for the same user.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(v_records) AS item(record_id TEXT)
    GROUP BY item.record_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '21000', MESSAGE = 'ambiguous_history_record_id';
  END IF;

  FOR v_current IN
    SELECT *
    FROM jsonb_populate_recordset(NULL::public.history, v_records)
    ORDER BY game_uid, server_scope, pool_id, seq_id, record_id
  LOOP
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
      'special_type', v_current.special_type
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
      v_current.record_id,
      p_user_id,
      'delete',
      '[]'::JSONB,
      v_snapshot,
      '{}'::JSONB,
      COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), '用户批量删除记录'),
      'user_editor'
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
    v_deleted := v_deleted + 1;
  END LOOP;

  RETURN jsonb_build_object('deleted', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_history_records_controlled(
  UUID, TEXT[], TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_history_records_controlled(
  UUID, TEXT[], TEXT
) TO service_role;
