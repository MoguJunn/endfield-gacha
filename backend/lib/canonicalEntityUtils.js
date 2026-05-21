function normalizeInput(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function simpleStableHash(value) {
  const normalized = normalizeInput(value).normalize('NFKC');
  let hash = 2166136261;

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

export function normalizeEntityNameForMatch(value) {
  return normalizeInput(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function buildReadableSlug(value, fallback = 'unknown') {
  const normalized = normalizeInput(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (normalized) {
    return normalized;
  }

  return `${fallback}_${simpleStableHash(value).slice(0, 6)}`;
}

export function buildManualCharacterId(name, type = 'character') {
  const safeType = type === 'weapon' ? 'weapon' : 'character';
  const slug = buildReadableSlug(name, safeType === 'weapon' ? 'wp' : 'char');
  const hash = simpleStableHash(`${safeType}:${normalizeInput(name)}`).slice(0, 6);
  return `manual_${safeType}_${slug}_${hash}`;
}

export function isGeneratedManualCharacterId(value) {
  return typeof value === 'string' && /^manual_(character|weapon)_[a-z0-9_]+_[a-z0-9]{6}$/i.test(value.trim());
}

export function classifyCharacterIdSource(characterId) {
  const normalized = normalizeInput(characterId).toLowerCase();

  if (!normalized) {
    return 'unknown';
  }

  if (normalized.startsWith('manual_character_') || normalized.startsWith('manual_weapon_')) {
    return 'manual_placeholder';
  }

  if (normalized.startsWith('char_') || normalized.startsWith('weapon_')) {
    return 'seeded';
  }

  if (/^[a-z0-9_]+$/.test(normalized)) {
    return 'source_raw';
  }

  return 'custom';
}

export function buildManualPoolId({
  type,
  name,
  upCharacter,
  startTime,
  endTime,
}) {
  const safeType = normalizeInput(type) || 'unknown';
  const label = normalizeInput(upCharacter) || normalizeInput(name) || safeType;
  const slug = buildReadableSlug(label, 'pool');
  const dateKey = normalizeInput(startTime)
    ? normalizeInput(startTime).slice(0, 10).replace(/-/g, '')
    : 'undated';
  const hashBase = [
    safeType,
    normalizeInput(name),
    normalizeInput(upCharacter),
    normalizeInput(startTime),
    normalizeInput(endTime),
  ].join('|');
  const hash = simpleStableHash(hashBase).slice(0, 6);

  return `manual_pool_${safeType}_${slug}_${dateKey}_${hash}`;
}

export function classifyPoolIdSource(poolId) {
  const normalized = normalizeInput(poolId).toLowerCase();

  if (!normalized) {
    return 'unknown';
  }

  if (
    normalized === 'standard'
    || normalized === 'beginner'
    || normalized.startsWith('joint_')
    || normalized.startsWith('special_')
    || normalized.startsWith('weponbox_')
    || normalized.startsWith('weaponbox_')
  ) {
    return 'official';
  }

  if (normalized.startsWith('manual_pool_')) {
    return 'manual_placeholder';
  }

  if (
    normalized.startsWith('pool_limited_')
    || normalized.startsWith('pool_extra_')
    || normalized.startsWith('pool_weapon_')
    || normalized.startsWith('pool_standard_')
    || normalized.startsWith('pool_beginner_')
  ) {
    return 'legacy_manual_seed';
  }

  if (normalized.startsWith('pool_')) {
    return 'custom_pool';
  }

  return 'custom';
}

export function normalizePoolType(value) {
  if (value === 'limited_character') return 'limited';
  if (value === 'limited_weapon') return 'weapon';
  return normalizeInput(value) || 'unknown';
}

export function buildPoolAuditKey(pool) {
  const normalizedType = normalizePoolType(pool?.type);
  const normalizedUpCharacter = normalizeEntityNameForMatch(pool?.up_character);
  const startDate = normalizeInput(pool?.start_time).slice(0, 10);

  if (normalizedUpCharacter && startDate) {
    return `${normalizedType}|${normalizedUpCharacter}|${startDate}`;
  }

  if (normalizedUpCharacter) {
    return `${normalizedType}|${normalizedUpCharacter}`;
  }

  const normalizedName = normalizeEntityNameForMatch(pool?.name);
  if (normalizedName) {
    return `${normalizedType}|name:${normalizedName}`;
  }

  return `${normalizedType}|id:${normalizeInput(pool?.pool_id || pool?.id) || 'unknown'}`;
}

export function buildCharacterAuditKey(character) {
  const normalizedType = normalizeInput(character?.type) || 'unknown';
  const normalizedName = normalizeEntityNameForMatch(character?.name);
  return `${normalizedType}|${normalizedName || normalizeInput(character?.id) || 'unknown'}`;
}
