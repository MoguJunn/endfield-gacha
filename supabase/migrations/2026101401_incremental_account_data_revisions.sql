-- One current dataset; five reversible transactions within 180 days, stored as JSON field deltas.
BEGIN;

CREATE TABLE public.account_data_revisions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  transaction_id BIGINT NOT NULL,
  parent_id BIGINT,
  kind TEXT NOT NULL DEFAULT 'change' CHECK (kind IN ('change', 'revert')),
  target_id BIGINT,
  request_id UUID,
  preview_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  operation_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, transaction_id),
  UNIQUE(user_id, request_id)
);
CREATE INDEX account_data_revisions_owner_idx ON public.account_data_revisions(user_id, id DESC);
CREATE INDEX account_data_revisions_expiry_idx ON public.account_data_revisions(created_at);
CREATE INDEX IF NOT EXISTS account_revision_history_row_idx ON public.history(user_id, id);
CREATE TABLE public.account_data_revision_deltas (
  revision_id BIGINT NOT NULL REFERENCES public.account_data_revisions(id) ON DELETE CASCADE,
  ordinal BIGSERIAL NOT NULL,
  entity TEXT NOT NULL CHECK (entity IN ('history', 'supplement')),
  row_key TEXT NOT NULL,
  game_uid TEXT NOT NULL,
  server_scope TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
  row_version BIGINT NOT NULL,
  delta JSONB NOT NULL,
  PRIMARY KEY(revision_id, ordinal)
);
ALTER TABLE public.account_data_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_data_revision_deltas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_data_revisions, public.account_data_revision_deltas FROM PUBLIC, anon, authenticated, service_role;

-- Remove only derived/version fields. Their values are regenerated after a revert.
CREATE FUNCTION public.account_revision_content(p_entity TEXT, p_row JSONB) RETURNS JSONB
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN p_entity = 'history' THEN p_row - ARRAY['edit_version','updated_at','pity','batch_id']
    ELSE p_row - ARRAY['revision','updated_at'] END;
$$;

-- Compare object fields and array elements; a single acquisition edit does not copy the whole ledger.
CREATE FUNCTION public.account_revision_diff(p_before JSONB, p_after JSONB, p_path TEXT[] DEFAULT ARRAY[]::TEXT[])
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE v_key TEXT; v_index INTEGER; v_length INTEGER; v_result JSONB := '[]';
BEGIN
  IF p_before IS NOT DISTINCT FROM p_after THEN RETURN v_result; END IF;
  IF jsonb_typeof(p_before) = 'object' AND jsonb_typeof(p_after) = 'object' THEN
    FOR v_key IN SELECT key FROM jsonb_object_keys(p_before || p_after) key ORDER BY key LOOP
      v_result := v_result || public.account_revision_diff(p_before->v_key, p_after->v_key, p_path || v_key);
    END LOOP;
    RETURN v_result;
  END IF;
  IF jsonb_typeof(p_before) = 'array' AND jsonb_typeof(p_after) = 'array' THEN
    v_length := GREATEST(jsonb_array_length(p_before), jsonb_array_length(p_after));
    IF v_length = 0 THEN RETURN v_result; END IF;
    -- Undo appended values from the tail, undo removed values in ascending order.
    FOR v_index IN SELECT n FROM generate_series(0, v_length - 1) n
      ORDER BY CASE WHEN jsonb_array_length(p_after) > jsonb_array_length(p_before) THEN -n ELSE n END LOOP
      v_result := v_result || public.account_revision_diff(p_before->v_index, p_after->v_index, p_path || v_index::TEXT);
    END LOOP;
    RETURN v_result;
  END IF;
  RETURN jsonb_build_array(jsonb_build_object('path', to_jsonb(p_path),
    'beforeExists', p_before IS NOT NULL, 'before', p_before,
    'afterExists', p_after IS NOT NULL, 'after', p_after));
END;
$$;

