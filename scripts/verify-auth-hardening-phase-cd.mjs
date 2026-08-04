import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const baselinePath = path.join(projectRoot, 'supabase', 'baseline', '000_complete_schema.sql');
const postgresImage = process.env.AUTH_HARDENING_POSTGRES_IMAGE || 'postgres:17-alpine';
const containerName = `endfield-auth-hardening-cd-${Date.now()}`;

function run(command, args, { input = '', allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || allowFailure) {
        resolve({ code, stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with code ${code}\n${stderr || stdout}`));
    });
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await run('docker', ['exec', containerName, 'pg_isready', '-U', 'postgres'], {
      allowFailure: true,
    });
    if (result.code === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Timed out waiting for PostgreSQL 17.');
}

async function cleanup() {
  await run('docker', ['rm', '-f', containerName], { allowFailure: true });
}

function buildSupabaseStubSql() {
  return `
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
ALTER DATABASE postgres SET search_path = public, extensions;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
ALTER ROLE service_role BYPASSRLS;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  email_confirmed_at TIMESTAMPTZ,
  encrypted_password TEXT,
  phone TEXT,
  is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  invited_at TIMESTAMPTZ,
  confirmation_sent_at TIMESTAMPTZ,
  last_sign_in_at TIMESTAMPTZ,
  recovery_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  banned_until TIMESTAMPTZ,
  role TEXT NOT NULL DEFAULT 'authenticated',
  raw_app_meta_data JSONB DEFAULT '{}'::jsonb,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb
);
CREATE TABLE auth.identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  identity_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE auth.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  not_after TIMESTAMPTZ
);
CREATE TABLE auth.refresh_tokens (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  revoked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  parent TEXT,
  session_id UUID REFERENCES auth.sessions(id) ON DELETE CASCADE
);
CREATE TABLE auth.audit_log_entries (
  instance_id UUID,
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payload JSON NOT NULL DEFAULT '{}'::JSON,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address TEXT
);
CREATE TABLE storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  owner UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT (NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'sub')::UUID
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT CURRENT_USER::TEXT $$;
`.trim();
}

function buildVerificationSql() {
  return `
INSERT INTO auth.users (id, email, email_confirmed_at, encrypted_password)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'first@example.com', NOW(), 'password-hash'),
  ('00000000-0000-4000-8000-000000000002', 'second@example.com', NOW(), NULL),
  ('00000000-0000-4000-8000-000000000003', 'temporary@example.com', NOW(), 'old-password-hash');

INSERT INTO public.profiles (id, username, email, role)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'first', 'first@example.com', 'user'),
  ('00000000-0000-4000-8000-000000000002', 'second', 'second@example.com', 'user'),
  ('00000000-0000-4000-8000-000000000003', 'temporary', 'temporary@example.com', 'user')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

SET ROLE service_role;

SELECT 'verified_password_login=' || public.has_verified_password_login(
  '00000000-0000-4000-8000-000000000001'
);

SELECT 'missing_password_login=' || public.has_verified_password_login(
  '00000000-0000-4000-8000-000000000002'
);

SELECT 'challenge_started=' || COUNT(*)
FROM public.start_account_email_challenge(
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'New.Owner@Example.com',
  'oauth_email_setup_required',
  'token-hash-1',
  NOW() + INTERVAL '1 hour',
  'code-hash-1',
  NOW() + INTERVAL '10 minutes'
);

SELECT 'challenge_consumed=' || COUNT(*)
FROM public.consume_account_email_challenge(
  'code',
  'code-hash-1',
  '00000000-0000-4000-8000-000000000001'
);

SELECT 'challenge_replay=' || COUNT(*)
FROM public.consume_account_email_challenge(
  'code',
  'code-hash-1',
  '00000000-0000-4000-8000-000000000001'
);

SELECT 'email_owner=' || user_id
FROM public.account_email_ownerships
WHERE normalized_email = 'new.owner@example.com';

RESET ROLE;

SELECT 'canonical_email=' || email
FROM public.profiles
WHERE id = '00000000-0000-4000-8000-000000000001';

SET ROLE service_role;

DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.start_account_email_challenge(
      '10000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000002',
      'new.owner@example.com',
      'oauth_email_setup_required',
      'token-hash-2',
      NOW() + INTERVAL '1 hour',
      'code-hash-2',
      NOW() + INTERVAL '10 minutes'
    );
    RAISE EXCEPTION 'duplicate email ownership challenge unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

UPDATE public.account_security_states
SET
  password_change_required = TRUE,
  password_change_reason = 'oauth_password_setup_required',
  password_change_source = 'oauth',
  password_setup_capability_id = '20000000-0000-4000-8000-000000000001',
  password_setup_capability_status = 'available'
WHERE user_id = '00000000-0000-4000-8000-000000000001';

SELECT 'password_claim=' || public.claim_oauth_password_setup_capability(
  '00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001'
);

SELECT 'password_finish=' || public.finish_oauth_password_setup_capability(
  '00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'completed',
  NULL
);

SELECT 'password_finish_replay=' || public.finish_oauth_password_setup_capability(
  '00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'completed',
  NULL
);

SELECT 'oauth_password_race_closed=' || (
  password_change_required IS FALSE
  AND password_setup_capability_status = 'completed'
)
FROM public.refresh_oauth_account_security_state(
  '00000000-0000-4000-8000-000000000001',
  FALSE,
  FALSE,
  NULL
);

