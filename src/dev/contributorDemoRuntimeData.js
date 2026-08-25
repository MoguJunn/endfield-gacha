import { buildPersonalAnalysisSnapshots } from '../utils/personalAnalysisSnapshot.js';
import { CONTRIBUTOR_DEMO_USER } from './contributorDemoMode.js';
import { getContributorDemoSandboxSnapshot } from './contributorDemoSandboxStore.js';

export const CONTRIBUTOR_DEMO_ACCOUNT_KEY = 'demo-cn-001::server:1';
const DEMO_GAME_UID = 'demo-cn-001';
const DEMO_SERVER_SCOPE = '1';
const BASE_TIME = Date.parse('2026-08-27T12:00:00.000Z');

let runtimeCache = null;

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function isoAt(dayOffset, hourOffset = 0) {
  return new Date(BASE_TIME + ((dayOffset * 24 + hourOffset) * 60 * 60 * 1000)).toISOString();
}

function getExpectedType(pool = {}) {
  return pool.type === 'weapon' || pool.extra_subtype === 'reconstruction_claim' || pool.extra_rule_profile === 'reconstruction_weapon_v1'
    ? 'weapon'
    : 'character';
}

function chooseEntity({ pool, roster, characters, rarity, index }) {
  const expectedType = getExpectedType(pool);
  const rosterEntities = (Array.isArray(roster) ? roster : [])
    .map((row) => row.characters)
    .filter((item) => item?.type === expectedType && Number(item.rarity) === rarity);
  const catalogEntities = characters.filter((item) => item.type === expectedType && Number(item.rarity) === rarity);
  const candidates = rosterEntities.length > 0 ? rosterEntities : catalogEntities;
  if (candidates.length > 0) return candidates[index % candidates.length];
  return {
    id: `sandbox-${expectedType}-${rarity}-${index % 7}`,
    name: `${rarity}星${expectedType === 'weapon' ? '武器' : '角色'}`,
    type: expectedType,
    rarity,
    is_limited: false,
  };
}

function buildRuntimeHistory(snapshot) {
  const poolsWithRoster = snapshot.pools.filter((pool) => (
    Array.isArray(snapshot.poolCharacters[pool.pool_id || pool.id])
    && snapshot.poolCharacters[pool.pool_id || pool.id].length > 0
  ));
  const candidatePools = poolsWithRoster.length > 0 ? poolsWithRoster : snapshot.pools;
  const records = [];
  const pityByPool = new Map();

  for (let index = 0; index < 168; index += 1) {
    const pool = candidatePools[index % Math.max(candidatePools.length, 1)] || { id: 'standard', pool_id: 'standard', type: 'standard' };
    const poolId = pool.pool_id || pool.id;
    const pity = (pityByPool.get(poolId) || 0) + 1;
    const rarity = index % 37 === 36 ? 6 : index % 9 === 8 ? 5 : 4;
    pityByPool.set(poolId, rarity === 6 ? 0 : pity);
    const entity = chooseEntity({
      pool,
      roster: snapshot.poolCharacters[poolId],
      characters: snapshot.characters,
      rarity,
      index,
    });
    const isWeapon = entity.type === 'weapon';
    records.push({
      id: `sandbox-record-${String(index + 1).padStart(4, '0')}`,
      record_id: `sandbox-record-${String(index + 1).padStart(4, '0')}`,
      user_id: CONTRIBUTOR_DEMO_USER.id,
      game_uid: DEMO_GAME_UID,
      server_id: DEMO_SERVER_SCOPE,
      server_scope: DEMO_SERVER_SCOPE,
      region: 'cn',
      pool_id: poolId,
      rarity,
      character_id: entity.id,
      character_name: isWeapon ? null : entity.name,
      item_name: isWeapon ? entity.name : null,
      timestamp: isoAt(-42 + Math.floor(index / 4), index % 4),
      seq_id: String(index + 1),
      pity,
      is_standard: rarity === 6 && !entity.is_limited,
      is_free: index % 41 === 0,
      is_info_book: index % 53 === 0,
      is_new: rarity >= 5 && index < 60,
      special_type: index % 67 === 0 ? 'gift' : null,
      batch_id: `sandbox-batch-${Math.floor(index / 10) + 1}`,
      edit_version: 1,
    });
  }

  return records.sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
}

