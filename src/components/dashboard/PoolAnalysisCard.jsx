import React, { useMemo, useState, useEffect } from 'react';
import { Calculator, Sparkles, FileText, Clock } from 'lucide-react';
import { usePoolStore } from '../../stores';
import { getCurrentUpPoolInfo } from '../../utils/poolTimeUtils';
import { getPoolAnalysisPityState } from '../../utils/poolAnalysisPity';
import { calculateCurrentProbability } from '../../utils';
import AveragePullStatsPanel from './AveragePullStatsPanel';
import { useI18n } from '../../i18n/index.js';
import { localizeEntityName, localizePoolFeaturedList, localizePoolFeaturedName, localizePoolName } from '../../utils/gameDataI18n.js';
import { getPoolFeaturedNames } from '../../utils/poolFeaturedResolver.js';
import { EXTRA_RULE_PROFILES } from '../../utils/poolCapabilities.js';

/**
 * 卡池时间信息组件 - 实时更新 (内部组件)
 * @param {Object} props.currentPool - 当前查看的卡池对象
 */
const PoolTimeInfo = ({ currentPool, t, formatDateTime }) => {
  const pools = usePoolStore(state => state.pools);
  const poolsArray = Array.isArray(pools) ? pools : Object.values(pools || {});
  const [tick, setTick] = useState(0);

  const upPoolInfo = useMemo(() => {
    void tick;
    return getCurrentUpPoolInfo(poolsArray);
  }, [poolsArray, tick]);

  const currentPoolFeaturedNames = useMemo(() => {
    const featuredNames = getPoolFeaturedNames(currentPool);
    if (featuredNames.length > 0) {
      return featuredNames;
    }

    const fallbackName = currentPool?.name || null;
    return fallbackName ? [fallbackName] : [];
  }, [currentPool]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTick(prev => prev + 1);
    }, 60000);
    return () => clearInterval(timer);
  }, [poolsArray]);

  // 判断当前查看的卡池是否就是当前 UP 池
  const isCurrentUpPool = currentPool && upPoolInfo && (
    currentPoolFeaturedNames.includes(upPoolInfo.name) ||
    currentPool.name === upPoolInfo.name ||
    (upPoolInfo.poolData && currentPool.id === upPoolInfo.poolData.id)
  );

  // 如果当前查看的卡池不是 UP 池，则使用该卡池自身的时间数据
  const poolInfo = isCurrentUpPool ? upPoolInfo : (() => {
    if (!currentPool?.start_time || !currentPool?.end_time) return upPoolInfo;
    const now = new Date();
    const start = new Date(currentPool.start_time);
    const end = new Date(currentPool.end_time);
    const isActive = now >= start && now < end;
    const isExpired = now >= end;
    const remainingMs = end - now;
    const startsInMs = start - now;
    return {
      name: currentPoolFeaturedNames[0] || currentPool.name,
      startDate: currentPool.start_time,
      endDate: currentPool.end_time,
      isActive,
      isExpired,
      remainingDays: isActive ? Math.floor(remainingMs / (1000 * 60 * 60 * 24)) : 0,
      remainingHours: isActive ? Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)) : 0,
      startsIn: !isActive && !isExpired ? Math.floor(startsInMs / (1000 * 60 * 60 * 24)) : undefined,
      startsInHours: !isActive && !isExpired ? Math.floor((startsInMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)) : undefined,
    };
  })();

  const startDate = new Date(poolInfo.startDate);
  const endDate = poolInfo.endDate instanceof Date ? poolInfo.endDate : new Date(poolInfo.endDate);

  const formatDate = (date) => formatDateTime(date, {
    includeYear: false,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const isExpired = poolInfo.isExpired;
  const remainingDays = poolInfo.remainingDays ?? 0;
  const remainingHours = poolInfo.remainingHours ?? 0;
  const isEndingSoon = remainingDays <= 3 && poolInfo.isActive && !isExpired;
  const isNotStarted = !poolInfo.isActive && !isExpired && (poolInfo.startsIn !== undefined || poolInfo.startsInHours !== undefined);

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 dark:text-zinc-400 font-mono mt-1">
      <Clock size={10} />
      <span className="flex items-center gap-1">
        {isNotStarted ? (
          <span className="text-slate-400">{t('dashboard.analysis.upcoming')}</span>
        ) : isExpired ? (
          <span className="text-red-400">{t('dashboard.analysis.ended')}</span>
        ) : (
          <span className="text-green-600 dark:text-green-400">{t('dashboard.analysis.active')}</span>
        )}
      </span>
      <span className="text-slate-300 dark:text-zinc-700">|</span>
      <span>{formatDate(startDate)} - {formatDate(endDate)}</span>
      <span className="text-slate-300 dark:text-zinc-700">|</span>
      {isNotStarted ? (
        <span className="text-blue-500 countdown-nums">
          {t('dashboard.analysis.startsIn', {
            days: poolInfo.startsIn ?? 0,
            hours: poolInfo.startsInHours ?? 0,
          })}
        </span>
      ) : isExpired ? (
        <span className="text-red-500 font-medium">{t('dashboard.analysis.ended')}</span>
      ) : isEndingSoon ? (
        <span className="text-amber-500 font-medium animate-pulse countdown-nums">
          {t('dashboard.analysis.remainingTime', { days: remainingDays, hours: remainingHours })}
        </span>
      ) : (
        <span className="text-green-500 countdown-nums">
          {t('dashboard.analysis.remainingTime', { days: remainingDays, hours: remainingHours })}
        </span>
      )}
    </div>
  );
};

