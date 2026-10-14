import * as workbench from '../../../shared/dataWorkbench.js';
import { resolvePoolCapabilities } from '../../utils/poolCapabilities.js';
import { entitiesForWorkbenchPool } from './workbenchCatalog.js';
import { isWorkbenchPoolUnopened, workbenchPoolUnavailableMessage } from '../../../shared/workbenchPoolAvailability.js';

const text = (value) => String(value ?? '').trim();
const present = (value) => value !== undefined && value !== null && (typeof value !== 'string' || value.trim() !== '');
const numberFields = ['totalPulls', 'fourStarCount', 'fiveStarCount', 'sixStarCount', 'pity', 'initialPity'];
const methods = ['normal', 'free', 'gift', 'info_book'];
const newId = () => globalThis.crypto.randomUUID();
export const poolIdOf = (value) => text(value?.poolId ?? value?.pool_id ?? value?.id);
export const entityIdOf = (value) =>
  text(value?.entityId ?? value?.characterId ?? value?.character_id ?? value?.itemId ?? value?.item_id);
export const isWeaponPool = (pool) => resolvePoolCapabilities(pool).entityType === 'weapon';

export function scopeMatches(raw, scope) {
  const a = workbench.normalizeWorkbenchScope(raw?.scope || raw);
  const b = workbench.normalizeWorkbenchScope(scope);
  return Boolean(a && b && a.gameUid === b.gameUid && a.serverScope === b.serverScope);
}

export function entitiesForPool(pool, entities = []) {
  return entitiesForWorkbenchPool(pool, entities);
}

export function historyLocator(record, scope) {
  const original = record._originalHistory || record;
  return {
    recordId: original.record_id ?? original.id,
    gameUid: text(original.gameUid ?? original.game_uid ?? scope?.gameUid),
    serverScope: text(original.serverScope ?? original.server_scope ?? scope?.serverScope),
    currentPoolId: text(original.poolId ?? original.pool_id),
    ...(present(original.seqId ?? original.seq_id) ? { seqId: original.seqId ?? original.seq_id } : {}),
  };
}

function historyMethod(record) {
  if (record.drawMethod) return record.drawMethod;
  if (record.isInfoBook || record.is_info_book) return 'info_book';
  if (record.isFree || record.is_free) return 'free';
  if (record.specialType === 'gift' || record.special_type === 'gift') return 'gift';
  return 'normal';
}

export function createQuestionnaireAcquisition(rarity = 6) {
  return { id: newId(), rarity, quantity: 1, drawMethod: 'normal', timePrecision: 'unknown' };
}

export function getSavedPoolLedgers(poolId, existingEntries = [], scope) {
  return existingEntries.filter(
    (entry) => entry.kind === 'pool-ledger' && poolIdOf(entry) === text(poolId) && scopeMatches(entry, scope)
  );
}

export function createQuestionnairePoolState(
  poolId,
  { scope, existingHistory = [], existingEntries = [], mode = 'add', selectedEntryId } = {}
) {
  const saved = mode === 'edit' ? getSavedPoolLedgers(poolId, existingEntries, scope) : [];
  const original = saved.find((entry) => (entry.id ?? entry.entryId ?? entry.entry_id) === selectedEntryId) || saved[0];
  const values = original?.values ? structuredClone(original.values) : {};
  const officialRows = existingHistory
    .filter(
      (record) =>
        scopeMatches(record, scope) && poolIdOf(record) === text(poolId) && [5, 6].includes(Number(record.rarity))
    )
    .map((record) => ({
      id: newId(),
      entityId: entityIdOf(record),
      rarity: Number(record.rarity),
      quantity: 1,
      drawMethod: historyMethod(record),
      ...(present(record.isOffRate) ||
      present(record.is_off_rate) ||
      present(record.isStandard) ||
      present(record.is_standard)
        ? { isOffRate: Boolean(record.isOffRate ?? record.is_off_rate ?? record.isStandard ?? record.is_standard) }
        : {}),
      ...(present(record.timestamp)
        ? { timestamp: record.timestamp, timePrecision: 'second' }
        : { timePrecision: 'unknown' }),
      ...(present(record.pullIndex) ? { pullIndex: record.pullIndex } : {}),
      ...(present(record.intervalPulls) ? { intervalPulls: record.intervalPulls } : {}),
      origin: 'history',
      originalHistory: record,
    }));
  return {
    poolId: text(poolId),
    original,
    values: { drawMethod: 'normal', coverageMode: 'pool', ...values },
    acquisitions: [
      ...officialRows,
      ...(values.acquisitions || []).map((row) => ({ ...row, id: row.id || newId(), origin: 'ledger' })),
    ],
    skipped: false,
  };
}

