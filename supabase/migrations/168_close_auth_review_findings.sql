-- 168: close identity-hash migration, direct-RLS revocation, and OAuth setup races.

CREATE OR REPLACE FUNCTION public.claim_oauth_identity_v2(
  p_user_id UUID,
  p_provider TEXT,
  p_current_hash TEXT,
  p_current_version TEXT,
  p_candidate_hashes TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS SETOF public.app_auth_identities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_provider TEXT := LOWER(BTRIM(COALESCE(p_provider, '')));
  v_hashes TEXT[];
  v_hash TEXT;
  v_identity public.app_auth_identities%ROWTYPE;
  v_result public.app_auth_identities%ROWTYPE;
BEGIN
  IF p_user_id IS NULL
    OR v_provider = ''
    OR NULLIF(BTRIM(p_current_hash), '') IS NULL
    OR NULLIF(BTRIM(p_current_version), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_oauth_identity_claim'
      USING ERRCODE = '22023';
  END IF;

  SELECT ARRAY_AGG(candidate_hash ORDER BY candidate_hash)
  INTO v_hashes
  FROM (
    SELECT DISTINCT BTRIM(candidate_hash) AS candidate_hash
    FROM UNNEST(
      ARRAY_APPEND(COALESCE(p_candidate_hashes, ARRAY[]::TEXT[]), p_current_hash)
    ) AS candidate_hash
    WHERE NULLIF(BTRIM(candidate_hash), '') IS NOT NULL
  ) AS normalized_hashes;

  IF COALESCE(ARRAY_LENGTH(v_hashes, 1), 0) < 1
    OR ARRAY_LENGTH(v_hashes, 1) > 8 THEN
    RAISE EXCEPTION 'invalid_oauth_identity_candidates'
      USING ERRCODE = '22023';
  END IF;

  -- Lock each candidate in global sort order. Rolling deployments can carry
  -- overlapping, but not identical, keyrings; locking the whole array would
  -- give those requests different locks and allow two first owners.
  FOREACH v_hash IN ARRAY v_hashes
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'oauth-identity-v2:' || v_provider || ':' || v_hash,
      0
    ));
  END LOOP;

  FOR v_identity IN
    SELECT identity.*
    FROM public.app_auth_identities AS identity
    WHERE identity.provider = v_provider
      AND identity.provider_subject_hash = ANY(v_hashes)
    ORDER BY identity.id
    FOR UPDATE
  LOOP
    IF v_result.id IS NOT NULL AND v_result.id <> v_identity.id THEN
      RAISE EXCEPTION 'oauth_identity_hash_split'
        USING ERRCODE = 'P0001';
    END IF;
    v_result := v_identity;
  END LOOP;

  IF v_result.id IS NOT NULL AND v_result.user_id <> p_user_id THEN
    RAISE EXCEPTION 'oauth_identity_already_linked'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.oauth_identity_claim', '1', TRUE);

  IF v_result.id IS NOT NULL THEN
    UPDATE public.app_auth_identities
    SET
      provider_subject_hash = p_current_hash,
      provider_subject_hash_key_version = p_current_version
    WHERE id = v_result.id
    RETURNING * INTO v_result;
  ELSE
    INSERT INTO public.app_auth_identities (
      user_id,
      provider,
      provider_subject_hash,
      provider_subject_hash_key_version,
      metadata_redacted_json
    )
    VALUES (
      p_user_id,
      v_provider,
      p_current_hash,
      p_current_version,
      '{}'::JSONB
    )
    RETURNING * INTO v_result;
  END IF;

  RETURN NEXT v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_oauth_password_setup_capability(
  p_user_id UUID,
  p_capability_id UUID,
  p_outcome TEXT,
  p_error_code TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF p_outcome NOT IN ('completed', 'coordination_required', 'frozen') THEN
    RAISE EXCEPTION 'invalid_password_setup_outcome'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('password-setup:' || p_user_id::TEXT, 0));

  SELECT password_setup_capability_status
  INTO v_status
  FROM public.account_security_states
  WHERE user_id = p_user_id
    AND password_setup_capability_id = p_capability_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'password_setup_capability_not_claimed'
      USING ERRCODE = 'P0001';
  END IF;

  -- A lost response after commit must be safely retryable. Never downgrade a
  -- completed capability to a coordination state on a later retry.
  IF v_status = 'completed' THEN
    RETURN v_status;
  END IF;
  IF v_status = p_outcome AND v_status IN ('coordination_required', 'frozen') THEN
    RETURN v_status;
  END IF;
  IF v_status <> 'claimed' THEN
    RAISE EXCEPTION 'password_setup_capability_not_claimed'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.account_security_states
  SET
    password_setup_capability_status = p_outcome,
    password_setup_completed_at = CASE WHEN p_outcome = 'completed' THEN NOW() ELSE password_setup_completed_at END,
    password_setup_last_error_code = NULLIF(BTRIM(p_error_code), ''),
    password_change_required = CASE WHEN p_outcome = 'completed' THEN FALSE ELSE TRUE END,
    password_change_reason = CASE WHEN p_outcome = 'completed' THEN NULL ELSE password_change_reason END,
    password_change_source = CASE WHEN p_outcome = 'completed' THEN NULL ELSE password_change_source END,
    password_change_requested_at = CASE WHEN p_outcome = 'completed' THEN NULL ELSE password_change_requested_at END,
    password_change_expires_at = CASE WHEN p_outcome = 'completed' THEN NULL ELSE password_change_expires_at END,
    password_change_recovery_request_id = CASE WHEN p_outcome = 'completed' THEN NULL ELSE password_change_recovery_request_id END,
    password_change_set_by = CASE WHEN p_outcome = 'completed' THEN NULL ELSE password_change_set_by END,
    updated_at = NOW()
  WHERE user_id = p_user_id
    AND password_setup_capability_id = p_capability_id
    AND password_setup_capability_status = 'claimed'
  RETURNING password_setup_capability_status INTO v_status;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'password_setup_capability_not_claimed'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_oauth_account_security_state(
  p_user_id UUID,
  p_requires_email BOOLEAN,
  p_created BOOLEAN,
  p_capability_id UUID DEFAULT NULL
)
RETURNS SETOF public.account_security_states
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_state public.account_security_states%ROWTYPE;
  v_has_verified_password BOOLEAN;
  v_has_verified_email BOOLEAN;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_user_id IS NULL OR (p_created IS TRUE AND p_capability_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_oauth_security_state_refresh'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('password-setup:' || p_user_id::TEXT, 0));

  SELECT *
  INTO v_state
  FROM public.account_security_states
  WHERE user_id = p_user_id
  FOR UPDATE;

  SELECT public.has_verified_password_login(p_user_id)
  INTO v_has_verified_password;

  -- Email ownership is decided by the database, not by a stale callback
  -- snapshot: a callback that read "no site email" earlier must not reopen
  -- email verification after another request completed it.
  SELECT EXISTS (
    SELECT 1
    FROM auth.users AS auth_user
    JOIN public.profiles AS profile ON profile.id = auth_user.id
    JOIN public.account_email_ownerships AS ownership
      ON ownership.user_id = auth_user.id
    WHERE auth_user.id = p_user_id
      AND auth_user.email_confirmed_at IS NOT NULL
      AND public.normalize_account_email(auth_user.email) = ownership.normalized_email
      AND public.normalize_account_email(profile.email) = ownership.normalized_email
  )
  INTO v_has_verified_email;

  IF v_state.user_id IS NULL THEN
    INSERT INTO public.account_security_states (
      user_id,
      email_verification_required,
      email_verification_reason,
      email_verification_requested_at,
      password_change_required,
      password_change_reason,
      password_change_source,
      password_change_requested_at,
      password_setup_capability_id,
      password_setup_capability_status,
      password_setup_attempt_count,
      updated_at
    )
    VALUES (
      p_user_id,
      NOT v_has_verified_email AND COALESCE(p_requires_email, FALSE),
      CASE WHEN NOT v_has_verified_email AND p_requires_email THEN 'oauth_email_setup_required' ELSE NULL END,
      CASE WHEN NOT v_has_verified_email AND p_requires_email THEN v_now ELSE NULL END,
      NOT v_has_verified_password,
      CASE WHEN NOT v_has_verified_password THEN 'oauth_password_setup_required' ELSE NULL END,
      CASE WHEN NOT v_has_verified_password THEN 'oauth' ELSE NULL END,
      CASE WHEN NOT v_has_verified_password THEN v_now ELSE NULL END,
      CASE WHEN NOT v_has_verified_password AND p_created THEN p_capability_id ELSE NULL END,
      CASE WHEN NOT v_has_verified_password AND p_created THEN 'available' ELSE NULL END,
      0,
      v_now
    )
    RETURNING * INTO v_state;
    RETURN NEXT v_state;
    RETURN;
  END IF;

  UPDATE public.account_security_states
  SET
    email_verification_required = CASE
      WHEN v_has_verified_email THEN FALSE
      WHEN p_requires_email THEN TRUE
      ELSE email_verification_required
    END,
    email_verification_reason = CASE
      WHEN v_has_verified_email THEN NULL
      WHEN p_requires_email THEN 'oauth_email_setup_required_existing'
      ELSE email_verification_reason
    END,
    email_verification_requested_at = CASE
      WHEN v_has_verified_email THEN NULL
      WHEN p_requires_email THEN v_now
      ELSE email_verification_requested_at
    END,
    email_verification_token_hash = CASE
      WHEN p_requires_email THEN NULL
      ELSE email_verification_token_hash
    END,
    email_verification_token_expires_at = CASE
      WHEN p_requires_email THEN NULL
      ELSE email_verification_token_expires_at
    END,
    email_verification_code_hash = CASE
      WHEN p_requires_email THEN NULL
      ELSE email_verification_code_hash
    END,
    email_verification_code_expires_at = CASE
      WHEN p_requires_email THEN NULL
      ELSE email_verification_code_expires_at
    END,
    password_change_required = CASE
      WHEN password_change_source = 'account_recovery' THEN password_change_required
      WHEN v_has_verified_password THEN FALSE
      WHEN password_setup_capability_status = 'completed' THEN FALSE
      ELSE TRUE
    END,
    password_change_reason = CASE
      WHEN password_change_source = 'account_recovery' THEN password_change_reason
      WHEN v_has_verified_password OR password_setup_capability_status = 'completed' THEN NULL
      WHEN p_created THEN 'oauth_password_setup_required'
      ELSE 'oauth_password_setup_required_existing'
    END,
    password_change_source = CASE
      WHEN password_change_source = 'account_recovery' THEN password_change_source
      WHEN v_has_verified_password OR password_setup_capability_status = 'completed' THEN NULL
      ELSE 'oauth'
    END,
    password_change_requested_at = CASE
      WHEN password_change_source = 'account_recovery' THEN password_change_requested_at
      WHEN v_has_verified_password OR password_setup_capability_status = 'completed' THEN NULL
      ELSE v_now
    END,
    password_change_expires_at = CASE
      WHEN password_change_source = 'account_recovery' THEN password_change_expires_at
      ELSE NULL
    END,
    password_change_recovery_request_id = CASE
      WHEN password_change_source = 'account_recovery' THEN password_change_recovery_request_id
      ELSE NULL
    END,
    password_change_set_by = CASE
      WHEN password_change_source = 'account_recovery' THEN password_change_set_by
      ELSE NULL
    END,
    password_setup_capability_id = CASE
      WHEN v_has_verified_password OR password_setup_capability_status = 'completed'
        OR password_change_source = 'account_recovery' THEN password_setup_capability_id
      WHEN p_created THEN COALESCE(password_setup_capability_id, p_capability_id)
      ELSE password_setup_capability_id
    END,
    password_setup_capability_status = CASE
      WHEN v_has_verified_password OR password_setup_capability_status = 'completed'
        OR password_change_source = 'account_recovery' THEN password_setup_capability_status
      WHEN p_created AND password_setup_capability_status IS NULL THEN 'available'
      ELSE password_setup_capability_status
    END,
    updated_at = v_now
  WHERE user_id = p_user_id
  RETURNING * INTO v_state;

  RETURN NEXT v_state;
END;
$$;

CREATE TABLE IF NOT EXISTS public.app_session_refresh_token_aliases (
  token_hash TEXT PRIMARY KEY CHECK (NULLIF(BTRIM(token_hash), '') IS NOT NULL),
  session_id UUID NOT NULL REFERENCES public.app_sessions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT app_session_refresh_token_aliases_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_app_session_refresh_token_aliases_session
  ON public.app_session_refresh_token_aliases(session_id, expires_at);

ALTER TABLE public.app_session_refresh_token_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_session_refresh_token_aliases FROM PUBLIC, anon, authenticated;

-- Opaque per-session binding for compatibility JWTs. The browser and the JWT
-- see this random value instead of the internal app_sessions.id, so the
-- database row id can never be used as an oracle or derived token.
ALTER TABLE public.app_sessions
  ADD COLUMN IF NOT EXISTS compat_session_binding UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_sessions_compat_session_binding
  ON public.app_sessions(compat_session_binding);

CREATE OR REPLACE FUNCTION public.rotate_app_session_tokens(
  p_session_id UUID,
  p_expected_refresh_token_hash TEXT,
  p_new_session_token_hash TEXT,
  p_new_refresh_token_hash TEXT,
  p_expires_at TIMESTAMPTZ,
  p_idle_cutoff TIMESTAMPTZ
)
RETURNS SETOF public.app_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_session public.app_sessions%ROWTYPE;
BEGIN
  IF p_session_id IS NULL
    OR NULLIF(BTRIM(p_expected_refresh_token_hash), '') IS NULL
    OR NULLIF(BTRIM(p_new_session_token_hash), '') IS NULL
    OR NULLIF(BTRIM(p_new_refresh_token_hash), '') IS NULL
    OR p_expires_at IS NULL
    OR p_expires_at <= NOW()
    OR p_idle_cutoff IS NULL THEN
    RAISE EXCEPTION 'invalid_app_session_rotation'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'app-session:' || p_session_id::TEXT,
    0
  ));

  SELECT *
  INTO v_session
  FROM public.app_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session.id IS NULL
    OR v_session.refresh_token_hash IS DISTINCT FROM p_expected_refresh_token_hash
    OR v_session.revoked_at IS NOT NULL
    OR v_session.last_seen_at <= p_idle_cutoff
    OR v_session.absolute_expires_at <= NOW() THEN
    RETURN;
  END IF;

  DELETE FROM public.app_session_refresh_token_aliases
  WHERE expires_at <= NOW();

  INSERT INTO public.app_session_refresh_token_aliases (token_hash, session_id, expires_at)
  VALUES
    (p_expected_refresh_token_hash, v_session.id, v_session.absolute_expires_at),
    (p_new_refresh_token_hash, v_session.id, v_session.absolute_expires_at)
  ON CONFLICT (token_hash) DO UPDATE SET
    expires_at = GREATEST(
      public.app_session_refresh_token_aliases.expires_at,
      EXCLUDED.expires_at
    )
  WHERE public.app_session_refresh_token_aliases.session_id = EXCLUDED.session_id;

  UPDATE public.app_sessions
  SET
    session_token_hash = p_new_session_token_hash,
    refresh_token_hash = p_new_refresh_token_hash,
    last_seen_at = NOW(),
    expires_at = LEAST(p_expires_at, absolute_expires_at)
  WHERE id = v_session.id
    AND refresh_token_hash = p_expected_refresh_token_hash
    AND revoked_at IS NULL
  RETURNING * INTO v_session;

  IF v_session.id IS NOT NULL THEN
    RETURN NEXT v_session;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_app_session_by_token_hashes(
  p_session_token_hash TEXT,
  p_refresh_token_hash TEXT,
  p_reason TEXT DEFAULT 'user_logout',
  p_revoked_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_session_ids UUID[];
  v_session_id UUID;
  v_revoked_count INTEGER := 0;
  v_row_count INTEGER := 0;
BEGIN
  SELECT ARRAY_AGG(session_id ORDER BY session_id)
  INTO v_session_ids
  FROM (
    SELECT app_session.id AS session_id
    FROM public.app_sessions AS app_session
    WHERE (
      NULLIF(BTRIM(p_session_token_hash), '') IS NOT NULL
      AND app_session.session_token_hash = p_session_token_hash
    ) OR (
      NULLIF(BTRIM(p_refresh_token_hash), '') IS NOT NULL
      AND app_session.refresh_token_hash = p_refresh_token_hash
    )
    UNION
    SELECT alias.session_id
    FROM public.app_session_refresh_token_aliases AS alias
    WHERE NULLIF(BTRIM(p_refresh_token_hash), '') IS NOT NULL
      AND alias.token_hash = p_refresh_token_hash
      AND alias.expires_at > NOW()
  ) AS matching_sessions;

  -- Lock every candidate session by its row id, in sorted order, using the
  -- same key as rotate_app_session_tokens. This serializes logout against a
  -- concurrent rotation of the same session regardless of which generation of
  -- the refresh token each request carries.
  FOREACH v_session_id IN ARRAY COALESCE(v_session_ids, ARRAY[]::UUID[])
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'app-session:' || v_session_id::TEXT,
      0
    ));

    PERFORM 1
    FROM public.app_sessions
    WHERE id = v_session_id
    FOR UPDATE;

    UPDATE public.app_sessions
    SET
      revoked_at = p_revoked_at,
      revoke_reason = COALESCE(NULLIF(BTRIM(p_reason), ''), 'user_logout')
    WHERE id = v_session_id
      AND revoked_at IS NULL;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_revoked_count := v_revoked_count + v_row_count;
  END LOOP;

  DELETE FROM public.app_session_refresh_token_aliases
  WHERE expires_at <= NOW();

  RETURN v_revoked_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_request_auth_session_allowed()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_claims JSONB;
  v_user_id UUID;
  v_session_id UUID;
  v_session_binding UUID;
  v_issued_at TIMESTAMPTZ;
  v_is_site_session BOOLEAN;
