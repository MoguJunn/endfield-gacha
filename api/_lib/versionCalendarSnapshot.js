import { sanitizePublicCatalogResourceUrl } from '../../shared/publicCatalogDto.js';

const POOL_MAINTENANCE_SUFFIX = /\s*（前瞻(?:，[^）]*)?）\s*$/u;

const WEAPON_POOL_PATTERN = /(?:weapon|wepon|arsenal|武器|申领)/iu;

function normalizeLookupKey(value) {
  return String(value || '').trim().toLocaleLowerCase('zh-CN');
}

function getPoolSequenceKey(poolId) {
  return String(poolId || '')
    .replace(/^(?:special|joint|weaponbox|weponbox)_/iu, '')
    .replace(/^manual_(?:limited|weapon)_pool_/iu, 'manual_')
    .trim();
}

function buildCharacterLookup(characterRows = []) {
  const lookup = new Map();
  (Array.isArray(characterRows) ? characterRows : []).forEach((character) => {
    if (!character) return;
    const keys = [character.id, character.name, ...(Array.isArray(character.aliases) ? character.aliases : [])];
    keys.forEach((key) => {
      const normalizedKey = normalizeLookupKey(key);
      if (normalizedKey && !lookup.has(normalizedKey)) lookup.set(normalizedKey, character);
    });
  });
  return lookup;
}

function resolvePoolCharacterArtwork(poolRows = [], characterRows = []) {
  const characterLookup = buildCharacterLookup(characterRows);
  const pools = (Array.isArray(poolRows) ? poolRows : []).filter(Boolean);
  const operatorPools = pools.filter((pool) => !WEAPON_POOL_PATTERN.test(
    `${pool.type || ''} ${pool.pool_id || pool.id || ''} ${pool.name || ''}`,
  ));
  const operatorCharacter = new Map();

  const directArtwork = new Map();
  pools.forEach((pool) => {
    const featured = Array.isArray(pool.featured_characters) ? pool.featured_characters : [];
    const item = characterLookup.get(normalizeLookupKey(pool.up_character))
      || featured.map((value) => characterLookup.get(normalizeLookupKey(value))).find(Boolean)
      || null;
    if (item) directArtwork.set(pool.pool_id || pool.id, item);
  });

  operatorPools.forEach((pool) => {
    const character = directArtwork.get(pool.pool_id || pool.id) || null;
    if (character) operatorCharacter.set(pool.pool_id || pool.id, character);
  });

  const operatorBySequence = new Map();
  operatorPools.forEach((pool) => {
    const character = operatorCharacter.get(pool.pool_id || pool.id);
    const sequenceKey = getPoolSequenceKey(pool.pool_id || pool.id);
    if (character && sequenceKey && !operatorBySequence.has(sequenceKey)) {
      operatorBySequence.set(sequenceKey, character);
    }
  });

  const weaponOwnerByName = new Map();
  pools.forEach((pool) => {
    const typeHint = `${pool.type || ''} ${pool.pool_id || pool.id || ''} ${pool.name || ''}`;
    if (!WEAPON_POOL_PATTERN.test(typeHint)) return;
    const sequenceOwner = operatorBySequence.get(getPoolSequenceKey(pool.pool_id || pool.id));
    const weaponName = normalizeLookupKey(pool.up_character);
    if (sequenceOwner && weaponName && !weaponOwnerByName.has(weaponName)) {
      weaponOwnerByName.set(weaponName, sequenceOwner);
    }
  });

  return new Map(pools.map((pool) => {
    const poolId = pool.pool_id || pool.id;
    const typeHint = `${pool.type || ''} ${poolId || ''} ${pool.name || ''}`;
    let character = directArtwork.get(poolId) || operatorCharacter.get(poolId) || null;
    if (!character && WEAPON_POOL_PATTERN.test(typeHint)) {
      character = weaponOwnerByName.get(normalizeLookupKey(pool.up_character))
        || operatorBySequence.get(getPoolSequenceKey(poolId))
        || operatorPools
          .map((candidate) => ({
            candidate,
            distance: Math.abs(
              Date.parse(candidate.start_time || '') - Date.parse(pool.start_time || ''),
            ),
          }))
          .filter(({ distance }) => Number.isFinite(distance) && distance <= 36 * 60 * 60 * 1000)
          .sort((left, right) => left.distance - right.distance)
          .map(({ candidate }) => operatorCharacter.get(candidate.pool_id || candidate.id))
          .find(Boolean)
        || null;
    }
    return [poolId, character];
  }));
}