function readCount(value, label, { positive = false } = {}) {
  if (!present(value)) return undefined;
  const parsed = Number(value);
  if (
    !['string', 'number'].includes(typeof value) ||
    !Number.isSafeInteger(parsed) ||
    parsed < (positive ? 1 : 0) ||
    parsed > 1000000
  ) {
    throw new Error(`${label}需要填写${positive ? '正' : '非负'}整数（最多 1000000）；未知请留空。`);
  }
  return parsed;
}

function validCalendarDay(value) {
  const day = String(value).slice(0, 10);
  const parsed = Date.parse(day);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === day
  );
}

export function normalizeInputAcquisition(raw, { pool, entities = [] } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('每次高星获得必须是对象。');
  const rarity = Number(raw.rarity);
  if (![5, 6].includes(rarity)) throw new Error('高星获得只接受五星或六星。');
  const entityId = text(raw.entityId);
  if (entityId) {
    const entity = entities.find((item) => text(item.id) === entityId);
    if (!entity) throw new Error(`未知角色或武器 ID：${entityId}。请使用模板中的真实 ID。`);
    if (entity.type !== resolvePoolCapabilities(pool).entityType) throw new Error(`角色或武器 ${entityId} 与卡池类型不匹配。`);
    if (!entitiesForPool(pool, entities).includes(entity)) throw new Error(`角色或武器 ${entityId} 不在本池可获得名单中。`);
    if (Number(entity.rarity) !== rarity) throw new Error(`角色或武器 ${entityId} 与填写的星级不一致。`);
  }
  const drawMethod = raw.drawMethod || 'normal';
  if (!methods.includes(drawMethod)) throw new Error('抽取方式无效。');
  if (present(raw.quantity) && Number(raw.quantity) !== 1)
    throw new Error('每条获得的数量必须为 1，多次获得请按顺序分行。');
  const row = { id: text(raw.id) || newId(), ...(entityId ? { entityId } : {}), rarity, quantity: 1, drawMethod };
  for (const key of ['pullIndex', 'intervalPulls', 'batchIndex']) {
    const value = readCount(raw[key], { pullIndex: '第几抽获得', intervalPulls: '出货间隔', batchIndex: '十连批次' }[key], { positive: true });
    if (value !== undefined) row[key] = value;
  }
  if (typeof raw.isOffRate === 'boolean') row.isOffRate = raw.isOffRate;
  const precision = raw.timePrecision || 'unknown';
  if (!['second', 'day', 'unknown'].includes(precision)) throw new Error('时间精度只能为 second、day 或 unknown。');
  row.timePrecision = precision;
  if (precision === 'unknown') {
    if (present(raw.timestamp)) throw new Error('日期未知时请移除 timestamp，不能把猜测日期作为已知日期。');
  } else {
    const timestamp = text(raw.timestamp);
    if (!timestamp || !Number.isFinite(Date.parse(timestamp)) || !validCalendarDay(timestamp))
      throw new Error('请选择真实有效的已知日期，或把日期改为未知。');
    if (precision === 'day' && !/^\d{4}-\d{2}-\d{2}$/.test(timestamp))
      throw new Error('只知道日期时请填写 YYYY-MM-DD，不能补造时分秒。');
    if (
      precision === 'second' &&
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)
    ) {
      throw new Error('精确时间请填写带时区的 ISO 时间（含秒）；不知道时分秒请选择“只知道日期”。');
    }
    row.timestamp = timestamp;
  }
  return row;
}

