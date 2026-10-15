import { resolvePoolCapabilities } from '../src/utils/poolCapabilities.js';
import { isWorkbenchPoolUnopened, workbenchPoolUnavailableMessage } from './workbenchPoolAvailability.js';

export const WORKBENCH_SCHEMA_VERSION = 1;
export const WORKBENCH_KINDS = ['detail', 'six-star-interval', 'pool-summary', 'batch-summary', 'potential-evidence', 'pool-ledger'];
export const WORKBENCH_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const PRECISIONS = ['second', 'day', 'range', 'unknown'];
const METHODS = ['normal', 'free', 'info_book', 'gift'];
const text = value => String(value ?? '').trim();
const present = value => value !== null && value !== undefined && value !== '';
const uuid = () => globalThis.crypto.randomUUID();

export function normalizeWorkbenchScope(scope) {
  const gameUid = text(scope?.gameUid ?? scope?.game_uid);
  const serverScope = text(scope?.serverScope ?? scope?.server_scope);
  if (!gameUid || !serverScope || gameUid.length > 160 || serverScope.length > 160) return null;
  return { gameUid, serverScope };
}

export function getWorkbenchStorageKey(ownerId, scope) {
  const normalized = normalizeWorkbenchScope(scope);
  return `endfield:workbench:v1:${encodeURIComponent(text(ownerId) || 'guest')}:${encodeURIComponent(normalized?.gameUid || '')}:${encodeURIComponent(normalized?.serverScope || '')}`;
}

export function createWorkbenchDraft({ ownerId = '', scope = null, source = 'manual' } = {}) {
  const now = new Date().toISOString();
  return { schemaVersion: 1, draftId: uuid(), revision: 1, ownerId: text(ownerId), scope: normalizeWorkbenchScope(scope), source, entries: [], historyChanges: [], supplementChanges: [], createdAt: now, updatedAt: now };
}

export function createWorkbenchEntry(kind = 'detail') {
  return { entryId: uuid(), kind, poolId: null, values: {}, timePrecision: 'unknown', reviewState: 'unreviewed' };
}

export function normalizeWorkbenchEntry(raw = {}) {
  return {
    ...raw,
    entryId: raw.entryId ?? raw.entry_id,
    poolId: raw.poolId ?? raw.pool_id,
    timePrecision: raw.timePrecision ?? raw.time_precision ?? 'unknown',
    reviewState: raw.reviewState ?? (raw.id ? 'confirmed' : 'unreviewed'),
    values: raw.values && typeof raw.values === 'object' && !Array.isArray(raw.values) ? { ...raw.values } : {},
  };
}

