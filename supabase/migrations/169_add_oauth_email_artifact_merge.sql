-- 169: allow a verified OAuth user to reclaim an email that is blocked only
-- by the empty Auth user created by the historical magic-link defect.
--
-- This is deliberately not a general account merge. A target that owns any
-- profile, application data, MFA factor, OAuth identity, or unsupported Auth
-- shape remains blocked and requires manual review.

CREATE TABLE IF NOT EXISTS public.account_email_merge_intents (
  id UUID PRIMARY KEY,
  source_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  artifact_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  target_email TEXT NOT NULL,
  quarantine_email TEXT NOT NULL,
  verification_code_hash TEXT NOT NULL UNIQUE,
  verification_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (
    verification_attempt_count BETWEEN 0 AND 8
  ),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN (
      'pending',
      'verified',
      'claimed',
      'ownership_transferred',
      'completed',
      'coordination_required',
      'cancelled',
      'expired'
    )
  ),
  source_profile_email_before TEXT,
  source_email_required_before BOOLEAN,
  source_email_verified_at_before TIMESTAMPTZ,
  source_email_target_before TEXT,
  source_email_reason_before TEXT,
  source_email_token_hash_before TEXT,
  source_email_token_expires_before TIMESTAMPTZ,
  source_email_code_hash_before TEXT,
  source_email_code_expires_before TIMESTAMPTZ,
  source_security_updated_at_before TIMESTAMPTZ,
  started_session_id UUID NOT NULL REFERENCES public.app_sessions(id) ON DELETE RESTRICT,
  handoff_session_id UUID REFERENCES public.app_sessions(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  handoff_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  ownership_transferred_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error_code TEXT,
  metadata_redacted_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  CONSTRAINT account_email_merge_intents_users_differ CHECK (
    source_user_id <> artifact_user_id
  ),
  CONSTRAINT account_email_merge_intents_target_check CHECK (
    target_email = public.normalize_account_email(target_email)
    AND target_email <> ''
    AND target_email NOT LIKE '%@oauth.local.invalid'
  ),
  CONSTRAINT account_email_merge_intents_quarantine_check CHECK (
    quarantine_email = public.normalize_account_email(quarantine_email)
    AND quarantine_email LIKE '%@oauth.local.invalid'
  ),
  CONSTRAINT account_email_merge_intents_expiry_check CHECK (
    expires_at > created_at
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_email_merge_intents_active_source
  ON public.account_email_merge_intents(source_user_id)
  WHERE status IN ('pending', 'verified', 'claimed', 'ownership_transferred', 'coordination_required');

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_email_merge_intents_active_target
  ON public.account_email_merge_intents(target_email)
  WHERE status IN ('pending', 'verified', 'claimed', 'ownership_transferred', 'coordination_required');

CREATE INDEX IF NOT EXISTS idx_account_email_merge_intents_expiry
  ON public.account_email_merge_intents(expires_at)
  WHERE status IN ('pending', 'verified');

ALTER TABLE public.account_email_merge_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_email_merge_intents FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.account_email_artifact_merge_approvals (
  artifact_user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  target_email_hash TEXT NOT NULL,
  evidence_version TEXT NOT NULL CHECK (evidence_version = 'legacy_magiclink_v1'),
  approval_reference_hash TEXT NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT account_email_artifact_merge_approval_expiry CHECK (expires_at > approved_at)
);

CREATE TABLE IF NOT EXISTS public.account_email_merge_budgets (
  source_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_email TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  send_count INTEGER NOT NULL DEFAULT 0 CHECK (send_count BETWEEN 0 AND 5),
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count BETWEEN 0 AND 8),
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_user_id, target_email)
);

ALTER TABLE public.account_email_artifact_merge_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_email_merge_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_email_artifact_merge_approvals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.account_email_merge_budgets FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS authenticated_session_must_be_active
  ON public.account_email_merge_intents;
CREATE POLICY authenticated_session_must_be_active
  ON public.account_email_merge_intents
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (public.is_request_auth_session_allowed())
  WITH CHECK (public.is_request_auth_session_allowed());

DROP POLICY IF EXISTS authenticated_session_must_be_active
  ON public.account_email_artifact_merge_approvals;
CREATE POLICY authenticated_session_must_be_active
  ON public.account_email_artifact_merge_approvals
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_request_auth_session_allowed())
  WITH CHECK (public.is_request_auth_session_allowed());

DROP POLICY IF EXISTS authenticated_session_must_be_active
  ON public.account_email_merge_budgets;
CREATE POLICY authenticated_session_must_be_active
  ON public.account_email_merge_budgets
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_request_auth_session_allowed())
  WITH CHECK (public.is_request_auth_session_allowed());

