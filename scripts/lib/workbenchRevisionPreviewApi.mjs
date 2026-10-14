import { randomUUID } from 'node:crypto';
import { createWorkbenchRevisionDatabase } from './workbenchRevisionDatabase.mjs';
import { buildWorkspacePreview, normalizeWorkspaceSubmission, payloadFingerprint, requireScope, requireUuid,
  toWorkbenchEntry, resolveWorkbenchError, WORKBENCH_RULES_VERSION } from '../../api/_lib/dataWorkbench.js';
import { handleAccountRevisionAction, listAccountDataRevisions } from '../../api/_lib/accountDataRevisions.js';

export async function createRevisionPreviewApi(snapshot) {
  const userId = randomUUID();
  const sourceHistory = snapshot.history;
  const normalizeTime = value => {
    if (value == null) return null;
    const numeric = typeof value === 'number' || /^\d+$/u.test(String(value));
    return new Date(numeric ? Number(value) * (Number(value) < 1e12 ? 1000 : 1) : value).toISOString();
  };
  const database = await createWorkbenchRevisionDatabase({ beforeRevisionMigration: async root => {
    await root.query("INSERT INTO profiles(id,role) VALUES($1,'user')", [userId]);
    await root.query('BEGIN');
    try {
      for (const pool of snapshot.pools) await root.query(`INSERT INTO pools(pool_id,user_id,name,name_en,type,locked,is_limited_weapon,
        up_character,start_time,end_time,featured_characters,extra_subtype,extra_rule_profile,extra_series_key,extra_series_phase,roster_status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'partial')`,
      [pool.id, userId, pool.name, pool.name_en || null, pool.type, true, pool.isLimitedWeapon !== false,
        pool.up_character || null, pool.start_time || null, pool.end_time || null, pool.featured_characters || null,
        pool.extra_subtype || null, pool.extra_rule_profile || null, pool.extra_series_key || null, pool.extra_series_phase ?? null]);
      for (const entity of snapshot.entities) await root.query(`INSERT INTO characters(id,name,rarity,type,is_limited,release_date,pool_config)
        VALUES($1,$2,$3,$4,$5,$6,COALESCE($7::jsonb,'{"pools":["standard","limited"]}'::jsonb))`,
      [entity.id, entity.name, entity.rarity, entity.type, entity.is_limited || false, entity.release_date || null,
        entity.pool_config ? JSON.stringify(entity.pool_config) : null]);
      for (const pool of snapshot.pools) for (const id of pool.rosterEntityIds) await root.query(
        'INSERT INTO pool_characters(pool_id,character_id,is_up) VALUES($1,$2,$3)', [pool.id, id, pool.rosterUpEntityIds?.includes(id) || false]);
      for (const row of sourceHistory) await root.query(`INSERT INTO history(user_id,record_id,game_uid,server_id,server_scope,seq_id,pool_id,
        character_id,character_name,item_name,rarity,is_standard,is_free,is_info_book,special_type,timestamp,edit_version,pity,batch_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [userId, String(row.record_id ?? row.id), row.gameUid ?? row.game_uid, row.serverId ?? row.server_id ?? row.serverScope,
        row.serverScope ?? row.server_scope, String(row.seqId ?? row.seq_id ?? row.record_id ?? row.id), row.poolId ?? row.pool_id,
        row.characterId ?? row.character_id ?? null, row.name ?? row.character_name ?? null, row.item_name ?? null, row.rarity,
        row.isStandard ?? row.is_standard ?? false, row.isFree ?? row.is_free ?? false, row.isInfoBook ?? row.is_info_book ?? false,
        row.specialType ?? row.special_type ?? null, normalizeTime(row.timestamp), row.editVersion ?? row.edit_version ?? 1,
        row.pity ?? 0, row.batchId ?? row.batch_id ?? null]);
      await root.query('COMMIT');
    } catch (error) { await root.query('ROLLBACK'); throw error; }
  } });
  const client = await database.connect('service_role', userId);
  const rpcArguments = {
    read_account_data_workbench_context: ['p_user_id', 'p_game_uid', 'p_server_scope'],
    read_account_data_workbench_catalog: [],
    validate_account_data_workbench_workspace: ['p_user_id', 'p_payload_hash', 'p_request', 'p_operations', 'p_context_token', 'p_catalog_token', 'p_rules_version'],
    commit_account_data_workbench_workspace: ['p_user_id', 'p_validation_token', 'p_payload_hash', 'p_request', 'p_rules_version'],
    list_account_data_revisions: ['p_user_id'], preview_account_data_revert: ['p_user_id', 'p_target_id'],
    revert_account_data_revision: ['p_user_id', 'p_target_id', 'p_token', 'p_request_id'],
  };
  const db = { async rpc(name, args = {}) {
    const keys = rpcArguments[name]; if (!keys) throw new Error('本机预览 RPC 不在允许范围内');
    try {
      const values = keys.map(key => typeof args[key] === 'object' ? JSON.stringify(args[key]) : args[key]);
      const { rows } = await client.query(`SELECT public.${name}(${keys.map((_, i) => `$${i + 1}`).join(',')}) AS data`, values);
      return { data: rows[0].data, error: null };
    } catch (error) { return { data: null, error }; }
  } };
  const rpc = async (name, args) => { const { data, error } = await db.rpc(name, args); if (error) throw error; return data; };
  const context = scope => rpc('read_account_data_workbench_context', { p_user_id: userId, p_game_uid: scope.gameUid, p_server_scope: scope.serverScope });
  const readModel = async () => {
    const history = (await database.root.query('SELECT * FROM history WHERE user_id=$1 ORDER BY id', [userId])).rows;
    const entries = (await database.root.query('SELECT * FROM account_data_workbench_entries WHERE user_id=$1 AND deleted_at IS NULL', [userId])).rows;
    const exclusions = (await database.root.query('SELECT * FROM account_statistics_exclusions WHERE user_id=$1', [userId])).rows;
    return { history: history.map(row => ({ ...row, id: row.record_id, databaseId: row.id, gameUid: row.game_uid,
      serverScope: row.server_scope, poolId: row.pool_id, characterId: row.character_id, name: row.character_name,
      seqId: row.seq_id, editVersion: Number(row.edit_version), timestamp: row.timestamp?.toISOString(),
      isFree: row.is_free, isInfoBook: row.is_info_book, isStandard: row.is_standard, specialType: row.special_type, batchId: row.batch_id })), entries, exclusions };
  };
  let queue = Promise.resolve();
  const handle = async (req, url, json) => {
    if (url.pathname !== '/api/data-workbench') return false;
    const operation = async () => {
      try {
        if (req.method === 'GET') {
          if (url.searchParams.get('mode') === 'revisions') return json(200, { success: true, ...await listAccountDataRevisions(db, userId) });
          if (url.searchParams.has('commitId')) {
            const id = requireUuid(url.searchParams.get('commitId'), 'commitId');
            const prior = await database.root.query('SELECT result FROM account_data_workbench_commits WHERE user_id=$1 AND commit_id=$2', [userId, id]);
            return json(prior.rows.length ? 200 : 404, prior.rows.length ? { success: true, result: prior.rows[0].result } : { success: false, error: '尚无提交结果' });
          }
          const scope = requireScope(Object.fromEntries(url.searchParams)); const result = await context(scope);
          return json(200, { success: true, ...result, entries: result.entries.filter(row => !row.deleted_at).map(toWorkbenchEntry) });
        }
        let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 256 * 1024) throw new Error('请求过大'); }
        const body = JSON.parse(raw);
        if (body.mode === 'revisions') return json(200, { success: true, ...await handleAccountRevisionAction(db, userId, body) });
        const submission = normalizeWorkspaceSubmission(body), hash = payloadFingerprint(submission);
        if (body.action === 'commit') {
          const token = requireUuid(body.validationToken, 'validationToken');
          const result = await rpc('commit_account_data_workbench_workspace', { p_user_id: userId, p_validation_token: token,
            p_payload_hash: hash, p_request: submission, p_rules_version: WORKBENCH_RULES_VERSION });
          return json(200, { success: true, result });
        }
        const original = await context(submission.scope);
        const directory = await rpc('read_account_data_workbench_catalog');
        const catalog = { entities: snapshot.entities, pools: snapshot.pools, catalogToken: directory.catalogToken };
        const preview = buildWorkspacePreview(submission, original, catalog);
        if (!preview.canCommit) return json(200, { success: true, preview, validationToken: null, draftRevision: submission.draftRevision });
        const credential = await rpc('validate_account_data_workbench_workspace', { p_user_id: userId, p_payload_hash: hash,
          p_request: submission, p_operations: { ...submission, entries: preview.entries,
            historyChanges: preview.historyChanges, supplementChanges: preview.supplementChanges },
          p_context_token: original.contextToken, p_catalog_token: directory.catalogToken, p_rules_version: WORKBENCH_RULES_VERSION });
        return json(200, { success: true, preview, ...credential });
      } catch (error) {
        const resolved = resolveWorkbenchError(error);
        return json(resolved.status, { success: false, error: resolved.message, code: resolved.code });
      }
    };
    const request = queue.then(operation); queue = request.catch(() => {}); await request; return true;
  };
  return { handle, readModel, close: database.close, database };
}