export function validateWorkbenchEntry(raw, { pools = [], entities = [] } = {}) {
  const entry = normalizeWorkbenchEntry(raw);
  const values = entry.values;
  const issues = [];
  const issue = (code, field, message) => issues.push({ entryId: entry.entryId, code, field, message, severity: 'error' });
  if (!WORKBENCH_KINDS.includes(entry.kind)) issue('invalid_kind', 'kind', '请选择有效的数据类型');
  if (!PRECISIONS.includes(entry.timePrecision)) issue('invalid_precision', 'timePrecision', '时间精度无效');
  const pool = pools.find(item => text(item.id ?? item.pool_id) === text(entry.poolId));
  if (!pool) issue('pool_required', 'poolId', '请选择目录中的具体卡池');
  if (isWorkbenchPoolUnopened(pool)) issue('pool_not_open', 'poolId', workbenchPoolUnavailableMessage(pool));
  if (entry.kind === 'pool-ledger') {
    validatePoolLedger(entry, { pool, entities }, issue);
    return { valid: issues.length === 0, issues, entry };
  }
  const entity = entities.find(item => text(item.id) === text(values.entityId));
  const needsEntity = ['detail', 'six-star-interval', 'potential-evidence'].includes(entry.kind);
  if (needsEntity && !entity) issue('entity_required', 'entityId', '请选择真实角色或武器');
  if (entity && pool) {
    const type = text(pool.type ?? pool.pool_type);
    const expected = type.includes('weapon') ? 'weapon' : 'character';
    if (entity.type !== expected) issue('entity_type', 'entityId', '物品类型与卡池不匹配');
    if (entry.kind !== 'potential-evidence' && Array.isArray(pool.rosterEntityIds) && !pool.rosterEntityIds.map(String).includes(String(entity.id))) issue('entity_not_in_pool', 'entityId', '该角色或武器不在本池可获得名单中');
    if (entry.kind === 'six-star-interval' && Number(entity.rarity) !== 6) issue('six_star_required', 'entityId', '出货间隔请选择六星实体');
  }
  for (const key of ['quantity', 'totalPulls', 'fourStarCount', 'fiveStarCount', 'sixStarCount', 'intervalPulls', 'pity', 'orderIndex', 'batchIndex']) {
    if (!present(values[key])) continue;
    const number = Number(values[key]);
    if (!Number.isSafeInteger(number) || number < 0 || number > 1000000) issue('invalid_count', key, `${key} 必须是有效非负整数`);
    else values[key] = number;
  }
  if (['detail', 'potential-evidence'].includes(entry.kind) && !(values.quantity > 0)) issue('quantity_required', 'quantity', '请填写实际数量');
  if (entry.kind === 'detail' && values.quantity !== 1) issue('detail_quantity', 'quantity', '逐条明细每条数量为1，多件请按实际顺序分别填写');
  if (entry.kind === 'six-star-interval' && !(values.intervalPulls > 0)) issue('interval_required', 'intervalPulls', '请填写出货间隔');
  if (entry.kind !== 'potential-evidence' && !METHODS.includes(values.drawMethod)) issue('method_required', 'drawMethod', '请选择抽取方式');
  if (entry.kind === 'potential-evidence' && !text(values.evidenceRef)) issue('evidence_required', 'evidenceRef', '请填写获取证据来源');
  if (entry.kind === 'potential-evidence' && entity?.type !== 'character') issue('potential_character', 'entityId', '满潜获取证据只用于角色累计获取');
  for (const key of ['timestamp', 'rangeStart', 'rangeEnd']) {
    if (present(values[key]) && !Number.isFinite(Date.parse(values[key]))) issue('invalid_time', key, '时间格式无效');
  }
  if (['detail', 'potential-evidence'].includes(entry.kind)) {
    if (entry.timePrecision !== 'second' || !present(values.timestamp)) issue('exact_time_required', 'timestamp', '正式明细及获取证据需要明确时间；信息不足可继续保存草稿');
  } else {
    if (!present(values.rangeStart) || !present(values.rangeEnd)) issue('range_required', 'rangeStart', '请填写补充信息覆盖的开始和结束时间');
    if (Date.parse(values.rangeStart) >= Date.parse(values.rangeEnd)) issue('invalid_range', 'rangeEnd', '结束时间必须晚于开始时间');
  }
  if (['pool-summary', 'batch-summary'].includes(entry.kind)) {
    if (!['totalPulls', 'fourStarCount', 'fiveStarCount', 'sixStarCount', 'pity'].some(key => present(values[key]))) issue('summary_empty', 'totalPulls', '至少填写一个已知汇总值');
    const counts = ['fourStarCount', 'fiveStarCount', 'sixStarCount'];
    const known = counts.reduce((sum, key) => sum + (Number(values[key]) || 0), 0);
    if (present(values.totalPulls) && known > values.totalPulls) issue('counts_exceed_total', 'totalPulls', '已知星级数量不能超过总抽数');
    if (entry.kind === 'batch-summary' && !(values.batchIndex > 0)) issue('batch_required', 'batchIndex', '请填写批次序号');
  }
  if (text(values.notes).length > 2000 || text(values.evidenceRef).length > 500) issue('text_too_long', 'notes', '说明过长');
  const timestamp = Date.parse(values.timestamp);
  if (Number.isFinite(timestamp) && entry.kind !== 'potential-evidence') {
    const start = Date.parse(pool?.start_time ?? pool?.startTime);
    const end = Date.parse(pool?.end_time ?? pool?.endTime);
    if ((Number.isFinite(start) && timestamp < start) || (Number.isFinite(end) && timestamp > end)) issue('outside_pool_window', 'timestamp', '记录时间不在卡池开放区间内');
  }
  return { valid: issues.length === 0, issues, entry };
}

