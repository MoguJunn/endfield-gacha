import { computeWorkbenchMetrics } from '../../shared/dataWorkbenchMetrics.js';
import { createHash } from 'node:crypto';
import { normalizeWorkbenchScope, validateWorkbenchEntry } from '../../shared/dataWorkbench.js';
import { validateWorkbenchRules, WORKBENCH_RULES_VERSION } from '../../shared/workbenchRules.js';
import { isReservedPoolTypeId } from '../../shared/poolIdValidation.js';
import { attachPoolSixStarRoster, buildPoolSixStarRosterMap } from './poolCatalogRoster.js';
import { resolvePoolCapabilities } from '../../src/utils/poolCapabilities.js';
import { readPoolRosterRows } from './readPoolRosterRows.js';
import { validateWorkbenchPoolOperations } from '../../shared/workbenchPoolAvailability.js';

export const WORKBENCH_TABLE = 'account_data_workbench_entries';
export const WORKBENCH_COMMITS = 'account_data_workbench_commits';
export const MAX_WORKBENCH_BATCH = 100;
export { WORKBENCH_RULES_VERSION };
const PERMANENT_POOL_IDS = new Set(['standard', 'beginner']);
const METRICS_BLOCKING_CODES = [
  'invalid_kind', 'invalid_precision', 'entity_required', 'entity_type', 'six_star_required',
  'invalid_count', 'quantity_required', 'detail_quantity', 'interval_required', 'method_required',
  'evidence_required', 'potential_character', 'invalid_time', 'exact_time_required',
  'range_required', 'invalid_range', 'summary_empty', 'counts_exceed_total', 'batch_required',
  'text_too_long', 'outside_pool_window', 'pool_required',
  'detail_covered', 'overlapping_summaries', 'summary_less_than_details', 'coverage_time_unknown',
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALUE_FIELDS = new Set([
  'entityId', 'quantity', 'timestamp', 'rangeStart', 'rangeEnd', 'totalPulls',
  'fourStarCount', 'fiveStarCount', 'sixStarCount', 'intervalPulls', 'pity',
  'drawMethod', 'orderIndex', 'batchIndex', 'coverageId', 'notes', 'evidenceRef',
  'coverageMode', 'initialPity', 'complete', 'acquisitions', 'fillSeed', 'inferredRecords',
  'knownFields', 'skippedPools',
  'inferredFill',
]);

export class WorkbenchError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function requireUuid(value, field) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new WorkbenchError('invalid_workbench_id', `${field} 必须是有效 UUID`);
  }
  return value.toLowerCase();
}

export function requireScope(scope) {
  if (typeof scope?.gameUid !== 'string' || typeof scope?.serverScope !== 'string') {
    throw new WorkbenchError('invalid_workbench_scope', '请指定有效的游戏 UID 和服务器');
  }
  const normalized = normalizeWorkbenchScope(scope);
  if (!normalized) throw new WorkbenchError('invalid_workbench_scope', '请指定有效的游戏 UID 和服务器');
  return normalized;
}

export function requireRevision(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new WorkbenchError('invalid_workbench_revision', 'expectedRevision 必须是正整数');
  }
  return value;
}

export function parseWorkbenchBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > 256 * 1024) throw new WorkbenchError('workbench_payload_too_large', '请求过大', 413);
    try { body = JSON.parse(body); } catch { throw new WorkbenchError('invalid_json', '请求 JSON 无效'); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new WorkbenchError('invalid_workbench_payload', '请求格式无效');
  }
  if (Buffer.byteLength(JSON.stringify(body)) > 256 * 1024) {
    throw new WorkbenchError('workbench_payload_too_large', '请求过大', 413);
  }
  return body;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function payloadFingerprint(payload) {
  return createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
}

export function normalizeSubmission(body) {
  const draftId = requireUuid(body.draftId, 'draftId');
  const commitId = requireUuid(body.commitId, 'commitId');
  const scope = requireScope(body.scope);
  if (!Array.isArray(body.entries) || body.entries.length < 1 || body.entries.length > MAX_WORKBENCH_BATCH) {
    throw new WorkbenchError('invalid_workbench_batch', '每次必须提交 1 至 100 条记录');
  }
  const seen = new Set();
  const entries = body.entries.map((raw) => {
    const entryId = requireUuid(raw?.entryId, 'entryId');
    if (seen.has(entryId)) throw new WorkbenchError('duplicate_workbench_entry_id', '同一请求中 entryId 不得重复');
    seen.add(entryId);
    // Owner is always authenticated; channels are portable metadata, never authority.
    const source = ['manual', 'file', 'xhh'].includes(raw.source) ? raw.source : 'manual';
    return {
      entryId, kind: raw.kind, poolId: raw.poolId ?? null, values: raw.values,
      timePrecision: raw.timePrecision, reviewState: raw.reviewState, source,
    };
  });
  return { draftId, commitId, scope, entries };
}

