-- 2026100911: 用户确认的补录独立保存；不生成官方 seq，也不写入 history。
-- 仅保存本地迁移文件。必须通过正常迁移发布流程另行应用。
BEGIN;

CREATE TABLE public.account_data_workbench_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  game_uid TEXT NOT NULL CHECK (length(btrim(game_uid)) BETWEEN 1 AND 160),
  server_scope TEXT NOT NULL CHECK (length(btrim(server_scope)) BETWEEN 1 AND 160),
  pool_id TEXT,
  entry_id UUID NOT NULL,
  draft_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('detail', 'six-star-interval', 'pool-summary', 'batch-summary', 'potential-evidence')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'file', 'xhh')),
  "values" JSONB NOT NULL CHECK (jsonb_typeof("values") = 'object'),
  time_precision TEXT NOT NULL CHECK (time_precision IN ('second', 'day', 'range', 'unknown')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (user_id, draft_id, entry_id),
  CHECK (kind = 'potential-evidence' OR (pool_id IS NOT NULL AND length(btrim(pool_id)) > 0)),
  CHECK (NOT ("values" ?| ARRAY['seq', 'seqId', 'seq_id', 'record_id', 'user_id', 'history_id']))
);
CREATE INDEX account_data_workbench_scope_idx
  ON public.account_data_workbench_entries (user_id, game_uid, server_scope, id);

CREATE TABLE public.account_data_workbench_commits (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  commit_id UUID NOT NULL,
  draft_id UUID NOT NULL,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, commit_id)
);

CREATE TABLE public.account_data_workbench_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES public.account_data_workbench_entries(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
  old_values JSONB,
  new_values JSONB NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  commit_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX account_data_workbench_audit_owner_idx
  ON public.account_data_workbench_audit (user_id, entry_id, created_at);

ALTER TABLE public.account_data_workbench_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_data_workbench_commits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_data_workbench_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_data_workbench_entries, public.account_data_workbench_commits,
  public.account_data_workbench_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.account_data_workbench_entries, public.account_data_workbench_commits,
  public.account_data_workbench_audit TO authenticated, service_role;
CREATE POLICY account_data_workbench_entries_owner ON public.account_data_workbench_entries
  FOR SELECT TO authenticated USING (auth.uid() = user_id AND public.is_request_auth_session_allowed());
CREATE POLICY account_data_workbench_commits_owner ON public.account_data_workbench_commits
  FOR SELECT TO authenticated USING (auth.uid() = user_id AND public.is_request_auth_session_allowed());
CREATE POLICY account_data_workbench_audit_owner ON public.account_data_workbench_audit
  FOR SELECT TO authenticated USING (auth.uid() = user_id AND public.is_request_auth_session_allowed());

-- 返回同一数据库快照中的完整 scope。超过上限明确拒绝，不能截断后声称校验通过。
CREATE FUNCTION public.read_account_data_workbench_context(
  p_user_id UUID, p_game_uid TEXT, p_server_scope TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_history JSONB;
  v_entries JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service_role_required';
  END IF;
  IF p_user_id IS NULL OR NULLIF(btrim(p_game_uid), '') IS NULL OR NULLIF(btrim(p_server_scope), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'workbench_scope_required';
  END IF;
  -- 每行都补齐去重与抽取方式所需字段：汇总/间隔按 drawMethod 比较，
  -- 明细按 seq/record 身份去重，且不会暴露给浏览器（仅 service_role 可读）。
  SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.id), '[]'::JSONB) INTO v_history
  FROM (
    SELECT
      history_row.id,
      history_row.pool_id,
      history_row.character_id,
      history_row.rarity,
      history_row.timestamp,
      history_row.seq_id,
      history_row.record_id,
      COALESCE(NULLIF(btrim(history_row.game_uid), ''), 'legacy') AS game_uid,
      history_row.server_scope,
      history_row.user_id,
      history_row.is_free,
      history_row.is_info_book,
      history_row.special_type,
      history_row.updated_at
    FROM public.history AS history_row
    WHERE history_row.user_id = p_user_id
      AND COALESCE(NULLIF(btrim(history_row.game_uid), ''), 'legacy') = p_game_uid
      AND history_row.server_scope = p_server_scope
    ORDER BY history_row.id LIMIT 50001
  ) item;
  SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.id), '[]'::JSONB) INTO v_entries
  FROM (
    SELECT * FROM public.account_data_workbench_entries
    WHERE user_id = p_user_id AND game_uid = p_game_uid AND server_scope = p_server_scope
    ORDER BY id LIMIT 50001
  ) item;
  IF jsonb_array_length(v_history) > 50000 OR jsonb_array_length(v_entries) > 50000 THEN
    RAISE EXCEPTION USING ERRCODE = '54000', MESSAGE = 'workbench_scope_too_large';
  END IF;
  RETURN jsonb_build_object('history', v_history, 'entries', v_entries,
    'contextToken', md5(jsonb_build_array(v_history, v_entries)::TEXT));
