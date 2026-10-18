import { buildStoredPoolObservations, storedAccountKey } from '../../src/utils/storedPoolObservations.js';
import { buildGroupPoolObservations } from '../../src/utils/groupPoolObservations.js';
import { buildScopedLegacyStatistics } from '../../src/utils/scopedLegacyStatistics.js';
import { resolvePoolCapabilities } from '../../src/utils/poolCapabilities.js';
import { getStatisticsGroup, getStatisticsGroupPools, normalizeStatisticsPool, statisticsMemberSignature } from '../../shared/statisticsScopes.js';
import { prepareStatisticsContinuity } from '../../src/utils/statisticsContinuity.js';
import { readStatisticsHistoryGaps } from './statisticsHistoryGaps.js';

const PREPARED_CONTINUITY = Symbol('prepared-statistics-continuity');

function compactHistoryReader() {
  const strings = new Map();
  const intern = (value) => {
    if (value == null) return value;
    const key = String(value);
    if (!strings.has(key)) strings.set(key, key);
    return strings.get(key);
  };
  return ([id, record_id, user_id, game_uid, server_scope, pool_id, pool_version, character_id,
    character_name, rarity, timestamp, seq_id, is_new, is_free, is_info_book, special_type]) => ({
    id, record_id, user_id: intern(user_id), game_uid: intern(game_uid), server_scope: intern(server_scope),
    pool_id: intern(pool_id), pool_version, character_id: intern(character_id), character_name: character_id ? '' : intern(character_name),
    rarity, timestamp: typeof timestamp === 'number' ? timestamp : Date.parse(timestamp), seq_id,
    is_new, is_free, is_info_book, special_type });
}

async function readRows(db, poolIds, lastId, signal, accept = () => true, { beforeRead = async () => {}, onProgress = () => {} } = {}) {
  if (lastId == null) return [];
  await beforeRead();
  const { data: count, error } = await db.rpc('read_statistics_history_count', {
    p_pool_ids: poolIds, p_upper: lastId,
  }).abortSignal(signal);
  if (error || !Number.isInteger(count)) throw Object.assign(new Error('Cannot count complete statistics context'), { code: error?.code });
  if (!count) return [];
  onProgress({ phase: 'history-counted', rows: count });
  // Read one compact 10,000-row page at a time: fewer gateway/JSON round trips and no
  // competing database readers. The fixed bound and exact count stay enforced.
  const compact = compactHistoryReader();
  let scanned = 0, after = 0, pages = 0;
  const rows = [];
  while (after < Number(lastId)) {
    await beforeRead();
    const { data, error: readError } = await db.rpc('read_statistics_history_compact_page', {
      p_pool_ids: poolIds, p_after: after, p_upper: lastId, p_limit: 10000,
    }).abortSignal(signal);
    if (readError) throw Object.assign(new Error(signal?.aborted ? 'Statistics read deadline exceeded' : 'Cannot read complete statistics context'),
      { code: readError.code, name: signal?.aborted ? 'TimeoutError' : 'Error' });
    if (!Array.isArray(data)) throw new Error('Statistics context changed during reading');
    if (!data.length) break;
    const next = Number(data.at(-1)?.[0]);
    if (!(next > after && next <= Number(lastId))) throw new Error('Invalid statistics page order');
    scanned += data.length;
    for (const tuple of data) {
      if (!Array.isArray(tuple) || tuple.length !== 16) throw new Error('Invalid statistics compact page');
      const row = compact(tuple);
      if (accept(row)) rows.push(row);
    }
    after = next;
    pages++;
    if (pages % 20 === 0) onProgress({ phase: 'history-reading', rows: scanned, expectedRows: count });
  }
  if (scanned !== count) throw new Error('Statistics context changed during reading');
  return rows;
}

/** Public reports select only public pools, and load complete contributing-account context
 * for inherited pity and copy-sensitive resource attribution. All reads run in the worker. */
