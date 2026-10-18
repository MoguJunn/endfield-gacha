import { loadWorkbenchContext, validateWorkbenchWorkspace, commitWorkbenchEntries } from './dataWorkbenchService.js';
import { normalizeWorkbenchEntry } from '../../shared/dataWorkbench.js';
import { rescueImportId, LCX_RESCUE_FORMAT } from '../utils/rescueImport.js';

const poolId = row => String(row.poolId ?? row.pool_id ?? '');
const method = row => row.drawMethod || (row.special_type === 'gift' || row.specialType === 'gift' ? 'gift' : row.is_free || row.isFree ? 'free' : 'normal');
const at = row => Date.parse(row.timestamp || row.sourceTimestamp || '');
const sameAcquisition = (a, b) => poolId(a) === poolId(b) && String(a.entityId || a.character_id || a.characterId) === String(b.entityId || b.character_id || b.characterId)
  && (a.rarity == null || b.rarity == null || Number(a.rarity) === Number(b.rarity)) && method(a) === method(b) && Math.abs(at(a)-at(b)) <= 1;
const overlaps = (a, b) => poolId(a) === poolId(b) && a.values.drawMethod === b.values.drawMethod
  && (a.values.coverageMode === 'pool' || b.values.coverageMode === 'pool'
    || Date.parse(a.values.rangeStart) < Date.parse(b.values.rangeEnd) && Date.parse(b.values.rangeStart) < Date.parse(a.values.rangeEnd));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const sameIdentity = (a, b) => a.entryId === b.entryId
  && (a.draftId ?? a.draft_id) === (b.draftId ?? b.draft_id);
const inRange = (point, entry) => poolId(point) === entry.poolId && method(point) === entry.values.drawMethod
  && at(point) >= Date.parse(entry.values.rangeStart) && at(point) < Date.parse(entry.values.rangeEnd);
const overlapError = () => new Error('文件与已有卡池汇总范围重叠，请在数据工作台核对后合并，现有数据不会被覆盖。');

function appendUncovered(points, additions) {
  const matched = new Set();
  return [...points, ...additions.filter(row => {
    const index = points.findIndex((point, index) => !matched.has(index) && sameAcquisition(row, point));
    if (index < 0) return true;
    matched.add(index); return false;
  })];
}

function removeEvidencedCounts(values, prior, confirmedPoints) {
  const known = appendUncovered(confirmedPoints.filter(point => inRange(point, prior)),
    (prior.values.acquisitions || []).map(row => ({ ...row, poolId: prior.poolId })));
  for (const [rarity, key] of [[4, 'fourStarCount'], [5, 'fiveStarCount'], [6, 'sixStarCount']]) {
    // Counts may include unnamed wins. Auto-merge only when concrete evidence
    // already proves them, then let metrics derive counts for the wider range.
    if (prior.values[key] != null && Number(prior.values[key]) > known.filter(row => method(row) === prior.values.drawMethod && Number(row.rarity) === rarity).length) {
      throw new Error('已有补录包含尚未确认具体出货的数量，请在数据工作台核对后合并。');
    }
    delete values[key];
  }
}

function setWikiCounts(entry, history) {
  const covered = history.filter(row => inRange(row, entry));
  for (const [rarity, key] of [[4, 'fourStarCount'], [5, 'fiveStarCount'], [6, 'sixStarCount']]) {
    entry.values[key] = covered.filter(row => Number(row.rarity) === rarity).length;
  }
}

/** Compare against the complete server context, including previous file repairs.
 * Preserve multiplicity: two copies of one entity in one ten-pull are two wins. */
