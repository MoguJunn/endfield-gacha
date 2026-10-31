import { statisticsScopeKey } from '../../shared/statisticsEligibility.js';
import { resolvePoolCapabilities } from './poolCapabilities.js';
import {
  buildOneTimeTargetGuaranteeState,
  getHistoryRecordKey,
  getPoolScopeKind,
  getPoolSeriesStateKey,
} from './poolScopedHistory.js';

const recordKey = record => JSON.stringify([statisticsScopeKey(record), getHistoryRecordKey(record)]);
const accountKey = record => JSON.stringify([
  record.user_id ?? record.userId ?? '',
  String(record.game_uid ?? record.gameUid ?? '').trim(),
  record.server_scope ?? record.serverScope ?? record.server_id ?? record.serverId ?? '',
]);

/** Infer guarantees from paid history as imported records need not carry a flag. */
export function buildWinRateGuaranteeKeys({ history = [], pools = [] } = {}) {
  const accounts = new Map();
  for (const record of history) {
    const key = accountKey(record);
    if (!accounts.has(key)) accounts.set(key, []);
    accounts.get(key).push(record);
  }
  const keys = new Set();
  const visited = new Set();
  for (const pool of pools.filter(Boolean)) {
    const capabilities = resolvePoolCapabilities(pool);
    if (capabilities.targetMode !== 'single-up' || !capabilities.rules?.guaranteedLimitedPity) continue;
    const scope = getPoolScopeKind(pool, 'target') === 'series'
      ? getPoolSeriesStateKey(pool) : pool.id || pool.pool_id;
    if (visited.has(scope)) continue;
    visited.add(scope);
    for (const records of accounts.values()) {
      const state = buildOneTimeTargetGuaranteeState({ history: records, pools, pool });
      for (const record of state.timeline) {
        if (state.guaranteedRecordKeys.has(getHistoryRecordKey(record))) keys.add(recordKey(record));
      }
    }
  }
  return keys;
}

export function isExcludedFromWinRate(record, pool, guaranteeKeys = new Set()) {
  const capabilities = pool?.rulesKey && pool?.rules ? pool : resolvePoolCapabilities(pool);
  if (capabilities.entityType !== 'character' || capabilities.targetMode !== 'single-up' || !capabilities.rules?.guaranteedLimitedPity) return false;
  return record?.specialType === 'guaranteed' || record?.special_type === 'guaranteed'
    || record?.isGuaranteed === true || record?.is_guaranteed === true
    || record?.isSpark === true || record?.is_spark === true
    || guaranteeKeys.has(recordKey(record));
}

export function isInferredTargetGuarantee(record, guaranteeKeys) {
  return guaranteeKeys.has(recordKey(record));
}
