import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Always a new local cluster/container; never load application credentials.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeBin = process.env.POOL_ROSTER_PG_BIN;
const container = `complete-pool-rosters-${process.pid}`;
let directory, port, environment, started = false;
function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 60000, ...options });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout);
  return result.stdout;
}
const native = (name, args, options = {}) => command(path.join(nativeBin, `${name}${process.platform === 'win32' ? '.exe' : ''}`), args, { cwd: directory, env: environment, ...options });
const sql = (input) => nativeBin
  ? native('psql', ['-X', '-q', '-w', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres'], { input })
  : command('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], { input });
try {
  if (nativeBin) {
    if (!path.isAbsolute(nativeBin)) throw new Error('POOL_ROSTER_PG_BIN must be an absolute local bin directory');
    await readdir(path.join(root, '.agent-tmp'));
    directory = await mkdtemp(path.join(root, '.agent-tmp', 'pool-roster-sql-'));
    environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|SYSTEMDRIVE|USERPROFILE|LANG|LC_ALL)$/i.test(key)));
    Object.assign(environment, { TEMP: directory, TMP: directory, PGCONNECT_TIMEOUT: '5', PGPASSFILE: path.join(directory, 'unused.pgpass') });
    const server = createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    port = server.address().port;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    native('initdb', ['-D', path.join(directory, 'cluster'), '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--no-locale']);
    await writeFile(path.join(directory, 'cluster/postgresql.auto.conf'), `listen_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = ''\n`);
    native('pg_ctl', ['-D', path.join(directory, 'cluster'), '-l', path.join(directory, 'postgres.log'), '-w', 'start'], { stdio: 'ignore' });
    started = true;
    console.log(`Isolated PostgreSQL: ${directory}; port ${port}`);
  } else {
    command('docker', ['run', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', process.env.TEST_POSTGRES_IMAGE || 'postgres:17-alpine']);
    started = true;
    for (let i = 0; i < 60; i++) {
      if (spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres']).status === 0) break;
      if (i === 59) throw new Error('Isolated PostgreSQL did not become ready');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.characters(id text PRIMARY KEY, name text, rarity int, type text, is_limited boolean, aliases text[], pool_config jsonb);
    CREATE TABLE public.pool_characters(pool_id text, character_id text REFERENCES public.characters(id), is_up boolean,
      PRIMARY KEY(pool_id, character_id));
    ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.pool_characters ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.characters, public.pool_characters TO service_role;`);
  const migration = await readFile(path.join(root, 'supabase/migrations/2026101101_complete_pool_roster_reads.sql'), 'utf8');
  sql(migration);
  sql(migration); // Reapplication preserves grants and data.
  sql(await readFile(path.join(root, 'supabase/tests/complete-pool-roster-reads.sql'), 'utf8'));
  console.log('PASS: 1227 relations, exact source equality, scoped/empty reads, ordering, entity fields, service-only privileges and idempotency.');
} finally {
  if (started) {
    if (nativeBin) native('pg_ctl', ['-D', path.join(directory, 'cluster'), '-m', 'fast', '-w', 'stop']);
    else command('docker', ['rm', '-f', container]);
  }
}