CREATE OR REPLACE FUNCTION public.inspect_oauth_email_artifact_merge(
  p_source_user_id UUID,
  p_target_email TEXT,
  p_require_approval BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  eligible BOOLEAN,
  reason TEXT,
  artifact_user_id UUID,
  target_email TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_target_email TEXT := public.normalize_account_email(p_target_email);
  v_source auth.users%ROWTYPE;
  v_artifact auth.users%ROWTYPE;
  v_security public.account_security_states%ROWTYPE;
  v_reference RECORD;
  v_has_rows BOOLEAN;
  v_source_created_at TIMESTAMPTZ;
  v_artifact_created_at TIMESTAMPTZ;
  v_artifact_provider TEXT;
  v_artifact_providers JSONB;
  v_artifact_user_id UUID;
  v_identity_count INTEGER := 0;
BEGIN
  IF p_source_user_id IS NULL
    OR v_target_email = ''
    OR v_target_email LIKE '%@oauth.local.invalid' THEN
    RETURN QUERY SELECT FALSE, 'invalid_merge_candidate', NULL::UUID, v_target_email;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('account-email-user:' || p_source_user_id::TEXT, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('account-email-value:' || v_target_email, 0));

  SELECT * INTO v_source
  FROM auth.users
  WHERE id = p_source_user_id
  FOR UPDATE;

  SELECT id INTO v_artifact_user_id
  FROM auth.users
  WHERE public.normalize_account_email(email) = v_target_email
    AND id <> p_source_user_id
  ORDER BY created_at
  LIMIT 1;

  IF v_source.id IS NULL OR v_artifact_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'email_account_not_found', NULL::UUID, v_target_email;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('account-email-user:' || v_artifact_user_id::TEXT, 0));

  SELECT * INTO v_artifact
  FROM auth.users
  WHERE id = v_artifact_user_id
    AND public.normalize_account_email(email) = v_target_email
  FOR UPDATE;

  IF v_artifact.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'artifact_email_changed', v_artifact_user_id, v_target_email;
    RETURN;
  END IF;

  IF public.normalize_account_email(v_source.email) NOT LIKE '%@oauth.local.invalid'
    OR LOWER(COALESCE(v_source.raw_user_meta_data ->> 'synthetic_oauth_email', 'false')) <> 'true' THEN
    RETURN QUERY SELECT FALSE, 'source_not_synthetic_oauth', v_artifact.id, v_target_email;
    RETURN;
  END IF;

  SELECT * INTO v_security
  FROM public.account_security_states
  WHERE user_id = p_source_user_id
  FOR UPDATE;

  IF v_security.user_id IS NULL
    OR v_security.password_change_required IS NOT TRUE
    OR COALESCE(v_security.password_change_reason, '') NOT LIKE 'oauth_password_setup_required%'
    OR v_security.password_setup_capability_status IS DISTINCT FROM 'available' THEN
    RETURN QUERY SELECT FALSE, 'source_password_setup_not_available', v_artifact.id, v_target_email;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.app_auth_identities AS identity
    WHERE identity.user_id = p_source_user_id
      AND identity.provider = 'github'
      AND identity.disabled_at IS NULL
  ) THEN
    RETURN QUERY SELECT FALSE, 'source_github_identity_missing', v_artifact.id, v_target_email;
    RETURN;
  END IF;

  IF v_artifact.email_confirmed_at IS NULL THEN
    RETURN QUERY SELECT FALSE, 'artifact_email_not_confirmed', v_artifact.id, v_target_email;
    RETURN;
  END IF;

  IF NULLIF(v_artifact.encrypted_password, '') IS NOT NULL
    OR NULLIF(v_artifact.phone, '') IS NOT NULL
    OR COALESCE(v_artifact.is_anonymous, FALSE) IS TRUE
    OR v_artifact.invited_at IS NOT NULL
    OR v_artifact.banned_until IS NOT NULL
    OR COALESCE(v_artifact.role, 'authenticated') <> 'authenticated'
    OR COALESCE(v_artifact.raw_app_meta_data, '{}'::JSONB) - 'provider' - 'providers' <> '{}'::JSONB
    OR COALESCE(v_artifact.raw_user_meta_data, '{}'::JSONB) - 'email_verified' <> '{}'::JSONB THEN
    RETURN QUERY SELECT FALSE, 'artifact_auth_shape_mismatch', v_artifact.id, v_target_email;
    RETURN;
  END IF;

  v_artifact_provider := LOWER(COALESCE(v_artifact.raw_app_meta_data ->> 'provider', ''));
  v_artifact_providers := COALESCE(v_artifact.raw_app_meta_data -> 'providers', '[]'::JSONB);
  IF v_artifact_provider <> 'email'
    OR v_artifact_providers <> '["email"]'::JSONB
    OR LOWER(COALESCE(v_artifact.raw_user_meta_data ->> 'site_password_set', 'false')) = 'true'
    OR LOWER(COALESCE(v_artifact.raw_user_meta_data ->> 'synthetic_oauth_email', 'false')) = 'true' THEN
    RETURN QUERY SELECT FALSE, 'target_is_real_account', v_artifact.id, v_target_email;
    RETURN;
  END IF;

  IF TO_REGCLASS('auth.identities') IS NULL THEN
    RETURN QUERY SELECT FALSE, 'artifact_identity_state_unavailable', v_artifact.id, v_target_email;
    RETURN;
  END IF;
  EXECUTE 'SELECT COUNT(*) FROM auth.identities WHERE user_id = $1 AND provider = ''email'''
    INTO v_identity_count
    USING v_artifact.id;
  IF v_identity_count <> 1 THEN
    RETURN QUERY SELECT FALSE, 'artifact_email_identity_mismatch', v_artifact.id, v_target_email;
    RETURN;
  END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = $1 AND provider <> ''email'')'
    INTO v_has_rows
    USING v_artifact.id;
  IF v_has_rows THEN
    RETURN QUERY SELECT FALSE, 'artifact_has_other_identity', v_artifact.id, v_target_email;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = v_artifact.id) THEN
    RETURN QUERY SELECT FALSE, 'artifact_has_auth_session', v_artifact.id, v_target_email;
    RETURN;
  END IF;

  v_source_created_at := v_source.created_at;
  v_artifact_created_at := v_artifact.created_at;
  IF v_artifact_created_at < TIMESTAMPTZ '2026-06-03 15:11:31+00'
    OR v_artifact_created_at > TIMESTAMPTZ '2026-07-24 10:11:41+00'
    OR v_source_created_at IS NULL
    OR v_source_created_at > v_artifact_created_at
    OR v_artifact_created_at - v_source_created_at > INTERVAL '30 minutes' THEN
    RETURN QUERY SELECT FALSE, 'target_outside_legacy_incident', v_artifact.id, v_target_email;
    RETURN;
  END IF;

  IF v_artifact.confirmation_sent_at IS NULL
    OR ABS(EXTRACT(EPOCH FROM (v_artifact.confirmation_sent_at - v_artifact_created_at))) > 5
    OR v_artifact.last_sign_in_at IS NOT NULL
    OR v_artifact.recovery_sent_at IS NOT NULL
    OR v_artifact.updated_at < v_artifact_created_at - INTERVAL '5 seconds'
    OR v_artifact.updated_at > v_artifact_created_at + INTERVAL '30 minutes' THEN
    RETURN QUERY SELECT FALSE, 'artifact_activity_mismatch', v_artifact.id, v_target_email;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.account_email_ownerships AS ownership
    WHERE ownership.normalized_email = v_target_email
      AND ownership.user_id = v_artifact.id
  ) THEN
    RETURN QUERY SELECT FALSE, 'artifact_email_ownership_mismatch', v_artifact.id, v_target_email;
    RETURN;
  END IF;

  IF TO_REGCLASS('auth.mfa_factors') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM auth.mfa_factors WHERE user_id = $1)'
      INTO v_has_rows
      USING v_artifact.id;
    IF v_has_rows THEN
      RETURN QUERY SELECT FALSE, 'artifact_has_mfa', v_artifact.id, v_target_email;
      RETURN;
    END IF;
  END IF;

  -- Check every current public/storage FK that directly references a user or
  -- profile. This automatically includes future owned tables. The ownership
  -- row and this private intent ledger are the only expected references.
  FOR v_reference IN
    SELECT
      namespace.nspname AS schema_name,
      relation.relname AS table_name,
      attribute.attname AS column_name
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = relation.oid
      AND attribute.attnum = constraint_row.conkey[1]
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confrelid IN ('auth.users'::REGCLASS, 'public.profiles'::REGCLASS)
      AND ARRAY_LENGTH(constraint_row.conkey, 1) = 1
      AND ARRAY_LENGTH(constraint_row.confkey, 1) = 1
      AND namespace.nspname IN ('public', 'storage')
      AND NOT (
        namespace.nspname = 'public'
        AND relation.relname IN (
          'account_email_ownerships',
          'account_email_merge_intents',
          'account_email_artifact_merge_approvals'
        )
      )
  LOOP
    EXECUTE FORMAT(
      'SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I = $1)',
      v_reference.schema_name,
      v_reference.table_name,
      v_reference.column_name
    )
    INTO v_has_rows
    USING v_artifact.id;

    IF v_has_rows THEN
      RETURN QUERY SELECT
        FALSE,
        'artifact_has_site_data:' || v_reference.schema_name || '.' || v_reference.table_name,
        v_artifact.id,
        v_target_email;
      RETURN;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM public.mail_delivery_events AS event
    WHERE event.event_type = 'email_verification_accepted'
      AND event.created_at BETWEEN v_artifact_created_at - INTERVAL '5 seconds'
        AND v_artifact_created_at + INTERVAL '5 seconds'
      AND event.event_payload_redacted_json ->> 'action' = 'resend_verification'
      AND event.event_payload_redacted_json ->> 'relatedEntityId' = 'resend_verification'
      AND event.event_payload_redacted_json ->> 'verificationMode' = 'auth_magiclink'
      AND LOWER(COALESCE(event.event_payload_redacted_json ->> 'recipientDomain', ''))
        = SPLIT_PART(v_target_email, '@', 2)
      AND event.event_payload_redacted_json ->> 'recipientRedacted' = (
        CASE
          WHEN LENGTH(SPLIT_PART(v_target_email, '@', 1)) <= 2
            THEN LEFT(SPLIT_PART(v_target_email, '@', 1), 1) || '*'
          ELSE LEFT(SPLIT_PART(v_target_email, '@', 1), 1) || '***'
            || RIGHT(SPLIT_PART(v_target_email, '@', 1), 1)
        END
        || '@'
        || CASE
          WHEN LENGTH(SPLIT_PART(SPLIT_PART(v_target_email, '@', 2), '.', 1)) <= 2
            THEN LEFT(SPLIT_PART(SPLIT_PART(v_target_email, '@', 2), '.', 1), 1) || '*'
          ELSE LEFT(SPLIT_PART(SPLIT_PART(v_target_email, '@', 2), '.', 1), 1) || '***'
            || RIGHT(SPLIT_PART(SPLIT_PART(v_target_email, '@', 2), '.', 1), 1)
        END
        || CASE
          WHEN STRPOS(SPLIT_PART(v_target_email, '@', 2), '.') > 0
            THEN SUBSTRING(SPLIT_PART(v_target_email, '@', 2) FROM STRPOS(SPLIT_PART(v_target_email, '@', 2), '.'))
          ELSE ''
        END
      )
  ) THEN
    RETURN QUERY SELECT FALSE, 'legacy_verification_evidence_missing', v_artifact.id, v_target_email;
    RETURN;
  END IF;

  IF p_require_approval IS TRUE AND NOT EXISTS (
    SELECT 1
    FROM public.account_email_artifact_merge_approvals AS approval
    WHERE approval.artifact_user_id = v_artifact.id
      AND approval.target_email_hash = ENCODE(DIGEST(v_target_email, 'sha256'), 'hex')
      AND approval.evidence_version = 'legacy_magiclink_v1'
      AND approval.revoked_at IS NULL
      AND approval.expires_at > NOW()
  ) THEN
    RETURN QUERY SELECT FALSE, 'artifact_operator_approval_required', v_artifact.id, v_target_email;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, 'legacy_email_artifact', v_artifact.id, v_target_email;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_oauth_email_artifact_merge(
  p_intent_id UUID,
  p_source_user_id UUID,
  p_started_session_id UUID,
  p_target_email TEXT,
  p_verification_code_hash TEXT,
  p_expires_at TIMESTAMPTZ
)
RETURNS SETOF public.account_email_merge_intents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_inspection RECORD;
  v_profile_email TEXT;
  v_security public.account_security_states%ROWTYPE;
  v_intent public.account_email_merge_intents%ROWTYPE;
  v_budget public.account_email_merge_budgets%ROWTYPE;
