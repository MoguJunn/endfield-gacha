import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hasWriteBlockingImportIssues } from '../../shared/officialImportRecordNormalizer.js';
import {
  isSupabaseConnectionPoolTimeout,
  retrySupabaseConnectionPoolOperation,
} from '../../shared/supabaseConnectionRetry.js';
import { getCanonicalExtraPoolMetadata } from '../../shared/extraPoolSubtype.js';

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

function normalizePoolForStaging(pool = {}) {
  const poolId = normalizeText(pool.pool_id || pool.id || pool.poolId, 200);
  if (!poolId) return null;
  const type = normalizeText(pool.type || pool.pool_type || pool.poolType, 80) || 'standard';
  const extraMetadata = type === 'extra'
    ? getCanonicalExtraPoolMetadata(pool)
    : {
        extra_subtype: null,
        extra_rule_profile: null,
        extra_series_key: null,
        extra_series_phase: null,
      };

  return {
    pool_id: poolId,
    name: normalizeText(pool.name || pool.pool_name || pool.poolName, 300) || poolId,
    type,
    ...extraMetadata,
    start_time: pool.start_time || pool.startTime || null,
    end_time: pool.end_time || pool.endTime || null,
    up_character: normalizeText(pool.up_character || pool.upCharacter, 300) || null,
    featured_characters: Array.isArray(pool.featured_characters) ? pool.featured_characters : null,
    created_at: pool.created_at || null,
  };
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
  const normalizedQuality = normalized.quality;
  const poolId = normalizeText(historyRecord.pool_id || normalized.poolId, 200) || null;
  const pool = poolById.get(poolId) || null;

  return {
    ordinal,
    pool_id: poolId,
    item_id: normalizeText(normalized.rawItemId || normalized.itemId, 200) || null,
    item_name: normalizeText(normalized.itemName, 300) || null,
    item_type: normalizeText(normalized.itemType, 80) || 'unknown',
    quality: normalizedQuality !== null
      && normalizedQuality !== undefined
      && normalizedQuality !== ''
      && Number.isFinite(Number(normalizedQuality))
      ? Number(normalizedQuality)
      : null,
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
    selected_action: hasWriteBlockingImportIssues(record.issues) ? 'skip' : 'keep',
  };
}

async function deleteTaskQuietly(supabase, taskId) {
  try {
    await retrySupabaseConnectionPoolOperation(
      () => supabase.from('official_import_tasks').delete().eq('id', taskId),
      { label: '清理导入审阅任务' }
    );
  } catch {
    // The task has ON DELETE CASCADE; a failed cleanup is safe and can expire normally.
  }
}

function createDatabaseBusyError(message, error, operation) {
  return createReviewError(
    'REVIEW_DATABASE_BUSY',
    message,
    503,
    {
      operation,
      retryable: true,
      sourceCode: error?.code || null,
    }
  );
}

async function loadTaskRow(supabase, { taskId, userId, connectionRetryOptions = {} }) {
  const { data, error } = await retrySupabaseConnectionPoolOperation(
    () => supabase
      .from('official_import_tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', userId)
      .maybeSingle(),
    {
      ...connectionRetryOptions,
      label: connectionRetryOptions.label || '读取导入审阅任务',
    }
  );

  if (error) {
    if (isSupabaseConnectionPoolTimeout(error)) {
      throw createDatabaseBusyError(
        '数据库连接繁忙，暂时无法读取导入审阅任务，请稍后重试。',
        error,
        'load-task'
      );
    }
    throw createReviewError('REVIEW_TASK_LOAD_FAILED', `读取导入审阅任务失败：${error.message}`, 500);
  }
  if (!data) {
    throw createReviewError('REVIEW_TASK_NOT_FOUND', '未找到这次导入审阅任务，或它不属于当前用户。', 404);
  }
  return data;
}

async function expireTaskIfNeeded(supabase, task, connectionRetryOptions = {}) {
  const expiresAt = Date.parse(task.expires_at || '');
  if (!ACTIVE_STATUSES.has(task.status) || !Number.isFinite(expiresAt) || expiresAt > Date.now()) {
    return task;
  }

  const { error } = await retrySupabaseConnectionPoolOperation(
    () => supabase
      .from('official_import_tasks')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', task.id)
      .in('status', Array.from(ACTIVE_STATUSES)),
    {
      ...connectionRetryOptions,
      label: connectionRetryOptions.label || '标记过期导入审阅任务',
    }
  );
  if (error) {
    if (isSupabaseConnectionPoolTimeout(error)) {
      throw createDatabaseBusyError(
        '数据库连接繁忙，暂时无法更新导入审阅任务，请稍后重试。',
        error,
        'expire-task'
      );
    }
    throw createReviewError('REVIEW_TASK_EXPIRE_FAILED', `更新导入审阅任务失败：${error.message}`, 500);
  }

  return { ...task, status: 'expired' };
}

