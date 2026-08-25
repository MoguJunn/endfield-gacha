/**
 * 卡池时间工具函数
 * 用于从数据库中获取当前活跃的限定池信息
 */

import { LIMITED_POOL_SCHEDULE } from '../constants/index.js';
import { characterCache, getCharacterAvatarUrl } from './characterUtils.js';
import { getPoolFeaturedLead, getPoolFeaturedNames } from './poolFeaturedResolver.js';

function normalizeRotationLimit(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePoolDateValue(value) {
  if (!value) {
    return new Date(NaN);
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value < 1e12 ? value * 1000 : value);
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  }

  return new Date(value);
}

function isValidDate(date) {
  return date instanceof Date && !Number.isNaN(date.getTime());
}

function normalizeReferenceDate(referenceDate) {
  const parsedDate = normalizePoolDateValue(referenceDate);
  return isValidDate(parsedDate) ? parsedDate : new Date();
}

function getPoolStartDate(pool) {
  return normalizePoolDateValue(pool?.start_time || pool?.startDate);
}

function getPoolEndDate(pool) {
  return normalizePoolDateValue(pool?.end_time || pool?.endDate);
}

function splitCountdownDuration(durationMs) {
  const totalMinutes = Math.max(0, Math.ceil(Number(durationMs || 0) / (60 * 1000)));
  return {
    days: Math.floor(totalMinutes / (24 * 60)),
    hours: Math.floor((totalMinutes % (24 * 60)) / 60),
    minutes: totalMinutes % 60,
  };
}

export function getPoolActivityTiming(pool, referenceDate = new Date()) {
  const start = getPoolStartDate(pool);
  const end = getPoolEndDate(pool);
  const now = normalizeReferenceDate(referenceDate);

  if (!isValidDate(start) || !isValidDate(end)) {
    return {
      status: 'untimed',
      isTimed: false,
      isActive: false,
      isUpcoming: false,
      isExpired: false,
      days: 0,
      hours: 0,
      minutes: 0,
    };
  }

  if (now < start) {
    return {
      status: 'upcoming',
      isTimed: true,
      isActive: false,
      isUpcoming: true,
      isExpired: false,
      ...splitCountdownDuration(start.getTime() - now.getTime()),
    };
  }

  if (now >= end) {
    return {
      status: 'expired',
      isTimed: true,
      isActive: false,
      isUpcoming: false,
      isExpired: true,
      days: 0,
      hours: 0,
      minutes: 0,
    };
  }

  return {
    status: 'active',
    isTimed: true,
    isActive: true,
    isUpcoming: false,
    isExpired: false,
    ...splitCountdownDuration(end.getTime() - now.getTime()),
  };
}

function getPoolCharacterName(pool) {
  return getPoolFeaturedLead(pool) || pool?.name || null;
}

function getPoolBackgroundImage(pool) {
  const directImage = pool?.banner_url || pool?.bannerUrl || pool?.poolData?.banner_url || pool?.poolData?.bannerUrl;
  if (directImage) {
    return directImage;
  }

  const characterName = getPoolCharacterName(pool);
  if (!characterName || !characterCache.isLoaded()) {
    return null;
  }

  return getCharacterAvatarUrl(characterName) || null;
}

function getCharacterRotationMeta(characterName) {
  if (!characterName || !characterCache.isLoaded()) {
    return null;
  }

  const trimmed = characterName.trim();
  const character = characterCache.searchByName(trimmed, false)
    || characterCache.searchByName(trimmed, true);
  if (!character?.pool_config) {
    return null;
  }

  return {
    removesAfter: normalizeRotationLimit(character.pool_config.removes_after),
    rotationCount: Number(character.pool_config.limited_rotation_count) || 0,
  };
}

function isTimedLimitedPool(pool) {
  const type = pool?.type;
  if (type !== 'limited' && type !== 'limited_character') {
    return false;
  }

  return isValidDate(getPoolStartDate(pool)) && isValidDate(getPoolEndDate(pool));
}

function isTimedExtraPool(pool) {
  return pool?.type === 'extra' && isValidDate(getPoolStartDate(pool)) && isValidDate(getPoolEndDate(pool));
}

function getPoolRecordId(pool) {
  return pool?.id || pool?.pool_id || pool?.poolId || pool?.name || null;
}

function sortPoolsByStartTimeAsc(left, right) {
  return getPoolStartDate(left).getTime() - getPoolStartDate(right).getTime();
}

