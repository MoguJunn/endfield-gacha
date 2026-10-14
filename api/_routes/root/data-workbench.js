import { getSupabaseAdminClient } from '../../_lib/authAdmin.js';
import { rejectDisallowedBrowserOrigin } from '../../_lib/http.js';
import { resolveAuthenticatedRequestUser } from '../../_lib/siteAuth.js';
import {
  WORKBENCH_TABLE, WorkbenchError, buildWorkbenchPreview, loadWorkbenchCatalog,
  loadWorkbenchContext, normalizeSubmission, parseWorkbenchBody, payloadFingerprint,
  readCommit, requireRevision, requireScope, requireUuid, resolveWorkbenchError, toWorkbenchEntry,
  WORKBENCH_RULES_VERSION, buildWorkspacePreview, loadWorkspaceCatalog, normalizeWorkspaceSubmission,
} from '../../_lib/dataWorkbench.js';
import { isWorkbenchPoolUnopened, validateWorkbenchPoolOperations, workbenchPoolUnavailableMessage } from '../../../shared/workbenchPoolAvailability.js';
import { handleAccountRevisionAction, listAccountDataRevisions } from '../../_lib/accountDataRevisions.js';

function sendError(res, error) {
  const resolved = resolveWorkbenchError(error);
  return res.status(resolved.status).json({
    success: false, code: resolved.code, error: resolved.message,
    ...(resolved.latest ? { latest: resolved.latest } : {}),
  });
}

async function getEntry(db, userId, id) {
  // 保留删除后的版本，才能向持有旧副本的界面返回冲突对照。
  const { data, error } = await db.from(WORKBENCH_TABLE).select('*').eq('user_id', userId).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new WorkbenchError('workbench_entry_not_found', '记录不存在', 404);
  return data;
}

function revisionConflict(row) {
  const error = new WorkbenchError('workbench_revision_conflict', '记录已被修改，请比较当前值后重试', 409);
  error.latest = toWorkbenchEntry(row);
  return error;
}

async function matchingCommit(db, userId, commitId, fingerprint) {
  const prior = await readCommit(db, userId, commitId);
  if (prior && prior.payload_hash !== fingerprint) {
    throw new WorkbenchError('workbench_idempotency_conflict', '该提交编号已经用于其他内容', 409);
  }
  return prior;
}

async function previewSubmission(db, userId, submission, options) {
  const [context, catalog] = await Promise.all([
    loadWorkbenchContext(db, userId, submission.scope), loadWorkbenchCatalog(db),
  ]);
  return { context, preview: buildWorkbenchPreview(submission, context, catalog, options) };
}

async function handleGet(db, userId, url, res) {
  if (url.searchParams.get('mode') === 'revisions') {
    return res.status(200).json({ success: true, ...await listAccountDataRevisions(db, userId) });
  }
  if (url.searchParams.has('commitId')) {
    const commitId = requireUuid(url.searchParams.get('commitId'), 'commitId');
    const commit = await readCommit(db, userId, commitId);
    if (!commit) throw new WorkbenchError('workbench_commit_not_found', '提交记录不存在', 404);
    return res.status(200).json({ success: true, result: commit.result });
  }
  const scope = requireScope({ gameUid: url.searchParams.get('gameUid'), serverScope: url.searchParams.get('serverScope') });
  const context = await loadWorkbenchContext(db, userId, scope);
  return res.status(200).json({ success: true, entries: context.entries.filter((row) => !row.deleted_at).map(toWorkbenchEntry),
    ...(url.searchParams.get('includeHistory') === '1' ? { history: context.history, contextToken: context.contextToken } : {}),
  });
}