/**
 * 通用统计卡片组件
 */
const StatCard = ({ label, value, subValue, footer, progress, progressColor, extraLabel, warning }) => (
  <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 relative group hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors">
    <div className="flex justify-between items-start mb-2">
      <div className="text-[11px] uppercase tracking-wider text-slate-600 dark:text-zinc-400 font-bold flex items-center gap-2">
        {label}
        {extraLabel && <span className="bg-zinc-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 px-1 py-0.5 text-[10px] rounded-sm">{extraLabel}</span>}
      </div>
      {warning && (
        <div className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50 text-[10px] font-mono animate-pulse rounded-sm">
          {warning}
        </div>
      )}
    </div>
    
    <div className="flex items-baseline gap-2 mb-3">
      <span className="text-3xl font-bold font-mono text-slate-800 dark:text-zinc-100">{value}</span>
      {subValue && <span className="text-sm font-mono text-slate-500 dark:text-zinc-500">{subValue}</span>}
    </div>

    <div className="relative h-1.5 w-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden rounded-sm">
      <div 
        className={`absolute top-0 left-0 h-full transition-all duration-500 ${progressColor}`}
        style={{ width: `${Math.min(progress, 100)}%` }}
      ></div>
    </div>

    {footer && <div className="mt-2 text-[11px] text-slate-600 dark:text-zinc-400 font-mono flex justify-between items-center">{footer}</div>}
  </div>
);

function FeaturedRosterSummary({ names = [], fallback = null }) {
  const visibleNames = Array.isArray(names) ? names.filter(Boolean) : [];
  if (visibleNames.length === 0 && fallback) {
    return <div className="text-sm font-bold text-slate-800 dark:text-zinc-200">{fallback}</div>;
  }

  if (visibleNames.length <= 1) {
    return <div className="text-sm font-bold text-slate-800 dark:text-zinc-200">{visibleNames[0] || '-'}</div>;
  }

  return (
    <div className="flex max-w-[280px] flex-wrap justify-end gap-1">
      {visibleNames.slice(0, 4).map((name) => (
        <span
          key={name}
          className="rounded-full border border-cyan-300/60 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-bold text-cyan-700 dark:border-cyan-500/30 dark:text-cyan-300"
        >
          {name}
        </span>
      ))}
      {visibleNames.length > 4 && (
        <span className="rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[11px] font-bold text-slate-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
          +{visibleNames.length - 4}
        </span>
      )}
    </div>
  );
}

/**
 * 武器池赠送进度组件
 */
