import { prepareStoredPoolObservations, getStoredObservationAccounts, storedAccountKey } from '../../src/utils/storedPoolObservations.js';
import { buildSummaryStats } from '../../src/utils/summaryStats.js';
import { resolvePoolCapabilities } from '../../src/utils/poolCapabilities.js';
import { formatAccountGachaHistoryRows } from '../../src/utils/accountGachaHistoryFormat.js';
import { resolveCharacterAliasMap, resolvePoolAliasMap } from '../../shared/idAliasService.js';
import { getHistoryRecordAccountKey } from '../../src/utils/gameAccountMetadata.js';
import { buildCharacterCatalogRows } from '../../src/utils/quotaEconomy.js';
import { annotateInfoBookPulls } from '../../src/utils/historyInfoBook.js';
import { normalizeIsStandard } from '../../src/utils/poolUtils.js';
import { buildLimitedCrossPoolPityMap, buildTimelineAcquisitionIndex } from '../../src/utils/poolTimelineView.js';
import { buildGroupPoolObservations } from '../../src/utils/groupPoolObservations.js';
import { prepareScopedLegacyStatistics } from '../../src/utils/scopedLegacyStatistics.js';
import { STATISTICS_GROUPS, getStatisticsGroupPools, normalizeStatisticsPool } from '../../shared/statisticsScopes.js';

export async function buildPersonalStatisticsSnapshot(db, userId, { signal } = {}) {
  const rows = [];
  const { count, error: countError } = await db.from('history').select('id', { head: true, count: 'exact' }).eq('user_id', userId).abortSignal(signal);
  if (countError || !Number.isInteger(count)) throw new Error('Cannot read complete personal statistics history');
  for (let start = 0; start < count; start += 1000) {
    const end = Math.min(start + 999, count - 1);
    const { data, error } = await db.from('history').select('*').eq('user_id', userId).order('id').range(start, end).abortSignal(signal);
    if (error || data?.length !== end - start + 1) throw new Error('Personal history changed during calculation');
    rows.push(...data);
  }
  const [poolAliasMap, characterAliasMap] = await Promise.all([
    resolvePoolAliasMap(db, rows.map((row) => row.pool_id)), resolveCharacterAliasMap(db, rows.map((row) => row.character_id)),
  ]);
  const history = formatAccountGachaHistoryRows(rows, { poolAliasMap, characterAliasMap });
  rows.length = 0;
  const ids = [...new Set(history.map((row) => row.poolId))];
  const { data: visiblePools, error: visibleError } = await db.rpc('get_app_visible_pools').abortSignal(signal);
  const { data: poolRows, error: poolError } = ids.length ? await db.from('pools').select('*').in('pool_id', ids).abortSignal(signal) : { data: [] };
  const { data: characters, error: characterError } = await db.from('characters').select('*').abortSignal(signal);
  if (poolError || characterError || visibleError || !Array.isArray(visiblePools)) throw new Error('Personal catalog unavailable');
  const pools = [...new Map([...visiblePools, ...poolRows].map(normalizeStatisticsPool).map((pool) => [pool.id, pool])).values()];
  const accounts = getStoredObservationAccounts(history);
  const { data: ranking, error: rankingError } = await db.rpc('get_user_ranking_stats', { p_user_id: userId }).abortSignal(signal);
  if (rankingError) throw new Error('Personal ranking calculation failed');
  const scopes = {};
  const groupScopes = {};
  const legacyScopes = {};
  const accountKeys = ['', ...accounts.map((account) => account.key)];
  const accountHistories = Map.groupBy(history, storedAccountKey);
  for (const key of accountKeys) scopes[key] = {};
  // Normalize once per entity type, not once per pool × account. Each reader is
  // discarded before creating the next; only the public DTOs are retained.
  for (const [entityType, typePools] of Map.groupBy(pools, (pool) => resolvePoolCapabilities(pool).entityType)) {
    const read = prepareStoredPoolObservations({ history, directory: characters, entityType });
    for (const key of accountKeys) for (const pool of typePools) scopes[key][pool.id] = read(pool.id, key || null);
  }
  const legacy = prepareScopedLegacyStatistics({ history, pools, characters });
  for (const key of accountKeys) {
    legacyScopes[key] = Object.fromEntries(pools.map((pool) => [pool.id, legacy.build({ memberPoolIds: [pool.id], accountKey: key || null })]));
    groupScopes[key] = Object.fromEntries(STATISTICS_GROUPS.map((group) => {
      const members = getStatisticsGroupPools(pools, group.key);
      return [group.key, { observations: buildGroupPoolObservations({ history: key ? accountHistories.get(key) || [] : history, pools, groupKey: group.key, directory: characters, accountKey: key || null }),
        legacy: legacy.build({ memberPoolIds: members.map((pool) => pool.id), accountKey: key || null }) }];
    }));
  }
  const poolById = new Map(pools.map((pool) => [pool.id, pool]));
  const historyByAccount = Map.groupBy(history, getHistoryRecordAccountKey);
  const catalogs = {};
  for (const [key, accountRows] of historyByAccount) {
    const timeline = annotateInfoBookPulls(accountRows, pools).map((row) => {
      const pool = poolById.get(row.poolId);
      return { ...row, isStandard: normalizeIsStandard(row, pool?.type, pool?.up_character) };
    });
    const limitedIds = new Set(pools.filter((pool) => ['limited', 'limited_character'].includes(pool.type)).map((pool) => pool.id));
    const crossPoolPityMap = buildLimitedCrossPoolPityMap(timeline.filter((row) => limitedIds.has(row.poolId)));
    catalogs[key] = Object.fromEntries(['zh-CN', 'en-US'].map((locale) => [locale, buildCharacterCatalogRows({ history: timeline,
      pools, characters, ranking, acquisitionIndex: buildTimelineAcquisitionIndex({ pools, history: timeline, crossPoolPityMap, locale }) })]));
  }
  return { accounts, pools: pools.map((pool) => ({ id: pool.id, name: pool.name, name_en: pool.name_en, type: pool.type,
    up_character: pool.up_character, start_time: pool.start_time, end_time: pool.end_time, isLimitedWeapon: pool.isLimitedWeapon,
    extra_subtype: pool.extra_subtype, extra_rule_profile: pool.extra_rule_profile, extra_series_key: pool.extra_series_key,
    extra_series_phase: pool.extra_series_phase, featured_characters: pool.featured_characters })), scopes, groupScopes, legacyScopes,
    ranking, catalogs, summary: buildSummaryStats({ history, pools, characters, user: { id: userId } }) };
}