async function handleWorkspacePost(db, userId, action, body, res) {
  if (!['validate', 'commit'].includes(action)) throw new WorkbenchError('invalid_workbench_action', '请选择 validate 或 commit 操作');
  const submission = normalizeWorkspaceSubmission(body);
  const fingerprint = payloadFingerprint(submission);
  if (action === 'commit') {
    if (!body.validationToken) throw new WorkbenchError('workbench_validation_required', '请先完成有效的统一校验', 409);
    const token = requireUuid(body.validationToken, 'validationToken');
    const prior = await matchingCommit(db, userId, submission.commitId, fingerprint);
    if (prior) return res.status(200).json({ success: true, result: prior.result });
    const [context, catalog] = await Promise.all([loadWorkbenchContext(db, userId, submission.scope), loadWorkspaceCatalog(db)]);
    const availability = validateWorkbenchPoolOperations({ ...submission, history: context.history, existingEntries: context.entries, pools: catalog.pools });
    if (availability.length) throw new WorkbenchError('pool_not_open', availability.map(item => item.message).join('；'), 409);
    // 所有操作来自数据库中校验过的副本；同一请求重试由 RPC 在检查过期前返回原结果。
    const { data, error } = await db.rpc('commit_account_data_workbench_workspace', {
      p_user_id: userId, p_validation_token: token, p_payload_hash: fingerprint,
      p_request: submission, p_rules_version: WORKBENCH_RULES_VERSION,
    });
    if (error) throw error;
    if (!data?.commitId || data.commitId !== submission.commitId || !Array.isArray(data.entryIds)
      || data.saved !== submission.entries.length || data.draftRevision !== submission.draftRevision
      || data.operationCount !== submission.entries.length + submission.historyChanges.length + submission.supplementChanges.length) throw new WorkbenchError('workbench_unavailable', '数据库没有返回有效的原子提交结果', 503);
    return res.status(200).json({ success: true, result: data });
  }
  const [context, catalog] = await Promise.all([
    loadWorkbenchContext(db, userId, submission.scope), loadWorkspaceCatalog(db),
  ]);
  const preview = buildWorkspacePreview(submission, context, catalog);
  if (!preview.canCommit) return res.status(200).json({ success: true, preview, validationToken: null, draftRevision: submission.draftRevision });
  const validated = { ...submission, entries: preview.entries, historyChanges: preview.historyChanges, supplementChanges: preview.supplementChanges };
  const { data, error } = await db.rpc('validate_account_data_workbench_workspace', {
    p_user_id: userId, p_payload_hash: fingerprint, p_request: submission, p_operations: validated,
    p_context_token: context.contextToken, p_catalog_token: catalog.catalogToken,
    p_rules_version: WORKBENCH_RULES_VERSION,
  });
  if (error) throw error;
  if (!data?.validationToken || data.draftRevision !== submission.draftRevision) throw new WorkbenchError('workbench_unavailable', '数据库没有返回有效的校验凭证', 503);
  return res.status(200).json({ success: true, preview, validationToken: data.validationToken,
    draftRevision: submission.draftRevision, expiresAt: data.expiresAt,
  });
}

async function handlePost(db, userId, url, body, res) {
  if (body.mode === 'revisions') {
    return res.status(200).json({ success: true, ...await handleAccountRevisionAction(db, userId, body) });
  }
  const action = url.searchParams.get('action') || body.action;
  if (body.mode === 'pool-workspace') return handleWorkspacePost(db, userId, action, body, res);
  if (body.mode != null) throw new WorkbenchError('invalid_workbench_mode', '工作台模式无效');
  if (!['preview', 'commit'].includes(action)) throw new WorkbenchError('invalid_workbench_action', '请选择 preview 或 commit 操作');
  const submission = normalizeSubmission(body);
  const fingerprint = payloadFingerprint(submission);
  if (action === 'commit') {
    const prior = await matchingCommit(db, userId, submission.commitId, fingerprint);
    if (prior) {
      return res.status(200).json({ success: true, result: prior.result });
    }
  }
  // commit 不接受浏览器提供的校验结果；每次重新读取完整 scope 并重新校验。
  const { context, preview } = await previewSubmission(db, userId, submission);
  if (action === 'preview') return res.status(200).json({ success: true, preview });
  if (!preview.canCommit) {
    // 并发的同次提交可能在首次查幂等记录后已成功，不能将其误报为重复数据。
    const prior = await matchingCommit(db, userId, submission.commitId, fingerprint);
    if (prior) return res.status(200).json({ success: true, result: prior.result });
    return res.status(409).json({ success: false, code: 'workbench_preview_blocked', error: '请先处理预览中的问题', preview });
  }
  const { data, error } = await db.rpc('commit_account_data_workbench', {
    p_user_id: userId, p_commit_id: submission.commitId, p_draft_id: submission.draftId,
    p_game_uid: submission.scope.gameUid, p_server_scope: submission.scope.serverScope,
    p_payload_hash: fingerprint, p_context_token: context.contextToken,
    p_entries: preview.entries.map((entry) => ({
      entryId: entry.entryId, kind: entry.kind, poolId: entry.poolId ?? null,
      values: entry.values, timePrecision: entry.timePrecision, source: entry.source,
    })),
  });
  if (error) throw error;
  if (!data?.commitId || !Array.isArray(data.entryIds) || data.saved !== submission.entries.length) {
    throw new WorkbenchError('workbench_unavailable', '数据库没有返回有效的提交结果', 503);
  }
  return res.status(200).json({ success: true, result: data });
}

