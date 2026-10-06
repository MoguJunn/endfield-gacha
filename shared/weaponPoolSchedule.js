const ESTIMATED_PERIOD_MS = 21 * 24 * 60 * 60 * 1000;
const poolId = pool => pool.pool_id || pool.id;

export function getLimitedCharacterTimeline(pools = []) {
  return pools.filter(pool => ['limited', 'limited_character'].includes(pool.type)
    && Number.isFinite(Date.parse(pool.start_time)))
    .slice().sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time)
      || String(poolId(a)).localeCompare(String(poolId(b))));
}

export function identifyWeaponCharacterPool(weapon, pools = []) {
  const timeline = getLimitedCharacterTimeline(pools);
  const start = Date.parse(weapon.start_time);
  if (!Number.isFinite(start)) return null;
  // 开服角色池和武器池可能相差一小时，先按北京时间同日唯一池识别。
  const day = time => Math.floor((time + 8 * 3600000) / 86400000);
  const sameDay = timeline.filter(pool => day(Date.parse(pool.start_time)) === day(start));
  if (sameDay.length === 1) return poolId(sameDay[0]);
  const active = timeline.filter(pool => Date.parse(pool.start_time) <= start
    && (!pool.end_time || start < Date.parse(pool.end_time)));
  return active.length === 1 ? poolId(active[0]) : null;
}

export function resolveWeaponPoolSchedule(weapon, pools = []) {
  const timeline = getLimitedCharacterTimeline(pools);
  const characterPoolId = weapon.character_pool_id || identifyWeaponCharacterPool(weapon, pools);
  const index = timeline.findIndex(pool => poolId(pool) === characterPoolId);
  if (index < 0) return { characterPoolId: null, periods: [], endsAt: null, estimated: false };
  const periods = timeline.slice(index, index + 3);
  const third = timeline[index + 2];
  if (third && Number.isFinite(Date.parse(third.end_time))) {
    return { characterPoolId, periods, endsAt: third.end_time, estimated: false };
  }
  const last = third || timeline.at(-1);
  const knownEnd = Date.parse(last.end_time);
  const base = Number.isFinite(knownEnd) ? knownEnd : Date.parse(last.start_time) + ESTIMATED_PERIOD_MS;
  const missing = third ? 0 : index + 2 - (timeline.length - 1);
  return { characterPoolId, periods, endsAt: new Date(base + missing * ESTIMATED_PERIOD_MS).toISOString(), estimated: true };
}
