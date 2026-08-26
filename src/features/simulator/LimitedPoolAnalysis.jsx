import React from 'react';
import { Calculator, FileText, Flag, Sparkles } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import { localizeEntityName, localizePoolFeaturedList, localizePoolFeaturedName, localizePoolName } from '../../utils/gameDataI18n.js';
import { EXTRA_RULE_PROFILES, resolvePoolCapabilities } from '../../utils/poolCapabilities.js';

/**
 * 限定池分析组件
 * 显示保底进度、特殊进度（120抽、240抽、30抽赠送）
 * 风格：Endfield Technical Style (适配深/浅色模式)
 */

// Reusable Card Component
const StatCard = ({ label, value, subValue, footer, progress, progressColor, extraLabel, warning }) => (
  <div className="bg-zinc-50 dark:bg-endfield-panel border border-zinc-200 dark:border-endfield-border p-4 relative group hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors">
    <div className="flex justify-between items-start mb-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-endfield-muted font-bold flex items-center gap-2">
        {label}
        {extraLabel && <span className="bg-zinc-200 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400 px-1 py-0.5 text-[8px]">{extraLabel}</span>}
      </div>
      {warning && (
        <div className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50 text-[9px] font-mono animate-pulse">
          {warning}
        </div>
      )}
    </div>
    
    <div className="flex items-baseline gap-2 mb-3">
      <span className="text-3xl font-bold font-mono text-slate-800 dark:text-endfield-text">{value}</span>
      {subValue && <span className="text-sm font-mono text-slate-500 dark:text-endfield-muted">{subValue}</span>}
    </div>

    <div className="relative h-1 w-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
      <div 
        className={`absolute top-0 left-0 h-full transition-all duration-500 ${progressColor}`}
        style={{ width: `${Math.min(progress, 100)}%` }}
      ></div>
    </div>

    {footer && <div className="mt-2 text-[10px] text-slate-500 dark:text-endfield-muted font-mono">{footer}</div>}
  </div>
);

const RECONSTRUCTION_FREE_TEN_MILESTONES = [30, 60, 90];

const reconstructionStageClasses = {
  claimed: {
    card: 'border-green-400 bg-green-50 dark:border-green-700 dark:bg-green-950/30',
    flag: 'text-green-600 dark:text-green-400',
    status: 'text-green-700 dark:text-green-400',
  },
  available: {
    card: 'border-cyan-500 bg-cyan-50 dark:border-amber-400 dark:bg-amber-950/30',
    flag: 'text-cyan-600 dark:text-amber-300',
    status: 'text-cyan-700 dark:text-amber-300',
  },
  locked: {
    card: 'border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/60',
    flag: 'text-zinc-400 dark:text-zinc-600',
    status: 'text-slate-500 dark:text-zinc-400',
  },
};

