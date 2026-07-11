import { resolveCharacterRecordByName } from './characterUtils.js';
import { STANDARD_SIX_STAR_CHARACTERS } from '../constants/characterPools.js';

function normalizeName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isInternalEntityReference(value) {
  return /^(?:char|character|chr|wpn|weapon|manual_character|manual_weapon)_[a-z0-9_]+$/iu.test(normalizeName(value));
}

function resolveEntityRecord(value, entities = []) {
  const normalized = normalizeName(value);
  if (!normalized) {
    return null;
  }

  const cachedRecord = resolveCharacterRecordByName(normalized, { fuzzy: true });
  if (cachedRecord) {
    return cachedRecord;
  }

  return (Array.isArray(entities) ? entities : []).find((entity) => (
    normalizeName(entity?.id) === normalized
    || normalizeName(entity?.name) === normalized
    || (Array.isArray(entity?.aliases) && entity.aliases.some((alias) => normalizeName(alias) === normalized))
  )) || null;
}

function canonicalizeCharacterRef(value, entities = []) {
  const normalized = normalizeName(value);
  if (!normalized) {
    return '';
  }

  const record = resolveEntityRecord(normalized, entities);
  if (record?.name) {
    return record.name;
  }

  return isInternalEntityReference(normalized) ? '' : normalized;
}

function dedupeNames(items = [], entities = []) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).reduce((result, item) => {
    const normalized = canonicalizeCharacterRef(item, entities);
    if (!normalized || seen.has(normalized)) {
      return result;
    }

    seen.add(normalized);
    result.push(normalized);
    return result;
  }, []);
}

function extractRosterUpNames(pool, entities = []) {
  const rosterUp = Array.isArray(pool?.resolved_roster?.up) ? pool.resolved_roster.up : [];
  return rosterUp
    .map((entry) => canonicalizeCharacterRef(entry?.name || entry?.id || entry, entities))
    .filter(Boolean);
}

function getDefaultPoolFeaturedNames(pool) {
  const normalizedType = String(pool?.type || 'standard').trim();

  if (normalizedType === 'standard' || normalizedType === 'standard_pool' || normalizedType === 'beginner') {
    return dedupeNames([...STANDARD_SIX_STAR_CHARACTERS]);
  }

  return [];
}

function shouldPreferSingleUpName(pool) {
  const normalizedType = String(pool?.type || '').trim();
  if (!normalizedType) {
    return false;
  }

  return normalizedType !== 'extra'
    && normalizedType !== 'standard'
    && normalizedType !== 'standard_pool'
    && normalizedType !== 'beginner';
}

export function getPoolFeaturedNames(pool, { entities = [] } = {}) {
  const rosterUpNames = extractRosterUpNames(pool, entities);
  const explicitFeaturedNames = Array.isArray(pool?.featured_characters) ? pool.featured_characters : [];
  const singleUpName = canonicalizeCharacterRef(pool?.up_character || pool?.upCharacter || '', entities);

  if (singleUpName && shouldPreferSingleUpName(pool)) {
    return [singleUpName];
  }

  if (rosterUpNames.length > 0) {
    return dedupeNames(rosterUpNames);
  }

  if (explicitFeaturedNames.length > 0) {
    return dedupeNames(explicitFeaturedNames, entities);
  }

  if (singleUpName) {
    return [singleUpName];
  }

  const defaultPoolFeaturedNames = getDefaultPoolFeaturedNames(pool);
  if (defaultPoolFeaturedNames.length > 0) {
    return defaultPoolFeaturedNames;
  }

  return [];
}

export function getPoolFeaturedLead(pool) {
  return getPoolFeaturedNames(pool)[0] || normalizeName(pool?.name) || null;
}