const LEDGER_COUNTS = ['totalPulls', 'fourStarCount', 'fiveStarCount', 'sixStarCount', 'pity', 'initialPity'];

function validatePoolLedger(entry, { pool, entities }, issue) {
  const v = entry.values;
  if (!METHODS.includes(v.drawMethod)) issue('method_required', 'drawMethod', '请选择抽取方式');
  if (!['pool', 'range'].includes(v.coverageMode)) issue('coverage_required', 'coverageMode', '请选择整池记录或时间范围');
  for (const key of LEDGER_COUNTS) {
    if (!present(v[key])) continue;
    const n = Number(v[key]);
    if (!Number.isSafeInteger(n) || n < 0 || n > 1000000) issue('invalid_count', key, '抽数和数量必须为非负整数');
    else v[key] = n;
  }
  if (v.coverageMode === 'range' && (!Number.isFinite(Date.parse(v.rangeStart)) || !Number.isFinite(Date.parse(v.rangeEnd)) || Date.parse(v.rangeStart) >= Date.parse(v.rangeEnd))) {
    issue('invalid_range', 'rangeStart', '请填写有效的开始和结束时间');
  }
  const rows = Array.isArray(v.acquisitions) ? v.acquisitions : [];
  if (v.acquisitions != null && !Array.isArray(v.acquisitions)) issue('invalid_acquisitions', 'acquisitions', '高星记录格式无效');
  if (rows.length > 1000) issue('too_many_acquisitions', 'acquisitions', '单池高星记录不能超过 1000 条');
  if (!LEDGER_COUNTS.some(key => present(v[key])) && !rows.length) issue('summary_empty', 'totalPulls', '请至少填写一个已知抽数或一条出货记录');
  const ids = new Set();
  const counted = { 5: 0, 6: 0 };
  rows.forEach((row, index) => {
    const field = `acquisitions.${index}`;
    if (!row || typeof row !== 'object') { issue('invalid_acquisition', field, '出货记录格式无效'); return; }
    if (!row.id || ids.has(row.id)) issue('acquisition_identity', field, '出货记录需要不重复的标识');
    ids.add(row.id);
    if (![5, 6].includes(Number(row.rarity))) issue('acquisition_rarity', field, '请填写五星或六星记录');
    if (row.quantity != null && Number(row.quantity) !== 1) issue('acquisition_quantity', field, '每行对应一次获得，多件请分别填写');
    if (!METHODS.includes(row.drawMethod)) issue('method_required', field, '请选择每条记录的抽取方式');
    if (row.drawMethod === v.drawMethod) counted[Number(row.rarity)] = (counted[Number(row.rarity)] || 0) + 1;
    for (const key of ['pullIndex', 'intervalPulls', 'batchIndex']) {
      if (!present(row[key])) continue;
      if (!Number.isSafeInteger(Number(row[key])) || Number(row[key]) <= 0 || Number(row[key]) > 1000000) issue('acquisition_position', field, '出货位置、间隔和批次必须是有效正整数');
    }
    if (present(v.totalPulls) && row.drawMethod === v.drawMethod && Number(row.pullIndex) > v.totalPulls) issue('position_exceeds_total', field, '出货位置不能超过该池总抽数');
    const precision = row.timePrecision || 'unknown';
    if (!['second', 'day', 'unknown'].includes(precision) || precision === 'unknown' && present(row.timestamp)) issue('invalid_time_precision', field, '日期未知时请保持时间为空');
    if (precision === 'day' && !/^\d{4}-\d{2}-\d{2}$/.test(row.timestamp || '')) issue('invalid_day_precision', field, '仅日期信息使用年－月－日，不补造时分秒');
    if (precision === 'second' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(row.timestamp || '')) issue('invalid_exact_precision', field, '准确时间需要秒与明确时区');
    if (present(row.timestamp) && !Number.isFinite(Date.parse(row.timestamp))) issue('invalid_time', field, '记录时间无效');
    const entity = entities.find(item => String(item.id) === String(row.entityId));
    if (present(row.entityId) && !entity) issue('entity_required', field, '角色或武器不在真实目录中');
    if (entity && (Number(entity.rarity) !== Number(row.rarity) || entity.type !== resolvePoolCapabilities(pool).entityType)) issue('entity_type', field, '角色或武器的星级／类型与卡池不匹配');
    if (entity && Array.isArray(pool?.rosterEntityIds) && !pool.rosterEntityIds.map(String).includes(String(entity.id))) issue('entity_not_in_pool', field, '该角色或武器不在本池可获得名单中');
  });
  for (const [rarity, key] of [[5, 'fiveStarCount'], [6, 'sixStarCount']]) {
    if (present(v[key]) && counted[rarity] > v[key]) issue('counts_less_than_acquisitions', key, '已填写出货记录数量超过对应星级总数');
  }
  const sum = ['fourStarCount', 'fiveStarCount', 'sixStarCount'].reduce((n, key) => n + (Number(v[key]) || 0), 0);
  if (present(v.totalPulls) && sum > v.totalPulls) issue('counts_exceed_total', 'totalPulls', '星级数量不能超过总抽数');
  if (v.complete === true && present(v.totalPulls) && ['fourStarCount', 'fiveStarCount', 'sixStarCount'].every(key => present(v[key])) && sum !== v.totalPulls) issue('complete_counts_mismatch', 'totalPulls', '完整存档的星级数量之和应等于总抽数');
  if (!['manual', 'file', 'xhh'].includes(entry.source || 'manual')) issue('invalid_source', 'source', '录入渠道无效');
  if (v.complete != null && typeof v.complete !== 'boolean') issue('invalid_completeness', 'complete', '完整性需要明确选择是或否');
  if (entry.derivation && entry.derivation !== 'declared') issue('invalid_derivation', 'derivation', '卡池存档的已知内容与推算明细必须分开标记');
  if (text(v.notes).length > 2000) issue('text_too_long', 'notes', '说明过长');
  // Generated identities are display evidence, never official history identities.
  if (Array.isArray(v.inferredRecords) && v.inferredRecords.some(row => row.derivation !== 'inferred' || Number(row.rarity) !== 4 || present(row.timestamp) || present(row.seqId))) issue('invalid_inferred', 'inferredRecords', '四星填充必须标为推算，不能携带准确时间或官方序号');
  if (v.inferredFill) {
    const fill = v.inferredFill;
    const expected = present(v.fourStarCount) ? Number(v.fourStarCount) : ['totalPulls', 'fiveStarCount', 'sixStarCount'].every(key => present(v[key])) ? Number(v.totalPulls) - Number(v.fiveStarCount) - Number(v.sixStarCount) : null;
    if (fill.derivation !== 'inferred' || !Number.isSafeInteger(fill.count) || fill.count < 0 || fill.count !== expected || !text(fill.seed) || !Array.isArray(fill.entityIds) || !fill.entityIds.length || fill.entityIds.some(id => !entities.some(entity => String(entity.id) === String(id) && Number(entity.rarity) === 4 && entity.type === resolvePoolCapabilities(pool).entityType))) issue('invalid_inferred_fill', 'inferredFill', '四星填充数量或真实目录来源无效，请重新生成草稿');
  }
}