const HISTORY_CHANGE_FIELDS = new Set(['timestamp', 'poolId', 'characterId', 'drawMethod', 'isStandard', 'specialType']);
const FORBIDDEN_IDENTITIES = new Set(['seq', 'seqId', 'seq_id', 'recordId', 'record_id', 'userId', 'user_id', 'historyId', 'history_id']);

function requireText(value, field, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new WorkbenchError('invalid_workbench_payload', `${field} 格式无效`);
  }
  return value.trim();
}

function normalizeReason(value = '') {
  if (typeof value !== 'string' || value.length > 500) throw new WorkbenchError('invalid_workbench_reason', '原因不能超过 500 字');
  return value.trim();
}

function normalizeWorkspaceEntry(raw, fallbackEntryId = null) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new WorkbenchError('invalid_workbench_entry', '请提供完整记录');
  const source = raw.source ?? 'manual';
  if (!['manual', 'file', 'xhh'].includes(source)) throw new WorkbenchError('invalid_workbench_source', '录入渠道无效');
  if (raw.derivation != null && !['declared', 'inferred'].includes(raw.derivation)) throw new WorkbenchError('invalid_workbench_derivation', '记录来源标记无效');
  return {
    entryId: requireUuid(raw.entryId ?? fallbackEntryId, 'entryId'), kind: raw.kind,
    poolId: raw.poolId ?? null, values: raw.values, timePrecision: raw.timePrecision ?? 'unknown',
    reviewState: raw.reviewState ?? 'confirmed', source,
    ...(raw.derivation != null ? { derivation: raw.derivation } : {}),
  };
}

export function normalizeWorkspaceSubmission(body) {
  const draftId = requireUuid(body.draftId, 'draftId');
  const commitId = requireUuid(body.commitId, 'commitId');
  const scope = requireScope(body.scope);
  const draftRevision = requireRevision(body.draftRevision);
  const arrays = ['entries', 'historyChanges', 'supplementChanges'];
  for (const key of arrays) {
    if (!Array.isArray(body[key])) throw new WorkbenchError('invalid_workbench_batch', `${key} 必须是数组`);
  }
  const size = arrays.reduce((count, key) => count + body[key].length, 0);
  if (size < 1 || size > MAX_WORKBENCH_BATCH) throw new WorkbenchError('invalid_workbench_batch', '每次必须提交 1 至 100 项修改');
  const entries = body.entries.map(raw => normalizeWorkspaceEntry(raw));
  const seenEntries = new Set();
  for (const entry of entries) {
    if (seenEntries.has(entry.entryId)) throw new WorkbenchError('duplicate_workbench_entry_id', '同一请求中 entryId 不得重复');
    seenEntries.add(entry.entryId);
  }
  const seenHistory = new Set();
  const historyChanges = body.historyChanges.map(raw => {
    const locatorScope = requireScope({ gameUid: raw?.gameUid, serverScope: raw?.serverScope });
    if (locatorScope.gameUid !== scope.gameUid || locatorScope.serverScope !== scope.serverScope) throw new WorkbenchError('workbench_scope_mismatch', '历史修改必须属于当前账号范围');
    const recordId = requireText(raw.recordId, 'recordId');
    const currentPoolId = requireText(raw.currentPoolId, 'currentPoolId', 160);
    const seqId = requireText(raw.seqId, 'seqId');
    const key = JSON.stringify([recordId, currentPoolId, seqId]);
    if (seenHistory.has(key)) throw new WorkbenchError('duplicate_history_change', '同一历史记录不能重复修改');
    seenHistory.add(key);
    if (!raw.changes || typeof raw.changes !== 'object' || Array.isArray(raw.changes) || !Object.keys(raw.changes).length
      || Object.keys(raw.changes).some(field => !HISTORY_CHANGE_FIELDS.has(field))) throw new WorkbenchError('invalid_history_changes', '历史修改包含无效字段');
    return { recordId, ...locatorScope, currentPoolId, seqId, expectedEditVersion: requireRevision(raw.expectedEditVersion), changes: raw.changes, reason: normalizeReason(raw.reason) };
  });
  const seenSupplements = new Set();
  const supplementChanges = body.supplementChanges.map(raw => {
    const id = requireUuid(raw?.id, 'id');
    if (seenSupplements.has(id)) throw new WorkbenchError('duplicate_supplement_change', '同一补录记录不能重复修改');
    seenSupplements.add(id);
    if (!['update', 'delete'].includes(raw.action)) throw new WorkbenchError('invalid_workbench_action', '补录修改类型无效');
    const reason = normalizeReason(raw.reason);
    if (raw.action === 'delete' && !reason) throw new WorkbenchError('invalid_workbench_delete_reason', '请填写删除原因');
    return {
      id, expectedRevision: requireRevision(raw.expectedRevision), action: raw.action, reason,
      ...(raw.action === 'update' ? { entry: normalizeWorkspaceEntry(raw.entry) } : {}),
    };
  });
  return { mode: 'pool-workspace', draftId, commitId, draftRevision, scope, entries, historyChanges, supplementChanges };
}

