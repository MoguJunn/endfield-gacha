import { CONTRIBUTOR_DEMO_USER } from './contributorDemoMode.js';
import { getContributorDemoRuntimeHistory } from './contributorDemoRuntimeData.js';
import { getContributorDemoSandboxSnapshot } from './contributorDemoSandboxStore.js';
import { buildStoredPoolObservations, getStoredObservationAccounts } from '../utils/storedPoolObservations.js';
import { buildGroupPoolObservations } from '../utils/groupPoolObservations.js';
import { prepareScopedLegacyStatistics } from '../utils/scopedLegacyStatistics.js';
import { resolvePoolCapabilities } from '../utils/poolCapabilities.js';
import { STATISTICS_GROUPS, getStatisticsGroupPools, normalizeStatisticsPool } from '../../shared/statisticsScopes.js';

let cached = null;

function getStatistics() {
  const snapshot = getContributorDemoSandboxSnapshot();
  if (cached?.revision === snapshot.revision) return cached;
  const history = getContributorDemoRuntimeHistory();
  const pools = snapshot.pools.map(normalizeStatisticsPool);
  const accounts = getStoredObservationAccounts(history);
  const legacy = prepareScopedLegacyStatistics({ history, pools, characters: snapshot.characters });
  const scopes = {};
  const legacyScopes = {};
  const groupScopes = {};
  for (const accountKey of ['', ...accounts.map((account) => account.key)]) {
    scopes[accountKey] = {};
    legacyScopes[accountKey] = {};
    groupScopes[accountKey] = {};
    for (const pool of pools) {
      const catalog = (snapshot.poolCharacters[pool.id] || []).map((row) => ({
        ...row.characters, is_up: row.is_up,
      }));
      scopes[accountKey][pool.id] = buildStoredPoolObservations({ history, poolId: pool.id,
        accountKey: accountKey || null, catalog, directory: snapshot.characters,
        entityType: resolvePoolCapabilities(pool).entityType });
      legacyScopes[accountKey][pool.id] = legacy.build({ memberPoolIds: [pool.id], accountKey: accountKey || null });
    }
    for (const group of STATISTICS_GROUPS) {
      groupScopes[accountKey][group.key] = {
        observations: buildGroupPoolObservations({ history, pools, groupKey: group.key,
          directory: snapshot.characters, accountKey: accountKey || null }),
        legacy: legacy.build({ memberPoolIds: getStatisticsGroupPools(pools, group.key).map((pool) => pool.id),
          accountKey: accountKey || null }),
      };
    }
  }
  const updatedAt = new Date().toISOString();
  cached = { revision: snapshot.revision, data: { pools, accounts, scopes, legacyScopes, groupScopes },
    meta: { source: 'contributor-local-sandbox', ownerId: CONTRIBUTOR_DEMO_USER.id, truncated: false,
      updatedAt, nextRefreshAt: new Date(Date.now() + 3600000).toISOString(), refreshIntervalMinutes: 60 } };
  return cached;
}

export function getContributorDemoPersonalStatistics() {
  const { data, meta } = getStatistics();
  return structuredClone({ success: true, data, meta });
}

export function getContributorDemoPublicStatistics(type, scope) {
  const { data, meta } = getStatistics();
  if (type === 'pools') return structuredClone({ success: true, data: { pools: data.pools } });
  if (type === 'pool_counts') return { success: true, data: { counts: Object.fromEntries(
    data.pools.map((pool) => [pool.id, data.scopes[''][pool.id].total])
  ) } };
  const selected = type === 'group_statistics' ? data.groupScopes[''][scope?.groupKey]
    : type === 'pool_observations' ? { observations: data.scopes[''][scope?.poolId], legacy: data.legacyScopes[''][scope?.poolId] } : null;
  if (!selected?.observations) throw new Error('Unknown sandbox statistics scope');
  return structuredClone({ success: true, data: { ...selected, meta } });
}
