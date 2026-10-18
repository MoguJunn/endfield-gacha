import { resolvePoolCapabilities } from '../../utils/poolCapabilities.js';
import { fetchCompletePoolRosters } from '../../../shared/fetchCompletePoolRosters.js';
import { isWorkbenchPoolUnopened } from '../../../shared/workbenchPoolAvailability.js';

export const SCREENSHOT_TYPES = [
  { id: 'limited', label: '限定角色池' }, { id: 'weapon', label: '武器池' },
  { id: 'celebration', label: '附加寻访／辉光庆典' }, { id: 'standard', label: '常驻池' }, { id: 'beginner', label: '新手池' },
];
export function screenshotPoolType(pool) {
  // The public catalog uses standard rules for beginner, but screenshot
  // categories must keep its canonical pool identity separate from standard.
  if (pool?.id === 'beginner' || pool?.pool_id === 'beginner' || (pool?.type || pool?.pool_type) === 'beginner') return 'beginner';
  const type = resolvePoolCapabilities(pool).basePoolType;
  return type === 'extra' ? 'celebration' : type;
}
export function entitiesForWorkbenchPool(pool, entities = []) {
  const ids = new Set(pool?.rosterEntityIds || []);
  const type = resolvePoolCapabilities(pool).entityType;
  return entities.filter(entity => ids.has(String(entity.id)) && entity.type === type);
}
export function poolSelectGroups(pools = []) {
  return SCREENSHOT_TYPES.map(type => ({ id: type.id, label: type.label,
    options: pools.filter(pool => screenshotPoolType(pool) === type.id)
      .sort((a, b) => (Date.parse(b.start_time) || 0) - (Date.parse(a.start_time) || 0) || String(a.name).localeCompare(String(b.name), 'zh-CN'))
      .map(pool => ({ value: String(pool.id), label: pool.name, search: `${pool.name} ${pool.up_character || ''}`,
        disabled: isWorkbenchPoolUnopened(pool),
        detail: `${isWorkbenchPoolUnopened(pool) ? '尚未开放 · ' : ''}${pool.start_time ? new Date(pool.start_time).toLocaleDateString('zh-CN') : '长期开放'}` })) })).filter(group => group.options.length);
}
export function entitySelectGroups(pool, entities, { rarity } = {}) {
  const items = entitiesForWorkbenchPool(pool, entities).filter(entity => !rarity || Number(entity.rarity) === Number(rarity));
  const up = new Set([...(pool?.rosterUpEntityIds || []), pool?.up_character, ...(pool?.featured_characters || [])]);
  const categories = [{ id: 'up', label: '本期 UP', accepts: e => Number(e.rarity) === 6 && (up.has(e.id) || up.has(e.name)) },
    ...[6, 5, 4].map(star => ({ id: `star-${star}`, label: `${star}★ ${resolvePoolCapabilities(pool).entityType === 'weapon' ? '武器' : '角色'}`,
      accepts: e => Number(e.rarity) === star && !(star === 6 && (up.has(e.id) || up.has(e.name))) }))];
  return categories.map(category => ({ id: category.id, label: category.label,
    options: items.filter(category.accepts).sort((a, b) => (Date.parse(b.release_date) || 0) - (Date.parse(a.release_date) || 0) || a.name.localeCompare(b.name, 'zh-CN'))
      .map(entity => ({ value: String(entity.id), label: entity.name, search: `${entity.name} ${(entity.aliases || []).join(' ')}`,
        avatar: entity.avatar_url || entity.avatarUrl, detail: `${entity.rarity}★` })) })).filter(group => group.options.length);
}

export async function loadWorkbenchRosters(pools) {
  const rosters = await fetchCompletePoolRosters(pools.map(pool => pool.id), { signal: AbortSignal.timeout(30000) });
  return pools.map(pool => ({ ...pool, rosterEntityIds: rosters[pool.id].map(row => String(row.character_id)),
    rosterUpEntityIds: rosters[pool.id].filter(row => row.is_up).map(row => String(row.character_id)) }));
}
