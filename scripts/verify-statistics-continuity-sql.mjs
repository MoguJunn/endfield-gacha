import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createWorkbenchRevisionDatabase } from './lib/workbenchRevisionDatabase.mjs';

const owner = randomUUID();
const baseline = await readFile(new URL('../supabase/baseline/000_complete_schema.sql', import.meta.url), 'utf8');
function definition(name) {
  const start = baseline.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `Missing baseline function ${name}`);
  const end = baseline.indexOf('$$;', baseline.indexOf('AS $$', start));
  return baseline.slice(start, end + 3);
}
const database = await createWorkbenchRevisionDatabase({ historyScopeGenerated: true, beforeRevisionMigration: async root => {
  await root.query('ALTER TABLE public.history ADD COLUMN region text');
  const start = baseline.indexOf('CREATE TABLE IF NOT EXISTS public.public_pool_analytics_cache (');
  await root.query(baseline.slice(start, baseline.indexOf('\n);', start) + 3));
  for (const name of ['get_global_stats','refresh_public_pool_analytics_cache','get_pool_type_quota_stats']) {
    await root.query(definition(name));
  }
  await root.query("INSERT INTO profiles(id,role) VALUES($1,'user')", [owner]);
  await root.query("INSERT INTO pools(pool_id,name,type,up_character) VALUES('a','A','limited','Six'),('b','B','limited','Six'),('s','S','standard',null)");
  await root.query("INSERT INTO characters(id,name,type,rarity) VALUES('six','Six','character',6),('four','Four','character',4)");
  await root.query(`INSERT INTO history(user_id,record_id,game_uid,server_id,pool_id,character_id,character_name,item_name,rarity,timestamp,seq_id)
    SELECT $1,i::text,'uid','1',CASE WHEN i<=70 THEN 'a' ELSE 'b' END,
      CASE WHEN i=80 THEN 'six' ELSE 'four' END,CASE WHEN i=80 THEN 'Six' ELSE 'Four' END,
      CASE WHEN i=80 THEN 'Six' ELSE 'Four' END,CASE WHEN i=80 THEN 6 ELSE 4 END,
      '2026-10-01T00:00:00Z'::timestamptz+i*interval '1 second',i::text FROM generate_series(1,80) i`, [owner]);
} });
const { root } = database;
const global = async () => (await root.query('SELECT get_global_stats() AS data')).rows[0].data;
const cache = async () => {
  await root.query('SELECT refresh_public_pool_analytics_cache()');
  return (await root.query("SELECT * FROM public_pool_analytics_cache WHERE pool_id='b'")).rows[0];
};
try {
  assert.equal((await global()).avgPity, 80);
  assert.equal(Number((await cache()).avg_pity_six_star), 80);
  await root.query("UPDATE history SET statistics_excluded=true WHERE record_id='1'");
  const interrupted = await global();
  assert.equal(interrupted.totalPulls, 10);
  assert.equal(interrupted.sixStarTotal, 1);
  assert.equal(interrupted.avgPity, null);
  assert.deepEqual(interrupted.distribution, []);
  assert.equal(interrupted.statisticsContinuity.unknownInheritedIntervalCount, 1);
  assert.equal((await cache()).avg_pity_six_star, null);
  assert.deepEqual((await cache()).distribution, []);
  assert.equal((await root.query('SELECT get_pool_type_quota_stats() AS data')).rows[0].data.limited.aicQuotaDirect, 0);
  console.log('通过：实际旧概览及公开缓存函数保留 B 池10抽和1个六星，未知继承间隔不计平均或分布。');

  await root.query(`INSERT INTO history(user_id,record_id,game_uid,server_id,pool_id,character_id,character_name,item_name,rarity,timestamp,seq_id)
    SELECT $1,i::text,'uid','1','b',CASE WHEN i=85 THEN 'six' ELSE 'four' END,
      CASE WHEN i=85 THEN 'Six' ELSE 'Four' END,CASE WHEN i=85 THEN 'Six' ELSE 'Four' END,
      CASE WHEN i=85 THEN 6 ELSE 4 END,'2026-10-01T00:00:00Z'::timestamptz+i*interval '1 second',i::text
    FROM generate_series(81,85) i`, [owner]);
  assert.equal((await global()).avgPity, 5);
  assert.equal(Number((await cache()).avg_pity_six_star), 5);
  await root.query("DELETE FROM history WHERE pool_id='a'");
  assert.equal((await global()).avgPity, 5);
  await root.query(`INSERT INTO history(user_id,record_id,game_uid,server_id,pool_id,rarity,timestamp,seq_id)
    VALUES($1,'padding','uid','1','a',4,'2026-10-01T00:01:30Z','90')`, [owner]);
  assert.equal((await global()).avgPity, null);
  assert.equal((await global()).totalPulls, 15);
  console.log('通过：真实六星重置后恢复5抽完整区间；删除前池仍保留中断，前池后续垫抽再次使相关区间未知。');

  const authenticated = await database.connect('authenticated', owner);
  for (const view of ['statistics_history_gaps','statistics_pity_intervals','statistics_copy_history']) {
    await assert.rejects(authenticated.query(`SELECT * FROM public.${view}`), { code: '42501' });
  }
  console.log('通过：浏览器无权读取中断身份和原始统计上下文。');
} finally { await database.close(); }
