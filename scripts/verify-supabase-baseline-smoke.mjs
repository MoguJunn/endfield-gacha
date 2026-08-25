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
  email_confirmed_at TIMESTAMPTZ,
  encrypted_password TEXT,
  raw_app_meta_data JSONB DEFAULT '{}'::jsonb,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS auth.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
SELECT 'service_profiles_select=' || has_table_privilege('service_role', 'public.profiles', 'SELECT');
SELECT 'service_profiles_update=' || has_table_privilege('service_role', 'public.profiles', 'UPDATE');
SELECT 'service_revocation_select=' || has_table_privilege('service_role', 'public.app_session_revocation_states', 'SELECT');
SELECT 'anon_revocation_select=' || has_table_privilege('anon', 'public.app_session_revocation_states', 'SELECT');
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

function buildPersonalAnalysisScopeRevisionFixtureSql() {
  return `
DO $fixture$
DECLARE
  v_user_id UUID := '00000000-0000-0000-0000-000000000001';
  v_cascade_user_id UUID := '00000000-0000-0000-0000-000000000002';
  v_revision BIGINT;
  v_revision_before BIGINT;
BEGIN
  INSERT INTO public.history (
    user_id,
    record_id,
    pool_id,
    rarity,
    is_standard,
    item_name,
    timestamp,
    game_uid,
    seq_id,
    server_id,
    region,
    pity,
    batch_id
  ) VALUES
    (
      v_user_id,
      'revision-record-1',
      'revision-pool',
      4,
      FALSE,
      'Revision fixture 1',
      '2026-08-04T12:00:00.000Z',
      'revision-game',
      '1',
      '1',
      'cn',
      1,
      'revision-batch-1'
    ),
    (
      v_user_id,
      'revision-record-2',
      'revision-pool',
      4,
      FALSE,
      'Revision fixture 2',
      '2026-08-04T12:01:00.000Z',
      'revision-game',
      '2',
      '1',
      'cn',
      2,
      'revision-batch-1'
    );

  SELECT history_revision
  INTO v_revision
  FROM public.personal_analysis_scope_state
  WHERE user_id = v_user_id
    AND scope_game_uid = 'revision-game'
    AND server_scope = '1';

  IF v_revision <> 1 THEN
    RAISE EXCEPTION 'analysis_scope_insert_revision_expected_1_got_%', v_revision;
  END IF;

  UPDATE public.history
  SET
    batch_id = 'revision-derived-only'
  WHERE user_id = v_user_id
    AND game_uid = 'revision-game'
    AND server_scope = '1';

  SELECT history_revision
  INTO v_revision
  FROM public.personal_analysis_scope_state
  WHERE user_id = v_user_id
    AND scope_game_uid = 'revision-game'
    AND server_scope = '1';

  IF v_revision <> 1 THEN
    RAISE EXCEPTION 'analysis_scope_derived_update_changed_revision_%', v_revision;
  END IF;

  UPDATE public.history
  SET pity = pity + 1
  WHERE user_id = v_user_id
    AND game_uid = 'revision-game'
    AND server_scope = '1';

  SELECT history_revision
  INTO v_revision
  FROM public.personal_analysis_scope_state
  WHERE user_id = v_user_id
    AND scope_game_uid = 'revision-game'
    AND server_scope = '1';

  IF v_revision <> 2 THEN
    RAISE EXCEPTION 'analysis_scope_pity_update_revision_expected_2_got_%', v_revision;
  END IF;

  UPDATE public.history
  SET rarity = 5
  WHERE user_id = v_user_id
    AND record_id = 'revision-record-1';

  SELECT history_revision
  INTO v_revision
  FROM public.personal_analysis_scope_state
  WHERE user_id = v_user_id
    AND scope_game_uid = 'revision-game'
    AND server_scope = '1';

  IF v_revision <> 3 THEN
    RAISE EXCEPTION 'analysis_scope_input_update_revision_expected_3_got_%', v_revision;
  END IF;

  UPDATE public.history
  SET
    server_id = '2',
    region = 'intl'
  WHERE user_id = v_user_id
    AND record_id = 'revision-record-1';

  IF NOT EXISTS (
    SELECT 1
    FROM public.personal_analysis_scope_state
    WHERE user_id = v_user_id
      AND scope_game_uid = 'revision-game'
      AND server_scope = '1'
      AND history_revision = 4
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.personal_analysis_scope_state
    WHERE user_id = v_user_id
      AND scope_game_uid = 'revision-game'
      AND server_scope = '2'
      AND history_revision = 1
  ) THEN
    RAISE EXCEPTION 'analysis_scope_move_did_not_invalidate_old_and_new_scopes';
  END IF;

  DELETE FROM public.history
  WHERE user_id = v_user_id
    AND record_id = 'revision-record-1';

  IF NOT EXISTS (
    SELECT 1
    FROM public.personal_analysis_scope_state
    WHERE user_id = v_user_id
      AND scope_game_uid = 'revision-game'
      AND server_scope = '2'
      AND history_revision = 2
  ) THEN
    RAISE EXCEPTION 'analysis_scope_delete_revision_not_incremented';
  END IF;

  SELECT history_revision
  INTO v_revision_before
  FROM public.personal_analysis_scope_state
  WHERE user_id = v_user_id
    AND scope_game_uid = 'revision-game'
    AND server_scope = '1';

  INSERT INTO public.history (
    user_id,
    record_id,
    pool_id,
    rarity,
    is_standard,
    item_name,
    timestamp,
    game_uid,
    seq_id,
    server_id,
    region
  ) VALUES
    (
      v_user_id,
      'revision-record-2',
      'revision-pool',
      5,
      FALSE,
      'Revision fixture 2 updated',
      '2026-08-04T12:01:00.000Z',
      'revision-game',
      '2',
      '1',
      'cn'
    ),
    (
      v_user_id,
      'revision-record-3',
      'revision-pool',
      4,
      FALSE,
      'Revision fixture 3',
      '2026-08-04T12:02:00.000Z',
      'revision-game',
      '3',
      '1',
      'cn'
    )
  ON CONFLICT ON CONSTRAINT history_user_game_server_scope_pool_seq_unique
  DO UPDATE SET
    rarity = EXCLUDED.rarity,
    item_name = EXCLUDED.item_name;

  SELECT history_revision
  INTO v_revision
  FROM public.personal_analysis_scope_state
  WHERE user_id = v_user_id
    AND scope_game_uid = 'revision-game'
    AND server_scope = '1';

  IF v_revision <= v_revision_before THEN
    RAISE EXCEPTION 'analysis_scope_mixed_upsert_did_not_advance_revision';
  END IF;

  INSERT INTO auth.users (id, email)
  VALUES (v_cascade_user_id, 'scope-cascade@example.com');

  INSERT INTO public.history (
    user_id,
    record_id,
    pool_id,
    rarity,
    game_uid,
    seq_id,
    server_id
  ) VALUES (
    v_cascade_user_id,
    'cascade-record-1',
    'cascade-pool',
    4,
    'cascade-game',
    '1',
    '1'
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.personal_analysis_scope_state
    WHERE user_id = v_cascade_user_id
      AND scope_game_uid = 'cascade-game'
      AND server_scope = '1'
  ) THEN
    RAISE EXCEPTION 'analysis_scope_cascade_fixture_state_missing';
  END IF;

  DELETE FROM auth.users
  WHERE id = v_cascade_user_id;

  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = v_cascade_user_id
  ) OR EXISTS (
    SELECT 1
    FROM public.history
    WHERE user_id = v_cascade_user_id
  ) OR EXISTS (
    SELECT 1
    FROM public.personal_analysis_scope_state
    WHERE user_id = v_cascade_user_id
  ) OR EXISTS (
    SELECT 1
    FROM public.personal_analysis_owner_state
    WHERE user_id = v_cascade_user_id
  ) THEN
    RAISE EXCEPTION 'analysis_scope_cascade_delete_left_rows';
  END IF;

  IF NOT has_table_privilege(
    'authenticated',
    'public.personal_analysis_scope_state',
    'SELECT'
  ) OR has_table_privilege(
    'authenticated',
    'public.personal_analysis_scope_state',
    'INSERT'
  ) OR has_table_privilege(
    'anon',
    'public.personal_analysis_scope_state',
    'SELECT'
  ) OR NOT has_table_privilege(
    'service_role',
    'public.personal_analysis_scope_state',
    'UPDATE'
  ) THEN
    RAISE EXCEPTION 'analysis_scope_state_privileges_invalid';
  END IF;
END;
$fixture$;

SELECT 'personal_analysis_scope_revisions=ok';
`.trim();
}