CREATE FUNCTION public.account_revision_inverse(p_row JSONB, p_delta JSONB) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE v_patch JSONB; v_path TEXT[]; v_exists BOOLEAN; v_expected JSONB;
BEGIN
  FOR v_patch IN SELECT value FROM jsonb_array_elements(p_delta) LOOP
    SELECT COALESCE(array_agg(value), ARRAY[]::TEXT[]) INTO v_path FROM jsonb_array_elements_text(v_patch->'path');
    v_exists := (v_patch->>'afterExists')::BOOLEAN;
    v_expected := v_patch->'after';
    IF (p_row #> v_path) IS NOT DISTINCT FROM NULL AND v_exists
      OR (p_row #> v_path) IS DISTINCT FROM NULL AND NOT v_exists
      OR v_exists AND (p_row #> v_path) IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'account_revision_conflict';
    END IF;
    IF cardinality(v_path) = 0 THEN
      p_row := CASE WHEN (v_patch->>'beforeExists')::BOOLEAN THEN v_patch->'before' ELSE NULL END;
    ELSIF (v_patch->>'beforeExists')::BOOLEAN THEN
      p_row := jsonb_set(p_row, v_path, v_patch->'before', true);
    ELSE
      p_row := p_row #- v_path;
    END IF;
  END LOOP;
  RETURN p_row;
END;
$$;

CREATE FUNCTION public.capture_account_data_revision() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_before JSONB; v_after JSONB; v_row JSONB; v_entity TEXT; v_delta JSONB;
  v_owner UUID; v_id BIGINT; v_parent BIGINT; v_created BOOLEAN := false;
BEGIN
  v_entity := CASE WHEN TG_TABLE_NAME = 'history' THEN 'history' ELSE 'supplement' END;
  v_before := CASE WHEN TG_OP <> 'INSERT' THEN public.account_revision_content(v_entity, to_jsonb(OLD)) END;
  v_after := CASE WHEN TG_OP <> 'DELETE' THEN public.account_revision_content(v_entity, to_jsonb(NEW)) END;
  v_delta := public.account_revision_diff(v_before, v_after);
  IF v_delta = '[]'::JSONB THEN RETURN NULL; END IF;
  v_row := COALESCE(v_after, v_before); v_owner := (v_row->>'user_id')::UUID;
  -- Cascade removal of an owner must never recreate a revision for that deleted owner.
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_owner) THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-revisions:' || v_owner::TEXT, 0));
  SELECT id INTO v_id FROM public.account_data_revisions WHERE user_id = v_owner AND transaction_id = txid_current();
  IF NOT FOUND THEN
    SELECT id INTO v_parent FROM public.account_data_revisions WHERE user_id = v_owner ORDER BY id DESC LIMIT 1;
    INSERT INTO public.account_data_revisions(user_id, transaction_id, parent_id, kind, target_id, request_id, preview_token)
      VALUES(v_owner, txid_current(), v_parent,
        CASE WHEN NULLIF(current_setting('app.account_revert_target', true), '') IS NULL THEN 'change' ELSE 'revert' END,
        NULLIF(current_setting('app.account_revert_target', true), '')::BIGINT,
        NULLIF(current_setting('app.account_revert_request', true), '')::UUID,
        NULLIF(current_setting('app.account_revert_token', true), '')) RETURNING id INTO v_id;
    v_created := true;
  END IF;
  INSERT INTO public.account_data_revision_deltas(revision_id, entity, row_key, game_uid, server_scope, operation, row_version, delta)
    VALUES(v_id, v_entity, v_row->>'id',
      COALESCE(NULLIF(btrim(v_row->>'game_uid'), ''), 'legacy'), COALESCE(v_row->>'server_scope', 'legacy'), lower(TG_OP),
      GREATEST(COALESCE((to_jsonb(OLD)->>'edit_version')::BIGINT, (to_jsonb(OLD)->>'revision')::BIGINT, 1),
        COALESCE((to_jsonb(NEW)->>'edit_version')::BIGINT, (to_jsonb(NEW)->>'revision')::BIGINT, 1)), v_delta);
  UPDATE public.account_data_revisions SET operation_count = operation_count + 1 WHERE id = v_id;
  IF v_created THEN
    -- Indexed owner scan; at most five transactions retain payloads. Old metadata is also bounded.
    DELETE FROM public.account_data_revision_deltas d USING public.account_data_revisions r
      WHERE d.revision_id = r.id AND r.user_id = v_owner AND
      (r.created_at < clock_timestamp() - interval '180 days' OR r.id NOT IN
        (SELECT id FROM public.account_data_revisions WHERE user_id = v_owner ORDER BY id DESC LIMIT 5));
    DELETE FROM public.account_data_revisions WHERE user_id = v_owner AND created_at < clock_timestamp() - interval '180 days';
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER zz_capture_history_revision AFTER INSERT OR UPDATE OR DELETE ON public.history
  FOR EACH ROW EXECUTE FUNCTION public.capture_account_data_revision();
CREATE TRIGGER zz_capture_supplement_revision AFTER INSERT OR UPDATE OR DELETE ON public.account_data_workbench_entries
  FOR EACH ROW EXECUTE FUNCTION public.capture_account_data_revision();

-- The new journal already records these writes. Keep legacy audit reads without writing a second payload copy.
CREATE FUNCTION public.skip_duplicate_account_audit() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.account_data_revisions WHERE user_id = NEW.user_id AND transaction_id = txid_current()) THEN RETURN NULL; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER skip_duplicate_workbench_audit BEFORE INSERT ON public.account_data_workbench_audit
  FOR EACH ROW EXECUTE FUNCTION public.skip_duplicate_account_audit();
CREATE TRIGGER skip_duplicate_history_audit BEFORE INSERT ON public.history_change_log
  FOR EACH ROW EXECUTE FUNCTION public.skip_duplicate_account_audit();

CREATE FUNCTION public.list_account_data_revisions(p_user_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_items JSONB; v_head TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service_role_required'; END IF;
  SELECT r.id::TEXT INTO v_head FROM public.account_data_revisions r WHERE r.user_id = p_user_id ORDER BY r.id DESC LIMIT 1;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id::TEXT, 'parentId', r.parent_id::TEXT, 'kind', r.kind,
    'createdAt', r.created_at, 'expiresAt', r.created_at + interval '180 days', 'operationCount', r.operation_count,
    'revertible', r.created_at >= clock_timestamp() - interval '180 days' AND EXISTS
      (SELECT 1 FROM public.account_data_revision_deltas WHERE revision_id = r.id),
    'scopes', COALESCE((SELECT jsonb_agg(s) FROM (SELECT DISTINCT game_uid AS "gameUid", server_scope AS "serverScope"
      FROM public.account_data_revision_deltas WHERE revision_id = r.id) s), '[]'::JSONB)) ORDER BY r.id DESC), '[]'::JSONB)
    INTO v_items FROM (SELECT * FROM public.account_data_revisions WHERE user_id = p_user_id ORDER BY id DESC LIMIT 5) r;
  RETURN jsonb_build_object('headId', v_head, 'versions', v_items, 'limit', 5, 'retentionDays', 180);
