import React, { useRef } from 'react';
import { Layers, Search, Star } from 'lucide-react';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import SimulatorResults from './SimulatorResults';
import SimulatorControls from './SimulatorControls';
import PullAnimation from './PullAnimation';
import LimitedPoolAnalysis from './LimitedPoolAnalysis';
import SimulatorShareCard from './SimulatorShareCard';
import SimulatorToolbar from './SimulatorToolbar';
import SimulatorHistoryPanel from './SimulatorHistoryPanel';
import { normalizeSimulatorPoolType } from './simulatorInheritance';
import { useGachaSimulatorController } from './useGachaSimulatorController';
import { useI18n } from '../../i18n/index.js';
import { EXTRA_RULE_PROFILES, resolvePoolCapabilities } from '../../utils/poolCapabilities.js';

const GachaSimulator = () => {
  const { t } = useI18n();
  const {
    adjustResourceAmount,
    availableFreePulls,
    canAffordSinglePull,
    canAffordTenPull,
    closeOriginiteConversionPrompt,
    closeResetDialog,
    confirmOriginiteConversionPrompt,
    confirmReset,
    currentPullCosts,
    currentPoolObj,
    currentSimPool,
    currentSimPoolId,
    dashboardStats,
    effectivePityObj,
    expandedTenPulls,
    handleExportData,
    handleExportReport,
    handleCopyShareImage,
    handleCopyShareText,
    handleDownloadShareImage,
    handleInheritRealState,
    handlePull,
    handleReset,
    handleShareImage,
    historyGroups,
    infoBookTenPullAvailable,
    isShareActionBusy,
    isAnimating,
    lastResults,
    pityInfoWithGuarantee,
    poolPullCounts,
    poolCharactersList,
    pullHistory,
    resourceLedger,
    resourceSettings,
    resetAllPools,
    resetKeepResources,
    resetSettings,
    shareActionFeedback,
    setDisableOriginitePromptToday,
    setLastResults,
    setResetAllPools,
    setResetKeepResources,
    setResetSettings,
    setSkipAnimation,
    showResetConfirm,
    showToast,
    showOriginitePrompt,
    simulator,
    simulatorPools,
    sharePayload,
    shareTimelineSections,
    skipAnimation,
    supportsClipboardImageCopy,
    supportsNativeImageShare,
    switchPool,
    toastMessage,
    toggleTenPull,
    singlePullDisabledReason,
    tenPullDisabledReason,
    disableOriginitePromptToday,
    toggleCnOriginiteDoubleBonus,
    toggleInfiniteResources,
    isWeaponPool,
  } = useGachaSimulatorController();
  const normalizedSimulatorPoolType = normalizeSimulatorPoolType(simulator.poolType);
  const currentPoolCapabilities = resolvePoolCapabilities(currentPoolObj);
  const isReconstructionCharacter = currentPoolCapabilities.ruleProfile === EXTRA_RULE_PROFILES.RECONSTRUCTION_CHARACTER;
  const isReconstructionWeapon = currentPoolCapabilities.ruleProfile === EXTRA_RULE_PROFILES.RECONSTRUCTION_WEAPON;
  const shareCardRef = useRef(null);
  const resolvedCurrentType = normalizeSimulatorPoolType(currentSimPool?.type);
  const currentTypeName = isReconstructionCharacter
    ? t('simulator.poolTypeName.reconstructionCharacter')
    : isReconstructionWeapon
      ? t('simulator.poolTypeName.reconstructionWeapon')
      : resolvedCurrentType === 'extra'
        ? t('dashboard.pool.type.extra')
    : resolvedCurrentType === 'limited'
      ? t('dashboard.pool.type.limited')
      : resolvedCurrentType === 'weapon'
        ? t('dashboard.pool.type.weapon')
        : t('dashboard.pool.type.standard');
  const heroTitle = isReconstructionCharacter
    ? t('simulator.hero.reconstructionCharacter')
    : isReconstructionWeapon
      ? t('simulator.hero.reconstructionWeapon')
      : currentPoolCapabilities.rawPoolType === 'extra'
        ? t('simulator.poolTypeName.extra')
        : normalizedSimulatorPoolType === 'limited'
          ? t('simulator.hero.limited')
          : normalizedSimulatorPoolType === 'weapon'
            ? t('simulator.hero.weapon')
            : t('simulator.hero.standard');

  return (
    <div className="flex flex-col h-full text-slate-800 dark:text-zinc-100 font-sans max-w-7xl mx-auto w-full">
      <SimulatorToolbar
        currentSimPool={currentSimPool}
        currentSimPoolId={currentSimPoolId}
        onExportData={handleExportData}
        onExportReport={handleExportReport}
        onInheritRealState={handleInheritRealState}
        onReset={handleReset}
        poolPullCounts={poolPullCounts}
        onShareImage={() => handleShareImage(shareCardRef.current)}
        onDownloadImage={() => handleDownloadShareImage(shareCardRef.current)}
        onCopyImage={() => handleCopyShareImage(shareCardRef.current)}
        onShareText={handleCopyShareText}
        onSwitchPool={switchPool}
        resourceLedger={resourceLedger}
        onAdjustResourceAmount={adjustResourceAmount}
        resourceSettings={resourceSettings}
        originiteToJadeRate={currentPullCosts.settings.originiteToJadeRate}
        onToggleCnOriginiteDoubleBonus={toggleCnOriginiteDoubleBonus}
        onToggleInfiniteResources={toggleInfiniteResources}
        onToggleSkipAnimation={() => setSkipAnimation(!skipAnimation)}
        simulatorPools={simulatorPools}
        skipAnimation={skipAnimation}
        supportsClipboardImageCopy={supportsClipboardImageCopy}
        supportsImageShare={supportsNativeImageShare}
        shareActionBusy={isShareActionBusy}
        shareActionFeedback={shareActionFeedback}
      />

      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: '-200vw',
          top: 0,
          opacity: 0,
          pointerEvents: 'none',
        }}
      >
        <SimulatorShareCard ref={shareCardRef} payload={sharePayload} sections={shareTimelineSections} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[32fr_48fr_20fr] gap-6 mb-8 flex-1">
        <div className="space-y-4">
          <LimitedPoolAnalysis
            currentPool={currentPoolObj}
            stats={dashboardStats}
            effectivePity={effectivePityObj}
            pityInfo={pityInfoWithGuarantee}
          />
        </div>

        <div className="relative flex flex-col">
          <div className="flex-1 bg-zinc-100 dark:bg-black border border-zinc-200 dark:border-zinc-800 relative overflow-hidden flex items-center justify-center min-h-[600px]">
            <div
              className="absolute inset-0 opacity-20 pointer-events-none"
              style={{
                backgroundImage: 'radial-gradient(circle at center, #333 1px, transparent 1px)',
                backgroundSize: '20px 20px',
              }}
            />

            {isAnimating && <PullAnimation />}

            {lastResults ? (
              <div className="relative z-20 w-full h-full animate-fade-in p-4">
                <SimulatorResults
                  onShare={() => handleShareImage(shareCardRef.current)}
                  onDownloadImage={() => handleDownloadShareImage(shareCardRef.current)}
                  onCopyImage={() => handleCopyShareImage(shareCardRef.current)}
                  poolType={normalizedSimulatorPoolType}
                  results={lastResults}
                  onClose={() => setLastResults(null)}
                  supportsClipboardImageCopy={supportsClipboardImageCopy}
                  supportsImageShare={supportsNativeImageShare}
                  shareActionBusy={isShareActionBusy}
                  shareActionFeedback={shareActionFeedback}
                />
              </div>
            ) : (
              !isAnimating && (
                <div className="relative z-10 text-center transform transition-all duration-500 animate-fade-in">
                  <div className="w-24 h-24 mx-auto mb-6 border-2 border-endfield-yellow rotate-45 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    {currentPoolCapabilities.entityType === 'character' && currentPoolCapabilities.rawPoolType !== 'extra' && normalizedSimulatorPoolType === 'limited' && (
                      <Star size={40} className="text-endfield-yellow -rotate-45" />
                    )}
                    {currentPoolCapabilities.rawPoolType === 'extra' && currentPoolCapabilities.entityType !== 'weapon' && (
                      <Star size={40} className="text-cyan-400 -rotate-45" />
                    )}
                    {currentPoolCapabilities.entityType === 'weapon' && (
                      <Search size={40} className="text-endfield-yellow -rotate-45" />
                    )}
                    {normalizedSimulatorPoolType === 'standard' && (
                      <Layers size={40} className="text-endfield-yellow -rotate-45" />
                    )}
                  </div>

                  <h1 className="text-3xl font-black text-slate-800 dark:text-white uppercase tracking-tighter mb-2">
                    {heroTitle}
                  </h1>
                  <p className="text-sm font-mono text-endfield-yellow tracking-[0.2em] uppercase opacity-80 bg-black/80 px-2 py-1 rounded inline-block">
                    {t('simulator.hero.subtitle')}
                  </p>
                </div>
              )
            )}
          </div>

          <div className="mt-4">
            <SimulatorControls
              onPullOne={() => handlePull('single')}
              onPullTen={() => handlePull('ten')}
              disableSingle={isAnimating || !poolCharactersList || !canAffordSinglePull}
              disableTen={isAnimating || !poolCharactersList || !canAffordTenPull}
              singleDisabledReason={singlePullDisabledReason}
              tenDisabledReason={tenPullDisabledReason}
              singleCost={currentPullCosts.single}
              tenCost={currentPullCosts.ten}
              availableFreePulls={availableFreePulls}
              infoBookTenPullAvailable={infoBookTenPullAvailable}
              isWeaponPool={isWeaponPool}
            />
          </div>
        </div>

        <SimulatorHistoryPanel
          expandedTenPulls={expandedTenPulls}
          historyGroups={historyGroups}
          onToggleTenPull={toggleTenPull}
          poolType={simulator.poolType}
          pullHistory={pullHistory}
        />
      </div>

      {showToast && (
        <div className="fixed bottom-8 right-8 z-50 animate-fade-in">
          <div className="bg-endfield-yellow text-black px-6 py-3 shadow-lg border-2 border-black font-bold">
            {toastMessage}
          </div>
        </div>
      )}

      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800 shadow-2xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-red-50 dark:bg-red-900/20">
              <h3 className="text-lg font-bold text-red-600 dark:text-red-400 uppercase tracking-wide">{t('simulator.reset.title')}</h3>
            </div>

            <div className="px-6 py-6 space-y-4">
              <p className="text-sm text-slate-600 dark:text-zinc-400">
                {resetAllPools
                  ? t('simulator.reset.confirmAll')
                  : t('simulator.reset.confirmType', { typeName: currentTypeName })}
              </p>

              <div
                onClick={() => setResetAllPools(!resetAllPools)}
                className={`
                  flex items-center gap-3 px-4 py-3 cursor-pointer transition-all border select-none
                  ${
                    resetAllPools
                      ? 'bg-red-500/10 border-red-500 text-red-600 dark:text-red-400'
                      : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600'
                  }
                `}
              >
                <div
                  className={`w-4 h-4 border-2 flex items-center justify-center transition-colors ${resetAllPools ? 'border-red-500 bg-red-500' : 'border-current'}`}
                >
                  {resetAllPools && (
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold">{t('simulator.reset.optionAllTitle')}</div>
                  <div className="text-xs opacity-75 mt-0.5">{t('simulator.reset.optionAllDesc')}</div>
                </div>
              </div>

              <div
                onClick={() => setResetKeepResources(!resetKeepResources)}
                className={`
                  flex items-center gap-3 px-4 py-3 cursor-pointer transition-all border select-none
                  ${
                    resetKeepResources
                      ? 'bg-emerald-500/10 border-emerald-500 text-emerald-600 dark:text-emerald-400'
                      : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600'
                  }
                `}
              >
                <div
                  className={`w-4 h-4 border-2 flex items-center justify-center transition-colors ${resetKeepResources ? 'border-emerald-500 bg-emerald-500' : 'border-current'}`}
                >
                  {resetKeepResources && (
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold">{t('simulator.reset.keepResourcesTitle')}</div>
                  <div className="text-xs opacity-75 mt-0.5">{t('simulator.reset.keepResourcesDesc')}</div>
                </div>
              </div>

              <div
                onClick={() => setResetSettings(!resetSettings)}
                className={`
                  flex items-center gap-3 px-4 py-3 cursor-pointer transition-all border select-none
                  ${
                    resetSettings
                      ? 'bg-red-500/10 border-red-500 text-red-600 dark:text-red-400'
                      : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600'
                  }
                `}
              >
                <div
                  className={`w-4 h-4 border-2 flex items-center justify-center transition-colors ${resetSettings ? 'border-red-500 bg-red-500' : 'border-current'}`}
                >
                  {resetSettings && (
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold">{t('simulator.reset.resetSettingsTitle')}</div>
                  <div className="text-xs opacity-75 mt-0.5">{t('simulator.reset.resetSettingsDesc')}</div>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 flex gap-3 justify-end bg-zinc-50 dark:bg-zinc-950">
              <button
                onClick={closeResetDialog}
                className="px-4 py-2 text-sm font-bold text-slate-600 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={confirmReset}
                className="px-4 py-2 text-sm font-bold bg-red-500 hover:bg-red-600 text-white transition-colors"
              >
                {t('simulator.reset.confirmAction')}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={Boolean(showOriginitePrompt)}
        title={t('simulator.originitePrompt.title')}
        message={showOriginitePrompt?.message}
        confirmText={t('simulator.originitePrompt.confirm')}
        cancelText={t('simulator.originitePrompt.cancel')}
        type="warning"
        onConfirm={() => confirmOriginiteConversionPrompt()}
        onCancel={closeOriginiteConversionPrompt}
      >
        <label className="mt-4 flex items-center justify-center gap-2 text-sm text-slate-600 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={disableOriginitePromptToday}
            onChange={(event) => setDisableOriginitePromptToday(event.target.checked)}
            className="accent-amber-500"
          />
          {t('simulator.originitePrompt.skipToday')}
        </label>
      </ConfirmDialog>

      <style>{`
        .scrollbar-thin::-webkit-scrollbar {
          width: 4px;
        }
        .scrollbar-thin::-webkit-scrollbar-track {
          background: transparent;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background-color: #333;
        }
      `}</style>
    </div>
  );
};

export default GachaSimulator;