function buildPersonalAnalysisSnapshotQueueFixtureSql() {
  return `
DO $fixture$
DECLARE
  v_user_id UUID := '00000000-0000-0000-0000-000000000001';
  v_lease_id UUID := '00000000-0000-0000-0000-000000000174';
  v_backfill JSONB;
  v_claimed JSONB;
  v_owner_revision BIGINT;
  v_scope_revision BIGINT;
  v_published BOOLEAN;
  v_failed BOOLEAN;
  v_retry_state JSONB;
BEGIN
  DELETE FROM public.personal_analysis_owner_state
  WHERE user_id = v_user_id;

  DELETE FROM public.personal_analysis_scope_state
  WHERE user_id = v_user_id
    AND scope_game_uid = 'revision-game'
    AND server_scope = '1';

  SELECT public.enqueue_personal_analysis_backfill(NULL, 100)
  INTO v_backfill;

  IF (v_backfill ->> 'processedUsers')::INTEGER < 1
    OR NOT EXISTS (
      SELECT 1
      FROM public.personal_analysis_owner_state
      WHERE user_id = v_user_id
        AND history_revision = 1
        AND snapshot_revision = -1
    )
    OR NOT EXISTS (
      SELECT 1
      FROM public.personal_analysis_scope_state
      WHERE user_id = v_user_id
        AND scope_game_uid = 'revision-game'
        AND server_scope = '1'
        AND history_revision = 1
        AND snapshot_revision = -1
    )
  THEN
    RAISE EXCEPTION 'personal_analysis_backfill_failed: %', v_backfill;
  END IF;

  SELECT public.claim_personal_analysis_jobs(v_lease_id, 50, 180)
  INTO v_claimed;

  IF jsonb_array_length(v_claimed -> 'ownerJobs') < 1
    OR jsonb_array_length(v_claimed -> 'scopeJobs') < 1
  THEN
    RAISE EXCEPTION 'personal_analysis_claim_failed: %', v_claimed;
  END IF;

  SELECT history_revision
  INTO v_owner_revision
  FROM public.personal_analysis_owner_state
  WHERE user_id = v_user_id;

  SELECT public.publish_personal_analysis_owner_snapshot(
    v_user_id,
    v_owner_revision,
    1,
    jsonb_build_object(
      'defaultAccountKey', 'revision-game::server:1',
      'accounts', jsonb_build_array(jsonb_build_object(
        'accountKey', 'revision-game::server:1'
      )),
      'summary', jsonb_build_object('total', 3)
    ),
    v_lease_id
  )
  INTO v_published;

  IF v_published IS NOT TRUE THEN
    RAISE EXCEPTION 'personal_analysis_owner_publish_failed';
  END IF;

  SELECT history_revision
  INTO v_scope_revision
  FROM public.personal_analysis_scope_state
  WHERE user_id = v_user_id
    AND scope_game_uid = 'revision-game'
    AND server_scope = '1';

  SELECT public.publish_personal_analysis_scope_snapshots(
    v_user_id,
    'revision-game',
    '1',
    v_scope_revision,
    1,
    jsonb_build_array(jsonb_build_object(
      'scopeKey', 'revision-game::server:1',
      'payload', jsonb_build_object(
        'account', jsonb_build_object('accountKey', 'revision-game::server:1'),
        'selector', jsonb_build_object('totalPulls', 3),
        'dashboard', jsonb_build_object('views', '{}'::JSONB)
      )
    )),
    v_lease_id
  )
  INTO v_published;

  IF v_published IS NOT TRUE
    OR NOT EXISTS (
      SELECT 1
      FROM public.personal_analysis_snapshots
      WHERE user_id = v_user_id
        AND scope_kind = 'owner'
        AND scope_key = 'owner'
        AND input_revision = v_owner_revision
    )
    OR NOT EXISTS (
      SELECT 1
      FROM public.personal_analysis_snapshots
      WHERE user_id = v_user_id
        AND scope_kind = 'account'
        AND scope_key = 'revision-game::server:1'
        AND source_game_uid = 'revision-game'
        AND source_server_scope = '1'
        AND input_revision = v_scope_revision
    )
  THEN
    RAISE EXCEPTION 'personal_analysis_revision_safe_publish_failed';
  END IF;

  SELECT history_revision
  INTO v_scope_revision
  FROM public.personal_analysis_scope_state
  WHERE user_id = v_user_id
    AND scope_game_uid = 'revision-game'
    AND server_scope = '2';

  INSERT INTO public.history (
    user_id,
    record_id,
    pool_id,
    rarity,
    game_uid,
    seq_id,
    server_id,
    region
  ) VALUES (
    v_user_id,
    'revision-stale-publish',
    'revision-pool',
    4,
    'revision-game',
    '99',
    '2',
    'intl'
  );

  SELECT public.publish_personal_analysis_scope_snapshots(
    v_user_id,
    'revision-game',
    '2',
    v_scope_revision,
    1,
    jsonb_build_array(jsonb_build_object(
      'scopeKey', 'revision-game::server:2',
      'payload', jsonb_build_object('selector', jsonb_build_object('totalPulls', 1))
    )),
    v_lease_id
  )
  INTO v_published;

  IF v_published IS NOT FALSE
    OR EXISTS (
      SELECT 1
      FROM public.personal_analysis_snapshots
      WHERE user_id = v_user_id
        AND scope_kind = 'account'
        AND scope_key = 'revision-game::server:2'
    )
  THEN
    RAISE EXCEPTION 'personal_analysis_stale_publish_was_not_rejected';
  END IF;

  UPDATE public.personal_analysis_scope_state
  SET
    lease_id = v_lease_id,
    lease_expires_at = statement_timestamp() + INTERVAL '50 seconds'
  WHERE user_id = v_user_id
    AND scope_game_uid = 'revision-game'
    AND server_scope = '2';

  SELECT public.fail_personal_analysis_job(
    'scope',
    v_user_id,
    'revision-game',
    '2',
    v_lease_id,
    'fixture_failure'
  ) INTO v_failed;

  SELECT to_jsonb(state_row)
  INTO v_retry_state
  FROM public.personal_analysis_scope_state AS state_row
  WHERE user_id = v_user_id
    AND scope_game_uid = 'revision-game'
    AND server_scope = '2';

  IF v_failed IS NOT TRUE OR NOT (
    SELECT
      attempt_count = 1
      AND next_attempt_at > statement_timestamp()
      AND lease_id IS NULL
    FROM public.personal_analysis_scope_state
    WHERE user_id = v_user_id
      AND scope_game_uid = 'revision-game'
      AND server_scope = '2'
  ) THEN
    RAISE EXCEPTION 'personal_analysis_failure_backoff_not_recorded: failed=%, state=%',
      v_failed,
      v_retry_state;
  END IF;

  UPDATE public.personal_analysis_scope_state
  SET history_revision = history_revision + 1
  WHERE user_id = v_user_id
    AND scope_game_uid = 'revision-game'
    AND server_scope = '2';

  IF NOT EXISTS (
    SELECT 1
    FROM public.personal_analysis_scope_state
    WHERE user_id = v_user_id
      AND scope_game_uid = 'revision-game'
      AND server_scope = '2'
      AND attempt_count = 0
      AND next_attempt_at IS NULL
  ) THEN
    RAISE EXCEPTION 'personal_analysis_new_revision_did_not_reset_backoff';
  END IF;

  IF NOT has_table_privilege(
    'authenticated',
    'public.personal_analysis_snapshots',
    'SELECT'
  ) OR has_table_privilege(
    'authenticated',
    'public.personal_analysis_snapshots',
    'INSERT'
  ) OR has_table_privilege(
    'anon',
    'public.personal_analysis_snapshots',
    'SELECT'
  ) OR has_function_privilege(
    'authenticated',
    'public.claim_personal_analysis_jobs(uuid,integer,integer)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.claim_personal_analysis_jobs(uuid,integer,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'personal_analysis_snapshot_privileges_invalid';
  END IF;

  -- Keep this fixture isolated from the legacy global-stat assertions that
  -- run after it. Snapshot/state rows may remain; only raw history affects
  -- those aggregate expectations.
  DELETE FROM public.history
  WHERE user_id = v_user_id
    AND pool_id = 'revision-pool';
END;
$fixture$;

SELECT 'personal_analysis_snapshot_queue=ok';
`.trim();
}