export function toWorkbenchEntry(row) {
  return {
    id: row.id, entryId: row.entry_id, draftId: row.draft_id,
    scope: { gameUid: row.game_uid, serverScope: row.server_scope },
    kind: row.kind, poolId: row.pool_id, values: row.values,
    timePrecision: row.time_precision, reviewState: 'confirmed', source: row.source,
    ...(row.derivation ? { derivation: row.derivation } : {}),
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export async function loadWorkbenchContext(db, userId, scope) {
  const { data, error } = await db.rpc('read_account_data_workbench_context', {
    p_user_id: userId, p_game_uid: scope.gameUid, p_server_scope: scope.serverScope,
  });
  if (error) throw error;
  if (!data || !Array.isArray(data.history) || !Array.isArray(data.entries) || !data.contextToken) {
    throw new WorkbenchError('workbench_unavailable', '补录存储尚未就绪', 503);
  }
  return data;
}

async function readAll(queryFactory) {
  const result = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const { data, error } = await queryFactory().range(offset, offset + 999);
    if (error) throw error;
    result.push(...(data || []));
    if (!data || data.length < 1000) return result;
  }
  throw new WorkbenchError('workbench_catalog_too_large', '目录超出校验范围，请联系管理员', 503);
}

export async function loadWorkbenchCatalog(db) {
  const [poolResult, entities, roster] = await Promise.all([
    db.rpc('get_app_visible_pools'),
    readAll(() => db.from('characters').select('id,name,type,rarity,is_limited,release_date,pool_config').order('id')),
    readPoolRosterRows(db),
  ]);
  if (poolResult.error) throw poolResult.error;
  const visible = (poolResult.data || []).filter((pool) => !isReservedPoolTypeId(pool.pool_id || pool.id));
  const entityMap = new Map(entities.map((entity) => [entity.id, entity]));
  const rosterRows = roster.map((row) => ({ ...row, characters: entityMap.get(row.character_id) }));
  const rosterMap = buildPoolSixStarRosterMap(rosterRows, visible.map((pool) => pool.pool_id || pool.id));
  const pools = visible.map((pool) => attachPoolSixStarRoster({
    ...pool, id: pool.pool_id || pool.id,
    rosterEntityIds: roster.filter((row) => row.pool_id === (pool.pool_id || pool.id)).map((row) => row.character_id),
  }, rosterMap));
  return { pools, entities };
}

export async function loadWorkspaceCatalog(db) {
  const { data, error } = await db.rpc('read_account_data_workbench_catalog');
  if (error) throw error;
  if (!data?.catalogToken || !Array.isArray(data.pools) || !Array.isArray(data.entities) || !Array.isArray(data.roster)) throw new WorkbenchError('workbench_unavailable', '校验目录尚未就绪', 503);
  const visible = data.pools.filter(pool => !isReservedPoolTypeId(pool.pool_id || pool.id));
  const entityMap = new Map(data.entities.map(entity => [entity.id, entity]));
  const rosterMap = buildPoolSixStarRosterMap(data.roster.map(row => ({ ...row, characters: entityMap.get(row.character_id) })), visible.map(pool => pool.pool_id || pool.id));
  return {
    catalogToken: data.catalogToken, entities: data.entities,
    pools: visible.map(pool => attachPoolSixStarRoster({ ...pool, id: pool.pool_id || pool.id,
      rosterEntityIds: data.roster.filter(row => row.pool_id === (pool.pool_id || pool.id)).map(row => row.character_id),
    }, rosterMap)),
  };
}

function issue(entryId, code, message, extra = {}) {
  return { entryId, code, message, severity: 'blocking', ...extra };
}

function timeBounds(entry) {
  const values = entry.values || {};
  if (entry.timePrecision === 'unknown') return [-Infinity, Infinity];
  if (entry.timePrecision === 'range') {
    const start = Date.parse(values.rangeStart);
    const end = Date.parse(values.rangeEnd);
    return [Number.isFinite(start) ? start : -Infinity, Number.isFinite(end) ? end : Infinity];
  }
  const start = Date.parse(values.timestamp);
  if (!Number.isFinite(start)) return [-Infinity, Infinity];
  return [start, start + (entry.timePrecision === 'day' ? 86400000 - 1 : 999)];
}

function isPermanentPool(pool) {
  return PERMANENT_POOL_IDS.has(String(pool?.id ?? pool?.pool_id ?? '').toLowerCase()) || pool?.type === 'standard';
}

/**
 * 明细之间的疑似重复判定：同卡池、同一时刻（时间精度已折算为区间）、同一实体。
 * 汇总与明细、汇总与汇总由 computeWorkbenchMetrics 判定，避免把可覆盖的补录全盘拒绝。
 */
function isDuplicateDetail(left, right) {
  if (left.poolId !== right.poolId) return false;
  const entity = left.values?.entityId;
  if (!entity || !right.values?.entityId) return false;
  if (entity !== right.values.entityId) return false;
  const [leftStart, leftEnd] = timeBounds(left);
  const [rightStart, rightEnd] = timeBounds(right);
  return Math.min(leftEnd, rightEnd) >= Math.max(leftStart, rightStart);
}

function isDuplicateEvidence(left, right) {
  return left.kind === 'potential-evidence' && right.kind === 'potential-evidence'
    && Boolean(left.values?.evidenceRef) && left.values.evidenceRef === right.values?.evidenceRef;
}

function findBlockingOverlap(entry, candidates) {
  return candidates.find((candidate) => {
    if (entry.kind === 'potential-evidence' || candidate.kind === 'potential-evidence') {
      return isDuplicateEvidence(entry, candidate) || isDuplicateEvidence(candidate, entry)
        || (entry.kind === 'detail' || candidate.kind === 'detail') && isDuplicateDetail(entry, candidate);
    }
    return entry.kind === 'detail' && candidate.kind === 'detail' && isDuplicateDetail(entry, candidate);
  });
}

function duplicateDetailIssues(entry, history) {
  const match = history.find((row) => isDuplicateDetail(entry, {
    poolId: row.pool_id,
    values: { entityId: row.character_id, timestamp: row.timestamp },
    timePrecision: row.timestamp ? 'second' : 'unknown',
  }));
  if (!match) return null;
  return issue(entry.entryId, entry.kind === 'potential-evidence' ? 'workbench_overlap' : 'detail_covered',
    '相同实体和时间的获取记录已存在，请核对后重试', {
    conflictSource: 'history', conflictId: match.record_id || match.seq_id || match.id,
  });
}

function isEntityAllowedInPool(entity, pool) {
  if (Array.isArray(pool.rosterEntityIds)) return pool.rosterEntityIds.map(String).includes(String(entity.id));
  if (pool.rosterEntityIds?.includes(entity.id)
    || pool.six_star_entities?.some((item) => item.id === entity.id)) return true;
  const poolType = String(pool.type ?? '');
  const expectedType = resolvePoolCapabilities(pool).entityType;
  if (entity.type !== expectedType) return false;
  const memberships = entity.pool_config?.pools || [];
  if (isPermanentPool(pool)) return memberships.includes('standard');
  const membershipKey = poolType === 'limited_character' ? 'limited' : poolType === 'limited_weapon' ? 'weapon' : poolType;
  return memberships.includes(membershipKey)
    || (['limited', 'weapon', 'extra'].includes(membershipKey) && memberships.includes('standard'));
}

function historicalCatalogIssues(entry, { pools, entities }) {
  if (entry.kind === 'potential-evidence') return [];
  const pool = pools.find((item) => (item.id || item.pool_id) === entry.poolId);
  if (!pool) return [issue(entry.entryId, 'pool_not_visible', '该卡池不属于标准可见卡池目录')];
  const entity = entities.find((item) => item.id === entry.values?.entityId);
  if (!entry.values?.entityId || !entity) return [];
  const expectedType = resolvePoolCapabilities(pool).entityType;
  if (entity.type !== expectedType) return [issue(entry.entryId, 'entity_pool_type_mismatch', '实体类型与卡池不匹配')];
  const catalogRelease = Date.parse(entity.release_date || entity.pool_config?.introduced_at);
  // An earlier confirmed UP banner proves availability in later non-UP drops
  // too; introduced_at can have been filled by a later catalog maintenance.
  // Target-banner membership is still validated separately below.
  const confirmedBannerStarts = pools
    .filter(candidate => candidate.up_character === entity.name
      && resolvePoolCapabilities(candidate).entityType === entity.type
      && candidate.six_star_entities?.some(row => row.id === entity.id && row.is_up))
    .map(candidate => Date.parse(candidate.start_time ?? candidate.startTime))
    .filter(Number.isFinite);
  const releases = [...confirmedBannerStarts, catalogRelease].filter(Number.isFinite);
  const release = releases.length ? Math.min(...releases) : NaN;
  const [, upper] = timeBounds(entry);
  // 未标注 release_date 的实体不能仅凭时间推断，交由名单核对（191 的 roster_status）判定。
  if (Number.isFinite(release) && Number.isFinite(upper) && upper < release) {
    return [issue(entry.entryId, 'entity_not_released', '该实体在记录所指的历史时间尚未加入卡池')];
  }
  if (Number(entity.rarity) === 6 && pool.roster_status === 'complete'
    && !pool.six_star_entities?.some((item) => item.id === entity.id)) {
    return [issue(entry.entryId, 'entity_not_in_historical_roster', '该实体不在该卡池已确认完整的历史六星名单中')];
  }
  if (!isEntityAllowedInPool(entity, pool)) {
    return [issue(entry.entryId, 'entity_not_in_historical_roster', '该实体没有适用于此卡池的名单配置')];
  }
  return [];
}

function metricsBlockingIssues(metrics) {
  return (metrics.issues || [])
    .filter((item) => METRICS_BLOCKING_CODES.includes(item.code))
    .map((item) => issue(item.entryId, item.code, item.message || '补录统计校验未通过'));
}

function containsOfficialIdentity(value) {
  if (Array.isArray(value)) return value.some(containsOfficialIdentity);
  return Boolean(value && typeof value === 'object'
    && Object.entries(value).some(([key, child]) => FORBIDDEN_IDENTITIES.has(key) || containsOfficialIdentity(child)));
}

function ledgerCatalogIssues(entry, catalog) {
  return [...(Array.isArray(entry.values?.acquisitions) ? entry.values.acquisitions : []),
    ...(Array.isArray(entry.values?.inferredRecords) ? entry.values.inferredRecords : []),
    ...(Array.isArray(entry.values?.inferredFill?.entityIds) ? entry.values.inferredFill.entityIds.map(entityId => ({ entityId })) : [])].flatMap(row => {
    if (!row?.entityId) return [];
    return historicalCatalogIssues({ ...entry, values: { entityId: row.entityId, timestamp: row.timestamp }, timePrecision: row.timePrecision || 'unknown' }, catalog);
  });
}

function duplicateLedger(left, right) {
  return left.kind === 'pool-ledger' && right.kind === 'pool-ledger'
    && left.values?.coverageMode === 'pool' && right.values?.coverageMode === 'pool'
    && left.poolId === right.poolId && left.values?.drawMethod === right.values?.drawMethod;
}

export function buildWorkbenchPreview(submission, context, catalog, { excludeId = null, preserveSource = false } = {}) {
  const issues = [];
  const entries = submission.entries.map((raw) => {
    if (raw.reviewState !== 'confirmed') issues.push(issue(raw.entryId, 'entry_not_confirmed', '提交前必须逐条确认记录'));
    if (!raw.values || typeof raw.values !== 'object' || Array.isArray(raw.values)
      || Object.keys(raw.values).some((key) => !VALUE_FIELDS.has(key))) {
      issues.push(issue(raw.entryId, 'invalid_workbench_values', '补录字段无效，不能写入官方序号或未定义字段'));
    }
    const validation = validateWorkbenchEntry(structuredClone(raw), catalog);
    for (const item of validation.issues || []) issues.push({ ...item, entryId: raw.entryId, severity: 'blocking' });
    if (!validation.valid && !validation.issues?.length) issues.push(issue(raw.entryId, 'invalid_workbench_entry', '记录校验失败'));
    if (containsOfficialIdentity(raw.values)) issues.push(issue(raw.entryId, 'workbench_unknown_value_field', '补录内容不能携带官方序号或身份字段'));
    const normalized = { ...raw, ...(validation.entry || {}), entryId: raw.entryId, source: ['manual', 'file', 'xhh'].includes(raw.source) ? raw.source : 'manual' };
    issues.push(...historicalCatalogIssues(normalized, catalog));
    if (normalized.kind === 'pool-ledger') issues.push(...ledgerCatalogIssues(normalized, catalog));
    return normalized;
  });
  const existing = context.entries
    .filter((row) => row.id !== excludeId && row.entry_id !== excludeId && !row.deleted_at)
    .map(toWorkbenchEntry);
  const history = context.history;
  const editedEntryId = excludeId
    ? context.entries.find((row) => row.id === excludeId || row.entry_id === excludeId)?.entry_id
    : null;
  const contextEntryIds = new Set(context.entries.map((row) => row.entry_id));
  if (editedEntryId) contextEntryIds.delete(editedEntryId);
  const metrics = computeWorkbenchMetrics({
    entries: [...existing, ...entries],
    history,
    pools: catalog.pools,
    entities: catalog.entities,
    scope: submission.scope,
  });
  const submittedIds = new Set(entries.map((entry) => entry.entryId));
  issues.push(...metricsBlockingIssues(metrics).filter((item) => submittedIds.has(item.entryId)));
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (contextEntryIds.has(entry.entryId)) {
      issues.push(issue(entry.entryId, 'entry_already_committed', '草稿条目已提交，请编辑已保存记录'));
    }
    const existingMatch = findBlockingOverlap(entry, existing) || existing.find(candidate => duplicateLedger(entry, candidate));
    const draftMatch = findBlockingOverlap(entry, entries.slice(0, index)) || entries.slice(0, index).find(candidate => duplicateLedger(entry, candidate));
    // 官方明细的疑似重复由服务端直接阻断，与指标引擎的 detail_covered 保持一致。
    const officialMatch = ['detail', 'potential-evidence'].includes(entry.kind)
      ? duplicateDetailIssues(entry, history)
      : null;
    if (officialMatch) issues.push(officialMatch);
    if (existingMatch || draftMatch) {
      issues.push(issue(entry.entryId, 'workbench_overlap', entry.kind === 'potential-evidence'
        ? '疑似与已有获取证据或补录明细重叠，请调整后重试'
        : '疑似与已有补录明细重复，请调整覆盖范围后重试', {
        conflictSource: existingMatch ? 'workbench' : 'draft',
        conflictId: existingMatch?.id || draftMatch?.entryId,
      }));
    }
  }
  const ledgerRules = !preserveSource && entries.some(entry => entry.kind === 'pool-ledger')
    ? validateWorkbenchRules({ entries: [...existing, ...entries], history, pools: catalog.pools, entities: catalog.entities })
    : null;
  if (ledgerRules) issues.push(...ledgerRules.issues);
  const canCommit = issues.length === 0;
  return {
    issues, canCommit, entries, scope: submission.scope,
    ...(ledgerRules ? { warnings: ledgerRules.warnings, checks: ledgerRules.checks } : {}),
    historyCount: history.length, existingCount: existing.length,
    metrics: {
      confirmed: metrics.confirmed, supplemental: metrics.supplemental, combined: metrics.combined,
      rates: metrics.rates, intervals: metrics.intervals, coverage: metrics.coverage,
      eligible: metrics.eligible, resource: metrics.resource,
    },
  };
}