const ReconstructionFreeTenProgress = ({ paidTotal, received, formatCount, t }) => {
  const maxProgress = 90;
  const numericPaidTotal = Number(paidTotal);
  const paidProgress = Math.min(
    Math.max(Number.isFinite(numericPaidTotal) ? numericPaidTotal : 0, 0),
    maxProgress
  );
  const numericReceived = Number(received);
  const receivedCount = Math.min(
    RECONSTRUCTION_FREE_TEN_MILESTONES.length,
    Math.max(Number.isFinite(numericReceived) ? Math.trunc(numericReceived) : 0, 0)
  );
  const stages = RECONSTRUCTION_FREE_TEN_MILESTONES.map((threshold, index) => {
    const status = index < receivedCount
      ? 'claimed'
      : paidProgress >= threshold
        ? 'available'
        : 'locked';

    return {
      threshold,
      status,
      remaining: Math.max(threshold - paidProgress, 0),
      anchor: index === RECONSTRUCTION_FREE_TEN_MILESTONES.length - 1
        ? '100%'
        : `${((threshold / maxProgress) * 100).toFixed(3)}%`,
    };
  });
  const availableCount = stages.filter((stage) => stage.status === 'available').length;
  const nextLockedStage = stages.find((stage) => stage.status === 'locked');
  const summary = availableCount > 0
    ? t('dashboard.analysis.reconstructionFreeTen.summary.available', { count: availableCount })
    : receivedCount === RECONSTRUCTION_FREE_TEN_MILESTONES.length
      ? t('dashboard.analysis.reconstructionFreeTen.summary.allClaimed')
      : t('dashboard.analysis.reconstructionFreeTen.summary.next', {
          count: formatCount(nextLockedStage?.remaining || 0),
        });
  const title = t('dashboard.analysis.reconstructionFreeTen.title');

  return (
    <section
      aria-label={title}
      className="bg-zinc-50 dark:bg-endfield-panel p-3 border-l-2 border-cyan-500"
      data-testid="reconstruction-free-ten-panel"
    >
      <div className="flex flex-wrap justify-between items-baseline gap-2">
        <h4 className="text-xs text-slate-700 dark:text-endfield-text font-bold">{title}</h4>
        <span className="text-xs font-mono text-slate-500 dark:text-endfield-muted">
          {formatCount(paidProgress)} / {formatCount(maxProgress)}
        </span>
      </div>

      <div className="px-3 pt-8 pb-1">
        <div className="relative overflow-visible">
          <div
            aria-label={title}
            aria-valuemax={maxProgress}
            aria-valuemin={0}
            aria-valuenow={paidProgress}
            aria-valuetext={t('dashboard.analysis.reconstructionFreeTen.progressValue', {
              current: formatCount(paidProgress),
              max: formatCount(maxProgress),
            })}
            className="h-2 w-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden"
            role="progressbar"
          >
            <div
              className="h-full bg-cyan-500 transition-all duration-500"
              style={{ width: `${(paidProgress / maxProgress) * 100}%` }}
            />
          </div>
          {stages.map((stage) => (
            <Flag
              key={stage.threshold}
              aria-hidden="true"
              className={`absolute bottom-3 -translate-x-1/2 fill-current ${reconstructionStageClasses[stage.status].flag}`}
              data-status={stage.status}
              data-testid="reconstruction-free-ten-flag"
              size={18}
              strokeWidth={2.5}
              style={{ left: stage.anchor }}
            />
          ))}
        </div>
        <div className="flex justify-between mt-1 text-[9px] font-mono text-slate-400 dark:text-zinc-500" aria-hidden="true">
          <span>0</span>
          <span>{maxProgress}</span>
        </div>
      </div>

      <ol className="grid grid-cols-3 gap-2 mt-2">
        {stages.map((stage) => (
          <li
            key={stage.threshold}
            className={`min-w-0 border p-2 ${reconstructionStageClasses[stage.status].card}`}
            data-status={stage.status}
          >
            <div className="text-xs font-bold font-mono text-slate-700 dark:text-endfield-text">
              {t('dashboard.analysis.reconstructionFreeTen.stage', { count: stage.threshold })}
            </div>
            <div className={`mt-1 text-[10px] font-bold ${reconstructionStageClasses[stage.status].status}`}>
              {t(`dashboard.analysis.reconstructionFreeTen.status.${stage.status}`)}
            </div>
            {stage.status === 'locked' && (
              <div className="mt-1 text-[9px] text-slate-500 dark:text-endfield-muted">
                {t('dashboard.analysis.reconstructionFreeTen.remaining', {
                  count: formatCount(stage.remaining),
                })}
              </div>
            )}
          </li>
        ))}
      </ol>

      <p className={`mt-3 text-[10px] font-bold ${
        availableCount > 0
          ? 'text-cyan-700 dark:text-amber-300'
          : receivedCount === RECONSTRUCTION_FREE_TEN_MILESTONES.length
            ? 'text-green-700 dark:text-green-400'
            : 'text-slate-500 dark:text-endfield-muted'
      }`}>
        {summary}
      </p>
      <p className="mt-1 text-[9px] text-slate-500 dark:text-endfield-muted">
        {t('dashboard.analysis.notCountPity')}
      </p>
    </section>
  );
};

