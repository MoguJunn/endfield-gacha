import { execFileSync, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = path.join(
  projectRoot,
  'supabase',
  'migrations',
  '177_prioritize_active_personal_analysis_jobs.sql'
);
const containerName = `endfield-personal-analysis-queue-${Date.now()}`;
const postgresImage = process.env.POSTGRES_TEST_IMAGE || 'postgres:17-alpine';

const BACKLOG_USER = '00000000-0000-4000-8000-000000000001';
const ACTIVE_USER = '00000000-0000-4000-8000-000000000002';
const BACKOFF_USER = '00000000-0000-4000-8000-000000000003';
const FIRST_LEASE = '10000000-0000-4000-8000-000000000001';
const SECOND_LEASE = '10000000-0000-4000-8000-000000000002';

function runDocker(args, options = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `docker ${args.join(' ')} failed`);
  }
  return result.stdout;
}

function waitForPostgres() {
  let successStreak = 0;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync(
      'docker',
      [
        'exec', containerName,
        'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
        '-U', 'postgres', '-d', 'postgres',
        '-c', 'SELECT 1',
      ],
      { encoding: 'utf8' }
    );
    successStreak = result.status === 0 && result.stdout.trim() === '1'
      ? successStreak + 1
      : 0;
    // The official image briefly exposes a temporary init server before
    // restarting Postgres. Consecutive real queries avoid that socket race.
    if (successStreak >= 3) return;
    execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 500)']);
  }
  throw new Error('PostgreSQL test container did not become ready');
}

const setupSql = `
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY
);

CREATE TABLE public.history (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  game_uid TEXT,
  server_scope TEXT
);

CREATE OR REPLACE FUNCTION public.normalize_personal_analysis_game_uid(
  p_user_id UUID,
  p_game_uid TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(NULLIF(btrim(p_game_uid), ''), 'legacy');
$$;

CREATE TABLE public.personal_analysis_owner_state (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  history_revision BIGINT NOT NULL DEFAULT 0,
  snapshot_revision BIGINT NOT NULL DEFAULT -1,
  dirty_since TIMESTAMPTZ,
  computed_at TIMESTAMPTZ,
  analysis_schema_version INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  lease_id UUID,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  CHECK (snapshot_revision >= -1),
  CHECK (snapshot_revision <= history_revision)
);

CREATE TABLE public.personal_analysis_scope_state (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scope_game_uid TEXT NOT NULL,
  server_scope TEXT NOT NULL,
  history_revision BIGINT NOT NULL DEFAULT 0,
  snapshot_revision BIGINT NOT NULL DEFAULT -1,
  dirty_since TIMESTAMPTZ,
  computed_at TIMESTAMPTZ,
  analysis_schema_version INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  lease_id UUID,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, scope_game_uid, server_scope),
  CHECK (snapshot_revision >= -1),
  CHECK (snapshot_revision <= history_revision)
);
`;

