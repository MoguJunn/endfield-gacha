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

/** Compare against the complete server context, including previous file repairs.
 * Preserve multiplicity: two copies of one entity in one ten-pull are two wins. */
export function planRescueSupplements(data, context) {
  const existing = (context.entries || []).filter(row => !row.deletedAt && !row.deleted_at).map(normalizeWorkbenchEntry);
  const history = context.history || [];
  const supplementPoints = existing.flatMap(entry => entry.kind === 'pool-ledger'
    ? (entry.values.acquisitions || []).map(row => ({ ...row, poolId: entry.poolId }))
    : entry.kind === 'detail' ? [{ ...entry.values, poolId: entry.poolId }] : []);
  const coveredHistory = new Set();
  const points = [...history, ...supplementPoints.filter(row => {
    const index = history.findIndex((point, index) => !coveredHistory.has(index) && sameAcquisition(row, point));
    if (index < 0) return true;
    coveredHistory.add(index); return false;
  })];
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
      const covered = history.filter(row => poolId(row) === incoming.poolId && method(row) === 'normal'
        && at(row) >= Date.parse(incoming.values.rangeStart) && at(row) < Date.parse(incoming.values.rangeEnd));
      incoming.values = { ...incoming.values, ...Object.fromEntries([[4,'fourStarCount'],[5,'fiveStarCount'],[6,'sixStarCount']]
        .map(([rarity, key]) => [key, covered.filter(row => Number(row.rarity) === rarity).length])) };
    } else if (!fresh.length) continue;
    const overlapping = existing.filter(row => ['pool-ledger', 'pool-summary', 'batch-summary'].includes(row.kind) && overlaps(row, incoming));
    if (overlapping.length) {
      const prior = overlapping[0];
      if (wiki && prior.entryId === incoming.entryId && JSON.stringify(canonical(prior.values)) === JSON.stringify(canonical(incoming.values))) continue;
      if (overlapping.length !== 1 || prior.kind !== 'pool-ledger' || prior.source !== 'file' || prior.values.complete !== false
        || prior.values.totalPulls != null || prior.values.coverageMode !== 'range' || wiki && prior.entryId !== incoming.entryId) {
        throw new Error('文件与已有卡池汇总范围重叠，请在数据工作台核对后合并，现有数据不会被覆盖。');
      }
      fresh = [...(prior.values.acquisitions || []), ...fresh];
      const values = { ...prior.values, ...incoming.values, acquisitions: fresh,
        rangeStart: new Date(Math.min(Date.parse(prior.values.rangeStart), Date.parse(incoming.values.rangeStart))).toISOString(),
        rangeEnd: new Date(Math.max(Date.parse(prior.values.rangeEnd), Date.parse(incoming.values.rangeEnd))).toISOString() };
      // Old repairs may explicitly contain only the known acquisition counts.
      // Derive the corresponding merged counts; never introduce a total.
      if (!wiki) for (const [rarity,key] of [[5,'fiveStarCount'],[6,'sixStarCount']]) {
        if (prior.values[key] != null) values[key] = Number(prior.values[key]) + (incoming.values.acquisitions || [])
          .filter(row => !prior.values.acquisitions?.some(old => old.id === row.id) && fresh.includes(row) && row.rarity === rarity).length;
      }
      supplementChanges.push({ id: prior.id, expectedRevision: prior.revision, action: 'update',
        reason: '合并已确认的文件补录，保留原有出货和未知总量。', entry: { ...prior, values } });
    } else entries.push({ ...incoming, values: { ...incoming.values, acquisitions: fresh } });
  }
  return { entries, historyChanges: [], supplementChanges };
}

export async function importRescueSupplements(data) {
  const account = data.accounts?.[0];
  const scope = { gameUid: account?.gameUid, serverScope: String(account?.serverId || '') };
  if (!scope.gameUid || !['1','2','3'].includes(scope.serverScope)) throw new Error('请先选择有效的游戏账号和区服。');
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
