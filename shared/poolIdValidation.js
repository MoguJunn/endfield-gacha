export const RESERVED_POOL_TYPE_IDS = Object.freeze([
  'limited',
  'limited_character',
  'limited_weapon',
  'weapon',
  'extra',
  'joint',
]);

const RESERVED_POOL_TYPE_ID_SET = new Set(RESERVED_POOL_TYPE_IDS);

export function normalizePoolIdValue(value) {
  return typeof value === 'string' ? value.trim() : String(value || '').trim();
}

export function isReservedPoolTypeId(value) {
  return RESERVED_POOL_TYPE_ID_SET.has(normalizePoolIdValue(value).toLowerCase());
}

export function getPoolIdCandidate(record = {}) {
  return normalizePoolIdValue(record?.poolId || record?.pool_id || record?.id);
}

export default {
  RESERVED_POOL_TYPE_IDS,
  getPoolIdCandidate,
  isReservedPoolTypeId,
  normalizePoolIdValue,
};