export function normalizeInputLedgerValues(raw = {}, catalog = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('台账 values 必须是已知值对象。');
  const values = { drawMethod: raw.drawMethod || 'normal', coverageMode: raw.coverageMode || 'pool' };
  if (!methods.includes(values.drawMethod)) throw new Error('汇总的抽取方式无效。');
  if (!['pool', 'range'].includes(values.coverageMode)) throw new Error('请选择整个卡池或已知时间段。');
  for (const key of numberFields) {
    const value = readCount(
      raw[key],
      {
        totalPulls: '总抽数',
        fourStarCount: '四星数量',
        fiveStarCount: '五星数量',
        sixStarCount: '六星数量',
        pity: '当前垫抽',
        initialPity: '开始时垫抽',
      }[key]
    );
    if (value !== undefined) values[key] = value;
  }
  if (typeof raw.complete === 'boolean') values.complete = raw.complete;
  if (values.coverageMode === 'range') {
    for (const key of ['rangeStart', 'rangeEnd']) {
      if (!present(raw[key]) || !Number.isFinite(Date.parse(raw[key])))
        throw new Error('时间段需要填写真实的开始和结束日期；未知可选择整个卡池。');
      values[key] = raw[key];
    }
    if (Date.parse(values.rangeStart) >= Date.parse(values.rangeEnd)) throw new Error('结束日期必须晚于开始日期。');
  }
  if (
    values.totalPulls !== undefined &&
    ['fourStarCount', 'fiveStarCount', 'sixStarCount'].reduce((sum, key) => sum + (values[key] ?? 0), 0) >
      values.totalPulls
  ) {
    throw new Error('已知星级数量不能超过总抽数。');
  }
  if (raw.acquisitions != null && !Array.isArray(raw.acquisitions))
    throw new Error('acquisitions 必须是获得记录数组。');
  values.acquisitions = (raw.acquisitions || []).map((row) => normalizeInputAcquisition(row, catalog));
  if (values.acquisitions.length > 1000) throw new Error('单个卡池最多填写 1000 行高星获得。');
  const ids = values.acquisitions.map((row) => row.id);
  if (new Set(ids).size !== ids.length) throw new Error('高星获得行的 id 重复，请为每次实际获得保留独立标识。');
  if (
    values.totalPulls !== undefined &&
    values.acquisitions.some((row) => row.drawMethod === values.drawMethod && row.pullIndex > values.totalPulls)
  )
    throw new Error('获得位置不能超过已知总抽数。');
  for (const [rarity, key] of [
    [5, 'fiveStarCount'],
    [6, 'sixStarCount'],
  ]) {
    if (
      values[key] !== undefined &&
      values.acquisitions.filter((row) => row.rarity === rarity && row.drawMethod === values.drawMethod).length >
        values[key]
    ) {
      throw new Error('高星获得行数不能超过对应星级的已知总数。');
    }
  }
  if (
    values.complete === true &&
    ['totalPulls', 'fourStarCount', 'fiveStarCount', 'sixStarCount'].every((key) => values[key] !== undefined) &&
    values.fourStarCount + values.fiveStarCount + values.sixStarCount !== values.totalPulls
  )
    throw new Error('完整记录的各星级数量之和应等于总抽数。');
  if (present(raw.fillSeed)) values.fillSeed = raw.fillSeed;
  if (present(raw.notes)) values.notes = raw.notes;
  // Fill seeds and inferred records are generated once by the shared model.
  return values;
}

export function buildInputLedger({ poolId, source = 'manual', values, entryId }, { pools = [], entities = [] } = {}) {
  const pool = pools.find((item) => poolIdOf(item) === text(poolId));
  if (!pool) throw new Error(`未知卡池 ID：${poolId}。请使用当前目录中的具体卡池。`);
  if (isWorkbenchPoolUnopened(pool)) throw new Error(workbenchPoolUnavailableMessage(pool));
  const normalizedValues = normalizeInputLedgerValues(values, { pool, entities });
  const entry = workbench.buildPoolLedgerEntry(
    { poolId, source, values: normalizedValues, ...(entryId ? { entryId } : {}) },
    { entities, pools }
  );
  return { ...entry, source, derivation: 'declared' };
}