function resolveHistoryChanges(change, current, catalog) {
  const update = {};
  const values = change.changes;
  if ('timestamp' in values) {
    if (typeof values.timestamp !== 'string' || !Number.isFinite(Date.parse(values.timestamp))) throw new WorkbenchError('invalid_history_timestamp', '抽卡时间格式无效');
    update.timestamp = new Date(values.timestamp).toISOString();
  }
  if ('poolId' in values) update.pool_id = requireText(values.poolId, 'poolId', 160);
  if ('characterId' in values) {
    const entity = catalog.entities.find(item => item.id === values.characterId);
    if (!entity) throw new WorkbenchError('invalid_history_item', '选择的角色或武器不存在');
    Object.assign(update, { character_id: entity.id, character_name: entity.name, item_name: entity.name, rarity: Number(entity.rarity) });
  }
  if ('drawMethod' in values) {
    if (!['normal', 'free', 'info_book', 'gift'].includes(values.drawMethod)) throw new WorkbenchError('invalid_draw_method', '抽取方式无效');
    Object.assign(update, { is_free: values.drawMethod === 'free', is_info_book: values.drawMethod === 'info_book' });
    if (values.drawMethod === 'gift' || current.special_type === 'gift') update.special_type = values.drawMethod === 'gift' ? 'gift' : null;
  }
  if ('isStandard' in values) {
    if (typeof values.isStandard !== 'boolean') throw new WorkbenchError('invalid_standard_flag', 'UP/常驻标记格式无效');
    update.is_standard = values.isStandard;
  }
  if ('specialType' in values) {
    if (values.specialType !== null && !['gift', 'guaranteed'].includes(values.specialType)) throw new WorkbenchError('invalid_special_type', '特殊记录标记无效');
    update.special_type = values.specialType;
  }
  return update;
}