async function handleMutation(db, userId, method, body, res) {
  const id = requireUuid(body.id, 'id');
  const expectedRevision = requireRevision(body.expectedRevision);
  const row = await getEntry(db, userId, id);
  if (row.revision !== expectedRevision) throw revisionConflict(row);
  if (row.deleted_at) throw new WorkbenchError('workbench_entry_not_found', '记录已删除', 404);
  const catalog = await loadWorkbenchCatalog(db);
  const originalPool = catalog.pools.find(pool => String(pool.id) === String(row.pool_id));
  if (isWorkbenchPoolUnopened(originalPool)) throw new WorkbenchError('pool_not_open', workbenchPoolUnavailableMessage(originalPool), 409);
  let entry = null;
  let contextToken = null;
  let reason = '';
  if (method === 'PATCH') {
    if (!body.entry || typeof body.entry !== 'object' || Array.isArray(body.entry)) throw new WorkbenchError('invalid_workbench_entry', '请提供完整记录');
    const submission = {
      draftId: row.draft_id, scope: { gameUid: row.game_uid, serverScope: row.server_scope },
      entries: [{
        entryId: row.entry_id, kind: body.entry.kind, poolId: body.entry.poolId ?? null,
        values: body.entry.values, timePrecision: body.entry.timePrecision,
        reviewState: body.entry.reviewState, source: 'manual',
      }],
    };
    const { context, preview } = await previewSubmission(db, userId, submission, { excludeId: id });
    const current = context.entries.find((item) => item.id === id);
    if (current && current.revision !== expectedRevision) throw revisionConflict(current);
    if (!preview.canCommit) return res.status(409).json({ success: false, code: 'workbench_preview_blocked', error: '请先处理记录中的问题', preview });
    entry = preview.entries[0];
    contextToken = context.contextToken;
  } else {
    if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) {
      throw new WorkbenchError('invalid_workbench_delete_reason', '请填写 1 至 500 字的删除原因');
    }
    reason = body.reason.trim();
  }
  const { data, error } = await db.rpc('mutate_account_data_workbench_entry', {
    p_user_id: userId, p_id: id, p_expected_revision: expectedRevision,
    p_action: method === 'PATCH' ? 'update' : 'delete', p_entry: entry,
    p_context_token: contextToken, p_reason: reason,
  });
  if (error) {
    const resolved = resolveWorkbenchError(error);
    if (['workbench_revision_conflict', 'workbench_context_changed', 'workbench_entry_not_found'].includes(resolved.code)) {
      const current = await getEntry(db, userId, id);
      if (current.revision !== expectedRevision) throw revisionConflict(current);
      resolved.latest = toWorkbenchEntry(current);
    }
    throw resolved;
  }
  if (!data?.id || data.revision !== expectedRevision + 1) throw new WorkbenchError('workbench_unavailable', '数据库没有返回有效的修改结果', 503);
  const savedEntry = toWorkbenchEntry(data);
  return res.status(200).json({ success: true, entries: [savedEntry], entry: savedEntry, revision: data.revision });
}

export default async function dataWorkbenchHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (rejectDisallowedBrowserOrigin(req, res, { methods: 'GET, POST, PATCH, DELETE, OPTIONS', headers: 'Content-Type, Authorization' })) return;
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE, OPTIONS');
    return sendError(res, new WorkbenchError('method_not_allowed', 'Method not allowed', 405));
  }
  try {
    const db = getSupabaseAdminClient();
    if (!db) throw new WorkbenchError('workbench_unavailable', '补录服务尚未配置', 503);
    const auth = await resolveAuthenticatedRequestUser(req, { adminClient: db, touch: true });
    if (!auth.ok) throw new WorkbenchError(auth.code || 'authentication_required', auth.error || '请先登录', auth.status || 401);
    const url = new URL(req.url || '/api/data-workbench', 'http://localhost');
    if (req.method === 'GET') return await handleGet(db, auth.user.id, url, res);
    const body = parseWorkbenchBody(req);
    if (req.method === 'POST') return await handlePost(db, auth.user.id, url, body, res);
    return await handleMutation(db, auth.user.id, req.method, body, res);
  } catch (error) {
    return sendError(res, error);
  }
}