/**
 * 从 pools 数组中获取当前活跃的限定池
 * @param {Array} pools - 卡池数组（来自 usePoolStore）
 * @returns {Object|null} 当前活跃的限定池信息
 */
export const getCurrentLimitedPoolFromDB = (pools, referenceDate = new Date()) => {
  if (!pools || pools.length === 0) return null;

  const now = normalizeReferenceDate(referenceDate);
  const limitedPools = pools.filter(isTimedLimitedPool);

  if (limitedPools.length === 0) return null;

  const sortedPools = [...limitedPools].sort((a, b) => getPoolStartDate(b).getTime() - getPoolStartDate(a).getTime());
  const sortedPoolsAsc = [...limitedPools].sort(sortPoolsByStartTimeAsc);

  const getNextLimitedPoolName = (targetPool) => {
    const targetId = getPoolRecordId(targetPool);
    const targetStart = getPoolStartDate(targetPool).getTime();
    const targetIndex = sortedPoolsAsc.findIndex((pool) => {
      const poolId = getPoolRecordId(pool);
      if (targetId && poolId && targetId === poolId) {
        return true;
      }

      return getPoolStartDate(pool).getTime() === targetStart
        && getPoolCharacterName(pool) === getPoolCharacterName(targetPool);
    });
    const nextPool = targetIndex >= 0 ? sortedPoolsAsc[targetIndex + 1] : null;
    return nextPool ? getPoolCharacterName(nextPool) : '待公布';
  };

  const getRotationPosition = (targetPool) => {
    const targetStart = getPoolStartDate(targetPool).getTime();
    if (Number.isNaN(targetStart)) {
      return 0;
    }

    return limitedPools.filter((pool) => {
      const poolStart = getPoolStartDate(pool).getTime();
      return !Number.isNaN(poolStart) && poolStart < targetStart;
    }).length;
  };

  for (const pool of sortedPools) {
    const start = getPoolStartDate(pool);
    const end = getPoolEndDate(pool);

    if (now >= start && now < end) {
      const remainingMs = end - now;
      const remainingDays = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
      const remainingHours = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

      return {
        name: getPoolCharacterName(pool),
        startDate: pool.start_time || pool.startDate,
        endDate: pool.end_time || pool.endDate,
        rotationPosition: getRotationPosition(pool),
        startDateObj: start,
        endDateObj: end,
        nextPool: getNextLimitedPoolName(pool),
        isActive: true,
        remainingDays,
        remainingHours,
        backgroundImage: getPoolBackgroundImage(pool),
        poolData: pool,
      };
    }
  }

  const futurePools = sortedPoolsAsc.filter((pool) => now < getPoolStartDate(pool));
  if (futurePools.length > 0) {
    const earliestPool = futurePools[0];
    const start = getPoolStartDate(earliestPool);
    const end = getPoolEndDate(earliestPool);
    const startsInMs = start - now;

    return {
      name: getPoolCharacterName(earliestPool),
      startDate: earliestPool.start_time || earliestPool.startDate,
      endDate: earliestPool.end_time || earliestPool.endDate,
      rotationPosition: getRotationPosition(earliestPool),
      startDateObj: start,
      endDateObj: end,
      nextPool: getNextLimitedPoolName(earliestPool),
      isActive: false,
      startsIn: Math.floor(startsInMs / (1000 * 60 * 60 * 24)),
      startsInHours: Math.floor((startsInMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
      backgroundImage: getPoolBackgroundImage(earliestPool),
      poolData: earliestPool,
    };
  }

  if (sortedPools.length > 0) {
    const lastPool = sortedPools[0];
    const start = getPoolStartDate(lastPool);
    const end = getPoolEndDate(lastPool);

    return {
      name: getPoolCharacterName(lastPool),
      startDate: lastPool.start_time || lastPool.startDate,
      endDate: lastPool.end_time || lastPool.endDate,
      rotationPosition: getRotationPosition(lastPool),
      startDateObj: start,
      endDateObj: end,
      nextPool: '待公布',
      isActive: false,
      isExpired: true,
      backgroundImage: getPoolBackgroundImage(lastPool),
      poolData: lastPool,
    };
  }

  return null;
};

/**
 * 获取限定池轮换计划（按时间顺序）
 * @param {Array} pools - 卡池数组（来自 usePoolStore）
 * @returns {Array} 限定池轮换计划数组
 */
export const getLimitedPoolScheduleFromDB = (pools) => {
  if (!pools || pools.length === 0) return [];

  const limitedPools = pools.filter(isTimedLimitedPool);
  if (limitedPools.length === 0) return [];

  const sortedPools = [...limitedPools].sort(sortPoolsByStartTimeAsc);

  const removesAfterMap = {};
  for (const scheduleItem of LIMITED_POOL_SCHEDULE) {
    if (scheduleItem.removesAfter) {
      removesAfterMap[scheduleItem.name.trim()] = scheduleItem.removesAfter;
    }
  }

  return sortedPools.map((pool, index) => {
    const charName = (getPoolCharacterName(pool) || '').trim();
    const rotationMeta = getCharacterRotationMeta(charName);

    return {
      name: charName,
      startDate: pool.start_time || pool.startDate,
      endDate: pool.end_time || pool.endDate,
      rotationPosition: index,
      removesAfter: pool.removesAfter || rotationMeta?.removesAfter || removesAfterMap[charName] || null,
      rotationCount: rotationMeta?.rotationCount || 0,
      backgroundImage: getPoolBackgroundImage(pool),
      poolData: pool,
    };
  });
};

export const getLimitedPoolRotationBaseCount = (pools, referenceDate = new Date()) => {
  const schedule = getLimitedPoolScheduleFromDB(pools);
  if (schedule.length === 0) {
    return 0;
  }

  const reference = normalizeReferenceDate(referenceDate);

  return schedule.filter((pool) => {
    const start = normalizePoolDateValue(pool.startDate);
    return isValidDate(start) && start < reference;
  }).length;
};

/**
 * 获取当前 UP 池信息（优先使用数据库，fallback 到硬编码）
 * @param {Array} pools - 卡池数组（来自 usePoolStore）
 * @returns {Object} 当前 UP 池信息
 */
export const getCurrentUpPoolInfo = (pools, referenceDate = new Date()) => {
  const dbPool = getCurrentLimitedPoolFromDB(pools, referenceDate);
  if (dbPool) return dbPool;

  const now = normalizeReferenceDate(referenceDate);
  for (const pool of LIMITED_POOL_SCHEDULE) {
    const start = normalizePoolDateValue(pool.startDate);
    const end = normalizePoolDateValue(pool.endDate);

    if (now >= start && now < end) {
      const index = LIMITED_POOL_SCHEDULE.indexOf(pool);
      const nextPool = LIMITED_POOL_SCHEDULE[index + 1];
      const remainingMs = end - now;
      const remainingDays = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
      const remainingHours = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

      return {
        ...pool,
        rotationPosition: index,
        startDateObj: start,
        endDateObj: end,
        nextPool: nextPool?.name || '待公布',
        isActive: true,
        remainingDays,
        remainingHours,
        backgroundImage: getPoolBackgroundImage(pool),
      };
    }
  }

  const firstPool = LIMITED_POOL_SCHEDULE[0];
  const firstStart = normalizePoolDateValue(firstPool.startDate);
  if (now < firstStart) {
    const firstEnd = normalizePoolDateValue(firstPool.endDate);
    const startsInMs = firstStart - now;
    return {
      ...firstPool,
      rotationPosition: 0,
      startDateObj: firstStart,
      endDateObj: firstEnd,
      nextPool: LIMITED_POOL_SCHEDULE[1]?.name || '待公布',
      isActive: false,
      startsIn: Math.floor(startsInMs / (1000 * 60 * 60 * 24)),
      startsInHours: Math.floor((startsInMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
      backgroundImage: getPoolBackgroundImage(firstPool),
    };
  }

  const lastPool = LIMITED_POOL_SCHEDULE[LIMITED_POOL_SCHEDULE.length - 1];
  const lastStart = normalizePoolDateValue(lastPool.startDate);
  const lastEnd = normalizePoolDateValue(lastPool.endDate);
  return {
    ...lastPool,
    rotationPosition: LIMITED_POOL_SCHEDULE.length - 1,
    startDateObj: lastStart,
    endDateObj: lastEnd,
    nextPool: '待公布',
    isActive: false,
    isExpired: true,
    backgroundImage: getPoolBackgroundImage(lastPool),
  };
};

/**
 * 获取限定池轮换计划（优先使用数据库，fallback 到硬编码）
 * @param {Array} pools - 卡池数组（来自 usePoolStore）
 * @returns {Array} 限定池轮换计划数组
 */
export const getLimitedPoolSchedule = (pools) => {
  const dbSchedule = getLimitedPoolScheduleFromDB(pools);
  if (dbSchedule.length > 0) return dbSchedule;

  return LIMITED_POOL_SCHEDULE.map((pool, index) => ({
    ...pool,
    rotationPosition: index,
    backgroundImage: getPoolBackgroundImage(pool),
  }));
};

export const getHomeRotationPoolSchedule = (pools) => {
  const limitedSchedule = getLimitedPoolSchedule(pools).map((pool) => ({
    ...pool,
    id: pool.id || getPoolRecordId(pool.poolData) || pool.name,
    poolType: 'limited',
    displayName: pool.displayName || pool.name,
    featuredNames: Array.isArray(pool.featuredNames) && pool.featuredNames.length > 0
      ? pool.featuredNames
      : [pool.name].filter(Boolean),
  }));

  const extraSchedule = (Array.isArray(pools) ? pools : [])
    .filter(isTimedExtraPool)
    .map((pool, index) => ({
      id: getPoolRecordId(pool) || `extra-${index}`,
      name: pool.name || getPoolCharacterName(pool) || '附加寻访',
      displayName: pool.name || '附加寻访',
      featuredNames: getPoolFeaturedNames(pool),
      startDate: pool.start_time || pool.startDate,
      endDate: pool.end_time || pool.endDate,
      rotationPosition: limitedSchedule.length + index,
      backgroundImage: getPoolBackgroundImage(pool),
      poolType: 'extra',
      rotationGroup: 'extra',
      isIndependentNode: true,
      poolData: pool,
    }));

  return [...limitedSchedule, ...extraSchedule]
    .filter((pool) => isValidDate(normalizePoolDateValue(pool.startDate)) && isValidDate(normalizePoolDateValue(pool.endDate)))
    .sort((left, right) => normalizePoolDateValue(left.startDate).getTime() - normalizePoolDateValue(right.startDate).getTime());
};

export const getActiveHomeCountdownPools = (pools, referenceDate = new Date()) => {
  const now = normalizeReferenceDate(referenceDate);
  return getHomeRotationPoolSchedule(pools)
    .filter((pool) => {
      if (pool.poolType !== 'limited' && pool.poolType !== 'extra') {
        return false;
      }

      const start = normalizePoolDateValue(pool.startDate);
      const end = normalizePoolDateValue(pool.endDate);
      return now >= start && now < end;
    })
    .map((pool) => {
      const end = normalizePoolDateValue(pool.endDate);
      const diff = Math.max(0, end.getTime() - now.getTime());
      return {
        ...pool,
        active: true,
        isActive: true,
        targetDate: pool.endDate,
        scheduleDate: pool.startDate,
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((diff % (1000 * 60)) / 1000),
      };
    });
};

export const getLimitedPoolCountdownState = (schedule, referenceDate = new Date()) => {
  const now = normalizeReferenceDate(referenceDate);
  const sortedPools = [...(Array.isArray(schedule) ? schedule : [])]
    .filter((pool) => isValidDate(normalizePoolDateValue(pool?.startDate)) && isValidDate(normalizePoolDateValue(pool?.endDate)))
    .sort((left, right) => normalizePoolDateValue(left.startDate).getTime() - normalizePoolDateValue(right.startDate).getTime());

  let activeIndex = sortedPools.findIndex((pool) => {
    const start = normalizePoolDateValue(pool.startDate);
    const end = normalizePoolDateValue(pool.endDate);
    return now >= start && now < end;
  });

  if (activeIndex === -1) {
    activeIndex = sortedPools.findIndex((pool) => now < normalizePoolDateValue(pool.startDate));
  }

  if (activeIndex === -1) {
    return null;
  }

  const pool = sortedPools[activeIndex];
  const start = normalizePoolDateValue(pool.startDate);
  const end = normalizePoolDateValue(pool.endDate);
  const isActive = now >= start && now < end;
  const target = isActive ? end : start;
  const diff = Math.max(0, target.getTime() - now.getTime());

  return {
    ...pool,
    active: isActive,
    isActive,
    targetDate: isActive ? pool.endDate : pool.startDate,
    scheduleDate: pool.startDate,
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
    minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
    seconds: Math.floor((diff % (1000 * 60)) / 1000),
    backgroundImage: pool.backgroundImage || getPoolBackgroundImage(pool),
  };
};

export const getCurrentUpPoolName = (pools, referenceDate = new Date()) => {
  return getCurrentUpPoolInfo(pools, referenceDate)?.name || null;
};