function assertTaskAccess(task, accessKey) {
  if (!normalizeText(accessKey, 512) || !accessKeysMatch(accessKey, task.access_key_hash)) {
    throw createReviewError('REVIEW_ACCESS_DENIED', '导入审阅凭证无效，请重新发起导入。', 403);
  }
}

async function loadStagedRows(supabase, taskId, connectionRetryOptions = {}) {
  const { data, error } = await retrySupabaseConnectionPoolOperation(
    () => supabase
      .from('official_import_staged_records')
      .select('*')
      .eq('task_id', taskId)
      .order('ordinal', { ascending: true }),
    {
      ...connectionRetryOptions,
      label: connectionRetryOptions.label || '读取导入暂存记录',
    }
  );

  if (error) {
    if (isSupabaseConnectionPoolTimeout(error)) {
      throw createDatabaseBusyError(
        '数据库连接繁忙，暂时无法读取导入暂存记录，请稍后重试。',
        error,
        'load-staged-records'
      );
    }
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
  connectionRetryOptions = {},
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

  const { data: task, error: taskError } = await retrySupabaseConnectionPoolOperation(
    () => supabase
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
      .single(),
    {
      ...connectionRetryOptions,
      label: connectionRetryOptions.label || '创建导入审阅任务',
    }
  );

  if (taskError || !task?.id) {
    if (isSupabaseConnectionPoolTimeout(taskError)) {
      throw createDatabaseBusyError(
        '数据库连接繁忙，暂时无法创建导入审阅任务，请稍后重试。',
        taskError,
        'create-task'
      );
    }
    throw createReviewError(
      'REVIEW_TASK_CREATE_FAILED',
      `创建导入审阅任务失败：${taskError?.message || '数据库没有返回任务 ID'}`,
      500
    );
  }

  const poolById = new Map(
    (Array.isArray(pools) ? pools : [])
      .map(normalizePoolForStaging)
      .filter(Boolean)
      .map((pool) => [pool.pool_id, pool])
  );
  const rows = (Array.isArray(stagedRecords) ? stagedRecords : []).map((record, ordinal) => ({
    task_id: task.id,
    ...normalizeStagedRecord(record, ordinal, poolById),
  }));

  try {
    for (let index = 0; index < rows.length; index += STAGED_RECORD_BATCH_SIZE) {
      const { error } = await retrySupabaseConnectionPoolOperation(
        () => supabase
          .from('official_import_staged_records')
          .insert(rows.slice(index, index + STAGED_RECORD_BATCH_SIZE)),
        {
          ...connectionRetryOptions,
          label: connectionRetryOptions.label || '保存导入暂存记录',
        }
      );
      if (error) {
        throw error;
      }
    }

    const { data: readyTask, error: readyError } = await retrySupabaseConnectionPoolOperation(
      () => supabase
        .from('official_import_tasks')
        .update({
          status: 'awaiting_confirmation',
          updated_at: new Date().toISOString(),
        })
        .eq('id', task.id)
        .eq('status', 'processing')
        .select('*')
        .single(),
      {
        ...connectionRetryOptions,
        label: connectionRetryOptions.label || '准备导入审阅任务',
      }
    );

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
    if (error instanceof OfficialImportReviewError) {
      throw error;
    }
    if (isSupabaseConnectionPoolTimeout(error)) {
      throw createDatabaseBusyError(
        '数据库连接繁忙，暂时无法保存导入审阅任务，请稍后重试。',
        error,
        'stage-task'
      );
    }
    throw createReviewError('STAGING_RECORDS_SAVE_FAILED', `暂存导入记录失败：${error.message}`, 500);
  }
}

export async function getOfficialImportReview({
  supabase,
  taskId,
  userId,
  accessKey,
  connectionRetryOptions = {},
}) {
  let task = await loadTaskRow(supabase, { taskId, userId, connectionRetryOptions });
  assertTaskAccess(task, accessKey);
  task = await expireTaskIfNeeded(supabase, task, connectionRetryOptions);

  if (task.status === 'expired') {
    throw createReviewError('REVIEW_TASK_EXPIRED', '这次导入审阅已过期，请重新导入。', 410);
  }

  const rows = await loadStagedRows(supabase, task.id, connectionRetryOptions);
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

export async function confirmOfficialImportTask({
  supabase,
  taskId,
  userId,
  accessKey,
  decisions = [],
  commit,
  connectionRetryOptions = {},
}) {
  let task = await loadTaskRow(supabase, { taskId, userId, connectionRetryOptions });
  assertTaskAccess(task, accessKey);
  task = await expireTaskIfNeeded(supabase, task, connectionRetryOptions);

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

  const rows = await loadStagedRows(supabase, task.id, connectionRetryOptions);
  const decisionMap = normalizeDecisions(decisions);
  const selectedRows = rows.map((row) => ({
    ...row,
    selected_action: decisionMap.get(row.ordinal) || row.selected_action || 'keep',
  }));
  const blockedKeptRows = selectedRows.filter(
    (row) => row.selected_action === 'keep' && hasWriteBlockingImportIssues(row.issues)
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
      const { error: decisionError } = await retrySupabaseConnectionPoolOperation(
        () => supabase
          .from('official_import_staged_records')
          .update({ selected_action: selectedAction })
          .eq('task_id', task.id)
          .eq('ordinal', ordinal),
        {
          ...connectionRetryOptions,
          label: connectionRetryOptions.label || '保存导入审阅选项',
        }
      );
      if (decisionError) {
        if (isSupabaseConnectionPoolTimeout(decisionError)) {
          throw createDatabaseBusyError(
            '数据库连接繁忙，暂时无法保存导入审阅选项，请稍后重试。',
            decisionError,
            'save-review-decisions'
          );
        }
        throw createReviewError('REVIEW_DECISIONS_SAVE_FAILED', `保存审阅选项失败：${decisionError.message}`, 500);
      }
    }
  }

  const now = new Date().toISOString();
  const { data: lockedTask, error: lockError } = await retrySupabaseConnectionPoolOperation(
    () => supabase
      .from('official_import_tasks')
      .update({ status: 'confirming', confirmed_at: now, updated_at: now })
      .eq('id', task.id)
      .eq('user_id', userId)
      .eq('status', 'awaiting_confirmation')
      .select('*')
      .maybeSingle(),
    {
      ...connectionRetryOptions,
      label: connectionRetryOptions.label || '锁定导入审阅任务',
    }
  );

  if (lockError) {
    if (isSupabaseConnectionPoolTimeout(lockError)) {
      throw createDatabaseBusyError(
        '数据库连接繁忙，暂时无法确认导入，请稍后重试。',
        lockError,
        'lock-review-task'
      );
    }
    throw createReviewError(
      'REVIEW_TASK_LOCK_FAILED',
      `锁定导入审阅任务失败：${lockError.message || lockError}`,
      500,
      { sourceCode: lockError.code || null }
    );
  }

  if (!lockedTask) {
    const latestTask = await loadTaskRow(supabase, {
      taskId,
      userId,
      connectionRetryOptions,
    });
    if (latestTask.status === 'committed') {
      return { task: publicTask(latestTask), result: latestTask.summary?.commitResult || {}, idempotent: true };
    }
    throw createReviewError(
      'REVIEW_TASK_LOCKED',
      '这次导入正在由另一个请求确认，请稍后刷新。',
      409,
      { status: latestTask.status }
    );
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
      const { data: refreshedTask, error: refreshError } = await retrySupabaseConnectionPoolOperation(
        () => supabase
          .from('official_import_tasks')
          .update({ summary: nextSummary, updated_at: committedAt })
          .eq('id', task.id)
          .eq('user_id', userId)
          .eq('status', 'committed')
          .select('*')
          .maybeSingle(),
        {
          ...connectionRetryOptions,
          label: connectionRetryOptions.label || '保存导入提交结果',
        }
      );
      if (refreshError && !isSupabaseConnectionPoolTimeout(refreshError)) {
        throw refreshError;
      }
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
    const { data: committedTask, error: commitStateError } = await retrySupabaseConnectionPoolOperation(
      () => supabase
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
        .single(),
      {
        ...connectionRetryOptions,
        label: connectionRetryOptions.label || '标记导入任务完成',
      }
    );

    if (commitStateError || !committedTask) {
      throw commitStateError || new Error('正式写入已完成，但任务状态更新失败');
    }

    return { task: publicTask(committedTask), result: result || {}, idempotent: false };
  } catch (error) {
    let latestTask = null;
    try {
      latestTask = await loadTaskRow(supabase, {
        taskId,
        userId,
        connectionRetryOptions,
      });
    } catch (stateError) {
      if (!isSupabaseConnectionPoolTimeout(stateError)) {
        console.warn('[OfficialImportStaging] 提交失败后读取任务状态失败:', stateError.message);
      }
    }

    if (latestTask?.status === 'committed') {
      return {
        task: publicTask(latestTask),
        result: latestTask.summary?.commitResult || {},
        idempotent: true,
      };
    }

    const recoverySummary = {
      ...(lockedTask.summary || {}),
      lastCommitError: String(error?.message || error).slice(0, 500),
    };
    const { error: recoveryError } = await retrySupabaseConnectionPoolOperation(
      () => supabase
        .from('official_import_tasks')
        .update({
          status: 'awaiting_confirmation',
          summary: recoverySummary,
          updated_at: new Date().toISOString(),
        })
        .eq('id', task.id)
        .eq('status', 'confirming'),
      {
        ...connectionRetryOptions,
        label: connectionRetryOptions.label || '恢复导入审阅任务状态',
      }
    );
    if (recoveryError) {
      throw createReviewError(
        'REVIEW_TASK_RECOVERY_FAILED',
        `导入提交失败，且任务状态恢复失败：${recoveryError.message || recoveryError}`,
        isSupabaseConnectionPoolTimeout(recoveryError) ? 503 : 500,
        {
          retryable: isSupabaseConnectionPoolTimeout(recoveryError),
          originalCode: error?.code || null,
          recoveryCode: recoveryError.code || null,
        }
      );
    }
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
