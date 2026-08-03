-- 170: recognize the second exact shape produced by the historical email
-- verification defect: a generated email-only Auth user whose magic links
-- were consumed, leaving placeholder password material and native sessions.
--
-- This remains fail-closed. The consumed variant requires a separate operator
-- evidence version, a bounded and unrefreshed session chain, matching refresh
-- tokens, and an Auth audit trail containing only the known magic-link actions.

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT constraint_row.conname
  INTO v_constraint_name
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.account_email_artifact_merge_approvals'::REGCLASS
    AND constraint_row.contype = 'c'
    AND PG_GET_CONSTRAINTDEF(constraint_row.oid) LIKE '%evidence_version%'
  ORDER BY constraint_row.oid
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE FORMAT(
      'ALTER TABLE public.account_email_artifact_merge_approvals DROP CONSTRAINT %I',
      v_constraint_name
    );
  END IF;
END;
$$;

ALTER TABLE public.account_email_artifact_merge_approvals
  ADD CONSTRAINT account_email_artifact_merge_approval_evidence_check
  CHECK (evidence_version IN ('legacy_magiclink_v1', 'legacy_magiclink_consumed_v2'));

ALTER TABLE public.account_email_artifact_merge_approvals
  ADD COLUMN IF NOT EXISTS source_user_id UUID
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS approval_ticket_id UUID
    REFERENCES public.tickets(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS approved_by UUID
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS evidence_snapshot_hash TEXT;

ALTER TABLE public.account_email_artifact_merge_approvals
  ALTER COLUMN source_user_id SET NOT NULL,
  ALTER COLUMN approval_ticket_id SET NOT NULL,
  ALTER COLUMN approved_by SET NOT NULL,
  ALTER COLUMN evidence_snapshot_hash SET NOT NULL;

ALTER TABLE public.account_email_artifact_merge_approvals
  ADD CONSTRAINT account_email_artifact_merge_approval_reference_hash_check
    CHECK (approval_reference_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT account_email_artifact_merge_evidence_snapshot_hash_check
    CHECK (evidence_snapshot_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT account_email_artifact_merge_approval_max_lifetime_check
    CHECK (expires_at <= approved_at + INTERVAL '30 days');

CREATE OR REPLACE FUNCTION public.oauth_email_artifact_evidence_snapshot_hash(
  p_artifact_user_id UUID,
  p_target_email TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_target_email TEXT := public.normalize_account_email(p_target_email);
  v_snapshot JSONB;
BEGIN
  IF p_artifact_user_id IS NULL OR v_target_email = '' THEN
    RETURN NULL;
  END IF;

  SELECT JSONB_BUILD_OBJECT(
    'artifact', JSONB_BUILD_OBJECT(
      'id', artifact.id,
      'normalized_email', public.normalize_account_email(artifact.email),
      'email_confirmed_at', artifact.email_confirmed_at,
      'encrypted_password_hash', CASE
        WHEN NULLIF(artifact.encrypted_password, '') IS NULL THEN NULL
        ELSE ENCODE(DIGEST(artifact.encrypted_password, 'sha256'), 'hex')
      END,
      'phone', artifact.phone,
      'is_anonymous', artifact.is_anonymous,
      'invited_at', artifact.invited_at,
      'confirmation_sent_at', artifact.confirmation_sent_at,
      'last_sign_in_at', artifact.last_sign_in_at,
      'recovery_sent_at', artifact.recovery_sent_at,
      'created_at', artifact.created_at,
      'updated_at', artifact.updated_at,
      'banned_until', artifact.banned_until,
      'role', artifact.role,
      'raw_app_meta_data', artifact.raw_app_meta_data,
      'raw_user_meta_data', artifact.raw_user_meta_data
    ),
    'identities', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'id', identity.id,
          'provider', identity.provider,
          'identity_data', identity.identity_data
        )
        ORDER BY identity.id
      )
      FROM auth.identities AS identity
      WHERE identity.user_id = artifact.id
    ), '[]'::JSONB),
    'sessions', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'id', native_session.id,
          'created_at', native_session.created_at,
          'updated_at', native_session.updated_at,
          'not_after', native_session.not_after
        )
        ORDER BY native_session.id
      )
      FROM auth.sessions AS native_session
      WHERE native_session.user_id = artifact.id
    ), '[]'::JSONB),
    'refresh_tokens', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'id', refresh_token.id,
          'token_hash', CASE
            WHEN NULLIF(refresh_token.token, '') IS NULL THEN NULL
            ELSE ENCODE(DIGEST(refresh_token.token, 'sha256'), 'hex')
          END,
          'user_id', refresh_token.user_id,
          'revoked', refresh_token.revoked,
          'created_at', refresh_token.created_at,
          'updated_at', refresh_token.updated_at,
          'parent', refresh_token.parent,
          'session_id', refresh_token.session_id
        )
        ORDER BY refresh_token.id
      )
      FROM auth.refresh_tokens AS refresh_token
      WHERE refresh_token.user_id = artifact.id::TEXT
    ), '[]'::JSONB),
    'auth_audit', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'id', audit_entry.id,
          'created_at', audit_entry.created_at,
          'payload', audit_entry.payload::JSONB
        )
        ORDER BY audit_entry.id
      )
      FROM auth.audit_log_entries AS audit_entry
      WHERE audit_entry.payload::JSONB ->> 'actor_id' = artifact.id::TEXT
    ), '[]'::JSONB),
    'mail_evidence', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'id', event.id,
          'created_at', event.created_at,
          'payload', event.event_payload_redacted_json
        )
        ORDER BY event.id
      )
      FROM public.mail_delivery_events AS event
      WHERE event.event_type = 'email_verification_accepted'
        AND event.created_at BETWEEN artifact.created_at - INTERVAL '5 seconds'
          AND artifact.created_at + INTERVAL '5 seconds'
        AND event.event_payload_redacted_json ->> 'action' = 'resend_verification'
        AND event.event_payload_redacted_json ->> 'relatedEntityId' = 'resend_verification'
        AND event.event_payload_redacted_json ->> 'verificationMode' = 'auth_magiclink'
    ), '[]'::JSONB),
    'email_ownership', COALESCE((
      SELECT TO_JSONB(ownership)
      FROM public.account_email_ownerships AS ownership
      WHERE ownership.normalized_email = v_target_email
        AND ownership.user_id = artifact.id
    ), 'null'::JSONB)
  )
  INTO v_snapshot
  FROM auth.users AS artifact
  WHERE artifact.id = p_artifact_user_id
    AND public.normalize_account_email(artifact.email) = v_target_email;

  IF v_snapshot IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN ENCODE(DIGEST(v_snapshot::TEXT, 'sha256'), 'hex');
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_oauth_email_artifact_merge_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_target_email TEXT;
  v_expected_snapshot_hash TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.artifact_user_id IS DISTINCT FROM OLD.artifact_user_id
      OR NEW.source_user_id IS DISTINCT FROM OLD.source_user_id
      OR NEW.approval_ticket_id IS DISTINCT FROM OLD.approval_ticket_id
      OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
      OR NEW.target_email_hash IS DISTINCT FROM OLD.target_email_hash
      OR NEW.evidence_version IS DISTINCT FROM OLD.evidence_version
      OR NEW.approval_reference_hash IS DISTINCT FROM OLD.approval_reference_hash
      OR NEW.evidence_snapshot_hash IS DISTINCT FROM OLD.evidence_snapshot_hash
      OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
      OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
      OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
      RAISE EXCEPTION 'oauth_email_artifact_approval_immutable'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS operator_profile
    WHERE operator_profile.id = NEW.approved_by
      AND operator_profile.role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'oauth_email_artifact_approval_admin_required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tickets AS ticket
    WHERE ticket.id = NEW.approval_ticket_id
      AND ticket.user_id = NEW.source_user_id
  ) THEN
    RAISE EXCEPTION 'oauth_email_artifact_approval_ticket_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.approval_reference_hash IS DISTINCT FROM ENCODE(
    DIGEST('ticket:' || NEW.approval_ticket_id::TEXT, 'sha256'),
    'hex'
  ) THEN
    RAISE EXCEPTION 'oauth_email_artifact_approval_reference_mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT public.normalize_account_email(artifact.email)
  INTO v_target_email
  FROM auth.users AS artifact
  WHERE artifact.id = NEW.artifact_user_id;

  IF v_target_email = ''
    OR NEW.target_email_hash IS DISTINCT FROM ENCODE(DIGEST(v_target_email, 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'oauth_email_artifact_approval_target_mismatch'
      USING ERRCODE = '23514';
  END IF;

  v_expected_snapshot_hash := public.oauth_email_artifact_evidence_snapshot_hash(
    NEW.artifact_user_id,
    v_target_email
  );
  IF NEW.evidence_snapshot_hash IS DISTINCT FROM v_expected_snapshot_hash THEN
    RAISE EXCEPTION 'oauth_email_artifact_approval_snapshot_mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_oauth_email_artifact_merge_approval
  ON public.account_email_artifact_merge_approvals;
CREATE TRIGGER enforce_oauth_email_artifact_merge_approval
  BEFORE INSERT OR UPDATE ON public.account_email_artifact_merge_approvals
  FOR EACH ROW EXECUTE FUNCTION public.enforce_oauth_email_artifact_merge_approval();

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
SET search_path = extensions, public, auth, pg_temp
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
  v_session_count INTEGER := 0;
  v_session_min_created_at TIMESTAMPTZ;
  v_session_max_created_at TIMESTAMPTZ;
  v_session_mutated_count INTEGER := 0;
  v_refresh_token_count INTEGER := 0;
  v_refresh_token_session_count INTEGER := 0;
  v_refresh_token_mismatch_count INTEGER := 0;
  v_audit_signup_count INTEGER := 0;
  v_audit_recovery_count INTEGER := 0;
  v_audit_login_count INTEGER := 0;
  v_audit_other_count INTEGER := 0;
  v_audit_min_created_at TIMESTAMPTZ;
  v_audit_max_created_at TIMESTAMPTZ;
  v_audit_last_recovery_at TIMESTAMPTZ;
  v_is_consumed_magiclink BOOLEAN := FALSE;
  v_required_evidence_version TEXT := 'legacy_magiclink_v1';
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

  IF NULLIF(v_artifact.phone, '') IS NOT NULL
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

  SELECT
    COUNT(*),
    MIN(session_row.created_at),
    MAX(session_row.created_at),
    COUNT(*) FILTER (
      WHERE session_row.updated_at IS DISTINCT FROM session_row.created_at
    )
  INTO
    v_session_count,
    v_session_min_created_at,
    v_session_max_created_at,
    v_session_mutated_count
  FROM auth.sessions AS session_row
  WHERE session_row.user_id = v_artifact.id;

  v_is_consumed_magiclink := NULLIF(v_artifact.encrypted_password, '') IS NOT NULL;
  IF v_is_consumed_magiclink IS FALSE THEN
    IF v_session_count <> 0 THEN
      RETURN QUERY SELECT FALSE, 'artifact_has_auth_session', v_artifact.id, v_target_email;
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
  ELSE
    v_required_evidence_version := 'legacy_magiclink_consumed_v2';

    IF v_artifact.encrypted_password !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'
      OR LOWER(COALESCE(v_artifact.raw_user_meta_data ->> 'email_verified', 'false')) <> 'true'
      OR TO_REGCLASS('auth.audit_log_entries') IS NULL
      OR TO_REGCLASS('auth.refresh_tokens') IS NULL THEN
      RETURN QUERY SELECT FALSE, 'artifact_consumed_auth_shape_mismatch', v_artifact.id, v_target_email;
      RETURN;
    END IF;

    IF v_session_count NOT BETWEEN 1 AND 5
      OR v_session_mutated_count <> 0
      OR v_session_min_created_at < v_artifact_created_at
      OR v_session_max_created_at > TIMESTAMPTZ '2026-07-24 10:11:41+00'
      OR ABS(EXTRACT(EPOCH FROM (v_artifact.email_confirmed_at - v_session_min_created_at))) > 5
      OR v_artifact.last_sign_in_at IS NULL
      OR ABS(EXTRACT(EPOCH FROM (v_artifact.last_sign_in_at - v_session_max_created_at))) > 5
      OR ABS(EXTRACT(EPOCH FROM (v_artifact.updated_at - v_session_max_created_at))) > 5
      OR v_artifact.confirmation_sent_at IS NULL
      OR ABS(EXTRACT(EPOCH FROM (v_artifact.confirmation_sent_at - v_artifact_created_at))) > 5 THEN
      RETURN QUERY SELECT FALSE, 'artifact_consumed_session_mismatch', v_artifact.id, v_target_email;
      RETURN;
    END IF;

    SELECT
      COUNT(*),
      COUNT(DISTINCT refresh_token.session_id),
      COUNT(*) FILTER (
        WHERE refresh_token.session_id IS NULL
          OR native_session.id IS NULL
          OR NULLIF(refresh_token.token, '') IS NULL
          OR refresh_token.revoked IS NOT FALSE
          OR refresh_token.created_at IS NULL
          OR refresh_token.updated_at IS NULL
          OR refresh_token.parent IS NOT NULL
          OR refresh_token.updated_at IS DISTINCT FROM refresh_token.created_at
          OR ABS(EXTRACT(EPOCH FROM (refresh_token.created_at - native_session.created_at))) > 5
      )
    INTO
      v_refresh_token_count,
      v_refresh_token_session_count,
      v_refresh_token_mismatch_count
    FROM auth.refresh_tokens AS refresh_token
    LEFT JOIN auth.sessions AS native_session
      ON native_session.id = refresh_token.session_id
      AND native_session.user_id = v_artifact.id
    WHERE refresh_token.user_id = v_artifact.id::TEXT;

    IF v_refresh_token_count <> v_session_count
      OR v_refresh_token_session_count <> v_session_count
      OR v_refresh_token_mismatch_count <> 0 THEN
      RETURN QUERY SELECT FALSE, 'artifact_consumed_refresh_token_mismatch', v_artifact.id, v_target_email;
      RETURN;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM auth.sessions AS native_session
      WHERE native_session.user_id = v_artifact.id
        AND 1 <> (
          SELECT COUNT(*)
          FROM auth.refresh_tokens AS refresh_token
          WHERE refresh_token.user_id = v_artifact.id::TEXT
            AND refresh_token.session_id = native_session.id
        )
    ) THEN
      RETURN QUERY SELECT FALSE, 'artifact_consumed_refresh_token_mismatch', v_artifact.id, v_target_email;
      RETURN;
    END IF;

    SELECT
      COUNT(*) FILTER (
        WHERE audit_entry.payload::JSONB ->> 'action' = 'user_signedup'
          AND LOWER(COALESCE(audit_entry.payload::JSONB #>> '{traits,provider}', '')) = 'email'
      ),
      COUNT(*) FILTER (
        WHERE audit_entry.payload::JSONB ->> 'action' = 'user_recovery_requested'
      ),
      COUNT(*) FILTER (
        WHERE audit_entry.payload::JSONB ->> 'action' = 'login'
      ),
      COUNT(*) FILTER (
        WHERE COALESCE(audit_entry.payload::JSONB ->> 'action', '') NOT IN (
          'user_signedup',
          'user_recovery_requested',
          'login'
        )
      ),
      MIN(audit_entry.created_at),
      MAX(audit_entry.created_at),
      MAX(audit_entry.created_at) FILTER (
        WHERE audit_entry.payload::JSONB ->> 'action' = 'user_recovery_requested'
      )
    INTO
      v_audit_signup_count,
      v_audit_recovery_count,
      v_audit_login_count,
      v_audit_other_count,
      v_audit_min_created_at,
      v_audit_max_created_at,
      v_audit_last_recovery_at
    FROM auth.audit_log_entries AS audit_entry
    WHERE audit_entry.payload::JSONB ->> 'actor_id' = v_artifact.id::TEXT;

    IF v_audit_signup_count <> 1
      OR v_audit_recovery_count <> v_audit_login_count
      OR v_audit_login_count <> v_session_count - 1
      OR v_audit_other_count <> 0
      OR ABS(EXTRACT(EPOCH FROM (v_audit_min_created_at - v_session_min_created_at))) > 5
      OR ABS(EXTRACT(EPOCH FROM (v_audit_max_created_at - v_session_max_created_at))) > 5
      OR (v_audit_login_count > 0 AND (
        v_artifact.recovery_sent_at IS NULL
        OR ABS(EXTRACT(EPOCH FROM (v_artifact.recovery_sent_at - v_audit_last_recovery_at))) > 5
      ))
      OR EXISTS (
        SELECT 1
        FROM auth.sessions AS native_session
        WHERE native_session.user_id = v_artifact.id
          AND NOT EXISTS (
            SELECT 1
            FROM auth.audit_log_entries AS audit_entry
            WHERE audit_entry.payload::JSONB ->> 'actor_id' = v_artifact.id::TEXT
              AND audit_entry.payload::JSONB ->> 'action' IN ('user_signedup', 'login')
              AND ABS(EXTRACT(EPOCH FROM (audit_entry.created_at - native_session.created_at))) <= 5
          )
      )
      OR EXISTS (
        SELECT 1
        FROM auth.audit_log_entries AS login_entry
        WHERE login_entry.payload::JSONB ->> 'actor_id' = v_artifact.id::TEXT
          AND login_entry.payload::JSONB ->> 'action' = 'login'
          AND NOT EXISTS (
            SELECT 1
            FROM auth.audit_log_entries AS recovery_entry
            WHERE recovery_entry.payload::JSONB ->> 'actor_id' = v_artifact.id::TEXT
              AND recovery_entry.payload::JSONB ->> 'action' = 'user_recovery_requested'
              AND recovery_entry.created_at BETWEEN login_entry.created_at - INTERVAL '15 minutes'
                AND login_entry.created_at
          )
      )
      OR EXISTS (
        SELECT 1
        FROM auth.audit_log_entries AS recovery_entry
        WHERE recovery_entry.payload::JSONB ->> 'actor_id' = v_artifact.id::TEXT
          AND recovery_entry.payload::JSONB ->> 'action' = 'user_recovery_requested'
          AND NOT EXISTS (
            SELECT 1
            FROM auth.audit_log_entries AS login_entry
            WHERE login_entry.payload::JSONB ->> 'actor_id' = v_artifact.id::TEXT
              AND login_entry.payload::JSONB ->> 'action' = 'login'
              AND login_entry.created_at BETWEEN recovery_entry.created_at
                AND recovery_entry.created_at + INTERVAL '15 minutes'
          )
      ) THEN
      RETURN QUERY SELECT FALSE, 'artifact_consumed_audit_mismatch', v_artifact.id, v_target_email;
      RETURN;
    END IF;
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

  IF 1 <> (
    SELECT COUNT(*)
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
      AND approval.source_user_id = p_source_user_id
      AND approval.target_email_hash = ENCODE(DIGEST(v_target_email, 'sha256'), 'hex')
      AND approval.evidence_version = v_required_evidence_version
      AND approval.evidence_snapshot_hash = public.oauth_email_artifact_evidence_snapshot_hash(
        v_artifact.id,
        v_target_email
      )
      AND EXISTS (
        SELECT 1
        FROM public.profiles AS operator_profile
        WHERE operator_profile.id = approval.approved_by
          AND operator_profile.role = 'super_admin'
      )
      AND approval.revoked_at IS NULL
      AND approval.expires_at > NOW()
  ) THEN
    RETURN QUERY SELECT FALSE, 'artifact_operator_approval_required', v_artifact.id, v_target_email;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, CASE
    WHEN v_is_consumed_magiclink THEN 'legacy_email_artifact_magiclink_consumed'
    ELSE 'legacy_email_artifact'
  END, v_artifact.id, v_target_email;
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
SET search_path = extensions, public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_intent public.account_email_merge_intents%ROWTYPE;
  v_inspection RECORD;
  v_approval public.account_email_artifact_merge_approvals%ROWTYPE;
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

  SELECT * INTO v_approval
  FROM public.account_email_artifact_merge_approvals AS approval
  WHERE approval.artifact_user_id = v_intent.artifact_user_id
  FOR UPDATE;

  IF v_approval.artifact_user_id IS NULL THEN
    RAISE EXCEPTION 'oauth_email_merge_candidate_changed:artifact_operator_approval_required'
      USING ERRCODE = 'P0001';
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

  IF TO_REGCLASS('auth.refresh_tokens') IS NOT NULL THEN
    EXECUTE 'DELETE FROM auth.refresh_tokens WHERE user_id = ANY($1)'
      USING ARRAY[v_intent.source_user_id::TEXT, v_intent.artifact_user_id::TEXT];
  END IF;

  DELETE FROM auth.sessions
  WHERE user_id IN (v_intent.source_user_id, v_intent.artifact_user_id);

  RETURN NEXT v_intent;
END;
$$;

ALTER FUNCTION public.complete_oauth_email_artifact_merge(UUID, UUID)
  SET search_path = extensions, public, auth, pg_temp;

REVOKE ALL ON FUNCTION public.oauth_email_artifact_evidence_snapshot_hash(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_oauth_email_artifact_merge_approval()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.inspect_oauth_email_artifact_merge(UUID, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_oauth_email_artifact_merge(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inspect_oauth_email_artifact_merge(UUID, TEXT, BOOLEAN)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_oauth_email_artifact_merge(UUID, UUID, UUID)
  TO service_role;

REVOKE INSERT, UPDATE, DELETE ON public.account_email_artifact_merge_approvals
  FROM service_role;
GRANT SELECT ON public.account_email_artifact_merge_approvals
  TO service_role;

COMMENT ON FUNCTION public.inspect_oauth_email_artifact_merge(UUID, TEXT, BOOLEAN) IS
  'Strictly identifies either an untouched legacy magic-link Auth artifact or the separately approved consumed-magic-link shape.';

NOTIFY pgrst, 'reload schema';