// Helper component for Weapon Gifts to keep main component clean
const WeaponGifts = ({ stats, capabilities, locale, t }) => {
  const paidTotal = Number(stats.rewardPaidTotal ?? stats.paidTotal ?? stats.total ?? 0);
  const firstStandardGift = Number(capabilities.rules?.firstStandardGift || 100);
  const firstLimitedGift = Number(capabilities.rules?.firstLimitedGift || 180);
  const alternateInterval = Number(capabilities.rules?.giftAlternateInterval || 80);
  const isReconstructionWeapon = capabilities.ruleProfile === EXTRA_RULE_PROFILES.RECONSTRUCTION_WEAPON;
  let nextWeaponGift = paidTotal < firstStandardGift ? firstStandardGift : firstLimitedGift;
  let nextWeaponGiftType = paidTotal < firstStandardGift ? 'standard' : 'limited';

  if (paidTotal >= firstLimitedGift && alternateInterval > 0) {
    const completedIntervals = Math.floor((paidTotal - firstLimitedGift) / alternateInterval);
    nextWeaponGift = firstLimitedGift + (completedIntervals + 1) * alternateInterval;
    nextWeaponGiftType = completedIntervals % 2 === 0 ? 'standard' : 'limited';
  }

  const formatCount = (value) => new Intl.NumberFormat(locale).format(Number(value) || 0);
  const nextGiftTypeLabel = isReconstructionWeapon
    ? nextWeaponGiftType === 'limited'
      ? t('dashboard.analysis.targetWeaponReward')
      : t('dashboard.analysis.arsenalGiftReward')
    : nextWeaponGiftType === 'limited'
      ? t('dashboard.analysis.limitedShort')
      : t('dashboard.analysis.standardShort');
  const currentProgress = isReconstructionWeapon ? paidTotal / 10 : paidTotal;
  const nextProgress = isReconstructionWeapon ? nextWeaponGift / 10 : nextWeaponGift;

  return (
    <div className="bg-zinc-50 dark:bg-endfield-panel p-2 border-l-2 border-red-500 flex flex-col gap-1">
      <div className="flex justify-between items-center">
        <span className="text-xs text-slate-700 dark:text-endfield-text font-bold flex items-center gap-2">
          {t('dashboard.analysis.nextGift')}
          <span className={`px-1 rounded text-[8px] font-bold text-black ${nextWeaponGiftType === 'limited' ? 'rainbow-bg' : 'bg-red-500'}`}>
            {nextGiftTypeLabel}
          </span>
        </span>
        <span className="text-xs font-mono text-slate-500 dark:text-endfield-muted">
          {formatCount(currentProgress)} / {formatCount(nextProgress)}
          {isReconstructionWeapon ? ` ${t('dashboard.unit.claim')}` : ''}
        </span>
      </div>
      <div className="h-1 bg-zinc-200 dark:bg-zinc-800 w-full overflow-hidden">
        <div
          className={`h-full ${nextWeaponGiftType === 'limited' ? 'rainbow-progress' : 'bg-red-500'}`}
          style={{ width: `${Math.min((paidTotal / nextWeaponGift) * 100, 100)}%` }}
        />
      </div>
      <div className="flex gap-2 text-[9px] text-slate-500 dark:text-endfield-muted font-mono mt-1">
        <span>{t('dashboard.analysis.obtainedSummary')}</span>
        <span className="text-red-500 dark:text-red-400">
          {formatCount(stats.gifts?.standardCount || 0)} {isReconstructionWeapon ? t('dashboard.analysis.arsenalGiftReward') : t('dashboard.analysis.standardShort')}
        </span>
        <span className="text-blue-500 dark:text-cyan-400">
          {formatCount(stats.gifts?.limitedCount || 0)} {isReconstructionWeapon ? t('dashboard.analysis.targetWeaponReward') : t('dashboard.analysis.limitedShort')}
        </span>
      </div>
      {isReconstructionWeapon && (
        <div className="text-[9px] text-slate-500 dark:text-endfield-muted font-mono">
          {t('dashboard.analysis.reconstructionWeaponGiftRule')}
        </div>
      )}
    </div>
  );
};

