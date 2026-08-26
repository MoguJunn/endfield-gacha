import { resolvePoolCapabilities } from './poolCapabilities.js';

export const QUOTA_RESOURCE_KEYS = {
  aicQuota: 'aicQuota',
  bondQuota: 'bondQuota',
  endpointQuota: 'endpointQuota'
};

export const FULL_POTENTIAL_COPY_COUNT = 6;
export const MAX_POTENTIAL_LEVEL = FULL_POTENTIAL_COPY_COUNT - 1;

export const QUOTA_RULES = {
  characterFirstAicQuota: 30,
  sixStarDuplicateBondQuota: 50,
  fiveStarDuplicateBondQuota: 10,
  sixStarExcessEndpointQuota: 10,
  fiveStarExcessAicQuota: 20,
  fourStarExcessAicQuota: 5,
  weaponSixStarAicQuota: 50,
  weaponFiveStarAicQuota: 10,
  extraPullBondQuota: 1
};

export function createEmptyQuotaSummary() {
  return {
    aicQuotaDirect: 0,
    aicQuotaConvertible: 0,
    aicQuotaTotalPotential: 0,
    bondQuotaDirect: 0,
    endpointQuotaConvertible: 0,
    trustTokensGained: 0,
    excessTrustTokens: 0
  };
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNonNegativeInteger(value, fallback = 0) {
  return Math.max(Math.trunc(toNumber(value, fallback)), 0);
}

export function normalizePoolType(type) {
  if (type === 'extra') return 'extra';
  if (type === 'limited' || type === 'limited_character') return 'limited';
  if (type === 'weapon' || type === 'limited_weapon') return 'weapon';
  if (type === 'standard' || type === 'standard_pool' || type === 'beginner') return 'standard';
  return 'standard';
}

function getRecordName(record) {
  return String(record?.character_name || record?.item_name || record?.characterName || record?.name || '').trim();
}

function getRecordTimestamp(record) {
  const value = record?.timestamp || record?.created_at || record?.time || 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : toNumber(record?.id, 0);
}

function getRecordId(record) {
  return record?.id || record?.record_id || record?.pullNumber || record?.seq_id || '';
}

function getRecordAcquisitionKey(record) {
  const value = record?.id || record?.record_id || null;
  return value == null ? null : String(value);
}

function isGiftRecord(record) {
  return record?.specialType === 'gift' || record?.special_type === 'gift';
}

function isFreeRecord(record) {
  return record?.isFree === true || record?.is_free === true || record?.isFreePull === true;
}

function isInfoBookRewardRecord(record) {
  return record?.isInfoBookPull === true;
}

function getPoolId(record) {
  return record?.poolId || record?.pool_id || record?.pool_id_raw || null;
}

function getRecordAccountKey(record) {
  return record?.game_uid || record?.gameUid || record?.account_uid || record?.accountUid || record?.user_id || record?.userId || 'default';
}

function getCharacterKey(character) {
  return character?.id || character?.name || null;
}

function normalizeNameForMatch(name) {
  return String(name || '').trim().toLowerCase();
}

function buildCharacterLookup(characters = []) {
  const byId = new Map();
  const byName = new Map();

  (Array.isArray(characters) ? characters : []).forEach((character) => {
    const key = getCharacterKey(character);
    if (key) byId.set(String(key), character);
    if (character?.name) byName.set(normalizeNameForMatch(character.name), character);
    if (Array.isArray(character?.aliases)) {
      character.aliases.forEach((alias) => {
        byName.set(normalizeNameForMatch(alias), character);
      });
    }
  });

  return { byId, byName };
}

function resolveCharacterForRecord(record, lookup) {
  const directId = record?.character_id || record?.characterId || null;
  if (directId && lookup.byId.has(String(directId))) {
    return lookup.byId.get(String(directId));
  }

  const name = getRecordName(record);
  return lookup.byName.get(normalizeNameForMatch(name)) || null;
}

function buildPoolCapabilitiesLookup(pools = []) {
  const lookup = new Map();
  (Array.isArray(pools) ? pools : []).forEach((pool) => {
    const capabilities = resolvePoolCapabilities(pool);
    [pool?.id, pool?.pool_id].forEach((poolId) => {
      if (poolId) {
        lookup.set(String(poolId), capabilities);
      }
    });
  });
  return lookup;
}

function buildPoolNameLookup(pools = []) {
  const lookup = new Map();
  (Array.isArray(pools) ? pools : []).forEach((pool) => {
    const poolName = pool?.name || pool?.pool_name || pool?.displayName || null;
    [pool?.id, pool?.pool_id].forEach((poolId) => {
      if (poolId && poolName) {
        lookup.set(String(poolId), poolName);
      }
    });
  });
  return lookup;
}

function resolveRecordPoolCapabilities(record, poolCapabilitiesLookup) {
  const poolId = getPoolId(record);
  if (poolId && poolCapabilitiesLookup.has(String(poolId))) {
    return poolCapabilitiesLookup.get(String(poolId));
  }

  const explicitType = record?.poolType || record?.pool_type || null;
  if (explicitType) {
    return resolvePoolCapabilities({
      id: poolId,
      type: explicitType,
      extra_rule_profile: record?.extra_rule_profile ?? record?.extraRuleProfile,
      extra_series_key: record?.extra_series_key ?? record?.extraSeriesKey,
    });
  }

  if (String(poolId || '').startsWith('weapon') || String(poolId || '').startsWith('wepon')) {
    return resolvePoolCapabilities({ id: poolId, type: 'weapon' });
  }

  if (String(poolId || '').startsWith('joint_') || String(poolId || '').startsWith('extra_')) {
    return resolvePoolCapabilities({ id: poolId, type: 'extra' });
  }

  if (String(poolId || '').startsWith('special_')) {
    return resolvePoolCapabilities({ id: poolId, type: 'limited' });
  }

  return resolvePoolCapabilities({ id: poolId, type: normalizePoolType(record?.type) });
}

function getPityScopeKey(record, poolType) {
  const poolId = getPoolId(record) || poolType || 'standard';
  return `${getRecordAccountKey(record)}:${poolId}`;
}

function createPullProgressState() {
  return {
    paidPulls: 0,
    sixStarPity: 0
  };
}

function isGuaranteedAcquisitionRecord(record) {
  return record?.specialType === 'guaranteed'
    || record?.special_type === 'guaranteed'
    || record?.isSpark === true
    || record?.isGuaranteed === true;
}

function normalizeAcquisitionPull(record, state, rarity, giftRecord, acquisitionMeta = null) {
  if (acquisitionMeta) {
    return {
      pulls: acquisitionMeta.kind === 'free' ? null : toNonNegativeInteger(acquisitionMeta.pulls),
      kind: acquisitionMeta.kind || 'normal',
      timelineElementId: acquisitionMeta.timelineElementId || null,
      timelineEntryId: acquisitionMeta.timelineEntryId || null,
      timelineSectionId: acquisitionMeta.timelineSectionId || null,
      poolId: acquisitionMeta.poolId || getPoolId(record) || null,
      poolName: acquisitionMeta.poolName || null
    };
  }

  if (giftRecord) {
    return {
      pulls: state?.paidPulls || toNonNegativeInteger(record?.pullNumber || record?.pull_number || record?.seqId || record?.seq_id),
      kind: 'cycle'
    };
  }

  if (isFreeRecord(record)) {
    return {
      pulls: null,
      kind: 'free'
    };
  }

  if (isGuaranteedAcquisitionRecord(record)) {
    return {
      pulls: state?.paidPulls || toNonNegativeInteger(record?.pullNumber || record?.pull_number || record?.seqId || record?.seq_id),
      kind: 'pity'
    };
  }

  return {
    pulls: rarity >= 6 ? (state?.sixStarPity || 0) : (state?.paidPulls || 0),
    kind: 'normal'
  };
}

function addQuota(target, addition) {
  target.aicQuotaDirect += toNonNegativeInteger(addition?.aicQuotaDirect);
  target.aicQuotaConvertible += toNonNegativeInteger(addition?.aicQuotaConvertible);
  target.aicQuotaTotalPotential += toNonNegativeInteger(addition?.aicQuotaTotalPotential);
  target.bondQuotaDirect += toNonNegativeInteger(addition?.bondQuotaDirect);
  target.endpointQuotaConvertible += toNonNegativeInteger(addition?.endpointQuotaConvertible);
  target.trustTokensGained += toNonNegativeInteger(addition?.trustTokensGained);
  target.excessTrustTokens += toNonNegativeInteger(addition?.excessTrustTokens);
  return target;
}

export function normalizeQuotaSummary(summary = {}) {
  const normalized = createEmptyQuotaSummary();
  addQuota(normalized, summary);
  normalized.aicQuotaTotalPotential = normalized.aicQuotaDirect + normalized.aicQuotaConvertible;
  return normalized;
}

export function calculateCharacterQuotaForCopy({ rarity, copyNumber }) {
  const normalizedRarity = toNonNegativeInteger(rarity);
  const normalizedCopyNumber = toNonNegativeInteger(copyNumber);
  const quota = createEmptyQuotaSummary();

  if (normalizedRarity < 4 || normalizedCopyNumber <= 0) {
    return quota;
  }

  if (normalizedCopyNumber === 1) {
    quota.aicQuotaDirect += QUOTA_RULES.characterFirstAicQuota;
    quota.aicQuotaTotalPotential = quota.aicQuotaDirect;
    return quota;
  }

  quota.trustTokensGained += 1;

  if (normalizedRarity >= 6) {
    quota.bondQuotaDirect += QUOTA_RULES.sixStarDuplicateBondQuota;
    if (normalizedCopyNumber > FULL_POTENTIAL_COPY_COUNT) {
      quota.endpointQuotaConvertible += QUOTA_RULES.sixStarExcessEndpointQuota;
      quota.excessTrustTokens += 1;
    }
  } else if (normalizedRarity === 5) {
    quota.bondQuotaDirect += QUOTA_RULES.fiveStarDuplicateBondQuota;
    if (normalizedCopyNumber > FULL_POTENTIAL_COPY_COUNT) {
      quota.aicQuotaConvertible += QUOTA_RULES.fiveStarExcessAicQuota;
      quota.excessTrustTokens += 1;
    }
  } else if (normalizedRarity === 4 && normalizedCopyNumber > FULL_POTENTIAL_COPY_COUNT) {
    quota.aicQuotaConvertible += QUOTA_RULES.fourStarExcessAicQuota;
    quota.excessTrustTokens += 1;
  }

  quota.aicQuotaTotalPotential = quota.aicQuotaDirect + quota.aicQuotaConvertible;
  return quota;
}

export function calculateWeaponQuotaForCopy({ rarity }) {
  const normalizedRarity = toNonNegativeInteger(rarity);
  const quota = createEmptyQuotaSummary();

  if (normalizedRarity >= 6) {
    quota.aicQuotaDirect = QUOTA_RULES.weaponSixStarAicQuota;
  } else if (normalizedRarity === 5) {
    quota.aicQuotaDirect = QUOTA_RULES.weaponFiveStarAicQuota;
  }

  quota.aicQuotaTotalPotential = quota.aicQuotaDirect;
  return quota;
}

export function calculateWeaponQuotaFromCounts(counts = {}) {
  const quota = createEmptyQuotaSummary();
  const sixStarCount = toNonNegativeInteger(counts[6] ?? counts['6']) + toNonNegativeInteger(counts['6_std']);
  const fiveStarCount = toNonNegativeInteger(counts[5] ?? counts['5']);

  quota.aicQuotaDirect = (
    sixStarCount * QUOTA_RULES.weaponSixStarAicQuota
    + fiveStarCount * QUOTA_RULES.weaponFiveStarAicQuota
  );
  quota.aicQuotaTotalPotential = quota.aicQuotaDirect;
  return quota;
}

function calculateExtraPullQuota() {
  const quota = createEmptyQuotaSummary();
  quota.bondQuotaDirect = QUOTA_RULES.extraPullBondQuota;
  return quota;
}

function createCharacterLedgerEntry(character, fallbackName, rarity) {
  const name = character?.name || fallbackName || '未知';
  return {
    id: getCharacterKey(character) || name,
    name,
    avatarUrl: character?.avatar_url || character?.avatarUrl || null,
    rarity: toNonNegativeInteger(character?.rarity ?? rarity, rarity),
    type: character?.type || 'character',
    isLimited: Boolean(character?.is_limited ?? character?.isLimited),
    releaseDate: character?.release_date || character?.releaseDate || null,
    acquisitionCount: 0,
    potentialLevel: 0,
    acquisitionPulls: [],
    trustTokensGained: 0,
    excessTrustTokens: 0,
    firstAcquiredAt: null,
    firstAcquiredPoolId: null,
    firstAcquiredPoolName: null,
    lastAcquiredAt: null,
    lastAcquiredPoolId: null,
    lastAcquiredPoolName: null,
    quota: createEmptyQuotaSummary()
  };
}

function finalizeCharacterEntry(entry) {
  const acquisitionCount = toNonNegativeInteger(entry.acquisitionCount);
  return {
    ...entry,
    owned: acquisitionCount > 0,
    potentialLevel: acquisitionCount > 0 ? Math.min(acquisitionCount - 1, MAX_POTENTIAL_LEVEL) : 0,
    acquisitionPulls: Array.isArray(entry.acquisitionPulls) ? entry.acquisitionPulls : [],
    trustTokensGained: Math.max(acquisitionCount - 1, 0),
    excessTrustTokens: Math.max(acquisitionCount - FULL_POTENTIAL_COPY_COUNT, 0),
    quota: normalizeQuotaSummary(entry.quota)
  };
}

export function buildQuotaLedgerFromHistory(history = [], {
  pools = [],
  characters = [],
  includePoolTypes = null,
  acquisitionIndex = null
} = {}) {
  const quota = createEmptyQuotaSummary();
  const weaponQuota = createEmptyQuotaSummary();
  const characterQuota = createEmptyQuotaSummary();
  const characterEntries = new Map();
  const lookup = buildCharacterLookup(characters);
  const poolCapabilitiesLookup = buildPoolCapabilitiesLookup(pools);
  const poolNameLookup = buildPoolNameLookup(pools);
  const acquisitionByRecordKey = acquisitionIndex instanceof Map
    ? acquisitionIndex
    : acquisitionIndex?.byRecordKey instanceof Map
      ? acquisitionIndex.byRecordKey
      : null;
  const pullProgressByScope = new Map();
  const allowedPoolTypes = Array.isArray(includePoolTypes)
    ? new Set(includePoolTypes.map(normalizePoolType))
    : null;

  const sortedHistory = [...(Array.isArray(history) ? history : [])].sort((left, right) => {
    const timeDiff = getRecordTimestamp(left) - getRecordTimestamp(right);
    if (timeDiff !== 0) return timeDiff;
    return String(getRecordId(left)).localeCompare(String(getRecordId(right)));
  });

  sortedHistory.forEach((record) => {
    const poolCapabilities = resolveRecordPoolCapabilities(record, poolCapabilitiesLookup);
    const poolType = poolCapabilities.basePoolType;
    if (allowedPoolTypes && !allowedPoolTypes.has(poolType)) {
      return;
    }
    const giftRecord = isGiftRecord(record);
    const progressKey = getPityScopeKey(record, poolType);
    if (!pullProgressByScope.has(progressKey)) {
      pullProgressByScope.set(progressKey, createPullProgressState());
    }
    const progressState = pullProgressByScope.get(progressKey);
    const countsTowardPity = !giftRecord && !isFreeRecord(record);
    if (countsTowardPity) {
      progressState.paidPulls += 1;
      progressState.sixStarPity += 1;
    }

    if (!giftRecord && poolCapabilities.bondQuotaPerPull && !isInfoBookRewardRecord(record)) {
      const extraPullQuota = calculateExtraPullQuota();
      addQuota(quota, extraPullQuota);
      addQuota(characterQuota, extraPullQuota);
    }

    const rarity = toNonNegativeInteger(record?.rarity);
    const name = getRecordName(record);
    if (!name || rarity < 4) {
      return;
    }

    const character = resolveCharacterForRecord(record, lookup);
    const itemType = character?.type || (poolCapabilities.entityType === 'weapon' ? 'weapon' : 'character');

    if (poolType === 'weapon' || itemType === 'weapon') {
      if (!giftRecord) {
        const copyQuota = calculateWeaponQuotaForCopy({ rarity });
        addQuota(quota, copyQuota);
        addQuota(weaponQuota, copyQuota);
      }
      if (countsTowardPity && rarity >= 6) {
        progressState.sixStarPity = 0;
      }
      return;
    }

    const key = getCharacterKey(character) || name;
    if (!characterEntries.has(key)) {
      characterEntries.set(key, createCharacterLedgerEntry(character, name, rarity));
    }

    const entry = characterEntries.get(key);
    entry.acquisitionCount += 1;
    entry.rarity = Math.max(toNonNegativeInteger(entry.rarity), rarity);
    const acquisitionMeta = acquisitionByRecordKey?.get(getRecordAcquisitionKey(record)) || null;
    entry.acquisitionPulls.push(normalizeAcquisitionPull(record, progressState, rarity, giftRecord, acquisitionMeta));

    const timestamp = record?.timestamp || record?.created_at || record?.time || null;
    const recordPoolId = acquisitionMeta?.poolId || getPoolId(record) || null;
    const recordPoolName = acquisitionMeta?.poolName || (recordPoolId ? poolNameLookup.get(String(recordPoolId)) : null) || null;
    if (!entry.firstAcquiredAt && timestamp) {
      entry.firstAcquiredAt = timestamp;
      entry.firstAcquiredPoolId = recordPoolId;
      entry.firstAcquiredPoolName = recordPoolName;
    }
    if (timestamp) {
      entry.lastAcquiredAt = timestamp;
      entry.lastAcquiredPoolId = recordPoolId;
      entry.lastAcquiredPoolName = recordPoolName;
    }

    if (!giftRecord) {
      const copyQuota = calculateCharacterQuotaForCopy({
        rarity,
        copyNumber: entry.acquisitionCount
      });
      addQuota(entry.quota, copyQuota);
      addQuota(quota, copyQuota);
      addQuota(characterQuota, copyQuota);
    }

    if (countsTowardPity && rarity >= 6) {
      progressState.sixStarPity = 0;
    }
  });

  const charactersByKey = Array.from(characterEntries.values())
    .map(finalizeCharacterEntry)
    .reduce((accumulator, entry) => {
      accumulator[entry.id] = entry;
      return accumulator;
    }, {});

  return {
    quota: normalizeQuotaSummary(quota),
    characterQuota: normalizeQuotaSummary(characterQuota),
    weaponQuota: normalizeQuotaSummary(weaponQuota),
    charactersByKey,
    characterRows: Object.values(charactersByKey)
  };
}

export function buildQuotaLedgerFromSimulatorStates(states = []) {
  const history = [];
  const pools = [];

  (Array.isArray(states) ? states : []).forEach((state, stateIndex) => {
    const poolId = state?.poolId || state?.id || `simulator-${stateIndex}`;
    const poolType = normalizePoolType(state?.poolType);
    pools.push({
      id: poolId,
      pool_id: poolId,
      type: poolType,
      extra_rule_profile: state?.extraRuleProfile || state?.extra_rule_profile || null,
      extra_series_key: state?.extraSeriesKey || state?.extra_series_key || null,
    });

    (Array.isArray(state?.pullHistory) ? state.pullHistory : []).forEach((record, recordIndex) => {
      history.push({
        ...record,
        id: record?.id || `${poolId}-${record?.pullNumber || recordIndex}`,
        poolId,
        pool_id: poolId,
        poolType,
        item_name: record?.item_name || record?.characterName || record?.name,
        character_name: record?.character_name || record?.characterName || record?.name
      });
    });
  });

  return buildQuotaLedgerFromHistory(history, { pools });
}

function mergeRankingInfoByName(ranking = {}) {
  const result = new Map();
  const sections = [
    ['extraUp', ranking?.extra?.sixStarUp || ranking?.extra?.sixStar || []],
    ['extraFive', ranking?.extra?.fiveStar || []],
    ['limitedUp', ranking?.limited?.sixStarUp || ranking?.limited?.sixStar || []],
    ['limitedOffStandard', ranking?.limited?.sixStarOff || []],
    ['limitedOffLimited', ranking?.limited?.sixStarOffLimited || []],
    ['limitedFive', ranking?.limited?.fiveStar || []],
    ['standardSix', ranking?.standard?.sixStar || []],
    ['standardFive', ranking?.standard?.fiveStar || []]
  ];

  sections.forEach(([section, entries]) => {
    (Array.isArray(entries) ? entries : []).forEach((entry, index) => {
      const key = normalizeNameForMatch(entry?.name);
      if (!key) return;
      const current = result.get(key) || [];
      current.push({
        section,
        rank: index + 1,
        count: toNonNegativeInteger(entry?.count)
      });
      result.set(key, current);
    });
  });

  return result;
}

export function attachRankingInfoToCatalogRows(catalog = null, ranking = null) {
  if (!catalog) {
    return catalog;
  }

  const rankingByName = mergeRankingInfoByName(ranking);
  const rows = Array.isArray(catalog.rows)
    ? catalog.rows
    : Array.isArray(catalog.characters)
      ? catalog.characters
      : [];

  return {
    ...catalog,
    rows: rows.map((row) => ({
      ...row,
      rankingInfo: rankingByName.get(normalizeNameForMatch(row?.name)) || []
    }))
  };
}

export function buildCharacterCatalogRows({
  history = [],
  pools = [],
  characters = [],
  ranking = null,
  acquisitionIndex = null
} = {}) {
  const catalogCharacters = (Array.isArray(characters) ? characters : [])
    .filter((character) => (character?.type || 'character') === 'character' && toNonNegativeInteger(character?.rarity) >= 4);
  const ledger = buildQuotaLedgerFromHistory(history, { pools, characters: catalogCharacters, acquisitionIndex });
  const rowsByKey = new Map();

  catalogCharacters.forEach((character) => {
    const key = getCharacterKey(character) || character.name;
    if (!key) return;
    rowsByKey.set(String(key), {
      ...finalizeCharacterEntry(createCharacterLedgerEntry(character, character.name, character.rarity)),
      id: String(key)
    });
  });

  Object.values(ledger.charactersByKey).forEach((entry) => {
    rowsByKey.set(String(entry.id), entry);
  });

  const rankingByName = mergeRankingInfoByName(ranking);
  const rows = Array.from(rowsByKey.values()).map((row) => ({
    ...row,
    dataSource: 'local',
    rankingInfo: rankingByName.get(normalizeNameForMatch(row.name)) || []
  }));

  const ownedCount = rows.filter((row) => row.owned).length;
  const fullPotentialCount = rows.filter((row) => row.potentialLevel >= MAX_POTENTIAL_LEVEL).length;
  const summary = rows.reduce((accumulator, row) => {
    addQuota(accumulator.quota, row.quota);
    accumulator.excessTrustTokens += toNonNegativeInteger(row.excessTrustTokens);
    return accumulator;
  }, {
    totalCharacters: rows.length,
    ownedCharacters: ownedCount,
    unownedCharacters: Math.max(rows.length - ownedCount, 0),
    ownershipRate: rows.length > 0 ? ownedCount / rows.length : 0,
    fullPotentialCharacters: fullPotentialCount,
    quota: createEmptyQuotaSummary(),
    excessTrustTokens: 0
  });

  summary.quota = normalizeQuotaSummary(ledger.characterQuota || summary.quota);

  return {
    rows,
    summary,
    ledger
  };
}

export function normalizeGlobalCharacterCatalog(rawCatalog = null, ranking = null) {
  const rows = (Array.isArray(rawCatalog?.characters) ? rawCatalog.characters : [])
    .filter((row) => toNonNegativeInteger(row?.rarity) >= 4);
  const rankingByName = mergeRankingInfoByName(ranking);

  return {
    totalContributors: toNonNegativeInteger(rawCatalog?.totalContributors),
    summary: {
      totalCharacters: toNonNegativeInteger(rawCatalog?.summary?.totalCharacters ?? rows.length),
      ownedCharacters: toNonNegativeInteger(rawCatalog?.summary?.ownedCharacters),
      unownedCharacters: toNonNegativeInteger(rawCatalog?.summary?.unownedCharacters),
      ownershipRate: toNumber(rawCatalog?.summary?.ownershipRate),
      fullPotentialCharacters: toNonNegativeInteger(rawCatalog?.summary?.fullPotentialCharacters),
      quota: normalizeQuotaSummary(rawCatalog?.summary?.quotaAggregate || rawCatalog?.summary?.quota),
      characterQuota: normalizeQuotaSummary(rawCatalog?.summary?.characterQuotaAggregate || rawCatalog?.summary?.characterQuota),
      weaponQuota: normalizeQuotaSummary(rawCatalog?.summary?.weaponQuotaAggregate || rawCatalog?.summary?.weaponQuota),
      excessTrustTokens: toNonNegativeInteger(rawCatalog?.summary?.excessTrustTokens)
    },
    rows: rows.map((row) => ({
      id: row.id || row.name,
      name: row.name,
      avatarUrl: row.avatarUrl || row.avatar_url || null,
      rarity: toNonNegativeInteger(row.rarity),
      type: row.type || 'character',
      isLimited: Boolean(row.isLimited ?? row.is_limited),
      releaseDate: row.releaseDate || row.release_date || null,
      ownerUsers: toNonNegativeInteger(row.ownerUsers),
      unownedUsers: toNonNegativeInteger(row.unownedUsers),
      ownershipRate: toNumber(row.ownershipRate),
      fullPotentialUsers: toNonNegativeInteger(row.fullPotentialUsers),
      fullPotentialRateOfOwners: toNumber(row.fullPotentialRateOfOwners),
      fullPotentialRateOfContributors: toNumber(row.fullPotentialRateOfContributors),
      totalCopies: toNonNegativeInteger(row.totalCopies),
      avgCopiesPerOwner: toNumber(row.avgCopiesPerOwner),
      copyDistribution: row.copyDistribution || {},
      quota: normalizeQuotaSummary(row.quotaAggregate || row.quota),
      dataSource: 'global',
      rankingInfo: rankingByName.get(normalizeNameForMatch(row.name)) || []
    }))
  };
}

export default {
  QUOTA_RESOURCE_KEYS,
  FULL_POTENTIAL_COPY_COUNT,
  MAX_POTENTIAL_LEVEL,
  QUOTA_RULES,
  createEmptyQuotaSummary,
  normalizeQuotaSummary,
  calculateCharacterQuotaForCopy,
  calculateWeaponQuotaForCopy,
  calculateWeaponQuotaFromCounts,
  buildQuotaLedgerFromHistory,
  buildQuotaLedgerFromSimulatorStates,
  buildCharacterCatalogRows,
  attachRankingInfoToCatalogRows,
  normalizeGlobalCharacterCatalog
};
