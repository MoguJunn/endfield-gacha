import { isInfoBookHistoryPull } from './historyInfoBook.js';

function getHistoryTimestamp(item) {
  return typeof item?.timestamp === 'number'
    ? item.timestamp
    : new Date(item?.timestamp || 0).getTime();
}

function getHistoryRecordKey(item) {
  const value = item?.id || item?.record_id || null;
  return value == null ? null : String(value);
}

export function buildCharacterStats({
  history = [],
  isLimitedPool = false,
  crossPoolPityMap = null,
  limitedPoolIds = null,
  includeFreePullsInStats = true
}) {
  const characters = new Map();
  let pullIndex = 0;
  let sixStarPityCounter = 0;
  let fiveStarPityCounter = 0;

  const sortedHistory = [...history].sort((left, right) => getHistoryTimestamp(left) - getHistoryTimestamp(right));

  const isLimitedHistoryItem = (item) => {
    if (limitedPoolIds instanceof Set) {
      const poolId = item?.poolId || item?.pool_id || null;
      return Boolean(poolId) && limitedPoolIds.has(poolId);
    }

    return isLimitedPool;
  };

  sortedHistory.forEach((item) => {
    if (item?.specialType === 'gift' || item?.special_type === 'gift') {
      return;
    }

    const isFree = item?.isFree || item?.is_free;
    if (isFree && !includeFreePullsInStats) {
      return;
    }

    const isInfoBook = isInfoBookHistoryPull(item);

    if (!isFree) {
      pullIndex += 1;
      sixStarPityCounter += 1;
      fiveStarPityCounter += 1;
    }

    if (Number(item?.rarity) < 5) {
      return;
    }

    const name = item?.character_name || item?.item_name || item?.name || '未知';

    let pityValue;
    if (isFree) {
      pityValue = 'free';
    } else if (isLimitedHistoryItem(item) && crossPoolPityMap) {
      const crossPity = crossPoolPityMap.get(getHistoryRecordKey(item));
      pityValue = crossPity
        ? (item?.rarity === 6 ? crossPity.sixStarPity : crossPity.fiveStarPity)
        : (item?.rarity === 6 ? sixStarPityCounter : fiveStarPityCounter);
    } else {
      pityValue = item?.rarity === 6 ? sixStarPityCounter : fiveStarPityCounter;
    }
    if (!isFree && item.statisticsContinuity?.interrupted) {
      pityValue = item.rarity === 6 ? item.statisticsContinuity.sixStarPity : item.statisticsContinuity.fiveStarPity;
    }

    const existing = characters.get(name);
    if (existing) {
      existing.count += 1;
      existing.pullIndices.push(isFree ? 'free' : pullIndex);
      existing.pities.push(pityValue);
      existing.freeCount = (existing.freeCount || 0) + (isFree ? 1 : 0);
      existing.infoBookCount = (existing.infoBookCount || 0) + (isInfoBook ? 1 : 0);
      existing.infoBookFlags.push(isInfoBook);
    } else {
      characters.set(name, {
        name,
        count: 1,
        rarity: item?.rarity,
        isStandard: item?.isStandard,
        isLimited: !item?.isStandard && item?.rarity === 6,
        pullIndices: [isFree ? 'free' : pullIndex],
        pities: [pityValue],
        freeCount: isFree ? 1 : 0,
        infoBookCount: isInfoBook ? 1 : 0,
        infoBookFlags: [isInfoBook]
      });
    }

    if (!isFree) {
      if (item?.rarity === 6) {
        sixStarPityCounter = 0;
      }
      if (item?.rarity >= 5) {
        fiveStarPityCounter = 0;
      }
    }
  });

  return Array.from(characters.values()).sort((left, right) => {
    if (left.rarity === 6 && !left.isStandard && (right.rarity !== 6 || right.isStandard)) return -1;
    if (right.rarity === 6 && !right.isStandard && (left.rarity !== 6 || left.isStandard)) return 1;
    if (left.rarity === 6 && left.isStandard && right.rarity !== 6) return -1;
    if (right.rarity === 6 && right.isStandard && left.rarity !== 6) return 1;
    if (left.rarity === right.rarity && left.isStandard === right.isStandard) return right.count - left.count;
    return right.rarity - left.rarity;
  });
}

export default {
  buildCharacterStats
};
