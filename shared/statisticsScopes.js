import { getPoolsForGroupType } from '../src/utils/poolGroupUtils.js';
import { resolvePoolCapabilities } from '../src/utils/poolCapabilities.js';

export const STATISTICS_GROUPS = Object.freeze([
  { key: 'limited', type: 'limited', entityType: 'character', name: '全部限定角色', nameEn: 'All limited operator banners' },
  { key: 'weapon_limited', type: 'weapon_limited', entityType: 'weapon', name: '全部限定武器', nameEn: 'All limited weapon banners' },
  { key: 'weapon_standard', type: 'weapon_standard', entityType: 'weapon', name: '全部常驻武器', nameEn: 'All standard weapon banners' },
  { key: 'extra:reconstruction', type: 'extra', subtype: 'reconstruction', entityType: 'character', name: '全部重构寻访', nameEn: 'All reconstruction recruitment' },
  { key: 'extra:reconstruction_claim', type: 'extra', subtype: 'reconstruction_claim', entityType: 'weapon', name: '全部重构申领', nameEn: 'All reconstruction claims' },
]);

export function getStatisticsGroup(key) {
  return STATISTICS_GROUPS.find((group) => group.key === key) || null;
}

export function getStatisticsGroupPools(pools, key) {
  const group = getStatisticsGroup(key);
  return group ? getPoolsForGroupType(pools.map(normalizeStatisticsPool), group.type, group.subtype) : [];
}

export function normalizeStatisticsPool(pool) {
  return { ...pool, id: pool.pool_id || pool.id, isLimitedWeapon: pool.isLimitedWeapon ?? pool.is_limited_weapon ?? true };
}

export function statisticsMemberSignature(pools) {
  return JSON.stringify(pools.map(normalizeStatisticsPool).map((pool) => [pool.id, pool.type, pool.isLimitedWeapon,
    pool.extra_subtype ?? null, pool.extra_rule_profile ?? null, pool.extra_series_key ?? null,
    pool.up_character ?? null, pool.featured_characters ?? null, pool.resolved_roster ?? null]).sort((a, b) => a[0].localeCompare(b[0])));
}

export function statisticsCategoryDefinitions(entityType) {
  return [
    { itemId: 'featured', name: entityType === 'weapon' ? '当期目标武器' : '当期 UP 限定', nameEn: entityType === 'weapon' ? 'Featured weapons' : 'Featured limited operators', color: '#d99a16' },
    { itemId: 'limited', name: entityType === 'weapon' ? '其他限定武器' : '陪跑限定', nameEn: entityType === 'weapon' ? 'Other limited weapons' : 'Other limited operators', color: '#5485c5' },
    { itemId: 'standard', name: entityType === 'weapon' ? '常驻武器' : '常驻六星', nameEn: entityType === 'weapon' ? 'Standard weapons' : 'Standard six-stars', color: '#2d9d90' },
    { itemId: 'unknown', name: '待分类六星', nameEn: 'Unclassified six-stars', color: '#92929e' },
  ];
}

export function statisticsItemCategory(item, pool, directoryById) {
  const record = directoryById.get(item.itemId);
  if (!record || Number(record.rarity) !== 6 || record.type !== resolvePoolCapabilities(pool).entityType) return 'unknown';
  const targets = statisticsTargetReferences(pool);
  if (targets.some((target) => [item.itemId, record.name, ...(record.aliases || [])].includes(target))) return 'featured';
  if (resolvePoolCapabilities(pool).targetMode !== 'none' && !targets.length) return 'unknown';
  return record?.is_limited === true ? 'limited' : record?.is_limited === false ? 'standard' : 'unknown';
}

/** Exact references only: no fuzzy match or union of targets across periods. */
export function statisticsTargetReferences(pool) {
  if (resolvePoolCapabilities(pool).targetMode === 'none') return [];
  const single = pool.up_character || pool.upCharacter;
  if (single && pool.type !== 'extra') return [String(single).trim()];
  const roster = pool.resolved_roster?.up || pool.six_star_entities?.filter((entry) => entry.is_up) || [];
  const featured = Array.isArray(pool.featured_characters) ? pool.featured_characters : [];
  const values = roster.length ? roster : featured.length ? featured : single ? [single] : [];
  return [...new Set(values.flatMap((value) => typeof value === 'object' ? [value.id, value.name] : [value]).filter(Boolean).map((value) => String(value).trim()))];
}
