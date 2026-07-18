-- 152: 用户日志编辑、导入审阅与异常记录基础设施。

-- 旧自建实例曾将 record_id 保存为 DOUBLE PRECISION，并以单列 id 作为主键。
-- 新版导入需要保留前导零、大整数和文本后缀，因此统一转换为 TEXT。
-- 数值型旧记录必须是有限整数；异常值应先人工调查，禁止静默截断。
DO $$
DECLARE
  v_record_id_type TEXT;
BEGIN
  SELECT data_type
  INTO v_record_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'history'
    AND column_name = 'record_id';

  IF v_record_id_type IS NULL THEN
    RAISE EXCEPTION 'history.record_id is required';
  END IF;

  IF v_record_id_type IN ('double precision', 'real', 'numeric') THEN
    IF EXISTS (
      SELECT 1
      FROM public.history
      WHERE record_id::TEXT IN ('NaN', 'Infinity', '-Infinity')
        OR record_id::NUMERIC <> trunc(record_id::NUMERIC)
    ) THEN
      RAISE EXCEPTION 'history.record_id contains non-integer numeric values';
    END IF;

    ALTER TABLE public.history
      ALTER COLUMN record_id TYPE TEXT
      USING record_id::NUMERIC::TEXT;
  ELSIF v_record_id_type <> 'text' THEN
    ALTER TABLE public.history
      ALTER COLUMN record_id TYPE TEXT
      USING record_id::TEXT;
  END IF;
END $$;

ALTER TABLE public.history
  ADD COLUMN IF NOT EXISTS is_info_book BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS edit_version BIGINT NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_history_user_record_id
  ON public.history (user_id, record_id);