export function cleanPoolDisplayName(value) {
  return String(value || '').replace(POOL_MAINTENANCE_SUFFIX, '').trim();
}

export function sanitizeVersionCalendarSnapshot(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  return {
    versionKey: row.version_key || null,
    versionNumber: row.version_number || null,
    revision: Number(row.revision) || 1,
    title: row.title || null,
    startsAt: row.starts_at || null,
    endsAt: row.ends_at || null,
    content: row.content && typeof row.content === 'object' ? row.content : {},
    poolBindings: row.pool_bindings && typeof row.pool_bindings === 'object'
      ? row.pool_bindings
      : {},
    sourceMeta: row.source_meta && typeof row.source_meta === 'object'
      ? row.source_meta
      : {},
    publishedAt: row.published_at || null,
    updatedAt: row.updated_at || null,
  };
}

export function sanitizeVersionCalendarPool(row, backgroundCharacter = null) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const poolId = row.pool_id || row.id || null;
  const name = cleanPoolDisplayName(row.name);
  if (!poolId || !name) {
    return null;
  }

  const typeHint = `${row.type || ''} ${poolId} ${name}`;
  return {
    poolId,
    name,
    nameEn: row.name_en || null,
    type: WEAPON_POOL_PATTERN.test(typeHint) ? 'arsenal' : 'operator',
    startsAt: row.start_time || null,
    endsAt: row.end_time || null,
    bannerUrl: sanitizePublicCatalogResourceUrl(row.banner_url),
    upCharacter: row.up_character || null,
    backgroundCharacter: backgroundCharacter?.name || null,
    backgroundType: backgroundCharacter?.type || null,
    backgroundUrl: sanitizePublicCatalogResourceUrl(
      backgroundCharacter?.avatar_url || backgroundCharacter?.avatarUrl
    ),
    description: row.description || null,
    featuredCharacters: Array.isArray(row.featured_characters)
      ? row.featured_characters
      : [],
  };
}

function isPoolInsideVersion(pool, version) {
  const poolStart = Date.parse(pool.startsAt || '');
  const poolEnd = Date.parse(pool.endsAt || '');
  const versionStart = Date.parse(version.startsAt || '');
  const versionEnd = Date.parse(version.endsAt || '');

  if (!Number.isFinite(poolStart) || !Number.isFinite(versionStart)) {
    return false;
  }

  return (!Number.isFinite(versionEnd) || poolStart < versionEnd)
    && (!Number.isFinite(poolEnd) || poolEnd > versionStart);
}

export function buildVersionCalendarPoolCatalog(poolRows = [], characterRows = []) {
  const seen = new Set();
  const poolArtwork = resolvePoolCharacterArtwork(poolRows, characterRows);
  return (Array.isArray(poolRows) ? poolRows : [])
    .map((pool) => sanitizeVersionCalendarPool(
      pool,
      poolArtwork.get(pool?.pool_id || pool?.id) || null,
    ))
    .filter((pool) => {
      if (!pool || seen.has(pool.poolId)) {
        return false;
      }
      seen.add(pool.poolId);
      return true;
    })
    .sort((left, right) => {
      const timeDifference = Date.parse(left.startsAt || '') - Date.parse(right.startsAt || '');
      return Number.isFinite(timeDifference) && timeDifference !== 0
        ? timeDifference
        : left.name.localeCompare(right.name, 'zh-CN');
    });
}

