import React, { useMemo, useState, useEffect } from 'react';
import { getCurrentUpPoolInfo } from '../../utils/poolTimeUtils';
import usePoolStore from '../../stores/usePoolStore';
import { useI18n } from '../../i18n/index.js';
import { localizeEntityName } from '../../utils/gameDataI18n.js';

/**
 * 顶栏卡池时间信息组件 - 实时更新
 * 优先从数据库读取卡池时间，fallback 到硬编码
 */
const HeaderPoolTimeInfo = React.memo(() => {
  const pools = usePoolStore(state => state.pools);
  const { t, locale } = useI18n();
  const [tick, setTick] = useState(0);
  const timeInfo = useMemo(() => {
    void tick;
    return getCurrentUpPoolInfo(pools);
  }, [pools, tick]);

  useEffect(() => {
    // 每分钟更新一次倒计时
    const timer = setInterval(() => {
      setTick(prev => prev + 1);
    }, 60000);

    return () => clearInterval(timer);
  }, [pools]);

  const { name, nextPool, isExpired, remainingDays = 0, remainingHours = 0, startsIn, startsInHours, isActive } = timeInfo;
  const isEndingSoon = remainingDays <= 3 && isActive && !isExpired;
  const isNotStarted = !isActive && !isExpired && (startsIn !== undefined || startsInHours !== undefined);
  const currentName = localizeEntityName(name, { locale, type: 'character' }) || name;
  const nextPoolName = nextPool === '待公布'
    ? t('header.pool.tba', {}, 'To be announced')
    : localizeEntityName(nextPool, { locale, type: 'character' }) || nextPool;

  return (
    <div className="hidden md:flex items-center gap-3 text-xs font-mono bg-zinc-50 dark:bg-zinc-900 px-4 py-1.5 border-l border-r border-zinc-200 dark:border-zinc-800 h-full">
      <div className="flex items-center gap-2">
        <span className={`px-1.5 py-0.5 text-[10px] font-bold uppercase ${isActive ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500'}`}>
          {isActive ? t('header.pool.current', {}, 'CURRENT') : t('header.pool.upcoming', {}, 'UPCOMING')}
        </span>
        <span className="text-orange-600 dark:text-orange-400 font-bold">{currentName}</span>
      </div>

      <div className="w-px h-3 bg-zinc-300 dark:bg-zinc-700"></div>

      <div className="text-zinc-500 dark:text-zinc-400">
        {isNotStarted ? (
          <span className="text-blue-500 countdown-nums">T-{startsIn}D {startsInHours}H</span>
        ) : isExpired ? (
          <span className="text-red-500">{t('header.pool.ended', {}, 'ENDED')}</span>
        ) : isEndingSoon ? (
          <span className="text-amber-500 font-bold animate-pulse countdown-nums">{remainingDays}D {remainingHours}H LEFT</span>
        ) : (
          <span className="countdown-nums">{remainingDays}D {remainingHours}H LEFT</span>
        )}
      </div>

      {nextPool && (
        <>
          <div className="w-px h-3 bg-zinc-300 dark:bg-zinc-700"></div>
          <div className="flex items-center gap-1 text-zinc-400 dark:text-zinc-500">
            <span className="text-[10px] uppercase">{t('header.pool.next', {}, 'NEXT:')}</span>
            <span>{nextPoolName}</span>
          </div>
        </>
      )}
    </div>
  );
});

export default HeaderPoolTimeInfo;