/** Deterministic reconstruction. Counts describe user-confirmed coverage; identities do not. */
export function buildPoolLedgerEntry({ poolId, source = 'manual', values = {}, entryId = uuid(), ...metadata }, { entities = [], pools = [] } = {}) {
  const v = { drawMethod: 'normal', coverageMode: 'pool', acquisitions: [], ...values };
  v.acquisitions = (v.acquisitions || []).map(row => ({ quantity: 1, drawMethod: v.drawMethod, timePrecision: 'unknown', ...row, id: row.id || uuid() }));
  v.fillSeed = text(v.fillSeed) || entryId;
  const pool = pools.find(item => String(item.id) === String(poolId));
  const type = metadata.entityType || (pool ? resolvePoolCapabilities(pool).entityType : String(poolId).includes('weapon') || String(poolId).includes('wepon') ? 'weapon' : 'character');
  const candidates = entities.filter(item => Number(item.rarity) === 4 && item.type === type && (!Array.isArray(pool?.rosterEntityIds) || pool.rosterEntityIds.map(String).includes(String(item.id)))).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const fillCount = present(v.fourStarCount) ? Number(v.fourStarCount) : ['totalPulls', 'fiveStarCount', 'sixStarCount'].every(key => present(v[key]))
    ? Number(v.totalPulls) - Number(v.fiveStarCount) - Number(v.sixStarCount) : null;
  // Persist the complete reconstruction compactly, materialize only visible rows.
  v.inferredRecords = [];
  delete v.inferredFill;
  if (Number.isSafeInteger(fillCount) && fillCount >= 0 && candidates.length && v.drawMethod !== 'gift') {
    v.inferredFill = { count: fillCount, seed: v.fillSeed, entityIds: candidates.map(item => item.id), derivation: 'inferred' };
    v.inferredRecords = materializeInferredRecords({ entryId, values: v }, { limit: 16 });
  }
  return { ...createWorkbenchEntry('pool-ledger'), ...metadata, entryId, poolId, source, derivation: 'declared', values: v };
}

