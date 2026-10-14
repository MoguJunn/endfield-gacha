import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createWorkbenchRevisionDatabase } from './lib/workbenchRevisionDatabase.mjs';

const owner = randomUUID(), foreign = randomUUID();
let checks = 0;
const db = await createWorkbenchRevisionDatabase({ historyScopeGenerated: true, beforeRevisionMigration: async root => {
  await root.query("INSERT INTO profiles(id,role) VALUES ($1,'user'),($2,'user')", [owner, foreign]);
  await root.query("INSERT INTO pools(pool_id,name,type) VALUES ('standard','基础寻访','standard')");
  await root.query("INSERT INTO characters(id,name,rarity,type) VALUES ('four','四星',4,'character')");
  await root.query("INSERT INTO history(user_id,record_id,game_uid,server_id,pool_id,rarity,character_id,seq_id,edit_version) VALUES ($1,'same-record','100','1','standard',4,'four','1',50),($1,'same-record','200','2','standard',4,'four','1',10)", [owner]);
} });
const { root } = db;
const service = await db.connect('service_role');
const scalar = async (sql, args = []) => Object.values((await root.query(sql, args)).rows[0])[0];
const rpc = async (name, args) => (await service.query(`SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) AS data`, args)).rows[0].data;
const list = () => rpc('list_account_data_revisions', [owner]);
const preview = id => rpc('preview_account_data_revert', [owner, id]);
const revert = (p, request = randomUUID()) => rpc('revert_account_data_revision', [owner, p.targetId, p.token, request]);
const check = async (title, fn) => { await fn(); console.log(`通过 ${++checks}：${title}`); };
try {
  await check('真实 PostgreSQL 迁移执行；只读导入的初始数据没有虚构旧版本', async () => {
    assert.equal((await list()).versions.length, 0);
  });
  await check('同一事务多行合为一个版本；重复 record_id 在不同账号中保持隔离', async () => {
    await root.query('BEGIN');
    await root.query("UPDATE history SET rarity=5,edit_version=edit_version+1 WHERE user_id=$1 AND game_uid='100'", [owner]);
    await root.query("UPDATE history SET rarity=6,edit_version=edit_version+1 WHERE user_id=$1 AND game_uid='200'", [owner]);
    await root.query('COMMIT');
    const versions = await list(); assert.equal(versions.versions.length, 1); assert.equal(versions.versions[0].operationCount, 2);
    const plan = await preview(versions.headId); assert.equal(plan.changes.length, 2);
    assert.equal('rows' in plan, false); await revert(plan);
    assert.deepEqual((await root.query('SELECT rarity FROM history ORDER BY id')).rows.map(r => r.rarity), [4, 4]);
    assert.equal(Number(await scalar("SELECT edit_version FROM history WHERE game_uid='100'")), 52);
  });
  await check('更新仅存变化字段；派生保底不会增加版本或复制整份历史', async () => {
    await root.query("UPDATE history SET rarity=5,edit_version=edit_version+1 WHERE game_uid='100'");
    const head = (await list()).headId;
    const delta = await scalar('SELECT delta FROM account_data_revision_deltas WHERE revision_id=$1', [head]);
    assert.deepEqual(delta.map(p => p.path), [['rarity']]);
    await root.query("UPDATE history SET pity=99,batch_id='derived-test',updated_at=now()");
    assert.equal((await list()).headId, head);
  });
  await check('新插入、删除、还原以及还原撤回均生成增量版本', async () => {
    await root.query("INSERT INTO history(user_id,record_id,game_uid,server_id,pool_id,rarity) VALUES($1,'added','100','1','standard',4)", [owner]);
    let p = await preview((await list()).headId); const receipt = await revert(p);
    assert.equal(await scalar("SELECT count(*)::int FROM history WHERE record_id='added'"), 0);
    await revert(await preview(receipt.revisionId));
    assert.equal(await scalar("SELECT count(*)::int FROM history WHERE record_id='added'"), 1);
    await root.query("UPDATE history SET edit_version=100 WHERE record_id='added'");
    await root.query("DELETE FROM history WHERE record_id='added'");
    await revert(await preview((await list()).headId));
    assert.equal(Number(await scalar("SELECT edit_version FROM history WHERE record_id='added'")), 101);
    assert.equal(await scalar("SELECT server_scope FROM history WHERE record_id='added'"), '1');
  });
  await check('同一撤回编号重试只返回收据；旧预览遇到新提交明确拒绝', async () => {
    await root.query("UPDATE history SET rarity=6 WHERE record_id='added'");
    const p = await preview((await list()).headId), id = randomUUID();
    const first = await revert(p, id), again = await revert(p, id);
    assert.equal(first.revisionId, again.revisionId); assert.equal(again.replayed, true);
    await assert.rejects(revert({ ...p, token: '0'.repeat(32) }, id), /account_revision_request_conflict/);
    const stale = await preview(first.revisionId);
    await root.query("UPDATE history SET rarity=5 WHERE record_id='added'");
    await assert.rejects(revert(stale), /account_revision_context_changed/);
  });
  await check('只保留最近五次的增量，180 天边界阻止过期撤回并可清理', async () => {
    for (let i = 0; i < 6; i++) await root.query('UPDATE history SET rarity=$1 WHERE record_id=\'added\'', [i % 2 ? 4 : 5]);
    const versions = await list(); assert.equal(versions.versions.length, 5);
    assert.equal(await scalar('SELECT count(DISTINCT revision_id)::int FROM account_data_revision_deltas'), 5);
    const last = versions.versions.at(-1).id;
    await root.query("UPDATE account_data_revisions SET created_at=clock_timestamp()-interval '180 days 1 second' WHERE id=$1", [last]);
    await assert.rejects(preview(last), /account_revision_expired/);
    await rpc('prune_account_data_revisions', []);
    assert.equal(await scalar('SELECT count(*)::int FROM account_data_revisions WHERE id=$1', [last]), 0);
  });
  await check('普通用户不能绕过接口读增量或撤回他人版本', async () => {
    const auth = await db.connect('authenticated', owner);
    await assert.rejects(auth.query('SELECT * FROM account_data_revision_deltas'), { code: '42501' });
    await assert.rejects(auth.query('SELECT list_account_data_revisions($1)', [owner]), { code: '42501' });
    await assert.rejects(rpc('preview_account_data_revert', [foreign, (await list()).headId]), /account_revision_not_found/);
  });
  await check('补充记录嵌套字段只存增量，软删除可恢复；事务失败不留下版本', async () => {
    const entryId = randomUUID(), draft = randomUUID();
    await root.query(`INSERT INTO account_data_workbench_entries(user_id,game_uid,server_scope,pool_id,entry_id,draft_id,kind,time_precision,"values")
      VALUES($1,'100','1','standard',$2,$3,'pool-ledger','unknown','{"totalPulls":20,"notes":"保留的未改字段"}')`, [owner, entryId, draft]);
    await root.query(`UPDATE account_data_workbench_entries SET "values"=jsonb_set("values",'{totalPulls}','30'),revision=revision+1`);
    const head = (await list()).headId;
    assert.deepEqual((await scalar('SELECT delta FROM account_data_revision_deltas WHERE revision_id=$1', [head])).map(p => p.path), [['values', 'totalPulls']]);
    await revert(await preview(head));
    assert.equal(await scalar('SELECT "values"->>\'totalPulls\' FROM account_data_workbench_entries'), '20');
    await root.query('UPDATE account_data_workbench_entries SET deleted_at=now(),revision=revision+1');
    await revert(await preview((await list()).headId));
    assert.equal(await scalar('SELECT deleted_at FROM account_data_workbench_entries'), null);
    const before = (await list()).headId; await root.query('BEGIN');
    await root.query('UPDATE account_data_workbench_entries SET deleted_at=now()'); await root.query('ROLLBACK');
    assert.equal((await list()).headId, before);
  });
  await check('累计撤回最近两次，跨表修改一次事务完成并失效个人统计', async () => {
    await root.query("UPDATE history SET rarity=6 WHERE record_id='added'"); const target = (await list()).headId;
    await root.query(`UPDATE account_data_workbench_entries SET "values"=jsonb_set("values",'{totalPulls}','40')`);
    const plan = await preview(target); assert.equal(Number(plan.revisionCount), 2);
    assert.equal(plan.changes.length, 2); const result = await revert(plan); assert.equal(result.changed, 2);
    assert.ok(await scalar('SELECT dirty_since IS NOT NULL FROM personal_analysis_owner_state WHERE user_id=$1', [owner]));
  });
  await check('数组逐项增量支持新增、移除、空值与嵌套修改，没有完整数组副本', async () => {
    for (const [before, after] of [
      [[{ value: 1 }, { value: 2 }], [{ value: 1 }, { value: 3 }]],
      [[1], [1, 2, 3]], [[1, 2, 3], [1]],
      [{ nested: null }, { nested: { count: 2 } }], [{ keep: 1 }, { keep: 1, added: null }],
    ]) {
      const result = (await root.query(`SELECT account_revision_diff($1::jsonb,$2::jsonb) AS delta,
        account_revision_inverse($2::jsonb,account_revision_diff($1::jsonb,$2::jsonb)) AS restored`,
      [JSON.stringify(before), JSON.stringify(after)])).rows[0];
      assert.deepEqual(result.restored, before);
    }
    const large = Array.from({ length: 1000 }, (_, index) => ({ id: index, count: 1 }));
    const next = structuredClone(large); next[400].count = 2;
    const delta = await scalar('SELECT account_revision_diff($1::jsonb,$2::jsonb)', [JSON.stringify(large), JSON.stringify(next)]);
    assert.deepEqual(delta.map(p => p.path), [['400', 'count']]);
    assert.ok(Buffer.byteLength(JSON.stringify(delta)) < 200);
  });
  await check('原子工作台保存只写一份增量，校验副本压缩后精确重试仍有效', async () => {
    const draftId = randomUUID(), commitId = randomUUID(), entryId = randomUUID();
    const request = { mode: 'pool-workspace', draftId, commitId, draftRevision: 1,
      scope: { gameUid: 'credential-test', serverScope: '1' }, historyChanges: [], supplementChanges: [],
      entries: [{ entryId, poolId: 'standard', kind: 'pool-ledger', source: 'manual', derivation: 'declared',
        timePrecision: 'unknown', values: { totalPulls: 20 } }] };
    const original = await rpc('read_account_data_workbench_context', [owner, 'credential-test', '1']);
    const catalog = await rpc('read_account_data_workbench_catalog', []);
    const credential = await rpc('validate_account_data_workbench_workspace', [owner, 'a'.repeat(64),
      JSON.stringify(request), JSON.stringify(request), original.contextToken, catalog.catalogToken, 'pool-workspace-1']);
    const result = await rpc('commit_account_data_workbench_workspace', [owner, credential.validationToken,
      'a'.repeat(64), JSON.stringify(request), 'pool-workspace-1']);
    assert.equal(result.saved, 1);
    assert.deepEqual(await scalar('SELECT operations FROM account_data_workbench_validations WHERE token=$1', [credential.validationToken]), {});
    assert.equal(await scalar('SELECT count(*)::int FROM account_data_workbench_audit'), 0);
    assert.deepEqual(await rpc('commit_account_data_workbench_workspace', [owner, credential.validationToken,
      'a'.repeat(64), JSON.stringify(request), 'pool-workspace-1']), result);
    const id = (await list()).headId; await revert(await preview(id));
    assert.equal(await scalar("SELECT count(*)::int FROM account_data_workbench_entries WHERE game_uid='credential-test'"), 0);
  });
  await check('两个并发撤回只执行一次，另一个过期预览被拒绝', async () => {
    await root.query("UPDATE history SET rarity=5 WHERE record_id='added'");
    const plan = await preview((await list()).headId), other = await db.connect('service_role');
    const results = await Promise.allSettled([revert(plan), other.query('SELECT revert_account_data_revision($1,$2,$3,$4)',
      [owner, plan.targetId, plan.token, randomUUID()])]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(results.find(result => result.status === 'rejected').reason.message, /account_revision_context_changed/);
  });
  console.log(`增量记录、撤回窗口、冲突、账号隔离和事务验证全部通过：${checks} 项。`);
} finally { await db.close(); }
