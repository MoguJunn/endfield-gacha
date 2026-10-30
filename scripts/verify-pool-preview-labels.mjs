import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

// Isolated local PostgreSQL only; no application database or credentials.
const directory = await mkdtemp(join(tmpdir(), 'endfield-preview-labels-'));
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const value = server.address().port;
    server.close(() => resolve(value));
  });
});
const postgres = new EmbeddedPostgres({ databaseDir: join(directory, 'cluster'), port,
  user: 'postgres', password: randomBytes(24).toString('hex'), persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], postgresFlags: ['-h', '127.0.0.1'],
  onLog() {}, onError() {} });
let db;
try {
  await postgres.initialise();
  await postgres.start();
  db = postgres.getPgClient('postgres', '127.0.0.1');
  await db.connect();
  await db.query(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.pools(pool_id text PRIMARY KEY, name text NOT NULL, name_en text,
      start_time timestamptz, updated_at timestamptz DEFAULT now());
    CREATE TABLE public.site_config(key text PRIMARY KEY, value text, label text, category text, updated_at timestamptz);
    CREATE TABLE public.history(id int PRIMARY KEY, pool_id text, seq_id text);
    CREATE TABLE public.pool_id_aliases(alias_id text PRIMARY KEY, pool_id text);
    INSERT INTO public.pools(pool_id,name,name_en,start_time) VALUES
      ('opened','已开池（前瞻）','Opened (前瞻)',now()-interval '1 day'),
      ('expired','已结束（前瞻）',NULL,now()-interval '30 days'),
      ('future','未开池（前瞻）','Future',now()+interval '1 day'),
      ('unknown','未知时间（前瞻）',NULL,NULL),
      ('normal','正式名称',NULL,now()-interval '1 day'),
      ('internal','名称（前瞻）测试',NULL,now()-interval '1 day');
    INSERT INTO public.history VALUES(1,'opened','123');
    INSERT INTO public.pool_id_aliases VALUES('old-opened','opened');
    GRANT SELECT,INSERT,UPDATE ON public.pools TO authenticated;
  `);
  const migration = await readFile(new URL('../supabase/migrations/2026103001_clear_opened_pool_preview_labels.sql', import.meta.url), 'utf8');
  await db.query(migration);
  const one = async (sql, values = []) => (await db.query(sql, values)).rows[0];
  assert.equal((await one("SELECT name FROM pools WHERE pool_id='opened'")).name, '已开池');
  assert.equal((await one("SELECT name_en FROM pools WHERE pool_id='opened'")).name_en, 'Opened');
  assert.equal((await one("SELECT name FROM pools WHERE pool_id='expired'")).name, '已结束');
  assert.equal((await one("SELECT name FROM pools WHERE pool_id='future'")).name, '未开池（前瞻）');
  assert.equal((await one("SELECT name FROM pools WHERE pool_id='unknown'")).name, '未知时间（前瞻）');
  assert.equal((await one("SELECT name FROM pools WHERE pool_id='internal'")).name, '名称（前瞻）测试');
  assert.deepEqual(await one('SELECT * FROM history'), { id: 1, pool_id: 'opened', seq_id: '123' });
  assert.deepEqual(await one('SELECT * FROM pool_id_aliases'), { alias_id: 'old-opened', pool_id: 'opened' });

  const firstEpoch = (await one("SELECT value FROM site_config WHERE key='public_cache_epoch'")).value;
  assert.equal((await one('SELECT public.clear_opened_pool_preview_labels() AS changed')).changed, 0);
  assert.equal((await one("SELECT value FROM site_config WHERE key='public_cache_epoch'")).value, firstEpoch);
  await db.query(migration);
  assert.equal((await one("SELECT value FROM site_config WHERE key='public_cache_epoch'")).value, firstEpoch);

  // Simulate a scheduled start passing without a row update.
  await db.query("INSERT INTO pools(pool_id,name,start_time) VALUES('timed','时间跨越（前瞻）',clock_timestamp()+interval '1 second')");
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal((await one('SELECT public.clear_opened_pool_preview_labels() AS changed')).changed, 1);
  assert.equal((await one("SELECT name FROM pools WHERE pool_id='timed'")).name, '时间跨越');
  assert.notEqual((await one("SELECT value FROM site_config WHERE key='public_cache_epoch'")).value, firstEpoch);

  await db.query("UPDATE pools SET start_time=now()-interval '1 day' WHERE pool_id='future'");
  assert.equal((await one("SELECT name FROM pools WHERE pool_id='future'")).name, '未开池');
  await db.query("SET ROLE authenticated; INSERT INTO pools(pool_id,name,start_time) VALUES('new','新写入(前瞻)',now()-interval '1 day'); RESET ROLE;");
  assert.equal((await one("SELECT name FROM pools WHERE pool_id='new'")).name, '新写入');
  await db.query("UPDATE pools SET name='再次写入（前瞻）' WHERE pool_id='opened'");
  assert.equal((await one("SELECT name FROM pools WHERE pool_id='opened'")).name, '再次写入');
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await one("SELECT has_function_privilege($1,'public.clear_opened_pool_preview_labels()','EXECUTE') AS allowed", [role])).allowed, false);
  }
  assert.equal((await one("SELECT has_function_privilege('service_role','public.clear_opened_pool_preview_labels()','EXECUTE') AS allowed")).allowed, true);
  console.log('Pool preview label SQL verification passed: backfill, timed start, write normalization, cache, idempotency, identity and permissions');
} finally {
  await db?.end().catch(() => {});
  await postgres.stop().catch(() => {});
  await rm(directory, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
}