export function buildWorkspacePreview(submission, context, catalog) {
  const issues = validateWorkbenchPoolOperations({ ...submission, history: context.history, existingEntries: context.entries, pools: catalog.pools });
  const history = context.history.map(row => ({ ...row }));
  const resolvedHistoryChanges = [];
  for (const change of submission.historyChanges) {
    const current = history.find(row => String(row.record_id) === change.recordId && row.pool_id === change.currentPoolId
      && String(row.seq_id) === change.seqId && row.game_uid === submission.scope.gameUid && row.server_scope === submission.scope.serverScope);
    if (!current) { issues.push(issue(null, 'history_record_not_found', '历史记录不属于当前账号范围或已变化', { recordId: change.recordId })); continue; }
    if (Number(current.edit_version ?? 1) !== change.expectedEditVersion) { issues.push(issue(null, 'history_record_conflict', '历史记录已在其他页面修改', { recordId: change.recordId })); continue; }
    const update = resolveHistoryChanges(change, current, catalog);
    Object.assign(current, update);
    if (history.some(row => row !== current && row.pool_id === current.pool_id && row.seq_id === current.seq_id)) {
      issues.push(issue(null, 'history_record_duplicate', '目标卡池中已经存在相同序号的历史记录', { recordId: change.recordId }));
    }
    const item = { kind: 'detail', poolId: current.pool_id, timePrecision: current.timestamp ? 'second' : 'unknown', values: { entityId: current.character_id, timestamp: current.timestamp } };
    issues.push(...historicalCatalogIssues(item, catalog).map(problem => ({ ...problem, recordId: change.recordId })));
    const pool = catalog.pools.find(pool => pool.id === current.pool_id);
    const time = Date.parse(current.timestamp);
    if (Number.isFinite(time) && ((Number.isFinite(Date.parse(pool?.start_time)) && time < Date.parse(pool.start_time))
      || (Number.isFinite(Date.parse(pool?.end_time)) && time > Date.parse(pool.end_time)))) issues.push(issue(null, 'outside_pool_window', '记录时间不在目标卡池开放区间内', { recordId: change.recordId }));
    resolvedHistoryChanges.push({ ...change, changes: update });
  }
  const replacementIds = new Set(submission.supplementChanges.map(change => change.id));
  const untouched = context.entries.filter(row => !replacementIds.has(row.id));
  const updates = [];
  const resolvedSupplementChanges = [];
  for (const change of submission.supplementChanges) {
    const current = context.entries.find(row => row.id === change.id && !row.deleted_at);
    if (!current) { issues.push(issue(null, 'workbench_entry_not_found', '补录记录不属于当前账号范围或已删除', { id: change.id })); continue; }
    if (current.revision !== change.expectedRevision) { issues.push(issue(null, 'workbench_revision_conflict', '补录记录已在其他页面修改', { id: change.id })); continue; }
    if (change.action === 'update') {
      if (change.entry.entryId !== current.entry_id) { issues.push(issue(change.entry.entryId, 'workbench_entry_identity_changed', '修改补录时不能更换条目标识')); continue; }
      const entry = { ...change.entry, source: current.source, ...(current.derivation ? { derivation: current.derivation } : {}) };
      updates.push(entry);
      resolvedSupplementChanges.push({ ...change, entry });
    } else resolvedSupplementChanges.push(change);
  }
  const candidates = [...submission.entries, ...updates];
  const base = buildWorkbenchPreview({ ...submission, entries: candidates }, { ...context, history, entries: untouched }, catalog, { preserveSource: true });
  const rulesHistory = history.map(row => ({ ...row, id: row.record_id, poolId: row.pool_id, characterId: row.character_id,
    characterName: row.character_name, gameUid: row.game_uid, serverScope: row.server_scope,
    seqId: row.seq_id, isFree: row.is_free, isInfoBook: row.is_info_book, isStandard: row.is_standard,
    specialType: row.special_type, batchId: row.batch_id,
  }));
  const rules = validateWorkbenchRules({ entries: [...untouched.filter(row => !row.deleted_at).map(toWorkbenchEntry), ...base.entries],
    history: rulesHistory, pools: catalog.pools, entities: catalog.entities,
    historyChanges: submission.historyChanges, supplementChanges: submission.supplementChanges });
  issues.push(...base.issues, ...(rules.issues || []));
  const deduplicated = [...new Map(issues.map(item => [JSON.stringify([item.entryId, item.recordId, item.id, item.code, item.field]), item])).values()];
  const entries = base.entries.slice(0, submission.entries.length);
  resolvedSupplementChanges.forEach(change => {
    if (change.action === 'update') change.entry = base.entries.find(entry => entry.entryId === change.entry.entryId) || change.entry;
  });
  return { ...base, entries, canCommit: deduplicated.length === 0 && rules.valid !== false, issues: deduplicated,
    warnings: [...(base.warnings || []), ...(rules.warnings || [])], checks: rules.checks || [],
    historyChanges: resolvedHistoryChanges, supplementChanges: resolvedSupplementChanges,
    operationCount: submission.entries.length + submission.historyChanges.length + submission.supplementChanges.length,
  };
}