const LimitedPoolAnalysis = ({ currentPool, stats, effectivePity, pityInfo }) => {
  const { t, locale } = useI18n();
  const capabilities = resolvePoolCapabilities(currentPool);
  const isLimited = capabilities.rawPoolType === 'limited';
  const isExtra = currentPool.type === 'extra';
  const isWeapon = capabilities.entityType === 'weapon';
  const isStandard = capabilities.basePoolType === 'standard';
  const isReconstructionCharacter = capabilities.ruleProfile === EXTRA_RULE_PROFILES.RECONSTRUCTION_CHARACTER;
  const isReconstructionWeapon = capabilities.ruleProfile === EXTRA_RULE_PROFILES.RECONSTRUCTION_WEAPON;
  const hasLimitedCharacterProgress = capabilities.basePoolType === 'limited' && capabilities.entityType === 'character';
  const targetProbabilityInfo = stats.targetProbabilityInfo;
  const currentTargetProbabilityPercent = targetProbabilityInfo
    ? (targetProbabilityInfo.probability * 100).toFixed(2)
    : null;
  const targetRatePercent = targetProbabilityInfo
    ? (targetProbabilityInfo.targetRate * 100).toFixed(1)
    : null;
  const targetLabel = isWeapon ? t('simulator.analysis.targetWeapon') : t('simulator.analysis.targetCharacter');
  const targetRateLabel = isWeapon ? t('simulator.analysis.targetRate') : t('simulator.analysis.upRate');
  const targetProbabilityFooter = targetProbabilityInfo
    ? targetProbabilityInfo.isHardGuaranteeNextPull
      ? t(
          isWeapon ? 'simulator.analysis.targetClaimGuaranteed' : 'simulator.analysis.targetGuaranteed',
          { label: targetLabel }
        )
      : t(isWeapon ? 'simulator.analysis.targetClaimProbabilityDetail' : 'simulator.analysis.targetProbabilityDetail', {
          label: targetLabel,
          current: currentTargetProbabilityPercent,
          rateLabel: targetRateLabel,
          rate: targetRatePercent,
        })
    : t('simulator.analysis.noTargetProbability');

  const maxPity = Number(capabilities.rules?.sixStarPity || (isWeapon ? 40 : 80));
  
  // Theme Colors - Adjusted for Light/Dark mode
  // Light: text-blue-600, text-slate-600, text-yellow-600
  // Dark: text-cyan-400, text-slate-400, text-endfield-yellow
  const accentColor = isLimited 
    ? 'text-blue-600 dark:text-cyan-400' 
    : isExtra
      ? 'text-cyan-600 dark:text-cyan-400'
    : isWeapon 
      ? 'text-slate-600 dark:text-slate-400' 
      : 'text-yellow-600 dark:text-endfield-yellow';
      
  const progressClass = isLimited 
    ? 'rainbow-progress' 
    : isExtra
      ? 'bg-cyan-500'
    : isWeapon 
      ? 'bg-slate-500' 
      : 'bg-yellow-500 dark:bg-endfield-yellow';

  // Format Helper
  const formatCount = (value) => new Intl.NumberFormat(locale).format(Number(value) || 0);
  const formatProgress = (current, target) => `${formatCount(current)} / ${formatCount(target)}`;
  const formatNumber = (num) => {
    if (num === undefined || num === null || num === '-') return '-';
    const val = parseFloat(num);
    if (Number.isNaN(val)) return num;
    return val.toLocaleString(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: Number.isInteger(val) ? 0 : 1,
    });
  };
  const localizedCurrentPoolName = localizePoolName(currentPool, { locale }) || currentPool?.name || '-';
  const localizedFeaturedCharacters = localizePoolFeaturedList(currentPool, {
    locale,
    type: isWeapon ? 'weapon' : 'character'
  });
  const localizedUpCharacter = localizePoolFeaturedName(currentPool, { locale }) || localizeEntityName(currentPool?.up_character || '', {
    locale,
    type: isWeapon ? 'weapon' : 'character'
  });
  const featuredDisplay = capabilities.targetMode === 'four-target-equal'
    ? localizedFeaturedCharacters.join(' / ')
    : localizedUpCharacter;
  const rewardPaidTotal = Number(stats.rewardPaidTotal ?? stats.paidTotal ?? stats.total ?? 0);
  const freeTenReceived = Number(stats.freeTenPulls?.received || 0);
  const targetGuarantee = pityInfo?.guaranteedUp || stats.guaranteeState || null;
  const targetGuaranteeProgress = Math.min(
    Number(targetGuarantee?.current || 0),
    Number(capabilities.rules?.guaranteedLimitedPity || 0)
  );
  const analysisTitle = isReconstructionWeapon
    ? t('dashboard.analysis.title.reconstructionWeapon')
    : isReconstructionCharacter
      ? t('dashboard.analysis.title.reconstructionCharacter')
      : isWeapon
        ? t('dashboard.analysis.title.weapon')
        : isExtra
          ? t('dashboard.analysis.title.extra')
          : isLimited
            ? t('dashboard.analysis.title.limited')
            : t('dashboard.analysis.title.standard');

  return (
    <div className="bg-white dark:bg-endfield-dark border border-zinc-200 dark:border-endfield-border p-6 relative overflow-hidden">
      {/* Decorative Side Bar */}
      <div className={`absolute top-0 left-0 w-1 h-full ${isLimited ? 'rainbow-bg' : isExtra ? 'bg-cyan-500' : isWeapon ? 'bg-slate-600 dark:bg-slate-700' : 'bg-yellow-500 dark:bg-endfield-yellow'}`}></div>
      
      {/* Header */}
      <div className="flex justify-between items-end mb-6 pl-2">
        <div>
          <h3 className="text-xl font-bold text-slate-800 dark:text-endfield-text flex items-center gap-2 uppercase tracking-wide">
            <Calculator size={20} className={accentColor} />
            {analysisTitle}
          </h3>
          <div className="flex items-center gap-2 mt-1">
             <span className="text-xs text-slate-500 dark:text-endfield-muted uppercase">{t('dashboard.analysis.currentPool')}</span>
             <span className={`text-xs font-bold ${accentColor} uppercase`}>{localizedCurrentPoolName}</span>
          </div>
        </div>
        {(isLimited || isWeapon || isExtra) && featuredDisplay && (
           <div className="text-right">
             <div className="text-[10px] text-slate-500 dark:text-endfield-muted uppercase">
               {capabilities.targetMode === 'four-target-equal' ? t('simulator.analysis.featuredRoster') : t('pool.card.currentUp')}
             </div>
             <div className="text-sm font-bold text-slate-800 dark:text-endfield-text">{featuredDisplay}</div>
           </div>
        )}
      </div>

      {/* Pity Stats Grid */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <StatCard 
           label={isReconstructionWeapon
             ? t('dashboard.analysis.reconstructionWeaponPity40')
             : t('dashboard.analysis.pity6', { max: maxPity })}
           value={formatCount(Math.max(maxPity - stats.currentPity, 0))}
           subValue={t('simulator.analysis.pullUnit')}
           progress={(stats.currentPity / maxPity) * 100}
           progressColor={progressClass}
           warning={
             stats.probabilityInfo?.hasSoftPity && stats.probabilityInfo?.isInSoftPity
               ? t('simulator.analysis.currentSixChance', {
                   percent: (stats.probabilityInfo.probability * 100).toFixed(1),
                 })
               : null
           }
           footer={
             <div className="flex justify-between">
                <span>{t('dashboard.analysis.currentPity', { count: formatCount(stats.currentPity) })}</span>
                {effectivePity?.isInherited && isLimited && (
                  <span className="text-purple-600 dark:text-purple-400 flex items-center gap-1">
                    <Sparkles size={10} />
                    {t('simulator.analysis.inheritedPity', { count: formatCount(effectivePity.pity6) })}
                  </span>
                )}
             </div>
           }
        />
        <StatCard 
           label={t('dashboard.analysis.pity5')}
           value={formatCount(Math.max(10 - stats.currentPity5, 0))}
           subValue={t('simulator.analysis.pullUnit')}
           progress={(stats.currentPity5 / 10) * 100}
           progressColor="bg-amber-500"
           footer={
             <div className="flex justify-between">
                <span>{t('dashboard.analysis.currentPity', { count: formatCount(stats.currentPity5) })}</span>
                {effectivePity?.isInherited && isLimited && effectivePity.pity5 > 0 && (
                  <span className="text-purple-600 dark:text-purple-400 flex items-center gap-1">
                    <Sparkles size={10} />
                    {t('simulator.analysis.inheritedPity', { count: formatCount(effectivePity.pity5) })}
                  </span>
                )}
             </div>
           }
        />
      </div>

      {/* Analytics Grid */}
      {(isLimited || isWeapon || isExtra) && (
        <div className="grid grid-cols-2 gap-4 mb-6">
           <StatCard 
             label={t('simulator.analysis.target6Chance')}
             extraLabel={targetProbabilityInfo?.isHardGuaranteeNextPull ? t('simulator.analysis.hardGuarantee') : t('simulator.analysis.dynamic')}
             value={targetProbabilityInfo ? `${currentTargetProbabilityPercent}%` : '-'}
             progress={targetProbabilityInfo ? parseFloat(currentTargetProbabilityPercent) : 0}
             progressColor={isLimited ? 'rainbow-progress' : isExtra ? 'bg-cyan-500' : 'bg-blue-500'}
             footer={
               stats.sixStarCount > 0
                 ? `${targetProbabilityFooter} · ${t('dashboard.analysis.winRate')} ${stats.winRate}%`
                 : targetProbabilityFooter
             }
           />
           <StatCard 
             label={t('simulator.analysis.averageTitle')}
             extraLabel={isLimited ? t('simulator.analysis.averageBadgeLimited') : isExtra ? t('simulator.analysis.averageBadgeExtra') : isWeapon ? t('simulator.analysis.averageBadgeWeapon') : null}
             value={stats.upSixStarCount > 0 ? formatNumber(stats.avgPullCost?.[6] || stats.avgPullsPerSixStar) : '-'}
             subValue={stats.upSixStarCount > 0 ? t('simulator.analysis.averageUnitUp') : null}
             progress={0}
             progressColor="bg-transparent"
             footer={stats.upSixStarCount > 0 ? t('simulator.analysis.averageBasedOnUp') : t('simulator.analysis.noUpData')}
           />
        </div>
      )}

      {/* Special Progress Section (Technical List Style) */}
      <div className="space-y-3 pt-4 border-t border-zinc-200 dark:border-endfield-border">
         <div className="text-[10px] uppercase text-slate-500 dark:text-endfield-muted font-bold tracking-wider mb-2">{t('dashboard.analysis.specialProgress')}</div>
         
         {isReconstructionCharacter ? (
           <ReconstructionFreeTenProgress
             formatCount={formatCount}
             paidTotal={rewardPaidTotal}
             received={freeTenReceived}
             t={t}
           />
         ) : (
           (capabilities.freeTenPullMilestones || []).map((threshold, index) => {
             const received = freeTenReceived >= index + 1;
             const progress = Math.min(rewardPaidTotal, threshold);
             return (
               <div key={threshold} className={`bg-zinc-50 dark:bg-endfield-panel p-2 border-l-2 ${isExtra ? 'border-cyan-500' : 'border-blue-500'} flex flex-col gap-1`}>
                 <div className="flex justify-between items-center">
                   <span className="text-xs text-slate-700 dark:text-endfield-text font-bold">
                     {t('dashboard.analysis.freeTenOnce')}
                   </span>
                   <span className="text-xs font-mono text-slate-500 dark:text-endfield-muted">
                     {received ? t('dashboard.analysis.claimed') : formatProgress(progress, threshold)}
                   </span>
                 </div>
                 <div className="h-1 bg-zinc-200 dark:bg-zinc-800 w-full overflow-hidden">
                   <div
                     className={`h-full ${received ? 'bg-green-500' : isExtra ? 'bg-cyan-500' : 'bg-blue-500'}`}
                     style={{ width: `${received ? 100 : Math.min((progress / threshold) * 100, 100)}%` }}
                   ></div>
                 </div>
                 <div className="flex justify-between items-center mt-1">
                   <span className="text-[9px] text-slate-500 dark:text-endfield-muted">{t('dashboard.analysis.notCountPity')}</span>
                   {received && (
                     <span className="text-[9px] text-green-600 dark:text-green-400 font-bold">
                       {t('dashboard.analysis.completed')} ({t('simulator.analysis.oneTimeOnly')})
                     </span>
                   )}
                 </div>
               </div>
             );
           })
         )}

         {hasLimitedCharacterProgress && (
           <>
             <div className="bg-zinc-50 dark:bg-endfield-panel p-2 border-l-2 border-green-500 flex flex-col gap-1">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-700 dark:text-endfield-text font-bold">
                    {isReconstructionCharacter
                      ? t('dashboard.analysis.reconstructionCharacterGuarantee120')
                      : t('dashboard.analysis.guaranteedLimited120')}
                  </span>
                  <span className="text-xs font-mono text-slate-500 dark:text-endfield-muted">
                    {targetGuarantee?.hasReceived ? t('dashboard.analysis.reached') : formatProgress(targetGuaranteeProgress, 120)}
                  </span>
                </div>
                <div className="h-1 bg-zinc-200 dark:bg-zinc-800 w-full overflow-hidden">
                  <div className={`h-full ${targetGuarantee?.hasReceived ? 'bg-green-500' : isExtra ? 'bg-cyan-500' : 'rainbow-progress'}`}
                       style={{width: `${targetGuarantee?.hasReceived ? 100 : Math.min((targetGuaranteeProgress / 120) * 100, 100)}%`}}></div>
                </div>
             </div>

             <div className="bg-zinc-50 dark:bg-endfield-panel p-2 border-l-2 border-purple-500 flex flex-col gap-1">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-700 dark:text-endfield-text font-bold">
                    {isReconstructionCharacter
                      ? t('dashboard.analysis.reconstructionCharacterToken240')
                      : t('dashboard.analysis.potential240')}
                  </span>
                  <span className="text-xs font-mono text-slate-500 dark:text-endfield-muted">{formatProgress(rewardPaidTotal % 240, 240)}</span>
                </div>
                <div className="h-1 bg-zinc-200 dark:bg-zinc-800 w-full overflow-hidden">
                  <div className="h-full bg-purple-500" style={{width: `${((rewardPaidTotal % 240) / 240) * 100}%`}}></div>
                </div>
                {Math.floor(rewardPaidTotal / 240) > 0 && (
                  <div className="text-right text-[9px] text-purple-600 dark:text-purple-400 font-bold">
                    {t('dashboard.analysis.obtained', { count: formatCount(Math.floor(rewardPaidTotal / 240)) })}
                  </div>
                )}
             </div>

             {capabilities.infoBookEnabled && (
               <div className="bg-zinc-50 dark:bg-endfield-panel p-2 border-l-2 border-cyan-500 flex flex-col gap-1">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-700 dark:text-endfield-text font-bold flex items-center gap-1"><FileText size={10}/> {t('dashboard.analysis.infoBook60')}</span>
                    <span className="text-xs font-mono text-slate-500 dark:text-endfield-muted">
                      {stats.hasInfoBook ? t('dashboard.analysis.reached') : formatProgress(Math.min(stats.total, 60), 60)}
                    </span>
                  </div>
                  <div className="h-1 bg-zinc-200 dark:bg-zinc-800 w-full overflow-hidden">
                    <div className={`h-full ${stats.hasInfoBook ? 'bg-green-500' : 'bg-cyan-500'}`}
                         style={{width: `${stats.hasInfoBook ? 100 : Math.min((stats.total / 60) * 100, 100)}%`}}></div>
                  </div>
               </div>
             )}
           </>
         )}

         {/* Weapon Pool Specials */}
         {isWeapon && (
           <>
             {/* 80 Spark */}
             <div className="bg-zinc-50 dark:bg-endfield-panel p-2 border-l-2 border-slate-500 flex flex-col gap-1">
                <div className="flex justify-between items-center">
                   <span className="text-xs text-slate-700 dark:text-endfield-text font-bold">
                     {isReconstructionWeapon
                       ? t('dashboard.analysis.reconstructionWeaponGuarantee80')
                       : t('dashboard.analysis.guaranteedWeapon80')}
                   </span>
                   <span className="text-xs font-mono text-slate-500 dark:text-endfield-muted">
                     {targetGuarantee?.hasReceived ? t('dashboard.analysis.reached') : formatProgress(targetGuaranteeProgress, 80)}
                   </span>
                </div>
                <div className="h-1 bg-zinc-200 dark:bg-zinc-800 w-full overflow-hidden">
                   <div className={`h-full ${targetGuarantee?.hasReceived ? 'bg-green-500' : 'bg-slate-500'}`}
                        style={{width: `${targetGuarantee?.hasReceived ? 100 : Math.min((targetGuaranteeProgress / 80) * 100, 100)}%`}}></div>
                </div>
             </div>
             
             {/* Weapon Gifts */}
             {currentPool.isLimitedWeapon !== false && <WeaponGifts stats={stats} capabilities={capabilities} locale={locale} t={t} />}
           </>
         )}

         {/* Standard Pool Specials */}
         {isStandard && (
            <div className="bg-zinc-50 dark:bg-endfield-panel p-2 border-l-2 border-green-500 flex flex-col gap-1">
               <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-700 dark:text-endfield-text font-bold">{t('dashboard.analysis.firstSelector300')}</span>
                  <span className="text-xs font-mono text-slate-500 dark:text-endfield-muted">{formatProgress(Math.min(stats.total, 300), 300)}</span>
               </div>
               <div className="h-1 bg-zinc-200 dark:bg-zinc-800 w-full overflow-hidden">
                  <div className={`h-full ${stats.total >= 300 ? 'bg-green-500' : 'bg-green-600/50'}`}
                       style={{width: `${Math.min((stats.total / 300) * 100, 100)}%`}}></div>
               </div>
            </div>
         )}
      </div>
    </div>
  );
};

export default LimitedPoolAnalysis;
