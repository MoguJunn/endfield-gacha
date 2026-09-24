import { buildStoredPoolObservations, storedAccountKey } from '../../src/utils/storedPoolObservations.js';
import { buildGroupPoolObservations } from '../../src/utils/groupPoolObservations.js';
import { buildScopedLegacyStatistics } from '../../src/utils/scopedLegacyStatistics.js';
import { resolvePoolCapabilities } from '../../src/utils/poolCapabilities.js';
import { getStatisticsGroup, getStatisticsGroupPools, normalizeStatisticsPool, statisticsMemberSignature } from '../../shared/statisticsScopes.js';

const FIELDS = 'id,record_id,user_id,game_uid,server_scope,server_id,region,pool_id,character_id,character_name,rarity,timestamp,seq_id,is_new,is_free,is_info_book,special_type';

function compactHistoryReader() {
  const strings = new Map();
  const intern = (value) => {
    if (value == null) return value;
    const key = String(value);
    if (!strings.has(key)) strings.set(key, key);
    return strings.get(key);
  };
  return (row) => ({ id: row.id, record_id: row.record_id, user_id: intern(row.user_id), game_uid: intern(row.game_uid),
    server_scope: intern(row.server_scope ?? row.server_id ?? row.region ?? 'unknown'), pool_id: intern(row.pool_id),
    character_id: intern(row.character_id), character_name: row.character_id ? '' : intern(row.character_name),
    rarity: row.rarity, timestamp: typeof row.timestamp === 'number' ? row.timestamp : Date.parse(row.timestamp), seq_id: row.seq_id,
    is_new: row.is_new, is_free: row.is_free, is_info_book: row.is_info_book, special_type: row.special_type });
}

async function readRows(db, filter, lastId, signal, accept = () => true) {
  if (lastId == null) return [];
  const { count, error } = await filter(db.from('history').select('id', { count: 'exact', head: true }).lte('id', lastId)).abortSignal(signal);
  if (error || !Number.isInteger(count)) throw new Error(`Cannot count complete statistics context (${error?.code || 'invalid-count'})`);
  if (!count) return [];
  // history.id is a positive SERIAL. Partition its fixed upper bound and page
  // by ID, avoiding deep OFFSET scans on the largest aggregate scope.
  const partitions = Math.min(8, Math.ceil(count / 1000));
  const width = Math.ceil(Number(lastId) / partitions);
  const compact = compactHistoryReader();
  let scanned = 0;
  const batches = await Promise.all(Array.from({ length: partitions }, async (_, index) => {
    let after = index * width;
    const upper = Math.min(Number(lastId), (index + 1) * width);
    const rows = [];
    while (after < upper) {
      const { data, error: readError } = await filter(db.from('history').select(FIELDS).gt('id', after).lte('id', upper))
        .order('id').limit(1000).abortSignal(signal);
      if (readError) throw new Error(signal?.aborted ? 'Statistics read deadline exceeded' : 'Cannot read complete statistics context');
      if (!Array.isArray(data)) throw new Error('Statistics context changed during reading');
      if (!data.length) break;
      const next = Number(data.at(-1).id);
      if (!(next > after && next <= upper)) throw new Error('Invalid statistics page order');
      scanned += data.length;
      for (const row of data) if (accept(row)) rows.push(compact(row));
      after = next;
      if (data.length < 1000) break;
    }
    return rows;
  }));
  const rows = batches.flat();
  if (scanned !== count) throw new Error('Statistics context changed during reading');
  return rows;
}

/** Public reports select only public pools, and load complete contributing-account context
 * for inherited pity and copy-sensitive resource attribution. All reads run in the worker. */
export async function readStatisticsScopeAggregate(db, scope, { signal, onProgress = () => {}, dataset = null } = {}) {
  if (dataset) {
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
  const { data: newest, error: newestError } = await db.from('history').select('id').order('id', { ascending: false }).limit(1).abortSignal(signal);
  if (newestError) throw newestError;
  const lastId = newest?.[0]?.id;
  const scopedRows = memberIds.length ? await readRows(db, (query) => query.in('pool_id', memberIds), lastId, signal) : [];
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
    const context = await readRows(db, (query) => query.in('pool_id', otherIds), lastId, signal, (row) => accountKeys.has(storedAccountKey(row)));
    for (const row of context) history.push(row);
  }
  onProgress({ phase: 'context-read', rows: history.length });
  return computeScopePayload({ pools, contextPools, directory, members, groupKey, scopedRows, history });
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

/** Preview-only caller keeps this complete read in memory across scope builds.
 * No raw rows are persisted; production jobs keep independent bounded reads. */
export async function readStatisticsPreviewDataset(db, { signal } = {}) {
  const [{ data: visible, error: visibleError }, { data: catalog, error: catalogError }, { data: directory, error: directoryError }, { data: newest, error: newestError }] = await Promise.all([
    db.rpc('get_app_visible_pools').abortSignal(signal), db.from('pools').select('*').abortSignal(signal),
    db.from('characters').select('*').abortSignal(signal), db.from('history').select('id').order('id', { ascending: false }).limit(1).abortSignal(signal),
  ]);
  if (visibleError || catalogError || directoryError || newestError) throw new Error('Preview statistics context unavailable');
  const contextPools = catalog.map(normalizeStatisticsPool);
  const history = await readRows(db, (query) => query.in('pool_id', contextPools.map((pool) => pool.id)), newest?.[0]?.id, signal);
  return { pools: visible.map(normalizeStatisticsPool), contextPools, directory, history };
}