const WeaponGifts = ({ stats, capabilities, t }) => {
  const paidTotal = stats.rewardPaidTotal ?? stats.paidTotal ?? stats.total;
  const firstStandardGift = Number(capabilities.rules?.firstStandardGift || 0);
  const firstLimitedGift = Number(capabilities.rules?.firstLimitedGift || 0);
  const alternateInterval = Number(capabilities.rules?.giftAlternateInterval || 0);
  const isReconstructionWeapon = capabilities.ruleProfile === EXTRA_RULE_PROFILES.RECONSTRUCTION_WEAPON;
  let nextWeaponGift = paidTotal < firstStandardGift ? firstStandardGift : firstLimitedGift;
  let nextWeaponGiftType = paidTotal < firstStandardGift ? 'standard' : 'limited';

  if (firstLimitedGift > 0 && paidTotal >= firstLimitedGift && alternateInterval > 0) {
    const completedIntervals = Math.floor((paidTotal - firstLimitedGift) / alternateInterval);
    nextWeaponGift = firstLimitedGift + (completedIntervals + 1) * alternateInterval;
    nextWeaponGiftType = completedIntervals % 2 === 0 ? 'standard' : 'limited';
  }
  const currentProgress = isReconstructionWeapon ? paidTotal / 10 : paidTotal;
  const nextProgress = isReconstructionWeapon ? nextWeaponGift / 10 : nextWeaponGift;
  const nextGiftLabel = isReconstructionWeapon
    ? nextWeaponGiftType === 'limited'
      ? t('dashboard.analysis.targetWeaponReward')
      : t('dashboard.analysis.arsenalGiftReward')
    : nextWeaponGiftType === 'limited'
      ? t('dashboard.analysis.limitedShort')
      : t('dashboard.analysis.standardShort');

  return (
      <div className="bg-zinc-50 dark:bg-zinc-900 p-3 border-l-2 border-red-500 flex flex-col gap-2">
          <div className="flex justify-between items-center">
              <span className="text-xs text-slate-700 dark:text-zinc-300 font-bold flex items-center gap-2">
                  {t('dashboard.analysis.nextGift')}
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold text-white ${nextWeaponGiftType === 'limited' ? 'rainbow-bg' : 'bg-red-500'}`}>
                    {nextGiftLabel}
                  </span>
              </span>
              <span className="text-xs font-mono text-slate-600 dark:text-zinc-400">
                {currentProgress} / {nextProgress}{isReconstructionWeapon ? ` ${t('dashboard.unit.claim')}` : ''}
              </span>
          </div>
          <div className="h-1.5 bg-zinc-200 dark:bg-zinc-800 w-full overflow-hidden rounded-sm">
             <div className={`h-full ${nextWeaponGiftType === 'limited' ? 'rainbow-progress' : 'bg-red-500'}`}
                  style={{ width: `${Math.min((paidTotal / nextWeaponGift) * 100, 100)}%` }}></div>
          </div>
          <div className="flex gap-3 text-[11px] text-slate-600 dark:text-zinc-400 font-mono">
              <span>{t('dashboard.analysis.obtainedSummary')}</span>
              <span className="text-red-600 dark:text-red-400 font-medium">
                {stats.gifts?.standardCount || 0} {isReconstructionWeapon ? t('dashboard.analysis.arsenalGiftReward') : t('dashboard.analysis.standardShort')}
              </span>
              <span className="text-blue-600 dark:text-cyan-400 font-medium">
                {stats.gifts?.limitedCount || 0} {isReconstructionWeapon ? t('dashboard.analysis.targetWeaponReward') : t('dashboard.analysis.limitedShort')}
              </span>
          </div>
          {isReconstructionWeapon && (
            <div className="text-[10px] text-slate-500 dark:text-zinc-500 font-mono">
              {t('dashboard.analysis.reconstructionWeaponGiftRule')}
            </div>
          )}
      </div>
  );
};

/**
 * 卡池分析卡片 (Dashboard Version)
 */
const PoolAnalysisCard = ({ currentPool, stats, effectivePity, checkLimitedInFirstN, specialProgress, hasMergedAccountView = false }) => {
  const { t, formatDateTime, locale } = useI18n();
  const pityState = getPoolAnalysisPityState(currentPool, stats, effectivePity);
  const capabilities = pityState.capabilities;
  const isExtra = currentPool.type === 'extra';
  const isLimited = currentPool.type === 'limited';
  const isWeapon = capabilities.entityType === 'weapon';
  const isStandard = capabilities.basePoolType === 'standard';
  const isReconstructionCharacter = capabilities.ruleProfile === EXTRA_RULE_PROFILES.RECONSTRUCTION_CHARACTER;
  const isReconstructionWeapon = capabilities.ruleProfile === EXTRA_RULE_PROFILES.RECONSTRUCTION_WEAPON;
  const hasLimitedCharacterProgress = capabilities.basePoolType === 'limited' && capabilities.entityType === 'character';
  const showsFeaturedRoster = capabilities.targetMode === 'four-target-equal';
  const localizedPoolName = localizePoolName(currentPool, { locale });
  const localizedFeaturedCharacters = localizePoolFeaturedList(currentPool, {
    locale,
    type: isWeapon ? 'weapon' : 'character'
  });
  const localizedUpCharacter = localizePoolFeaturedName(currentPool, { locale }) || localizeEntityName(currentPool?.up_character || currentPool?.upCharacter || '', {
      locale,
      type: isWeapon ? 'weapon' : 'character'
    });
  const paidTotal = stats.paidTotal ?? stats.total;
  const currentProbabilityInfo = useMemo(() => {
    if (currentPool?.isGroupMode || hasMergedAccountView) {
      return null;
    }

    return calculateCurrentProbability(pityState.displayPity6, currentPool);
  }, [currentPool, hasMergedAccountView, pityState.displayPity6]);
  const maxPity = pityState.maxPity6;
  
  // 颜色主题
  const accentColor = (isLimited || isExtra)
    ? (isExtra ? 'text-cyan-600 dark:text-cyan-400' : 'text-blue-600 dark:text-cyan-400')
    : isWeapon
      ? 'text-slate-600 dark:text-slate-400'
      : 'text-yellow-600 dark:text-endfield-yellow';
      
  const progressClass = isLimited
    ? 'rainbow-progress'
    : isExtra
      ? 'bg-cyan-500'
    : isWeapon 
      ? 'bg-slate-500' 
      : 'bg-yellow-500';
  const analysisTitle = isReconstructionWeapon
    ? t('dashboard.analysis.title.reconstructionWeapon')
    : isReconstructionCharacter
      ? t('dashboard.analysis.title.reconstructionCharacter')
      : isWeapon
        ? t('dashboard.analysis.title.weapon')
        : isLimited
      ? t('dashboard.analysis.title.limited')
      : isExtra
        ? t('pool.group.extra')
      : t('dashboard.analysis.title.standard');

  const validPullCount = checkLimitedInFirstN?.validPullCount || stats.total;

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 relative overflow-hidden shadow-sm">
      {/* 侧边装饰条 */}
      <div className={`absolute top-0 left-0 w-1.5 h-full ${isLimited ? 'rainbow-bg' : isExtra ? 'bg-cyan-500' : isWeapon ? 'bg-slate-600 dark:bg-slate-500' : 'bg-yellow-500'}`}></div>
      
      {/* 标题区域 */}
      <div className="mb-6 pl-2">
        <div className="flex justify-between items-start">
           <h3 className="text-lg font-bold text-slate-800 dark:text-zinc-100 flex items-center gap-2 uppercase tracking-wide">
             <Calculator size={20} className={accentColor} />
             {analysisTitle}
           </h3>
           {/* UP角色显示 */}
           {!isStandard && localizedUpCharacter && (
             <div className="min-w-0 text-right">
                <div className="text-[11px] text-slate-500 dark:text-zinc-400 uppercase font-medium">
                  {showsFeaturedRoster ? t('simulator.analysis.featuredRoster') : isWeapon ? t('dashboard.pool.upWeapon') : t('dashboard.pool.upCharacter')}
                </div>
                {showsFeaturedRoster ? (
                  <FeaturedRosterSummary names={localizedFeaturedCharacters} fallback={localizedUpCharacter} />
                ) : (
                  <div className="text-sm font-bold text-slate-800 dark:text-zinc-200">{localizedUpCharacter}</div>
                )}
             </div>
           )}
        </div>
        
        <div className="mt-2">
           <div className="flex items-center gap-2">
             <span className="text-xs text-slate-500 dark:text-zinc-400 uppercase font-medium">{t('dashboard.analysis.currentPool')}</span>
             <span className={`text-xs font-bold ${accentColor} uppercase`}>{localizedPoolName}</span>
           </div>
           
           {/* 时间信息只在限定池显示 */}
           {(isLimited || isExtra) && <PoolTimeInfo currentPool={currentPool} t={t} formatDateTime={formatDateTime} />}
        </div>
      </div>

      {/* 保底信息网格 */}
      {!hasMergedAccountView ? (
      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* 6星保底 */}
        {(() => {
          const displayPity = pityState.displayPity6;
          return (
            <StatCard
               label={isReconstructionWeapon
                 ? t('dashboard.analysis.reconstructionWeaponPity40')
                 : t('dashboard.analysis.pity6', { max: maxPity })}
               value={Math.max(maxPity - displayPity, 0)}
               subValue={t('dashboard.unit.pull')}
               progress={(displayPity / maxPity) * 100}
               progressColor={progressClass}
               warning={currentProbabilityInfo?.hasSoftPity && currentProbabilityInfo?.isInSoftPity
                 ? t('dashboard.analysis.rateBoost', { percent: (currentProbabilityInfo.probability * 100).toFixed(1) })
                 : null}
               footer={
                 <>
                    <span>{t('dashboard.analysis.currentPity', { count: displayPity })}</span>
                    {pityState.isInherited6 && (
                      <span className="text-purple-600 dark:text-purple-400 flex items-center gap-1"><Sparkles size={10}/> {t('dashboard.analysis.crossPoolCarry')}</span>
                    )}
                 </>
               }
            />
          );
        })()}
        {/* 5星保底 */}
        {(() => {
          const displayPity5 = pityState.displayPity5;
          return (
            <StatCard
               label={t('dashboard.analysis.pity5')}
               value={Math.max(10 - displayPity5, 0)}
               subValue={t('dashboard.unit.pull')}
               progress={(displayPity5 / 10) * 100}
               progressColor="bg-amber-500"
               footer={
                 <>
                    <span>{t('dashboard.analysis.currentPity', { count: displayPity5 })}</span>
                    {pityState.isInherited5 && (
                      <span className="text-purple-600 dark:text-purple-400 flex items-center gap-1"><Sparkles size={10}/> {t('dashboard.analysis.crossPoolCarry')}</span>
                    )}
                 </>
               }
            />
          );
        })()}
      </div>
      ) : (
        <div className="mb-4 border border-dashed border-zinc-200 bg-zinc-50 px-4 py-4 text-sm text-slate-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          {t('dashboard.analysis.mergedViewNote')}
        </div>
      )}

      {/* 数据概览网格 (限定/武器池显示) */}
      {(isLimited || isExtra || isWeapon) && (
        <div className="grid grid-cols-1 gap-4 mb-6">
           {/* 不歪率 */}
           <StatCard
             label={t('dashboard.analysis.winRate')}
             extraLabel={(isLimited || isExtra) ? (stats.includeFreePullsInStats ? t('dashboard.analysis.includeFreeTen') : t('dashboard.analysis.freeTenExcluded')) : null}
             value={stats.sixStarCount > 0 ? `${stats.winRate}%` : '-'}
             progress={stats.sixStarCount > 0 ? parseFloat(stats.winRate) : 0}
             progressColor={isLimited ? 'rainbow-progress' : isExtra ? 'bg-cyan-500' : 'bg-blue-500'}
             footer={
               stats.sixStarCount > 0
                 ? (
                   <span className="truncate">
                     {t('dashboard.analysis.winRateBreakdown', {
                       up: stats.upSixStarCount,
                       offStandard: stats.offStandardCount ?? (stats.sixStarCount - stats.upSixStarCount),
                       offLimited: stats.offLimitedCount ?? 0,
                     })}
                   </span>
                 )
                 : t('dashboard.analysis.noSixStarData')
             }
           />
        </div>
      )}

      <AveragePullStatsPanel
        stats={stats}
        poolType={pityState.normalizedType}
        className="mb-6"
      />

      {/* 特殊进度列表 (Technical List Style) */}
      <div className="space-y-3 pt-4 border-t border-zinc-200 dark:border-zinc-800">
         <div className="text-[11px] uppercase text-slate-600 dark:text-zinc-400 font-bold tracking-wider mb-2">{t('dashboard.analysis.specialProgress')}</div>
         
         {(specialProgress?.freeTenMilestones || []).map((milestone) => (
           <div key={milestone.threshold} className={`bg-zinc-50 dark:bg-zinc-900 p-3 border-l-2 ${isExtra ? 'border-cyan-500' : 'border-blue-500'} flex flex-col gap-2`}>
             <div className="flex justify-between items-center">
               <span className="text-xs text-slate-700 dark:text-zinc-300 font-bold">
                 {isReconstructionCharacter
                   ? t('dashboard.analysis.freeTenMilestone', { count: milestone.threshold })
                   : `${t('dashboard.analysis.freeTenOnce')} · ${milestone.threshold}`}
               </span>
               <span className="text-xs font-mono text-slate-500 dark:text-zinc-500">
                 {milestone.received
                   ? t('dashboard.analysis.claimed')
                   : milestone.reached
                     ? t('dashboard.analysis.reached')
                     : `${milestone.progress} / ${milestone.threshold}`}
               </span>
             </div>
             <div className="h-1.5 bg-zinc-200 dark:bg-zinc-800 w-full overflow-hidden rounded-sm">
               <div
                 className={`h-full ${milestone.received ? 'bg-green-500' : isExtra ? 'bg-cyan-500' : 'bg-blue-500'}`}
                 style={{ width: `${milestone.received ? 100 : Math.min((milestone.progress / milestone.threshold) * 100, 100)}%` }}
               ></div>
             </div>
             <span className="text-[11px] text-slate-600 dark:text-zinc-400">{t('dashboard.analysis.notCountPity')}</span>
           </div>
         ))}

         {/* 限定角色规则进度；重构角色仍保留 extra 视觉样式 */}
         {hasLimitedCharacterProgress && (
           <>
             <div className="bg-zinc-50 dark:bg-zinc-900 p-3 border-l-2 border-green-500 flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-700 dark:text-zinc-300 font-bold">
                    {isReconstructionCharacter
                      ? t('dashboard.analysis.reconstructionCharacterGuarantee120')
                      : t('dashboard.analysis.guaranteedLimited120')}
                  </span>
                  <span className="text-xs font-mono text-slate-500 dark:text-zinc-500">
                    {specialProgress?.targetGuarantee?.reached
                      ? t('dashboard.analysis.reached')
                      : `${specialProgress?.targetGuarantee?.progress ?? Math.min(validPullCount, 120)} / 120`}
                  </span>
                </div>
                <div className="h-1.5 bg-zinc-200 dark:bg-zinc-800 w-full overflow-hidden rounded-sm">
                  <div className={`h-full ${specialProgress?.targetGuarantee?.reached ? 'bg-green-500' : isExtra ? 'bg-cyan-500' : 'rainbow-progress'}`}
                       style={{width: `${specialProgress?.targetGuarantee?.reached ? 100 : Math.min(((specialProgress?.targetGuarantee?.progress ?? validPullCount) / 120) * 100, 100)}%`}}></div>
                </div>
             </div>

             <div className="bg-zinc-50 dark:bg-zinc-900 p-3 border-l-2 border-purple-500 flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-700 dark:text-zinc-300 font-bold">
                    {isReconstructionCharacter
                      ? t('dashboard.analysis.reconstructionCharacterToken240')
                      : t('dashboard.analysis.potential240')}
                  </span>
                  <span className="text-xs font-mono text-slate-500 dark:text-zinc-500">{(specialProgress?.paidTotal ?? paidTotal) % 240} / 240</span>
                </div>
                <div className="h-1.5 bg-zinc-200 dark:bg-zinc-800 w-full overflow-hidden rounded-sm">
                  <div className="h-full bg-purple-500" style={{width: `${(((specialProgress?.paidTotal ?? paidTotal) % 240) / 240) * 100}%`}}></div>
                </div>
             </div>

             {capabilities.infoBookEnabled && <div className="bg-zinc-50 dark:bg-zinc-900 p-3 border-l-2 border-cyan-500 flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-700 dark:text-zinc-300 font-bold flex items-center gap-1"><FileText size={12}/> {t('dashboard.analysis.infoBook60')}</span>
                  <span className="text-xs font-mono text-slate-500 dark:text-zinc-500">{stats.hasInfoBook ? t('dashboard.analysis.reached') : `${Math.min(paidTotal, 60)} / 60`}</span>
                </div>
                <div className="h-1.5 bg-zinc-200 dark:bg-zinc-800 w-full overflow-hidden rounded-sm">
                  <div className={`h-full ${stats.hasInfoBook ? 'bg-green-500' : 'bg-cyan-500'}`} 
                       style={{width: `${stats.hasInfoBook ? 100 : Math.min((paidTotal / 60) * 100, 100)}%`}}></div>
                </div>
             </div>}
           </>
         )}

         {/* 武器池特殊进度 */}
         {isWeapon && (
           <>
             {/* 80 Spark */}
             <div className="bg-zinc-50 dark:bg-zinc-900 p-3 border-l-2 border-slate-500 flex flex-col gap-2">
                <div className="flex justify-between items-center">
                   <span className="text-xs text-slate-700 dark:text-zinc-300 font-bold">
                     {isReconstructionWeapon
                       ? t('dashboard.analysis.reconstructionWeaponGuarantee80')
                       : t('dashboard.analysis.guaranteedWeapon80')}
                   </span>
                   <span className="text-xs font-mono text-slate-500 dark:text-zinc-500">
                     {specialProgress?.targetGuarantee?.reached
                       ? t('dashboard.analysis.reached')
                       : `${specialProgress?.targetGuarantee?.progress ?? Math.min(validPullCount, 80)} / 80`}
                   </span>
                </div>
                <div className="h-1.5 bg-zinc-200 dark:bg-zinc-800 w-full overflow-hidden rounded-sm">
                   <div className={`h-full ${specialProgress?.targetGuarantee?.reached ? 'bg-green-500' : 'bg-slate-500'}`}
                        style={{width: `${specialProgress?.targetGuarantee?.reached ? 100 : Math.min(((specialProgress?.targetGuarantee?.progress ?? validPullCount) / 80) * 100, 100)}%`}}></div>
                </div>
             </div>
             
             {/* 武器赠送 */}
             {currentPool.isLimitedWeapon !== false && <WeaponGifts stats={stats} capabilities={capabilities} t={t} />}
           </>
         )}

         {/* 常驻池特殊进度 */}
         {isStandard && (
            <div className="bg-zinc-50 dark:bg-zinc-900 p-3 border-l-2 border-green-500 flex flex-col gap-2">
               <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-700 dark:text-zinc-300 font-bold">{t('dashboard.analysis.firstSelector300')}</span>
                  <span className="text-xs font-mono text-slate-500 dark:text-zinc-500">{Math.min(paidTotal, 300)} / 300</span>
               </div>
               <div className="h-1.5 bg-zinc-200 dark:bg-zinc-800 w-full overflow-hidden rounded-sm">
                  <div className={`h-full ${paidTotal >= 300 ? 'bg-green-500' : 'bg-green-600/50'}`}
                       style={{width: `${Math.min((paidTotal / 300) * 100, 100)}%`}}></div>
               </div>
            </div>
         )}
      </div>
    </div>
  );
};

export default PoolAnalysisCard;
