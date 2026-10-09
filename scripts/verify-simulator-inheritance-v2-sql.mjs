import { spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Default: a new disposable Docker container. Set SIMULATOR_PG_BIN explicitly
// to use native PostgreSQL binaries and a fresh cluster in ignored .agent-tmp.
// Neither mode reads application env files or connects to an existing database.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeBin = process.env.SIMULATOR_PG_BIN;
const container = `endfield-simulator-inheritance-v2-${Date.now()}`;
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const lease = '10000000-0000-4000-8000-000000000001';
const newLease = '10000000-0000-4000-8000-000000000002';

function docker(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', ...options });
  if (result.status !== 0)
    throw new Error(result.error?.message || result.stderr || result.stdout || 'Local PostgreSQL command failed');
  return result.stdout;
}
const psqlArgs = [
  'exec',
  '-i',
  container,
  'psql',
  '-X',
  '-q',
  '-v',
  'ON_ERROR_STOP=1',
  '-U',
  'postgres',
  '-d',
  'postgres',
];
let nativeDirectory;
let nativeCluster;
let nativeEnvironment;
let nativePort;

function nativeCommand(name, args, options = {}) {
  return spawnSync(path.join(nativeBin, `${name}${process.platform === 'win32' ? '.exe' : ''}`), args, {
    encoding: 'utf8',
    cwd: nativeDirectory,
    env: nativeEnvironment,
    ...options,
  });
}

function native(name, args, options = {}) {
  const result = nativeCommand(name, args, options);
  if (result.status !== 0) {
    throw new Error(`${name} failed: ${result.error?.message || result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function unusedHighPort() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const port = randomInt(49152, 65536);
    const server = createServer();
    const available = await new Promise((resolve, reject) => {
      server.once('error', (error) => {
        if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolve(false);
        else reject(error);
      });
      server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
        server.close((error) => (error ? reject(error) : resolve(true)));
      });
    });
    if (available) return port;
  }
  throw new Error('No unused local high port was found');
}

async function prepareNativeCluster() {
  if (!path.isAbsolute(nativeBin)) throw new Error('SIMULATOR_PG_BIN must be an absolute PostgreSQL bin directory');
  const temporaryRoot = path.join(root, '.agent-tmp');
  await readdir(root); // Check the parent before creating any directory.
  await mkdir(temporaryRoot, { recursive: true });
  await readdir(temporaryRoot);
  nativeDirectory = await mkdtemp(path.join(temporaryRoot, 'simulator-sql-'));
  await readdir(nativeDirectory);
  const temporaryDirectory = path.join(nativeDirectory, 'tmp');
  await mkdir(temporaryDirectory);
  nativeCluster = path.join(nativeDirectory, 'cluster'); // initdb creates this new directory.
  // Pass only OS/runtime essentials, never inherited database connection settings.
  nativeEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|SYSTEMDRIVE|USERPROFILE|HOMEDRIVE|HOMEPATH|LANG|LC_ALL)$/i.test(key)
    )
  );
  Object.assign(nativeEnvironment, {
    TEMP: temporaryDirectory,
    TMP: temporaryDirectory,
    TMPDIR: temporaryDirectory,
    PGCONNECT_TIMEOUT: '5',
    PGPASSFILE: path.join(nativeDirectory, 'unused.pgpass'),
  });
  nativePort = await unusedHighPort();
  console.log(`Native PostgreSQL isolated cluster: ${nativeCluster}; port: ${nativePort}`);
  await readdir(nativeDirectory);
  native('initdb', ['-D', nativeCluster, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--no-locale']);
  await writeFile(
    path.join(nativeCluster, 'postgresql.auto.conf'),
    `listen_addresses = '127.0.0.1'\nport = ${nativePort}\nunix_socket_directories = ''\n`,
    'utf8'
  );
}

function sql(input) {
  if (!nativeBin) return docker(psqlArgs, { input });
  return native(
    'psql',
    [
      '-X',
      '-q',
      '-w',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      '127.0.0.1',
      '-p',
      String(nativePort),
      '-U',
      'postgres',
      '-d',
      'postgres',
    ],
    { input }
  );
}

const setup = `
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
CREATE FUNCTION public.is_request_auth_session_allowed() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$ SELECT true; $$;
CREATE TABLE public.profiles (id UUID PRIMARY KEY);
CREATE TABLE public.history (
  id BIGSERIAL PRIMARY KEY, user_id UUID REFERENCES public.profiles(id),
  record_id TEXT, game_uid TEXT, server_scope TEXT, batch_id TEXT, updated_at TIMESTAMPTZ
);
CREATE TABLE public.pools (
  pool_id TEXT PRIMARY KEY, name TEXT, name_en TEXT, type TEXT, locked BOOLEAN, user_id UUID,
  up_character TEXT, is_limited_weapon BOOLEAN, featured_characters TEXT[], description TEXT,
  banner_url TEXT, start_time TIMESTAMPTZ, end_time TIMESTAMPTZ, extra_subtype TEXT,
  extra_rule_profile TEXT, extra_series_key TEXT, extra_series_phase INTEGER
);
CREATE FUNCTION public.invalidate_personal_analysis_after_pool_change() RETURNS TRIGGER
LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END; $$;
CREATE TRIGGER invalidate_personal_analysis_pool_catalog
AFTER INSERT OR UPDATE OR DELETE ON public.pools FOR EACH ROW
EXECUTE FUNCTION public.invalidate_personal_analysis_after_pool_change();
`;

const seed = `
INSERT INTO public.profiles VALUES ('${owner}'), ('${other}');
INSERT INTO public.history(user_id, record_id, game_uid, server_scope) VALUES
  ('${owner}', 'asia', 'same-uid', '2'), ('${owner}', 'eu', 'same-uid', '3'),
  ('${other}', 'other', 'same-uid', '2');
UPDATE public.personal_analysis_owner_state SET
  history_revision = 7, snapshot_revision = 7, analysis_schema_version = 2,
  dirty_since = NULL, last_error = 'prior-error', next_attempt_at = NOW() + interval '1 hour',
  lease_id = '${lease}', lease_expires_at = NOW() + interval '5 minutes', attempt_count = 3;
UPDATE public.personal_analysis_scope_state SET
  history_revision = 7, snapshot_revision = 7, analysis_schema_version = 2,
  dirty_since = NULL, last_error = 'prior-error', next_attempt_at = NOW() + interval '1 hour',
  lease_id = '${lease}', lease_expires_at = NOW() + interval '5 minutes', attempt_count = 3;
INSERT INTO public.personal_analysis_snapshots
  (user_id, scope_kind, scope_key, source_game_uid, source_server_scope, input_revision, analysis_schema_version, payload)
VALUES
  ('${owner}', 'owner', 'owner', NULL, NULL, 7, 2, '{"sentinel":"owner"}'),
  ('${owner}', 'account', 'same-uid::server:2', 'same-uid', '2', 7, 2, '{"sentinel":"asia"}'),
  ('${owner}', 'account', 'same-uid::server:3', 'same-uid', '3', 7, 2, '{"sentinel":"eu"}'),
  ('${other}', 'account', 'same-uid::server:2', 'same-uid', '2', 7, 2, '{"sentinel":"other"}');
`;

const assertions = `
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.personal_analysis_owner_state
    WHERE history_revision <> 8 OR snapshot_revision <> 7 OR analysis_schema_version <> 3
      OR lease_id <> '${lease}' OR lease_expires_at IS NULL OR dirty_since IS NULL
      OR last_error IS NOT NULL OR next_attempt_at IS NOT NULL) THEN
    RAISE EXCEPTION 'owner rebuild must preserve active leases and last snapshots';
  END IF;
  IF EXISTS (SELECT 1 FROM public.personal_analysis_scope_state
    WHERE history_revision <> 8 OR snapshot_revision <> 7 OR analysis_schema_version <> 3
      OR lease_id <> '${lease}' OR lease_expires_at IS NULL OR dirty_since IS NULL) THEN
    RAISE EXCEPTION 'scope rebuild must preserve active leases and account identities';
  END IF;
  IF (SELECT COUNT(*) FROM public.personal_analysis_snapshots) <> 4 THEN
    RAISE EXCEPTION 'migration must retain all previous snapshots';
  END IF;
  IF has_table_privilege('authenticated', 'public.personal_analysis_snapshots', 'INSERT')
    OR has_table_privilege('authenticated', 'public.personal_analysis_snapshots', 'UPDATE')
    OR has_function_privilege('authenticated', 'public.enforce_personal_analysis_schema_v3()', 'EXECUTE')
    OR has_function_privilege('anon', 'public.enforce_personal_analysis_schema_v3()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.publish_personal_analysis_scope_snapshots(uuid,text,text,bigint,integer,jsonb,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'browser ACLs must remain read-only';
  END IF;
  IF public.publish_personal_analysis_scope_snapshots('${owner}', 'same-uid', '2', 7, 2,
    '[{"scopeKey":"same-uid::server:2","payload":{"sentinel":"old-job"}}]', '${lease}') THEN
    RAISE EXCEPTION 'an old-schema leased job must not overwrite a newer input revision';
  END IF;
END;
$$;

UPDATE public.personal_analysis_scope_state SET lease_id = '${newLease}'
WHERE user_id = '${owner}' AND scope_game_uid = 'same-uid' AND server_scope = '2';
DO $$
BEGIN
  IF NOT public.publish_personal_analysis_scope_snapshots('${owner}', 'same-uid', '2', 8, 3,
    '[{"scopeKey":"same-uid::server:2","payload":{"simulatorInheritance":{"contractVersion":2,"session":{"version":2},"histories":{}}}}]', '${newLease}') THEN
    RAISE EXCEPTION 'schema v3 job should publish its matching account scope';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.personal_analysis_snapshots WHERE
    user_id = '${owner}' AND scope_key = 'same-uid::server:2' AND source_server_scope = '2'
    AND source_game_uid = 'same-uid' AND analysis_schema_version = 3) THEN
    RAISE EXCEPTION 'source account identity was not retained';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.personal_analysis_snapshots WHERE
    user_id = '${owner}' AND scope_key = 'same-uid::server:3' AND payload->>'sentinel' = 'eu')
    OR NOT EXISTS (SELECT 1 FROM public.personal_analysis_snapshots WHERE
    user_id = '${other}' AND scope_key = 'same-uid::server:2' AND payload->>'sentinel' = 'other') THEN
    RAISE EXCEPTION 'publication must isolate other servers and owners';
  END IF;
END;
$$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '${owner}', false);
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM public.personal_analysis_snapshots) <> 3 THEN
    RAISE EXCEPTION 'snapshot RLS must expose only the authenticated owner';
  END IF;
