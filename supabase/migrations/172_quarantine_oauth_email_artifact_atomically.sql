-- 172: quarantine an approved OAuth email artifact inside one database
-- transaction instead of sending a multi-step update through GoTrue Admin.
--
-- GoTrue v2.188.1 confirms the user, updates the email identity, changes the
-- Auth email, writes metadata, and applies the ban as separate SQL updates.
-- The merge freeze trigger correctly rejects those intermediate states. This
-- RPC preserves that freeze and only writes the exact final quarantine state.

CREATE OR REPLACE FUNCTION public.quarantine_oauth_email_artifact_for_merge(
  p_intent_id UUID,
  p_source_user_id UUID
)
RETURNS SETOF public.account_email_merge_intents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_intent public.account_email_merge_intents%ROWTYPE;
  v_approval public.account_email_artifact_merge_approvals%ROWTYPE;
  v_source auth.users%ROWTYPE;
  v_artifact auth.users%ROWTYPE;
  v_identity RECORD;
  v_identity_count INTEGER;
  v_updated_count INTEGER;
  v_artifact_metadata JSONB;
BEGIN
  SELECT * INTO v_intent
  FROM public.account_email_merge_intents
  WHERE id = p_intent_id
    AND source_user_id = p_source_user_id;

  IF v_intent.id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('account-email-user:' || v_intent.source_user_id::TEXT, 0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('account-email-value:' || v_intent.target_email, 0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('account-email-user:' || v_intent.artifact_user_id::TEXT, 0)
  );

  SELECT * INTO v_intent
  FROM public.account_email_merge_intents
  WHERE id = p_intent_id
    AND source_user_id = p_source_user_id
  FOR UPDATE;

  IF v_intent.status NOT IN ('claimed', 'ownership_transferred') THEN
    RETURN;
  END IF;

  SELECT * INTO v_approval
  FROM public.account_email_artifact_merge_approvals AS approval
  WHERE approval.artifact_user_id = v_intent.artifact_user_id
  FOR UPDATE;

  IF v_approval.artifact_user_id IS NULL
    OR v_approval.source_user_id IS DISTINCT FROM v_intent.source_user_id
    OR v_approval.target_email_hash IS DISTINCT FROM ENCODE(
      extensions.DIGEST(v_intent.target_email, 'sha256'),
      'hex'
    )
    OR v_approval.approval_reference_hash IS DISTINCT FROM ENCODE(
      extensions.DIGEST('ticket:' || v_approval.approval_ticket_id::TEXT, 'sha256'),
      'hex'
    )
    OR v_approval.evidence_version NOT IN (
      'legacy_magiclink_v1',
      'legacy_magiclink_consumed_v2'
    )
    OR v_approval.revoked_at IS NOT NULL
    OR v_approval.expires_at <= NOW()
    OR NOT EXISTS (
      SELECT 1
      FROM public.tickets AS ticket
      WHERE ticket.id = v_approval.approval_ticket_id
        AND ticket.user_id = v_intent.source_user_id
    )
    OR NOT EXISTS (
      SELECT 1
      FROM public.profiles AS operator_profile
      WHERE operator_profile.id = v_approval.approved_by
        AND operator_profile.role = 'super_admin'
    ) THEN
    RAISE EXCEPTION 'oauth_email_artifact_quarantine_approval_invalid'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_source
  FROM auth.users
  WHERE id = v_intent.source_user_id
  FOR UPDATE;

  SELECT * INTO v_artifact
  FROM auth.users
  WHERE id = v_intent.artifact_user_id
  FOR UPDATE;

  IF v_source.id IS NULL
    OR v_artifact.id IS NULL
    OR (
      public.normalize_account_email(v_source.email) NOT LIKE '%@oauth.local.invalid'
      AND LOWER(COALESCE(v_source.raw_user_meta_data ->> 'synthetic_oauth_email', 'false')) <> 'true'
    ) THEN
    RAISE EXCEPTION 'oauth_email_artifact_quarantine_source_changed'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_identity_count
  FROM auth.identities AS identity
  WHERE identity.user_id = v_intent.artifact_user_id;

  SELECT * INTO v_identity
  FROM auth.identities AS identity
  WHERE identity.user_id = v_intent.artifact_user_id
  ORDER BY identity.id
  LIMIT 1
  FOR UPDATE;

  IF public.normalize_account_email(v_artifact.email) = v_intent.quarantine_email
    AND v_artifact.raw_user_meta_data ->> 'oauth_email_merge_intent_id' = v_intent.id::TEXT
    AND v_artifact.banned_until > NOW()
    AND v_identity_count = 1
    AND v_identity.provider = 'email'
    AND public.normalize_account_email(v_identity.identity_data ->> 'email') = v_intent.quarantine_email
    AND LOWER(COALESCE(v_identity.identity_data ->> 'email_verified', 'false')) = 'true' THEN
    RETURN NEXT v_intent;
    RETURN;
  END IF;

  IF public.normalize_account_email(v_artifact.email) <> v_intent.target_email
    OR v_artifact.raw_user_meta_data ? 'oauth_email_merge_intent_id'
    OR v_identity_count <> 1
    OR v_identity.provider <> 'email'
    OR public.normalize_account_email(v_identity.identity_data ->> 'email') <> v_intent.target_email
    OR EXISTS (
      SELECT 1
      FROM auth.users AS other_user
      WHERE other_user.id <> v_intent.artifact_user_id
        AND public.normalize_account_email(other_user.email) = v_intent.quarantine_email
    )
    OR NOT EXISTS (
      SELECT 1
      FROM public.account_email_ownerships AS ownership
      WHERE ownership.normalized_email = v_intent.target_email
        AND ownership.user_id = v_intent.artifact_user_id
    ) THEN
    RAISE EXCEPTION 'oauth_email_artifact_quarantine_state_changed'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE auth.identities
  SET
    identity_data = identity_data || JSONB_BUILD_OBJECT(
      'email', v_intent.quarantine_email,
      'email_verified', TRUE
    ),
    updated_at = NOW()
  WHERE id = v_identity.id
    AND user_id = v_intent.artifact_user_id
    AND provider = 'email';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count <> 1 THEN
    RAISE EXCEPTION 'oauth_email_artifact_quarantine_identity_changed'
      USING ERRCODE = 'P0001';
  END IF;

  v_artifact_metadata := COALESCE(v_artifact.raw_user_meta_data, '{}'::JSONB)
    || JSONB_BUILD_OBJECT(
      'legacy_email_action_artifact', TRUE,
      'legacy_email_released_at', NOW(),
      'oauth_email_merge_intent_id', v_intent.id::TEXT
    );

  UPDATE auth.users
  SET
    email = v_intent.quarantine_email,
    raw_user_meta_data = v_artifact_metadata,
    banned_until = NOW() + INTERVAL '100 years',
    updated_at = NOW()
  WHERE id = v_intent.artifact_user_id
    AND public.normalize_account_email(email) = v_intent.target_email
    AND NOT (COALESCE(raw_user_meta_data, '{}'::JSONB) ? 'oauth_email_merge_intent_id');

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count <> 1 THEN
    RAISE EXCEPTION 'oauth_email_artifact_quarantine_user_changed'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEXT v_intent;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_oauth_email_artifact_merge_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_intent public.account_email_merge_intents%ROWTYPE;
BEGIN
  v_user_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.user_id
    ELSE NEW.user_id
  END;

  SELECT * INTO v_intent
  FROM public.account_email_merge_intents
  WHERE artifact_user_id = v_user_id
    AND status IN ('claimed', 'ownership_transferred')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_intent.id IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
    AND NEW.provider = 'email'
    AND OLD.provider = 'email'
    AND public.normalize_account_email(OLD.identity_data ->> 'email') = v_intent.target_email
    AND public.normalize_account_email(NEW.identity_data ->> 'email') = v_intent.quarantine_email
    AND LOWER(COALESCE(NEW.identity_data ->> 'email_verified', 'false')) = 'true'
    AND (
      COALESCE(NEW.identity_data, '{}'::JSONB) - ARRAY['email', 'email_verified']::TEXT[]
    ) IS NOT DISTINCT FROM (
      COALESCE(OLD.identity_data, '{}'::JSONB) - ARRAY['email', 'email_verified']::TEXT[]
    )
    AND (
      TO_JSONB(NEW) - ARRAY['identity_data', 'updated_at', 'email']::TEXT[]
    ) IS NOT DISTINCT FROM (
      TO_JSONB(OLD) - ARRAY['identity_data', 'updated_at', 'email']::TEXT[]
    ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'oauth_email_merge_artifact_identity_frozen'
    USING ERRCODE = '55000';
END;
$$;

DO $$
BEGIN
  IF TO_REGCLASS('auth.identities') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS protect_oauth_email_artifact_merge_identity
      ON auth.identities;
    CREATE TRIGGER protect_oauth_email_artifact_merge_identity
      BEFORE INSERT OR UPDATE OR DELETE ON auth.identities
      FOR EACH ROW EXECUTE FUNCTION public.protect_oauth_email_artifact_merge_identity();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.quarantine_oauth_email_artifact_for_merge(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_oauth_email_artifact_merge_identity()
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.quarantine_oauth_email_artifact_for_merge(UUID, UUID)
      TO service_role;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.quarantine_oauth_email_artifact_for_merge(UUID, UUID) IS
  'Atomically moves a claimed empty Auth artifact and its sole email identity to the intent quarantine address without exposing trigger-unsafe GoTrue intermediate states.';

NOTIFY pgrst, 'reload schema';