END;
$$;

-- A transient plan holds only touched rows; it is never persisted in the database or returned to the browser.
CREATE FUNCTION public.plan_account_data_revert(p_user_id UUID, p_target_id BIGINT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_target public.account_data_revisions%ROWTYPE; v_head BIGINT; v_ids BIGINT[]; v_item RECORD;
  v_rows JSONB := '{}'; v_initial JSONB := '{}'; v_versions JSONB := '{}'; v_key TEXT; v_row JSONB; v_current JSONB;
  v_scope JSONB; v_summaries JSONB := '[]'; v_result JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service_role_required'; END IF;
  SELECT * INTO v_target FROM public.account_data_revisions WHERE id = p_target_id AND user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'account_revision_not_found'; END IF;
  SELECT array_agg(id ORDER BY id DESC), max(id) INTO v_ids, v_head FROM
    (SELECT id FROM public.account_data_revisions WHERE user_id = p_user_id ORDER BY id DESC LIMIT 5) latest;
  IF NOT p_target_id = ANY(v_ids) OR v_target.created_at < clock_timestamp() - interval '180 days'
    OR EXISTS(SELECT 1 FROM public.account_data_revisions r WHERE user_id = p_user_id AND id >= p_target_id
      AND NOT EXISTS(SELECT 1 FROM public.account_data_revision_deltas d WHERE d.revision_id = r.id)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'account_revision_expired';
  END IF;
  FOR v_item IN SELECT d.* FROM public.account_data_revision_deltas d JOIN public.account_data_revisions r ON r.id = d.revision_id
    WHERE r.user_id = p_user_id AND r.id >= p_target_id ORDER BY r.id DESC, d.ordinal DESC LOOP
    v_key := v_item.entity || ':' || v_item.row_key;
    IF NOT v_initial ? v_key THEN
      IF v_item.entity = 'history' THEN SELECT public.account_revision_content('history', to_jsonb(h)) INTO v_current
        FROM public.history h WHERE h.user_id = p_user_id AND h.id = v_item.row_key::BIGINT;
      ELSE SELECT public.account_revision_content('supplement', to_jsonb(e)) INTO v_current
        FROM public.account_data_workbench_entries e WHERE e.user_id = p_user_id AND e.id = v_item.row_key::UUID;
      END IF;
      v_initial := v_initial || jsonb_build_object(v_key, v_current);
      v_rows := v_rows || jsonb_build_object(v_key, v_current);
    END IF;
    v_versions := v_versions || jsonb_build_object(v_key, GREATEST(COALESCE((v_versions->>v_key)::BIGINT, 0), v_item.row_version));
    v_row := NULLIF(v_rows->v_key, 'null'::JSONB);
    v_row := public.account_revision_inverse(v_row, v_item.delta);
    v_rows := v_rows || jsonb_build_object(v_key, v_row);
  END LOOP;
  FOR v_key, v_row IN SELECT key, value FROM jsonb_each(v_rows) LOOP
    v_current := NULLIF(v_initial->v_key, 'null'::JSONB); v_row := NULLIF(v_row, 'null'::JSONB);
    IF v_current IS NOT DISTINCT FROM v_row THEN CONTINUE; END IF;
    v_scope := COALESCE(v_current, v_row);
    v_summaries := v_summaries || jsonb_build_array(jsonb_build_object('entity', split_part(v_key, ':', 1),
      'operation', CASE WHEN v_row IS NULL THEN 'delete' WHEN v_current IS NULL THEN 'restore' ELSE 'update' END,
      'gameUid', v_scope->>'game_uid', 'serverScope', v_scope->>'server_scope',
      'poolId', v_scope->>'pool_id', 'restoredPoolId', v_row->>'pool_id'));
  END LOOP;
  v_result := jsonb_build_object('headId', v_head::TEXT, 'targetId', p_target_id::TEXT,
    'revisionCount', (SELECT count(*) FROM public.account_data_revisions WHERE user_id = p_user_id AND id >= p_target_id),
    'changes', v_summaries, 'rows', v_rows, 'initial', v_initial, 'rowVersions', v_versions);
  RETURN v_result || jsonb_build_object('token', md5(v_result::TEXT));
END;
$$;

CREATE FUNCTION public.preview_account_data_revert(p_user_id UUID, p_target_id BIGINT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN RETURN public.plan_account_data_revert(p_user_id, p_target_id) - ARRAY['rows', 'initial', 'rowVersions']; END;
$$;

CREATE FUNCTION public.revert_account_data_revision(p_user_id UUID, p_target_id BIGINT, p_token TEXT, p_request_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
SET lock_timeout = '5s' SET statement_timeout = '50s' AS $$
DECLARE v_plan JSONB; v_prior public.account_data_revisions%ROWTYPE; v_key TEXT; v_row JSONB; v_current JSONB;
  v_history public.history%ROWTYPE; v_entry public.account_data_workbench_entries%ROWTYPE;
  v_new_id BIGINT; v_scope RECORD; v_count INTEGER := 0; v_columns TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service_role_required'; END IF;
  IF p_request_id IS NULL OR p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'account_revision_preview_required'; END IF;
  -- Same table order as controlled workspace writes; retry and context checks share the write transaction.
  LOCK TABLE public.history IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.account_data_workbench_entries IN SHARE ROW EXCLUSIVE MODE;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-revisions:' || p_user_id::TEXT, 0));
  SELECT * INTO v_prior FROM public.account_data_revisions WHERE user_id = p_user_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_prior.target_id IS DISTINCT FROM p_target_id OR v_prior.preview_token IS DISTINCT FROM p_token THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'account_revision_request_conflict'; END IF;
    RETURN jsonb_build_object('revisionId', v_prior.id::TEXT, 'targetId', p_target_id::TEXT, 'changed', v_prior.operation_count, 'replayed', true);
  END IF;
  v_plan := public.plan_account_data_revert(p_user_id, p_target_id);
  IF v_plan->>'token' IS DISTINCT FROM p_token THEN RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'account_revision_context_changed'; END IF;
  IF jsonb_array_length(v_plan->'changes') = 0 THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'account_revision_no_changes'; END IF;
  PERFORM set_config('app.account_revert_target', p_target_id::TEXT, true);
  PERFORM set_config('app.account_revert_request', p_request_id::TEXT, true);
  PERFORM set_config('app.account_revert_token', p_token, true);
  FOR v_key, v_row IN SELECT key, value FROM jsonb_each(v_plan->'rows') LOOP
    v_current := NULLIF(v_plan->'initial'->v_key, 'null'::JSONB); v_row := NULLIF(v_row, 'null'::JSONB);
    IF v_current IS NOT DISTINCT FROM v_row THEN CONTINUE; END IF;
    IF split_part(v_key, ':', 1) = 'history' THEN
      IF v_row IS NULL THEN DELETE FROM public.history WHERE user_id = p_user_id AND id = (v_current->>'id')::BIGINT;
      ELSE
        v_history := jsonb_populate_record(NULL::public.history, v_row);
        IF v_current IS NULL THEN
          v_history.edit_version := (v_plan->'rowVersions'->>v_key)::BIGINT + 1; v_history.updated_at := clock_timestamp(); v_history.pity := 0;
          INSERT INTO public.history SELECT v_history.*;
        ELSE
          SELECT string_agg(quote_ident(attname), ',' ORDER BY attnum) INTO v_columns FROM pg_attribute
            WHERE attrelid = 'public.history'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = ''
              AND attname NOT IN ('id', 'user_id', 'record_id', 'edit_version', 'updated_at', 'pity', 'batch_id');
          EXECUTE format('UPDATE public.history SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.history,$1)),
            edit_version = edit_version + 1, updated_at = clock_timestamp() WHERE user_id = $2 AND id = $3', v_columns, v_columns)
            USING v_row, p_user_id, (v_row->>'id')::BIGINT;
        END IF;
      END IF;
    ELSE
      IF v_row IS NULL THEN DELETE FROM public.account_data_workbench_entries WHERE user_id = p_user_id AND id = (v_current->>'id')::UUID;
      ELSE
        v_entry := jsonb_populate_record(NULL::public.account_data_workbench_entries, v_row);
        IF v_current IS NULL THEN
          v_entry.revision := (v_plan->'rowVersions'->>v_key)::INTEGER + 1; v_entry.updated_at := clock_timestamp();
          INSERT INTO public.account_data_workbench_entries SELECT v_entry.*;
        ELSE
          UPDATE public.account_data_workbench_entries SET pool_id = v_entry.pool_id, kind = v_entry.kind,
            source = v_entry.source, derivation = v_entry.derivation, "values" = v_entry."values",
            time_precision = v_entry.time_precision, deleted_at = v_entry.deleted_at,
            revision = revision + 1, updated_at = clock_timestamp()
          WHERE user_id = p_user_id AND id = v_entry.id;
        END IF;
      END IF;
    END IF;
    v_count := v_count + 1;
  END LOOP;
  -- Recompute only the affected pools, once each; do not journal derived pity updates.
  FOR v_scope IN SELECT DISTINCT row->>'game_uid' AS game_uid, row->>'server_scope' AS server_scope, row->>'pool_id' AS pool_id
    FROM (SELECT value AS row FROM jsonb_each(v_plan->'initial') UNION ALL SELECT value FROM jsonb_each(v_plan->'rows')) touched
    WHERE jsonb_typeof(row) = 'object' AND row ? 'record_id' LOOP
    PERFORM public.recompute_history_scope(p_user_id, v_scope.game_uid, v_scope.server_scope, v_scope.pool_id);
  END LOOP;
  SELECT id INTO v_new_id FROM public.account_data_revisions WHERE user_id = p_user_id AND transaction_id = txid_current();
  PERFORM set_config('app.account_revert_target', '', true); PERFORM set_config('app.account_revert_request', '', true);
  PERFORM set_config('app.account_revert_token', '', true);
  RETURN jsonb_build_object('revisionId', v_new_id::TEXT, 'targetId', p_target_id::TEXT, 'changed', v_count, 'replayed', false);
END;
$$;

-- Expired validations lose full request copies, while hashes and compact receipts keep retries idempotent.
ALTER TABLE public.account_data_workbench_validations ADD COLUMN request_digest TEXT;
UPDATE public.account_data_workbench_validations SET request_digest = md5(request::TEXT);
CREATE FUNCTION public.compact_workbench_validation() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN NEW.request_digest := md5(NEW.request::TEXT); END IF;
  IF NEW.consumed_at IS NOT NULL THEN NEW.request := '{}'::JSONB; NEW.operations := '{}'::JSONB; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER compact_workbench_validation BEFORE INSERT OR UPDATE ON public.account_data_workbench_validations
  FOR EACH ROW EXECUTE FUNCTION public.compact_workbench_validation();
UPDATE public.account_data_workbench_validations SET request = '{}', operations = '{}' WHERE consumed_at IS NOT NULL;
DO $$ DECLARE v_function TEXT; BEGIN
  SELECT pg_get_functiondef('public.commit_account_data_workbench_workspace(uuid,uuid,text,jsonb,text)'::regprocedure) INTO v_function;
  IF position('v_token.request IS DISTINCT FROM p_request' IN v_function) = 0 THEN
    RAISE EXCEPTION 'workbench_commit_definition_changed: review the request digest migration before applying';
  END IF;
  v_function := replace(v_function, 'v_token.request IS DISTINCT FROM p_request',
    'v_token.request_digest IS DISTINCT FROM md5(p_request::TEXT)');
  EXECUTE v_function;
END $$;

CREATE FUNCTION public.prune_account_data_revisions() RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_count INTEGER;
BEGIN
  DELETE FROM public.account_data_revisions WHERE created_at < clock_timestamp() - interval '180 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  DELETE FROM public.account_data_workbench_validations WHERE consumed_at IS NULL AND expires_at < clock_timestamp();
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.account_revision_content(TEXT,JSONB), public.account_revision_diff(JSONB,JSONB,TEXT[]),
  public.account_revision_inverse(JSONB,JSONB), public.capture_account_data_revision(), public.skip_duplicate_account_audit(),
  public.plan_account_data_revert(UUID,BIGINT), public.list_account_data_revisions(UUID), public.preview_account_data_revert(UUID,BIGINT),
  public.revert_account_data_revision(UUID,BIGINT,TEXT,UUID), public.prune_account_data_revisions(), public.compact_workbench_validation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_account_data_revisions(UUID), public.preview_account_data_revert(UUID,BIGINT),
  public.revert_account_data_revision(UUID,BIGINT,TEXT,UUID), public.prune_account_data_revisions() TO service_role;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('prune-account-data-revisions', '17 3 * * *', 'SELECT public.prune_account_data_revisions()');
  END IF;
END $$;
COMMIT;