export async function readStatisticsScopeAggregate(db, scope, { signal, onProgress = () => {}, dataset = null } = {}) {
  if (dataset) {
    if (!dataset[PREPARED_CONTINUITY]) dataset = { ...dataset, history: prepareStatisticsContinuity({ history: dataset.history, pools: dataset.contextPools,
      exclusions: dataset.exclusions || [] }).history };
    const groupKey = scope.startsWith('group:') ? scope.slice(6) : null;
    if (groupKey && !getStatisticsGroup(groupKey)) throw new Error('Unknown statistics group');
    const members = groupKey ? getStatisticsGroupPools(dataset.pools, groupKey) : dataset.pools.filter((pool) => pool.id === scope.slice(5));
    if (!groupKey && !members.length) throw new Error('Unknown statistics pool');
    const ids = new Set(members.map((pool) => pool.id));
    const scopedRows = dataset.history.filter((row) => ids.has(row.pool_id));
    const accounts = new Set(scopedRows.map(storedAccountKey).filter(Boolean));
    const needsCharacters = members.some((pool) => resolvePoolCapabilities(pool).entityType === 'character');
    const contextIds = new Set(needsCharacters ? dataset.contextPools.filter((pool) => resolvePoolCapabilities(pool).entityType === 'character').map((pool) => pool.id) : ids);
    const history = dataset.history.filter((row) => ids.has(row.pool_id) || contextIds.has(row.pool_id) && accounts.has(storedAccountKey(row)));
    return computeScopePayload({ ...dataset, members, groupKey, scopedRows, history });
  }
  const { data: visible, error: poolError } = await db.rpc('get_app_visible_pools').abortSignal(signal);
  if (poolError || !Array.isArray(visible)) throw new Error('Public statistics catalog unavailable');
  const pools = visible.map(normalizeStatisticsPool);
  const groupKey = scope.startsWith('group:') ? scope.slice(6) : null;
  if (groupKey && !getStatisticsGroup(groupKey)) throw new Error('Unknown statistics group');
  const members = groupKey ? getStatisticsGroupPools(pools, groupKey) : pools.filter((pool) => pool.id === scope.slice(5));
  if (!groupKey && !members.length) throw new Error('Unknown statistics pool');
  const memberIds = members.map((pool) => pool.id);
  const { data: directory, error: directoryError } = await db.from('characters').select('*').abortSignal(signal);
  if (directoryError) throw new Error('Public statistics directory unavailable');
  const { data: contextCatalog, error: contextError } = await db.from('pools').select('*').abortSignal(signal);
  if (contextError || !Array.isArray(contextCatalog)) throw new Error('Statistics history context catalog unavailable');
  const contextPools = contextCatalog.map(normalizeStatisticsPool);
  // Only capture an upper bound here. Sorting the security-barrier statistics
  // view scans all eligible rows; the raw primary key needs just its last entry.
  // Counts and every outcome page still use the trusted statistics filters.
  const { data: newest, error: newestError } = await db.from('history').select('id').order('id', { ascending: false }).limit(1).abortSignal(signal);
  if (newestError) throw newestError;
  const lastId = newest?.[0]?.id;
  const scopedRows = memberIds.length ? await readRows(db, memberIds, lastId, signal) : [];
  onProgress({ phase: 'scope-read', rows: scopedRows.length });
  const accountKeys = new Set(scopedRows.map(storedAccountKey).filter(Boolean));
  // Scope rows are already complete. Fetch only other pools as context, avoiding
  // downloading the largest (limited-operator) scope twice.
  const history = scopedRows.slice();
  // Character copy quotas and inherited character pity require all character
  // periods. Weapon quotas are per result and weapon pity is pool-local, so no
  // other weapon period can change these metrics. Scan context by pool/ID once
  // and retain only contributing accounts, avoiding repeated sparse-owner scans.
  const needsCharacterContext = members.some((pool) => resolvePoolCapabilities(pool).entityType === 'character');
  const otherIds = needsCharacterContext ? contextPools.filter((pool) => resolvePoolCapabilities(pool).entityType === 'character'
    && !memberIds.includes(pool.id)).map((pool) => pool.id) : [];
  if (otherIds.length && accountKeys.size) {
    const context = await readRows(db, otherIds, lastId, signal, (row) => accountKeys.has(storedAccountKey(row)));
    for (const row of context) history.push(row);
  }
  onProgress({ phase: 'context-read', rows: history.length });
  const exclusions = await readStatisticsHistoryGaps(db, { signal });
  const trustedHistory = prepareStatisticsContinuity({ history, pools: contextPools, exclusions }).history;
  return computeScopePayload({ pools, contextPools, directory, members, groupKey, scopedRows, history: trustedHistory });
}

function computeScopePayload({ pools, contextPools, directory, members, groupKey, scopedRows, history }) {
  const memberIds = members.map((pool) => pool.id);
  // Keep invalid-identity records in observations so exclusion counters remain accurate.
  const observations = groupKey
    ? buildGroupPoolObservations({ history: scopedRows, pools, groupKey, directory })
    : buildStoredPoolObservations({ history: scopedRows, poolId: members[0].id, directory, entityType: resolvePoolCapabilities(members[0]).entityType });
  const legacy = buildScopedLegacyStatistics({ history, pools: contextPools, characters: directory, memberPoolIds: memberIds });
  return { schemaVersion: 'scope-statistics-v1', scopeKind: groupKey ? 'group' : 'pool',
    ...(groupKey ? { groupKey } : { poolId: members[0].id }), observations, legacy,
    memberIds, memberSignature: statisticsMemberSignature(members),
    meta: { source: 'database', updatedAt: new Date().toISOString(), storedRows: scopedRows.length,
      contextRows: history.length, contextBasis: 'stored-account-history', prefixVerified: false } };
}

/** Complete context shared by previews and one worker run. The worker must
 * check the captured scope revision before reusing this data for a later job.
 * Raw rows stay in memory and are released when the worker process ends. */
export async function readStatisticsPreviewDataset(db, { signal, beforeRead, onProgress = () => {} } = {}) {
  const [{ data: visible, error: visibleError }, { data: catalog, error: catalogError }, { data: directory, error: directoryError }, { data: newest, error: newestError }] = await Promise.all([
    db.rpc('get_app_visible_pools').abortSignal(signal), db.from('pools').select('*').abortSignal(signal),
    db.from('characters').select('*').abortSignal(signal), db.from('history').select('id').order('id', { ascending: false }).limit(1).abortSignal(signal),
  ]);
  if (visibleError || catalogError || directoryError || newestError) throw new Error('Preview statistics context unavailable');
  const contextPools = catalog.map(normalizeStatisticsPool);
  const history = await readRows(db, contextPools.map((pool) => pool.id), newest?.[0]?.id, signal, () => true, { beforeRead, onProgress });
  const exclusions = await readStatisticsHistoryGaps(db, { signal });
  const trusted = prepareStatisticsContinuity({ history, pools: contextPools, exclusions }).history;
  return { pools: visible.map(normalizeStatisticsPool), contextPools, directory, history: trusted,
    exclusions, [PREPARED_CONTINUITY]: true };
}
