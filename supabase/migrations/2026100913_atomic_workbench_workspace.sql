-- Verified pool workspace: one validation credential, one all-or-nothing transaction.
BEGIN;

ALTER TABLE public.account_data_workbench_entries DROP CONSTRAINT account_data_workbench_entries_kind_check;
ALTER TABLE public.account_data_workbench_entries ADD CONSTRAINT account_data_workbench_entries_kind_check
  CHECK (kind IN ('detail', 'six-star-interval', 'pool-summary', 'batch-summary', 'potential-evidence', 'pool-ledger'));
ALTER TABLE public.account_data_workbench_entries ADD COLUMN derivation TEXT
  CHECK (derivation IN ('declared', 'inferred'));
ALTER TABLE public.account_data_workbench_commits ADD COLUMN validation_token UUID;

CREATE TABLE public.account_data_workbench_validations (
  token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  draft_id UUID NOT NULL,
  commit_id UUID NOT NULL,
  draft_revision BIGINT NOT NULL CHECK (draft_revision >= 1),
  game_uid TEXT NOT NULL,
  server_scope TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  request JSONB NOT NULL,
  operations JSONB NOT NULL,
  context_token TEXT NOT NULL,
  catalog_token TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  consumed_at TIMESTAMPTZ
);
CREATE INDEX account_data_workbench_validations_expiry_idx ON public.account_data_workbench_validations(expires_at);
ALTER TABLE public.account_data_workbench_validations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_data_workbench_validations FROM PUBLIC, anon, authenticated, service_role;
-- Credentials and their trusted operations are accessible exclusively through the RPCs below.

CREATE OR REPLACE FUNCTION public.read_account_data_workbench_context(
  p_user_id UUID, p_game_uid TEXT, p_server_scope TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE v_history JSONB; v_entries JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service_role_required';
  END IF;
  IF p_user_id IS NULL OR NULLIF(btrim(p_game_uid), '') IS NULL OR NULLIF(btrim(p_server_scope), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'workbench_scope_required';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.id), '[]'::JSONB) INTO v_history FROM (
    SELECT h.id, h.pool_id, h.character_id, h.character_name, h.item_name, h.rarity,
      h.timestamp, h.seq_id, h.record_id,
      COALESCE(NULLIF(btrim(h.game_uid), ''), 'legacy') AS game_uid,
      h.server_scope, h.server_id, h.user_id, h.is_free, h.is_info_book, h.is_standard,
      h.special_type, h.edit_version, h.pity, h.batch_id, h.updated_at
    FROM public.history h WHERE h.user_id = p_user_id
      AND COALESCE(NULLIF(btrim(h.game_uid), ''), 'legacy') = p_game_uid
      AND h.server_scope = p_server_scope ORDER BY h.id LIMIT 50001
  ) item;
  SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.id), '[]'::JSONB) INTO v_entries FROM (
    SELECT * FROM public.account_data_workbench_entries WHERE user_id = p_user_id
      AND game_uid = p_game_uid AND server_scope = p_server_scope ORDER BY id LIMIT 50001
  ) item;
  IF jsonb_array_length(v_history) > 50000 OR jsonb_array_length(v_entries) > 50000 THEN
    RAISE EXCEPTION USING ERRCODE = '54000', MESSAGE = 'workbench_scope_too_large';
  END IF;
  RETURN jsonb_build_object('history', v_history, 'entries', v_entries,
    'contextToken', md5(jsonb_build_array(v_history, v_entries)::TEXT));
END;
$$;

-- One MVCC snapshot supplies every field the API uses for membership/numeric/rule checks.
CREATE FUNCTION public.read_account_data_workbench_catalog() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_catalog JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service_role_required';
  END IF;
  SELECT jsonb_build_object(
    'pools', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.pool_id) FROM public.get_app_visible_pools() p), '[]'::JSONB),
    'entities', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM (
      SELECT id, name, type, rarity, is_limited, release_date, pool_config FROM public.characters ORDER BY id LIMIT 50001
    ) c), '[]'::JSONB),
    'roster', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.pool_id, r.character_id) FROM (
      SELECT pool_id, character_id, is_up FROM public.pool_characters ORDER BY pool_id, character_id LIMIT 50001
    ) r), '[]'::JSONB)
  ) INTO v_catalog;
  IF jsonb_array_length(v_catalog->'entities') > 50000 OR jsonb_array_length(v_catalog->'roster') > 50000
    OR jsonb_array_length(v_catalog->'pools') > 50000 THEN
    RAISE EXCEPTION USING ERRCODE = '54000', MESSAGE = 'workbench_catalog_too_large';
  END IF;
  RETURN v_catalog || jsonb_build_object('catalogToken', md5(v_catalog::TEXT));
