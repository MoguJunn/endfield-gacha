-- 167: close email/password capability races and version OAuth identity keys.

CREATE OR REPLACE FUNCTION public.normalize_account_email(p_email TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT LOWER(BTRIM(COALESCE(p_email, '')));
$$;

REVOKE ALL ON FUNCTION public.normalize_account_email(TEXT)
  FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.account_email_ownerships (
  normalized_email TEXT PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  verified_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT account_email_ownerships_normalized_check CHECK (
    normalized_email = public.normalize_account_email(normalized_email)
    AND normalized_email <> ''
    AND normalized_email NOT LIKE '%@oauth.local.invalid'
  )
);

ALTER TABLE public.account_email_ownerships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_email_ownerships FROM PUBLIC, anon, authenticated;

INSERT INTO public.account_email_ownerships (
  normalized_email,
  user_id,
  verified_at,
  source,
  created_at,
  updated_at
)
SELECT
  public.normalize_account_email(auth_user.email),
  auth_user.id,
  auth_user.email_confirmed_at,
  'auth_confirmed_backfill',
  NOW(),
  NOW()
FROM auth.users AS auth_user
WHERE auth_user.email_confirmed_at IS NOT NULL
  AND public.normalize_account_email(auth_user.email) <> ''
  AND public.normalize_account_email(auth_user.email) NOT LIKE '%@oauth.local.invalid'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.account_email_challenges (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_email TEXT NOT NULL,
  reason TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_expires_at TIMESTAMPTZ NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  code_expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'consumed', 'cancelled', 'expired')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ,
  CONSTRAINT account_email_challenges_target_check CHECK (
    target_email = public.normalize_account_email(target_email)
    AND target_email <> ''
    AND target_email NOT LIKE '%@oauth.local.invalid'
  ),
  CONSTRAINT account_email_challenges_expiry_check CHECK (
    token_expires_at > created_at
    AND code_expires_at > created_at
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_email_challenges_pending_user
  ON public.account_email_challenges(user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_account_email_challenges_expiry
  ON public.account_email_challenges(token_expires_at, code_expires_at)
  WHERE status = 'pending';

ALTER TABLE public.account_email_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_email_challenges FROM PUBLIC, anon, authenticated;

ALTER TABLE public.account_security_states
  ADD COLUMN IF NOT EXISTS email_verification_target_email TEXT,
  ADD COLUMN IF NOT EXISTS email_verification_version UUID,
  ADD COLUMN IF NOT EXISTS password_setup_capability_id UUID,
  ADD COLUMN IF NOT EXISTS password_setup_capability_status TEXT,
  ADD COLUMN IF NOT EXISTS password_setup_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_setup_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_setup_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS password_setup_last_error_code TEXT;

ALTER TABLE public.account_security_states
  DROP CONSTRAINT IF EXISTS account_security_states_password_setup_status_check;
ALTER TABLE public.account_security_states
  ADD CONSTRAINT account_security_states_password_setup_status_check CHECK (
    password_setup_capability_status IS NULL
    OR password_setup_capability_status IN (
      'available',
      'claimed',
      'completed',
      'coordination_required',
      'frozen'
    )
  );

UPDATE public.account_security_states AS security_state
SET
  email_verification_target_email = public.normalize_account_email(profile.email)
FROM public.profiles AS profile
WHERE profile.id = security_state.user_id
  AND security_state.email_verification_required IS FALSE
  AND security_state.email_verification_verified_at IS NOT NULL
  AND security_state.email_verification_target_email IS NULL
  AND NULLIF(public.normalize_account_email(profile.email), '') IS NOT NULL
  AND public.normalize_account_email(profile.email) NOT LIKE '%@oauth.local.invalid';

UPDATE public.account_security_states
SET
  password_setup_capability_id = COALESCE(password_setup_capability_id, gen_random_uuid()),
  password_setup_capability_status = COALESCE(password_setup_capability_status, 'available')
WHERE password_change_required IS TRUE
  AND password_change_reason LIKE 'oauth_password_setup_required%';

CREATE OR REPLACE FUNCTION public.start_account_email_challenge(
  p_challenge_id UUID,
  p_user_id UUID,
  p_target_email TEXT,
  p_reason TEXT,
  p_token_hash TEXT,
  p_token_expires_at TIMESTAMPTZ,
  p_code_hash TEXT,
  p_code_expires_at TIMESTAMPTZ
)
RETURNS SETOF public.account_email_challenges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_target_email TEXT := public.normalize_account_email(p_target_email);
  v_existing_owner UUID;
  v_challenge public.account_email_challenges%ROWTYPE;
BEGIN
  IF p_challenge_id IS NULL
    OR p_user_id IS NULL
    OR v_target_email = ''
    OR v_target_email LIKE '%@oauth.local.invalid'
    OR NULLIF(BTRIM(p_token_hash), '') IS NULL
    OR NULLIF(BTRIM(p_code_hash), '') IS NULL
    OR p_token_expires_at <= NOW()
    OR p_code_expires_at <= NOW() THEN
    RAISE EXCEPTION 'invalid_email_challenge'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('account-email-user:' || p_user_id::TEXT, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('account-email-value:' || v_target_email, 0));

  SELECT ownership.user_id
  INTO v_existing_owner
  FROM public.account_email_ownerships AS ownership
  WHERE ownership.normalized_email = v_target_email
  FOR UPDATE;

  IF v_existing_owner IS NOT NULL AND v_existing_owner <> p_user_id THEN
    RAISE EXCEPTION 'email_already_claimed'
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.account_email_challenges
  SET status = 'cancelled'
  WHERE user_id = p_user_id
    AND status = 'pending';

  DELETE FROM public.account_email_challenges
  WHERE status IN ('consumed', 'cancelled', 'expired')
    AND created_at < NOW() - INTERVAL '30 days';

  INSERT INTO public.account_email_challenges (
    id,
    user_id,
    target_email,
    reason,
    token_hash,
    token_expires_at,
    code_hash,
    code_expires_at,
    status,
    created_at
  )
  VALUES (
    p_challenge_id,
    p_user_id,
    v_target_email,
    COALESCE(NULLIF(BTRIM(p_reason), ''), 'user_requested'),
    p_token_hash,
    p_token_expires_at,
    p_code_hash,
    p_code_expires_at,
    'pending',
    NOW()
  )
  RETURNING * INTO v_challenge;

  INSERT INTO public.account_security_states (
    user_id,
    email_verification_required,
    email_verification_reason,
    email_verification_requested_at,
    email_verification_verified_at,
    email_verification_target_email,
    email_verification_version,
    email_verification_token_hash,
    email_verification_token_expires_at,
    email_verification_code_hash,
    email_verification_code_expires_at,
    updated_at
  )
  VALUES (
    p_user_id,
    TRUE,
    COALESCE(NULLIF(BTRIM(p_reason), ''), 'user_requested'),
    NOW(),
    NULL,
    v_target_email,
    p_challenge_id,
    p_token_hash,
    p_token_expires_at,
    p_code_hash,
    p_code_expires_at,
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email_verification_required = TRUE,
    email_verification_reason = EXCLUDED.email_verification_reason,
    email_verification_requested_at = EXCLUDED.email_verification_requested_at,
    email_verification_verified_at = NULL,
    email_verification_target_email = EXCLUDED.email_verification_target_email,
    email_verification_version = EXCLUDED.email_verification_version,
    email_verification_token_hash = EXCLUDED.email_verification_token_hash,
    email_verification_token_expires_at = EXCLUDED.email_verification_token_expires_at,
    email_verification_code_hash = EXCLUDED.email_verification_code_hash,
    email_verification_code_expires_at = EXCLUDED.email_verification_code_expires_at,
    updated_at = NOW();

  RETURN NEXT v_challenge;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_account_email_challenge(
  p_kind TEXT,
  p_hash TEXT,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  user_id UUID,
  target_email TEXT,
  challenge_id UUID,
  verified_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_challenge public.account_email_challenges%ROWTYPE;
  v_challenge_id UUID;
  v_existing_owner UUID;
  v_verified_at TIMESTAMPTZ := NOW();
BEGIN
  IF p_kind NOT IN ('token', 'code') OR NULLIF(BTRIM(p_hash), '') IS NULL THEN
    RETURN;
  END IF;
  IF p_kind = 'code' AND p_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT challenge.*
  INTO v_challenge
  FROM public.account_email_challenges AS challenge
  WHERE challenge.status = 'pending'
    AND (
      (p_kind = 'token' AND challenge.token_hash = p_hash)
      OR (p_kind = 'code' AND challenge.code_hash = p_hash)
    )
    AND (p_user_id IS NULL OR challenge.user_id = p_user_id)
  ORDER BY challenge.created_at DESC
  LIMIT 1;

  IF v_challenge.id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('account-email-user:' || v_challenge.user_id::TEXT, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('account-email-value:' || v_challenge.target_email, 0));

  v_challenge_id := v_challenge.id;
  SELECT challenge.*
  INTO v_challenge
  FROM public.account_email_challenges AS challenge
  WHERE challenge.id = v_challenge_id
    AND challenge.status = 'pending'
  FOR UPDATE;

  IF v_challenge.id IS NULL THEN
    RETURN;
  END IF;

  IF (p_kind = 'token' AND v_challenge.token_expires_at <= NOW())
    OR (p_kind = 'code' AND v_challenge.code_expires_at <= NOW()) THEN
    UPDATE public.account_email_challenges
    SET status = 'expired'
    WHERE id = v_challenge.id;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.account_security_states AS security_state
    WHERE security_state.user_id = v_challenge.user_id
      AND security_state.email_verification_required IS TRUE
      AND security_state.email_verification_version = v_challenge.id
      AND security_state.email_verification_target_email = v_challenge.target_email
  ) THEN
    UPDATE public.account_email_challenges
    SET status = 'cancelled'
    WHERE id = v_challenge.id;
    RETURN;
  END IF;

  SELECT ownership.user_id
  INTO v_existing_owner
  FROM public.account_email_ownerships AS ownership
  WHERE ownership.normalized_email = v_challenge.target_email
  FOR UPDATE;

  IF v_existing_owner IS NOT NULL AND v_existing_owner <> v_challenge.user_id THEN
    RAISE EXCEPTION 'email_already_claimed'
      USING ERRCODE = '23505';
  END IF;

  DELETE FROM public.account_email_ownerships
  WHERE account_email_ownerships.user_id = v_challenge.user_id
    AND normalized_email <> v_challenge.target_email;

  INSERT INTO public.account_email_ownerships (
    normalized_email,
    user_id,
    verified_at,
    source,
    created_at,
    updated_at
  )
  VALUES (
    v_challenge.target_email,
    v_challenge.user_id,
    v_verified_at,
    'application_challenge',
    v_verified_at,
    v_verified_at
  )
  ON CONFLICT (normalized_email) DO UPDATE SET
    verified_at = EXCLUDED.verified_at,
    source = EXCLUDED.source,
    updated_at = EXCLUDED.updated_at
  WHERE public.account_email_ownerships.user_id = EXCLUDED.user_id;

  UPDATE public.profiles
  SET
    email = v_challenge.target_email,
    updated_at = v_verified_at
  WHERE id = v_challenge.user_id;

  UPDATE public.account_security_states
  SET
    email_verification_required = FALSE,
    email_verification_verified_at = v_verified_at,
    email_verification_target_email = v_challenge.target_email,
    email_verification_version = v_challenge.id,
    email_verification_token_hash = NULL,
    email_verification_token_expires_at = NULL,
    email_verification_code_hash = NULL,
    email_verification_code_expires_at = NULL,
    updated_at = v_verified_at
  WHERE account_security_states.user_id = v_challenge.user_id
    AND email_verification_version = v_challenge.id
    AND email_verification_required IS TRUE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.account_email_challenges
  SET
    status = 'consumed',
    consumed_at = v_verified_at
  WHERE id = v_challenge.id
    AND status = 'pending';

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT
    v_challenge.user_id,
    v_challenge.target_email,
    v_challenge.id,
    v_verified_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_account_email_ownership_from_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_email TEXT := public.normalize_account_email(NEW.email);
  v_existing_owner UUID;
BEGIN
  IF NEW.email_confirmed_at IS NULL
    OR v_email = ''
    OR v_email LIKE '%@oauth.local.invalid' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('account-email-user:' || NEW.id::TEXT, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('account-email-value:' || v_email, 0));

  SELECT ownership.user_id
  INTO v_existing_owner
  FROM public.account_email_ownerships AS ownership
  WHERE ownership.normalized_email = v_email
  FOR UPDATE;

  IF v_existing_owner IS NOT NULL AND v_existing_owner <> NEW.id THEN
    RAISE EXCEPTION 'email_already_claimed'
      USING ERRCODE = '23505';
  END IF;

  DELETE FROM public.account_email_ownerships
  WHERE account_email_ownerships.user_id = NEW.id
    AND normalized_email <> v_email;

  INSERT INTO public.account_email_ownerships (
    normalized_email,
    user_id,
    verified_at,
    source,
    created_at,
    updated_at
  )
  VALUES (
    v_email,
    NEW.id,
    COALESCE(NEW.email_confirmed_at, NOW()),
    'auth_confirmed',
    NOW(),
    NOW()
  )
  ON CONFLICT (normalized_email) DO UPDATE SET
    verified_at = EXCLUDED.verified_at,
    source = EXCLUDED.source,
    updated_at = EXCLUDED.updated_at
  WHERE public.account_email_ownerships.user_id = EXCLUDED.user_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_ownership_inserted ON auth.users;
CREATE TRIGGER on_auth_user_email_ownership_inserted
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_account_email_ownership_from_auth_user();

DROP TRIGGER IF EXISTS on_auth_user_email_ownership_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_ownership_updated
  AFTER UPDATE OF email, email_confirmed_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_account_email_ownership_from_auth_user();

CREATE OR REPLACE FUNCTION public.sync_profile_email_from_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_email TEXT := public.normalize_account_email(NEW.email);
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL
    AND v_email <> ''
    AND v_email NOT LIKE '%@oauth.local.invalid' THEN
    UPDATE public.profiles
    SET
      email = v_email,
      updated_at = NOW()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE OF email, email_confirmed_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_email_from_auth_user();

CREATE OR REPLACE FUNCTION public.claim_oauth_password_setup_capability(
  p_user_id UUID,
  p_capability_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_state public.account_security_states%ROWTYPE;
  v_profile_email TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('password-setup:' || p_user_id::TEXT, 0));

  SELECT *
  INTO v_state
  FROM public.account_security_states
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_state.user_id IS NULL
    OR v_state.password_change_required IS NOT TRUE
    OR v_state.password_change_reason NOT LIKE 'oauth_password_setup_required%'
    OR v_state.password_setup_capability_id IS DISTINCT FROM p_capability_id
    OR v_state.password_setup_capability_status IS DISTINCT FROM 'available' THEN
    RAISE EXCEPTION 'password_setup_capability_unavailable'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT public.normalize_account_email(profile.email)
  INTO v_profile_email
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id;

  IF v_state.email_verification_required IS TRUE
    OR v_state.email_verification_verified_at IS NULL
    OR v_state.email_verification_target_email IS NULL
    OR v_profile_email IS DISTINCT FROM v_state.email_verification_target_email
    OR NOT EXISTS (
      SELECT 1
      FROM public.account_email_ownerships AS ownership
      WHERE ownership.user_id = p_user_id
        AND ownership.normalized_email = v_state.email_verification_target_email
    ) THEN
    RAISE EXCEPTION 'verified_email_ownership_required'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.account_security_states
  SET
    password_setup_capability_status = 'claimed',
    password_setup_claimed_at = NOW(),
    password_setup_attempt_count = password_setup_attempt_count + 1,
    password_setup_last_error_code = NULL,
    updated_at = NOW()
  WHERE user_id = p_user_id;

  RETURN 'claimed';
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

CREATE OR REPLACE FUNCTION public.is_account_credential_allowed(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.account_security_states AS security_state
    WHERE security_state.user_id = p_user_id
      AND security_state.password_change_required IS TRUE
      AND security_state.password_change_source = 'account_recovery'
      AND (
        security_state.password_change_expires_at IS NULL
        OR security_state.password_change_expires_at <= NOW()
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.reject_expired_temporary_password_auth_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.is_account_credential_allowed(NEW.user_id) THEN
    RAISE EXCEPTION 'temporary_password_expired'
      USING ERRCODE = '28000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS before_auth_session_temporary_password_guard ON auth.sessions;
CREATE TRIGGER before_auth_session_temporary_password_guard
  BEFORE INSERT OR UPDATE ON auth.sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_expired_temporary_password_auth_session();

CREATE OR REPLACE FUNCTION public.revoke_app_sessions_on_auth_password_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_new_issue_id TEXT := NULLIF(BTRIM(COALESCE(
    NEW.raw_app_meta_data ->> 'temporary_password_issue_id',
    ''
  )), '');
  v_old_issue_id TEXT := NULLIF(BTRIM(COALESCE(
    OLD.raw_app_meta_data ->> 'temporary_password_issue_id',
    ''
  )), '');
  v_force_change BOOLEAN := LOWER(COALESCE(
    NEW.raw_app_meta_data ->> 'temporary_password_force_change',
    'false'
  )) IN ('1', 'true', 'yes', 'on');
  v_issued_at TIMESTAMPTZ;
  v_expires_at TIMESTAMPTZ;
BEGIN
  IF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
    PERFORM public.revoke_all_app_sessions_for_user(
      NEW.id,
      'auth_password_changed',
      NOW()
    );

    IF v_force_change AND v_new_issue_id IS DISTINCT FROM v_old_issue_id THEN
      v_issued_at := COALESCE(
        NULLIF(NEW.raw_app_meta_data ->> 'temporary_password_issued_at', '')::TIMESTAMPTZ,
        NOW()
      );
      v_expires_at := NULLIF(
        NEW.raw_app_meta_data ->> 'temporary_password_expires_at',
        ''
      )::TIMESTAMPTZ;

      IF v_expires_at IS NULL OR v_expires_at <= v_issued_at THEN
        RAISE EXCEPTION 'invalid_temporary_password_expiry'
          USING ERRCODE = '22023';
      END IF;

      INSERT INTO public.account_security_states (
        user_id,
        password_change_required,
        password_change_reason,
        password_change_source,
        password_change_requested_at,
        password_change_expires_at,
        updated_at
      )
      VALUES (
        NEW.id,
        TRUE,
        'account_recovery_temporary_password',
        'account_recovery',
        v_issued_at,
        v_expires_at,
        NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        password_change_required = TRUE,
        password_change_reason = EXCLUDED.password_change_reason,
        password_change_source = EXCLUDED.password_change_source,
        password_change_requested_at = EXCLUDED.password_change_requested_at,
        password_change_expires_at = EXCLUDED.password_change_expires_at,
        password_change_recovery_request_id = NULL,
        password_change_set_by = NULL,
        updated_at = NOW();
    ELSE
      UPDATE public.account_security_states
      SET
        password_change_required = FALSE,
        password_change_reason = NULL,
        password_change_source = NULL,
        password_change_requested_at = NULL,
        password_change_expires_at = NULL,
        password_change_recovery_request_id = NULL,
        password_change_set_by = NULL,
        updated_at = NOW()
      WHERE user_id = NEW.id
        AND password_change_required IS TRUE
        AND password_change_source = 'account_recovery';

      IF v_new_issue_id IS NOT NULL THEN
        UPDATE auth.users
        SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::JSONB)
          - 'temporary_password_issue_id'
          - 'temporary_password_force_change'
          - 'temporary_password_issued_at'
          - 'temporary_password_expires_at'
        WHERE id = NEW.id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.app_auth_identities
  ADD COLUMN IF NOT EXISTS provider_subject_hash_key_version TEXT NOT NULL DEFAULT 'legacy_state_v1';

ALTER TABLE public.app_auth_identities
  DROP CONSTRAINT IF EXISTS app_auth_identities_hash_key_version_check;
ALTER TABLE public.app_auth_identities
  ADD CONSTRAINT app_auth_identities_hash_key_version_check CHECK (
    NULLIF(BTRIM(provider_subject_hash_key_version), '') IS NOT NULL
  );

CREATE OR REPLACE FUNCTION public.prevent_app_auth_identity_owner_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.provider IS DISTINCT FROM OLD.provider THEN
    RAISE EXCEPTION 'OAuth identity owner and provider are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF (
    NEW.provider_subject_hash IS DISTINCT FROM OLD.provider_subject_hash
    OR NEW.provider_subject_hash_key_version IS DISTINCT FROM OLD.provider_subject_hash_key_version
  ) AND COALESCE(current_setting('app.oauth_identity_claim', TRUE), '') <> '1' THEN
    RAISE EXCEPTION 'OAuth identity key may only change through claim_oauth_identity'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS before_app_auth_identity_owner_change
  ON public.app_auth_identities;
CREATE TRIGGER before_app_auth_identity_owner_change
  BEFORE UPDATE OF user_id, provider, provider_subject_hash, provider_subject_hash_key_version
  ON public.app_auth_identities
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_app_auth_identity_owner_change();

CREATE OR REPLACE FUNCTION public.claim_oauth_identity(
  p_user_id UUID,
  p_provider TEXT,
  p_current_hash TEXT,
  p_current_version TEXT,
  p_previous_hash TEXT DEFAULT NULL,
  p_previous_version TEXT DEFAULT NULL
)
RETURNS SETOF public.app_auth_identities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_provider TEXT := LOWER(BTRIM(COALESCE(p_provider, '')));
  v_current public.app_auth_identities%ROWTYPE;
  v_previous public.app_auth_identities%ROWTYPE;
  v_result public.app_auth_identities%ROWTYPE;
  v_lock_key TEXT;
BEGIN
  IF p_user_id IS NULL
    OR v_provider = ''
    OR NULLIF(BTRIM(p_current_hash), '') IS NULL
    OR NULLIF(BTRIM(p_current_version), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_oauth_identity_claim'
      USING ERRCODE = '22023';
  END IF;

  v_lock_key := 'oauth-identity:' || v_provider || ':'
    || LEAST(p_current_hash, COALESCE(NULLIF(p_previous_hash, ''), p_current_hash)) || ':'
    || GREATEST(p_current_hash, COALESCE(NULLIF(p_previous_hash, ''), p_current_hash));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

  SELECT identity.*
  INTO v_current
  FROM public.app_auth_identities AS identity
  WHERE identity.provider = v_provider
    AND identity.provider_subject_hash = p_current_hash
  FOR UPDATE;

  IF NULLIF(BTRIM(p_previous_hash), '') IS NOT NULL
    AND p_previous_hash <> p_current_hash THEN
    SELECT identity.*
    INTO v_previous
    FROM public.app_auth_identities AS identity
    WHERE identity.provider = v_provider
      AND identity.provider_subject_hash = p_previous_hash
    FOR UPDATE;
  END IF;

  IF v_current.id IS NOT NULL
    AND v_previous.id IS NOT NULL
    AND v_current.id <> v_previous.id THEN
    RAISE EXCEPTION 'oauth_identity_hash_split'
      USING ERRCODE = 'P0001';
  END IF;

  v_result := COALESCE(v_current, v_previous);
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
      '{}'::jsonb
    )
    RETURNING * INTO v_result;
  END IF;

  RETURN NEXT v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_verified_password_login(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users AS auth_user
    JOIN public.profiles AS profile ON profile.id = auth_user.id
    JOIN public.account_email_ownerships AS ownership
      ON ownership.user_id = auth_user.id
    WHERE auth_user.id = p_user_id
      AND auth_user.email_confirmed_at IS NOT NULL
      AND NULLIF(auth_user.encrypted_password, '') IS NOT NULL
      AND public.normalize_account_email(auth_user.email) = ownership.normalized_email
      AND public.normalize_account_email(profile.email) = ownership.normalized_email
  );
$$;

UPDATE public.account_security_states
SET
  password_change_required = FALSE,
  password_change_reason = NULL,
  password_change_source = NULL,
  password_change_requested_at = NULL,
  password_change_expires_at = NULL,
  password_change_recovery_request_id = NULL,
  password_change_set_by = NULL,
  password_setup_capability_id = NULL,
  password_setup_capability_status = NULL,
  password_setup_claimed_at = NULL,
  password_setup_completed_at = NULL,
  password_setup_attempt_count = 0,
  password_setup_last_error_code = NULL,
  updated_at = NOW()
WHERE password_change_required IS TRUE
  AND password_change_reason LIKE 'oauth_password_setup_required%'
  AND public.has_verified_password_login(user_id);

CREATE OR REPLACE FUNCTION public.unlink_oauth_identity_atomically(
  p_user_id UUID,
  p_identity_id UUID
)
RETURNS SETOF public.app_auth_identities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_identity public.app_auth_identities%ROWTYPE;
  v_remaining_count INTEGER;
  v_has_password_login BOOLEAN;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('oauth-unlink:' || p_user_id::TEXT, 0));

  SELECT identity.*
  INTO v_identity
  FROM public.app_auth_identities AS identity
  WHERE identity.id = p_identity_id
  FOR UPDATE;

  IF v_identity.id IS NULL OR v_identity.disabled_at IS NOT NULL THEN
    RAISE EXCEPTION 'oauth_identity_not_found'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_identity.user_id <> p_user_id THEN
    RAISE EXCEPTION 'oauth_identity_forbidden'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*)
  INTO v_remaining_count
  FROM public.app_auth_identities AS identity
  WHERE identity.user_id = p_user_id
    AND identity.id <> p_identity_id
    AND identity.disabled_at IS NULL;

  SELECT public.has_verified_password_login(p_user_id)
  INTO v_has_password_login;

  IF v_remaining_count < 1 AND v_has_password_login IS NOT TRUE THEN
    RAISE EXCEPTION 'oauth_last_login_method'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.app_auth_identities
  SET
    disabled_at = NOW(),
    last_used_at = NOW()
  WHERE id = p_identity_id
    AND user_id = p_user_id
    AND disabled_at IS NULL
  RETURNING * INTO v_identity;

  IF v_identity.id IS NULL THEN
    RAISE EXCEPTION 'oauth_identity_unlink_failed'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEXT v_identity;
END;
$$;

REVOKE ALL ON FUNCTION public.start_account_email_challenge(
  UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_account_email_challenge(TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_account_email_ownership_from_auth_user()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_oauth_password_setup_capability(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_oauth_password_setup_capability(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_account_credential_allowed(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_expired_temporary_password_auth_session()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_oauth_identity(UUID, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_verified_password_login(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unlink_oauth_identity_atomically(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_email_ownerships TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_email_challenges TO service_role;
    GRANT EXECUTE ON FUNCTION public.normalize_account_email(TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.start_account_email_challenge(
      UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TIMESTAMPTZ
    ) TO service_role;
    GRANT EXECUTE ON FUNCTION public.consume_account_email_challenge(TEXT, TEXT, UUID)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.claim_oauth_password_setup_capability(UUID, UUID)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.finish_oauth_password_setup_capability(UUID, UUID, TEXT, TEXT)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.is_account_credential_allowed(UUID)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.claim_oauth_identity(UUID, TEXT, TEXT, TEXT, TEXT, TEXT)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.has_verified_password_login(UUID)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.unlink_oauth_identity_atomically(UUID, UUID)
      TO service_role;
  END IF;
END;
$$;

COMMENT ON TABLE public.account_email_ownerships IS
  'Canonical normalized email ownership proven by Auth confirmation or one-time application challenge.';
COMMENT ON TABLE public.account_email_challenges IS
  'Service-role-only one-time email challenge bound to user, exact target email and unique version.';
COMMENT ON COLUMN public.app_auth_identities.provider_subject_hash_key_version IS
  'Version of the dedicated OAuth identity HMAC key; unrelated to the short-lived OAuth state key.';
COMMENT ON FUNCTION public.claim_oauth_identity(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Atomically resolves current/previous provider-subject hashes, preserves owner and migrates only the hash key version.';
COMMENT ON FUNCTION public.has_verified_password_login(UUID) IS
  'Checks the canonical Auth password, confirmed email, profile email and private email ownership record.';
COMMENT ON FUNCTION public.unlink_oauth_identity_atomically(UUID, UUID) IS
  'Locks a user login-method set and refuses to disable the final usable login method.';

NOTIFY pgrst, 'reload schema';