export function buildVersionCalendarPoolNames(poolRows = [], poolBindings = {}) {
  const requestedPoolIds = new Set(Object.values(poolBindings || {}).filter(Boolean));
  const poolNames = {};

  (Array.isArray(poolRows) ? poolRows : []).forEach((row) => {
    const poolId = row?.pool_id || row?.id || null;
    if (!poolId || !requestedPoolIds.has(poolId) || poolNames[poolId]) {
      return;
    }

    const name = cleanPoolDisplayName(row?.name);
    if (name) {
      poolNames[poolId] = name;
    }
  });

  return poolNames;
}

export function mergeVersionTimelineConfig(snapshotRows = [], timelineValue = null, updatedAt = null) {
  let parsedTimeline = timelineValue;
  if (typeof timelineValue === 'string') {
    try {
      parsedTimeline = JSON.parse(timelineValue);
    } catch {
      return Array.isArray(snapshotRows) ? snapshotRows : [];
    }
  }

  const configuredVersions = Array.isArray(parsedTimeline?.versions)
    ? parsedTimeline.versions.filter((version) => version?.enabled !== false && version?.id)
    : [];
  if (configuredVersions.length === 0) {
    return Array.isArray(snapshotRows) ? snapshotRows : [];
  }

  const snapshotsByKey = new Map(
    (Array.isArray(snapshotRows) ? snapshotRows : []).map((snapshot) => [snapshot?.version_key, snapshot]),
  );

  return configuredVersions
    .sort((left, right) => Number(left.order || 0) - Number(right.order || 0))
    .map((configuredVersion, index) => {
      const legacyVersionFive = configuredVersion.id === 'version-5'
        ? snapshotsByKey.get('xiangyuan-2026')
        : null;
      const snapshot = snapshotsByKey.get(configuredVersion.id) || legacyVersionFive || {};
      const numberMatch = String(configuredVersion.id).match(/(\d+)$/u);
      return {
        ...snapshot,
        version_key: configuredVersion.id,
        version_number: numberMatch?.[1] || String(index + 1),
        revision: Number(snapshot.revision) || 1,
        title: configuredVersion.name || snapshot.title || null,
        starts_at: configuredVersion.starts_at || snapshot.starts_at || null,
        ends_at: configuredVersion.ends_at || snapshot.ends_at || null,
        content: snapshot.content && typeof snapshot.content === 'object'
          ? snapshot.content
          : { activitiesComplete: false, emptyMessage: '活动待补充', events: [] },
        pool_bindings: snapshot.pool_bindings && typeof snapshot.pool_bindings === 'object'
          ? snapshot.pool_bindings
          : {},
        source_meta: {
          ...(snapshot.source_meta && typeof snapshot.source_meta === 'object' ? snapshot.source_meta : {}),
          nameEn: configuredVersion.name_en || null,
          timelineOrder: configuredVersion.order ?? index + 1,
          timelineUpdatedAt: updatedAt || null,
        },
      };
    });
}

export function buildVersionCalendarPayload(snapshotRow, poolRows = [], characterRows = []) {
  if (Array.isArray(snapshotRow)) {
    const poolCatalog = buildVersionCalendarPoolCatalog(poolRows, characterRows);
    const versions = snapshotRow
      .map(sanitizeVersionCalendarSnapshot)
      .filter(Boolean)
      .sort((left, right) => Date.parse(left.startsAt || '') - Date.parse(right.startsAt || ''))
      .map((snapshot) => {
        const requestedPoolIds = new Set(
          Object.values(snapshot.poolBindings || {}).filter(Boolean),
        );
        const pools = poolCatalog.filter(
          (pool) => requestedPoolIds.has(pool.poolId) || isPoolInsideVersion(pool, snapshot),
        );

        return {
          ...snapshot,
          pools,
          poolNames: Object.fromEntries(pools.map((pool) => [pool.poolId, pool.name])),
        };
      });

    if (versions.length === 0) {
      return null;
    }

    const selectedVersion = versions[versions.length - 1];
    return {
      activeVersionKey: selectedVersion.versionKey,
      versions,
      ...selectedVersion,
    };
  }

  const snapshot = sanitizeVersionCalendarSnapshot(snapshotRow);
  if (!snapshot) {
    return null;
  }

  return {
    ...snapshot,
    poolNames: buildVersionCalendarPoolNames(poolRows, snapshot.poolBindings),
  };
}