function changedHistoryRow(row, catalog, scope) {
  const original = row.originalHistory;
  const current = normalizeInputAcquisition(row, catalog);
  const baseline = {
    entityId: entityIdOf(original),
    rarity: Number(original.rarity),
    drawMethod: historyMethod(original),
    timestamp: present(original.timestamp) ? original.timestamp : undefined,
    isOffRate: original.isOffRate ?? original.is_off_rate ?? original.isStandard ?? original.is_standard,
  };
  const changes = {};
  if (current.entityId !== baseline.entityId) {
    if (!current.entityId) throw new Error('官方明细修改需要选择真实角色或武器。');
    changes.characterId = current.entityId;
  }
  if (current.rarity !== baseline.rarity && !current.entityId)
    throw new Error('修改官方明细星级时请选择对应的真实角色或武器，星级由目录确定。');
  if (current.timestamp !== baseline.timestamp) {
    if (current.timePrecision !== 'second')
      throw new Error('官方明细修改需要已知的精确时间；不能用未知日期替换原记录。');
    changes.timestamp = current.timestamp;
  }
  if (typeof current.isOffRate === 'boolean' && current.isOffRate !== baseline.isOffRate)
    changes.isStandard = current.isOffRate;
  if (current.drawMethod !== baseline.drawMethod) {
    changes.drawMethod = current.drawMethod;
  }
  if (!Object.keys(changes).length) return null;
  const locator = historyLocator(original, scope);
  const expectedEditVersion = Number(original.editVersion ?? original.edit_version);
  if (
    !present(locator.recordId) ||
    !present(locator.seqId) ||
    !Number.isSafeInteger(expectedEditVersion) ||
    expectedEditVersion < 1
  ) {
    throw new Error('这条官方记录缺少准确定位或编辑版本，请刷新记录后重试。');
  }
  return { ...locator, expectedEditVersion, changes };
}

export function buildQuestionnaireResult(states, { scope, pools = [], entities = [] } = {}) {
  if (!workbench.normalizeWorkbenchScope(scope)) throw new Error('请先选择当前游戏账号和区服。');
  const result = { entries: [], historyChanges: [], supplementChanges: [], warnings: [] };
  for (const state of states) {
    const pool = pools.find((item) => poolIdOf(item) === state.poolId);
    if (!pool) throw new Error(`未知卡池 ID：${state.poolId}。`);
    if (state.skipped) {
      result.warnings.push(`已跳过 ${pool.name || state.poolId}，本次不更新这个卡池。`);
      continue;
    }
    const historyRows = state.acquisitions.filter((row) => row.origin === 'history');
    for (const row of historyRows) {
      const change = changedHistoryRow(row, { pool, entities }, scope);
      if (change) result.historyChanges.push(change);
    }
    const rowsInSummary = state.acquisitions.filter(
      (row) =>
        row.origin !== 'history' ||
        state.values.coverageMode !== 'range' ||
        (Date.parse(row.timestamp) >= Date.parse(state.values.rangeStart) &&
          Date.parse(row.timestamp) <= Date.parse(state.values.rangeEnd))
    );
    // Summary totals cover official rows too, although only ledger rows are persisted here.
    normalizeInputLedgerValues({ ...state.values, acquisitions: rowsInSummary }, { pool, entities });
    const entry = buildInputLedger(
      {
        poolId: state.poolId,
        source: ['manual', 'file', 'xhh'].includes(state.original?.source) ? state.original.source : 'manual',
        entryId: state.original?.entryId ?? state.original?.entry_id,
        values: { ...state.values, acquisitions: state.acquisitions.filter((row) => row.origin !== 'history') },
      },
      { pools, entities }
    );
    const hasContent = numberFields.some((key) => present(entry.values[key])) || entry.values.acquisitions.length > 0;
    if (!hasContent && !state.original) {
      if (!historyRows.length) result.warnings.push(`${pool.name || state.poolId} 未填写已知内容，没有生成空台账。`);
      continue;
    }
    if (state.original) {
      const baseline = normalizeInputLedgerValues(state.original.values, { pool, entities });
      // The generator adds a seed to older ledgers; that alone is not an edit.
      if (!present(state.original.values.fillSeed)) delete baseline.fillSeed;
      const comparable = normalizeInputLedgerValues(entry.values, { pool, entities });
      if (!present(state.original.values.fillSeed)) delete comparable.fillSeed;
      if (JSON.stringify(baseline) !== JSON.stringify(comparable)) {
        if (state.original.id) {
          const expectedRevision = Number(state.original.revision);
          if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
            throw new Error('已保存补录缺少修订版本，请刷新后重试。');
          result.supplementChanges.push({ id: state.original.id, expectedRevision, action: 'update', entry });
        } else {
          result.entries.push(entry);
        }
      }
    } else result.entries.push(entry);
  }
  return result;
}

