-- 174: add revision-safe private analysis snapshot persistence and work queues.
--
-- The browser can only read its own rows. All claiming, publishing and
-- backfill operations are service-role-only. Snapshot computation stays out
-- of history write transactions.

BEGIN;

ALTER TABLE public.personal_analysis_scope_state
  ADD COLUMN IF NOT EXISTS lease_id UUID,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.personal_analysis_scope_state'::regclass
      AND conname = 'personal_analysis_scope_attempt_count_nonnegative'
  ) THEN
    ALTER TABLE public.personal_analysis_scope_state
      ADD CONSTRAINT personal_analysis_scope_attempt_count_nonnegative
      CHECK (attempt_count >= 0);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.personal_analysis_owner_state (
  user_id UUID PRIMARY KEY
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  history_revision BIGINT NOT NULL DEFAULT 0,
  snapshot_revision BIGINT NOT NULL DEFAULT -1,
  dirty_since TIMESTAMPTZ,
  computed_at TIMESTAMPTZ,
  analysis_schema_version INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  lease_id UUID,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  CHECK (history_revision >= 0),
  CHECK (snapshot_revision >= -1),
  CHECK (snapshot_revision <= history_revision),
  CHECK (analysis_schema_version >= 1),
  CHECK (attempt_count >= 0)
);