function buildPersonalAnalysisCatalogInvalidationFixtureSql() {
  return `
DO $fixture$
DECLARE
  v_user_id UUID := '00000000-0000-0000-0000-000000000001';
  v_scope_before BIGINT;
  v_owner_before BIGINT;
  v_scope_after BIGINT;
  v_owner_after BIGINT;
BEGIN
  SELECT history_revision
  INTO v_scope_before
  FROM public.personal_analysis_scope_state
  WHERE user_id = v_user_id
    AND scope_game_uid = 'legacy'
    AND server_scope = 'legacy';

  SELECT history_revision
  INTO v_owner_before
  FROM public.personal_analysis_owner_state
  WHERE user_id = v_user_id;

  UPDATE public.pools
  SET up_character = '目录失效测试目标'
  WHERE pool_id = 'limited_pool';

  SELECT history_revision
  INTO v_scope_after
  FROM public.personal_analysis_scope_state
  WHERE user_id = v_user_id
    AND scope_game_uid = 'legacy'
    AND server_scope = 'legacy';

  SELECT history_revision
  INTO v_owner_after
  FROM public.personal_analysis_owner_state
  WHERE user_id = v_user_id;

  IF v_scope_after <> v_scope_before + 1
    OR v_owner_after <> v_owner_before + 1
  THEN
    RAISE EXCEPTION 'personal_analysis_pool_catalog_invalidation_failed';
  END IF;

  UPDATE public.pools
  SET up_character = '目标A'
  WHERE pool_id = 'limited_pool';

  INSERT INTO public.characters (
    id,
    name,
    rarity,
    type,
    aliases,
    is_limited
  ) VALUES (
    'catalog-invalidation-character',
    '目录失效测试角色',
    4,
    'character',
    ARRAY[]::TEXT[],
    FALSE
  );

  UPDATE public.history
  SET
    character_id = 'catalog-invalidation-character',
    character_name = '目录失效测试角色'
  WHERE user_id = v_user_id
    AND record_id = 'limited-001';

  SELECT history_revision
  INTO v_scope_before
  FROM public.personal_analysis_scope_state
  WHERE user_id = v_user_id
    AND scope_game_uid = 'legacy'
    AND server_scope = 'legacy';

  SELECT history_revision
  INTO v_owner_before
  FROM public.personal_analysis_owner_state
  WHERE user_id = v_user_id;

  UPDATE public.characters
  SET is_limited = TRUE
  WHERE id = 'catalog-invalidation-character';

  SELECT history_revision
  INTO v_scope_after
  FROM public.personal_analysis_scope_state
  WHERE user_id = v_user_id
    AND scope_game_uid = 'legacy'
    AND server_scope = 'legacy';

  SELECT history_revision
  INTO v_owner_after
  FROM public.personal_analysis_owner_state
  WHERE user_id = v_user_id;

  IF v_scope_after <> v_scope_before + 1
    OR v_owner_after <> v_owner_before + 1
  THEN
    RAISE EXCEPTION 'personal_analysis_character_catalog_invalidation_failed';
  END IF;

  UPDATE public.history
  SET
    character_id = NULL,
    character_name = NULL
  WHERE user_id = v_user_id
    AND record_id = 'limited-001';

  DELETE FROM public.characters
  WHERE id = 'catalog-invalidation-character';

  IF has_function_privilege(
    'authenticated',
    'public.invalidate_personal_analysis_dependencies(text[],text[],text[])',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.invalidate_personal_analysis_dependencies(text[],text[],text[])',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'personal_analysis_catalog_invalidation_privileges_invalid';
  END IF;
END;
$fixture$;

SELECT 'personal_analysis_catalog_invalidation=ok';
`.trim();
}

