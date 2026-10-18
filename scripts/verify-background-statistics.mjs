import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createWorkbenchRevisionDatabase } from './lib/workbenchRevisionDatabase.mjs';

const owner = randomUUID(), other = randomUUID();
const db = await createWorkbenchRevisionDatabase({ beforeRevisionMigration: async root => {
  await root.query("INSERT INTO profiles(id,role) VALUES($1,'user'),($2,'user')", [owner, other]);
  await root.query(`INSERT INTO pools(pool_id,name,type) VALUES('p','Test','limited'),('q','Other','standard');
    CREATE FUNCTION refresh_public_analytics_cache() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;`);
  for (const file of ['2026092201_schedule_statistics_snapshots.sql', '2026092401_group_statistics_snapshots.sql',
    '2026100601_reuse_pool_counts_for_catalog_groups.sql']) {
    await root.query(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
} });
try {
  const { root } = db;
  const one = async (sql, params = []) => (await root.query(sql, params)).rows[0];
  await root.query(`ALTER TABLE history ADD COLUMN IF NOT EXISTS pool_version integer,
    ADD COLUMN IF NOT EXISTS region text,ADD COLUMN IF NOT EXISTS is_new boolean`);
  await root.query(`INSERT INTO history(user_id,record_id,game_uid,server_id,server_scope,seq_id,pool_id,rarity,timestamp)
    SELECT $1,n::text,'uid','1','1',n::text,'p',4,'2026-01-01'::timestamptz+n*interval '1 second' FROM generate_series(1,6001) n`, [owner]);
  await root.query(`INSERT INTO history(user_id,record_id,game_uid,server_id,server_scope,seq_id,pool_id,rarity,timestamp)
    VALUES($1,'excluded','other','1','1','1','q',6,'2026-01-01')`, [other]);
  await root.query(`UPDATE history SET statistics_excluded=true WHERE user_id=$1`, [other]);
  const migration = await readFile(new URL('../supabase/migrations/2026101800_bound_background_statistics.sql', import.meta.url), 'utf8');
  await root.query(migration);
  await root.query(migration);
  const expected = Number((await one('SELECT count(*) AS n FROM statistics_history')).n);
  const upper = (await one('SELECT max(id) AS id FROM history')).id;
  assert.equal(Number((await one("SELECT read_statistics_history_count(ARRAY['p','q'],$1) AS n", [upper])).n), expected);
  const first = (await one("SELECT read_statistics_history_page(ARRAY['p','q'],0,$1,5000) AS page", [upper])).page;
  const last = (await one("SELECT read_statistics_history_page(ARRAY['p','q'],$1,$2,5000) AS page", [first.at(-1).id, upper])).page;
  assert.equal(first.length, 5000); assert.equal(last.length, 1001);
  assert.equal(new Set([...first, ...last].map(x => x.id)).size, expected);
  assert.ok([...first, ...last].every(x => x.user_id === owner));
  assert.equal((await one("SELECT jsonb_array_length(read_statistics_history_page(ARRAY['p'],0,$1)) AS n", [upper])).n, 1000);
  await assert.rejects(root.query("SELECT read_statistics_history_page(ARRAY['p'],0,$1,5001)", [upper]), { code: '22023' });
  console.log('通过：迁移可重复应用，5000条分页与可信精确计数一致，排除记录不进入结果，旧1000条默认及参数校验保留。');

  for (const signature of ['read_statistics_history_count(text[],bigint)', 'read_statistics_history_page(text[],bigint,bigint,integer)',
    'statistics_personal_analysis_pending()', 'defer_statistics_job(text,uuid)']) {
    for (const role of ['anon', 'authenticated']) assert.equal((await one('SELECT has_function_privilege($1,$2,\'execute\') AS ok', [role, signature])).ok, false);
    assert.equal((await one("SELECT has_function_privilege('service_role',$1,'execute') AS ok", [signature])).ok, true);
  }
  await root.query('UPDATE personal_analysis_owner_state SET snapshot_revision=history_revision; UPDATE personal_analysis_scope_state SET snapshot_revision=history_revision');
  assert.equal((await one('SELECT statistics_personal_analysis_pending() AS pending')).pending, false);
  await root.query('UPDATE personal_analysis_scope_state SET history_revision=history_revision+1,next_attempt_at=NULL WHERE user_id=$1', [owner]);
  assert.equal((await one('SELECT statistics_personal_analysis_pending() AS pending')).pending, true);
  await root.query("UPDATE personal_analysis_scope_state SET next_attempt_at=now()+interval '1 hour' WHERE user_id=$1", [owner]);
  assert.equal((await one('SELECT statistics_personal_analysis_pending() AS pending')).pending, false);
  console.log('通过：仅服务端可调用，个人任务优先且尊重失败退避。');

  const lease = randomUUID();
  await root.query("UPDATE statistics_jobs SET lease_id=$1,lease_until=now()+interval '5 minutes',failure_count=2 WHERE scope_key='pool:p'", [lease]);
  await root.query("SELECT defer_statistics_job('pool:p',$1)", [randomUUID()]);
  assert.equal((await one("SELECT lease_id FROM statistics_jobs WHERE scope_key='pool:p'")).lease_id, lease);
  await root.query("SELECT defer_statistics_job('pool:p',$1)", [lease]);
  assert.deepEqual(await one("SELECT lease_id,failure_count,retry_at>now() AS deferred FROM statistics_jobs WHERE scope_key='pool:p'"),
    { lease_id: null, failure_count: 2, deferred: true });
  const config = (await one("SELECT proconfig FROM pg_proc WHERE oid='compute_and_publish_legacy_statistics(text,bigint,uuid,text)'::regprocedure")).proconfig;
  for (const setting of ['jit=off', 'max_parallel_workers_per_gather=0', 'work_mem=16MB', 'statement_timeout=180s']) assert.ok(config.includes(setting));
  console.log('通过：主动让出只释放匹配租约，不增加失败次数；后台SQL资源设置只作用于指定函数。');
} finally { await db.close(); }
