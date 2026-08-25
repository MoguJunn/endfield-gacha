-- 177: prioritize active personal-analysis users and claim complete user batches.
--
-- The previous global FIFO queue processed one owner and one scope per run.
-- A historical backfill therefore placed active users behind thousands of
-- dormant rows, while remaining scopes could starve whenever another owner
-- job existed. This migration keeps revision-safe leases but chooses users as
-- the scheduling unit and lets an authenticated API request promote its own
-- missing/stale read model through a service-role-only RPC.

BEGIN;

ALTER TABLE public.personal_analysis_owner_state
  ADD COLUMN IF NOT EXISTS priority_requested_at TIMESTAMPTZ;

ALTER TABLE public.personal_analysis_scope_state
  ADD COLUMN IF NOT EXISTS priority_requested_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_personal_analysis_owner_state_priority
  ON public.personal_analysis_owner_state (
    priority_requested_at ASC NULLS LAST,
    next_attempt_at,
    dirty_since,
    user_id
  )
  WHERE snapshot_revision < history_revision;

CREATE INDEX IF NOT EXISTS idx_personal_analysis_scope_state_priority
  ON public.personal_analysis_scope_state (
    priority_requested_at ASC NULLS LAST,
    next_attempt_at,
    dirty_since,
    user_id,
    scope_game_uid,
    server_scope
  )
  WHERE snapshot_revision < history_revision;

CREATE OR REPLACE FUNCTION public.clear_personal_analysis_priority_when_fresh()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.snapshot_revision = NEW.history_revision THEN
    NEW.priority_requested_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clear_personal_analysis_owner_priority_when_fresh
  ON public.personal_analysis_owner_state;
CREATE TRIGGER clear_personal_analysis_owner_priority_when_fresh
  BEFORE UPDATE OF snapshot_revision, history_revision
  ON public.personal_analysis_owner_state
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_personal_analysis_priority_when_fresh();

DROP TRIGGER IF EXISTS clear_personal_analysis_scope_priority_when_fresh
  ON public.personal_analysis_scope_state;
CREATE TRIGGER clear_personal_analysis_scope_priority_when_fresh
  BEFORE UPDATE OF snapshot_revision, history_revision
  ON public.personal_analysis_scope_state
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_personal_analysis_priority_when_fresh();

