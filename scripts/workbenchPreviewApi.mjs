import { createHash, randomUUID } from 'node:crypto';
import { validateWorkbenchRules } from '../shared/workbenchRules.js';
import { computeWorkbenchMetrics } from '../shared/dataWorkbenchMetrics.js';
import { normalizeWorkspaceSubmission } from '../api/_lib/dataWorkbench.js';

export function createWorkbenchPreviewApi({ pools, entities, initialHistory = [] }) {
  let history = structuredClone(initialHistory);
  let entries = [];
  const validations = new Map();
  const commits = new Map();
  const matches = (row, scope) => String(row.gameUid ?? row.game_uid ?? row.scope?.gameUid) === String(scope.gameUid) && String(row.serverScope ?? row.server_scope ?? row.serverId ?? row.scope?.serverScope) === String(scope.serverScope);
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const contentHash = body => digest({ draftId: body.draftId, commitId: body.commitId, draftRevision: body.draftRevision, scope: body.scope, entries: body.entries, historyChanges: body.historyChanges, supplementChanges: body.supplementChanges });
  const contextHash = scope => digest({ history: history.filter(row => matches(row, scope)), entries: entries.filter(row => matches(row, scope)) });
  const historyId = row => String(row.record_id ?? row.id);
  const projectHistory = (row, change) => {
    if (!change) return row;
    const entity = entities.find(item => String(item.id) === String(change.changes.characterId ?? row.characterId ?? row.character_id));
    const method = change.changes.drawMethod;
    return { ...row, ...change.changes, ...(entity ? { name: entity.name, rarity: entity.rarity } : {}),
      ...(method ? { isFree: method === 'free', is_free: method === 'free', isInfoBook: method === 'info_book', is_info_book: method === 'info_book',
        specialType: method === 'gift' ? 'gift' : null, special_type: method === 'gift' ? 'gift' : null } : {}) };
  };
  return async function previewApi(req, url, json) {
    if (url.pathname !== '/api/data-workbench') return false;
    if (req.method === 'GET') {
      if (url.searchParams.has('commitId')) {
        const result = commits.get(url.searchParams.get('commitId'))?.result;
        json(result ? 200 : 404, result ? { success: true, result } : { success: false, error: '尚无提交结果' });
      } else {
        const scope = Object.fromEntries(url.searchParams);
        json(200, { success: true, entries: entries.filter(row => matches(row, scope) && !row.deletedAt), history: history.filter(row => matches(row, scope)), contextToken: contextHash(scope) });
      }
      return true;
    }
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 1024 * 1024) { json(413, { success: false, error: '本地草稿过大' }); return true; } }
    try {
      const body = JSON.parse(raw);
      if (body.mode === 'pool-workspace') normalizeWorkspaceSubmission(body);
      const hash = contentHash(body);
      const previous = commits.get(body.commitId);
      if (body.action === 'commit' && previous) { json(previous.hash === hash ? 200 : 409, previous.hash === hash ? { success: true, result: previous.result } : { success: false, error: '同一提交编号的内容不一致' }); return true; }
      const baseHistory = history.filter(row => matches(row, body.scope));
      const projected = baseHistory.map(row => projectHistory(row, (body.historyChanges || []).find(change => String(change.recordId) === historyId(row))));
      const originals = entries.filter(row => matches(row, body.scope) && !row.deletedAt);
      const selected = originals.flatMap(row => {
        const change = (body.supplementChanges || []).find(item => item.id === row.id);
        return change?.action === 'delete' ? [] : [{ ...(change?.entry || row), reviewState: 'confirmed' }];
      });
      selected.push(...(body.entries || []).map(row => ({ ...row, reviewState: 'confirmed' })));
      const rules = validateWorkbenchRules({ entries: selected, history: baseHistory, historyChanges: body.historyChanges, pools, entities });
      const metrics = computeWorkbenchMetrics({ entries: selected, history: projected, pools, entities, scope: body.scope });
      const issues = [...rules.issues, ...metrics.issues];
      const count = (body.entries?.length || 0) + (body.historyChanges?.length || 0) + (body.supplementChanges?.length || 0);
      const preview = { canCommit: count > 0 && !issues.length, issues, warnings: rules.warnings, checks: rules.checks, metrics };
      if (body.action === 'validate' || body.action === 'preview') {
        const validationToken = preview.canCommit ? randomUUID() : null;
        if (validationToken) validations.set(validationToken, { hash, context: contextHash(body.scope), expiresAt: Date.now() + 15 * 60000 });
        json(200, { success: true, preview, validationToken, draftRevision: body.draftRevision }); return true;
      }
      const token = validations.get(body.validationToken);
      if (body.action !== 'commit' || !preview.canCommit || !token || token.hash !== hash || token.context !== contextHash(body.scope) || token.expiresAt <= Date.now()) { json(409, { success: false, error: '内容或数据上下文已变化，请重新验证规则', preview }); return true; }
      for (const change of body.historyChanges || []) {
        const row = baseHistory.find(item => historyId(item) === String(change.recordId));
        if (!row || Number(row.editVersion ?? row.edit_version ?? 1) !== change.expectedEditVersion || String(row.poolId ?? row.pool_id) !== change.currentPoolId || String(row.seqId ?? row.seq_id) !== change.seqId) { json(409, { success: false, error: '原有明细版本冲突，整次修改未保存' }); return true; }
      }
      for (const change of body.supplementChanges || []) {
        if (originals.find(item => item.id === change.id)?.revision !== change.expectedRevision) { json(409, { success: false, error: '补充记录版本冲突，整次修改未保存' }); return true; }
      }
      // Check every version before mutating any local value.
      history = history.map(row => {
        if (!matches(row, body.scope)) return row;
        const change = (body.historyChanges || []).find(item => String(item.recordId) === historyId(row));
        return change ? { ...projectHistory(row, change), editVersion: change.expectedEditVersion + 1 } : row;
      });
      entries = entries.map(row => {
        if (!matches(row, body.scope)) return row;
        const change = (body.supplementChanges || []).find(item => item.id === row.id);
        return change ? { ...row, ...change.entry, revision: row.revision + 1, ...(change.action === 'delete' ? { deletedAt: new Date().toISOString() } : {}) } : row;
      });
      const added = (body.entries || []).map(row => ({ ...row, id: randomUUID(), revision: 1, reviewState: 'confirmed', scope: body.scope }));
      entries.push(...added);
      const result = { commitId: body.commitId, draftRevision: body.draftRevision, saved: added.length, operationCount: count,
        historyUpdated: body.historyChanges?.length || 0, supplementsUpdated: (body.supplementChanges || []).filter(change => change.action === 'update').length,
        supplementsDeleted: (body.supplementChanges || []).filter(change => change.action === 'delete').length, entryIds: added.map(row => row.id) };
      commits.set(body.commitId, { hash, result }); json(200, { success: true, result }); return true;
    } catch (failure) { json(400, { success: false, error: failure.message }); return true; }
  };
}
