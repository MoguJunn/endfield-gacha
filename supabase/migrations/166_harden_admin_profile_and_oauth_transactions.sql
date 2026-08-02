-- 166: close direct admin RPC and OAuth callback replay / login-CSRF attack surfaces.

-- admin_update_profile is a SECURITY DEFINER function whose actor argument is
-- only trustworthy after the same-origin admin route authenticates the caller.
-- PostgreSQL grants EXECUTE to PUBLIC for new functions by default, so revoke
-- both that implicit grant and the explicit authenticated grant from migration
-- 136. The service-role backend remains the only callable path.
REVOKE ALL ON FUNCTION public.admin_update_profile(UUID, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_update_profile(UUID, TEXT, TEXT, UUID)
      TO service_role;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_app_auth_identity_owner_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'OAuth identity owner is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_app_auth_identity_owner_change()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS before_app_auth_identity_owner_change
  ON public.app_auth_identities;
CREATE TRIGGER before_app_auth_identity_owner_change
  BEFORE UPDATE OF user_id ON public.app_auth_identities
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_app_auth_identity_owner_change();

ALTER TABLE public.app_sessions
  ADD COLUMN IF NOT EXISTS source_auth_session_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_sessions_source_auth_session
  ON public.app_sessions(source_auth_session_id)
  WHERE source_auth_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.app_session_revocation_states (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  revoked_before TIMESTAMPTZ NOT NULL,
  revoke_reason TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_session_revocation_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_session_revocation_states FROM PUBLIC, anon, authenticated;

-- Fresh Supabase projects do not guarantee that objects created by the
-- baseline inherit service-role DML grants. The same-origin auth/admin paths
-- read and update profiles directly, while revocation state remains private.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_session_revocation_states TO service_role;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_all_app_sessions_for_user(
  p_user_id UUID,
  p_reason TEXT,
  p_revoked_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_revoked_count INTEGER := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT, 0));

  INSERT INTO public.app_session_revocation_states (
    user_id,
    revoked_before,
    revoke_reason,
    updated_at
  )
  VALUES (
    p_user_id,
    p_revoked_at,
    COALESCE(NULLIF(BTRIM(p_reason), ''), 'credential_changed'),
    p_revoked_at
  )
  ON CONFLICT (user_id) DO UPDATE SET
    revoked_before = GREATEST(
      public.app_session_revocation_states.revoked_before,
      EXCLUDED.revoked_before
    ),
    revoke_reason = EXCLUDED.revoke_reason,
    updated_at = EXCLUDED.updated_at;

  UPDATE public.app_sessions
  SET
    revoked_at = p_revoked_at,
    revoke_reason = COALESCE(NULLIF(BTRIM(p_reason), ''), 'credential_changed')
  WHERE user_id = p_user_id
    AND revoked_at IS NULL;

  GET DIAGNOSTICS v_revoked_count = ROW_COUNT;
  RETURN v_revoked_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_or_rotate_bearer_app_session(
  p_user_id UUID,
  p_source_auth_session_id UUID,
  p_bearer_issued_at TIMESTAMPTZ,
  p_session_token_hash TEXT,
  p_refresh_token_hash TEXT,
  p_user_agent_hash TEXT,
  p_ip_prefix_hash TEXT,
  p_expires_at TIMESTAMPTZ,
  p_absolute_expires_at TIMESTAMPTZ
)
RETURNS SETOF public.app_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_revoked_before TIMESTAMPTZ;
BEGIN
  IF p_source_auth_session_id IS NULL
    OR p_bearer_issued_at IS NULL
    OR p_expires_at <= NOW()
    OR p_absolute_expires_at <= NOW() THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT, 0));

  SELECT revoked_before
  INTO v_revoked_before
  FROM public.app_session_revocation_states
  WHERE user_id = p_user_id;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.sessions
    WHERE id = p_source_auth_session_id
      AND user_id = p_user_id
      AND (
        v_revoked_before IS NULL
        OR (
          created_at > v_revoked_before
          AND p_bearer_issued_at > v_revoked_before
        )
      )
  ) THEN
    RETURN;
  END IF;

  DELETE FROM public.app_sessions
  WHERE user_id = p_user_id
    AND (
      absolute_expires_at <= NOW()
      OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '7 days')
    );

  RETURN QUERY
  UPDATE public.app_sessions
  SET
    session_token_hash = p_session_token_hash,
    refresh_token_hash = p_refresh_token_hash,
    user_agent_hash = p_user_agent_hash,
    ip_prefix_hash = p_ip_prefix_hash,
    last_seen_at = NOW(),
    expires_at = p_expires_at,
    absolute_expires_at = p_absolute_expires_at
  WHERE user_id = p_user_id
    AND source_auth_session_id = p_source_auth_session_id
    AND revoked_at IS NULL
  RETURNING public.app_sessions.*;

  IF FOUND THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.app_sessions
    WHERE source_auth_session_id = p_source_auth_session_id
  ) THEN
    RETURN;
  END IF;

  UPDATE public.app_sessions
  SET
    revoked_at = NOW(),
    revoke_reason = 'active_session_limit'
  WHERE id IN (
    SELECT id
    FROM public.app_sessions
    WHERE user_id = p_user_id
      AND revoked_at IS NULL
    ORDER BY created_at DESC
    OFFSET 19
  );

  RETURN QUERY
  INSERT INTO public.app_sessions (
    user_id,
    source_auth_session_id,
    session_token_hash,
    refresh_token_hash,
    user_agent_hash,
    ip_prefix_hash,
    last_seen_at,
    expires_at,
    absolute_expires_at
  )
  VALUES (
    p_user_id,
    p_source_auth_session_id,
    p_session_token_hash,
    p_refresh_token_hash,
    p_user_agent_hash,
    p_ip_prefix_hash,
    NOW(),
    p_expires_at,
    p_absolute_expires_at
  )
  RETURNING public.app_sessions.*;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_all_app_sessions_for_user(UUID, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_or_rotate_bearer_app_session(
  UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_bearer_auth_session_allowed(
  p_user_id UUID,
  p_auth_session_id UUID,
  p_bearer_issued_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.sessions AS s
    LEFT JOIN public.app_session_revocation_states AS r
      ON r.user_id = s.user_id
    WHERE s.id = p_auth_session_id
      AND s.user_id = p_user_id
      AND p_bearer_issued_at IS NOT NULL
      AND (
        r.revoked_before IS NULL
        OR (
          s.created_at > r.revoked_before
          AND p_bearer_issued_at > r.revoked_before
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_bearer_auth_session_allowed(UUID, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.revoke_all_app_sessions_for_user(UUID, TEXT, TIMESTAMPTZ)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.create_or_rotate_bearer_app_session(
      UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
    ) TO service_role;
    GRANT EXECUTE ON FUNCTION public.is_bearer_auth_session_allowed(UUID, UUID, TIMESTAMPTZ)
      TO service_role;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.app_oauth_transactions (
  id UUID PRIMARY KEY,
  provider TEXT NOT NULL CHECK (BTRIM(provider) <> ''),
  intent TEXT NOT NULL CHECK (intent IN ('login', 'link')),
  return_to TEXT NOT NULL DEFAULT '/',
  browser_binding_hash TEXT NOT NULL CHECK (BTRIM(browser_binding_hash) <> ''),
  pkce_code_verifier TEXT NOT NULL CHECK (CHAR_LENGTH(pkce_code_verifier) BETWEEN 43 AND 128),
  started_session_id UUID REFERENCES public.app_sessions(id) ON DELETE CASCADE,
  started_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT app_oauth_transactions_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT app_oauth_transactions_link_owner_check CHECK (
    intent = 'login'
    OR (started_session_id IS NOT NULL AND started_user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_app_oauth_transactions_expiry
  ON public.app_oauth_transactions(expires_at);

ALTER TABLE public.app_oauth_transactions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.app_oauth_transactions FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, DELETE ON public.app_oauth_transactions
      TO service_role;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_update_profile(UUID, TEXT, TEXT, UUID) IS
  '仅限 service-role 同源后台代理调用；actor user id 必须来自已验证的超管站点会话。';

COMMENT ON FUNCTION public.prevent_app_auth_identity_owner_change() IS
  'Makes the first successful provider-subject claim permanent; profile refreshes cannot transfer identity ownership.';

CREATE OR REPLACE FUNCTION public.revoke_app_sessions_on_auth_email_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    PERFORM public.revoke_all_app_sessions_for_user(
      NEW.id,
      'auth_email_changed',
      NOW()
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_app_sessions_on_auth_password_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
    PERFORM public.revoke_all_app_sessions_for_user(
      NEW.id,
      'auth_password_changed',
      NOW()
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_app_sessions_on_auth_email_change()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_app_sessions_on_auth_password_change()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_email_revoke_app_sessions ON auth.users;
CREATE TRIGGER on_auth_user_email_revoke_app_sessions
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.revoke_app_sessions_on_auth_email_change();

DROP TRIGGER IF EXISTS on_auth_user_password_revoke_app_sessions ON auth.users;
CREATE TRIGGER on_auth_user_password_revoke_app_sessions
  AFTER UPDATE OF encrypted_password ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.revoke_app_sessions_on_auth_password_change();

COMMENT ON FUNCTION public.revoke_app_sessions_on_auth_email_change() IS
  'Revokes every active site session only after auth.users.email actually changes.';

COMMENT ON FUNCTION public.revoke_app_sessions_on_auth_password_change() IS
  'Revokes every active site session atomically with an actual auth.users password change.';

COMMENT ON FUNCTION public.revoke_all_app_sessions_for_user(UUID, TEXT, TIMESTAMPTZ) IS
  'Atomically advances the user revocation boundary and revokes every active site session.';

COMMENT ON FUNCTION public.create_or_rotate_bearer_app_session(
  UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) IS
  'Creates or rotates one site session per native Auth session only when its Bearer token was issued after the user revocation boundary.';

COMMENT ON FUNCTION public.is_bearer_auth_session_allowed(UUID, UUID, TIMESTAMPTZ) IS
  'Rejects native Bearer tokens from Auth sessions created before the latest site-session revocation boundary.';

COMMENT ON TABLE public.app_oauth_transactions IS
  'Private, short-lived, one-time OAuth transactions bound to the initiating browser and, for link intent, the initiating site session/user.';

COMMENT ON COLUMN public.app_oauth_transactions.browser_binding_hash IS
  'HMAC of the per-transaction HttpOnly browser cookie. The raw browser binding token is never stored.';

COMMENT ON COLUMN public.app_oauth_transactions.pkce_code_verifier IS
  'Short-lived server-side PKCE verifier. Atomic DELETE ... RETURNING consumes the service-role-only row at most once.';

NOTIFY pgrst, 'reload schema';