END;
$$;

CREATE FUNCTION public.validate_account_data_workbench_workspace(
  p_user_id UUID, p_payload_hash TEXT, p_request JSONB, p_operations JSONB,
  p_context_token TEXT, p_catalog_token TEXT, p_rules_version TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
SET lock_timeout = '5s' SET statement_timeout = '50s' AS $$
DECLARE v_token public.account_data_workbench_validations%ROWTYPE; v_count INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service_role_required';
  END IF;
  IF p_user_id IS NULL OR p_payload_hash IS NULL OR p_payload_hash !~ '^[0-9a-f]{64}$'
    OR p_request->>'mode' IS DISTINCT FROM 'pool-workspace'
    OR jsonb_typeof(p_request->'entries') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_request->'historyChanges') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_request->'supplementChanges') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_operations->'entries') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_operations->'historyChanges') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_operations->'supplementChanges') IS DISTINCT FROM 'array'
    OR (p_request->>'draftRevision')::BIGINT < 1
    OR NULLIF(p_request->'scope'->>'gameUid', '') IS NULL
    OR NULLIF(p_request->'scope'->>'serverScope', '') IS NULL
    OR p_operations->'scope' IS DISTINCT FROM p_request->'scope'
    OR p_operations->>'draftId' IS DISTINCT FROM p_request->>'draftId'
    OR p_operations->>'commitId' IS DISTINCT FROM p_request->>'commitId'
    OR p_operations->>'draftRevision' IS DISTINCT FROM p_request->>'draftRevision' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'workbench_invalid_submission';
  END IF;
  v_count := jsonb_array_length(p_request->'entries') + jsonb_array_length(p_request->'historyChanges') + jsonb_array_length(p_request->'supplementChanges');
  IF v_count NOT BETWEEN 1 AND 100
    OR jsonb_array_length(p_request->'entries') <> jsonb_array_length(p_operations->'entries')
    OR jsonb_array_length(p_request->'historyChanges') <> jsonb_array_length(p_operations->'historyChanges')
    OR jsonb_array_length(p_request->'supplementChanges') <> jsonb_array_length(p_operations->'supplementChanges') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'workbench_invalid_batch';
  END IF;
  IF p_rules_version IS DISTINCT FROM 'pool-workspace-1' THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'workbench_rules_changed';
  END IF;
  -- Lock order matches commit; nobody can mutate the validated context/catalog mid-comparison.
  LOCK TABLE public.profiles, public.pools, public.characters, public.pool_characters IN SHARE MODE;
  LOCK TABLE public.history IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(hashtextextended('workbench-scope:' || p_user_id::TEXT || ':' || (p_request->'scope'->>'gameUid') || ':' || (p_request->'scope'->>'serverScope'), 0));
  IF (public.read_account_data_workbench_context(p_user_id, p_request->'scope'->>'gameUid', p_request->'scope'->>'serverScope')->>'contextToken') IS DISTINCT FROM p_context_token THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'workbench_context_changed';
  END IF;
  IF (public.read_account_data_workbench_catalog()->>'catalogToken') IS DISTINCT FROM p_catalog_token THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'workbench_catalog_changed';
  END IF;
  INSERT INTO public.account_data_workbench_validations(user_id, draft_id, commit_id, draft_revision,
    game_uid, server_scope, payload_hash, request, operations, context_token, catalog_token, rules_version)
  VALUES(p_user_id, (p_request->>'draftId')::UUID, (p_request->>'commitId')::UUID,
    (p_request->>'draftRevision')::BIGINT, p_request->'scope'->>'gameUid', p_request->'scope'->>'serverScope',
    p_payload_hash, p_request, p_operations, p_context_token, p_catalog_token, p_rules_version) RETURNING * INTO v_token;
  RETURN jsonb_build_object('validationToken', v_token.token, 'draftRevision', v_token.draft_revision, 'expiresAt', v_token.expires_at);
END;
$$;