BEGIN
  v_claims := NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB;
  IF v_claims IS NULL THEN
    RETURN FALSE;
  END IF;

  v_user_id := NULLIF(v_claims ->> 'sub', '')::UUID;
  v_session_binding := NULLIF(v_claims ->> 'session_binding', '')::UUID;
  v_session_id := NULLIF(v_claims ->> 'session_id', '')::UUID;
  v_issued_at := TO_TIMESTAMP((v_claims ->> 'iat')::DOUBLE PRECISION);
  v_is_site_session := LOWER(COALESCE(v_claims #>> '{user_metadata,site_session}', 'false')) = 'true'
    OR LOWER(COALESCE(v_claims #>> '{app_metadata,provider}', '')) = 'site_session';

  IF v_user_id IS NULL
    OR v_issued_at IS NULL
    OR NOT public.is_account_credential_allowed(v_user_id) THEN
    RETURN FALSE;
  END IF;

  IF v_is_site_session THEN
    -- New tokens carry the opaque binding; legacy tokens carry the raw row id
    -- and stay accepted only until their short TTL expires after rollout.
    IF v_session_binding IS NULL AND v_session_id IS NULL THEN
      RETURN FALSE;
    END IF;

    RETURN EXISTS (
      SELECT 1
      FROM public.app_sessions AS app_session
      LEFT JOIN public.app_session_revocation_states AS revocation
        ON revocation.user_id = app_session.user_id
      WHERE app_session.user_id = v_user_id
        AND (
          (v_session_binding IS NOT NULL
            AND app_session.compat_session_binding = v_session_binding)
          OR (v_session_binding IS NULL
            AND app_session.id = v_session_id)
        )
        AND app_session.revoked_at IS NULL
        AND app_session.expires_at > NOW()
        AND app_session.absolute_expires_at > NOW()
        AND (
          revocation.revoked_before IS NULL
          OR (
            app_session.created_at > revocation.revoked_before
            AND v_issued_at > revocation.revoked_before
          )
        )
    );
  END IF;

  IF v_session_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN public.is_bearer_auth_session_allowed(v_user_id, v_session_id, v_issued_at);
EXCEPTION
  WHEN OTHERS THEN
    RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_oauth_identity_v2(UUID, TEXT, TEXT, TEXT, TEXT[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_oauth_account_security_state(UUID, BOOLEAN, BOOLEAN, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rotate_app_session_tokens(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_app_session_by_token_hashes(TEXT, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_request_auth_session_allowed()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_request_auth_session_allowed()
  TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_session_refresh_token_aliases
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.claim_oauth_identity_v2(UUID, TEXT, TEXT, TEXT, TEXT[])
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.refresh_oauth_account_security_state(UUID, BOOLEAN, BOOLEAN, UUID)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.rotate_app_session_tokens(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.revoke_app_session_by_token_hashes(TEXT, TEXT, TEXT, TIMESTAMPTZ)
      TO service_role;
  END IF;
END;
$$;

-- Admin writes are mediated by same-origin APIs that authenticate the actor
-- before using service_role. A revoked browser JWT must not retain a direct
-- SECURITY DEFINER RPC path that bypasses table RLS.
DO $$
DECLARE
  v_function RECORD;
BEGIN
  FOR v_function IN
    SELECT
      namespace.nspname AS schema_name,
      procedure.proname AS function_name,
      pg_get_function_identity_arguments(procedure.oid) AS identity_arguments
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.prosecdef IS TRUE
      AND procedure.proname LIKE 'admin\_%' ESCAPE '\'
  LOOP
    EXECUTE FORMAT(
      'REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
      v_function.schema_name,
      v_function.function_name,
      v_function.identity_arguments
    );
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE FORMAT(
        'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role',
        v_function.schema_name,
        v_function.function_name,
        v_function.identity_arguments
      );
    END IF;
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_table RECORD;
BEGIN
  FOR v_table IN
    SELECT namespace.nspname AS schema_name, relation.relname AS table_name
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE relation.relkind IN ('r', 'p')
      AND relation.relrowsecurity IS TRUE
      AND namespace.nspname IN ('public', 'storage')
  LOOP
    EXECUTE FORMAT(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      'authenticated_session_must_be_active',
      v_table.schema_name,
      v_table.table_name
    );
    EXECUTE FORMAT(
      'CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.is_request_auth_session_allowed()) WITH CHECK (public.is_request_auth_session_allowed())',
      'authenticated_session_must_be_active',
      v_table.schema_name,
      v_table.table_name
    );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.claim_oauth_identity_v2(UUID, TEXT, TEXT, TEXT, TEXT[]) IS
  'Atomically claims an OAuth subject across the current, rotated, and legacy hash formats, then migrates it to the current key version.';
COMMENT ON FUNCTION public.refresh_oauth_account_security_state(UUID, BOOLEAN, BOOLEAN, UUID) IS
  'Serializes OAuth callback security-state refreshes with first-password setup so a completed capability cannot be reverted to required.';
COMMENT ON FUNCTION public.rotate_app_session_tokens(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Rotates one refresh-token family under the same advisory lock used by logout and records historical token hashes for family revocation.';
COMMENT ON FUNCTION public.revoke_app_session_by_token_hashes(TEXT, TEXT, TEXT, TIMESTAMPTZ) IS
  'Revokes every session family identified by current or historical session/refresh token hashes; serialized against refresh rotation.';
COMMENT ON FUNCTION public.is_request_auth_session_allowed() IS
  'Restrictive RLS guard for authenticated PostgREST requests; rejects revoked sessions and expired temporary credentials.';

-- The private import backend verifies credentials when the request arrives,
-- but a queued task may cross the temporary-password expiry boundary before
-- its final atomic commit. Re-check inside the commit transaction so expired
-- credentials can never write official history rows.
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
    COALESCE(NULLIF(btrim(item.type), ''), 'limited'),
    item.start_time,
    item.end_time,
    NULLIF(btrim(item.up_character), ''),
    item.featured_characters,
    NOW(),
    NOW()
  FROM jsonb_to_recordset(v_pools) AS item(
    pool_id TEXT,
    name TEXT,
    type TEXT,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    up_character TEXT,
    featured_characters TEXT[]
  )
  WHERE NULLIF(btrim(item.pool_id), '') IS NOT NULL
  ON CONFLICT (pool_id) DO UPDATE SET
    name = EXCLUDED.name,
    type = EXCLUDED.type,
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    up_character = EXCLUDED.up_character,
    featured_characters = EXCLUDED.featured_characters,
    updated_at = NOW();
  GET DIAGNOSTICS v_pool_count = ROW_COUNT;

  INSERT INTO public.history (
    user_id,
    record_id,
    pool_id,
    rarity,
    is_standard,
    special_type,
    item_name,
    timestamp,
    created_at,
    updated_at,
    game_uid,
    server_id,
    seq_id,
    character_id
  )
  SELECT
    p_user_id,
    item.record_id,
    item.pool_id,
    item.rarity,
    COALESCE(item.is_standard, FALSE),
    NULLIF(btrim(item.special_type), ''),
    NULLIF(btrim(item.item_name), ''),
    item.timestamp,
    NOW(),
    NOW(),
    item.game_uid,
    NULLIF(btrim(item.server_id), ''),
    item.seq_id,
    NULLIF(btrim(item.character_id), '')
  FROM jsonb_to_recordset(v_history) AS item(
    record_id TEXT,
    pool_id TEXT,
    seq_id TEXT,
    game_uid TEXT,
    rarity INTEGER,
    timestamp TIMESTAMPTZ,
    is_standard BOOLEAN,
    special_type TEXT,
    item_name TEXT,
    server_id TEXT,
    character_id TEXT
  )
  ON CONFLICT (user_id, game_uid, server_id, pool_id, seq_id, record_id) DO UPDATE SET
    rarity = EXCLUDED.rarity,
    is_standard = EXCLUDED.is_standard,
    special_type = EXCLUDED.special_type,
    item_name = EXCLUDED.item_name,
    timestamp = EXCLUDED.timestamp,
    character_id = EXCLUDED.character_id,
    updated_at = NOW();
  GET DIAGNOSTICS v_history_count = ROW_COUNT;

  SELECT COALESCE(SUM((item.value->>'expectedCount')::BIGINT), 0)
  INTO v_expected_count
  FROM jsonb_array_elements(v_history) AS item(value)
  WHERE jsonb_typeof(item.value) = 'object'
    AND (item.value->>'expectedCount') IS NOT NULL;

  IF v_expected_count > 0 AND v_history_count < v_expected_count THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'official_import_record_count_mismatch';
  END IF;

  v_result := jsonb_build_object(
    'poolCount', v_pool_count,
    'historyCount', v_history_count,
    'expectedCount', v_expected_count
  );

  UPDATE public.official_import_tasks
  SET
    status = 'committed',
    summary = COALESCE(summary, '{}'::JSONB) || jsonb_build_object('commitResult', v_result),
    updated_at = NOW()
  WHERE id = p_task_id
    AND user_id = p_user_id;

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

-- User ranking stats are SECURITY DEFINER functions that read private history
-- for an arbitrary caller-supplied user id. Authenticated callers may only
-- read their own stats; service_role keeps its privileged path for the bot
-- summary API. Anonymous callers lose access entirely.
CREATE OR REPLACE FUNCTION public.get_user_ranking_stats(p_user_id uuid)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'user_ranking_stats_forbidden'
      USING ERRCODE = '42501';
  END IF;

  WITH
  history_with_info AS (
    SELECT
      h.rarity,
      h.item_name,
      h.is_standard,
      h.is_free,
      h.special_type,
      h.pool_id,
      COALESCE(c.type, 'character') as item_type,
      CASE
        WHEN h.pool_id LIKE 'special_%' THEN 'limited'
        WHEN h.pool_id LIKE 'weapon%' OR h.pool_id LIKE 'wepon%' THEN 'weapon'
        WHEN h.pool_id IN ('standard', 'beginner') THEN 'standard'
        WHEN h.pool_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          COALESCE(
            (SELECT
              CASE
                WHEN p.type IN ('limited', 'limited_character') THEN 'limited'
                WHEN p.type IN ('weapon', 'limited_weapon') THEN 'weapon'
                ELSE 'standard'
              END
            FROM public.pools p
            WHERE p.user_id = p_user_id
              AND p.pool_id = h.pool_id
            ),
            'standard'
          )
        ELSE 'standard'
      END as pool_type
    FROM public.history h
    LEFT JOIN public.characters c ON c.name = h.item_name
    WHERE h.user_id = p_user_id
      AND h.special_type IS DISTINCT FROM 'gift'
      AND h.item_name IS NOT NULL
      AND h.item_name != ''
  ),
  limited_six_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'limited' AND rarity = 6 AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  limited_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'limited' AND rarity = 5 AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  standard_six_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'standard' AND rarity = 6 AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  standard_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'standard' AND rarity = 5 AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  weapon_six_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'weapon' AND rarity = 6 AND item_type = 'weapon'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  weapon_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'weapon' AND rarity = 5 AND item_type = 'weapon'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  )

  SELECT json_build_object(
    'limited', json_build_object(
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_five_star)
    ),
    'standard', json_build_object(
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_six_star),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_five_star)
    ),
    'weapon', json_build_object(
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_five_star)
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_ranking_stats(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_ranking_stats(uuid)
  TO authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.get_user_ranking_stats(uuid)
      TO service_role;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_ranking_stats_cached(
  p_user_id UUID,
  p_buffer_seconds INT DEFAULT 120
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count BIGINT;
  v_cache_key     TEXT;
  v_cached_data   JSONB;
  v_cached_fp     BIGINT;
  v_cached_at     TIMESTAMPTZ;
  v_result        JSON;
  v_max_ttl       INTERVAL := INTERVAL '6 hours';
BEGIN
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'user_ranking_stats_forbidden'
      USING ERRCODE = '42501';
  END IF;
  IF p_buffer_seconds < 0 OR p_buffer_seconds > 3600 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'user_ranking_stats_buffer_invalid';
  END IF;

  SELECT count(*) INTO v_current_count
    FROM public.history
   WHERE user_id = p_user_id;

  v_cache_key := 'user_ranking:v2:' || p_user_id::TEXT;

  SELECT cached_data, row_fingerprint, computed_at
    INTO v_cached_data, v_cached_fp, v_cached_at
    FROM public.stats_cache
   WHERE cache_key = v_cache_key;

  IF v_cached_data IS NOT NULL THEN
    IF v_cached_fp = v_current_count
       AND v_cached_at + v_max_ttl > now() THEN
      RETURN v_cached_data::JSON;
    END IF;

    IF v_cached_fp <> v_current_count
       AND v_cached_at + (p_buffer_seconds || ' seconds')::INTERVAL > now() THEN
      RETURN v_cached_data::JSON;
    END IF;
  END IF;

  SELECT public.get_user_ranking_stats(p_user_id) INTO v_result;

  INSERT INTO public.stats_cache (cache_key, cached_data, row_fingerprint, computed_at)
  VALUES (v_cache_key, v_result::JSONB, v_current_count, now())
  ON CONFLICT (cache_key) DO UPDATE SET
    cached_data     = EXCLUDED.cached_data,
    row_fingerprint = EXCLUDED.row_fingerprint,
    computed_at     = EXCLUDED.computed_at;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_ranking_stats_cached(UUID, INT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_ranking_stats_cached(UUID, INT)
  TO authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.get_user_ranking_stats_cached(UUID, INT)
      TO service_role;
  END IF;
END;
$$;

-- Close the remaining low-value PUBLIC write/cleanup RPCs. The rate-limit
-- combined entry point keeps anon access because the same-origin rate-limit
-- API calls it with the publishable key.
REVOKE ALL ON FUNCTION public.cleanup_rate_limit_logs()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_rate_limit(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.increment_urgent_clicks()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.increment_urgent_clicks_batch(BIGINT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.increment_puzzle_solve(INT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_puzzle(INT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_puzzle_difficulty(INT, SMALLINT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_puzzle(INT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_profile_email()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_ticket_stats()
  FROM PUBLIC, anon;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_logs() TO service_role;
    GRANT EXECUTE ON FUNCTION public.log_rate_limit(TEXT, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.increment_urgent_clicks() TO service_role;
    GRANT EXECUTE ON FUNCTION public.increment_urgent_clicks_batch(BIGINT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.increment_puzzle_solve(INT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.review_puzzle(INT, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.update_puzzle_difficulty(INT, SMALLINT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.delete_puzzle(INT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.current_profile_email() TO service_role;
    GRANT EXECUTE ON FUNCTION public.get_ticket_stats() TO service_role;
  END IF;
END;
$$;
