import { WorkbenchError, requireUuid } from './dataWorkbench.js';

const errors = {
  account_revision_not_found: [404, '修改记录不存在或不属于当前用户'],
  account_revision_expired: [409, '此记录已超出最近五次或 180 天的撤回范围'],
  account_revision_conflict: [409, '相关数据已变化，请刷新修改记录后重新预览'],
  account_revision_context_changed: [409, '预览后又有数据变化，请重新查看撤回影响'],
  account_revision_request_conflict: [409, '此撤回编号已用于其他操作'],
  account_revision_no_changes: [409, '当前数据已经与目标状态一致，无需撤回'],
  account_revision_preview_required: [400, '请先查看撤回影响'],
};
function revisionId(value) {
  const text = String(value ?? '');
  if (!/^[1-9]\d{0,18}$/u.test(text) || BigInt(text) > 9223372036854775807n) {
    throw new WorkbenchError('invalid_account_revision', '修改记录编号无效');
  }
  return text;
}
async function call(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    const code = Object.keys(errors).find(key => String(error.message || '').includes(key));
    if (code) throw new WorkbenchError(code, errors[code][1], errors[code][0]);
    throw error;
  }
  return data;
}
export async function listAccountDataRevisions(db, userId) {
  const data = await call(db, 'list_account_data_revisions', { p_user_id: userId });
  if (!Array.isArray(data?.versions) || data.versions.length > 5) throw new WorkbenchError('workbench_unavailable', '修改记录暂不可用', 503);
  return data;
}
export async function handleAccountRevisionAction(db, userId, body) {
  const targetId = revisionId(body.targetId);
  if (body.action === 'preview-revert') {
    const data = await call(db, 'preview_account_data_revert', { p_user_id: userId, p_target_id: targetId });
    if (!Array.isArray(data?.changes) || !/^[0-9a-f]{32}$/u.test(data.token || '')) throw new WorkbenchError('workbench_unavailable', '撤回预览暂不可用', 503);
    return { preview: data };
  }
  if (body.action !== 'revert') throw new WorkbenchError('invalid_account_revision_action', '修改记录操作无效');
  if (!/^[0-9a-f]{32}$/u.test(body.token || '')) throw new WorkbenchError('account_revision_preview_required', '请先查看撤回影响');
  const data = await call(db, 'revert_account_data_revision', { p_user_id: userId, p_target_id: targetId,
    p_token: body.token, p_request_id: requireUuid(body.requestId, 'requestId') });
  if (!data?.revisionId) throw new WorkbenchError('workbench_unavailable', '尚未确认撤回结果，请按原请求重试', 503);
  return { result: data };
}