export async function readCommit(db, userId, commitId) {
  const { data, error } = await db.from(WORKBENCH_COMMITS).select('payload_hash,result').eq('user_id', userId).eq('commit_id', commitId).maybeSingle();
  if (error) throw error;
  return data;
}

export function resolveWorkbenchError(error) {
  if (error instanceof WorkbenchError) return error;
  const message = String(error?.message || '');
  if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error?.code)) {
    return new WorkbenchError('workbench_unavailable', '补录服务尚未完成数据库迁移，请联系管理员', 503);
  }
  const conflicts = [
    ['workbench_validation_required', '请先完成有效的统一校验'],
    ['workbench_validation_expired', '校验凭证已过期，请重新校验'],
    ['workbench_validation_mismatch', '草稿已变化，请重新校验'],
    ['workbench_catalog_changed', '卡池或实体目录已变化，请重新校验'],
    ['workbench_rules_changed', '校验规则已变化，请重新校验'],
    ['workbench_scope_mismatch', '修改记录不属于当前账号范围'],
    ['history_record_conflict', '历史记录已被修改，请重新校验'],
    ['history_record_duplicate', '目标卡池中已经存在相同序号的记录'],
  ];
  const conflict = conflicts.find(([code]) => message.includes(code));
  if (conflict) return new WorkbenchError(conflict[0], conflict[1], 409);
  if (error?.code === '23505' && message.includes('history_user_game_server_scope_pool_seq_unique')) return new WorkbenchError('history_record_duplicate', '目标卡池中已经存在相同序号的记录', 409);
  if (error?.code === '23505' && message.includes('account_data_workbench_entries_user_id_draft_id_entry_id_key')) return new WorkbenchError('workbench_entry_already_committed', '草稿条目已经提交', 409);
  if (message.includes('history_record_not_found')) return new WorkbenchError('history_record_not_found', '历史记录不存在或已变化', 404);
  if (/workbench_(revision_conflict|context_changed|idempotency_conflict|entry_already_committed)/u.test(message)) {
    return new WorkbenchError(message.match(/workbench_[a-z_]+/u)[0], '记录或提交内容已变化，请刷新后重试', 409);
  }
  if (message.includes('workbench_entry_not_found')) return new WorkbenchError('workbench_entry_not_found', '记录不存在', 404);
  if (message.includes('workbench_scope_too_large')) return new WorkbenchError('workbench_scope_too_large', '当前账号记录超出完整校验范围', 413);
  return new WorkbenchError('workbench_request_failed', '数据工作台请求失败，请稍后重试', 500);
}
