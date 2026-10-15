import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createWorkbenchRevisionDatabase } from './lib/workbenchRevisionDatabase.mjs';

const owner = randomUUID(), unrelated = randomUUID();
const database = await createWorkbenchRevisionDatabase({ historyScopeGenerated: true,
  beforeRevisionMigration: async root => {
    await root.query("INSERT INTO profiles(id,role) VALUES($1,'user'),($2,'user')", [owner, unrelated]);
    await root.query(`INSERT INTO pools(pool_id,name,type) VALUES('standard','基础寻访','standard');
      CREATE FUNCTION refresh_public_analytics_cache() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;`);
    for (const file of ['2026092201_schedule_statistics_snapshots.sql', '2026092401_group_statistics_snapshots.sql',
      '2026100601_reuse_pool_counts_for_catalog_groups.sql']) {
      await root.query(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    }
    await root.query(`INSERT INTO history(user_id,record_id,game_uid,server_id,seq_id,pool_id,rarity,timestamp,edit_version)
      VALUES($1,'edited','uid','1','1','standard',6,'2026-01-01',2),
      ($2,'untouched','other','1','1','standard',4,'2026-01-01',1)`, [owner, unrelated]);
  } });
try {
  const { root } = database;
  const jobs = async () => (await root.query('SELECT scope_key,revision,total_pulls FROM statistics_jobs ORDER BY scope_key')).rows;
  const before = await jobs();
  const otherRevision = (await root.query('SELECT history_revision FROM personal_analysis_owner_state WHERE user_id=$1', [unrelated])).rows[0].history_revision;
  await root.query(await readFile(new URL('../supabase/migrations/2026101412_restore_manual_personal_analysis.sql', import.meta.url), 'utf8'));
  const after = await jobs();
  assert.deepEqual(after.filter(row => row.scope_key !== `owner:${owner}`), before.filter(row => row.scope_key !== `owner:${owner}`));
  assert.equal((await root.query('SELECT history_revision FROM personal_analysis_owner_state WHERE user_id=$1', [unrelated])).rows[0].history_revision, otherRevision);
  console.log('通过：迁移只重建受影响个人账号，全服任务、计数和无关账号均不变。');

  const publicJobs = after.filter(row => !row.scope_key.startsWith('owner:'));
  const ownerRevision = async () => BigInt((await root.query('SELECT revision FROM statistics_jobs WHERE scope_key=$1', [`owner:${owner}`])).rows[0].revision);
  let prior = await ownerRevision();
  await root.query("UPDATE history SET character_name='修正结果' WHERE user_id=$1 AND record_id='edited'", [owner]);
  assert.equal(await ownerRevision(), prior + 1n);
  const entryId = randomUUID();
  prior = await ownerRevision();
  await root.query(`INSERT INTO account_data_workbench_entries(user_id,game_uid,server_scope,pool_id,entry_id,draft_id,kind,time_precision,"values")
    VALUES($1,'uid','1','standard',$2,$3,'pool-ledger','unknown','{"coverageMode":"pool","drawMethod":"normal","totalPulls":20}')`, [owner, entryId, randomUUID()]);
  assert.equal(await ownerRevision(), prior + 1n);
  prior = await ownerRevision();
  await root.query('UPDATE account_data_workbench_entries SET deleted_at=now() WHERE entry_id=$1', [entryId]);
  assert.equal(await ownerRevision(), prior + 1n);
  prior = await ownerRevision();
  await root.query('DELETE FROM account_data_workbench_entries WHERE entry_id=$1', [entryId]);
  assert.equal(await ownerRevision(), prior + 1n);
  assert.deepEqual((await jobs()).filter(row => !row.scope_key.startsWith('owner:')), publicJobs);
  assert.equal(Number((await root.query('SELECT count(*) FROM statistics_history WHERE user_id=$1', [owner])).rows[0].count), 0);
  console.log('通过：已排除明细的修正，以及补录新增、修改和删除持续更新个人任务，公共统计保持隔离。');
} finally { await database.close(); }