CREATE FUNCTION public.commit_account_data_workbench_workspace(
  p_user_id UUID, p_validation_token UUID, p_payload_hash TEXT, p_request JSONB, p_rules_version TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
SET lock_timeout = '5s' SET statement_timeout = '50s' AS $$
DECLARE
  v_token public.account_data_workbench_validations%ROWTYPE;
  v_prior public.account_data_workbench_commits%ROWTYPE;
  v_old public.account_data_workbench_entries%ROWTYPE;
  v_new public.account_data_workbench_entries%ROWTYPE;
  v_item JSONB; v_mutation JSONB; v_result JSONB; v_entry JSONB;
  v_ids JSONB := '[]'::JSONB;
  v_history_updated INTEGER := 0; v_supplements_updated INTEGER := 0; v_supplements_deleted INTEGER := 0;
  v_commit_id UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service_role_required';
  END IF;
  IF p_user_id IS NULL OR p_validation_token IS NULL OR p_payload_hash IS NULL OR p_request IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'workbench_validation_required';
  END IF;
  v_commit_id := (p_request->>'commitId')::UUID;
  PERFORM pg_advisory_xact_lock(hashtextextended('workbench-commit:' || p_user_id::TEXT || ':' || v_commit_id::TEXT, 0));
  SELECT * INTO v_prior FROM public.account_data_workbench_commits WHERE user_id = p_user_id AND commit_id = v_commit_id;
  IF FOUND THEN
    IF v_prior.payload_hash IS DISTINCT FROM p_payload_hash THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'workbench_idempotency_conflict';
    END IF;
    IF v_prior.validation_token IS DISTINCT FROM p_validation_token THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'workbench_validation_mismatch';
    END IF;
    SELECT * INTO v_token FROM public.account_data_workbench_validations WHERE token = p_validation_token AND user_id = p_user_id;
    IF NOT FOUND OR v_token.request IS DISTINCT FROM p_request THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'workbench_validation_mismatch';
    END IF;
    RETURN v_prior.result; -- Successful exact retries remain valid even after the credential expires.
  END IF;
  SELECT * INTO v_token FROM public.account_data_workbench_validations WHERE token = p_validation_token AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'workbench_validation_required'; END IF;
  IF v_token.payload_hash IS DISTINCT FROM p_payload_hash OR v_token.request IS DISTINCT FROM p_request
    OR v_token.commit_id IS DISTINCT FROM v_commit_id
    OR v_token.draft_id IS DISTINCT FROM (p_request->>'draftId')::UUID
    OR v_token.draft_revision IS DISTINCT FROM (p_request->>'draftRevision')::BIGINT THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'workbench_validation_mismatch';
  END IF;
  IF v_token.rules_version IS DISTINCT FROM p_rules_version OR p_rules_version IS DISTINCT FROM 'pool-workspace-1' THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'workbench_rules_changed';
  END IF;
  IF v_token.expires_at <= clock_timestamp() OR v_token.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'workbench_validation_expired';
  END IF;
  LOCK TABLE public.profiles, public.pools, public.characters, public.pool_characters IN SHARE MODE;
  -- SHARE ROW EXCLUSIVE serializes workbench history writers and blocks official import;
  -- SHARE would allow two transactions to deadlock when both subsequently UPDATE history.
  LOCK TABLE public.history IN SHARE ROW EXCLUSIVE MODE;
  PERFORM pg_advisory_xact_lock(hashtextextended('workbench-scope:' || p_user_id::TEXT || ':' || v_token.game_uid || ':' || v_token.server_scope, 0));
  IF (public.read_account_data_workbench_context(p_user_id, v_token.game_uid, v_token.server_scope)->>'contextToken') IS DISTINCT FROM v_token.context_token THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'workbench_context_changed';
  END IF;
  IF (public.read_account_data_workbench_catalog()->>'catalogToken') IS DISTINCT FROM v_token.catalog_token THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'workbench_catalog_changed';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_token.operations->'historyChanges') LOOP
    IF v_item->>'gameUid' IS DISTINCT FROM v_token.game_uid OR v_item->>'serverScope' IS DISTINCT FROM v_token.server_scope THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'workbench_scope_mismatch';
    END IF;
    v_mutation := public.update_history_record_controlled(p_user_id, v_item->>'recordId', v_token.game_uid,
      v_token.server_scope, v_item->>'currentPoolId', v_item->>'seqId', (v_item->>'expectedEditVersion')::BIGINT,
      v_item->'changes', v_item->>'reason');
    v_history_updated := v_history_updated + (v_mutation->>'updated')::INTEGER;
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_token.operations->'supplementChanges') LOOP
    SELECT * INTO v_old FROM public.account_data_workbench_entries
      WHERE id = (v_item->>'id')::UUID AND user_id = p_user_id
        AND game_uid = v_token.game_uid AND server_scope = v_token.server_scope AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'workbench_entry_not_found'; END IF;
    IF v_old.revision IS DISTINCT FROM (v_item->>'expectedRevision')::INTEGER THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'workbench_revision_conflict';
    END IF;
    IF v_item->>'action' = 'update' THEN
      v_entry := v_item->'entry';
      IF (v_entry->>'entryId')::UUID IS DISTINCT FROM v_old.entry_id THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'workbench_entry_identity_changed';
      END IF;
      UPDATE public.account_data_workbench_entries SET kind = v_entry->>'kind', pool_id = v_entry->>'poolId',
        "values" = v_entry->'values', time_precision = v_entry->>'timePrecision',
        revision = revision + 1, updated_at = now() WHERE id = v_old.id AND revision = v_old.revision RETURNING * INTO v_new;
      v_supplements_updated := v_supplements_updated + 1;
    ELSIF v_item->>'action' = 'delete' THEN
      IF NULLIF(btrim(v_item->>'reason'), '') IS NULL OR length(v_item->>'reason') > 500 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'workbench_delete_reason_required';
      END IF;
      UPDATE public.account_data_workbench_entries SET deleted_at = now(), updated_at = now(), revision = revision + 1
        WHERE id = v_old.id AND revision = v_old.revision RETURNING * INTO v_new;
      v_supplements_deleted := v_supplements_deleted + 1;
    ELSE RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'workbench_invalid_mutation'; END IF;
    IF v_new.id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'workbench_revision_conflict'; END IF;
    INSERT INTO public.account_data_workbench_audit(user_id, entry_id, actor_user_id, operation, old_values, new_values, reason, commit_id)
      VALUES(p_user_id, v_old.id, p_user_id, v_item->>'action', to_jsonb(v_old), to_jsonb(v_new), COALESCE(v_item->>'reason', ''), v_commit_id);
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_token.operations->'entries') LOOP
    INSERT INTO public.account_data_workbench_entries(user_id, game_uid, server_scope, pool_id, entry_id, draft_id,
      kind, source, derivation, "values", time_precision)
    VALUES(p_user_id, v_token.game_uid, v_token.server_scope, v_item->>'poolId', (v_item->>'entryId')::UUID,
      v_token.draft_id, v_item->>'kind', COALESCE(v_item->>'source', 'manual'), v_item->>'derivation', v_item->'values', v_item->>'timePrecision')
    RETURNING * INTO v_new;
    INSERT INTO public.account_data_workbench_audit(user_id, entry_id, actor_user_id, operation, new_values, commit_id)
      VALUES(p_user_id, v_new.id, p_user_id, 'create', to_jsonb(v_new), v_commit_id);
    v_ids := v_ids || jsonb_build_array(v_new.id);
  END LOOP;
  v_result := jsonb_build_object('commitId', v_commit_id, 'draftRevision', v_token.draft_revision,
    'saved', jsonb_array_length(v_ids), 'entryIds', v_ids, 'historyUpdated', v_history_updated,
    'supplementsUpdated', v_supplements_updated, 'supplementsDeleted', v_supplements_deleted,
    'operationCount', jsonb_array_length(v_token.operations->'entries') + jsonb_array_length(v_token.operations->'historyChanges') + jsonb_array_length(v_token.operations->'supplementChanges'));
  INSERT INTO public.account_data_workbench_commits(user_id, commit_id, draft_id, payload_hash, validation_token, result)
    VALUES(p_user_id, v_commit_id, v_token.draft_id, p_payload_hash, p_validation_token, v_result);
  UPDATE public.account_data_workbench_validations SET consumed_at = clock_timestamp() WHERE token = p_validation_token;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.read_account_data_workbench_catalog() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_account_data_workbench_workspace(UUID, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_account_data_workbench_workspace(UUID, UUID, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_account_data_workbench_catalog() TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_account_data_workbench_workspace(UUID, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_account_data_workbench_workspace(UUID, UUID, TEXT, JSONB, TEXT) TO service_role;
COMMIT;