END; $$;
RESET ROLE;

INSERT INTO public.pools(pool_id, type, start_time) VALUES ('zero-pull-new-pool', 'limited', '2026-10-09');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.personal_analysis_scope_state WHERE history_revision <> 9)
    OR EXISTS (SELECT 1 FROM public.personal_analysis_owner_state WHERE history_revision <> 9) THEN
    RAISE EXCEPTION 'a new zero-pull pool must invalidate complete-catalog projections';
  END IF;
END; $$;

INSERT INTO public.profiles VALUES ('00000000-0000-4000-8000-000000000003');
INSERT INTO public.history(user_id, record_id, game_uid, server_scope)
VALUES ('00000000-0000-4000-8000-000000000003', 'new', 'new-uid', '1');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.personal_analysis_owner_state WHERE analysis_schema_version <> 3)
    OR EXISTS (SELECT 1 FROM public.personal_analysis_scope_state WHERE analysis_schema_version <> 3) THEN
    RAISE EXCEPTION 'legacy history triggers must create schema v3 queue rows';
  END IF;
END; $$;
`;

let started = false;
try {
  if (nativeBin) {
    await prepareNativeCluster();
    // Mark before starting: finally must also stop a server whose readiness wait fails.
    started = true;
    // On Windows, postgres may retain pg_ctl's pipe handles; inherited stdio
    // lets the readiness command return without waiting for the server to exit.
    native(
      'pg_ctl',
      ['-D', nativeCluster, '-l', path.join(nativeDirectory, 'postgres.log'), '-w', '-t', '60', 'start'],
      { stdio: 'inherit' }
    );
    const directoryLiteral = nativeCluster.replaceAll('\\', '/').replaceAll("'", "''");
    sql(`DO $$ BEGIN
      IF replace(current_setting('data_directory'), chr(92), '/') <> '${directoryLiteral}' THEN
        RAISE EXCEPTION 'Refusing to use a database outside this fresh isolated cluster';
      END IF;
    END; $$;`);
  } else {
    docker([
      'run',
      '--rm',
      '-d',
      '--name',
      container,
      '-e',
      'POSTGRES_PASSWORD=local-test-only',
      process.env.POSTGRES_TEST_IMAGE || 'postgres:17-alpine',
    ]);
    started = true;
    let healthy = 0;
    for (let attempt = 0; attempt < 60 && healthy < 3; attempt += 1) {
      const result = spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], {
        encoding: 'utf8',
      });
      healthy = result.status === 0 ? healthy + 1 : 0;
      if (healthy < 3) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (healthy < 3) throw new Error('Local PostgreSQL did not become ready');
  }
  sql(setup);
  console.log('Applying existing migrations: 173, 174, 187');
  for (const filename of [
    '173_add_personal_analysis_scope_revisions.sql',
    '174_add_personal_analysis_snapshot_queue.sql',
    '187_rebuild_personal_analysis_overview_filters.sql',
  ]) {
    sql(await readFile(path.join(root, 'supabase/migrations', filename), 'utf8'));
  }
  sql(seed);
  console.log('Applying simulator inheritance v2 migration and SQL assertions');
  sql(await readFile(path.join(root, 'supabase/migrations/2026100901_simulator_inheritance_v2.sql'), 'utf8'));
  sql(assertions);
  console.log('Simulator inheritance v2 local SQL checks passed.');
} finally {
  if (started && nativeBin) {
    const status = nativeCommand('pg_ctl', ['-D', nativeCluster, 'status']);
    if (status.status === 0) {
      native('pg_ctl', ['-D', nativeCluster, '-m', 'fast', '-w', '-t', '60', 'stop'], { stdio: 'inherit' });
      console.log('Isolated native PostgreSQL stopped.');
    } else if (status.status !== 3) {
      throw new Error(
        `Could not verify isolated PostgreSQL shutdown: ${status.error?.message || status.stderr || status.stdout}`
      );
    }
  } else if (started) {
    spawnSync('docker', ['rm', '-f', container], { encoding: 'utf8' });
  }
  if (nativeDirectory) console.log(`Isolated test files retained: ${nativeDirectory}`);
}
