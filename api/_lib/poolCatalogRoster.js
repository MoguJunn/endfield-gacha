function normalizeEntityType(value) {
  return value === 'weapon' ? 'weapon' : value === 'character' ? 'character' : null;
}

function normalizePoolRosterEntity(row) {
  const relation = Array.isArray(row?.characters) ? row.characters[0] : row?.characters;
  const id = relation?.id || row?.character_id || null;
  const name = typeof relation?.name === 'string' ? relation.name.trim() : '';
  const type = normalizeEntityType(relation?.type);
  const rarity = Number(relation?.rarity);

  if (!id || !name || !type || rarity !== 6) {
    return null;
  }

  return {
    id: String(id),
    name,
    type,
    is_up: Boolean(row?.is_up),
  };
}

function comparePoolRosterEntities(left, right) {
  if (left.is_up !== right.is_up) return left.is_up ? -1 : 1;
  if (left.type !== right.type) return left.type.localeCompare(right.type);
  const nameDiff = left.name.localeCompare(right.name, 'zh-CN');
  return nameDiff || left.id.localeCompare(right.id);
}

function normalizeEntityReference(value) {
  return String(value || '').trim().toLocaleLowerCase('zh-CN');
}

function collectFeaturedEntityKeys(record) {
  const values = [record?.up_character, record?.upCharacter];
  const featured = record?.featured_characters ?? record?.featuredCharacters;
  if (Array.isArray(featured)) values.push(...featured);
  else if (featured) values.push(...String(featured).split(/[，,、|/]/u));

  return new Set(values.flatMap((value) => {
    if (value && typeof value === 'object') {
      return [value.id, value.name, value.entityId, value.entity_id].filter(Boolean);
    }
    return value == null ? [] : [value];
  }).map(normalizeEntityReference).filter(Boolean));
}

export function buildPoolSixStarRosterMap(rows = [], poolIds = []) {
  const normalizedPoolIds = [...new Set(
    (Array.isArray(poolIds) ? poolIds : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )];
  const grouped = new Map(normalizedPoolIds.map((poolId) => [poolId, []]));
  const seenByPool = new Map(normalizedPoolIds.map((poolId) => [poolId, new Set()]));

  for (const row of Array.isArray(rows) ? rows : []) {
    const poolId = String(row?.pool_id || '').trim();
    if (!poolId || !grouped.has(poolId)) continue;

    const entity = normalizePoolRosterEntity(row);
    if (!entity) continue;

    const seen = seenByPool.get(poolId);
    if (seen.has(entity.id)) continue;
    seen.add(entity.id);
    grouped.get(poolId).push(entity);
  }

  for (const entities of grouped.values()) {
    entities.sort(comparePoolRosterEntities);
  }

  return grouped;
}

export function attachPoolSixStarRoster(record, rosterMap) {
  const poolId = record?.pool_id || record?.id || null;
  const entities = poolId && rosterMap instanceof Map
    ? rosterMap.get(String(poolId)) || []
    : [];

  const featuredKeys = collectFeaturedEntityKeys(record);
  const normalizedEntities = entities.map((entity) => ({
    ...entity,
    is_up: entity.is_up
      || featuredKeys.has(normalizeEntityReference(entity.id))
      || featuredKeys.has(normalizeEntityReference(entity.name)),
  })).sort(comparePoolRosterEntities);

  return {
    ...record,
    six_star_entities: normalizedEntities,
    six_star_roster_complete: normalizedEntities.length > 0,
  };
}