CREATE OR REPLACE FUNCTION public.prioritize_personal_analysis_jobs(
  p_user_id UUID,
  p_scope_game_uid TEXT DEFAULT NULL,
  p_server_scope TEXT DEFAULT NULL,
  p_force_owner BOOLEAN DEFAULT FALSE,
  p_force_scope BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- clock_timestamp() changes within a transaction. This preserves FIFO
  -- ordering even when maintenance code prioritizes several users in one
  -- transaction; repeated requests still retain their first timestamp below.
  v_requested_at TIMESTAMPTZ := clock_timestamp();
  v_game_uid TEXT := NULLIF(btrim(p_scope_game_uid), '');
  v_server_scope TEXT := NULLIF(btrim(p_server_scope), '');
  v_owner_rows INTEGER := 0;
  v_scope_rows INTEGER := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'personal_analysis_user_id_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.history AS history_row
    WHERE history_row.user_id = p_user_id
  ) THEN
    RETURN jsonb_build_object(
      'queued', FALSE,
      'ownerRows', 0,
      'scopeRows', 0
    );
  END IF;

  INSERT INTO public.personal_analysis_owner_state (
    user_id,
    history_revision,
    snapshot_revision,
    dirty_since,
    analysis_schema_version,
    priority_requested_at
  )
  VALUES (
    p_user_id,
    1,
    -1,
    v_requested_at,
    1,
    v_requested_at
  )
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.personal_analysis_scope_state (
    user_id,
    scope_game_uid,
    server_scope,
    history_revision,
    snapshot_revision,
    dirty_since,
    analysis_schema_version,
    priority_requested_at
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
    v_requested_at,
    1,
    v_requested_at
  FROM public.history AS history_row
  WHERE history_row.user_id = p_user_id
    AND (
      v_game_uid IS NULL
      OR public.normalize_personal_analysis_game_uid(
        history_row.user_id,
        history_row.game_uid
      ) = v_game_uid
    )
    AND (
      v_server_scope IS NULL
      OR COALESCE(NULLIF(btrim(history_row.server_scope), ''), 'legacy') = v_server_scope
    )
  ON CONFLICT (user_id, scope_game_uid, server_scope) DO NOTHING;

  UPDATE public.personal_analysis_owner_state AS state
  SET
    snapshot_revision = CASE
      WHEN p_force_owner AND state.snapshot_revision = state.history_revision
        THEN GREATEST(-1, state.history_revision - 1)
      ELSE state.snapshot_revision
    END,
    dirty_since = COALESCE(state.dirty_since, v_requested_at),
    priority_requested_at = COALESCE(state.priority_requested_at, v_requested_at),
    lease_id = CASE
      WHEN state.lease_expires_at <= v_requested_at THEN NULL
      ELSE state.lease_id
    END,
    lease_expires_at = CASE
      WHEN state.lease_expires_at <= v_requested_at THEN NULL
      ELSE state.lease_expires_at
    END
  WHERE state.user_id = p_user_id
    AND (
      state.snapshot_revision < state.history_revision
      OR p_force_owner
    );
  GET DIAGNOSTICS v_owner_rows = ROW_COUNT;

  UPDATE public.personal_analysis_scope_state AS state
  SET
    snapshot_revision = CASE
      WHEN p_force_scope AND state.snapshot_revision = state.history_revision
        THEN GREATEST(-1, state.history_revision - 1)
      ELSE state.snapshot_revision
    END,
    dirty_since = COALESCE(state.dirty_since, v_requested_at),
    priority_requested_at = COALESCE(state.priority_requested_at, v_requested_at),
    lease_id = CASE
      WHEN state.lease_expires_at <= v_requested_at THEN NULL
      ELSE state.lease_id
    END,
    lease_expires_at = CASE
      WHEN state.lease_expires_at <= v_requested_at THEN NULL
      ELSE state.lease_expires_at
    END
  WHERE state.user_id = p_user_id
    AND (v_game_uid IS NULL OR state.scope_game_uid = v_game_uid)
    AND (v_server_scope IS NULL OR state.server_scope = v_server_scope)
    AND (
      state.snapshot_revision < state.history_revision
      OR p_force_scope
    );
  GET DIAGNOSTICS v_scope_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'queued', v_owner_rows > 0 OR v_scope_rows > 0,
    'ownerRows', v_owner_rows,
    'scopeRows', v_scope_rows,
    'requestedAt', v_requested_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prioritize_personal_analysis_jobs(
  UUID,
  TEXT,
  TEXT,
  BOOLEAN,
  BOOLEAN
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prioritize_personal_analysis_jobs(
  UUID,
  TEXT,
  TEXT,
  BOOLEAN,
  BOOLEAN
) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_personal_analysis_jobs(
  p_lease_id UUID,
  p_limit INTEGER DEFAULT 1,
  p_lease_seconds INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 1), 1), 5);
  v_lease_seconds INTEGER := LEAST(
    GREATEST(COALESCE(p_lease_seconds, 50), 30),
    55
  );
  v_scope_limit_per_user INTEGER := 20;
  v_user_ids UUID[] := ARRAY[]::UUID[];
  v_owner_jobs JSONB := '[]'::JSONB;
  v_scope_jobs JSONB := '[]'::JSONB;
