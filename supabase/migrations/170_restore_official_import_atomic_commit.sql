-- 170: restore the complete official-import commit after migration 168
-- replaced it with a stale conflict target and a reduced history payload.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.history'::REGCLASS
      AND constraint_row.contype IN ('p', 'u')
      AND (
        SELECT array_agg(attribute.attname::TEXT ORDER BY key_column.ordinality)
        FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
        JOIN pg_attribute AS attribute
          ON attribute.attrelid = constraint_row.conrelid
         AND attribute.attnum = key_column.attnum
      ) = ARRAY['user_id', 'game_uid', 'server_scope', 'pool_id', 'seq_id']::TEXT[]
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'official_import_history_conflict_constraint_missing';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_official_import_records(
  p_task_id UUID,
  p_user_id UUID,
  p_pools JSONB,
  p_history JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task public.official_import_tasks%ROWTYPE;
  v_pools JSONB := COALESCE(p_pools, '[]'::JSONB);
  v_history JSONB := COALESCE(p_history, '[]'::JSONB);
  v_pool_count INTEGER := 0;
  v_history_count INTEGER := 0;
  v_expected_count INTEGER := 0;
  v_result JSONB;
BEGIN
  IF jsonb_typeof(v_pools) <> 'array' OR jsonb_typeof(v_history) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'official_import_payload_must_be_arrays';
  END IF;

  SELECT *
  INTO v_task
  FROM public.official_import_tasks
  WHERE id = p_task_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'official_import_task_not_found';
  END IF;
  IF v_task.status = 'committed' THEN
    RETURN COALESCE(v_task.summary -> 'commitResult', '{}'::JSONB);
  END IF;
  IF v_task.status <> 'confirming' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'official_import_task_not_confirming';
  END IF;

  IF NOT public.is_account_credential_allowed(p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'temporary_password_expired';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(v_history) AS item(
      record_id TEXT,
      pool_id TEXT,
      seq_id TEXT,
      game_uid TEXT,
      rarity INTEGER,
      timestamp TIMESTAMPTZ
    )
    WHERE NULLIF(btrim(item.record_id), '') IS NULL
      OR NULLIF(btrim(item.pool_id), '') IS NULL
      OR NULLIF(btrim(item.seq_id), '') IS NULL
      OR NULLIF(btrim(item.game_uid), '') IS NULL
      OR item.rarity IS NULL
      OR item.rarity NOT BETWEEN 3 AND 6
      OR item.timestamp IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'official_import_history_record_invalid';
  END IF;

  INSERT INTO public.pools (
    user_id,
    pool_id,
    name,
    type,
    start_time,
    end_time,
    up_character,
    featured_characters,
    created_at,
    updated_at
  )
  SELECT
    p_user_id,
    item.pool_id,
    COALESCE(NULLIF(btrim(item.name), ''), item.pool_id),
    item.type,
    item.start_time,
    item.end_time,
    NULLIF(btrim(item.up_character), ''),
    item.featured_characters,
    COALESCE(item.created_at, NOW()),
    NOW()
  FROM jsonb_to_recordset(v_pools) AS item(
    pool_id TEXT,
    name TEXT,
    type TEXT,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    up_character TEXT,
    featured_characters TEXT[],
    created_at TIMESTAMPTZ
  )
  WHERE NULLIF(btrim(item.pool_id), '') IS NOT NULL
    AND NULLIF(btrim(item.type), '') IS NOT NULL
  ON CONFLICT (pool_id) DO NOTHING;
  GET DIAGNOSTICS v_pool_count = ROW_COUNT;

  INSERT INTO public.history (
    user_id,
    record_id,
    pool_id,
    seq_id,
    game_uid,
    nick_name,
    rarity,
    character_name,
    item_name,
    character_id,
    timestamp,
    pity,
    is_free,
    is_info_book,
    is_new,
    is_standard,
    server_id,
    region,
    batch_id,
    special_type,
    created_at,
    updated_at
  )
  SELECT
    p_user_id,
    item.record_id,
    item.pool_id,
    item.seq_id,
    item.game_uid,
    item.nick_name,
    item.rarity,
    item.character_name,
    item.item_name,
    item.character_id,
    item.timestamp,
    LEAST(GREATEST(COALESCE(item.pity, 0), 0), 80),
    COALESCE(item.is_free, FALSE),
    COALESCE(item.is_info_book, FALSE),
    COALESCE(item.is_new, FALSE),
    COALESCE(item.is_standard, FALSE),
    item.server_id,
    item.region,
    item.batch_id,
    item.special_type,
    COALESCE(item.created_at, NOW()),
    NOW()
  FROM jsonb_to_recordset(v_history) AS item(
    record_id TEXT,
    pool_id TEXT,
    seq_id TEXT,
    game_uid TEXT,
    nick_name TEXT,
    rarity INTEGER,
    character_name TEXT,
    item_name TEXT,
    character_id TEXT,
    timestamp TIMESTAMPTZ,
    pity INTEGER,
    is_free BOOLEAN,
    is_info_book BOOLEAN,
    is_new BOOLEAN,
    is_standard BOOLEAN,
    server_id TEXT,
    region TEXT,
    batch_id TEXT,
    special_type TEXT,
    created_at TIMESTAMPTZ
  )
  ON CONFLICT (user_id, game_uid, server_scope, pool_id, seq_id)
  DO UPDATE SET
    record_id = EXCLUDED.record_id,
    nick_name = EXCLUDED.nick_name,
    rarity = EXCLUDED.rarity,
    character_name = EXCLUDED.character_name,
    item_name = EXCLUDED.item_name,
    character_id = EXCLUDED.character_id,
    timestamp = EXCLUDED.timestamp,
    pity = EXCLUDED.pity,
    is_free = EXCLUDED.is_free,
    is_info_book = EXCLUDED.is_info_book,
    is_new = EXCLUDED.is_new,
    is_standard = EXCLUDED.is_standard,
    server_id = EXCLUDED.server_id,
    region = EXCLUDED.region,
    batch_id = EXCLUDED.batch_id,
    special_type = EXCLUDED.special_type,
    updated_at = NOW();
  GET DIAGNOSTICS v_history_count = ROW_COUNT;

  v_expected_count := COALESCE((v_task.summary ->> 'newRecords')::INTEGER, v_history_count);
  v_result := jsonb_build_object(
    'savedRecords', v_history_count,
    'skippedRecords', GREATEST(v_expected_count - v_history_count, 0),
    'createdPools', v_pool_count,
    'atomicCommit', TRUE
  );

  UPDATE public.official_import_tasks
  SET
    status = 'committed',
    summary = COALESCE(summary, '{}'::JSONB) || jsonb_build_object('commitResult', v_result),
    committed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_task_id
    AND user_id = p_user_id
    AND status = 'confirming';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'official_import_task_state_changed';
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_official_import_records(UUID, UUID, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.commit_official_import_records(UUID, UUID, JSONB, JSONB)
      TO service_role;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.commit_official_import_records(UUID, UUID, JSONB, JSONB) IS
  '确认官方导入时，在一笔事务中校验凭据、写入完整卡池与历史，并提交审阅任务。';

DO $$
DECLARE
  v_definition TEXT;
BEGIN
  v_definition := pg_get_functiondef(
    'public.commit_official_import_records(uuid,uuid,jsonb,jsonb)'::REGPROCEDURE
  );

  IF v_definition !~* 'ON CONFLICT\s*\(\s*user_id\s*,\s*game_uid\s*,\s*server_scope\s*,\s*pool_id\s*,\s*seq_id\s*\)' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'official_import_history_conflict_target_invalid';
  END IF;

  IF v_definition ~* 'ON CONFLICT\s*\(\s*user_id\s*,\s*game_uid\s*,\s*server_id\s*,' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'official_import_legacy_conflict_target_present';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
