import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createWorkbenchRevisionDatabase } from './lib/workbenchRevisionDatabase.mjs';

// Isolated local PostgreSQL, with no application environment or credentials.
const db = await createWorkbenchRevisionDatabase();
try {
  const { root } = db;
  const migration = async (file) => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
  const functionFrom = async (file, name) => {
    const source = await migration(file);
    const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    const end = source.indexOf('$$;', source.indexOf('AS $$', start));
    assert.ok(start >= 0 && end > start);
    await root.query(source.slice(start, end + 3));
  };
  // Use the real catalog/history triggers. The older verifier omitted public
  // statistics entirely and therefore could not reproduce the production timeout.
  const schedule = await migration('2026092201_schedule_statistics_snapshots.sql');
  await root.query(schedule.slice(schedule.indexOf('CREATE TABLE'), schedule.indexOf('\nINSERT INTO public.statistics_jobs(scope_key,total_pulls)')));
  const groups = await migration('2026092401_group_statistics_snapshots.sql');
  await root.query(groups.slice(groups.indexOf('CREATE FUNCTION'), groups.indexOf('CREATE OR REPLACE FUNCTION public.claim_statistics_job')));
  const publishing = schedule.slice(schedule.indexOf('CREATE FUNCTION public.publish_statistics_snapshot'),
    schedule.indexOf('CREATE FUNCTION public.fail_statistics_job'));
  assert.ok(publishing.includes('publish_statistics_snapshot'));
  await root.query(publishing);
  await root.query(schedule.slice(schedule.indexOf('CREATE FUNCTION public.compute_and_publish_legacy_statistics'),
    schedule.indexOf('CREATE FUNCTION public.read_statistics_snapshot')));
  await root.query(`ALTER TABLE history ADD COLUMN region TEXT, ADD COLUMN pool_version INTEGER,
    ADD COLUMN is_new BOOLEAN DEFAULT false`);
  const exclusions = await migration('2026101400_exclude_manual_statistics.sql');
  await root.query(exclusions.slice(exclusions.indexOf('DO $$ DECLARE v_function RECORD;'),
    exclusions.indexOf('CREATE FUNCTION public.invalidate_account_statistics_exclusions()')));
  await root.query('CREATE TABLE public.character_id_aliases(source TEXT,alias_id TEXT,character_id TEXT,is_primary BOOLEAN)');
  await root.query(await migration('175_invalidate_personal_analysis_catalog_dependencies.sql'));
  await functionFrom('2026101411_public_statistics_worker_contract.sql', 'statistics_account_pool_dependencies');
  const owner = randomUUID();
  const other = randomUUID();
  await root.query("INSERT INTO profiles(id,role) VALUES($1,'super_admin'),($2,'user')", [owner, other]);
  await root.query(`INSERT INTO pools(pool_id,name,type,start_time) VALUES
    ('test_pool','旧名称','limited','2026-02-01'),('next','后续池','limited','2026-04-01'),
    ('unrelated','其他武器池','weapon','2026-01-01')`);
  await root.query("INSERT INTO characters(id,name,rarity,type) VALUES('test_char','测试角色',6,'character')");
  await root.query("INSERT INTO pool_characters VALUES('test_pool','test_char',true)");
  await root.query("INSERT INTO pool_id_aliases(source,alias_id,pool_id,is_primary) VALUES('internal','test_pool','test_pool',true)");
  await root.query(`INSERT INTO history(user_id,record_id,game_uid,server_scope,pool_id,rarity,timestamp) VALUES
    ($1,'a','game','1','test_pool',6,'2026-02-02'),($1,'b','game','1','next',6,'2026-04-02'),
    ($1,'c','another-game','1','unrelated',6,'2026-01-02'),($2,'d','other-game','1','unrelated',6,'2026-01-02')`, [owner, other]);
  await root.query(await migration('2026101408_fix_pool_catalog_safe_updates.sql'));
  await root.query(await migration('2026101409_scope_pool_catalog_invalidation.sql'));
  await root.query(`CREATE TABLE roster_save_events(kind TEXT);
    CREATE FUNCTION track_roster_save_test() RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO roster_save_events VALUES(TG_OP);RETURN NULL;END $$;
    CREATE TRIGGER roster_save_test AFTER INSERT OR DELETE ON pool_characters
    FOR EACH STATEMENT EXECUTE FUNCTION track_roster_save_test();`);
  await root.query('INSERT INTO personal_analysis_owner_state(user_id) VALUES($1),($2) ON CONFLICT DO NOTHING', [owner, other]);
  await root.query(`INSERT INTO personal_analysis_scope_state(user_id,scope_game_uid,server_scope)
    VALUES($1,'game','1'),($1,'another-game','1'),($2,'other-game','1') ON CONFLICT DO NOTHING`, [owner, other]);
  const state = async () => (await root.query(`SELECT jsonb_build_object(
    'jobs',(SELECT jsonb_object_agg(scope_key,jsonb_build_array(revision,total_pulls)) FROM statistics_jobs),
    'owners',(SELECT jsonb_object_agg(user_id,history_revision) FROM personal_analysis_owner_state),
    'scopes',(SELECT jsonb_object_agg(user_id||':'||scope_game_uid||':'||server_scope,history_revision) FROM personal_analysis_scope_state)
  ) AS value`)).rows[0].value;
  const before = await state();
  const service = await db.connect('service_role', owner);
  const save = async (name, roster) => service.query(`SELECT admin_save_pool_catalog('test_pool',
    '{"name":"旧名称","type":"limited"}'::jsonb,$1,
    '[{"source":"internal","alias_id":"test_pool","is_primary":true}]'::jsonb,$2,$3)`,
  [JSON.stringify({ name, type: 'limited', roster_status: roster.length ? 'partial' : 'missing' }), JSON.stringify(roster), owner]);
  const roster = [{ character_id: 'test_char', is_up: true }];
  await root.query('ALTER TABLE public.pools ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE');
  await assert.rejects(save('新名称', [{ character_id: 'test_char', is_up: false }]),
    (error) => error.code === '42702' && error.message.includes('"id" is ambiguous'));
  assert.equal((await root.query("SELECT name FROM pools WHERE pool_id='test_pool'")).rows[0].name, '旧名称');
  assert.equal((await root.query("SELECT is_up FROM pool_characters WHERE pool_id='test_pool'")).rows[0].is_up, true);
  assert.deepEqual(await state(), before);
  await root.query(await migration('2026101410_fix_pool_roster_identifier_ambiguity.sql'));
  await root.query(await migration('2026101411_public_statistics_worker_contract.sql'));
  console.log('通过：包含真实 pools.id 列时复现保存歧义；失败保存完整回滚，修复后继续验证。');
  await save('新名称', roster);
  assert.equal((await root.query("SELECT name FROM pools WHERE pool_id='test_pool'")).rows[0].name, '新名称');
  assert.equal(Number((await root.query('SELECT count(*) AS n FROM roster_save_events')).rows[0].n), 0);
  assert.deepEqual(await state(), before);
  await root.query("UPDATE pools SET name_en='Renamed',description='新描述',banner_url='new.png' WHERE pool_id='test_pool'");
  assert.deepEqual(await state(), before);
  console.log('通过：改名及展示字段保存成功，名单不重建，公共与个人统计版本和计数均不变。');
  await save('新名称', [{ character_id: 'test_char', is_up: false }]);
  assert.equal((await root.query("SELECT is_up FROM pool_characters WHERE pool_id='test_pool'")).rows[0].is_up, false);
  let after = await state();
  assert.ok(after.jobs['pool:test_pool'][0] > before.jobs['pool:test_pool'][0]);
  assert.ok(after.jobs['pool:next'][0] > before.jobs['pool:next'][0]);
  assert.ok(after.owners[owner] > before.owners[owner]);
  assert.equal(after.owners[other], before.owners[other]);
  assert.equal(after.scopes[`${owner}:another-game:1`], before.scopes[`${owner}:another-game:1`]);
  assert.deepEqual(after.jobs['pool:unrelated'], before.jobs['pool:unrelated']);
  for (const key of ['pool:test_pool', 'pool:next', 'group:limited']) assert.equal(after.jobs[key][1], before.jobs[key][1]);
  const unchanged = await state();
  await root.query("UPDATE pool_characters SET is_up=is_up WHERE pool_id='test_pool'");
  assert.deepEqual(await state(), unchanged);
  console.log('通过：真实名单变化刷新相关卡池、跨池依赖和账号；无关账号、区服、卡池和总量不变。');
  await root.query("INSERT INTO pools(pool_id,name,type,start_time) VALUES('empty_period','无历史的新卡池','limited','2026-03-01')");
  after = await state();
  assert.ok(after.jobs['pool:next'][0] > unchanged.jobs['pool:next'][0]);
  assert.ok(after.scopes[`${owner}:game:1`] > unchanged.scopes[`${owner}:game:1`]);
  assert.equal(after.owners[other], unchanged.owners[other]);
  console.log('通过：新增无历史的中间卡池仍使情报书继承链失效，无关账号不受影响。');
  await root.query("UPDATE pools SET type='weapon',is_limited_weapon=true WHERE pool_id='test_pool'");
  after = await state();
  assert.equal(after.jobs['group:limited'][1], 1);
  assert.equal(after.jobs['group:weapon_limited'][1], 3);
  assert.deepEqual(after.jobs['pool:unrelated'], unchanged.jobs['pool:unrelated']);
  await root.query("UPDATE pools SET type='limited' WHERE pool_id='test_pool'");
  console.log('通过：卡池重新分类正确更新原、新组合的计数，未重新统计无关卡池。');
  await save('新名称', []);
  assert.equal(Number((await root.query('SELECT count(*) AS n FROM pool_characters')).rows[0].n), 0);
  // Exercise the real promotion RPC, including history, roster, aliases and
  // version references, rather than emulating an ID rename in a query mock.
  await root.query(`ALTER TABLE pool_characters ADD COLUMN created_at TIMESTAMPTZ DEFAULT now();
    CREATE TABLE version_content_snapshots(id UUID PRIMARY KEY,pool_bindings JSONB,updated_at TIMESTAMPTZ);
    INSERT INTO pools(pool_id,name,type,extra_subtype,extra_rule_profile,extra_series_key,extra_series_phase)
      VALUES('joint_manual_extra_test','临时申领','extra','reconstruction_claim','reconstruction_weapon_v1','test',1)`);
  await root.query("INSERT INTO pool_characters(pool_id,character_id,is_up) VALUES('joint_manual_extra_test','test_char',true)");
  await root.query(`INSERT INTO history(user_id,record_id,game_uid,server_scope,pool_id,rarity,timestamp,seq_id)
    VALUES($1,'promoted-row','game','1','joint_manual_extra_test',6,'2026-05-02','100')`, [owner]);
  await root.query(`INSERT INTO history(user_id,record_id,game_uid,server_scope,pool_id,rarity,timestamp,seq_id,special_type,statistics_excluded)
    VALUES($1,'promoted-gift','game','1','joint_manual_extra_test',6,'2026-05-02','101','gift',false),
      ($1,'promoted-excluded','excluded-game','1','joint_manual_extra_test',6,'2026-05-02','102',NULL,true)`, [owner]);
  await functionFrom('183_split_reconstruction_claim_subtype.sql', 'promote_manual_pool_to_official_id');
  const beforePromotion = await state();
  await service.query(`SELECT promote_manual_pool_to_official_id('joint_manual_extra_test',
    '{"pool_id":"rerun_wpn_test","name":"官方申领"}')`);
  assert.equal((await root.query("SELECT pool_id FROM history WHERE record_id='promoted-row'")).rows[0].pool_id, 'rerun_wpn_test');
  assert.equal(Number((await root.query("SELECT count(*) AS n FROM pools WHERE pool_id='joint_manual_extra_test'")).rows[0].n), 0);
  assert.equal((await root.query("SELECT pool_id FROM pool_id_aliases WHERE alias_id='joint_manual_extra_test'")).rows[0].pool_id, 'rerun_wpn_test');
  const promoted = await state();
  assert.equal(promoted.jobs['pool:rerun_wpn_test'][1], 1);
  assert.equal(promoted.jobs['pool:joint_manual_extra_test'][1], 0);
  assert.deepEqual(promoted.jobs['pool:unrelated'], beforePromotion.jobs['pool:unrelated']);
  assert.equal(promoted.owners[other], beforePromotion.owners[other]);
  assert.equal(promoted.jobs[`owner:${other}`][0], beforePromotion.jobs[`owner:${other}`][0]);
  console.log('通过：真实官方 ID 归并迁移历史、名单和旧 ID 别名，抽数不丢不重，无关卡池和用户不重算。');
  await root.query(`INSERT INTO pools(pool_id,name,type,extra_subtype,extra_rule_profile,extra_series_key,extra_series_phase)
    VALUES('series_first','已有重构','extra','reconstruction','reconstruction_character_v1','chain',1)`);
  await root.query(`INSERT INTO history(user_id,record_id,game_uid,server_scope,pool_id,rarity,timestamp)
    VALUES($1,'series-row','game','1','series_first',6,'2026-05-02')`, [owner]);
  const beforeSeries = await state();
  await root.query(`INSERT INTO pools(pool_id,name,type,extra_subtype,extra_rule_profile,extra_series_key,extra_series_phase)
    VALUES('series_empty','没有历史的新重构','extra','reconstruction','reconstruction_character_v1','chain',2)`);
  after = await state();
  assert.ok(after.jobs['pool:series_first'][0] > beforeSeries.jobs['pool:series_first'][0]);
  assert.ok(after.scopes[`${owner}:game:1`] > beforeSeries.scopes[`${owner}:game:1`]);
  assert.equal(after.owners[other], beforeSeries.owners[other]);
  console.log('通过：新增没有历史的重构期次仍刷新同系列继承依赖。');
  const anon = await db.connect('anon');
  await assert.rejects(anon.query("SELECT admin_save_pool_catalog('test_pool','{}','{}','[]','[]',NULL)"), e => e.code === '42501');
  await assert.rejects(anon.query("SELECT invalidate_pool_statistics_dependencies(ARRAY['test_pool'])"), e => e.code === '42501');
  await assert.rejects(anon.query("SELECT read_statistics_history_page(ARRAY['test_pool'],0,100000,1)"), e => e.code === '42501');
  await assert.rejects(anon.query('SELECT read_statistics_job_revisions()'), e => e.code === '42501');
  const page = (await service.query("SELECT read_statistics_history_page(ARRAY['test_pool'],0,100000,1) AS rows")).rows[0].rows;
  assert.equal(page.length, 1);
  assert.equal(page[0].pool_id, 'test_pool');
  const revisions = (await service.query('SELECT read_statistics_job_revisions() AS revisions')).rows[0].revisions;
  assert.ok(revisions['pool:test_pool']);
  assert.ok(Object.keys(revisions).every(key => key.startsWith('pool:') || key.startsWith('group:')));
  console.log('通过：删除名单仍保存，匿名角色不能调用保存与统计失效函数。');
} finally { await db.close(); }
