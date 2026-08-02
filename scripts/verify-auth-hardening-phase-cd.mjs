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
CREATE EXTENSION IF NOT EXISTS pgcrypto;
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
  raw_app_meta_data JSONB DEFAULT '{}'::jsonb,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb
);
CREATE TABLE auth.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT NULL::UUID $$;
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
    OR has_function_privilege('authenticated', 'public.has_verified_password_login(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute private credential RPCs';
  END IF;
END $$;

RESET ROLE;
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
      'expired_credential_allowed=false',
      'atomic_temporary_state=true',
      'identity_migrated=current-subject-hash:v2',
      'verified_password_login=true',
      'missing_password_login=false',
      'identity_owner=00000000-0000-4000-8000-000000000001',
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
