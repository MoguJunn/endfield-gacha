import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createWorkbenchRevisionDatabase } from './lib/workbenchRevisionDatabase.mjs';

// Isolated, disposable PostgreSQL only. No environment file or remote connection.
const owners = [randomUUID(), randomUUID()];
const database = await createWorkbenchRevisionDatabase({
  historyScopeGenerated: true,
  beforeRevisionMigration: async (root) => {
    await root.query('ALTER TABLE history ADD COLUMN region text');
    const source = await readFile(new URL('../supabase/archive/migrations/109_include_extra_pool_in_stats.sql', import.meta.url), 'utf8');
    const start = source.indexOf('CREATE OR REPLACE FUNCTION public.get_global_stats()');
    await root.query(source.slice(start, source.indexOf('$$;', start) + 3));
    await root.query("INSERT INTO profiles(id,role) VALUES($1,'user'),($2,'user')", owners);
  },
});
const { root } = database;
const value = async (sql) => Object.values((await root.query(sql)).rows[0])[0];
const nodes = (plan) => [plan, ...(plan.Plans || []).flatMap(nodes)];
try {
  await root.query(`INSERT INTO pools(pool_id,name,type,up_character,start_time,end_time,extra_rule_profile,extra_series_key) VALUES
    ('limited-a','A','limited','目标','2026-01-01','2026-01-31',NULL,NULL),
    ('limited-gap','中断','limited','目标','2026-02-01','2026-02-28',NULL,NULL),
    ('limited-b','B','limited_character','目标','2026-03-01','2026-03-31',NULL,NULL),
    ('standard','常驻','standard',NULL,NULL,NULL,NULL,NULL),
    ('weapon','武器','weapon','目标',NULL,NULL,NULL,NULL),
    ('extra-a','重构A','extra',NULL,NULL,NULL,'reconstruction_character_v1','series-a'),
    ('extra-b','重构B','extra',NULL,NULL,NULL,'reconstruction_character_v1','series-a'),
    ('extra-other','重构C','extra',NULL,NULL,NULL,'reconstruction_character_v1','series-b'),
    ('spark','保障测试','limited','目标','2026-05-01','2026-05-31',NULL,NULL);
    INSERT INTO history(user_id,record_id,game_uid,server_id,pool_id,rarity,timestamp,seq_id,character_name,is_free,special_type)
    SELECT owner.id,p.pool_id||'-'||uid||'-'||server||'-'||n,uid,server,p.pool_id,
      CASE WHEN n%17=0 THEN 6 WHEN n%5=0 THEN 5 ELSE 4 END,
      CASE WHEN p.pool_id='limited-b' THEN '2026-03-01'::timestamptz ELSE '2026-01-01'::timestamptz END
        + (n/2)*interval '1 minute',
      CASE WHEN n%13=0 THEN 'not-numeric' ELSE n::text END,'目标',n%29=0,
      CASE WHEN n%31=0 THEN 'gift' END
    FROM profiles owner CROSS JOIN pools p CROSS JOIN unnest(ARRAY['uid-a','uid-b']) uid
      CROSS JOIN unnest(ARRAY['cn','intl']) server CROSS JOIN generate_series(1,70) n
    WHERE p.pool_id NOT IN ('limited-gap','spark');
    INSERT INTO history(user_id,record_id,game_uid,server_id,pool_id,rarity,timestamp,seq_id,character_name)
      SELECT id,'spark-'||lpad(n::text,5,'0'),'spark-account','cn','spark',
        CASE WHEN n IN (120,240) THEN 6 ELSE 4 END,
        '2026-05-01'::timestamptz+n*interval '1 second',n::text,'目标'
      FROM profiles CROSS JOIN generate_series(1,240) n;
    INSERT INTO account_statistics_exclusions(user_id,game_uid,server_scope,pool_id,history_time_unknown)
      SELECT id,'uid-a','cn','limited-gap',false FROM profiles;
    INSERT INTO account_statistics_exclusions(user_id,game_uid,server_scope,pool_id,history_time_unknown)
      SELECT id,'uid-b','intl','missing-pool',true FROM profiles;
    INSERT INTO history(user_id,record_id,game_uid,server_id,pool_id,rarity,timestamp,seq_id)
      SELECT id,'ineligible-'||n,CASE WHEN n=1 THEN NULL ELSE 'uid-a' END,'cn','limited-b',6,
        CASE WHEN n=2 THEN to_timestamp(0) ELSE '2026-03-02'::timestamptz END,'invalid-'||n
      FROM profiles CROSS JOIN generate_series(1,2) n;
    INSERT INTO history(user_id,record_id,game_uid,server_id,pool_id,rarity,timestamp,seq_id)
      SELECT id,'large-'||n,'large-account','cn','standard',
        CASE WHEN n%80=0 THEN 6 WHEN n%10=0 THEN 5 ELSE 4 END,
        '2026-04-01'::timestamptz+n*interval '1 second',n::text
      FROM profiles CROSS JOIN generate_series(1,15000) n;
    ANALYZE history; ANALYZE pools; ANALYZE account_statistics_exclusions;`);
  await root.query('CREATE TEMP TABLE expected_intervals AS SELECT * FROM statistics_pity_intervals');
  const oldGlobalStart = performance.now();
  const before = await value('SELECT get_global_stats()');
  const oldGlobalMs = performance.now() - oldGlobalStart;
  assert.ok(before.statisticsContinuity.unknownInheritedIntervalCount > 0);
  assert.ok(before.byType.extra.total > 0);
  assert.equal(before.byType.limited.sparkCount, 2);
  assert.ok(Number(await value('SELECT count(*) FROM expected_intervals WHERE six_star_pity IS NULL AND five_star_pity IS NULL')) > 0);
  const oldStart = performance.now();
  await value('SELECT count(*),sum(six_star_pity),sum(five_star_pity) FROM statistics_pity_intervals');
  const oldMs = performance.now() - oldStart;
  await root.query(await readFile(new URL('../supabase/migrations/2026110700_compact_global_summary_pity.sql', import.meta.url), 'utf8'));
  await root.query(await readFile(new URL('../supabase/migrations/2026110701_join_statistics_gap_flags.sql', import.meta.url), 'utf8'));
  await root.query(await readFile(new URL('../supabase/migrations/2026110704_bound_global_spark_matching.sql', import.meta.url), 'utf8'));
  const newStart = performance.now();
  await value('SELECT count(*),sum(six_star_pity),sum(five_star_pity) FROM statistics_pity_intervals');
  const newMs = performance.now() - newStart;
  assert.equal(Number(await value(`SELECT count(*) FROM (
    (SELECT * FROM expected_intervals EXCEPT ALL SELECT * FROM statistics_pity_intervals)
    UNION ALL (SELECT * FROM statistics_pity_intervals EXCEPT ALL SELECT * FROM expected_intervals)
  ) differences`)), 0);
  const newGlobalStart = performance.now();
  const after = await value('SELECT get_global_stats()');
  const newGlobalMs = performance.now() - newGlobalStart;
  assert.deepEqual(after, before);
  const body = await value("SELECT prosrc FROM pg_proc WHERE oid='public.get_global_stats()'::regprocedure");
  const base = body.slice(body.indexOf('history_base AS MATERIALIZED'), body.indexOf('six_star_target_matches AS MATERIALIZED'));
  assert.ok(!base.includes('trusted_pity'));
  assert.ok(!body.includes('statistics_five_star_pity'));
  assert.ok(body.includes('SELECT id,user_id,six_star_pity FROM public.statistics_pity_intervals'));
  const plan = await value('EXPLAIN (ANALYZE, FORMAT JSON) SELECT * FROM statistics_pity_intervals');
  const retained = nodes(plan[0].Plan).find((node) => node['Subplan Name'] === 'CTE high_star_rows');
  assert.ok(retained, '高星记录必须在第二个窗口之前收窄并物化');
  assert.equal(retained['Actual Rows'], Number(await value('SELECT count(*) FROM expected_intervals')));
  assert.ok(!nodes(plan[0].Plan).some((node) => node['Subplan Name'] === 'CTE numbered'));
  const resets = nodes(plan[0].Plan).find((node) => node['Subplan Name'] === 'CTE resets');
  assert.equal(resets['Actual Rows'], retained['Actual Rows']);
  assert.ok(nodes(plan[0].Plan).some((node) => node['Subplan Name'] === 'CTE interruption_flags'));
  const authenticated = await database.connect('authenticated', owners[0]);
  await assert.rejects(authenticated.query('SELECT * FROM statistics_pity_intervals'), { code: '42501' });
  console.log(`通过：真实 PostgreSQL 逐行间隔与完整概览 JSON 前后一致；覆盖账号/区服、继承/系列、中断/未知中断、同时间排序、免费/赠送与无效记录。`);
  console.log(`通过：第二窗口仅保留 ${retained['Actual Rows']} 条高星记录，全量聚合不再关联保底视图；权限保持不变。`);
  console.log(`本机间隔视图耗时：修改前 ${oldMs.toFixed(1)}ms，修改后 ${newMs.toFixed(1)}ms（仅本机样本，不代表生产耗时）。`);
  console.log(`本机完整概览耗时：修改前 ${oldGlobalMs.toFixed(1)}ms，修改后 ${newGlobalMs.toFixed(1)}ms；样本 ${await value('SELECT count(*) FROM history')} 条。`);
} finally {
  await database.close();
}
