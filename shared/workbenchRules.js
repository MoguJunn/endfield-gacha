import { normalizeWorkbenchEntry, validateWorkbenchEntry } from './dataWorkbench.js';
import { resolvePoolCapabilities } from '../src/utils/poolCapabilities.js';
import { validatePullAgainstRules, validateBatchAgainstRules } from '../src/utils/validators.js';

export const WORKBENCH_RULES_VERSION = 'pool-workspace-1';
const has = value => value !== '' && value !== null && value !== undefined;
const paid = row => (row.drawMethod || 'normal') === 'normal';
const poolKey = row => String(row.poolId ?? row.pool_id ?? '');
const realPaid = row => !(row.isFree ?? row.is_free) && !(row.isInfoBook ?? row.is_info_book) && (row.specialType ?? row.special_type) !== 'gift';

/** Validates evidence, never a random reconstruction pretending to be evidence. */
export function validateWorkbenchRules({ entries = [], history = [], pools = [], entities = [], historyChanges = [] } = {}) {
  const issues = [];
  const warnings = [];
  const checks = [];
  const add = (target, code, message, extra = {}) => target.push({ code, message, severity: target === issues ? 'error' : 'warning', ...extra });
  const ledgers = entries.map(normalizeWorkbenchEntry).filter(entry => !entry.deleted_at && !entry.deletedAt && entry.reviewState !== 'skipped');
  const ledgerKeys = new Set();
  for (const entry of ledgers) {
    const fields = validateWorkbenchEntry(entry, { pools, entities });
    issues.push(...fields.issues);
    if (entry.kind !== 'pool-ledger') continue;
    const v = entry.values;
    const pool = pools.find(item => String(item.id ?? item.pool_id) === String(entry.poolId));
    if (!pool || !fields.valid) continue;
    const context = { entryId: entry.entryId, poolId: entry.poolId };
    const key = `${entry.poolId}:${v.drawMethod}`;
    if (v.coverageMode === 'pool' && ledgerKeys.has(key)) add(issues, 'overlapping_ledgers', '同一卡池、同一抽取方式只能保留一份整池存档，请合并或修改已有内容', context);
    if (v.coverageMode === 'pool') ledgerKeys.add(key);
    const capability = resolvePoolCapabilities(pool);
    const rules = capability.rules;
    const hard = Number(rules.sixStarPity) || 80;
    const fiveHard = Number(rules.fiveStarPity) || 10;
    const rows = v.acquisitions || [];
    const ordered = rows.filter(paid).filter(row => has(row.pullIndex)).sort((a, b) => Number(a.pullIndex) - Number(b.pullIndex));
    if (ordered.some((row, index) => index > 0 && Number(row.pullIndex) === Number(ordered[index - 1].pullIndex))) add(issues, 'duplicate_pull_position', '一次普通抽取不能在同一位置同时获得两个物品', context);
    if (has(v.pity) && Number(v.pity) >= hard && v.drawMethod === 'normal') add(issues, 'pity_over_hard_limit', `当前垫抽不能达到或超过 ${hard} 抽六星保底`, context);
    const sixes = ordered.filter(row => Number(row.rarity) === 6);
    for (const row of rows) {
      const entity = entities.find(item => String(item.id) === String(row.entityId));
      if (!entity) add(warnings, 'identity_unknown', '部分出货未确认具体角色／武器，不参与对应角色获取分析', context);
      if (!row.timestamp) add(warnings, 'time_unknown', '部分记录没有准确时间，时间分布及依赖时间的分析不可验证', context);
      if (entity && row.timestamp && row.timePrecision === 'second') {
        const at = Date.parse(row.timestamp);
        const start = Date.parse(pool.start_time ?? pool.startTime);
        const end = Date.parse(pool.end_time ?? pool.endTime);
        if ((Number.isFinite(start) && at < start) || (Number.isFinite(end) && at > end)) add(issues, 'outside_pool_window', '已填写的记录时间不在卡池开放范围内', context);
      }
      if (paid(row) && Number(row.rarity) === 6 && has(row.intervalPulls) && Number(row.intervalPulls) > hard) add(issues, 'six_star_interval_limit', `已知六星间隔超过 ${hard} 抽保底`, context);
      if (has(row.batchIndex) && (!Number.isSafeInteger(Number(row.batchIndex)) || Number(row.batchIndex) < 1)) add(issues, 'weapon_batch_index', '武器十连批次序号必须为正整数', context);
      if (entity && Number(row.rarity) === 6 && has(row.isOffRate) && pool.up_character) {
        const isTarget = [pool.up_character, ...(pool.featured_characters || []).map(item => typeof item === 'string' ? item : item.name)].includes(entity.name);
        if (isTarget && row.isOffRate === true) add(issues, 'off_rate_identity_conflict', '当期 UP 与“歪”标记不一致，请核对角色和卡池', context);
      }
    }
    // Counts alone do not prove that every high-star position has been supplied.
    const normalRows = rows.filter(paid);
    const sixComplete = v.complete === true && has(v.sixStarCount) && Number(v.sixStarCount) === normalRows.filter(row => Number(row.rarity) === 6).length && normalRows.filter(row => Number(row.rarity) === 6).every(row => has(row.pullIndex));
    const highComplete = sixComplete && has(v.fiveStarCount) && Number(v.fiveStarCount) === normalRows.filter(row => Number(row.rarity) === 5).length && normalRows.every(row => has(row.pullIndex));
    if (v.complete === true) {
      let previous = has(v.initialPity) ? -Number(v.initialPity) : 0;
      for (const row of sixComplete ? sixes : []) {
        if (Number(row.pullIndex) - previous > hard) add(issues, 'six_star_position_limit', `完整记录中六星之间超过 ${hard} 抽保底`, context);
        previous = Number(row.pullIndex);
      }
      let last = 0;
      for (const row of highComplete ? ordered : []) {
        if (Number(row.pullIndex) - last > fiveHard && capability.basePoolType !== 'weapon') add(issues, 'five_star_position_limit', `完整记录中超过 ${fiveHard} 抽没有五星及以上`, context);
        last = Number(row.pullIndex);
      }
      if (highComplete && has(v.totalPulls) && Number(v.totalPulls) - last >= fiveHard && capability.basePoolType !== 'weapon') add(issues, 'five_star_tail_limit', '完整记录尾部已超过五星保底，请核对遗漏的出货', context);
      if (sixComplete && has(v.totalPulls) && Number(v.totalPulls) - previous >= hard) add(issues, 'six_star_tail_limit', '完整记录尾部已达到六星保底，请核对遗漏的出货', context);
      if (sixComplete && has(v.pity) && has(v.totalPulls) && sixes.length && Number(v.pity) !== Number(v.totalPulls) - Number(sixes.at(-1).pullIndex)) add(issues, 'pity_position_mismatch', '当前垫抽与最后一次六星的位置不一致', context);
      const weaponRowsComplete = capability.basePoolType === 'weapon' && has(v.fiveStarCount) && has(v.sixStarCount) && normalRows.length === Number(v.fiveStarCount) + Number(v.sixStarCount) && normalRows.every(row => has(row.batchIndex) || has(row.pullIndex));
      if (weaponRowsComplete && has(v.totalPulls)) {
        const claims = Math.floor(Number(v.totalPulls) / 10);
        const knownClaims = new Set(rows.filter(paid).map(row => Number(row.batchIndex) || (has(row.pullIndex) ? Math.ceil(Number(row.pullIndex) / 10) : null)).filter(Boolean));
        if (knownClaims.size < claims) add(issues, 'weapon_claim_missing_high_star', '完整武器记录的每次十连应包含五星及以上，请补充缺失批次', context);
        const sixClaims = normalRows.filter(row => Number(row.rarity) === 6).map(row => Number(row.batchIndex) || Math.ceil(Number(row.pullIndex) / 10)).sort((a, b) => a - b);
        const sixPity = Number(rules.sixStarClaimPity) || Math.ceil(hard / 10);
        let lastSix = 0;
        for (const claim of sixClaims) { if (claim - lastSix > sixPity) add(issues, 'weapon_six_claim_limit', `完整武器记录超过 ${sixPity} 次十连未出六星`, context); lastSix = claim; }
        if (claims - lastSix >= sixPity) add(issues, 'weapon_six_claim_tail', '完整武器记录尾部已达到六星申领保底', context);
      }
      const guarantee = Number(rules.guaranteedLimitedPity);
      if (sixComplete && capability.targetMode === 'single-up' && has(v.totalPulls) && guarantee > 0 && Number(v.totalPulls) >= guarantee) {
        const before = sixes.filter(row => Number(row.pullIndex) < guarantee);
        const atGuarantee = sixes.find(row => Number(row.pullIndex) === guarantee);
        if (before.every(row => row.isOffRate === true) && (!atGuarantee || atGuarantee.isOffRate === true)) add(issues, 'target_guarantee_violation', `完整记录在第 ${guarantee} 抽应获得当期目标，请核对 UP 与出货位置`, context);
        else if (before.some(row => !has(row.isOffRate))) add(warnings, 'target_identity_unknown', '部分六星的 UP 状态未知，目标保底无法完整验证', context);
      }
      if (!sixComplete || !highComplete) add(warnings, 'positions_incomplete', '总数已知，但尚未填写全部高星出货位置；顺序保底只能检查已知部分', context);
    } else add(warnings, 'incomplete_coverage', '此池作为不完整存档保存，跨缺口的保底和出货顺序无法完整验证', context);
    if (capability.pityScope !== 'pool' && !has(v.initialPity)) add(warnings, 'initial_pity_unknown', '此池可能继承此前垫抽，起始垫抽未知的部分无法验证', context);
    if (rows.some(row => paid(row) && !has(row.pullIndex))) add(warnings, 'order_unknown', '部分出货没有确定位置，不能完整验证顺序和继承', context);
    if (v.inferredRecords?.length || v.inferredFill?.count) add(warnings, 'four_star_inferred', '四星角色为自动推算，仅供存档展示，不参与精确角色、时间和顺序分析', context);
    checks.push({ code: 'pool_evidence_checked', poolId: entry.poolId, message: '已核对该池已知数量、出货位置及抽取方式', status: 'checked' });
  }
  // Existing precise records retain the site's established validation semantics.
  const changes = new Map(historyChanges.map(change => [String(change.recordId), change]));
  const finalHistory = history.map(row => {
    const change = changes.get(String(row.record_id ?? row.id));
    const entity = change?.changes.characterId && entities.find(item => String(item.id) === String(change.changes.characterId));
    const method = change?.changes.drawMethod;
    const special = row.specialType ?? row.special_type;
    return { ...row, ...change?.changes, ...(entity ? { rarity: entity.rarity, name: entity.name } : {}), ...(method ? { isFree: method === 'free', is_free: method === 'free', isInfoBook: method === 'info_book', is_info_book: method === 'info_book', specialType: method === 'gift' ? 'gift' : special === 'gift' ? null : special, special_type: method === 'gift' ? 'gift' : special === 'gift' ? null : special } : {}) };
  });
  for (const change of historyChanges) {
    const original = history.find(row => String(row.record_id ?? row.id) === String(change.recordId));
    if (!original) { add(issues, 'history_record_missing', '待修改的原始记录已不存在，请刷新核对'); continue; }
    const next = finalHistory.find(row => String(row.record_id ?? row.id) === String(change.recordId));
    const pool = pools.find(item => String(item.id) === poolKey(next));
    if (!pool) { add(issues, 'pool_required', '修改后的卡池不在真实目录中'); continue; }
    const previous = finalHistory.filter(row => realPaid(row) && poolKey(row) === poolKey(next) && Date.parse(row.timestamp) < Date.parse(next.timestamp));
    const result = realPaid(next) ? validatePullAgainstRules({ newPull: next, existingPulls: previous, allLimitedPoolPulls: finalHistory.filter(realPaid), pools, pool }) : { errors: [], warnings: [] };
    result.errors.forEach(message => add(issues, 'history_rule_violation', message, { recordId: change.recordId }));
    result.warnings.forEach(message => add(warnings, 'history_rule_warning', message, { recordId: change.recordId }));
    if (pool.type?.includes('weapon') && next.batchId) {
      const batch = finalHistory.filter(row => realPaid(row) && row.batchId === next.batchId && poolKey(row) === poolKey(next));
      if (batch.length === 10) validateBatchAgainstRules({ batchData: batch, existingPulls: previous.filter(row => row.batchId !== next.batchId), pools, pool }).errors.forEach(message => add(issues, 'weapon_batch_rule', message));
    }
  }
  const affected = new Set(historyChanges.flatMap(change => [change.currentPoolId, change.changes.poolId].filter(Boolean)));
  for (const id of affected) {
    const pool = pools.find(item => String(item.id) === String(id));
    if (!pool) continue;
    const records = finalHistory.filter(row => poolKey(row) === String(id)).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || String(a.seqId ?? a.seq_id ?? a.id).localeCompare(String(b.seqId ?? b.seq_id ?? b.id), undefined, { numeric: true }));
    if (!records.length) continue;
    const paidRecords = records.filter(realPaid);
    const result = validateBatchAgainstRules({ batchData: paidRecords, existingPulls: [], allLimitedPoolPulls: finalHistory, pools, pool });
    result.errors.forEach(message => add(issues, 'history_downstream_rule', message, { poolId: id }));
    if (resolvePoolCapabilities(pool).basePoolType !== 'weapon') {
      let pity = 0;
      for (const row of paidRecords) {
        pity = Number(row.rarity) === 6 ? 0 : pity + 1;
        if (pity >= resolvePoolCapabilities(pool).rules.sixStarPity) { add(issues, 'history_six_star_tail', '修改后的真实记录中，已达到六星保底但没有六星', { poolId: id }); break; }
      }
    }
    checks.push({ code: 'history_after_image_checked', poolId: id, message: '已检查修改后该池的保底与批次影响', status: 'checked' });
  }
  const unique = list => [...new Map(list.map(item => [JSON.stringify([item.code, item.entryId, item.poolId, item.recordId, item.message]), item])).values()];
  return { valid: issues.length === 0, issues: unique(issues), warnings: unique(warnings), checks, rulesVersion: WORKBENCH_RULES_VERSION };
}