DO $$
BEGIN
  BEGIN
    PERFORM public.claim_oauth_password_setup_capability(
      '00000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'password setup capability replay unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'password_setup_capability_unavailable' THEN RAISE; END IF;
  END;
END $$;

INSERT INTO public.account_security_states (
  user_id,
  password_change_required,
  password_change_reason,
  password_change_source,
  password_change_requested_at,
  password_change_expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000000002',
  TRUE,
  'account_recovery_temporary_password',
  'account_recovery',
  NOW() - INTERVAL '1 hour',
  NOW() - INTERVAL '1 minute'
)
ON CONFLICT (user_id) DO UPDATE SET
  password_change_required = EXCLUDED.password_change_required,
  password_change_reason = EXCLUDED.password_change_reason,
  password_change_source = EXCLUDED.password_change_source,
  password_change_requested_at = EXCLUDED.password_change_requested_at,
  password_change_expires_at = EXCLUDED.password_change_expires_at;

RESET ROLE;

DO $$
BEGIN
  BEGIN
    INSERT INTO auth.sessions (id, user_id)
    VALUES (
      '30000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'expired temporary password created an Auth session';
  EXCEPTION WHEN invalid_authorization_specification THEN NULL;
  END;
END $$;

SET ROLE service_role;

SELECT 'expired_credential_allowed=' || public.is_account_credential_allowed(
  '00000000-0000-4000-8000-000000000002'
);

RESET ROLE;

INSERT INTO public.official_import_tasks (
  id,
  user_id,
  source,
  import_mode,
  game_uid,
  server_id,
  status,
  access_key_hash,
  expires_at
)
VALUES (
  '60000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'cn',
  'full',
  'security-gate-uid',
  '1',
  'confirming',
  'security-gate-access-key-hash',
  NOW() + INTERVAL '30 minutes'
);

SET ROLE service_role;

DO $$
BEGIN
  BEGIN
    PERFORM public.commit_official_import_records(
      '60000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '[{"pool_id":"security_gate_pool","name":"Security Gate","type":"limited"}]'::JSONB,
      '[{"record_id":"security-gate-record","pool_id":"security_gate_pool","seq_id":"1","game_uid":"security-gate-uid","rarity":4,"timestamp":"2026-08-03T00:00:00Z","server_id":"1","item_name":"Security Gate"}]'::JSONB
    );
    RAISE EXCEPTION 'expired credential committed official import records';
  EXCEPTION WHEN invalid_authorization_specification THEN NULL;
  END;
END $$;

RESET ROLE;

SELECT 'expired_commit_blocked=' || (
  import_task.status = 'confirming'
  AND NOT EXISTS (
    SELECT 1 FROM public.pools
    WHERE user_id = import_task.user_id
      AND pool_id = 'security_gate_pool'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.history
    WHERE user_id = import_task.user_id
      AND record_id = 'security-gate-record'
  )
)
FROM public.official_import_tasks AS import_task
WHERE import_task.id = '60000000-0000-4000-8000-000000000001';

UPDATE auth.users
SET
  encrypted_password = 'temporary-password-hash',
  raw_app_meta_data = jsonb_build_object(
    'temporary_password_issue_id', 'temporary-issue-1',
    'temporary_password_force_change', TRUE,
    'temporary_password_issued_at', NOW(),
    'temporary_password_expires_at', NOW() + INTERVAL '24 hours'
  )
WHERE id = '00000000-0000-4000-8000-000000000003';

SELECT 'atomic_temporary_state=' || (
  password_change_required
  AND password_change_source = 'account_recovery'
  AND password_change_expires_at > NOW()
)
FROM public.account_security_states
WHERE user_id = '00000000-0000-4000-8000-000000000003';

SET ROLE service_role;

INSERT INTO public.app_auth_identities (
  id,
  user_id,
  provider,
  provider_subject_hash,
  provider_subject_hash_key_version
)
VALUES (
  '40000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'github',
  'previous-subject-hash',
  'v1'
);

SELECT 'identity_migrated=' || provider_subject_hash || ':' || provider_subject_hash_key_version
FROM public.claim_oauth_identity(
  '00000000-0000-4000-8000-000000000001',
  'github',
  'current-subject-hash',
  'v2',
  'previous-subject-hash',
  'v1'
);

INSERT INTO public.app_auth_identities (
  id,
  user_id,
  provider,
  provider_subject_hash,
  provider_subject_hash_key_version
)
VALUES (
  '40000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000003',
  'github',
  'real-legacy-state-hash',
  'legacy_state_v1'
);

SELECT 'legacy_identity_migrated=' || user_id || ':'
  || provider_subject_hash || ':' || provider_subject_hash_key_version
FROM public.claim_oauth_identity_v2(
  '00000000-0000-4000-8000-000000000003',
  'github',
  'current-dedicated-hash',
  'v2',
  ARRAY['previous-dedicated-hash', 'real-legacy-state-hash']
);

DO $$
BEGIN
  BEGIN
    UPDATE public.app_auth_identities
    SET provider_subject_hash = 'forged-hash'
    WHERE id = '40000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'direct identity hash update unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

INSERT INTO public.app_auth_identities (
  id,
  user_id,
  provider,
  provider_subject_hash,
  provider_subject_hash_key_version
)
VALUES (
  '40000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000002',
  'github',
  'second-subject-hash',
  'v2'
);

DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.unlink_oauth_identity_atomically(
      '00000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'final login method unlink unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'oauth_last_login_method' THEN RAISE; END IF;
  END;
END $$;

SELECT 'identity_owner=' || user_id
FROM public.app_auth_identities
WHERE id = '40000000-0000-4000-8000-000000000001';

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.account_email_challenges', 'SELECT')
    OR has_table_privilege('authenticated', 'public.account_email_ownerships', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated can read private email ownership state';
  END IF;
  IF has_function_privilege('authenticated', 'public.claim_oauth_identity(uuid,text,text,text,text,text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.consume_account_email_challenge(text,text,uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.has_verified_password_login(uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.claim_oauth_identity_v2(uuid,text,text,text,text[])', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.rotate_app_session_tokens(uuid,text,text,text,timestamptz,timestamptz)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.revoke_app_session_by_token_hashes(text,text,text,timestamptz)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.admin_upsert_pool_with_aliases(text,jsonb,jsonb,jsonb,jsonb,uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.admin_upsert_pool_with_aliases(text,text,text,text,timestamptz,timestamptz,text,text[],text,jsonb,jsonb,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute private credential RPCs';
  END IF;
  IF has_table_privilege('authenticated', 'public.app_session_refresh_token_aliases', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated can read refresh token aliases';
  END IF;
END $$;

RESET ROLE;

INSERT INTO public.app_sessions (
  id,
  user_id,
  compat_session_binding,
  session_token_hash,
  refresh_token_hash,
  created_at,
  last_seen_at,
  expires_at,
  absolute_expires_at
)
VALUES (
  '50000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-0000000000b1',
  'rls-session-token-hash',
  'rls-refresh-token-hash',
  NOW(),
  NOW(),
  NOW() + INTERVAL '1 hour',
  NOW() + INTERVAL '1 day'
);

GRANT SELECT ON public.profiles TO authenticated;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', '00000000-0000-4000-8000-000000000001',
  'session_binding', '50000000-0000-4000-8000-0000000000b1',
  'iat', EXTRACT(EPOCH FROM NOW())::BIGINT,
  'app_metadata', jsonb_build_object('provider', 'site_session'),
  'user_metadata', jsonb_build_object('site_session', TRUE)
)::TEXT, FALSE);
SELECT 'active_direct_rls_rows=' || COUNT(*)
FROM public.profiles
WHERE id = '00000000-0000-4000-8000-000000000001';
RESET ROLE;

UPDATE public.app_sessions
SET revoked_at = NOW(), revoke_reason = 'verification_revoke'
WHERE id = '50000000-0000-4000-8000-000000000001';

SET ROLE authenticated;
SELECT 'revoked_direct_rls_rows=' || COUNT(*)
FROM public.profiles
WHERE id = '00000000-0000-4000-8000-000000000001';
RESET ROLE;

DO $$
BEGIN
  IF public.get_user_ranking_stats('00000000-0000-4000-8000-000000000002') IS NOT NULL THEN
    RAISE EXCEPTION 'cross-user ranking stats unexpectedly succeeded';
  END IF;
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

SET ROLE service_role;
SELECT 'own_ranking_stats_ok=' || (
  public.get_user_ranking_stats('00000000-0000-4000-8000-000000000001') IS NOT NULL
);
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', '00000000-0000-4000-8000-000000000001',
  'session_binding', '50000000-0000-4000-8000-0000000000b1',
  'iat', EXTRACT(EPOCH FROM NOW())::BIGINT,
  'app_metadata', jsonb_build_object('provider', 'site_session'),
  'user_metadata', jsonb_build_object('site_session', TRUE)
)::TEXT, FALSE);
SELECT 'own_ranking_stats_auth_ok=' || (
  public.get_user_ranking_stats('00000000-0000-4000-8000-000000000001') IS NOT NULL
);
RESET ROLE;

SELECT 'public_security_definer_rpc_grants=' || COUNT(*)
FROM pg_proc AS procedure
JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.prosecdef IS TRUE
  AND procedure.proname IN (
    'cleanup_rate_limit_logs',
    'log_rate_limit',
    'increment_urgent_clicks',
    'increment_urgent_clicks_batch',
    'increment_puzzle_solve',
    'review_puzzle',
    'update_puzzle_difficulty',
    'delete_puzzle',
    'current_profile_email',
    'get_ticket_stats',
    'get_user_ranking_stats',
    'get_user_ranking_stats_cached'
  )
  AND has_function_privilege('anon', procedure.oid, 'EXECUTE');

SELECT 'missing_restrictive_rls_policies=' || COUNT(*)
FROM pg_class AS relation
JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE relation.relkind IN ('r', 'p')
  AND relation.relrowsecurity IS TRUE
  AND namespace.nspname IN ('public', 'storage')
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policy AS policy
    WHERE policy.polrelid = relation.oid
      AND policy.polname = 'authenticated_session_must_be_active'
      AND policy.polpermissive IS FALSE
  );

INSERT INTO public.app_sessions (
  id,
  user_id,
  session_token_hash,
  refresh_token_hash,
  created_at,
  last_seen_at,
  expires_at,
  absolute_expires_at
)
VALUES (
  '50000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  'family-session-hash-old',
  'family-refresh-hash-old',
  NOW(),
  NOW(),
  NOW() + INTERVAL '1 hour',
  NOW() + INTERVAL '1 day'
);

SET ROLE service_role;
SELECT 'refresh_family_rotated=' || COUNT(*)
FROM public.rotate_app_session_tokens(
  '50000000-0000-4000-8000-000000000002',
  'family-refresh-hash-old',
  'family-session-hash-new',
  'family-refresh-hash-new',
  NOW() + INTERVAL '1 hour',
  NOW() - INTERVAL '1 day'
);

SELECT 'historical_refresh_logout_revoked=' || public.revoke_app_session_by_token_hashes(
  NULL,
  'family-refresh-hash-old',
  'verification_logout',
  NOW()
);
RESET ROLE;

SELECT 'refresh_family_inactive=' || (revoked_at IS NOT NULL)
FROM public.app_sessions
WHERE id = '50000000-0000-4000-8000-000000000002';

INSERT INTO auth.users (
  id,
  email,
  email_confirmed_at,
  encrypted_password,
  created_at,
  raw_app_meta_data,
  raw_user_meta_data
)
VALUES
  (
    '00000000-0000-4000-8000-000000000010',
    'github.subject@oauth.local.invalid',
    NOW(),
    NULL,
    TIMESTAMPTZ '2026-07-24 09:55:00+00',
    '{"provider":"email","providers":["email"]}'::JSONB,
    '{"synthetic_oauth_email":true}'::JSONB
  ),
  (
    '00000000-0000-4000-8000-000000000011',
    'legacy.merge@example.com',
    TIMESTAMPTZ '2026-07-24 10:00:00+00',
    NULL,
    TIMESTAMPTZ '2026-07-24 10:00:00+00',
    '{"provider":"email","providers":["email"]}'::JSONB,
    '{"email_verified":true}'::JSONB
  ),
  (
    '00000000-0000-4000-8000-000000000020',
    'merge.operator@example.com',
    TIMESTAMPTZ '2026-07-01 00:00:00+00',
    'operator-password-hash',
    TIMESTAMPTZ '2026-07-01 00:00:00+00',
    '{"provider":"email","providers":["email"]}'::JSONB,
    '{"email_verified":true,"site_password_set":true}'::JSONB
  );

UPDATE auth.users
SET confirmation_sent_at = TIMESTAMPTZ '2026-07-24 10:00:00+00',
    updated_at = TIMESTAMPTZ '2026-07-24 10:00:01+00'
WHERE id = '00000000-0000-4000-8000-000000000011';

UPDATE public.profiles
SET
  username = 'oauth-merge-source',
  email = 'legacy.merge@example.com',
  role = 'user',
  created_at = TIMESTAMPTZ '2026-07-24 09:55:00+00',
  updated_at = TIMESTAMPTZ '2026-07-24 09:58:00+00'
WHERE id = '00000000-0000-4000-8000-000000000010';

UPDATE public.profiles
SET
  username = 'oauth-merge-operator',
  role = 'super_admin',
  updated_at = TIMESTAMPTZ '2026-07-24 09:58:00+00'
WHERE id = '00000000-0000-4000-8000-000000000020';

INSERT INTO public.tickets (
  id,
  user_id,
  target_role,
  type,
  title,
  content,
  status,
  priority,
  created_at,
  updated_at
)
VALUES (
  '81000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000010',
  'admin',
  'bug',
  'OAuth email artifact merge test',
  'Database verification fixture.',
  'processing',
  'medium',
  TIMESTAMPTZ '2026-07-24 10:01:00+00',
  TIMESTAMPTZ '2026-07-24 10:01:00+00'
);

-- Reproduce the historical artifact: the Auth user survived the old
-- verification action while its automatically-created profile did not.
DELETE FROM public.profiles
WHERE id = '00000000-0000-4000-8000-000000000011';

INSERT INTO public.account_security_states (
  user_id,
  password_change_required,
  password_change_reason,
  password_change_source,
  password_change_requested_at,
  email_verification_required,
  email_verification_reason,
  email_verification_verified_at,
  email_verification_target_email,
  password_setup_capability_id,
  password_setup_capability_status
)
VALUES (
  '00000000-0000-4000-8000-000000000010',
  TRUE,
  'oauth_password_setup_required:github',
  'oauth',
  TIMESTAMPTZ '2026-07-24 09:55:00+00',
  FALSE,
  NULL,
  TIMESTAMPTZ '2026-07-24 09:59:00+00',
  'legacy.merge@example.com',
  '20000000-0000-4000-8000-000000000010',
  'available'
);

INSERT INTO public.app_auth_identities (
  id,
  user_id,
  provider,
  provider_subject_hash,
  provider_subject_hash_key_version
)
VALUES (
  '40000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000010',
  'github',
  'oauth-email-merge-subject-hash',
  'v2'
);

INSERT INTO public.mail_delivery_events (
  id,
  event_type,
  event_payload_redacted_json,
  created_at
)
VALUES (
  '70000000-0000-4000-8000-000000000010',
  'email_verification_accepted',
  '{"action":"resend_verification","relatedEntityId":"resend_verification","verificationMode":"auth_magiclink","recipientDomain":"example.com","recipientRedacted":"l***e@e***e.com"}'::JSONB,
  TIMESTAMPTZ '2026-07-24 10:00:00+00'
);

INSERT INTO auth.identities (id, user_id, provider, identity_data)
VALUES (
  '90000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000011',
  'email',
  '{"email":"legacy.merge@example.com","email_verified":true}'::JSONB
);

INSERT INTO public.account_email_artifact_merge_approvals (
  artifact_user_id,
  source_user_id,
  approval_ticket_id,
  approved_by,
  target_email_hash,
  evidence_version,
  approval_reference_hash,
  evidence_snapshot_hash,
  approved_at,
  expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000010',
  '81000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000020',
  ENCODE(extensions.DIGEST('legacy.merge@example.com', 'sha256'), 'hex'),
  'legacy_magiclink_v1',
  ENCODE(extensions.DIGEST('ticket:81000000-0000-4000-8000-000000000010', 'sha256'), 'hex'),
  public.oauth_email_artifact_evidence_snapshot_hash(
    '00000000-0000-4000-8000-000000000011',
    'legacy.merge@example.com'
  ),
  NOW(),
  NOW() + INTERVAL '30 days'
);

INSERT INTO public.app_sessions (
  id,
  user_id,
  session_token_hash,
  refresh_token_hash,
  created_at,
  last_seen_at,
  expires_at,
  absolute_expires_at
)
VALUES (
  '50000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000010',
  'merge-started-session-hash',
  'merge-started-refresh-hash',
  NOW(),
  NOW(),
  NOW() + INTERVAL '1 hour',
  NOW() + INTERVAL '1 day'
);

SET ROLE service_role;

SELECT 'oauth_email_merge_eligible=' || eligible
FROM public.inspect_oauth_email_artifact_merge(
  '00000000-0000-4000-8000-000000000010',
  'legacy.merge@example.com'
);

SELECT 'oauth_email_merge_started=' || status
FROM public.start_oauth_email_artifact_merge(
  '80000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000010',
  '50000000-0000-4000-8000-000000000010',
  'legacy.merge@example.com',
  'merge-code-hash',
  NOW() + INTERVAL '15 minutes'
);

SELECT 'oauth_email_merge_wrong_code=' || COUNT(*)
FROM public.verify_oauth_email_artifact_merge(
  '80000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000010',
  'wrong-code-hash'
);

SELECT 'oauth_email_merge_attempts=' || verification_attempt_count
FROM public.account_email_merge_intents
WHERE id = '80000000-0000-4000-8000-000000000010';

SELECT 'oauth_email_merge_verified=' || status
FROM public.verify_oauth_email_artifact_merge(
  '80000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000010',
  'merge-code-hash'
);

SELECT 'oauth_email_merge_claimed=' || status
FROM public.claim_oauth_email_artifact_merge(
  '80000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000010',
  '50000000-0000-4000-8000-000000000010'
);

RESET ROLE;

SELECT 'oauth_email_merge_source_auth_sessions=' || COUNT(*)
FROM auth.sessions
WHERE user_id = '00000000-0000-4000-8000-000000000010';

DO $$
BEGIN
  BEGIN
    INSERT INTO auth.identities (id, user_id, provider, identity_data)
    VALUES (
      '40000000-0000-4000-8000-000000000099',
      '00000000-0000-4000-8000-000000000011',
      'github',
      '{"email":"unexpected@example.com"}'::JSONB
    );
    RAISE EXCEPTION 'identity insert unexpectedly succeeded';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END $$;

SELECT 'oauth_email_merge_identity_insert_blocked=' || COUNT(*)
FROM auth.identities
WHERE id = '40000000-0000-4000-8000-000000000099';

CREATE OR REPLACE FUNCTION public.test_fail_oauth_artifact_quarantine_user_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id = '00000000-0000-4000-8000-000000000011'
    AND public.normalize_account_email(NEW.email) LIKE '%@oauth.local.invalid' THEN
    RAISE EXCEPTION 'test_quarantine_user_update_failed' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER aaa_test_fail_oauth_artifact_quarantine_user_update
  BEFORE UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.test_fail_oauth_artifact_quarantine_user_update();

SET ROLE service_role;

DO $$
BEGIN
  BEGIN
    PERFORM *
    FROM public.quarantine_oauth_email_artifact_for_merge(
      '80000000-0000-4000-8000-000000000010',
      '00000000-0000-4000-8000-000000000010'
    );
    RAISE EXCEPTION 'quarantine unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'test_quarantine_user_update_failed' THEN RAISE; END IF;
  END;
END $$;

RESET ROLE;

DROP TRIGGER aaa_test_fail_oauth_artifact_quarantine_user_update ON auth.users;
DROP FUNCTION public.test_fail_oauth_artifact_quarantine_user_update();

SELECT 'oauth_email_merge_atomic_rollback=' || (
  public.normalize_account_email(auth_user.email) = 'legacy.merge@example.com'
  AND public.normalize_account_email(identity.identity_data ->> 'email') = 'legacy.merge@example.com'
  AND auth_user.banned_until IS NULL
  AND NOT (auth_user.raw_user_meta_data ? 'oauth_email_merge_intent_id')
)
FROM auth.users AS auth_user
JOIN auth.identities AS identity ON identity.user_id = auth_user.id
WHERE auth_user.id = '00000000-0000-4000-8000-000000000011';

SET ROLE service_role;

SELECT 'oauth_email_merge_quarantined=' || status
FROM public.quarantine_oauth_email_artifact_for_merge(
  '80000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000010'
);

RESET ROLE;

SELECT 'oauth_email_merge_quarantine_state=' || (
  public.normalize_account_email(auth_user.email) = 'legacy.merge.00000000000040008000000000000011@oauth.local.invalid'
  AND auth_user.banned_until > NOW()
  AND auth_user.raw_user_meta_data ->> 'oauth_email_merge_intent_id' = '80000000-0000-4000-8000-000000000010'
  AND COUNT(identity.id) = 1
  AND BOOL_AND(identity.provider = 'email')
  AND BOOL_AND(
    public.normalize_account_email(identity.identity_data ->> 'email')
      = 'legacy.merge.00000000000040008000000000000011@oauth.local.invalid'
  )
  AND BOOL_AND(LOWER(identity.identity_data ->> 'email_verified') = 'true')
)
FROM auth.users AS auth_user
JOIN auth.identities AS identity ON identity.user_id = auth_user.id
WHERE auth_user.id = '00000000-0000-4000-8000-000000000011'
GROUP BY auth_user.id, auth_user.email, auth_user.banned_until, auth_user.raw_user_meta_data;

SET ROLE service_role;

SELECT 'oauth_email_merge_transferred=' || status
FROM public.prepare_oauth_email_artifact_ownership_transfer(
  '80000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000010'
);

RESET ROLE;

UPDATE auth.users
SET
  email = 'legacy.merge@example.com',
  email_confirmed_at = NOW(),
  raw_user_meta_data = raw_user_meta_data || '{"synthetic_oauth_email":false,"legacy_email_conflict_repaired":true}'::JSONB
WHERE id = '00000000-0000-4000-8000-000000000010';

SET ROLE service_role;

SELECT 'oauth_email_merge_completed=' || status
FROM public.complete_oauth_email_artifact_merge(
  '80000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000010'
);

SELECT 'oauth_email_merge_owner=' || user_id
FROM public.account_email_ownerships
WHERE normalized_email = 'legacy.merge@example.com';

RESET ROLE;

INSERT INTO auth.users (
  id,
  email,
  email_confirmed_at,
  encrypted_password,
  confirmation_sent_at,
  last_sign_in_at,
  recovery_sent_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data
)
VALUES
  (
    '00000000-0000-4000-8000-000000000012',
    'github.consumed@oauth.local.invalid',
    TIMESTAMPTZ '2026-07-22 13:00:00+00',
    NULL,
    NULL,
    NULL,
    NULL,
    TIMESTAMPTZ '2026-07-22 13:00:00+00',
    TIMESTAMPTZ '2026-07-22 13:00:00+00',
    '{"provider":"email","providers":["email"]}'::JSONB,
    '{"synthetic_oauth_email":true}'::JSONB
  ),
  (
    '00000000-0000-4000-8000-000000000013',
    'consumed.magiclink@example.com',
    TIMESTAMPTZ '2026-07-22 13:05:10+00',
    '$2b$10$' || REPEAT('a', 53),
    TIMESTAMPTZ '2026-07-22 13:05:00+00',
    TIMESTAMPTZ '2026-07-22 14:45:03+00',
    TIMESTAMPTZ '2026-07-22 14:44:50+00',
    TIMESTAMPTZ '2026-07-22 13:05:00+00',
    TIMESTAMPTZ '2026-07-22 14:45:03+00',
    '{"provider":"email","providers":["email"]}'::JSONB,
    '{"email_verified":true}'::JSONB
  );

UPDATE public.profiles
SET
  username = 'oauth-consumed-source',
  email = 'consumed.magiclink@example.com',
  role = 'user',
  created_at = TIMESTAMPTZ '2026-07-22 13:00:00+00',
  updated_at = TIMESTAMPTZ '2026-07-22 13:04:00+00'
WHERE id = '00000000-0000-4000-8000-000000000012';

INSERT INTO public.tickets (
  id,
  user_id,
  target_role,
  type,
  title,
  content,
  status,
  priority,
  created_at,
  updated_at
)
VALUES (
  '81000000-0000-4000-8000-000000000012',
  '00000000-0000-4000-8000-000000000012',
  'admin',
  'bug',
  'Consumed OAuth email artifact merge test',
  'Database verification fixture.',
  'processing',
  'medium',
  TIMESTAMPTZ '2026-07-22 15:00:00+00',
  TIMESTAMPTZ '2026-07-22 15:00:00+00'
);

DELETE FROM public.profiles
WHERE id = '00000000-0000-4000-8000-000000000013';

INSERT INTO public.account_security_states (
  user_id,
  password_change_required,
  password_change_reason,
  password_change_source,
  password_change_requested_at,
  email_verification_required,
  email_verification_reason,
  email_verification_verified_at,
  email_verification_target_email,
  password_setup_capability_id,
  password_setup_capability_status
)
VALUES (
  '00000000-0000-4000-8000-000000000012',
  TRUE,
  'oauth_password_setup_required:github',
  'oauth',
  TIMESTAMPTZ '2026-07-22 13:00:00+00',
  FALSE,
  NULL,
  TIMESTAMPTZ '2026-07-22 13:04:00+00',
  'consumed.magiclink@example.com',
  '20000000-0000-4000-8000-000000000012',
  'available'
);

INSERT INTO public.app_auth_identities (
  id,
  user_id,
  provider,
  provider_subject_hash,
  provider_subject_hash_key_version
)
VALUES (
  '40000000-0000-4000-8000-000000000012',
  '00000000-0000-4000-8000-000000000012',
  'github',
  'oauth-consumed-email-merge-subject-hash',
  'v2'
);

INSERT INTO public.mail_delivery_events (
  id,
  event_type,
  event_payload_redacted_json,
  created_at
)
VALUES (
  '70000000-0000-4000-8000-000000000012',
  'email_verification_accepted',
  '{"action":"resend_verification","relatedEntityId":"resend_verification","verificationMode":"auth_magiclink","recipientDomain":"example.com","recipientRedacted":"c***k@e***e.com"}'::JSONB,
  TIMESTAMPTZ '2026-07-22 13:05:00+00'
);

INSERT INTO auth.identities (id, user_id, provider, identity_data)
VALUES (
  '90000000-0000-4000-8000-000000000013',
  '00000000-0000-4000-8000-000000000013',
  'email',
  '{"email":"consumed.magiclink@example.com","email_verified":true}'::JSONB
);

INSERT INTO auth.sessions (id, user_id, created_at, updated_at)
VALUES
  (
    '30000000-0000-4000-8000-000000000013',
    '00000000-0000-4000-8000-000000000013',
    TIMESTAMPTZ '2026-07-22 13:05:10+00',
    TIMESTAMPTZ '2026-07-22 13:05:10+00'
  ),
  (
    '30000000-0000-4000-8000-000000000014',
    '00000000-0000-4000-8000-000000000013',
    TIMESTAMPTZ '2026-07-22 14:45:03+00',
    TIMESTAMPTZ '2026-07-22 14:45:03+00'
  );

INSERT INTO auth.refresh_tokens (
  token,
  user_id,
  revoked,
  created_at,
  updated_at,
  parent,
  session_id
)
VALUES
  (
    'consumed-refresh-token-1',
    '00000000-0000-4000-8000-000000000013',
    FALSE,
    TIMESTAMPTZ '2026-07-22 13:05:10+00',
    TIMESTAMPTZ '2026-07-22 13:05:10+00',
    NULL,
    '30000000-0000-4000-8000-000000000013'
  ),
  (
    'consumed-refresh-token-2',
    '00000000-0000-4000-8000-000000000013',
    FALSE,
    TIMESTAMPTZ '2026-07-22 14:45:03+00',
    TIMESTAMPTZ '2026-07-22 14:45:03+00',
    NULL,
    '30000000-0000-4000-8000-000000000014'
  );

INSERT INTO auth.audit_log_entries (id, payload, created_at)
VALUES
  (
    '91000000-0000-4000-8000-000000000013',
    '{"action":"user_signedup","actor_id":"00000000-0000-4000-8000-000000000013","log_type":"team","traits":{"provider":"email"}}'::JSON,
    TIMESTAMPTZ '2026-07-22 13:05:10+00'
  ),
  (
    '91000000-0000-4000-8000-000000000014',
    '{"action":"user_recovery_requested","actor_id":"00000000-0000-4000-8000-000000000013","log_type":"user"}'::JSON,
    TIMESTAMPTZ '2026-07-22 14:44:50+00'
  ),
  (
    '91000000-0000-4000-8000-000000000015',
    '{"action":"login","actor_id":"00000000-0000-4000-8000-000000000013","log_type":"account"}'::JSON,
    TIMESTAMPTZ '2026-07-22 14:45:03+00'
  );

INSERT INTO public.app_sessions (
  id,
  user_id,
  session_token_hash,
  refresh_token_hash,
  created_at,
  last_seen_at,
  expires_at,
  absolute_expires_at
)
VALUES (
  '50000000-0000-4000-8000-000000000012',
  '00000000-0000-4000-8000-000000000012',
  'consumed-merge-started-session-hash',
  'consumed-merge-started-refresh-hash',
  NOW(),
  NOW(),
  NOW() + INTERVAL '1 hour',
  NOW() + INTERVAL '1 day'
);

SET ROLE service_role;

SELECT 'oauth_email_consumed_preapproval=' || reason
FROM public.inspect_oauth_email_artifact_merge(
  '00000000-0000-4000-8000-000000000012',
  'consumed.magiclink@example.com'
);

SELECT 'oauth_email_approval_service_insert=' || has_table_privilege(
  'service_role',
  'public.account_email_artifact_merge_approvals',
  'INSERT'
);

RESET ROLE;

UPDATE auth.refresh_tokens
SET revoked = NULL, created_at = NULL, updated_at = NULL
WHERE token = 'consumed-refresh-token-1';

SET ROLE service_role;

SELECT 'oauth_email_consumed_null_refresh=' || reason
FROM public.inspect_oauth_email_artifact_merge(
  '00000000-0000-4000-8000-000000000012',
  'consumed.magiclink@example.com',
  FALSE
);

RESET ROLE;

UPDATE auth.refresh_tokens
SET
  revoked = FALSE,
  created_at = TIMESTAMPTZ '2026-07-22 13:05:10+00',
  updated_at = TIMESTAMPTZ '2026-07-22 13:05:10+00'
WHERE token = 'consumed-refresh-token-1';

UPDATE auth.refresh_tokens
SET
  session_id = '30000000-0000-4000-8000-000000000013',
  created_at = TIMESTAMPTZ '2026-07-22 13:05:10+00',
  updated_at = TIMESTAMPTZ '2026-07-22 13:05:10+00'
WHERE token = 'consumed-refresh-token-2';

SET ROLE service_role;

SELECT 'oauth_email_consumed_duplicate_refresh_session=' || reason
FROM public.inspect_oauth_email_artifact_merge(
  '00000000-0000-4000-8000-000000000012',
  'consumed.magiclink@example.com',
  FALSE
);

RESET ROLE;

UPDATE auth.refresh_tokens
SET
  session_id = '30000000-0000-4000-8000-000000000014',
  created_at = TIMESTAMPTZ '2026-07-22 14:45:03+00',
  updated_at = TIMESTAMPTZ '2026-07-22 14:45:03+00'
WHERE token = 'consumed-refresh-token-2';

DO $$
BEGIN
  BEGIN
    INSERT INTO public.account_email_artifact_merge_approvals (
      artifact_user_id,
      source_user_id,
      approval_ticket_id,
      approved_by,
      target_email_hash,
      evidence_version,
      approval_reference_hash,
      evidence_snapshot_hash,
      approved_at,
      expires_at
    )
    VALUES (
      '00000000-0000-4000-8000-000000000013',
      '00000000-0000-4000-8000-000000000012',
      '81000000-0000-4000-8000-000000000012',
      '00000000-0000-4000-8000-000000000012',
      ENCODE(extensions.DIGEST('consumed.magiclink@example.com', 'sha256'), 'hex'),
      'legacy_magiclink_consumed_v2',
      ENCODE(extensions.DIGEST('ticket:81000000-0000-4000-8000-000000000012', 'sha256'), 'hex'),
      public.oauth_email_artifact_evidence_snapshot_hash(
        '00000000-0000-4000-8000-000000000013',
        'consumed.magiclink@example.com'
      ),
      NOW(),
      NOW() + INTERVAL '30 days'
    );
    RAISE EXCEPTION 'non-admin approval unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SELECT 'oauth_email_approval_rows_after_forgery=' || COUNT(*)
FROM public.account_email_artifact_merge_approvals
WHERE artifact_user_id = '00000000-0000-4000-8000-000000000013';

INSERT INTO public.account_email_artifact_merge_approvals (
  artifact_user_id,
  source_user_id,
  approval_ticket_id,
  approved_by,
  target_email_hash,
  evidence_version,
  approval_reference_hash,
  evidence_snapshot_hash,
  approved_at,
  expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000000013',
  '00000000-0000-4000-8000-000000000012',
  '81000000-0000-4000-8000-000000000012',
  '00000000-0000-4000-8000-000000000020',
  ENCODE(extensions.DIGEST('consumed.magiclink@example.com', 'sha256'), 'hex'),
  'legacy_magiclink_v1',
  ENCODE(extensions.DIGEST('ticket:81000000-0000-4000-8000-000000000012', 'sha256'), 'hex'),
  public.oauth_email_artifact_evidence_snapshot_hash(
    '00000000-0000-4000-8000-000000000013',
    'consumed.magiclink@example.com'
  ),
  NOW(),
  NOW() + INTERVAL '30 days'
);

SET ROLE service_role;

SELECT 'oauth_email_consumed_wrong_approval=' || reason
FROM public.inspect_oauth_email_artifact_merge(
  '00000000-0000-4000-8000-000000000012',
  'consumed.magiclink@example.com'
);

RESET ROLE;

DELETE FROM public.account_email_artifact_merge_approvals
WHERE artifact_user_id = '00000000-0000-4000-8000-000000000013';

INSERT INTO public.account_email_artifact_merge_approvals (
  artifact_user_id,
  source_user_id,
  approval_ticket_id,
  approved_by,
  target_email_hash,
  evidence_version,
  approval_reference_hash,
  evidence_snapshot_hash,
  approved_at,
  expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000000013',
  '00000000-0000-4000-8000-000000000012',
  '81000000-0000-4000-8000-000000000012',
  '00000000-0000-4000-8000-000000000020',
  ENCODE(extensions.DIGEST('consumed.magiclink@example.com', 'sha256'), 'hex'),
  'legacy_magiclink_consumed_v2',
  ENCODE(extensions.DIGEST('ticket:81000000-0000-4000-8000-000000000012', 'sha256'), 'hex'),
  public.oauth_email_artifact_evidence_snapshot_hash(
    '00000000-0000-4000-8000-000000000013',
    'consumed.magiclink@example.com'
  ),
  NOW(),
  NOW() + INTERVAL '30 days'
);

UPDATE auth.refresh_tokens
SET token = 'consumed-refresh-token-1-mutated'
WHERE token = 'consumed-refresh-token-1';

SET ROLE service_role;

SELECT 'oauth_email_consumed_snapshot_changed=' || reason
FROM public.inspect_oauth_email_artifact_merge(
  '00000000-0000-4000-8000-000000000012',
  'consumed.magiclink@example.com'
);

RESET ROLE;

UPDATE auth.refresh_tokens
SET token = 'consumed-refresh-token-1'
WHERE token = 'consumed-refresh-token-1-mutated';

INSERT INTO auth.audit_log_entries (id, payload, created_at)
VALUES (
  '91000000-0000-4000-8000-000000000016',
  '{"action":"password_changed","actor_id":"00000000-0000-4000-8000-000000000013","log_type":"account"}'::JSON,
  TIMESTAMPTZ '2026-07-22 14:45:04+00'
);

SET ROLE service_role;

SELECT 'oauth_email_consumed_password_audit=' || reason
FROM public.inspect_oauth_email_artifact_merge(
  '00000000-0000-4000-8000-000000000012',
  'consumed.magiclink@example.com',
  FALSE
);

RESET ROLE;

DELETE FROM auth.audit_log_entries
WHERE id = '91000000-0000-4000-8000-000000000016';

SET ROLE service_role;

SELECT 'oauth_email_consumed_merge_eligible=' || eligible || ':' || reason
FROM public.inspect_oauth_email_artifact_merge(
  '00000000-0000-4000-8000-000000000012',
  'consumed.magiclink@example.com'
);

SELECT 'oauth_email_consumed_merge_started=' || status
FROM public.start_oauth_email_artifact_merge(
  '80000000-0000-4000-8000-000000000012',
  '00000000-0000-4000-8000-000000000012',
  '50000000-0000-4000-8000-000000000012',
  'consumed.magiclink@example.com',
  'consumed-merge-code-hash',
  NOW() + INTERVAL '15 minutes'
);

SELECT 'oauth_email_consumed_merge_verified=' || status
FROM public.verify_oauth_email_artifact_merge(
  '80000000-0000-4000-8000-000000000012',
  '00000000-0000-4000-8000-000000000012',
  'consumed-merge-code-hash'
);

SELECT 'oauth_email_consumed_merge_claimed=' || status
FROM public.claim_oauth_email_artifact_merge(
  '80000000-0000-4000-8000-000000000012',
  '00000000-0000-4000-8000-000000000012',
  '50000000-0000-4000-8000-000000000012'
);

SELECT 'oauth_email_consumed_quarantined=' || status
FROM public.quarantine_oauth_email_artifact_for_merge(
  '80000000-0000-4000-8000-000000000012',
  '00000000-0000-4000-8000-000000000012'
);

RESET ROLE;

SELECT 'oauth_email_consumed_quarantine_state=' || (
  public.normalize_account_email(auth_user.email) = 'legacy.merge.00000000000040008000000000000013@oauth.local.invalid'
  AND auth_user.banned_until > NOW()
  AND auth_user.raw_user_meta_data ->> 'oauth_email_merge_intent_id' = '80000000-0000-4000-8000-000000000012'
  AND COUNT(identity.id) = 1
  AND BOOL_AND(identity.provider = 'email')
  AND BOOL_AND(
    public.normalize_account_email(identity.identity_data ->> 'email')
      = 'legacy.merge.00000000000040008000000000000013@oauth.local.invalid'
  )
)
FROM auth.users AS auth_user
JOIN auth.identities AS identity ON identity.user_id = auth_user.id
WHERE auth_user.id = '00000000-0000-4000-8000-000000000013'
GROUP BY auth_user.id, auth_user.email, auth_user.banned_until, auth_user.raw_user_meta_data;

SELECT 'oauth_email_consumed_auth_sessions=' || COUNT(*)
FROM auth.sessions
WHERE user_id = '00000000-0000-4000-8000-000000000013';

SELECT 'oauth_email_consumed_refresh_tokens=' || COUNT(*)
FROM auth.refresh_tokens
WHERE user_id = '00000000-0000-4000-8000-000000000013';

SELECT 'admin_security_definer_browser_grants=' || COUNT(*)
FROM pg_proc AS procedure
JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.prosecdef IS TRUE
  AND procedure.proname LIKE 'admin\_%' ESCAPE '\'
  AND has_function_privilege('authenticated', procedure.oid, 'EXECUTE');
`.trim();
}

async function main() {
  const baselineSql = await readFile(baselinePath, 'utf8');
  const dockerVersion = await run('docker', ['version', '--format', '{{.Server.Version}}'], {
    allowFailure: true,
  });
  if (dockerVersion.code !== 0) {
    throw new Error('Docker daemon is unavailable.');
  }

  try {
    await run('docker', [
      'run', '--name', containerName, '--rm', '-d',
      '-e', 'POSTGRES_PASSWORD=postgres',
      '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
      postgresImage,
    ]);
    await waitForPostgres();
    await run('docker', ['exec', '-i', containerName, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], {
      input: `${buildSupabaseStubSql()}\n`,
    });
    await run('docker', ['exec', '-i', containerName, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], {
      input: baselineSql,
    });
    const verification = await run(
      'docker',
      ['exec', '-i', containerName, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-At'],
      { input: `${buildVerificationSql()}\n` }
    );
    const output = verification.stdout.trim();
    const markers = [
      'challenge_started=1',
      'challenge_consumed=1',
      'challenge_replay=0',
      'email_owner=00000000-0000-4000-8000-000000000001',
      'canonical_email=new.owner@example.com',
      'password_claim=claimed',
      'password_finish=completed',
      'password_finish_replay=completed',
      'oauth_password_race_closed=true',
      'expired_credential_allowed=false',
      'expired_commit_blocked=true',
      'atomic_temporary_state=true',
      'identity_migrated=current-subject-hash:v2',
      'legacy_identity_migrated=00000000-0000-4000-8000-000000000003:current-dedicated-hash:v2',
      'verified_password_login=true',
      'missing_password_login=false',
      'identity_owner=00000000-0000-4000-8000-000000000001',
      'active_direct_rls_rows=1',
      'revoked_direct_rls_rows=0',
      'missing_restrictive_rls_policies=0',
      'refresh_family_rotated=1',
      'historical_refresh_logout_revoked=1',
      'refresh_family_inactive=true',
      'oauth_email_merge_eligible=true',
      'oauth_email_merge_started=pending',
      'oauth_email_merge_wrong_code=0',
      'oauth_email_merge_attempts=1',
      'oauth_email_merge_verified=verified',
      'oauth_email_merge_claimed=claimed',
      'oauth_email_merge_source_auth_sessions=0',
      'oauth_email_merge_identity_insert_blocked=0',
      'oauth_email_merge_atomic_rollback=true',
      'oauth_email_merge_quarantined=claimed',
      'oauth_email_merge_quarantine_state=true',
      'oauth_email_merge_transferred=ownership_transferred',
      'oauth_email_merge_completed=completed',
      'oauth_email_merge_owner=00000000-0000-4000-8000-000000000010',
      'oauth_email_consumed_preapproval=artifact_operator_approval_required',
      'oauth_email_approval_service_insert=false',
      'oauth_email_consumed_null_refresh=artifact_consumed_refresh_token_mismatch',
      'oauth_email_consumed_duplicate_refresh_session=artifact_consumed_refresh_token_mismatch',
      'oauth_email_approval_rows_after_forgery=0',
      'oauth_email_consumed_wrong_approval=artifact_operator_approval_required',
      'oauth_email_consumed_snapshot_changed=artifact_operator_approval_required',
      'oauth_email_consumed_password_audit=artifact_consumed_audit_mismatch',
      'oauth_email_consumed_merge_eligible=true:legacy_email_artifact_magiclink_consumed',
      'oauth_email_consumed_merge_started=pending',
      'oauth_email_consumed_merge_verified=verified',
      'oauth_email_consumed_merge_claimed=claimed',
      'oauth_email_consumed_quarantined=claimed',
      'oauth_email_consumed_quarantine_state=true',
      'oauth_email_consumed_auth_sessions=0',
      'oauth_email_consumed_refresh_tokens=0',
      'admin_security_definer_browser_grants=0',
      'own_ranking_stats_ok=true',
      'own_ranking_stats_auth_ok=true',
      'public_security_definer_rpc_grants=0',
    ];
    const missing = markers.filter((marker) => !output.includes(marker));
    if (missing.length > 0) {
      throw new Error(`Missing verification markers: ${missing.join(', ')}\n${output}`);
    }
    console.log('[verify-auth-hardening-phase-cd] OK');
    console.log(output);
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(`[verify-auth-hardening-phase-cd] Failed: ${error?.stack || error}`);
  process.exitCode = 1;
});