export function materializeInferredRecords(entry, { offset = 0, limit = 100 } = {}) {
  const fill = entry.values.inferredFill;
  if (!fill || !fill.entityIds?.length || !Number.isSafeInteger(fill.count) || fill.count < 0) return entry.values.inferredRecords || [];
  let state = 2166136261;
  for (const ch of String(fill.seed)) state = Math.imul(state ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rows = [];
  for (let i = 0; i < Math.min(fill.count, offset + limit); i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    if (i >= offset) rows.push({ id: `${entry.entryId}:inferred:${i}`, entityId: fill.entityIds[state % fill.entityIds.length], rarity: 4, drawMethod: entry.values.drawMethod, derivation: 'inferred', derivedFrom: entry.entryId });
  }
  return rows;
}

export function previewWorkbenchDraft(draft, catalog = {}) {
  const results = (draft?.entries || []).map(entry => ({ ...validateWorkbenchEntry(entry, catalog), skipped: entry.reviewState === 'skipped' }));
  const active = results.filter(result => !result.skipped);
  const issues = active.flatMap(result => result.issues);
  if (!normalizeWorkbenchScope(draft?.scope)) issues.push({ code: 'scope_required', message: '请选择游戏账号与区服', severity: 'error' });
  return {
    entries: results, issues, canCommit: active.length > 0 && issues.length === 0 && active.every(result => result.entry.reviewState === 'confirmed'),
    counts: { total: results.length, ready: active.filter(result => result.valid && result.entry.reviewState === 'confirmed').length, blocked: active.filter(result => !result.valid).length, skipped: results.filter(result => result.skipped).length },
    duplicateCheck: 'pending-server',
  };
}