function buildOfficialImportCommitFixtureSql() {
  return `
DO $fixture$
DECLARE
  v_result JSONB;
  v_user_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
  INSERT INTO public.official_import_tasks (
    id,
    user_id,
    source,
    import_mode,
    game_uid,
    server_id,
    status,
    access_key_hash,
    summary
  ) VALUES (
    '00000000-0000-0000-0000-000000000101',
    v_user_id,
    'cn',
    'incremental',
    'rpc-game-1',
    '1',
    'confirming',
    'fixture-access-key-hash-1',
    '{"newRecords":1}'::JSONB
  );

  SELECT public.commit_official_import_records(
    '00000000-0000-0000-0000-000000000101',
    v_user_id,
    jsonb_build_array(jsonb_build_object(
      'pool_id', 'rpc_pool',
      'name', 'RPC fixture pool',
      'type', 'limited'
    )),
    jsonb_build_array(jsonb_build_object(
      'record_id', 'rpc-record-1',
      'pool_id', 'rpc_pool',
      'seq_id', 'rpc-seq-1',
      'game_uid', 'rpc-game-1',
      'nick_name', 'RPC fixture user',
      'rarity', 6,
      'character_name', 'RPC fixture character',
      'item_name', 'RPC fixture character',
      'character_id', 'rpc-character-1',
      'timestamp', '2026-08-03T12:00:00.000Z',
      'pity', 99,
      'is_free', TRUE,
      'is_info_book', TRUE,
      'is_new', TRUE,
      'is_standard', FALSE,
      'server_id', '1',
      'region', 'cn',
      'batch_id', 'rpc-batch-1',
      'special_type', 'guaranteed'
    ))
  ) INTO v_result;

  IF (v_result ->> 'savedRecords')::INTEGER <> 1
    OR (v_result ->> 'atomicCommit')::BOOLEAN IS NOT TRUE
  THEN
    RAISE EXCEPTION 'official_import_fixture_first_commit_failed: %', v_result;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.history
    WHERE user_id = v_user_id
      AND game_uid = 'rpc-game-1'
      AND server_scope = '1'
      AND pool_id = 'rpc_pool'
      AND seq_id = 'rpc-seq-1'
      AND record_id = 'rpc-record-1'
      AND nick_name = 'RPC fixture user'
      AND character_name = 'RPC fixture character'
      AND character_id = 'rpc-character-1'
      AND pity = 80
      AND is_free IS TRUE
      AND is_info_book IS TRUE
      AND is_new IS TRUE
      AND region = 'cn'
      AND batch_id = 'rpc-batch-1'
      AND special_type = 'guaranteed'
  ) THEN
    RAISE EXCEPTION 'official_import_fixture_full_payload_missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.official_import_tasks
    WHERE id = '00000000-0000-0000-0000-000000000101'
      AND status = 'committed'
      AND committed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'official_import_fixture_task_not_committed';
  END IF;

  INSERT INTO public.official_import_tasks (
    id,
    user_id,
    source,
    import_mode,
    game_uid,
    server_id,
    status,
    access_key_hash,
    summary
  ) VALUES (
    '00000000-0000-0000-0000-000000000102',
    v_user_id,
    'cn',
    'incremental',
    'rpc-game-1',
    '1',
    'confirming',
    'fixture-access-key-hash-2',
    '{"newRecords":1}'::JSONB
  );

  PERFORM public.commit_official_import_records(
    '00000000-0000-0000-0000-000000000102',
    v_user_id,
    '[]'::JSONB,
    jsonb_build_array(jsonb_build_object(
      'record_id', 'rpc-record-2',
      'pool_id', 'rpc_pool',
      'seq_id', 'rpc-seq-1',
      'game_uid', 'rpc-game-1',
      'nick_name', 'RPC fixture updated',
      'rarity', 5,
      'character_name', 'RPC fixture updated character',
      'item_name', 'RPC fixture updated character',
      'character_id', 'rpc-character-2',
      'timestamp', '2026-08-03T12:01:00.000Z',
      'pity', 7,
      'is_free', FALSE,
      'is_info_book', FALSE,
      'is_new', FALSE,
      'is_standard', TRUE,
      'server_id', '1',
      'region', 'cn',
      'batch_id', 'rpc-batch-2',
      'special_type', 'gift'
    ))
  );

  IF (SELECT COUNT(*) FROM public.history
      WHERE user_id = v_user_id
        AND game_uid = 'rpc-game-1'
        AND server_scope = '1'
        AND pool_id = 'rpc_pool'
        AND seq_id = 'rpc-seq-1') <> 1
  THEN
    RAISE EXCEPTION 'official_import_fixture_conflict_created_duplicate';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.history
    WHERE user_id = v_user_id
      AND game_uid = 'rpc-game-1'
      AND server_scope = '1'
      AND pool_id = 'rpc_pool'
      AND seq_id = 'rpc-seq-1'
      AND record_id = 'rpc-record-2'
      AND nick_name = 'RPC fixture updated'
      AND character_name = 'RPC fixture updated character'
      AND character_id = 'rpc-character-2'
      AND pity = 7
      AND is_standard IS TRUE
      AND batch_id = 'rpc-batch-2'
      AND special_type = 'gift'
  ) THEN
    RAISE EXCEPTION 'official_import_fixture_conflict_update_incomplete';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.commit_official_import_records(uuid,uuid,jsonb,jsonb)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.commit_official_import_records(uuid,uuid,jsonb,jsonb)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.commit_official_import_records(uuid,uuid,jsonb,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'official_import_fixture_function_privileges_invalid';
  END IF;
END;
$fixture$;

SELECT 'official_import_rpc=ok';
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

    const personalAnalysisScopeVerification = await run(
      'docker',
      ['exec', '-i', containerName, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', databaseName, '-At'],
      { input: `${buildPersonalAnalysisScopeRevisionFixtureSql()}\n` }
    );

    if (!personalAnalysisScopeVerification.stdout.includes('personal_analysis_scope_revisions=ok')) {
      throw new Error(
        `Personal analysis scope verification returned incomplete output:\n${personalAnalysisScopeVerification.stdout}`
      );
    }

    const personalAnalysisSnapshotQueueVerification = await run(
      'docker',
      ['exec', '-i', containerName, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', databaseName, '-At'],
      { input: `${buildPersonalAnalysisSnapshotQueueFixtureSql()}\n` }
    );

    if (!personalAnalysisSnapshotQueueVerification.stdout.includes('personal_analysis_snapshot_queue=ok')) {
      throw new Error(
        `Personal analysis snapshot queue verification returned incomplete output:\n${personalAnalysisSnapshotQueueVerification.stdout}`
      );
    }

    const personalAnalysisCatalogInvalidationVerification = await run(
      'docker',
      ['exec', '-i', containerName, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', databaseName, '-At'],
      { input: `${buildPersonalAnalysisCatalogInvalidationFixtureSql()}\n` }
    );

    if (!personalAnalysisCatalogInvalidationVerification.stdout.includes('personal_analysis_catalog_invalidation=ok')) {
      throw new Error(
        `Personal analysis catalog invalidation verification returned incomplete output:\n${personalAnalysisCatalogInvalidationVerification.stdout}`
      );
    }

    const officialImportVerification = await run(
      'docker',
      ['exec', '-i', containerName, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', databaseName, '-At'],
      { input: `${buildOfficialImportCommitFixtureSql()}\n` }
    );

    if (!officialImportVerification.stdout.includes('official_import_rpc=ok')) {
      throw new Error(
        `Official import RPC verification returned incomplete output:\n${officialImportVerification.stdout}`
      );
    }

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
      'service_profiles_select=true',
      'service_profiles_update=true',
      'service_revocation_select=true',
      'anon_revocation_select=false',
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