const assertionSql = `
INSERT INTO public.profiles (id)
VALUES
  ('${BACKLOG_USER}'),
  ('${ACTIVE_USER}'),
  ('${BACKOFF_USER}');

INSERT INTO public.history (user_id, game_uid, server_scope)
VALUES
  ('${BACKLOG_USER}', 'backlog-game', '1'),
  ('${ACTIVE_USER}', 'active-game', '1'),
  ('${ACTIVE_USER}', 'active-game', '2'),
  ('${BACKOFF_USER}', 'backoff-game', '1');

INSERT INTO public.personal_analysis_owner_state (
  user_id, history_revision, snapshot_revision, dirty_since
)
VALUES
  ('${BACKLOG_USER}', 1, -1, statement_timestamp() - interval '2 days'),
  ('${ACTIVE_USER}', 1, -1, statement_timestamp() - interval '1 day'),
  ('${BACKOFF_USER}', 1, -1, statement_timestamp() - interval '3 days');

INSERT INTO public.personal_analysis_scope_state (
  user_id, scope_game_uid, server_scope, history_revision, snapshot_revision, dirty_since
)
VALUES
  ('${BACKLOG_USER}', 'backlog-game', '1', 1, -1, statement_timestamp() - interval '2 days'),
  ('${ACTIVE_USER}', 'active-game', '1', 1, -1, statement_timestamp() - interval '1 day'),
  ('${ACTIVE_USER}', 'active-game', '2', 1, -1, statement_timestamp() - interval '1 day'),
  ('${BACKOFF_USER}', 'backoff-game', '1', 1, -1, statement_timestamp() - interval '3 days');

UPDATE public.personal_analysis_owner_state
SET attempt_count = 3,
    next_attempt_at = statement_timestamp() + interval '1 hour'
WHERE user_id = '${BACKOFF_USER}';

UPDATE public.personal_analysis_scope_state
SET attempt_count = 3,
    next_attempt_at = statement_timestamp() + interval '1 hour'
WHERE user_id = '${BACKOFF_USER}';

DO $$
DECLARE
  v_first_priority TIMESTAMPTZ;
  v_second_priority TIMESTAMPTZ;
  v_backoff_at TIMESTAMPTZ;
  v_scope_backoff_at TIMESTAMPTZ;
  v_claim JSONB;
BEGIN
  PERFORM public.prioritize_personal_analysis_jobs(
    '${ACTIVE_USER}', NULL, NULL, FALSE, FALSE
  );
  SELECT priority_requested_at
  INTO v_first_priority
  FROM public.personal_analysis_owner_state
  WHERE user_id = '${ACTIVE_USER}';

  PERFORM pg_sleep(0.01);
  PERFORM public.prioritize_personal_analysis_jobs(
    '${ACTIVE_USER}', NULL, NULL, FALSE, FALSE
  );
  SELECT priority_requested_at
  INTO v_second_priority
  FROM public.personal_analysis_owner_state
  WHERE user_id = '${ACTIVE_USER}';

  IF v_first_priority IS NULL OR v_second_priority IS DISTINCT FROM v_first_priority THEN
    RAISE EXCEPTION 'repeated polling changed active-user FIFO priority';
  END IF;

  SELECT next_attempt_at
  INTO v_backoff_at
  FROM public.personal_analysis_owner_state
  WHERE user_id = '${BACKOFF_USER}';
  SELECT next_attempt_at
  INTO v_scope_backoff_at
  FROM public.personal_analysis_scope_state
  WHERE user_id = '${BACKOFF_USER}';

  PERFORM public.prioritize_personal_analysis_jobs(
    '${BACKOFF_USER}', NULL, NULL, FALSE, FALSE
  );
  IF (
    SELECT attempt_count <> 3 OR next_attempt_at IS DISTINCT FROM v_backoff_at
    FROM public.personal_analysis_owner_state
    WHERE user_id = '${BACKOFF_USER}'
  ) THEN
    RAISE EXCEPTION 'active prioritization bypassed worker failure backoff';
  END IF;
  IF (
    SELECT attempt_count <> 3 OR next_attempt_at IS DISTINCT FROM v_scope_backoff_at
    FROM public.personal_analysis_scope_state
    WHERE user_id = '${BACKOFF_USER}'
  ) THEN
    RAISE EXCEPTION 'active prioritization bypassed scope failure backoff';
  END IF;

  v_claim := public.claim_personal_analysis_jobs('${FIRST_LEASE}', 1, 50);
  IF v_claim #>> '{ownerJobs,0,userId}' <> '${ACTIVE_USER}' THEN
    RAISE EXCEPTION 'active user was not claimed before historical backlog: %', v_claim;
  END IF;
  IF jsonb_array_length(v_claim -> 'scopeJobs') <> 2 THEN
    RAISE EXCEPTION 'all active-user scopes were not claimed together: %', v_claim;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_claim -> 'scopeJobs') AS scope_job
    WHERE scope_job ->> 'userId' <> '${ACTIVE_USER}'
  ) THEN
    RAISE EXCEPTION 'scope claim crossed the selected user boundary: %', v_claim;
  END IF;

  v_claim := public.claim_personal_analysis_jobs('${SECOND_LEASE}', 1, 50);
  IF v_claim #>> '{ownerJobs,0,userId}' <> '${BACKLOG_USER}' THEN
    RAISE EXCEPTION 'future-backoff user was claimed before due backlog: %', v_claim;
  END IF;
END;
$$;
`;

try {
  const migrationSql = await readFile(migrationPath, 'utf8');
  runDocker([
    'run',
    '--detach',
    '--rm',
    '--name',
    containerName,
    '--env',
    'POSTGRES_PASSWORD=personal-analysis-test',
    postgresImage,
  ]);
  waitForPostgres();
  runDocker(['exec', '-i', containerName, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], {
    input: `${setupSql}\n${migrationSql}\n${assertionSql}`,
  });
  console.log('[verify-personal-analysis-queue-sql] OK');
  console.log(`- image: ${postgresImage}`);
  console.log('- active users preserve FIFO priority');
  console.log('- failed jobs preserve next-attempt backoff');
  console.log('- one user owner and all scopes are claimed together');
} finally {
  spawnSync('docker', ['rm', '--force', containerName], {
    encoding: 'utf8',
    stdio: 'ignore',
  });
}
