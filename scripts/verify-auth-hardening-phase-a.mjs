import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const postgresImage = process.env.AUTH_HARDENING_POSTGRES_IMAGE || 'postgres:17-alpine';
const containerName = `endfield-auth-hardening-${Date.now()}`;
const migrationPaths = [
  path.join(projectRoot, 'supabase', 'migrations', '129_add_site_auth_sessions.sql'),
  path.join(projectRoot, 'supabase', 'migrations', '136_fix_service_role_admin_profile_rpc.sql'),
  path.join(projectRoot, 'supabase', 'migrations', '166_harden_admin_profile_and_oauth_transactions.sql'),
];

function run(command, args, {
  input = '',
  allowFailure = false,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || allowFailure) {
        resolve({ code, stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with code ${code}\n${stderr || stdout}`));
    });

    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await run(
      'docker',
      ['exec', containerName, 'pg_isready', '-U', 'postgres'],
      { allowFailure: true }
    );
    if (result.code === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Timed out waiting for the PostgreSQL auth-hardening test container.');
}

async function cleanup() {
  await run('docker', ['rm', '-f', containerName], { allowFailure: true });
}

function buildStubSql() {
  return `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role;
  END IF;
END;
$$;

ALTER ROLE service_role BYPASSRLS;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.users (
  id UUID PRIMARY KEY,
  email TEXT,
  encrypted_password TEXT,
  raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE auth.sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$ SELECT NULL::UUID $$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$ SELECT CURRENT_USER::TEXT $$;

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ
);
`.trim();
}

function buildVerificationSql() {
  return `
INSERT INTO auth.users (id, email)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'admin@example.invalid'),
  ('00000000-0000-0000-0000-000000000002', 'user@example.invalid');

INSERT INTO public.profiles (id, username, email, role)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'admin', 'admin@example.invalid', 'super_admin'),
  ('00000000-0000-0000-0000-000000000002', 'user', 'user@example.invalid', 'user');

INSERT INTO auth.sessions (id, user_id)
VALUES (
  '30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002'
);

INSERT INTO public.app_auth_identities (
  id,
  user_id,
  provider,
  provider_subject_hash
)
VALUES (
  '40000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'github',
  'immutable-owner-subject-hash'
);

DO $$
BEGIN
  BEGIN
    UPDATE public.app_auth_identities
    SET user_id = '00000000-0000-0000-0000-000000000001'
    WHERE id = '40000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'OAuth identity owner update unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;
END;
$$;

SELECT 'identity_owner=' || user_id
FROM public.app_auth_identities
WHERE id = '40000000-0000-0000-0000-000000000001';

DO $$
BEGIN
  IF has_function_privilege(
    'anon',
    'public.admin_update_profile(uuid,text,text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon inherited EXECUTE on admin_update_profile';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.admin_update_profile(uuid,text,text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated retained EXECUTE on admin_update_profile';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.admin_update_profile(uuid,text,text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role cannot execute admin_update_profile';
  END IF;

  IF has_table_privilege('anon', 'public.app_oauth_transactions', 'SELECT')
    OR has_table_privilege('authenticated', 'public.app_oauth_transactions', 'SELECT')
    OR has_table_privilege('authenticated', 'public.app_oauth_transactions', 'INSERT')
    OR has_table_privilege('authenticated', 'public.app_oauth_transactions', 'UPDATE') THEN
    RAISE EXCEPTION 'browser roles can access app_oauth_transactions';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.app_oauth_transactions', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.app_oauth_transactions', 'INSERT')
    OR NOT has_table_privilege('service_role', 'public.app_oauth_transactions', 'DELETE') THEN
    RAISE EXCEPTION 'service_role lacks app_oauth_transactions privileges';
  END IF;

  IF has_table_privilege('service_role', 'public.app_oauth_transactions', 'UPDATE') THEN
    RAISE EXCEPTION 'service_role retained unnecessary UPDATE on app_oauth_transactions';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.profiles', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.profiles', 'UPDATE') THEN
    RAISE EXCEPTION 'service_role lacks profile privileges required by same-origin auth routes';
  END IF;

  IF has_table_privilege('anon', 'public.app_session_revocation_states', 'SELECT')
    OR has_table_privilege('authenticated', 'public.app_session_revocation_states', 'SELECT') THEN
    RAISE EXCEPTION 'browser roles can read private session revocation state';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.app_session_revocation_states', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.app_session_revocation_states', 'UPDATE') THEN
    RAISE EXCEPTION 'service_role lacks private session revocation state privileges';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.revoke_all_app_sessions_for_user(uuid,text,timestamptz)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.create_or_rotate_bearer_app_session(uuid,uuid,timestamptz,text,text,text,text,timestamptz,timestamptz)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.is_bearer_auth_session_allowed(uuid,uuid,timestamptz)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated can execute private session lifecycle functions';
  END IF;
END;
$$;

SET ROLE service_role;

SELECT 'service_update=' || username
FROM public.admin_update_profile(
  '00000000-0000-0000-0000-000000000002',
  'updated-by-service',
  'admin',
  '00000000-0000-0000-0000-000000000001'
);

INSERT INTO public.app_oauth_transactions (
  id,
  provider,
  intent,
  return_to,
  browser_binding_hash,
  pkce_code_verifier,
  expires_at
)
VALUES (
  '10000000-0000-0000-0000-000000000001',
  'github',
  'login',
  '/settings',
  'browser-binding-hash',
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_',
  NOW() + INTERVAL '10 minutes'
);

WITH consumed AS (
  DELETE FROM public.app_oauth_transactions
  WHERE id = '10000000-0000-0000-0000-000000000001'
    AND provider = 'github'
    AND browser_binding_hash = 'browser-binding-hash'
    AND expires_at > NOW()
  RETURNING id
)
SELECT 'first_consume=' || COUNT(*) FROM consumed;

WITH replay AS (
  DELETE FROM public.app_oauth_transactions
  WHERE id = '10000000-0000-0000-0000-000000000001'
    AND provider = 'github'
    AND browser_binding_hash = 'browser-binding-hash'
    AND expires_at > NOW()
  RETURNING id
)
SELECT 'replay_consume=' || COUNT(*) FROM replay;

INSERT INTO public.app_oauth_transactions (
  id,
  provider,
  intent,
  return_to,
  browser_binding_hash,
  pkce_code_verifier,
  created_at,
  expires_at
)
VALUES (
  '10000000-0000-0000-0000-000000000002',
  'github',
  'login',
  '/',
  'expired-browser-binding-hash',
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_',
  NOW() - INTERVAL '20 minutes',
  NOW() - INTERVAL '10 minutes'
);

WITH cleaned AS (
  DELETE FROM public.app_oauth_transactions
  WHERE expires_at <= NOW()
  RETURNING id
)
SELECT 'expired_cleanup=' || COUNT(*) FROM cleaned;

RESET ROLE;

INSERT INTO public.app_sessions (
  id,
  user_id,
  session_token_hash,
  refresh_token_hash,
  expires_at,
  absolute_expires_at
)
VALUES (
  '20000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'email-change-session-hash',
  'email-change-refresh-hash',
  NOW() + INTERVAL '1 hour',
  NOW() + INTERVAL '1 day'
);

UPDATE auth.users
SET email = 'changed@example.invalid'
WHERE id = '00000000-0000-0000-0000-000000000002';

SELECT 'email_change_revoked=' || (
  revoked_at IS NOT NULL AND revoke_reason = 'auth_email_changed'
)
FROM public.app_sessions
WHERE id = '20000000-0000-0000-0000-000000000001';

INSERT INTO public.app_sessions (
  id,
  user_id,
  session_token_hash,
  refresh_token_hash,
  expires_at,
  absolute_expires_at
)
VALUES (
  '20000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000002',
  'password-change-session-hash',
  'password-change-refresh-hash',
  NOW() + INTERVAL '1 hour',
  NOW() + INTERVAL '1 day'
);

UPDATE auth.users
SET encrypted_password = 'new-password-hash'
WHERE id = '00000000-0000-0000-0000-000000000002';

SELECT 'password_change_revoked=' || (
  revoked_at IS NOT NULL AND revoke_reason = 'auth_password_changed'
)
FROM public.app_sessions
WHERE id = '20000000-0000-0000-0000-000000000002';

SET ROLE service_role;

SELECT 'old_bearer_allowed=' || public.is_bearer_auth_session_allowed(
  '00000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000001',
  NOW()
);

RESET ROLE;

SELECT pg_sleep(0.01);

INSERT INTO auth.sessions (id, user_id)
VALUES (
  '30000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000002'
);

SET ROLE service_role;

SELECT 'fresh_bearer_allowed=' || public.is_bearer_auth_session_allowed(
  '00000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000002',
  NOW()
);

SELECT 'first_bound_create=' || COUNT(*)
FROM public.create_or_rotate_bearer_app_session(
  '00000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000002',
  NOW(),
  'bound-session-hash-1',
  'bound-refresh-hash-1',
  NULL,
  NULL,
  NOW() + INTERVAL '1 hour',
  NOW() + INTERVAL '1 day'
);

SELECT 'second_bound_rotate=' || COUNT(*)
FROM public.create_or_rotate_bearer_app_session(
  '00000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000002',
  NOW(),
  'bound-session-hash-2',
  'bound-refresh-hash-2',
  NULL,
  NULL,
  NOW() + INTERVAL '1 hour',
  NOW() + INTERVAL '1 day'
);

RESET ROLE;

SELECT 'source_bound_count=' || COUNT(*)
FROM public.app_sessions
WHERE source_auth_session_id = '30000000-0000-0000-0000-000000000002';

SELECT 'authenticated_execute=' || has_function_privilege(
  'authenticated',
  'public.admin_update_profile(uuid,text,text,uuid)',
  'EXECUTE'
);
SELECT 'service_execute=' || has_function_privilege(
  'service_role',
  'public.admin_update_profile(uuid,text,text,uuid)',
  'EXECUTE'
);
SELECT 'authenticated_transaction_select=' || has_table_privilege(
  'authenticated',
  'public.app_oauth_transactions',
  'SELECT'
);
`.trim();
}

async function main() {
  const migrations = await Promise.all(migrationPaths.map((filePath) => readFile(filePath, 'utf8')));
  const dockerVersion = await run(
    'docker',
    ['version', '--format', '{{.Server.Version}}'],
    { allowFailure: true }
  );
  if (dockerVersion.code !== 0) {
    throw new Error('Docker daemon is not available for the PostgreSQL permission test.');
  }

  try {
    await run('docker', [
      'run',
      '--name',
      containerName,
      '--rm',
      '-d',
      '-e',
      'POSTGRES_PASSWORD=postgres',
      '-e',
      'POSTGRES_HOST_AUTH_METHOD=trust',
      postgresImage,
    ]);
    await waitForPostgres();

    const setupSql = [buildStubSql(), ...migrations].join('\n\n');
    await run(
      'docker',
      ['exec', '-i', containerName, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'],
      { input: setupSql }
    );
    const forgedAuthenticatedCall = await run(
      'docker',
      ['exec', '-i', containerName, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'],
      {
        allowFailure: true,
        input: `
SET ROLE authenticated;
SELECT public.admin_update_profile(
  '00000000-0000-0000-0000-000000000002',
  'forged-browser-update',
  'admin',
  '00000000-0000-0000-0000-000000000001'
);
`.trim(),
      }
    );
    if (
      forgedAuthenticatedCall.code === 0
      || !/permission denied for function admin_update_profile/iu.test(forgedAuthenticatedCall.stderr)
    ) {
      throw new Error(
        `Authenticated forged actor call was not rejected by PostgreSQL:\n${forgedAuthenticatedCall.stderr || forgedAuthenticatedCall.stdout}`
      );
    }

    const verification = await run(
      'docker',
      ['exec', '-i', containerName, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-At'],
      { input: buildVerificationSql() }
    );

    const output = verification.stdout.trim();
    const requiredMarkers = [
      'service_update=updated-by-service',
      'identity_owner=00000000-0000-0000-0000-000000000002',
      'first_consume=1',
      'replay_consume=0',
      'expired_cleanup=1',
      'email_change_revoked=true',
      'password_change_revoked=true',
      'old_bearer_allowed=false',
      'fresh_bearer_allowed=true',
      'first_bound_create=1',
      'second_bound_rotate=1',
      'source_bound_count=1',
      'authenticated_execute=false',
      'service_execute=true',
      'authenticated_transaction_select=false',
    ];
    const missingMarkers = requiredMarkers.filter((marker) => !output.includes(marker));
    if (missingMarkers.length > 0) {
      throw new Error(`Auth hardening PostgreSQL verification was incomplete:\n${output}`);
    }

    console.log('[verify-auth-hardening-phase-a] OK');
    console.log(`- image: ${postgresImage}`);
    console.log('- authenticated/PUBLIC admin RPC execution: denied');
    console.log('- service-role admin RPC execution: allowed');
    console.log('- OAuth identity owner immutability: verified');
    console.log('- OAuth transaction browser-role access: denied');
    console.log('- OAuth transaction conditional consumption: exactly once');
    console.log('- OAuth transaction expired-row cleanup: verified');
    console.log('- confirmed Auth email change session revocation: verified');
    console.log('- Auth password change session revocation: verified');
    console.log('- native Bearer revocation boundary and idempotent bootstrap: verified');
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error('[verify-auth-hardening-phase-a] Failed:', error);
  process.exitCode = 1;
});
