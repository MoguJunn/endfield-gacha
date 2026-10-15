import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createWorkbenchRevisionDatabase } from './lib/workbenchRevisionDatabase.mjs';

const owner = randomUUID(), foreign = randomUUID();
const database = await createWorkbenchRevisionDatabase({ historyScopeGenerated: true, beforeRevisionMigration: async root => {
  await root.query(`INSERT INTO profiles(id,role) VALUES($1,'user'),($2,'user');`, [owner, foreign]);
  await root.query(`INSERT INTO pools(pool_id,name,type) VALUES('limited','限定','limited'),('standard','常驻','standard');
    INSERT INTO characters(id,name,type,rarity) VALUES('four','四星','character',4);
    CREATE FUNCTION get_global_stats_cached(integer DEFAULT 0) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
      SELECT jsonb_build_object('total',count(*),'six',count(*) FILTER(WHERE rarity=6)) FROM public.history $$;
    CREATE FUNCTION get_character_ranking_stats_cached(integer DEFAULT 0) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
      SELECT jsonb_build_object('count',count(*)) FROM history $$;
    CREATE FUNCTION get_character_catalog_stats_cached(integer DEFAULT 0) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
      SELECT jsonb_build_object('count',count(h.id)) FROM characters c JOIN public.history h ON h.character_id=c.id $$;
    CREATE FUNCTION get_user_ranking_stats(p_user_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
      SELECT jsonb_build_object('count',count(*)) FROM public.history WHERE user_id=p_user_id $$;
    CREATE FUNCTION refresh_public_analytics_cache() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;`);
  for (const file of ['2026092201_schedule_statistics_snapshots.sql', '2026092401_group_statistics_snapshots.sql',
    '2026100601_reuse_pool_counts_for_catalog_groups.sql']) {
    await root.query(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
  await root.query(`INSERT INTO history(user_id,record_id,game_uid,server_id,pool_id,character_id,rarity,timestamp,seq_id,edit_version)
    VALUES($1,'official-1','uid','cn','limited','four',4,now(),'1',1),
      ($1,'official-2','uid','cn','limited','four',4,now(),'2',1),
      ($1,'old-edit','old-uid','cn','limited','four',6,now(),'3',2),
      ($1,'manual_existing','old-uid','cn','limited','four',6,now(),'4',1),
      ($1,'standard-1','uid','cn','standard','four',4,now(),'5',1),
      ($1,'other-uid','other-uid','cn','limited','four',4,now(),'6',1),
      ($1,'other-server','uid','intl','limited','four',4,now(),'7',1),
      ($2,'other-owner','uid','cn','limited','four',4,now(),'8',1)`, [owner, foreign]);
} });
const { root } = database;
const service = await database.connect('service_role', owner);
const value = async (sql, args = []) => Object.values((await root.query(sql, args)).rows[0])[0];
const rpc = async (name, args = []) => (await service.query(`SELECT public.${name}(${args.map((_, index) => `$${index + 1}`).join(',')}) AS data`, args)).rows[0].data;
const revertLatest = async () => {
  const latest = await rpc('list_account_data_revisions', [owner]);
  const preview = await rpc('preview_account_data_revert', [owner, latest.headId]);
  return rpc('revert_account_data_revision', [owner, preview.targetId, preview.token, randomUUID()]);
};
const assertCounts = async (expected, limited) => {
  assert.equal(Number(await value('SELECT count(*) FROM statistics_history')), expected);
  assert.equal(Number(await value("SELECT total_pulls FROM statistics_jobs WHERE scope_key='group:limited'")), limited);
  assert.equal(Number(await value("SELECT total_pulls FROM statistics_jobs WHERE scope_key='pool:limited'")), limited);
  assert.equal((await rpc('get_global_stats_cached', [0])).total, expected);
  assert.equal((await rpc('get_character_ranking_stats_cached', [0])).count, expected);
  assert.equal((await rpc('get_character_catalog_stats_cached', [0])).count, expected);
  assert.equal((await rpc('get_user_ranking_stats', [owner])).count, expected - 1);
};
try {
  await assertCounts(6, 5);
  assert.equal(Number(await value('SELECT count(*) FROM history')), 8);
  assert.equal((await rpc('list_account_data_revisions', [owner])).versions.length, 0);
  console.log('通过：旧编辑和手动记录回填整池排除；其他 UID、区服和站点用户保留独立统计。');

  await rpc('update_history_record_controlled', [owner, 'official-1', 'uid', 'cn', 'limited', '1', 1,
    JSON.stringify({ rarity: 6 }), '手动修正，不参与统计']);
  assert.equal(await value("SELECT statistics_excluded FROM history WHERE record_id='official-1'"), true);
  assert.equal(Number(await value("SELECT rarity FROM history WHERE record_id='official-1'")), 6);
  await assertCounts(4, 3);
  const context = await rpc('read_account_data_workbench_context', [owner, 'uid', 'cn']);
  assert.equal(context.history.find(row => row.record_id === 'official-1').statistics_excluded, true);
  assert.equal(context.history.find(row => row.record_id === 'official-2').statistics_excluded, true);
  assert.equal(context.history.find(row => row.record_id === 'standard-1').statistics_excluded, false);
  console.log('通过：修改一条明细，未修改的同账号同区服同池记录也全部排除，其他卡池保留。');

  await rpc('update_history_record_controlled', [owner, 'official-1', 'uid', 'cn', 'limited', '1', 2,
    JSON.stringify({ pool_id: 'standard' }), '手动跨池修改']);
  await assertCounts(3, 3);
  assert.equal(Number(await value("SELECT total_pulls FROM statistics_jobs WHERE scope_key='pool:standard'")), 0);
  await revertLatest(); await assertCounts(3, 3);
  await revertLatest(); await assertCounts(3, 3);
  console.log('通过：跨卡池修改同时排除原池与目标池，撤回与再次撤回都不恢复统计资格。');

  // The row returns to its original values; the permanent scope marker survives.
  const target = await value("SELECT min(id) FROM account_data_revisions WHERE user_id=$1", [owner]);
  const plan = await rpc('preview_account_data_revert', [owner, target]);
  await rpc('revert_account_data_revision', [owner, target, plan.token, randomUUID()]);
  await assertCounts(3, 3);
  assert.equal(await value("SELECT statistics_excluded FROM history WHERE record_id='official-1'"), false);
  assert.ok(Number(await value("SELECT edit_version FROM history WHERE record_id='official-1'")) > 1);
  console.log('通过：撤回至原始内容仍保留整池排除标记，版本机制仅恢复业务数据。');

  const jobsBeforeManualInsert = (await root.query('SELECT scope_key,revision FROM statistics_jobs ORDER BY scope_key')).rows;
  const activityBeforeManualInsert = await value('SELECT sum(changed_rows) FROM statistics_activity');
  await root.query(`INSERT INTO history(user_id,record_id,game_uid,server_id,pool_id,character_id,rarity,timestamp,seq_id,statistics_excluded)
    VALUES($1,'manual_new','uid','cn','limited','four',6,now(),'5',false)`, [owner]);
  assert.equal(await value("SELECT statistics_excluded FROM history WHERE record_id='manual_new'"), true);
  await root.query(`INSERT INTO account_data_workbench_entries(user_id,game_uid,server_scope,pool_id,entry_id,draft_id,kind,time_precision,"values")
    VALUES($1,'uid','cn','limited',$2,$3,'pool-ledger','unknown','{"totalPulls":9999,"sixStarCount":999}')`, [owner, randomUUID(), randomUUID()]);
  await assertCounts(3, 3);
  const jobsAfterBounds = (await root.query('SELECT scope_key,revision FROM statistics_jobs ORDER BY scope_key')).rows;
  const changedScopes = new Set(['character_catalog','character_ranking','global_summary','public_analytics',
    'group:limited','pool:limited',`owner:${owner}`]);
  for (const job of jobsAfterBounds) assert.equal(BigInt(job.revision),
    BigInt(jobsBeforeManualInsert.find(before => before.scope_key === job.scope_key).revision) + (changedScopes.has(job.scope_key) ? 1n : 0n));
  const savedBounds = await value("SELECT to_jsonb(e) FROM account_statistics_exclusions e WHERE game_uid='uid' AND pool_id='limited'");
  assert.ok(savedBounds.history_start_at && savedBounds.history_end_at);
  await root.query("UPDATE history SET character_name='再次修改' WHERE record_id='manual_new'");
  assert.deepEqual((await root.query('SELECT scope_key,revision FROM statistics_jobs ORDER BY scope_key')).rows, jobsAfterBounds);
  assert.equal(await value('SELECT sum(changed_rows) FROM statistics_activity'), activityBeforeManualInsert);
  await root.query("DELETE FROM history WHERE record_id='manual_new'");
  assert.deepEqual(await value("SELECT to_jsonb(e) FROM account_statistics_exclusions e WHERE game_uid='uid' AND pool_id='limited'"), savedBounds);
  await root.query("DELETE FROM account_data_workbench_entries WHERE game_uid='uid'");
  await root.query(`INSERT INTO history(user_id,record_id,game_uid,server_id,pool_id,character_id,rarity,timestamp,seq_id)
    VALUES($1,'reimport','uid','cn','limited','four',4,now(),'9')`, [owner]);
  await assertCounts(3, 3);
  // A supplement alone excludes existing and future imported history for its scope.
  await root.query(`INSERT INTO account_data_workbench_entries(user_id,game_uid,server_scope,pool_id,entry_id,draft_id,kind,time_precision,"values")
    VALUES($1,'other-uid','cn','limited',$2,$3,'pool-ledger','unknown','{"totalPulls":100}')`, [owner, randomUUID(), randomUUID()]);
  await assertCounts(2, 2);
  await root.query("DELETE FROM account_data_workbench_entries WHERE game_uid='other-uid'");
  await assertCounts(2, 2);
  const exclusions = await rpc('read_account_statistics_exclusions', [owner]);
  assert.ok(exclusions.some(row => row.game_uid === 'uid' && row.server_scope === 'cn' && row.pool_id === 'limited'));
  assert.equal(exclusions.some(row => row.server_scope === 'intl'), false);
  console.log('通过：删除手动内容、重新导入及仅添加补充存档，均不能让被排除整池再次进入统计。');
  await root.query('BEGIN');
  await root.query("UPDATE history SET statistics_excluded=true WHERE record_id='other-owner'");
  assert.equal(Number(await value('SELECT count(*) FROM account_statistics_exclusions WHERE user_id=$1', [foreign])), 1);
  await root.query('ROLLBACK');
  await assertCounts(2, 2);
  assert.equal(Number(await value('SELECT count(*) FROM account_statistics_exclusions WHERE user_id=$1', [foreign])), 0);
  console.log('通过：失败或回滚的手动保存不会留下排除标记，也不会改变统计计数。');
  const authenticated = await database.connect('authenticated', owner);
  await assert.rejects(authenticated.query('SELECT * FROM statistics_history'), { code: '42501' });
  await assert.rejects(authenticated.query('SELECT * FROM statistics_history_gaps'), { code: '42501' });
  await assert.rejects(authenticated.query('SELECT * FROM account_statistics_exclusions'), { code: '42501' });
  console.log('通过：新增手动明细和补充存档不影响统计；浏览器不能直接读取统计明细视图。');
  console.log('通过：中断时间边界持久保留；边界扩大触发相关快照重算，边界未变的编辑不重复刷新。');
  console.log('真实 PostgreSQL：整池排除、账号区服隔离、持久标记、计数、跨池移动、撤回和权限验证全部通过。');
} finally { await database.close(); }