CREATE TABLE IF NOT EXISTS public.official_import_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('cn', 'intl')),
  import_mode TEXT NOT NULL CHECK (import_mode IN ('incremental', 'full')),
  game_uid TEXT NOT NULL,
  server_id TEXT,
  region TEXT,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (
    status IN (
      'processing',
      'awaiting_confirmation',
      'confirming',
      'committed',
      'rejected',
      'expired',
      'failed'
    )
  ),
  access_key_hash TEXT NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  issues JSONB NOT NULL DEFAULT '[]'::JSONB,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  committed_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.official_import_staged_records (
  id BIGSERIAL PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.official_import_tasks(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  pool_id TEXT,
  item_id TEXT,
  item_name TEXT,
  item_type TEXT NOT NULL DEFAULT 'unknown',
  quality INTEGER,
  timestamp TIMESTAMPTZ,
  seq_id TEXT,
  normalized_record JSONB NOT NULL DEFAULT '{}'::JSONB,
  raw_min JSONB NOT NULL DEFAULT '{}'::JSONB,
  issues JSONB NOT NULL DEFAULT '[]'::JSONB,
  selected_action TEXT NOT NULL DEFAULT 'keep' CHECK (selected_action IN ('keep', 'skip')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, ordinal)
);

CREATE TABLE IF NOT EXISTS public.history_change_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN ('update', 'delete', 'confirm_anomaly')),
  changed_fields JSONB NOT NULL DEFAULT '[]'::JSONB,
  old_values JSONB NOT NULL DEFAULT '{}'::JSONB,
  new_values JSONB NOT NULL DEFAULT '{}'::JSONB,
  reason TEXT,
  source TEXT NOT NULL DEFAULT 'user_editor',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.history_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL,
  game_uid TEXT NOT NULL,
  server_scope TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  seq_id TEXT NOT NULL,
  issue_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'confirmed', 'resolved', 'deleted', 'dismissed')
  ),
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  postponed_until TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolution_note TEXT,
  UNIQUE (user_id, game_uid, server_scope, pool_id, seq_id, issue_code),
  FOREIGN KEY (user_id, game_uid, server_scope, pool_id, seq_id)
    REFERENCES public.history(user_id, game_uid, server_scope, pool_id, seq_id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_official_import_tasks_user_status
  ON public.official_import_tasks (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_official_import_tasks_expiry
  ON public.official_import_tasks (expires_at)
  WHERE status IN ('processing', 'awaiting_confirmation', 'confirming');

CREATE INDEX IF NOT EXISTS idx_official_import_staged_task
  ON public.official_import_staged_records (task_id, ordinal);

CREATE INDEX IF NOT EXISTS idx_history_change_log_user_record
  ON public.history_change_log (user_id, record_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_history_anomalies_user_scope
  ON public.history_anomalies (user_id, game_uid, server_scope, pool_id, status);

CREATE OR REPLACE FUNCTION public.recompute_history_scope(
  p_user_id UUID,
  p_game_uid TEXT,
  p_server_scope TEXT,
  p_pool_id TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record RECORD;
  v_pity INTEGER := 0;
  v_batch_index INTEGER := -1;
  v_last_timestamp TIMESTAMPTZ;
  v_batch_id TEXT;
  v_count INTEGER := 0;
  v_counts_toward_pity BOOLEAN;
BEGIN
  IF p_user_id IS NULL OR p_game_uid IS NULL OR p_server_scope IS NULL OR p_pool_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_record IN
    SELECT record_id, seq_id, timestamp, rarity, is_free, is_info_book, special_type
    FROM public.history
    WHERE user_id = p_user_id
      AND game_uid = p_game_uid
      AND server_scope = p_server_scope
      AND pool_id = p_pool_id
    ORDER BY
      timestamp ASC NULLS LAST,
      CASE WHEN seq_id ~ '^[0-9]+$' THEN seq_id::NUMERIC END ASC NULLS LAST,
      seq_id ASC,
      record_id ASC
    FOR UPDATE
  LOOP
    IF v_batch_index = -1 OR v_record.timestamp IS DISTINCT FROM v_last_timestamp THEN
      v_batch_index := v_batch_index + 1;
      v_last_timestamp := v_record.timestamp;
      v_batch_id := CASE
        WHEN v_record.timestamp IS NULL THEN 'batch_unknown_' || v_batch_index::TEXT
        ELSE 'batch_' || FLOOR(EXTRACT(EPOCH FROM v_record.timestamp) * 1000)::BIGINT::TEXT || '_' || v_batch_index::TEXT
      END;
    END IF;

    v_counts_toward_pity := NOT COALESCE(v_record.is_free, FALSE)
      AND NOT COALESCE(v_record.is_info_book, FALSE)
      AND COALESCE(v_record.special_type, '') <> 'gift';

    IF v_counts_toward_pity THEN
      v_pity := v_pity + 1;
    END IF;

    UPDATE public.history
    SET
      pity = LEAST(GREATEST(v_pity, 0), 80),
      batch_id = v_batch_id,
      updated_at = NOW()
    WHERE user_id = p_user_id
      AND game_uid = p_game_uid
      AND server_scope = p_server_scope
      AND pool_id = p_pool_id
      AND record_id = v_record.record_id
      AND seq_id = v_record.seq_id
      AND (
        pity IS DISTINCT FROM LEAST(GREATEST(v_pity, 0), 80)
        OR batch_id IS DISTINCT FROM v_batch_id
      );

    v_count := v_count + 1;
    IF v_counts_toward_pity AND v_record.rarity = 6 THEN
      v_pity := 0;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_history_scope(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_history_scope(UUID, TEXT, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_history_scope(UUID, TEXT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.update_history_record_controlled(
  p_user_id UUID,
  p_record_id TEXT,
  p_game_uid TEXT,
  p_server_scope TEXT,
  p_pool_id TEXT,
  p_seq_id TEXT,
  p_expected_version BIGINT,
  p_changes JSONB,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current public.history%ROWTYPE;
  v_updated public.history%ROWTYPE;
  v_changes JSONB := COALESCE(p_changes, '{}'::JSONB);
  v_allowed_fields TEXT[] := ARRAY[
    'timestamp',
    'pool_id',
    'character_id',
    'character_name',
    'item_name',
    'rarity',
    'is_free',
    'is_info_book',
    'is_standard',
    'special_type'
  ];
  v_key TEXT;
  v_changed_fields JSONB := '[]'::JSONB;
  v_old_values JSONB := '{}'::JSONB;
  v_new_values JSONB := '{}'::JSONB;
BEGIN
  IF p_user_id IS NULL
    OR p_record_id IS NULL
    OR p_game_uid IS NULL
    OR p_pool_id IS NULL
    OR p_seq_id IS NULL
    OR p_expected_version IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'history_record_scope_required';
  END IF;

  SELECT *
  INTO v_current
  FROM public.history
  WHERE user_id = p_user_id
    AND record_id = p_record_id
    AND game_uid = p_game_uid
    AND pool_id = p_pool_id
    AND seq_id = p_seq_id
    AND (p_server_scope IS NULL OR server_scope = p_server_scope)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'history_record_not_found';
  END IF;
  IF COALESCE(v_current.edit_version, 1) <> p_expected_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'history_record_conflict';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_changes)
  LOOP
    IF NOT (v_key = ANY(v_allowed_fields)) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'history_change_field_not_allowed';
    END IF;
    IF (to_jsonb(v_current) -> v_key) IS DISTINCT FROM (v_changes -> v_key) THEN
      v_changed_fields := v_changed_fields || jsonb_build_array(v_key);
      v_old_values := v_old_values || jsonb_build_object(v_key, to_jsonb(v_current) -> v_key);
      v_new_values := v_new_values || jsonb_build_object(v_key, v_changes -> v_key);
    END IF;
  END LOOP;

  IF jsonb_array_length(v_changed_fields) = 0 THEN
    RETURN jsonb_build_object('updated', 0, 'record', to_jsonb(v_current));
  END IF;

  UPDATE public.history
  SET
    timestamp = CASE WHEN v_changes ? 'timestamp' THEN (v_changes ->> 'timestamp')::TIMESTAMPTZ ELSE timestamp END,
    pool_id = CASE WHEN v_changes ? 'pool_id' THEN v_changes ->> 'pool_id' ELSE pool_id END,
    character_id = CASE WHEN v_changes ? 'character_id' THEN NULLIF(v_changes ->> 'character_id', '') ELSE character_id END,
    character_name = CASE WHEN v_changes ? 'character_name' THEN NULLIF(v_changes ->> 'character_name', '') ELSE character_name END,
    item_name = CASE WHEN v_changes ? 'item_name' THEN NULLIF(v_changes ->> 'item_name', '') ELSE item_name END,
    rarity = CASE WHEN v_changes ? 'rarity' THEN (v_changes ->> 'rarity')::INTEGER ELSE rarity END,
    is_free = CASE WHEN v_changes ? 'is_free' THEN (v_changes ->> 'is_free')::BOOLEAN ELSE is_free END,
    is_info_book = CASE WHEN v_changes ? 'is_info_book' THEN (v_changes ->> 'is_info_book')::BOOLEAN ELSE is_info_book END,
    is_standard = CASE WHEN v_changes ? 'is_standard' THEN (v_changes ->> 'is_standard')::BOOLEAN ELSE is_standard END,
    special_type = CASE WHEN v_changes ? 'special_type' THEN NULLIF(v_changes ->> 'special_type', '') ELSE special_type END,
    edit_version = p_expected_version + 1,
    updated_at = NOW()
  WHERE user_id = p_user_id
    AND record_id = p_record_id
    AND game_uid = p_game_uid
    AND pool_id = p_pool_id
    AND seq_id = p_seq_id
    AND (p_server_scope IS NULL OR server_scope = p_server_scope)
    AND edit_version = p_expected_version
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'history_record_conflict';
  END IF;

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
    'update',
    v_changed_fields,
    v_old_values,
    v_new_values,
    NULLIF(btrim(COALESCE(p_reason, '')), ''),
    'user_editor'
  );

  PERFORM public.recompute_history_scope(
    v_current.user_id,
    v_current.game_uid,
    v_current.server_scope,
    v_current.pool_id
  );
  IF (v_updated.game_uid, v_updated.server_scope, v_updated.pool_id)
    IS DISTINCT FROM (v_current.game_uid, v_current.server_scope, v_current.pool_id) THEN
    PERFORM public.recompute_history_scope(
      v_updated.user_id,
      v_updated.game_uid,
      v_updated.server_scope,
      v_updated.pool_id
    );
  END IF;

  UPDATE public.history_anomalies
  SET
    status = 'resolved',
    resolved_at = NOW(),
    resolved_by = p_user_id,
    resolution_note = COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), '用户已修改记录')
  WHERE user_id = p_user_id
    AND record_id = p_record_id
    AND game_uid = v_updated.game_uid
    AND server_scope = v_updated.server_scope
    AND pool_id = v_updated.pool_id
    AND seq_id = v_updated.seq_id
    AND status = 'pending';

  SELECT *
  INTO v_updated
  FROM public.history
  WHERE user_id = p_user_id
    AND record_id = p_record_id
    AND game_uid = v_updated.game_uid
    AND server_scope = v_updated.server_scope
    AND pool_id = v_updated.pool_id
    AND seq_id = v_updated.seq_id;

  RETURN jsonb_build_object('updated', 1, 'record', to_jsonb(v_updated));
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_history_record_controlled(
  p_user_id UUID,
  p_record_id TEXT,
  p_game_uid TEXT,
  p_server_scope TEXT,
  p_pool_id TEXT,
  p_seq_id TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current public.history%ROWTYPE;
  v_snapshot JSONB;
BEGIN
  SELECT *
  INTO v_current
  FROM public.history
  WHERE user_id = p_user_id
    AND record_id = p_record_id
    AND game_uid = p_game_uid
    AND pool_id = p_pool_id
    AND seq_id = p_seq_id
    AND (p_server_scope IS NULL OR server_scope = p_server_scope)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'history_record_not_found';
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
    p_record_id,
    p_user_id,
    'delete',
    '[]'::JSONB,
    v_snapshot,
    '{}'::JSONB,
    COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), '用户删除异常记录'),
    'user_editor'
  );

  DELETE FROM public.history
  WHERE user_id = p_user_id
    AND record_id = p_record_id
    AND game_uid = p_game_uid
    AND pool_id = p_pool_id
    AND seq_id = p_seq_id
    AND (p_server_scope IS NULL OR server_scope = p_server_scope);

  PERFORM public.recompute_history_scope(
    v_current.user_id,
    v_current.game_uid,
    v_current.server_scope,
    v_current.pool_id
  );

  RETURN jsonb_build_object('deleted', 1, 'record', v_snapshot);
END;
$$;

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
  v_snapshot JSONB;
  v_deleted INTEGER := 0;
BEGIN
  IF p_user_id IS NULL OR COALESCE(array_length(p_record_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('deleted', 0);
  END IF;
  IF array_length(p_record_ids, 1) > 1000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'too_many_history_record_ids';
  END IF;

  FOR v_current IN
    SELECT *
    FROM public.history
    WHERE user_id = p_user_id
      AND record_id = ANY(p_record_ids)
    ORDER BY game_uid, server_scope, pool_id, seq_id, record_id
    FOR UPDATE
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

REVOKE ALL ON FUNCTION public.update_history_record_controlled(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_history_record_controlled(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, JSONB, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION public.delete_history_record_controlled(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_history_record_controlled(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION public.delete_history_records_controlled(
  UUID, TEXT[], TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_history_records_controlled(
  UUID, TEXT[], TEXT
) TO service_role;

ALTER TABLE public.official_import_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_import_staged_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.history_change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.history_anomalies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS official_import_tasks_select_own ON public.official_import_tasks;
CREATE POLICY official_import_tasks_select_own ON public.official_import_tasks
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS official_import_staged_records_select_own ON public.official_import_staged_records;
CREATE POLICY official_import_staged_records_select_own ON public.official_import_staged_records
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.official_import_tasks task
      WHERE task.id = task_id
        AND task.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS history_change_log_select_own ON public.history_change_log;
CREATE POLICY history_change_log_select_own ON public.history_change_log
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS history_anomalies_select_own ON public.history_anomalies;
CREATE POLICY history_anomalies_select_own ON public.history_anomalies
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS history_anomalies_select_admin ON public.history_anomalies;
CREATE POLICY history_anomalies_select_admin ON public.history_anomalies
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.profiles profile
      WHERE profile.id = auth.uid()
        AND profile.role IN ('admin', 'super_admin')
    )
  );

COMMENT ON COLUMN public.history.is_info_book IS
  '该条抽取是否由情报书额度产生；与普通免费抽取 is_free 分开记录。';

COMMENT ON COLUMN public.history.edit_version IS
  '用户日志编辑的乐观锁版本，每次受控更新加一。';

COMMENT ON TABLE public.official_import_tasks IS
  '官方导入写库前审阅任务，不保存 token。';

COMMENT ON TABLE public.official_import_staged_records IS
  '官方导入规范化后的暂存记录，仅保留审计所需的精简原始字段。';

COMMENT ON TABLE public.history_change_log IS
  '用户或管理员通过受控接口修改、删除日志时写入的最小审计台账。';

COMMENT ON TABLE public.history_anomalies IS
  '历史记录异常待核对状态；不直接修改原始抽卡内容。';

COMMENT ON FUNCTION public.recompute_history_scope(UUID, TEXT, TEXT, TEXT) IS
  '受控编辑或删除后，按账号、区服与卡池重算保底和批次。免费、情报书及赠送记录不计入保底。';

NOTIFY pgrst, 'reload schema';