BEGIN
  IF p_lease_id IS NULL THEN
    RAISE EXCEPTION 'personal_analysis_lease_id_required';
  END IF;

  SELECT COALESCE(array_agg(candidate.user_id ORDER BY candidate.rank), ARRAY[]::UUID[])
  INTO v_user_ids
  FROM (
    SELECT
      due.user_id,
      row_number() OVER (
        ORDER BY
          (max(due.priority_requested_at) IS NULL),
          min(due.priority_requested_at) ASC NULLS LAST,
          min(due.next_attempt_at) NULLS FIRST,
          min(due.dirty_since) NULLS FIRST,
          due.user_id
      ) AS rank
    FROM (
      SELECT
        state.user_id,
        state.priority_requested_at,
        state.next_attempt_at,
        state.dirty_since
      FROM public.personal_analysis_owner_state AS state
      WHERE state.snapshot_revision < state.history_revision
        AND (state.lease_expires_at IS NULL OR state.lease_expires_at <= statement_timestamp())
        AND (state.next_attempt_at IS NULL OR state.next_attempt_at <= statement_timestamp())

      UNION ALL

      SELECT
        state.user_id,
        state.priority_requested_at,
        state.next_attempt_at,
        state.dirty_since
      FROM public.personal_analysis_scope_state AS state
      WHERE state.snapshot_revision < state.history_revision
        AND (state.lease_expires_at IS NULL OR state.lease_expires_at <= statement_timestamp())
        AND (state.next_attempt_at IS NULL OR state.next_attempt_at <= statement_timestamp())
    ) AS due
    GROUP BY due.user_id
    ORDER BY rank
    LIMIT v_limit
  ) AS candidate;

  IF COALESCE(array_length(v_user_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object(
      'leaseId', p_lease_id,
      'leaseSeconds', v_lease_seconds,
      'ownerJobs', v_owner_jobs,
      'scopeJobs', v_scope_jobs
    );
  END IF;

  WITH claimed AS (
    UPDATE public.personal_analysis_owner_state AS state
    SET
      lease_id = p_lease_id,
      lease_expires_at = statement_timestamp() + make_interval(secs => v_lease_seconds)
    WHERE state.user_id = ANY(v_user_ids)
      AND state.snapshot_revision < state.history_revision
      AND (state.lease_expires_at IS NULL OR state.lease_expires_at <= statement_timestamp())
      AND (state.next_attempt_at IS NULL OR state.next_attempt_at <= statement_timestamp())
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

  WITH ranked AS (
    SELECT
      state.user_id,
      state.scope_game_uid,
      state.server_scope,
      row_number() OVER (
        PARTITION BY state.user_id
        ORDER BY
          state.priority_requested_at ASC NULLS LAST,
          state.next_attempt_at NULLS FIRST,
          state.dirty_since NULLS FIRST,
          state.scope_game_uid,
          state.server_scope
      ) AS scope_rank
    FROM public.personal_analysis_scope_state AS state
    WHERE state.user_id = ANY(v_user_ids)
      AND state.snapshot_revision < state.history_revision
      AND (state.lease_expires_at IS NULL OR state.lease_expires_at <= statement_timestamp())
      AND (state.next_attempt_at IS NULL OR state.next_attempt_at <= statement_timestamp())
  ),
  claimed AS (
    UPDATE public.personal_analysis_scope_state AS state
    SET
      lease_id = p_lease_id,
      lease_expires_at = statement_timestamp() + make_interval(secs => v_lease_seconds)
    FROM ranked
    WHERE ranked.scope_rank <= v_scope_limit_per_user
      AND state.user_id = ranked.user_id
      AND state.scope_game_uid = ranked.scope_game_uid
      AND state.server_scope = ranked.server_scope
      AND state.snapshot_revision < state.history_revision
      AND (state.lease_expires_at IS NULL OR state.lease_expires_at <= statement_timestamp())
      AND (state.next_attempt_at IS NULL OR state.next_attempt_at <= statement_timestamp())
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
      ORDER BY claimed.user_id, claimed.scope_game_uid, claimed.server_scope
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

COMMIT;