export function parseConvertedWorkbenchJson(content, { scope, pools = [], entities = [] } = {}) {
  let payload;
  try {
    payload = typeof content === 'string' ? JSON.parse(content.replace(/^\uFEFF/, '')) : content;
  } catch {
    throw new Error('JSON 无法解析。请复制纯 JSON 或下载 JSON 文件，不要包含 Markdown 代码围栏。');
  }
  if (
    !payload ||
    Array.isArray(payload) ||
    payload.formatId !== 'internal_json_v3' ||
    payload.schemaVersion !== '3.0.0'
  ) {
    throw new Error('请使用 internal_json_v3、schemaVersion 3.0.0 的转换模板。');
  }
  if (!workbench.normalizeWorkbenchScope(scope)) throw new Error('请先选择当前游戏账号和区服。');
  if (!Array.isArray(payload.pools) || !Array.isArray(payload.history) || !Array.isArray(payload.accounts)) {
    throw new Error('转换 JSON 必须包含 pools、history、accounts 数组。');
  }
  const poolMap = new Map(pools.map((pool) => [poolIdOf(pool), pool]));
  for (const pool of payload.pools)
    if (!poolMap.has(text(pool.id ?? pool.pool_id)))
      throw new Error(`未知卡池 ID：${pool.id ?? pool.pool_id}。请对照模板目录选择具体卡池。`);
  for (const account of payload.accounts)
    if (!scopeMatches(account, scope)) throw new Error('文件包含其他账号或区服；只能转入当前选定账号和区服。');
  const resolveScope = (raw) => {
    const declared = workbench.normalizeWorkbenchScope(raw.scope || raw);
    const rawUid = raw.scope?.gameUid ?? raw.gameUid ?? raw.game_uid;
    const rawServer = raw.scope?.serverScope ?? raw.serverScope ?? raw.server_scope;
    if (!declared && (present(rawUid) || present(rawServer)))
      throw new Error('条目账号或区服不完整，请保留模板中的完整 scope。');
    const resolved =
      declared || (payload.accounts.length === 1 ? workbench.normalizeWorkbenchScope(payload.accounts[0]) : null);
    if (!resolved || !scopeMatches(resolved, scope))
      throw new Error('条目账号或区服与当前选择不一致，或没有明确账号区服。');
  };
  const entries = [];
  const warnings = [];
  const supplements = payload.supplements;
  if (!supplements || supplements.schemaVersion !== 1 || !Array.isArray(supplements.workbenchEntries)) {
    throw new Error('请保留 supplements.schemaVersion: 1 和 workbenchEntries 数组；未知日期记录放入台账。');
  }
  const seen = new Set();
  for (const raw of supplements.workbenchEntries) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('每条转换补录必须是对象。');
    resolveScope(raw);
    if (raw.kind !== 'pool-ledger') throw new Error('转换补录请使用 pool-ledger 台账。');
    if (raw.source && !['file', 'manual'].includes(raw.source)) throw new Error('补录来源只能为 file 或 manual。');
    if (raw.derivation && raw.derivation !== 'declared')
      throw new Error('转换内容只能声明已知事实，derivation 必须为 declared。');
    const portableId = text(raw.entryId ?? raw.entry_id);
    if (portableId && seen.has(portableId)) throw new Error('转换补录 entryId 重复。');
    if (portableId) seen.add(portableId);
    const entry = buildInputLedger(
      { poolId: poolIdOf(raw), source: raw.source || 'file', values: raw.values },
      { pools, entities }
    );
    if (!numberFields.some((key) => present(entry.values[key])) && !entry.values.acquisitions.length) {
      throw new Error('转换补录没有已知抽数、垫抽或获得内容，请删除空示例后再导入。');
    }
    entries.push(entry);
  }
  const historyGroups = new Map();
  const seenHistory = new Set();
  payload.history.forEach((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record))
      throw new Error(`记录 #${index + 1} 必须是对象。`);
    resolveScope(record);
    const poolId = text(record.poolId ?? record.pool_id);
    const pool = poolMap.get(poolId);
    if (!pool) throw new Error(`记录 #${index + 1} 引用了未知卡池：${poolId}。`);
    const recordIdentity = present(record.seqId ?? record.seq_id)
      ? ['seq', record.seqId ?? record.seq_id]
      : present(record.id ?? record.record_id)
        ? ['id', record.id ?? record.record_id]
        : null;
    if (recordIdentity) {
      const key = JSON.stringify([poolId, ...recordIdentity]);
      if (seenHistory.has(key)) throw new Error(`记录 #${index + 1} 的原始 id / seqId 重复，请先删除重复明细。`);
      seenHistory.add(key);
    }
    if (!present(record.timestamp) || (record.timePrecision && !['second', 'day'].includes(record.timePrecision))) {
      throw new Error(`记录 #${index + 1} 日期未知，请移到 supplements 的 acquisitions，timePrecision 设为 unknown。`);
    }
    const entityId = entityIdOf(record);
    const entity = entities.find((item) => text(item.id) === entityId);
    if (!entity) throw new Error(`记录 #${index + 1} 引用了未知角色或武器：${entityId || '未填写 ID'}。`);
    if (!entitiesForPool(pool, entities).includes(entity))
      throw new Error(`记录 #${index + 1} 的角色或武器与卡池类型不匹配。`);
    const rarity = Number(record.rarity ?? entity.rarity);
    if (Number(entity.rarity) !== rarity) throw new Error(`记录 #${index + 1} 的星级与目录不一致。`);
    if (present(record.quantity) && Number(record.quantity) !== 1)
      throw new Error(`记录 #${index + 1} 每行数量必须为 1，多次获得请按实际顺序分行。`);
    const drawMethod = historyMethod(record);
    if (!methods.includes(drawMethod)) throw new Error(`记录 #${index + 1} 的抽取方式无效。`);
    const groupKey = JSON.stringify([poolId, drawMethod]);
    if (!historyGroups.has(groupKey))
      historyGroups.set(groupKey, { coverageMode: 'pool', drawMethod, complete: false, acquisitions: [] });
    const values = historyGroups.get(groupKey);
    if (rarity === 4) {
      if (!Number.isFinite(Date.parse(record.timestamp)) || !validCalendarDay(record.timestamp))
        throw new Error(`记录 #${index + 1} 的已知时间无效。`);
      values.fourStarCount = (values.fourStarCount || 0) + 1;
    } else {
      values.acquisitions.push(
        normalizeInputAcquisition(
          {
            ...record,
            id: newId(),
            entityId,
            rarity,
            quantity: 1,
            drawMethod: historyMethod(record),
            timePrecision: record.timePrecision || 'second',
          },
          { pool, entities }
        )
      );
    }
  });
  for (const [groupKey, values] of historyGroups) {
    const [poolId] = JSON.parse(groupKey);
    const matches = entries.filter((entry) => entry.poolId === poolId && entry.values.drawMethod === values.drawMethod);
    if (matches.length > 1)
      throw new Error('同一卡池有多段台账时，请把已知日期获得放到对应台账的 acquisitions，明确其覆盖范围。');
    if (matches.length === 1) {
      const target = matches[0];
      const merged = { ...target.values, acquisitions: [...target.values.acquisitions, ...values.acquisitions] };
      if (values.fourStarCount && present(merged.fourStarCount) && values.fourStarCount > merged.fourStarCount)
        throw new Error('已知四星明细数量超过台账的四星总汇，请先核对数量。');
      if (
        merged.coverageMode === 'range' &&
        values.acquisitions.some(
          (row) =>
            Date.parse(row.timestamp) < Date.parse(merged.rangeStart) ||
            Date.parse(row.timestamp) > Date.parse(merged.rangeEnd)
        )
      ) {
        throw new Error('已知日期明细在台账覆盖范围之外，请放到对应时间段的台账中。');
      }
      if (values.fourStarCount && !present(merged.fourStarCount)) merged.fourStarCount = values.fourStarCount;
      const replacement = buildInputLedger(
        { poolId, source: target.source, entryId: target.entryId, values: merged },
        { pools, entities }
      );
      entries[entries.indexOf(target)] = replacement;
    } else entries.push(buildInputLedger({ poolId, source: 'file', values }, { pools, entities }));
    if (values.fourStarCount)
      warnings.push(`${poolMap.get(poolId).name || poolId} 的四星明细已保留为已知四星数量，请核对覆盖范围。`);
  }
  if (payload.history.length)
    warnings.push('已知日期记录已转换为手动声明的获得信息；原 id / seqId 不作为官方记录标识。');
  if (!entries.length) throw new Error('JSON 没有可转入的内容，请在台账中填写至少一个已知值。');
  if (entries.length > 100) throw new Error('单次最多转入 100 条台账，请拆分文件。');
  return { entries, warnings, historyChanges: [], supplementChanges: [] };
}