BEGIN
  IF p_intent_id IS NULL
    OR p_source_user_id IS NULL
    OR p_started_session_id IS NULL
    OR NULLIF(BTRIM(p_verification_code_hash), '') IS NULL
    OR p_expires_at <= NOW()
    OR p_expires_at > NOW() + INTERVAL '20 minutes' THEN
    RAISE EXCEPTION 'invalid_email_merge_intent'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.app_sessions AS session_row
    WHERE session_row.id = p_started_session_id
      AND session_row.user_id = p_source_user_id
      AND session_row.revoked_at IS NULL
      AND session_row.expires_at > NOW()
      AND session_row.absolute_expires_at > NOW()
  ) THEN
    RAISE EXCEPTION 'oauth_email_merge_site_session_required'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_inspection
  FROM public.inspect_oauth_email_artifact_merge(p_source_user_id, p_target_email);

  IF v_inspection.eligible IS NOT TRUE OR v_inspection.artifact_user_id IS NULL THEN
    RAISE EXCEPTION 'oauth_email_merge_not_available:%', COALESCE(v_inspection.reason, 'unknown')
      USING ERRCODE = 'P0001';
  END IF;

  SELECT email INTO v_profile_email
  FROM public.profiles
  WHERE id = p_source_user_id;

  SELECT * INTO v_security
  FROM public.account_security_states
  WHERE user_id = p_source_user_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.account_email_merge_intents
    WHERE source_user_id = p_source_user_id
      AND status IN ('claimed', 'ownership_transferred', 'coordination_required')
  ) THEN
    RAISE EXCEPTION 'oauth_email_merge_coordination_required'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.account_email_merge_budgets (
    source_user_id,
    target_email,
    window_started_at,
    send_count,
    failure_count,
    updated_at
  )
  VALUES (
    p_source_user_id,
    v_inspection.target_email,
    NOW(),
    0,
    0,
    NOW()
  )
  ON CONFLICT (source_user_id, target_email) DO NOTHING;

  SELECT * INTO v_budget
  FROM public.account_email_merge_budgets
  WHERE source_user_id = p_source_user_id
    AND target_email = v_inspection.target_email
  FOR UPDATE;

  IF v_budget.window_started_at <= NOW() - INTERVAL '24 hours' THEN
    UPDATE public.account_email_merge_budgets
    SET
      window_started_at = NOW(),
      send_count = 0,
      failure_count = 0,
      locked_until = NULL,
      updated_at = NOW()
    WHERE source_user_id = p_source_user_id
      AND target_email = v_inspection.target_email
    RETURNING * INTO v_budget;
  END IF;

  IF v_budget.locked_until > NOW()
    OR v_budget.send_count >= 5
    OR v_budget.failure_count >= 8 THEN
    RAISE EXCEPTION 'oauth_email_merge_rate_limited'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.account_email_merge_budgets
  SET send_count = send_count + 1, updated_at = NOW()
  WHERE source_user_id = p_source_user_id
    AND target_email = v_inspection.target_email;

  UPDATE public.account_email_merge_intents
  SET status = 'cancelled', last_error_code = 'superseded'
  WHERE source_user_id = p_source_user_id
    AND status IN ('pending', 'verified');

  DELETE FROM public.account_email_merge_intents
  WHERE status IN ('completed', 'cancelled', 'expired')
    AND created_at < NOW() - INTERVAL '30 days';

  INSERT INTO public.account_email_merge_intents (
    id,
    source_user_id,
    artifact_user_id,
    target_email,
    quarantine_email,
    verification_code_hash,
    status,
    source_profile_email_before,
    source_email_required_before,
    source_email_verified_at_before,
    source_email_target_before,
    source_email_reason_before,
    source_email_token_hash_before,
    source_email_token_expires_before,
    source_email_code_hash_before,
    source_email_code_expires_before,
    source_security_updated_at_before,
    started_session_id,
    expires_at,
    metadata_redacted_json
  )
  VALUES (
    p_intent_id,
    p_source_user_id,
    v_inspection.artifact_user_id,
    v_inspection.target_email,
    'legacy.merge.' || REPLACE(v_inspection.artifact_user_id::TEXT, '-', '') || '@oauth.local.invalid',
    p_verification_code_hash,
    'pending',
    v_profile_email,
    v_security.email_verification_required,
    v_security.email_verification_verified_at,
    v_security.email_verification_target_email,
    v_security.email_verification_reason,
    v_security.email_verification_token_hash,
    v_security.email_verification_token_expires_at,
    v_security.email_verification_code_hash,
    v_security.email_verification_code_expires_at,
    v_security.updated_at,
    p_started_session_id,
    p_expires_at,
    JSONB_BUILD_OBJECT('merge_kind', 'legacy_email_artifact_reclaim')
  )
  RETURNING * INTO v_intent;

  RETURN NEXT v_intent;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_oauth_email_artifact_merge(
  p_intent_id UUID,
  p_source_user_id UUID,
  p_verification_code_hash TEXT
)
RETURNS SETOF public.account_email_merge_intents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_intent public.account_email_merge_intents%ROWTYPE;
BEGIN
  SELECT * INTO v_intent
  FROM public.account_email_merge_intents
  WHERE id = p_intent_id
    AND source_user_id = p_source_user_id;

  IF v_intent.id IS NULL THEN
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-email-user:' || v_intent.source_user_id::TEXT, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('account-email-value:' || v_intent.target_email, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('account-email-user:' || v_intent.artifact_user_id::TEXT, 0));

  SELECT * INTO v_intent
  FROM public.account_email_merge_intents
  WHERE id = p_intent_id
    AND source_user_id = p_source_user_id
  FOR UPDATE;
  IF v_intent.status IN ('verified', 'completed') THEN
    RETURN NEXT v_intent;
    RETURN;
  END IF;
  IF v_intent.status <> 'pending' THEN
    RETURN;
  END IF;
  IF v_intent.verification_attempt_count >= 8 THEN
    UPDATE public.account_email_merge_intents
    SET status = 'cancelled', last_error_code = 'verification_attempts_exceeded'
    WHERE id = v_intent.id;
    RETURN;
  END IF;
  IF v_intent.expires_at <= NOW() THEN
    UPDATE public.account_email_merge_intents
    SET status = 'expired', last_error_code = 'verification_expired'
    WHERE id = v_intent.id;
    RETURN;
  END IF;
  IF v_intent.verification_code_hash IS DISTINCT FROM p_verification_code_hash THEN
    UPDATE public.account_email_merge_intents
    SET
      verification_attempt_count = verification_attempt_count + 1,
      status = CASE
        WHEN verification_attempt_count + 1 >= 8 THEN 'cancelled'
        ELSE status
      END,
      last_error_code = CASE
        WHEN verification_attempt_count + 1 >= 8 THEN 'verification_attempts_exceeded'
        ELSE 'verification_code_invalid'
      END
    WHERE id = v_intent.id
      AND status = 'pending';
    UPDATE public.account_email_merge_budgets
    SET
      failure_count = LEAST(8, failure_count + 1),
      locked_until = CASE
        WHEN failure_count + 1 >= 8 THEN GREATEST(
          COALESCE(locked_until, NOW()),
          NOW() + INTERVAL '24 hours'
        )
        ELSE locked_until
      END,
      updated_at = NOW()
    WHERE source_user_id = v_intent.source_user_id
      AND target_email = v_intent.target_email;
    RETURN;
  END IF;

  UPDATE public.account_email_merge_intents
  SET status = 'verified', verified_at = NOW(), last_error_code = NULL
  WHERE id = v_intent.id
    AND status = 'pending'
  RETURNING * INTO v_intent;

  IF v_intent.id IS NOT NULL THEN
    RETURN NEXT v_intent;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_oauth_email_artifact_merge(
  p_intent_id UUID,
  p_source_user_id UUID,
  p_current_session_id UUID
)
RETURNS SETOF public.account_email_merge_intents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_intent public.account_email_merge_intents%ROWTYPE;
  v_inspection RECORD;
  v_security public.account_security_states%ROWTYPE;
