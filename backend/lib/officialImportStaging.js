import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const STAGED_RECORD_BATCH_SIZE = 500;
const DEFAULT_REVIEW_TTL_MS = 30 * 60 * 1000;
const ACTIVE_STATUSES = new Set(['processing', 'awaiting_confirmation', 'confirming']);

export class OfficialImportReviewError extends Error {
  constructor(code, message, statusCode = 400, details = {}) {
    super(message);
    this.name = 'OfficialImportReviewError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function createReviewError(code, message, statusCode = 400, details = {}) {
  return new OfficialImportReviewError(code, message, statusCode, details);
}

function normalizeText(value, maxLength = 4096) {
  const text = String(value ?? '').trim();
  return text && text.length <= maxLength ? text : '';
}

function hashAccessKey(accessKey) {
  return createHash('sha256')
    .update(String(accessKey || ''))
    .digest('hex');
}

function accessKeysMatch(accessKey, expectedHash) {
  const actual = Buffer.from(hashAccessKey(accessKey), 'utf8');
  const expected = Buffer.from(String(expectedHash || ''), 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function withoutIssueList(summary = {}) {
  const { issues: _issues, ...safeSummary } = summary || {};
  return safeSummary;
}

function publicTask(task = {}) {
  return {
    id: task.id,
    source: task.source,
    importMode: task.import_mode,
    gameUid: task.game_uid,
    serverId: task.server_id,
    region: task.region,
    status: task.status,
    summary: task.summary || {},
    issues: task.issues || [],
    expiresAt: task.expires_at,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    confirmedAt: task.confirmed_at,
    committedAt: task.committed_at,
    rejectedAt: task.rejected_at,
  };
}

function normalizeStagedRecord(record = {}, ordinal, poolById) {
  const historyRecord = record.historyRecord || {};
  const normalized = record.normalized || {};
  const poolId = normalizeText(historyRecord.pool_id || normalized.poolId, 200) || null;
  const pool = poolById.get(poolId) || null;

  return {
    ordinal,
    pool_id: poolId,
    item_id: normalizeText(normalized.rawItemId || normalized.itemId, 200) || null,
    item_name: normalizeText(normalized.itemName, 300) || null,
    item_type: normalizeText(normalized.itemType, 80) || 'unknown',
    quality: Number.isFinite(Number(normalized.quality)) ? Number(normalized.quality) : null,
    timestamp: normalized.timestamp || historyRecord.timestamp || null,
    seq_id: normalizeText(historyRecord.seq_id || normalized.seqId, 200) || null,
    normalized_record: {
      history: historyRecord,
      normalized: {
        rawItemId: normalized.rawItemId || null,
        itemId: normalized.itemId || null,
        itemName: normalized.itemName || null,
        itemType: normalized.itemType || 'unknown',
        quality: normalized.quality ?? null,
        poolId: normalized.poolId || poolId,
        poolName: normalized.poolName || pool?.name || null,
        seqId: normalized.seqId || historyRecord.seq_id || null,
        timestamp: normalized.timestamp || historyRecord.timestamp || null,
        isFree: normalized.isFree === true,
        isInfoBook: normalized.isInfoBook === true,
        isNew: normalized.isNew === true,
        gameUid: normalized.gameUid || historyRecord.game_uid || null,
        serverId: normalized.serverId || historyRecord.server_id || null,
        region: normalized.region || historyRecord.region || null,
      },
      pool,
    },
    raw_min: record.rawMin || normalized.rawMin || {},
    issues: Array.isArray(record.issues) ? record.issues : [],
    selected_action: record.blocked === true ? 'skip' : 'keep',
  };
}

async function deleteTaskQuietly(supabase, taskId) {
  try {
    await supabase.from('official_import_tasks').delete().eq('id', taskId);
  } catch {
    // The task has ON DELETE CASCADE; a failed cleanup is safe and can expire normally.
  }
}

async function loadTaskRow(supabase, { taskId, userId }) {
  const { data, error } = await supabase
    .from('official_import_tasks')
    .select('*')
    .eq('id', taskId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw createReviewError('REVIEW_TASK_LOAD_FAILED', `读取导入审阅任务失败：${error.message}`, 500);
  }
  if (!data) {
    throw createReviewError('REVIEW_TASK_NOT_FOUND', '未找到这次导入审阅任务，或它不属于当前用户。', 404);
  }
  return data;
}

async function expireTaskIfNeeded(supabase, task) {
  const expiresAt = Date.parse(task.expires_at || '');
  if (!ACTIVE_STATUSES.has(task.status) || !Number.isFinite(expiresAt) || expiresAt > Date.now()) {
    return task;
  }

  await supabase
    .from('official_import_tasks')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('id', task.id)
    .in('status', Array.from(ACTIVE_STATUSES));

  return { ...task, status: 'expired' };
}

function assertTaskAccess(task, accessKey) {
  if (!normalizeText(accessKey, 512) || !accessKeysMatch(accessKey, task.access_key_hash)) {
    throw createReviewError('REVIEW_ACCESS_DENIED', '导入审阅凭证无效，请重新发起导入。', 403);
  }
}

async function loadStagedRows(supabase, taskId) {
  const { data, error } = await supabase
    .from('official_import_staged_records')
    .select('*')
    .eq('task_id', taskId)
    .order('ordinal', { ascending: true });

  if (error) {
    throw createReviewError('STAGED_RECORDS_LOAD_FAILED', `读取暂存记录失败：${error.message}`, 500);
  }
  return Array.isArray(data) ? data : [];
}

export async function stageOfficialImportTask({
  supabase,
  userId,
  source,
  importMode,
  account,
  pools = [],
  stagedRecords = [],
  reviewSummary = {},
  importSummary = {},
  expiresAt,
}) {
  if (!supabase || !userId || !account?.gameUid) {
    throw createReviewError('INVALID_STAGING_CONTEXT', '缺少导入暂存所需的用户或游戏账号信息。');
  }

  const accessKey = randomBytes(32).toString('base64url');
  const accessKeyHash = hashAccessKey(accessKey);
  const resolvedExpiresAt = expiresAt || new Date(Date.now() + DEFAULT_REVIEW_TTL_MS).toISOString();
  const issueList = Array.isArray(reviewSummary?.issues) ? reviewSummary.issues : [];
  const taskSummary = {
    ...importSummary,
    review: withoutIssueList(reviewSummary),
  };

  const { data: task, error: taskError } = await supabase
    .from('official_import_tasks')
    .insert({
      user_id: userId,
      source,
      import_mode: importMode,
      game_uid: String(account.gameUid),
      server_id: account.serverId ? String(account.serverId) : null,
      region: account.region || null,
      status: 'processing',
      access_key_hash: accessKeyHash,
      summary: taskSummary,
      issues: issueList,
      expires_at: resolvedExpiresAt,
    })
    .select('*')
    .single();

  if (taskError || !task?.id) {
    throw createReviewError(
      'REVIEW_TASK_CREATE_FAILED',
      `创建导入审阅任务失败：${taskError?.message || '数据库没有返回任务 ID'}`,
      500
    );
  }

  const poolById = new Map((Array.isArray(pools) ? pools : []).map((pool) => [String(pool?.pool_id || ''), pool]));
  const rows = (Array.isArray(stagedRecords) ? stagedRecords : []).map((record, ordinal) => ({
    task_id: task.id,
    ...normalizeStagedRecord(record, ordinal, poolById),
  }));

  try {
    for (let index = 0; index < rows.length; index += STAGED_RECORD_BATCH_SIZE) {
      const { error } = await supabase
        .from('official_import_staged_records')
        .insert(rows.slice(index, index + STAGED_RECORD_BATCH_SIZE));
      if (error) {
        throw error;
      }
    }

    const { data: readyTask, error: readyError } = await supabase
      .from('official_import_tasks')
      .update({
        status: 'awaiting_confirmation',
        updated_at: new Date().toISOString(),
      })
      .eq('id', task.id)
      .eq('status', 'processing')
      .select('*')
      .single();

    if (readyError || !readyTask) {
      throw readyError || new Error('任务状态未能切换为等待确认');
    }

    return {
      task: publicTask(readyTask),
      accessKey,
      records: rows.map((row) => ({
        ordinal: row.ordinal,
        poolId: row.pool_id,
        itemId: row.item_id,
        itemName: row.item_name,
        itemType: row.item_type,
        quality: row.quality,
        timestamp: row.timestamp,
        seqId: row.seq_id,
        issues: row.issues,
        selectedAction: row.selected_action,
      })),
    };
  } catch (error) {
    await deleteTaskQuietly(supabase, task.id);
    throw createReviewError('STAGING_RECORDS_SAVE_FAILED', `暂存导入记录失败：${error.message}`, 500);
  }
}

export async function getOfficialImportReview({ supabase, taskId, userId, accessKey }) {
  let task = await loadTaskRow(supabase, { taskId, userId });
  assertTaskAccess(task, accessKey);
  task = await expireTaskIfNeeded(supabase, task);

  if (task.status === 'expired') {
    throw createReviewError('REVIEW_TASK_EXPIRED', '这次导入审阅已过期，请重新导入。', 410);
  }

  const rows = await loadStagedRows(supabase, task.id);
  return {
    task: publicTask(task),
    records: rows.map((row) => ({
      ordinal: row.ordinal,
      poolId: row.pool_id,
      itemId: row.item_id,
      itemName: row.item_name,
      itemType: row.item_type,
      quality: row.quality,
      timestamp: row.timestamp,
      seqId: row.seq_id,
      issues: row.issues || [],
      selectedAction: row.selected_action,
    })),
  };
}

function normalizeDecisions(decisions) {
  const decisionMap = new Map();
  (Array.isArray(decisions) ? decisions : []).forEach((decision) => {
    const ordinal = Number(decision?.ordinal);
    const action = decision?.action;
    if (!Number.isInteger(ordinal) || ordinal < 0 || !['keep', 'skip'].includes(action)) {
      throw createReviewError('INVALID_REVIEW_DECISION', '导入审阅选项格式无效。');
    }
    decisionMap.set(ordinal, action);
  });
  return decisionMap;
}

export async function confirmOfficialImportTask({ supabase, taskId, userId, accessKey, decisions = [], commit }) {
  let task = await loadTaskRow(supabase, { taskId, userId });
  assertTaskAccess(task, accessKey);
  task = await expireTaskIfNeeded(supabase, task);

  if (task.status === 'committed') {
    return { task: publicTask(task), result: task.summary?.commitResult || {}, idempotent: true };
  }
  if (task.status === 'expired') {
    throw createReviewError('REVIEW_TASK_EXPIRED', '这次导入审阅已过期，请重新导入。', 410);
  }
  if (task.status !== 'awaiting_confirmation') {
    throw createReviewError('REVIEW_TASK_NOT_CONFIRMABLE', '这次导入当前不能确认，请刷新后重试。', 409, {
      status: task.status,
    });
  }

  const rows = await loadStagedRows(supabase, task.id);
  const decisionMap = normalizeDecisions(decisions);
  const selectedRows = rows.map((row) => ({
    ...row,
    selected_action: decisionMap.get(row.ordinal) || row.selected_action || 'keep',
  }));
  const blockedKeptRows = selectedRows.filter(
    (row) => row.selected_action === 'keep' && (row.issues || []).some((issue) => issue?.severity === 'blocking')
  );

  if (blockedKeptRows.length > 0) {
    throw createReviewError(
      'BLOCKING_RECORDS_MUST_BE_SKIPPED',
      `仍有 ${blockedKeptRows.length} 条无法识别的记录被选择保留，请先跳过或修正。`,
      409,
      { ordinals: blockedKeptRows.map((row) => row.ordinal) }
    );
  }

  if (decisionMap.size > 0) {
    for (const [ordinal, selectedAction] of decisionMap) {
      const { error: decisionError } = await supabase
        .from('official_import_staged_records')
        .update({ selected_action: selectedAction })
        .eq('task_id', task.id)
        .eq('ordinal', ordinal);
      if (decisionError) {
        throw createReviewError('REVIEW_DECISIONS_SAVE_FAILED', `保存审阅选项失败：${decisionError.message}`, 500);
      }
    }
  }

  const now = new Date().toISOString();
  const { data: lockedTask, error: lockError } = await supabase
    .from('official_import_tasks')
    .update({ status: 'confirming', confirmed_at: now, updated_at: now })
    .eq('id', task.id)
    .eq('user_id', userId)
    .eq('status', 'awaiting_confirmation')
    .select('*')
    .maybeSingle();

  if (lockError || !lockedTask) {
    const latestTask = await loadTaskRow(supabase, { taskId, userId });
    if (latestTask.status === 'committed') {
      return { task: publicTask(latestTask), result: latestTask.summary?.commitResult || {}, idempotent: true };
    }
    throw createReviewError('REVIEW_TASK_LOCKED', '这次导入正在由另一个请求确认，请稍后刷新。', 409);
  }

  try {
    const keptRows = selectedRows.filter((row) => row.selected_action === 'keep');
    const rawResult = await commit({ task: lockedTask, rows: keptRows, allRows: selectedRows });
    const taskCommittedAtomically = rawResult?.taskCommittedAtomically === true;
    const result = { ...(rawResult || {}) };
    delete result.taskCommittedAtomically;
    const committedAt = new Date().toISOString();
    const nextSummary = {
      ...(lockedTask.summary || {}),
      commitResult: result || {},
    };
    if (taskCommittedAtomically) {
      const { data: refreshedTask } = await supabase
        .from('official_import_tasks')
        .update({ summary: nextSummary, updated_at: committedAt })
        .eq('id', task.id)
        .eq('user_id', userId)
        .eq('status', 'committed')
        .select('*')
        .maybeSingle();
      return {
        task: publicTask(
          refreshedTask || {
            ...lockedTask,
            status: 'committed',
            summary: nextSummary,
            committed_at: committedAt,
            updated_at: committedAt,
          }
        ),
        result,
        idempotent: false,
      };
    }
    const { data: committedTask, error: commitStateError } = await supabase
      .from('official_import_tasks')
      .update({
        status: 'committed',
        summary: nextSummary,
        committed_at: committedAt,
        updated_at: committedAt,
      })
      .eq('id', task.id)
      .eq('status', 'confirming')
      .select('*')
      .single();

    if (commitStateError || !committedTask) {
      throw commitStateError || new Error('正式写入已完成，但任务状态更新失败');
    }

    return { task: publicTask(committedTask), result: result || {}, idempotent: false };
  } catch (error) {
    await supabase
      .from('official_import_tasks')
      .update({
        status: 'awaiting_confirmation',
        summary: {
          ...(lockedTask.summary || {}),
          lastCommitError: String(error?.message || error).slice(0, 500),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', task.id)
      .eq('status', 'confirming');
    throw error;
  }
}

export async function rejectOfficialImportTask({ supabase, taskId, userId, accessKey }) {
  let task = await loadTaskRow(supabase, { taskId, userId });
  assertTaskAccess(task, accessKey);
  task = await expireTaskIfNeeded(supabase, task);

  if (task.status === 'rejected') {
    return { task: publicTask(task), idempotent: true };
  }
  if (task.status === 'committed') {
    throw createReviewError('COMMITTED_TASK_CANNOT_BE_REJECTED', '这次导入已经写入，不能再撤销审阅任务。', 409);
  }
  if (!['processing', 'awaiting_confirmation'].includes(task.status)) {
    throw createReviewError('REVIEW_TASK_NOT_REJECTABLE', '这次导入当前不能取消。', 409);
  }

  const rejectedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('official_import_tasks')
    .update({ status: 'rejected', rejected_at: rejectedAt, updated_at: rejectedAt })
    .eq('id', task.id)
    .eq('user_id', userId)
    .in('status', ['processing', 'awaiting_confirmation'])
    .select('*')
    .single();

  if (error || !data) {
    throw createReviewError('REVIEW_TASK_REJECT_FAILED', `取消导入失败：${error?.message || '任务状态已变化'}`, 409);
  }
  return { task: publicTask(data), idempotent: false };
}

export default {
  confirmOfficialImportTask,
  getOfficialImportReview,
  rejectOfficialImportTask,
  stageOfficialImportTask,
};