function getRuntimeData() {
  const snapshot = getContributorDemoSandboxSnapshot();
  if (runtimeCache?.revision === snapshot.revision) return runtimeCache;
  const history = buildRuntimeHistory(snapshot);
  const analysis = buildPersonalAnalysisSnapshots({
    history,
    pools: snapshot.pools,
    characters: snapshot.characters,
    userId: CONTRIBUTOR_DEMO_USER.id,
  });
  runtimeCache = {
    revision: snapshot.revision,
    snapshot,
    history,
    analysis,
  };
  return runtimeCache;
}

function projectScope(scope, viewKey, locale) {
  if (!scope || !viewKey) return scope;
  const view = scope.dashboard?.views?.[viewKey] || null;
  const timeline = scope.dashboard?.timelineViews?.[locale]?.[viewKey]
    || scope.dashboard?.timelineViews?.['zh-CN']?.[viewKey]
    || null;
  return {
    ...scope,
    dashboard: {
      views: view ? { [viewKey]: view } : {},
      timelineViews: Array.isArray(timeline) ? { [locale]: { [viewKey]: timeline } } : {},
    },
  };
}

export function getContributorDemoRuntimeHistory() {
  return clone(getRuntimeData().history);
}

export function getContributorDemoRuntimeAnalysis({ accountKey = '', viewKey = '', locale = 'zh-CN' } = {}) {
  const runtime = getRuntimeData();
  const selectedAccountKey = accountKey || runtime.analysis.owner.defaultAccountKey || CONTRIBUTOR_DEMO_ACCOUNT_KEY;
  const scope = runtime.analysis.scopes.find((item) => item.scopeKey === selectedAccountKey)
    || runtime.analysis.scopes[0];
  return clone({
    availability: 'ready',
    schemaVersion: 1,
    owner: runtime.analysis.owner,
    scope: projectScope(scope?.payload || null, viewKey, locale),
    source: 'contributor-local-sandbox',
    meta: {
      ownerId: CONTRIBUTOR_DEMO_USER.id,
      accountKey: scope?.scopeKey || selectedAccountKey,
      rawIncluded: false,
      verifiedEmpty: false,
      revision: `sandbox-${runtime.revision}`,
      scopeRevision: `sandbox-${runtime.revision}`,
      generatedAt: new Date().toISOString(),
      viewKey: viewKey || null,
      locale,
      readOnly: true,
      catalogSource: runtime.snapshot.catalogSource,
    },
    warnings: [{ code: 'contributor_local_sandbox' }],
  });
}

export function getContributorDemoRuntimeHistoryPage({ poolId = '', cursor = '', limit = 50 } = {}) {
  const history = getRuntimeData().history;
  const filtered = history.filter((record) => !poolId || record.pool_id === poolId);
  const offset = /^sandbox:(\d+)$/u.test(String(cursor || '')) ? Number(String(cursor).split(':')[1]) : 0;
  const pageLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const records = filtered.slice(offset, offset + pageLimit);
  const nextOffset = offset + records.length;
  return clone({
    records,
    page: {
      limit: pageLimit,
      nextCursor: nextOffset < filtered.length ? `sandbox:${nextOffset}` : null,
      hasMore: nextOffset < filtered.length,
      total: filtered.length,
      revision: `sandbox-${getRuntimeData().revision}`,
    },
    scope: {
      accountKey: CONTRIBUTOR_DEMO_ACCOUNT_KEY,
      gameUid: DEMO_GAME_UID,
      serverScope: DEMO_SERVER_SCOPE,
      region: 'cn',
      poolId: poolId || null,
    },
    source: 'contributor-local-sandbox',
    meta: { ownerId: CONTRIBUTOR_DEMO_USER.id, readOnly: true },
    warnings: [{ code: 'contributor_local_sandbox' }],
  });
}

export function invalidateContributorDemoRuntimeData() {
  runtimeCache = null;
}
