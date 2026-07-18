import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const baselinePath = path.join(projectRoot, 'supabase', 'baseline', '000_complete_schema.sql');
const postgresImage = process.env.BASELINE_SMOKE_POSTGRES_IMAGE || 'postgres:16-alpine';
const containerName = `endfield-baseline-smoke-${Date.now()}`;
const postgresPassword = 'postgres';
const databaseName = 'postgres';

function run(command, args, options = {}) {
  const { input, allowFailure = false } = options;

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
  for (let i = 0; i < 30; i += 1) {
    const result = await run('docker', ['exec', containerName, 'pg_isready', '-U', 'postgres'], { allowFailure: true });
    if (result.code === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('Timed out waiting for postgres container to become ready.');
}

async function cleanupContainer() {
  await run('docker', ['rm', '-f', containerName], { allowFailure: true });
}

function buildSupabaseStubSql() {
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
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  owner UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULL::UUID
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT 'authenticated'::TEXT
$$;
`.trim();
}

function buildVerificationSql() {
  return `
SELECT to_regclass('public.profiles') AS profiles_table;
SELECT to_regclass('public.account_recovery_requests') AS recovery_table;
SELECT to_regclass('public.public_profile_cache') AS profile_cache_table;
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'history'
  AND column_name IN ('server_id', 'region')
ORDER BY column_name;
SELECT proname
FROM pg_proc
WHERE proname IN ('get_global_stats', 'get_app_visible_pools', 'resolve_character_alias')
ORDER BY proname;
SELECT ((public.get_global_stats())::jsonb ? 'contributorsByRegion')::text AS has_contributor_regions;
SELECT (((public.get_global_stats())::jsonb -> 'byType' -> 'limited') ? 'avgPityTarget')::text AS has_limited_avg_pity_target;
SELECT (((public.get_global_stats())::jsonb -> 'byType' -> 'weapon') ? 'avgPityTarget')::text AS has_weapon_avg_pity_target;
SELECT 'limited_avg_target=' || COALESCE(((public.get_global_stats())::jsonb -> 'byType' -> 'limited' ->> 'avgPityTarget'), 'null');
SELECT 'weapon_avg_target=' || COALESCE(((public.get_global_stats())::jsonb -> 'byType' -> 'weapon' ->> 'avgPityTarget'), 'null');
`.trim();
}

function buildTargetIntervalFixtureSql() {
  return `
INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-000000000001', 'baseline-smoke@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pools (user_id, pool_id, name, type, up_character, is_limited_weapon)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'limited_pool', '限定池', 'limited', '目标A', true),
  ('00000000-0000-0000-0000-000000000001', 'weapon_pool', '武器池', 'weapon', '目标武器', true)
ON CONFLICT (user_id, pool_id) DO NOTHING;

INSERT INTO public.history (user_id, record_id, pool_id, rarity, is_standard, item_name)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'limited-001', 'limited_pool', 4, false, '填充1'),
  ('00000000-0000-0000-0000-000000000001', 'limited-002', 'limited_pool', 4, false, '填充2'),
  ('00000000-0000-0000-0000-000000000001', 'limited-003', 'limited_pool', 4, false, '填充3'),
  ('00000000-0000-0000-0000-000000000001', 'limited-004', 'limited_pool', 4, false, '填充4'),
  ('00000000-0000-0000-0000-000000000001', 'limited-005', 'limited_pool', 4, false, '填充5'),
  ('00000000-0000-0000-0000-000000000001', 'limited-006', 'limited_pool', 4, false, '填充6'),
  ('00000000-0000-0000-0000-000000000001', 'limited-007', 'limited_pool', 4, false, '填充7'),
  ('00000000-0000-0000-0000-000000000001', 'limited-008', 'limited_pool', 4, false, '填充8'),
  ('00000000-0000-0000-0000-000000000001', 'limited-009', 'limited_pool', 4, false, '填充9'),
  ('00000000-0000-0000-0000-000000000001', 'limited-010', 'limited_pool', 4, false, '填充10'),
  ('00000000-0000-0000-0000-000000000001', 'limited-011', 'limited_pool', 6, false, '目标A'),
  ('00000000-0000-0000-0000-000000000001', 'limited-012', 'limited_pool', 4, false, '填充12'),
  ('00000000-0000-0000-0000-000000000001', 'limited-013', 'limited_pool', 4, false, '填充13'),
  ('00000000-0000-0000-0000-000000000001', 'limited-014', 'limited_pool', 4, false, '填充14'),
  ('00000000-0000-0000-0000-000000000001', 'limited-015', 'limited_pool', 4, false, '填充15'),
  ('00000000-0000-0000-0000-000000000001', 'limited-016', 'limited_pool', 4, false, '填充16'),
  ('00000000-0000-0000-0000-000000000001', 'limited-017', 'limited_pool', 4, false, '填充17'),
  ('00000000-0000-0000-0000-000000000001', 'limited-018', 'limited_pool', 4, false, '填充18'),
  ('00000000-0000-0000-0000-000000000001', 'limited-019', 'limited_pool', 4, false, '填充19'),
  ('00000000-0000-0000-0000-000000000001', 'limited-020', 'limited_pool', 4, false, '填充20'),
  ('00000000-0000-0000-0000-000000000001', 'limited-021', 'limited_pool', 6, true, '常驻角色'),
  ('00000000-0000-0000-0000-000000000001', 'limited-022', 'limited_pool', 4, false, '填充22'),
  ('00000000-0000-0000-0000-000000000001', 'limited-023', 'limited_pool', 4, false, '填充23'),
  ('00000000-0000-0000-0000-000000000001', 'limited-024', 'limited_pool', 4, false, '填充24'),
  ('00000000-0000-0000-0000-000000000001', 'limited-025', 'limited_pool', 4, false, '填充25'),
  ('00000000-0000-0000-0000-000000000001', 'limited-026', 'limited_pool', 4, false, '填充26'),
  ('00000000-0000-0000-0000-000000000001', 'limited-027', 'limited_pool', 4, false, '填充27'),
  ('00000000-0000-0000-0000-000000000001', 'limited-028', 'limited_pool', 4, false, '填充28'),
  ('00000000-0000-0000-0000-000000000001', 'limited-029', 'limited_pool', 4, false, '填充29'),
  ('00000000-0000-0000-0000-000000000001', 'limited-030', 'limited_pool', 4, false, '填充30'),
  ('00000000-0000-0000-0000-000000000001', 'limited-031', 'limited_pool', 6, false, '目标A'),
  ('00000000-0000-0000-0000-000000000001', 'weapon-001', 'weapon_pool', 4, false, '武器填充1'),
  ('00000000-0000-0000-0000-000000000001', 'weapon-002', 'weapon_pool', 4, false, '武器填充2'),
  ('00000000-0000-0000-0000-000000000001', 'weapon-003', 'weapon_pool', 4, false, '武器填充3'),
  ('00000000-0000-0000-0000-000000000001', 'weapon-004', 'weapon_pool', 4, false, '武器填充4'),
  ('00000000-0000-0000-0000-000000000001', 'weapon-005', 'weapon_pool', 4, false, '武器填充5'),
  ('00000000-0000-0000-0000-000000000001', 'weapon-006', 'weapon_pool', 6, false, '目标武器'),
  ('00000000-0000-0000-0000-000000000001', 'weapon-007', 'weapon_pool', 4, false, '武器填充7'),
  ('00000000-0000-0000-0000-000000000001', 'weapon-008', 'weapon_pool', 4, false, '武器填充8'),
  ('00000000-0000-0000-0000-000000000001', 'weapon-009', 'weapon_pool', 4, false, '武器填充9'),
  ('00000000-0000-0000-0000-000000000001', 'weapon-010', 'weapon_pool', 6, true, '常驻武器'),
  ('00000000-0000-0000-0000-000000000001', 'weapon-011', 'weapon_pool', 4, false, '武器填充11'),
  ('00000000-0000-0000-0000-000000000001', 'weapon-012', 'weapon_pool', 4, false, '武器填充12'),
  ('00000000-0000-0000-0000-000000000001', 'weapon-013', 'weapon_pool', 4, false, '武器填充13'),
  ('00000000-0000-0000-0000-000000000001', 'weapon-014', 'weapon_pool', 4, false, '武器填充14'),
  ('00000000-0000-0000-0000-000000000001', 'weapon-015', 'weapon_pool', 4, false, '武器填充15'),
  ('00000000-0000-0000-0000-000000000001', 'weapon-016', 'weapon_pool', 6, false, '目标武器')
ON CONFLICT (user_id, record_id) DO NOTHING;

SELECT 'limited_avg_target=' || COALESCE(((public.get_global_stats())::jsonb -> 'byType' -> 'limited' ->> 'avgPityTarget'), 'null');
SELECT 'weapon_avg_target=' || COALESCE(((public.get_global_stats())::jsonb -> 'byType' -> 'weapon' ->> 'avgPityTarget'), 'null');
`.trim();
}

async function main() {
  const baselineSql = await readFile(baselinePath, 'utf8');

  const dockerVersion = await run('docker', ['version', '--format', '{{.Server.Version}}'], { allowFailure: true });
  if (dockerVersion.code !== 0) {
    throw new Error(
      'Docker daemon is not available. Start Docker Desktop or another Docker engine before running this smoke test.'
    );
  }

  try {
    await run('docker', [
      'run',
      '--name',
      containerName,
      '--rm',
      '-d',
      '-e',
      `POSTGRES_PASSWORD=${postgresPassword}`,
      '-e',
      'POSTGRES_HOST_AUTH_METHOD=trust',
      postgresImage,
    ]);

    await waitForPostgres();

    await run(
      'docker',
      ['exec', '-i', containerName, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', databaseName],
      { input: `${buildSupabaseStubSql()}\n` }
    );

    await run(
      'docker',
      ['exec', '-i', containerName, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', databaseName],
      { input: baselineSql }
    );

    await run(
      'docker',
      ['exec', '-i', containerName, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', databaseName],
      { input: `${buildTargetIntervalFixtureSql()}\n` }
    );

    const verification = await run(
      'docker',
      ['exec', '-i', containerName, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', databaseName, '-At'],
      { input: `${buildVerificationSql()}\n` }
    );

    const output = verification.stdout.trim();
    const requiredMarkers = [
      'profiles',
      'account_recovery_requests',
      'public_profile_cache',
      'server_id',
      'region',
      'get_app_visible_pools',
      'get_global_stats',
      'resolve_character_alias',
      'true',
      'limited_avg_target=15.5',
      'weapon_avg_target=8.0',
    ];
    const missingMarkers = requiredMarkers.filter((marker) => !output.includes(marker));

    if (missingMarkers.length > 0) {
      throw new Error(`Baseline smoke verification returned incomplete output:\n${output}`);
    }

    console.log('[verify-supabase-baseline-smoke] OK');
    console.log(`- image: ${postgresImage}`);
    console.log(`- baseline: ${baselinePath}`);
    console.log(output);
  } finally {
    await cleanupContainer();
  }
}

main().catch((error) => {
  console.error('[verify-supabase-baseline-smoke] Failed:', error);
  process.exitCode = 1;
});