END;
$$;

CREATE FUNCTION public.commit_account_data_workbench(
  p_user_id UUID, p_commit_id UUID, p_draft_id UUID, p_game_uid TEXT, p_server_scope TEXT,
  p_payload_hash TEXT, p_context_token TEXT, p_entries JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_prior public.account_data_workbench_commits%ROWTYPE;
  v_entry public.account_data_workbench_entries%ROWTYPE;
  v_item JSONB;
  v_ids JSONB := '[]'::JSONB;
  v_result JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service_role_required';
  END IF;
  IF p_user_id IS NULL OR p_commit_id IS NULL OR p_draft_id IS NULL
    OR p_payload_hash IS NULL OR p_payload_hash !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(p_entries) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'workbench_invalid_submission';
  END IF;
  IF jsonb_array_length(p_entries) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'workbench_invalid_batch';
  END IF;
  -- 所有相同 owner/commitId 的重试先串行化，再判断 payload；未成功的事务不留下提交记录。
  PERFORM pg_advisory_xact_lock(hashtextextended('workbench-commit:' || p_user_id::TEXT || ':' || p_commit_id::TEXT, 0));
  SELECT * INTO v_prior FROM public.account_data_workbench_commits
    WHERE user_id = p_user_id AND commit_id = p_commit_id;
  IF FOUND THEN
    IF v_prior.payload_hash IS DISTINCT FROM p_payload_hash THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'workbench_idempotency_conflict';
    END IF;
    RETURN v_prior.result;
  END IF;
  -- 官方导入不使用工作台作用域锁；共享表锁封住校验后、提交前的 history 写入窗口。
  -- 所有工作台写入均先锁 history 再锁作用域，避免锁顺序倒置。
  LOCK TABLE public.history IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(hashtextextended('workbench-scope:' || p_user_id::TEXT || ':' || p_game_uid || ':' || p_server_scope, 0));
  IF (public.read_account_data_workbench_context(p_user_id, p_game_uid, p_server_scope)->>'contextToken') IS DISTINCT FROM p_context_token THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'workbench_context_changed';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
    IF EXISTS (SELECT 1 FROM public.account_data_workbench_entries
      WHERE user_id = p_user_id AND draft_id = p_draft_id AND entry_id = (v_item->>'entryId')::UUID) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'workbench_entry_already_committed';
    END IF;
    INSERT INTO public.account_data_workbench_entries (
      user_id, game_uid, server_scope, pool_id, entry_id, draft_id, kind, source, "values", time_precision
    ) VALUES (
      p_user_id, p_game_uid, p_server_scope, NULLIF(v_item->>'poolId', ''), (v_item->>'entryId')::UUID,
      p_draft_id, v_item->>'kind', COALESCE(v_item->>'source', 'manual'), v_item->'values', v_item->>'timePrecision'
    ) ON CONFLICT (user_id, draft_id, entry_id) DO NOTHING
      RETURNING * INTO v_entry;
    -- 同一条目被另一作用域并发提交时，由唯一键决定胜者，整个失败批次回滚。
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'workbench_entry_already_committed';
    END IF;
    INSERT INTO public.account_data_workbench_audit (user_id, entry_id, actor_user_id, operation, new_values, commit_id)
      VALUES (p_user_id, v_entry.id, p_user_id, 'create', to_jsonb(v_entry), p_commit_id);
    v_ids := v_ids || jsonb_build_array(v_entry.id);
  END LOOP;
  v_result := jsonb_build_object('commitId', p_commit_id, 'saved', jsonb_array_length(v_ids), 'entryIds', v_ids);
  INSERT INTO public.account_data_workbench_commits(user_id, commit_id, draft_id, payload_hash, result)
    VALUES (p_user_id, p_commit_id, p_draft_id, p_payload_hash, v_result);
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.mutate_account_data_workbench_entry(
  p_user_id UUID, p_id UUID, p_expected_revision INTEGER, p_action TEXT,
  p_entry JSONB, p_context_token TEXT, p_reason TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_old public.account_data_workbench_entries%ROWTYPE;
  v_new public.account_data_workbench_entries%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service_role_required';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('update', 'delete') OR p_expected_revision IS NULL OR p_expected_revision < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'workbench_invalid_mutation';
  END IF;
  -- 先确定 scope，再以与 commit 相同的锁顺序串行化；锁内重新读取并检查 revision。
  SELECT * INTO v_old FROM public.account_data_workbench_entries
    WHERE id = p_id AND user_id = p_user_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'workbench_entry_not_found'; END IF;
  LOCK TABLE public.history IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(hashtextextended('workbench-scope:' || p_user_id::TEXT || ':' || v_old.game_uid || ':' || v_old.server_scope, 0));
  SELECT * INTO v_old FROM public.account_data_workbench_entries
    WHERE id = p_id AND user_id = p_user_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'workbench_entry_not_found'; END IF;
  IF v_old.revision <> p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'workbench_revision_conflict';
  END IF;
  IF p_action = 'update' THEN
    IF jsonb_typeof(p_entry) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'workbench_invalid_entry';
    END IF;
    IF (public.read_account_data_workbench_context(p_user_id, v_old.game_uid, v_old.server_scope)->>'contextToken') IS DISTINCT FROM p_context_token THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'workbench_context_changed';
    END IF;
    UPDATE public.account_data_workbench_entries SET
      kind = p_entry->>'kind', pool_id = NULLIF(p_entry->>'poolId', ''), "values" = p_entry->'values',
      time_precision = p_entry->>'timePrecision', revision = revision + 1, updated_at = now()
      WHERE id = p_id AND user_id = p_user_id AND revision = p_expected_revision
      RETURNING * INTO v_new;
  ELSE
    IF NULLIF(btrim(p_reason), '') IS NULL OR length(p_reason) > 500 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'workbench_delete_reason_required';
    END IF;
    UPDATE public.account_data_workbench_entries SET deleted_at = now(), updated_at = now(), revision = revision + 1
      WHERE id = p_id AND user_id = p_user_id AND revision = p_expected_revision
      RETURNING * INTO v_new;
  END IF;
  IF v_new.id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'workbench_revision_conflict'; END IF;
  INSERT INTO public.account_data_workbench_audit(user_id, entry_id, actor_user_id, operation, old_values, new_values, reason)
    VALUES (p_user_id, p_id, p_user_id, p_action, to_jsonb(v_old), to_jsonb(v_new), COALESCE(p_reason, ''));
  RETURN to_jsonb(v_new);
END;
$$;

REVOKE ALL ON FUNCTION public.read_account_data_workbench_context(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_account_data_workbench(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mutate_account_data_workbench_entry(UUID, UUID, INTEGER, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_account_data_workbench_context(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_account_data_workbench(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.mutate_account_data_workbench_entry(UUID, UUID, INTEGER, TEXT, JSONB, TEXT, TEXT) TO service_role;

-- Supplement changes do not touch history, so its existing queue triggers cannot
-- invalidate these snapshots. Mark revisions in the same transaction as the write.
CREATE FUNCTION public.invalidate_workbench_personal_analysis()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_row public.account_data_workbench_entries%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
  -- Profile deletion cascades must not recreate a queue row for a removed owner.
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_row.user_id) THEN RETURN NULL; END IF;
  INSERT INTO public.personal_analysis_owner_state (
    user_id, history_revision, snapshot_revision, dirty_since, analysis_schema_version, last_error
  ) VALUES (v_row.user_id, 1, -1, statement_timestamp(), 2, NULL)
  ON CONFLICT (user_id) DO UPDATE SET
    history_revision = public.personal_analysis_owner_state.history_revision + 1,
    dirty_since = COALESCE(public.personal_analysis_owner_state.dirty_since, EXCLUDED.dirty_since),
    last_error = NULL;
  INSERT INTO public.personal_analysis_scope_state (
    user_id, scope_game_uid, server_scope, history_revision, snapshot_revision,
    dirty_since, analysis_schema_version, last_error
  ) VALUES (
    v_row.user_id, public.normalize_personal_analysis_game_uid(v_row.user_id, v_row.game_uid),
    v_row.server_scope, 1, -1, statement_timestamp(), 2, NULL
  ) ON CONFLICT (user_id, scope_game_uid, server_scope) DO UPDATE SET
    history_revision = public.personal_analysis_scope_state.history_revision + 1,
    dirty_since = COALESCE(public.personal_analysis_scope_state.dirty_since, EXCLUDED.dirty_since),
    last_error = NULL;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.invalidate_workbench_personal_analysis() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER invalidate_workbench_personal_analysis
AFTER INSERT OR UPDATE OR DELETE ON public.account_data_workbench_entries
FOR EACH ROW EXECUTE FUNCTION public.invalidate_workbench_personal_analysis();

COMMIT;