export function planRescueSupplements(data, context) {
  const existing = (context.entries || []).filter(row => !row.deletedAt && !row.deleted_at).map(normalizeWorkbenchEntry);
  const history = context.history || [];
  const supplementPoints = existing.flatMap(entry => entry.kind === 'pool-ledger'
    ? (entry.values.acquisitions || []).map(row => ({ ...row, poolId: entry.poolId }))
    : entry.kind === 'detail' ? [{ ...entry.values, poolId: entry.poolId }] : []);
  const points = appendUncovered(history, supplementPoints);
  const confirmedPoints = appendUncovered(history, existing.filter(entry => entry.kind === 'detail')
    .map(entry => ({ ...entry.values, poolId: entry.poolId })));
  const consumed = new Set(), entries = [], supplementChanges = [];
  for (const raw of data.workbenchEntries || []) {
    const incoming = normalizeWorkbenchEntry(raw);
    if (incoming.kind === 'batch-summary') {
      const prior = existing.find(row => row.kind === 'batch-summary' && overlaps(row, incoming));
      if (prior) {
        if (prior.values.totalPulls !== incoming.values.totalPulls) throw new Error('已有免费十连摘要与文件不一致，请到数据工作台核对。');
        continue;
      }
      const detailed = history.filter(row => poolId(row) === incoming.poolId && method(row) === 'free'
        && at(row) >= Date.parse(incoming.values.rangeStart) && at(row) < Date.parse(incoming.values.rangeEnd));
      if (detailed.length >= incoming.values.totalPulls) continue;
      entries.push(incoming); continue;
    }
    let fresh = (incoming.values.acquisitions || []).filter(row => {
      const candidate = { ...row, poolId: incoming.poolId };
      const index = points.findIndex((point, index) => !consumed.has(index) && sameAcquisition(candidate, point));
      if (index < 0) return true;
      consumed.add(index); return false;
    });
    const wiki = data.sourceFormatId === LCX_RESCUE_FORMAT;
    if (wiki) {
      const unknown = (data.unresolvedRecords || []).filter(row => row.poolId === incoming.poolId);
      const resolved = unknown.every(row => history.some(known => poolId(known) === row.poolId
        && String(known.seq_id ?? known.seqId) === String(row.seqId) && Boolean(known.character_id || known.characterId)
        && [4, 5, 6].includes(Number(known.rarity))));
      if (resolved) continue;
      setWikiCounts(incoming, history);
    } else if (!fresh.length) continue;
    const overlapping = existing.filter(row => sameIdentity(row, incoming)
      || ['pool-ledger', 'pool-summary', 'batch-summary'].includes(row.kind) && overlaps(row, incoming));
    if (overlapping.length) {
      const prior = overlapping[0];
      if (wiki && prior.entryId === incoming.entryId && JSON.stringify(canonical(prior.values)) === JSON.stringify(canonical(incoming.values))) continue;
      if (overlapping.length !== 1 || prior.kind !== 'pool-ledger' || prior.source !== 'file' || prior.values.complete !== false
        || prior.poolId !== incoming.poolId || prior.values.drawMethod !== incoming.values.drawMethod
        || prior.values.totalPulls != null || prior.values.pity != null || prior.values.initialPity != null
        || prior.values.coverageMode !== 'range' || wiki && prior.entryId !== incoming.entryId) {
        throw overlapError();
      }
      fresh = [...(prior.values.acquisitions || []), ...fresh];
      const values = { ...prior.values, ...incoming.values, acquisitions: fresh,
        rangeStart: new Date(Math.min(Date.parse(prior.values.rangeStart), Date.parse(incoming.values.rangeStart))).toISOString(),
        rangeEnd: new Date(Math.max(Date.parse(prior.values.rangeEnd), Date.parse(incoming.values.rangeEnd))).toISOString() };
      const merged = { ...prior, values };
      if (existing.some(row => row !== prior && ['pool-ledger', 'pool-summary', 'batch-summary'].includes(row.kind) && overlaps(row, merged))) throw overlapError();
      if (wiki) setWikiCounts(merged, history);
      else removeEvidencedCounts(values, prior, confirmedPoints);
      supplementChanges.push({ id: prior.id, expectedRevision: prior.revision, action: 'update',
        reason: '合并已确认的文件补录，保留原有出货和未知总量。', entry: merged });
    } else entries.push({ ...incoming, values: { ...incoming.values, acquisitions: fresh } });
  }
  return { entries, historyChanges: [], supplementChanges };
}

export async function importRescueSupplements(data) {
  const account = data.accounts?.[0];
  const scope = { gameUid: account?.gameUid, serverScope: String(account?.serverId || '') };
  if (!scope.gameUid || !['1','2','3','bilibili'].includes(scope.serverScope)) throw new Error('请先选择有效的游戏账号和区服。');
  const context = await loadWorkbenchContext(scope);
  const operations = planRescueSupplements(data, context);
  const count = operations.entries.length + operations.supplementChanges.length;
  if (!count) return { saved: 0, skipped: data.workbenchEntries.length };
  if (count > 100) throw new Error('补录项目超过一次保存上限，请按卡池拆分文件。');
  const payload = { mode: 'pool-workspace', scope, draftId: data.workbenchEntries[0].draftId,
    commitId: rescueImportId(JSON.stringify([scope, operations])), draftRevision: 1, ...operations };
  const validation = await validateWorkbenchWorkspace(payload);
  if (!validation.preview?.canCommit || !validation.validationToken) {
    throw new Error(validation.preview?.issues?.map(issue => issue.message).slice(0,3).join('；') || '文件补录校验未通过，请在数据工作台核对。');
  }
  await commitWorkbenchEntries({ ...payload, validationToken: validation.validationToken });
  return { saved: count, skipped: data.workbenchEntries.length-count };
}