BEGIN
  SELECT * INTO v_intent
  FROM public.account_email_merge_intents
  WHERE id = p_intent_id
    AND source_user_id = p_source_user_id;

  IF v_intent.id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('account-email-user:' || v_intent.source_user_id::TEXT, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('account-email-value:' || v_intent.target_email, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('account-email-user:' || v_intent.artifact_user_id::TEXT, 0));

  SELECT * INTO v_intent
  FROM public.account_email_merge_intents
  WHERE id = p_intent_id
    AND source_user_id = p_source_user_id
  FOR UPDATE;

  IF v_intent.status IN ('claimed', 'ownership_transferred', 'completed')
    AND v_intent.started_session_id = p_current_session_id THEN
    RETURN NEXT v_intent;
    RETURN;
  END IF;
  IF v_intent.status <> 'verified'
    OR v_intent.expires_at <= NOW()
    OR v_intent.started_session_id IS DISTINCT FROM p_current_session_id
    OR NOT EXISTS (
      SELECT 1
      FROM public.app_sessions AS session_row
      WHERE session_row.id = p_current_session_id
        AND session_row.user_id = p_source_user_id
        AND session_row.revoked_at IS NULL
        AND session_row.expires_at > NOW()
        AND session_row.absolute_expires_at > NOW()
    ) THEN
    RETURN;
  END IF;

  SELECT * INTO v_inspection
  FROM public.inspect_oauth_email_artifact_merge(
    v_intent.source_user_id,
    v_intent.target_email,
    TRUE
  );
  IF v_inspection.eligible IS NOT TRUE
    OR v_inspection.artifact_user_id IS DISTINCT FROM v_intent.artifact_user_id THEN
    RAISE EXCEPTION 'oauth_email_merge_candidate_changed:%', COALESCE(v_inspection.reason, 'unknown')
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_security
  FROM public.account_security_states
  WHERE user_id = v_intent.source_user_id
  FOR UPDATE;

  UPDATE public.account_email_merge_intents
  SET
    status = 'claimed',
    claimed_at = NOW(),
    source_profile_email_before = (
      SELECT profile.email FROM public.profiles AS profile
      WHERE profile.id = v_intent.source_user_id
    ),
    source_email_required_before = v_security.email_verification_required,
    source_email_verified_at_before = v_security.email_verification_verified_at,
    source_email_target_before = v_security.email_verification_target_email,
    source_email_reason_before = v_security.email_verification_reason,
    source_email_token_hash_before = v_security.email_verification_token_hash,
    source_email_token_expires_before = v_security.email_verification_token_expires_at,
    source_email_code_hash_before = v_security.email_verification_code_hash,
    source_email_code_expires_before = v_security.email_verification_code_expires_at,
    source_security_updated_at_before = v_security.updated_at,
    last_error_code = NULL
  WHERE id = v_intent.id
    AND status = 'verified'
  RETURNING * INTO v_intent;

  IF v_intent.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.app_sessions
  SET
    revoked_at = NOW(),
    revoke_reason = 'oauth_email_artifact_merge'
  WHERE user_id = v_intent.source_user_id
    AND id <> v_intent.started_session_id
    AND revoked_at IS NULL;

  UPDATE public.app_sessions
  SET expires_at = LEAST(expires_at, NOW() + INTERVAL '10 minutes')
  WHERE id = v_intent.started_session_id
    AND user_id = v_intent.source_user_id
    AND revoked_at IS NULL;

  PERFORM public.revoke_all_app_sessions_for_user(
    v_intent.artifact_user_id,
    'oauth_email_artifact_quarantined',
    NOW()
  );
  DELETE FROM auth.sessions
  WHERE user_id IN (v_intent.source_user_id, v_intent.artifact_user_id);

  RETURN NEXT v_intent;
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_oauth_email_artifact_ownership_transfer(
  p_intent_id UUID,
  p_source_user_id UUID
)
RETURNS SETOF public.account_email_merge_intents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_intent public.account_email_merge_intents%ROWTYPE;
  v_artifact auth.users%ROWTYPE;
BEGIN
  SELECT * INTO v_intent
  FROM public.account_email_merge_intents
  WHERE id = p_intent_id
    AND source_user_id = p_source_user_id;

  IF v_intent.id IS NULL THEN
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-email-user:' || v_intent.source_user_id::TEXT, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('account-email-value:' || v_intent.target_email, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('account-email-user:' || v_intent.artifact_user_id::TEXT, 0));

  SELECT * INTO v_intent
  FROM public.account_email_merge_intents
  WHERE id = p_intent_id
    AND source_user_id = p_source_user_id
  FOR UPDATE;

  IF v_intent.status = 'ownership_transferred' THEN
    RETURN NEXT v_intent;
    RETURN;
  END IF;
  IF v_intent.status <> 'claimed' OR v_intent.expires_at <= NOW() THEN
    RETURN;
  END IF;

  SELECT * INTO v_artifact
  FROM auth.users
  WHERE id = v_intent.artifact_user_id
  FOR UPDATE;

  IF public.normalize_account_email(v_artifact.email) <> v_intent.quarantine_email
    OR v_artifact.raw_user_meta_data ->> 'oauth_email_merge_intent_id' <> v_intent.id::TEXT THEN
    RAISE EXCEPTION 'oauth_email_artifact_not_quarantined'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.account_email_ownerships
  SET
    user_id = v_intent.source_user_id,
    verified_at = COALESCE(v_intent.verified_at, NOW()),
    source = 'legacy_email_artifact_merge',
    updated_at = NOW()
  WHERE normalized_email = v_intent.target_email
    AND user_id = v_intent.artifact_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'oauth_email_artifact_ownership_changed'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.profiles
  SET email = v_intent.target_email, updated_at = NOW()
  WHERE id = v_intent.source_user_id
    AND email IS NOT DISTINCT FROM v_intent.source_profile_email_before;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'oauth_email_merge_source_profile_changed'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.account_security_states
  SET
    email_verification_required = FALSE,
    email_verification_reason = NULL,
    email_verification_verified_at = COALESCE(v_intent.verified_at, NOW()),
    email_verification_target_email = v_intent.target_email,
    email_verification_token_hash = NULL,
    email_verification_token_expires_at = NULL,
    email_verification_code_hash = NULL,
    email_verification_code_expires_at = NULL,
    updated_at = NOW()
  WHERE user_id = v_intent.source_user_id
    AND updated_at IS NOT DISTINCT FROM v_intent.source_security_updated_at_before;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'oauth_email_merge_source_security_state_changed'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.account_email_merge_intents
  SET
    status = 'ownership_transferred',
    ownership_transferred_at = NOW(),
    last_error_code = NULL
  WHERE id = v_intent.id
  RETURNING * INTO v_intent;

  RETURN NEXT v_intent;
END;
$$;

CREATE OR REPLACE FUNCTION public.rollback_oauth_email_artifact_ownership_transfer(
  p_intent_id UUID,
  p_source_user_id UUID,
  p_error_code TEXT DEFAULT NULL
)
RETURNS SETOF public.account_email_merge_intents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_intent public.account_email_merge_intents%ROWTYPE;
  v_source auth.users%ROWTYPE;
BEGIN
  SELECT * INTO v_intent
  FROM public.account_email_merge_intents
  WHERE id = p_intent_id
    AND source_user_id = p_source_user_id
  FOR UPDATE;

  IF v_intent.id IS NULL OR v_intent.status <> 'ownership_transferred' THEN
    RETURN;
  END IF;

  SELECT * INTO v_source
  FROM auth.users
  WHERE id = v_intent.source_user_id
  FOR UPDATE;

  IF public.normalize_account_email(v_source.email) NOT LIKE '%@oauth.local.invalid' THEN
    RAISE EXCEPTION 'oauth_email_merge_source_already_bound'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.account_email_ownerships
  SET
    user_id = v_intent.artifact_user_id,
    source = 'auth_confirmed_backfill',
    updated_at = NOW()
  WHERE normalized_email = v_intent.target_email
    AND user_id = v_intent.source_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'oauth_email_merge_rollback_ownership_changed'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.profiles
  SET email = v_intent.source_profile_email_before, updated_at = NOW()
  WHERE id = v_intent.source_user_id;

  UPDATE public.account_security_states
  SET
    email_verification_required = v_intent.source_email_required_before,
    email_verification_reason = v_intent.source_email_reason_before,
    email_verification_verified_at = v_intent.source_email_verified_at_before,
    email_verification_target_email = v_intent.source_email_target_before,
    email_verification_token_hash = v_intent.source_email_token_hash_before,
    email_verification_token_expires_at = v_intent.source_email_token_expires_before,
    email_verification_code_hash = v_intent.source_email_code_hash_before,
    email_verification_code_expires_at = v_intent.source_email_code_expires_before,
    updated_at = NOW()
  WHERE user_id = v_intent.source_user_id;

  UPDATE public.account_email_merge_intents
  SET
    status = 'verified',
    ownership_transferred_at = NULL,
    last_error_code = COALESCE(NULLIF(BTRIM(p_error_code), ''), 'source_auth_update_failed')
  WHERE id = v_intent.id
  RETURNING * INTO v_intent;

  RETURN NEXT v_intent;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_oauth_email_artifact_merge_claim(
  p_intent_id UUID,
  p_source_user_id UUID,
  p_error_code TEXT
)
RETURNS SETOF public.account_email_merge_intents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_intent public.account_email_merge_intents%ROWTYPE;
BEGIN
  SELECT * INTO v_intent
  FROM public.account_email_merge_intents
  WHERE id = p_intent_id
    AND source_user_id = p_source_user_id;
  IF v_intent.id IS NULL THEN RETURN; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('account-email-user:' || v_intent.source_user_id::TEXT, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('account-email-value:' || v_intent.target_email, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('account-email-user:' || v_intent.artifact_user_id::TEXT, 0));

  UPDATE public.account_email_merge_intents
  SET
    status = 'verified',
    claimed_at = NULL,
    last_error_code = COALESCE(NULLIF(BTRIM(p_error_code), ''), 'claim_released')
  WHERE id = v_intent.id
    AND source_user_id = p_source_user_id
    AND status = 'claimed'
    AND EXISTS (
      SELECT 1
      FROM auth.users AS source_user
      WHERE source_user.id = p_source_user_id
        AND public.normalize_account_email(source_user.email) LIKE '%@oauth.local.invalid'
    )
  RETURNING * INTO v_intent;

  IF v_intent.id IS NOT NULL THEN RETURN NEXT v_intent; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_oauth_email_artifact_merge_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_intent public.account_email_merge_intents%ROWTYPE;
  v_new_email TEXT := public.normalize_account_email(NEW.email);
BEGIN
  SELECT * INTO v_intent
  FROM public.account_email_merge_intents
  WHERE status IN ('claimed', 'ownership_transferred')
    AND (
      target_email = v_new_email
      OR source_user_id = NEW.id
      OR artifact_user_id = NEW.id
    )
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_intent.id IS NULL THEN RETURN NEW; END IF;
  IF NEW.id NOT IN (v_intent.source_user_id, v_intent.artifact_user_id) THEN
    RAISE EXCEPTION 'oauth_email_merge_target_reserved' USING ERRCODE = '23505';
  END IF;
  IF NEW.id = v_intent.artifact_user_id AND (
    v_new_email <> v_intent.quarantine_email
    OR NEW.raw_user_meta_data ->> 'oauth_email_merge_intent_id' <> v_intent.id::TEXT
  ) THEN
    RAISE EXCEPTION 'oauth_email_merge_artifact_frozen' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE'
    AND NEW.id = v_intent.source_user_id
    AND v_new_email NOT IN (
      v_intent.target_email,
      public.normalize_account_email(OLD.email)
    ) THEN
    RAISE EXCEPTION 'oauth_email_merge_source_frozen' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_oauth_email_artifact_merge_auth_user ON auth.users;
CREATE TRIGGER protect_oauth_email_artifact_merge_auth_user
  BEFORE INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_oauth_email_artifact_merge_auth_user();

CREATE OR REPLACE FUNCTION public.block_oauth_email_artifact_merge_user_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := NULLIF(TO_JSONB(NEW) ->> TG_ARGV[0], '')::UUID;
  IF v_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.account_email_merge_intents
    WHERE artifact_user_id = v_user_id
      AND status IN ('claimed', 'ownership_transferred')
  ) THEN
    RAISE EXCEPTION 'oauth_email_merge_artifact_frozen' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_reference RECORD;
  v_trigger_name TEXT;
BEGIN
  FOR v_reference IN
    SELECT DISTINCT
      namespace.nspname AS schema_name,
      relation.relname AS table_name,
      attribute.attname AS column_name
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = relation.oid
      AND attribute.attnum = constraint_row.conkey[1]
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confrelid IN ('auth.users'::REGCLASS, 'public.profiles'::REGCLASS)
      AND ARRAY_LENGTH(constraint_row.conkey, 1) = 1
      AND namespace.nspname IN ('public', 'storage')
      AND relation.relname NOT IN (
        'account_email_ownerships',
        'account_email_merge_intents',
        'account_email_artifact_merge_approvals',
        'account_email_merge_budgets',
        'app_session_revocation_states'
      )
  LOOP
    v_trigger_name := 'block_oauth_merge_artifact_' || SUBSTRING(
      ENCODE(DIGEST(v_reference.schema_name || '.' || v_reference.table_name || '.' || v_reference.column_name, 'sha256'), 'hex')
      FROM 1 FOR 16
    );
    EXECUTE FORMAT('DROP TRIGGER IF EXISTS %I ON %I.%I', v_trigger_name, v_reference.schema_name, v_reference.table_name);
    EXECUTE FORMAT(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.block_oauth_email_artifact_merge_user_reference(%L)',
      v_trigger_name,
      v_reference.schema_name,
      v_reference.table_name,
      v_reference.column_name
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_oauth_email_artifact_merge(
  p_intent_id UUID,
  p_source_user_id UUID
)
RETURNS SETOF public.account_email_merge_intents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_intent public.account_email_merge_intents%ROWTYPE;
  v_source auth.users%ROWTYPE;
  v_artifact auth.users%ROWTYPE;
BEGIN
  SELECT * INTO v_intent
  FROM public.account_email_merge_intents
  WHERE id = p_intent_id
    AND source_user_id = p_source_user_id
  FOR UPDATE;

  IF v_intent.id IS NULL THEN
    RETURN;
  END IF;
  IF v_intent.status = 'completed' THEN
    RETURN NEXT v_intent;
    RETURN;
  END IF;
  IF v_intent.status <> 'ownership_transferred' THEN
    RETURN;
  END IF;

  SELECT * INTO v_source FROM auth.users WHERE id = v_intent.source_user_id FOR UPDATE;
  SELECT * INTO v_artifact FROM auth.users WHERE id = v_intent.artifact_user_id FOR UPDATE;

  IF public.normalize_account_email(v_source.email) <> v_intent.target_email
    OR v_source.email_confirmed_at IS NULL
    OR public.normalize_account_email(v_artifact.email) <> v_intent.quarantine_email
    OR NOT EXISTS (
      SELECT 1
      FROM public.account_email_ownerships AS ownership
      WHERE ownership.normalized_email = v_intent.target_email
        AND ownership.user_id = v_intent.source_user_id
    ) THEN
    RAISE EXCEPTION 'oauth_email_merge_final_state_invalid'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.account_email_merge_intents
  SET status = 'completed', completed_at = NOW(), last_error_code = NULL
  WHERE id = v_intent.id
  RETURNING * INTO v_intent;

  INSERT INTO public.app_auth_audit_events (
    user_id,
    event_type,
    provider,
    outcome,
    metadata
  )
  VALUES (
    v_intent.source_user_id,
    'oauth_email_artifact_merge',
    'github',
    'succeeded',
    JSONB_BUILD_OBJECT(
      'intent_id', v_intent.id,
      'artifact_user_fingerprint', SUBSTRING(ENCODE(DIGEST(v_intent.artifact_user_id::TEXT, 'sha256'), 'hex') FROM 1 FOR 16),
      'merge_kind', 'legacy_email_artifact_reclaim'
    )
  );

  RETURN NEXT v_intent;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_oauth_email_artifact_merge_coordination_required(
  p_intent_id UUID,
  p_source_user_id UUID,
  p_error_code TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
BEGIN
  UPDATE public.account_email_merge_intents
  SET
    status = 'coordination_required',
    last_error_code = COALESCE(NULLIF(BTRIM(p_error_code), ''), 'coordination_required')
  WHERE id = p_intent_id
    AND source_user_id = p_source_user_id
    AND status <> 'completed';
END;
$$;

REVOKE ALL ON FUNCTION public.inspect_oauth_email_artifact_merge(UUID, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_oauth_email_artifact_merge(UUID, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_oauth_email_artifact_merge(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_oauth_email_artifact_merge(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_oauth_email_artifact_ownership_transfer(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rollback_oauth_email_artifact_ownership_transfer(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_oauth_email_artifact_merge_claim(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_oauth_email_artifact_merge(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_oauth_email_artifact_merge_coordination_required(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_oauth_email_artifact_merge_auth_user()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.block_oauth_email_artifact_merge_user_reference()
  FROM PUBLIC, anon, authenticated;

DO $$BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_email_merge_intents TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_email_artifact_merge_approvals TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_email_merge_budgets TO service_role;
    GRANT EXECUTE ON FUNCTION public.inspect_oauth_email_artifact_merge(UUID, TEXT, BOOLEAN) TO service_role;
    GRANT EXECUTE ON FUNCTION public.start_oauth_email_artifact_merge(UUID, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
    GRANT EXECUTE ON FUNCTION public.verify_oauth_email_artifact_merge(UUID, UUID, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.claim_oauth_email_artifact_merge(UUID, UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION public.prepare_oauth_email_artifact_ownership_transfer(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION public.rollback_oauth_email_artifact_ownership_transfer(UUID, UUID, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.release_oauth_email_artifact_merge_claim(UUID, UUID, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.complete_oauth_email_artifact_merge(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION public.mark_oauth_email_artifact_merge_coordination_required(UUID, UUID, TEXT) TO service_role;
  END IF;
END;
$$;
COMMENT ON TABLE public.account_email_merge_intents IS
  'Private, one-time ledger for reclaiming emails blocked by verified empty Auth artifacts from the historical OAuth email flow.';
COMMENT ON FUNCTION public.inspect_oauth_email_artifact_merge(UUID, TEXT, BOOLEAN) IS
  'Fails closed unless the conflicting Auth user matches the historical empty email-artifact shape and owns no site data.';

NOTIFY pgrst, 'reload schema';
