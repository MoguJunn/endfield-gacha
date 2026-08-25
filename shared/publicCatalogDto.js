const PUBLIC_POOL_KEYS = new Set([
  'id',
  'pool_id',
  'name',
  'name_en',
  'type',
  'extra_subtype',
  'extra_rule_profile',
  'extra_series_key',
  'extra_series_phase',
  'locked',
  'isLimitedWeapon',
  'is_limited_weapon',
  'created_at',
  'updated_at',
  'up_character',
  'description',
  'banner_url',
  'start_time',
  'end_time',
  'featured_characters',
  'six_star_entities',
  'six_star_roster_complete',
]);

const PUBLIC_CHARACTER_KEYS = new Set([
  'id',
  'name',
  'name_en',
  'avatar_url',
  'avatarUrl',
  'rarity',
  'type',
  'aliases',
  'is_limited',
  'isLimited',
  'release_date',
  'releaseDate',
  'created_at',
  'updated_at',
  'pool_config',
]);

const SAFE_RELATIVE_RESOURCE_PREFIXES = Object.freeze([
  '/assets/',
  '/avatars/',
  '/game-calendar/',
  '/lottery/',
  '/api/official-announcement-image?',
]);

function isIpLiteral(hostname) {
  const normalized = String(hostname || '').replace(/^\[|\]$/gu, '');
  return /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(normalized) || normalized.includes(':');
}

export function isUnsafePublicHostname(hostname) {
  const normalized = String(hostname || '').trim().toLowerCase().replace(/\.$/u, '');
  if (!normalized || isIpLiteral(normalized)) return true;
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || normalized.endsWith('.internal');
}

function normalizeSafeRelativePath(value) {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  try {
    const parsed = new URL(value, 'https://public-resource.invalid');
    const decodedPath = decodeURIComponent(parsed.pathname);
    if (decodedPath.includes('..') || decodedPath.includes('\\')) return null;
    const normalizedPath = `${parsed.pathname}${parsed.search}`;
    return SAFE_RELATIVE_RESOURCE_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix))
      ? normalizedPath
      : null;
  } catch {
    return null;
  }
}

export function sanitizePublicCatalogResourceUrl(value, {
  allowedHosts = ['ef-gacha.mogujun.icu'],
  allowRelative = true,
} = {}) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 2048) return null;

  if (normalized.startsWith('/')) {
    return allowRelative ? normalizeSafeRelativePath(normalized) : null;
  }

  try {
    const url = new URL(normalized);
    const allowed = new Set(Array.from(allowedHosts || [], (host) => String(host || '').trim().toLowerCase()));
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || (url.port && url.port !== '443')
      || isUnsafePublicHostname(url.hostname)
      || !allowed.has(url.hostname.toLowerCase())
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function pickKnownFields(record, keys) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  return Object.fromEntries(Object.entries(record).filter(([key]) => keys.has(key)));
}

export function sanitizePublicPoolRecord(record, options = {}) {
  const picked = pickKnownFields(record, PUBLIC_POOL_KEYS);
  if (!picked) return null;
  if ('banner_url' in picked) {
    picked.banner_url = sanitizePublicCatalogResourceUrl(picked.banner_url, options);
  }
  return picked;
}

export function sanitizePublicCharacterRecord(record, options = {}) {
  const picked = pickKnownFields(record, PUBLIC_CHARACTER_KEYS);
  if (!picked) return null;
  if ('avatar_url' in picked) {
    picked.avatar_url = sanitizePublicCatalogResourceUrl(picked.avatar_url, options);
  }
  if ('avatarUrl' in picked) {
    picked.avatarUrl = sanitizePublicCatalogResourceUrl(picked.avatarUrl, options);
  }
  return picked;
}