ALTER TABLE public.personal_analysis_owner_state
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.personal_analysis_snapshots (
  user_id UUID NOT NULL
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  scope_kind TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  source_game_uid TEXT,
  source_server_scope TEXT,
  input_revision BIGINT NOT NULL,
  analysis_schema_version INTEGER NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL,
  PRIMARY KEY (user_id, scope_kind, scope_key),
  CHECK (scope_kind IN ('owner', 'account')),
  CHECK (btrim(scope_key) <> ''),
  CHECK (input_revision >= 0),
  CHECK (analysis_schema_version >= 1),
  CHECK (jsonb_typeof(payload) = 'object'),
  CHECK (
    (
      scope_kind = 'owner'
      AND scope_key = 'owner'
      AND source_game_uid IS NULL
      AND source_server_scope IS NULL
    )
    OR (
      scope_kind = 'account'
      AND NULLIF(btrim(source_game_uid), '') IS NOT NULL
      AND NULLIF(btrim(source_server_scope), '') IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_personal_analysis_owner_state_dirty
  ON public.personal_analysis_owner_state (dirty_since, user_id)
  WHERE snapshot_revision < history_revision;

CREATE INDEX IF NOT EXISTS idx_personal_analysis_scope_state_lease
  ON public.personal_analysis_scope_state (lease_expires_at)
  WHERE snapshot_revision < history_revision;

CREATE INDEX IF NOT EXISTS idx_personal_analysis_owner_state_lease
  ON public.personal_analysis_owner_state (lease_expires_at)
  WHERE snapshot_revision < history_revision;

CREATE INDEX IF NOT EXISTS idx_personal_analysis_snapshots_source
  ON public.personal_analysis_snapshots (
    user_id,
    source_game_uid,
    source_server_scope
  )
  WHERE scope_kind = 'account';

ALTER TABLE public.personal_analysis_owner_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_analysis_snapshots ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.reset_personal_analysis_retry_on_revision_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.history_revision IS DISTINCT FROM OLD.history_revision THEN
    NEW.attempt_count := 0;
    NEW.next_attempt_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reset_personal_analysis_scope_retry_on_revision
  ON public.personal_analysis_scope_state;
CREATE TRIGGER reset_personal_analysis_scope_retry_on_revision
  BEFORE UPDATE OF history_revision ON public.personal_analysis_scope_state
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_personal_analysis_retry_on_revision_change();

DROP TRIGGER IF EXISTS reset_personal_analysis_owner_retry_on_revision
  ON public.personal_analysis_owner_state;
CREATE TRIGGER reset_personal_analysis_owner_retry_on_revision
  BEFORE UPDATE OF history_revision ON public.personal_analysis_owner_state
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_personal_analysis_retry_on_revision_change();

REVOKE ALL ON TABLE public.personal_analysis_owner_state
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.personal_analysis_snapshots
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.personal_analysis_owner_state
  TO authenticated, service_role;
GRANT SELECT ON TABLE public.personal_analysis_snapshots
  TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON TABLE public.personal_analysis_owner_state
  TO service_role;
GRANT INSERT, UPDATE, DELETE ON TABLE public.personal_analysis_snapshots
  TO service_role;

DROP POLICY IF EXISTS personal_analysis_owner_state_select_own
  ON public.personal_analysis_owner_state;
CREATE POLICY personal_analysis_owner_state_select_own
  ON public.personal_analysis_owner_state
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS personal_analysis_owner_state_active_session
  ON public.personal_analysis_owner_state;
CREATE POLICY personal_analysis_owner_state_active_session
  ON public.personal_analysis_owner_state
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (public.is_request_auth_session_allowed());

DROP POLICY IF EXISTS personal_analysis_snapshots_select_own
  ON public.personal_analysis_snapshots;
CREATE POLICY personal_analysis_snapshots_select_own
  ON public.personal_analysis_snapshots
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS personal_analysis_snapshots_active_session
  ON public.personal_analysis_snapshots;
CREATE POLICY personal_analysis_snapshots_active_session
  ON public.personal_analysis_snapshots
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (public.is_request_auth_session_allowed());

CREATE OR REPLACE FUNCTION public.mark_personal_analysis_owners_dirty_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.personal_analysis_owner_state (
    user_id,
    history_revision,
    snapshot_revision,
    dirty_since,
    analysis_schema_version,
    last_error
  )
  SELECT DISTINCT
    row_data.user_id,
    1,
    -1,
    statement_timestamp(),
    1,
    NULL
  FROM new_personal_analysis_owner_rows AS row_data
  WHERE row_data.user_id IS NOT NULL
  ORDER BY 1
  ON CONFLICT (user_id)
  DO UPDATE SET
    history_revision = public.personal_analysis_owner_state.history_revision + 1,
    dirty_since = COALESCE(
      public.personal_analysis_owner_state.dirty_since,
      EXCLUDED.dirty_since
    ),
    last_error = NULL;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_personal_analysis_owners_dirty_after_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.personal_analysis_owner_state (
    user_id,
    history_revision,
    snapshot_revision,
    dirty_since,
    analysis_schema_version,
    last_error
  )
  SELECT DISTINCT
    row_data.user_id,
    1,
    -1,
    statement_timestamp(),
    1,
    NULL
  FROM old_personal_analysis_owner_rows AS row_data
  WHERE row_data.user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.id = row_data.user_id
    )
  ORDER BY 1
  ON CONFLICT (user_id)
  DO UPDATE SET
    history_revision = public.personal_analysis_owner_state.history_revision + 1,
    dirty_since = COALESCE(
      public.personal_analysis_owner_state.dirty_since,
      EXCLUDED.dirty_since
    ),
    last_error = NULL;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_personal_analysis_owners_dirty_after_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  WITH changed_rows AS (
    SELECT
      old_row.user_id AS old_user_id,
      old_row.record_id AS old_record_id,
      new_row.user_id AS new_user_id,
      new_row.record_id AS new_record_id
    FROM old_personal_analysis_owner_rows AS old_row
    FULL OUTER JOIN new_personal_analysis_owner_rows AS new_row
      ON new_row.user_id = old_row.user_id
     AND new_row.record_id = old_row.record_id
    WHERE (
      to_jsonb(old_row) - ARRAY['batch_id', 'updated_at']::TEXT[]
    ) IS DISTINCT FROM (
      to_jsonb(new_row) - ARRAY['batch_id', 'updated_at']::TEXT[]
    )
  ),
  affected_owners AS (
    SELECT old_row.user_id
    FROM old_personal_analysis_owner_rows AS old_row
    JOIN changed_rows AS changed
      ON changed.old_user_id = old_row.user_id
     AND changed.old_record_id = old_row.record_id
    WHERE old_row.user_id IS NOT NULL

    UNION

    SELECT new_row.user_id
    FROM new_personal_analysis_owner_rows AS new_row
    JOIN changed_rows AS changed
      ON changed.new_user_id = new_row.user_id
     AND changed.new_record_id = new_row.record_id
    WHERE new_row.user_id IS NOT NULL
  )
  INSERT INTO public.personal_analysis_owner_state (
    user_id,
    history_revision,
    snapshot_revision,
    dirty_since,
    analysis_schema_version,
    last_error
  )
  SELECT
    affected.user_id,
    1,
    -1,
    statement_timestamp(),
    1,
    NULL
  FROM affected_owners AS affected
  ORDER BY 1
  ON CONFLICT (user_id)
  DO UPDATE SET
    history_revision = public.personal_analysis_owner_state.history_revision + 1,
    dirty_since = COALESCE(
      public.personal_analysis_owner_state.dirty_since,
      EXCLUDED.dirty_since
    ),
    last_error = NULL;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS mark_personal_analysis_owners_dirty_insert
  ON public.history;
CREATE TRIGGER mark_personal_analysis_owners_dirty_insert
  AFTER INSERT ON public.history
  REFERENCING NEW TABLE AS new_personal_analysis_owner_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.mark_personal_analysis_owners_dirty_after_insert();

DROP TRIGGER IF EXISTS mark_personal_analysis_owners_dirty_delete
  ON public.history;
CREATE TRIGGER mark_personal_analysis_owners_dirty_delete
  AFTER DELETE ON public.history
  REFERENCING OLD TABLE AS old_personal_analysis_owner_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.mark_personal_analysis_owners_dirty_after_delete();

DROP TRIGGER IF EXISTS mark_personal_analysis_owners_dirty_update
  ON public.history;
CREATE TRIGGER mark_personal_analysis_owners_dirty_update
  AFTER UPDATE ON public.history
  REFERENCING OLD TABLE AS old_personal_analysis_owner_rows
              NEW TABLE AS new_personal_analysis_owner_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.mark_personal_analysis_owners_dirty_after_update();

CREATE OR REPLACE FUNCTION public.enqueue_personal_analysis_backfill(
  p_after_user_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_user_ids UUID[];
  v_last_user_id UUID;
  v_scope_rows INTEGER := 0;
  v_owner_rows INTEGER := 0;
BEGIN
  SELECT ARRAY_AGG(candidate.user_id ORDER BY candidate.user_id)
  INTO v_user_ids
  FROM (
    SELECT DISTINCT history_row.user_id
    FROM public.history AS history_row
    WHERE history_row.user_id IS NOT NULL
      AND (p_after_user_id IS NULL OR history_row.user_id > p_after_user_id)
      AND (
        NOT EXISTS (
          SELECT 1
          FROM public.personal_analysis_owner_state AS owner_state
          WHERE owner_state.user_id = history_row.user_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.history AS scope_history
          WHERE scope_history.user_id = history_row.user_id
            AND NOT EXISTS (
              SELECT 1
              FROM public.personal_analysis_scope_state AS scope_state
              WHERE scope_state.user_id = scope_history.user_id
                AND scope_state.scope_game_uid = public.normalize_personal_analysis_game_uid(
                  scope_history.user_id,
                  scope_history.game_uid
                )
                AND scope_state.server_scope = COALESCE(
                  NULLIF(btrim(scope_history.server_scope), ''),
                  'legacy'
                )
            )
        )
      )
    ORDER BY history_row.user_id
    LIMIT v_limit
  ) AS candidate;

  IF COALESCE(array_length(v_user_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object(
      'processedUsers', 0,
      'insertedOwnerStates', 0,
      'insertedScopeStates', 0,
      'nextUserId', NULL,
      'hasMore', FALSE
    );
  END IF;

  INSERT INTO public.personal_analysis_owner_state (
    user_id,
    history_revision,
    snapshot_revision,
    dirty_since,
    analysis_schema_version
  )
  SELECT
    candidate_user_id,
    1,
    -1,
    statement_timestamp(),
    1
  FROM unnest(v_user_ids) AS candidate_user_id
  ORDER BY candidate_user_id
  ON CONFLICT (user_id) DO NOTHING;
  GET DIAGNOSTICS v_owner_rows = ROW_COUNT;

  INSERT INTO public.personal_analysis_scope_state (
    user_id,
    scope_game_uid,
    server_scope,
    history_revision,
    snapshot_revision,
    dirty_since,
    analysis_schema_version
  )
  SELECT DISTINCT
    history_row.user_id,
    public.normalize_personal_analysis_game_uid(
      history_row.user_id,
      history_row.game_uid
    ),
    COALESCE(NULLIF(btrim(history_row.server_scope), ''), 'legacy'),
    1,
    -1,
    statement_timestamp(),
    1
  FROM public.history AS history_row
  WHERE history_row.user_id = ANY(v_user_ids)
  ORDER BY 1, 2, 3
  ON CONFLICT (user_id, scope_game_uid, server_scope) DO NOTHING;
  GET DIAGNOSTICS v_scope_rows = ROW_COUNT;

  v_last_user_id := v_user_ids[array_length(v_user_ids, 1)];

  RETURN jsonb_build_object(
    'processedUsers', array_length(v_user_ids, 1),
    'insertedOwnerStates', v_owner_rows,
    'insertedScopeStates', v_scope_rows,
    'nextUserId', v_last_user_id,
    'hasMore', EXISTS (
      SELECT 1
      FROM public.history AS remaining
      WHERE remaining.user_id > v_last_user_id
        AND (
          NOT EXISTS (
            SELECT 1
            FROM public.personal_analysis_owner_state AS owner_state
            WHERE owner_state.user_id = remaining.user_id
          )
          OR NOT EXISTS (
            SELECT 1
            FROM public.personal_analysis_scope_state AS scope_state
            WHERE scope_state.user_id = remaining.user_id
              AND scope_state.scope_game_uid = public.normalize_personal_analysis_game_uid(
                remaining.user_id,
                remaining.game_uid
              )
              AND scope_state.server_scope = COALESCE(
                NULLIF(btrim(remaining.server_scope), ''),
                'legacy'
              )
          )
        )
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_personal_analysis_jobs(
  p_lease_id UUID,
  p_limit INTEGER DEFAULT 5,
  p_lease_seconds INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 5), 1), 50);
  v_lease_seconds INTEGER := LEAST(
    GREATEST(COALESCE(p_lease_seconds, 50), 30),
    55
  );
  v_owner_jobs JSONB := '[]'::JSONB;
  v_scope_jobs JSONB := '[]'::JSONB;
BEGIN
  IF p_lease_id IS NULL THEN
    RAISE EXCEPTION 'personal_analysis_lease_id_required';
  END IF;

  WITH candidates AS (
    SELECT state.user_id
    FROM public.personal_analysis_owner_state AS state
    WHERE state.snapshot_revision < state.history_revision
      AND (
        state.lease_expires_at IS NULL
        OR state.lease_expires_at <= statement_timestamp()
      )
      AND (
        state.next_attempt_at IS NULL
        OR state.next_attempt_at <= statement_timestamp()
      )
    ORDER BY state.next_attempt_at NULLS FIRST, state.dirty_since NULLS FIRST, state.user_id
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  ),
  claimed AS (
    UPDATE public.personal_analysis_owner_state AS state
    SET
      lease_id = p_lease_id,
      lease_expires_at = statement_timestamp() + make_interval(secs => v_lease_seconds)
    FROM candidates
    WHERE state.user_id = candidates.user_id
    RETURNING
      state.user_id,
      state.history_revision,
      state.analysis_schema_version
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'kind', 'owner',
        'userId', claimed.user_id,
        'historyRevision', claimed.history_revision::TEXT,
        'analysisSchemaVersion', claimed.analysis_schema_version
      )
      ORDER BY claimed.user_id
    ),
    '[]'::JSONB
  )
  INTO v_owner_jobs
  FROM claimed;

  WITH candidates AS (
    SELECT
      state.user_id,
      state.scope_game_uid,
      state.server_scope
    FROM public.personal_analysis_scope_state AS state
    WHERE state.snapshot_revision < state.history_revision
      AND (
        state.lease_expires_at IS NULL
        OR state.lease_expires_at <= statement_timestamp()
      )
      AND (
        state.next_attempt_at IS NULL
        OR state.next_attempt_at <= statement_timestamp()
      )
      AND (
        jsonb_array_length(v_owner_jobs) = 0
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_owner_jobs) AS owner_job
          WHERE (owner_job ->> 'userId')::UUID = state.user_id
        )
      )
    ORDER BY
      state.next_attempt_at NULLS FIRST,
      state.dirty_since NULLS FIRST,
      state.user_id,
      state.scope_game_uid,
      state.server_scope
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  ),
  claimed AS (
    UPDATE public.personal_analysis_scope_state AS state
    SET
      lease_id = p_lease_id,
      lease_expires_at = statement_timestamp() + make_interval(secs => v_lease_seconds)
    FROM candidates
    WHERE state.user_id = candidates.user_id
      AND state.scope_game_uid = candidates.scope_game_uid
      AND state.server_scope = candidates.server_scope
    RETURNING
      state.user_id,
      state.scope_game_uid,
      state.server_scope,
      state.history_revision,
      state.analysis_schema_version
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'kind', 'scope',
        'userId', claimed.user_id,
        'scopeGameUid', claimed.scope_game_uid,
        'serverScope', claimed.server_scope,
        'historyRevision', claimed.history_revision::TEXT,
        'analysisSchemaVersion', claimed.analysis_schema_version
      )
      ORDER BY
        claimed.user_id,
        claimed.scope_game_uid,
        claimed.server_scope
    ),
    '[]'::JSONB
  )
  INTO v_scope_jobs
  FROM claimed;

  RETURN jsonb_build_object(
    'leaseId', p_lease_id,
    'leaseSeconds', v_lease_seconds,
    'ownerJobs', v_owner_jobs,
    'scopeJobs', v_scope_jobs
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_personal_analysis_owner_snapshot(
  p_user_id UUID,
  p_input_revision BIGINT,
  p_analysis_schema_version INTEGER,
  p_payload JSONB,
  p_lease_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_state public.personal_analysis_owner_state%ROWTYPE;
  v_computed_at TIMESTAMPTZ := statement_timestamp();
BEGIN
  IF p_lease_id IS NULL THEN
    RAISE EXCEPTION 'personal_analysis_lease_id_required';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'personal_analysis_owner_payload_must_be_object';
  END IF;

  SELECT *
  INTO v_state
  FROM public.personal_analysis_owner_state
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_state.lease_id IS DISTINCT FROM p_lease_id
    OR v_state.history_revision IS DISTINCT FROM p_input_revision
    OR v_state.analysis_schema_version IS DISTINCT FROM p_analysis_schema_version
  THEN
    UPDATE public.personal_analysis_owner_state
    SET
      lease_id = NULL,
      lease_expires_at = NULL
    WHERE user_id = p_user_id
      AND lease_id = p_lease_id;
    RETURN FALSE;
  END IF;

  INSERT INTO public.personal_analysis_snapshots (
    user_id,
    scope_kind,
    scope_key,
    source_game_uid,
    source_server_scope,
    input_revision,
    analysis_schema_version,
    computed_at,
    payload
  ) VALUES (
    p_user_id,
    'owner',
    'owner',
    NULL,
    NULL,
    p_input_revision,
    p_analysis_schema_version,
    v_computed_at,
    p_payload
  )
  ON CONFLICT (user_id, scope_kind, scope_key)
  DO UPDATE SET
    input_revision = EXCLUDED.input_revision,
    analysis_schema_version = EXCLUDED.analysis_schema_version,
    computed_at = EXCLUDED.computed_at,
    payload = EXCLUDED.payload;

  UPDATE public.personal_analysis_owner_state
  SET
    snapshot_revision = p_input_revision,
    dirty_since = NULL,
    computed_at = v_computed_at,
    last_error = NULL,
    lease_id = NULL,
    lease_expires_at = NULL,
    attempt_count = 0,
    next_attempt_at = NULL
  WHERE user_id = p_user_id;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_personal_analysis_scope_snapshots(
  p_user_id UUID,
  p_scope_game_uid TEXT,
  p_server_scope TEXT,
  p_input_revision BIGINT,
  p_analysis_schema_version INTEGER,
  p_snapshots JSONB,
  p_lease_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_state public.personal_analysis_scope_state%ROWTYPE;
  v_computed_at TIMESTAMPTZ := statement_timestamp();
  v_snapshot_count INTEGER;
  v_distinct_snapshot_count INTEGER;
BEGIN
  IF p_lease_id IS NULL THEN
    RAISE EXCEPTION 'personal_analysis_lease_id_required';
  END IF;

  IF p_snapshots IS NULL OR jsonb_typeof(p_snapshots) <> 'array' THEN
    RAISE EXCEPTION 'personal_analysis_scope_snapshots_must_be_array';
  END IF;

  SELECT
    COUNT(*),
    COUNT(DISTINCT NULLIF(btrim(snapshot_item ->> 'scopeKey'), ''))
  INTO v_snapshot_count, v_distinct_snapshot_count
  FROM jsonb_array_elements(p_snapshots) AS snapshot_item;

  IF v_snapshot_count <> v_distinct_snapshot_count
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_snapshots) AS snapshot_item
      WHERE NULLIF(btrim(snapshot_item ->> 'scopeKey'), '') IS NULL
        OR jsonb_typeof(snapshot_item -> 'payload') <> 'object'
    )
  THEN
    RAISE EXCEPTION 'personal_analysis_scope_snapshots_invalid';
  END IF;

  SELECT *
  INTO v_state
  FROM public.personal_analysis_scope_state
  WHERE user_id = p_user_id
    AND scope_game_uid = p_scope_game_uid
    AND server_scope = p_server_scope
  FOR UPDATE;

  IF NOT FOUND
    OR v_state.lease_id IS DISTINCT FROM p_lease_id
    OR v_state.history_revision IS DISTINCT FROM p_input_revision
    OR v_state.analysis_schema_version IS DISTINCT FROM p_analysis_schema_version
  THEN
    UPDATE public.personal_analysis_scope_state
    SET
      lease_id = NULL,
      lease_expires_at = NULL
    WHERE user_id = p_user_id
      AND scope_game_uid = p_scope_game_uid
      AND server_scope = p_server_scope
      AND lease_id = p_lease_id;
    RETURN FALSE;
  END IF;

  DELETE FROM public.personal_analysis_snapshots
  WHERE user_id = p_user_id
    AND scope_kind = 'account'
    AND source_game_uid = p_scope_game_uid
    AND source_server_scope = p_server_scope;

  INSERT INTO public.personal_analysis_snapshots (
    user_id,
    scope_kind,
    scope_key,
    source_game_uid,
    source_server_scope,
    input_revision,
    analysis_schema_version,
    computed_at,
    payload
  )
  SELECT
    p_user_id,
    'account',
    btrim(snapshot_item ->> 'scopeKey'),
    p_scope_game_uid,
    p_server_scope,
    p_input_revision,
    p_analysis_schema_version,
    v_computed_at,
    snapshot_item -> 'payload'
  FROM jsonb_array_elements(p_snapshots) AS snapshot_item
  ORDER BY btrim(snapshot_item ->> 'scopeKey');

  UPDATE public.personal_analysis_scope_state
  SET
    snapshot_revision = p_input_revision,
    dirty_since = NULL,
    computed_at = v_computed_at,
    last_error = NULL,
    lease_id = NULL,
    lease_expires_at = NULL,
    attempt_count = 0,
    next_attempt_at = NULL
  WHERE user_id = p_user_id
    AND scope_game_uid = p_scope_game_uid
    AND server_scope = p_server_scope;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_personal_analysis_job(
  p_kind TEXT,
  p_user_id UUID,
  p_scope_game_uid TEXT DEFAULT NULL,
  p_server_scope TEXT DEFAULT NULL,
  p_lease_id UUID DEFAULT NULL,
  p_error_code TEXT DEFAULT 'analysis_build_failed'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_error_code TEXT := LEFT(
    COALESCE(NULLIF(btrim(p_error_code), ''), 'analysis_build_failed'),
    160
  );
BEGIN
  IF p_kind = 'owner' THEN
    UPDATE public.personal_analysis_owner_state
    SET
      last_error = v_error_code,
      lease_id = NULL,
      lease_expires_at = NULL,
      attempt_count = attempt_count + 1,
      next_attempt_at = statement_timestamp() + make_interval(
        secs => LEAST(3600, 30 * (1 << LEAST(attempt_count, 7)))
      )
    WHERE user_id = p_user_id
      AND lease_id = p_lease_id;
    RETURN FOUND;
  END IF;

  IF p_kind = 'scope' THEN
    UPDATE public.personal_analysis_scope_state
    SET
      last_error = v_error_code,
      lease_id = NULL,
      lease_expires_at = NULL,
      attempt_count = attempt_count + 1,
      next_attempt_at = statement_timestamp() + make_interval(
        secs => LEAST(3600, 30 * (1 << LEAST(attempt_count, 7)))
      )
    WHERE user_id = p_user_id
      AND scope_game_uid = p_scope_game_uid
      AND server_scope = p_server_scope
      AND lease_id = p_lease_id;
    RETURN FOUND;
  END IF;

  RAISE EXCEPTION 'unsupported_personal_analysis_job_kind';
END;
$$;

REVOKE ALL ON FUNCTION public.mark_personal_analysis_owners_dirty_after_insert()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_personal_analysis_owners_dirty_after_delete()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_personal_analysis_owners_dirty_after_update()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_personal_analysis_retry_on_revision_change()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.enqueue_personal_analysis_backfill(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_personal_analysis_backfill(UUID, INTEGER)
  TO service_role;

REVOKE ALL ON FUNCTION public.claim_personal_analysis_jobs(UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_personal_analysis_jobs(UUID, INTEGER, INTEGER)
  TO service_role;

REVOKE ALL ON FUNCTION public.publish_personal_analysis_owner_snapshot(
  UUID, BIGINT, INTEGER, JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_personal_analysis_owner_snapshot(
  UUID, BIGINT, INTEGER, JSONB, UUID
) TO service_role;

REVOKE ALL ON FUNCTION public.publish_personal_analysis_scope_snapshots(
  UUID, TEXT, TEXT, BIGINT, INTEGER, JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_personal_analysis_scope_snapshots(
  UUID, TEXT, TEXT, BIGINT, INTEGER, JSONB, UUID
) TO service_role;

REVOKE ALL ON FUNCTION public.fail_personal_analysis_job(
  TEXT, UUID, TEXT, TEXT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_personal_analysis_job(
  TEXT, UUID, TEXT, TEXT, UUID, TEXT
) TO service_role;

COMMENT ON TABLE public.personal_analysis_owner_state IS
  '私有 owner 级分析快照的版本、失效、租约和最近构建状态。';

COMMENT ON TABLE public.personal_analysis_snapshots IS
  '不含原始抽卡记录的私有 owner/account 分析读模型；仅本人有效会话可读。';

COMMENT ON FUNCTION public.claim_personal_analysis_jobs(UUID, INTEGER, INTEGER) IS
  'service_role 通过 SKIP LOCKED 领取 owner/scope 快照构建任务并设置短租约。';

COMMENT ON FUNCTION public.publish_personal_analysis_scope_snapshots(
  UUID, TEXT, TEXT, BIGINT, INTEGER, JSONB, UUID
) IS
  '按捕获 revision 和租约原子发布一个源 scope 下的全部 account 快照；并发写入时拒绝旧结果。';

COMMIT;

NOTIFY pgrst, 'reload schema';
