import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const migrationPath = path.join(projectRoot, 'supabase', 'migrations', '155_guard_ambiguous_history_batch_delete.sql');
const postgresImage = process.env.HISTORY_DELETE_GUARD_POSTGRES_IMAGE || 'postgres:16-alpine';
const containerName = `endfield-history-delete-guard-${Date.now()}`;

function run(command, args, { input, allowFailure = false } = {}) {
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
  throw new Error('Timed out waiting for the PostgreSQL test container.');
}

async function executeSql(sql, { tuplesOnly = false } = {}) {
  const args = ['exec', '-i', containerName, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'];
  if (tuplesOnly) args.push('-At');
  return run('docker', args, { input: sql });
}

function buildSchemaSql() {
  return `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;

CREATE TABLE public.history (
  user_id UUID NOT NULL,
  record_id TEXT NOT NULL,
  game_uid TEXT NOT NULL,
  server_scope TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  seq_id TEXT NOT NULL,
  timestamp TIMESTAMPTZ,
  character_id TEXT,
  character_name TEXT,
  item_name TEXT,
  rarity INTEGER,
  is_free BOOLEAN DEFAULT FALSE,
  is_info_book BOOLEAN DEFAULT FALSE,
  is_standard BOOLEAN DEFAULT FALSE,
  special_type TEXT,
  PRIMARY KEY (user_id, game_uid, server_scope, pool_id, seq_id)
);

CREATE TABLE public.history_change_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  record_id TEXT NOT NULL,
  actor_user_id UUID NOT NULL,
  operation TEXT NOT NULL,
  changed_fields JSONB NOT NULL,
  old_values JSONB NOT NULL,
  new_values JSONB NOT NULL,
  reason TEXT,
  source TEXT NOT NULL
);

CREATE OR REPLACE FUNCTION public.recompute_history_scope(UUID, TEXT, TEXT, TEXT)
RETURNS INTEGER
LANGUAGE sql
AS $$ SELECT 0 $$;
`.trim();
}

function buildFixtureSql() {
  return `
INSERT INTO public.history (
  user_id, record_id, game_uid, server_scope, pool_id, seq_id, item_name, rarity
) VALUES
  ('00000000-0000-0000-0000-000000000001', 'shared-id', 'game-a', 'cn:1', 'pool-a', '1', 'A', 4),
  ('00000000-0000-0000-0000-000000000001', 'shared-id', 'game-b', 'intl:2', 'pool-b', '1', 'B', 5),
  ('00000000-0000-0000-0000-000000000001', 'unique-id', 'game-a', 'cn:1', 'pool-a', '2', 'C', 6);

DO $$
BEGIN
  BEGIN
    PERFORM public.delete_history_records_controlled(
      '00000000-0000-0000-0000-000000000001',
      ARRAY['shared-id']::TEXT[],
      'guard smoke'
    );
    RAISE EXCEPTION 'expected ambiguous_history_record_id';
  EXCEPTION
    WHEN cardinality_violation THEN
      IF SQLERRM <> 'ambiguous_history_record_id' THEN RAISE; END IF;
  END;
END $$;

DO $$
DECLARE
  v_result JSONB;
BEGIN
  IF (SELECT COUNT(*) FROM public.history WHERE record_id = 'shared-id') <> 2 THEN
    RAISE EXCEPTION 'ambiguous rows changed despite guard';
  END IF;
  IF (SELECT COUNT(*) FROM public.history_change_log) <> 0 THEN
    RAISE EXCEPTION 'ambiguous deletion wrote an audit row';
  END IF;

  v_result := public.delete_history_records_controlled(
    '00000000-0000-0000-0000-000000000001',
    ARRAY['unique-id']::TEXT[],
    'guard smoke'
  );
  IF COALESCE((v_result ->> 'deleted')::INTEGER, 0) <> 1 THEN
    RAISE EXCEPTION 'unique deletion returned an unexpected count: %', v_result;
  END IF;
  IF EXISTS (SELECT 1 FROM public.history WHERE record_id = 'unique-id') THEN
    RAISE EXCEPTION 'unique row was not deleted';
  END IF;
  IF (SELECT COUNT(*) FROM public.history_change_log WHERE record_id = 'unique-id') <> 1 THEN
    RAISE EXCEPTION 'unique deletion did not write exactly one audit row';
  END IF;
END $$;

SELECT 'history_batch_delete_guard=ok';
`.trim();
}

async function main() {
  const migrationSql = await readFile(migrationPath, 'utf8');
  const dockerVersion = await run('docker', ['version', '--format', '{{.Server.Version}}'], { allowFailure: true });
  if (dockerVersion.code !== 0) {
    throw new Error('Docker daemon is not available.');
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
    await executeSql(`${buildSchemaSql()}\n`);
    await executeSql(migrationSql);
    const verification = await executeSql(`${buildFixtureSql()}\n`, { tuplesOnly: true });
    if (!verification.stdout.includes('history_batch_delete_guard=ok')) {
      throw new Error(`Guard verification returned incomplete output:\n${verification.stdout}`);
    }

    console.log('[verify-history-batch-delete-guard] OK');
    console.log(`- image: ${postgresImage}`);
    console.log(`- migration: ${migrationPath}`);
  } finally {
    await run('docker', ['rm', '-f', containerName], { allowFailure: true });
  }
}

main().catch((error) => {
  console.error('[verify-history-batch-delete-guard] Failed:', error);
  process.exitCode = 1;
});
