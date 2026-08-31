import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Download, Loader2, Plus, RefreshCw, Share2, User } from 'lucide-react';
import { usePersonalGameAccounts } from '../../hooks/app/usePersonalGameAccounts.js';
import { getLocalizedResourceLabel, RESOURCE_ICON_URLS } from '../../utils/resourceEconomy';
import PoolGroupCardRail from '../../components/pool/PoolGroupCardRail';
import ShareActionStatus from '../../components/share/ShareActionStatus';
import { applyPoolSelectorScopeView, buildPoolSelectorGroups } from '../../utils/poolSelectorDisplay';
import { useI18n } from '../../i18n/index.js';
import { localizeGameAccountServerTag } from '../../utils/gameAccountMetadata.js';

const CN_ORIGINITE_PURCHASE_BASES = [
  { label: '￥6', base: 3, bonus: 0, supportsDouble: true },
  { label: '￥30', base: 12, bonus: 3, supportsDouble: true },
  { label: '￥98', base: 42, bonus: 8, supportsDouble: true },
  { label: '￥198', base: 85, bonus: 17, supportsDouble: true },
  { label: '￥328', base: 141, bonus: 30, supportsDouble: true },
  { label: '￥648', base: 280, bonus: 70, supportsDouble: true },
];

const EN_ORIGINITE_PURCHASE_PRESETS = [
  { label: '$1.99', amount: 12 },
  { label: '$8.99', amount: 42 },
  { label: '$12.99', amount: 68 },
  { label: '$20.99', amount: 114 },
  { label: '$33.99', amount: 184 },
  { label: '$69.99', amount: 388 },
];

function buildChineseOriginitePurchasePresets(doubleBonusEnabled) {
  return CN_ORIGINITE_PURCHASE_BASES.map((preset) => {
    const purchased = preset.base;
    const isDoublePreset = preset.supportsDouble && doubleBonusEnabled;
    const amount = isDoublePreset ? purchased * 2 : purchased + preset.bonus;
    const displayLabel = isDoublePreset
      ? preset.bonus > 0
        ? `${preset.base}+${preset.base}`
        : amount.toLocaleString('zh-CN')
      : preset.bonus > 0
        ? `${preset.base}+${preset.bonus}`
        : amount.toLocaleString('zh-CN');

    return {
      label: preset.label,
      amount,
      displayAmount: amount,
      displayLabel,
    };
  });
}

function formatCompactMetric(value, locale) {
  if (!Number.isFinite(Number(value))) {
    return '∞';
  }
  const numericValue = Number(value) || 0;
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(numericValue) ? 0 : 1,
  }).format(numericValue);
}

function CumulativeChip({ icon, label, value, locale }) {
  const fullValue = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(Number(value || 0)) ? 0 : 2,
  }).format(Number(value || 0));

  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 border border-zinc-200 bg-zinc-100/70 px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-900/70">
      <img src={icon} alt={label} className="w-5 h-5 object-contain shrink-0" loading="lazy" />
      <div className="min-w-0">
        <div
          className="truncate text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400"
          title={label}
        >
          {label}
        </div>
        <div className="text-xs sm:text-sm font-mono font-bold text-slate-700 dark:text-zinc-200" title={fullValue}>
          {formatCompactMetric(value, locale)}
        </div>
      </div>
    </div>
  );
}

function ResourceChip({
  activeEditor,
  disableEditing,
  exchangeRate,
  onAdjustResourceAmount,
  onToggleCnOriginiteDoubleBonus,
  onOpenEditor,
  onCloseEditor,
  originiteBalance,
  quickAddPresets,
  resourceKey,
  showCnOriginiteDoubleBonusToggle,
  cnOriginiteDoubleBonusEnabled,
  value,
  t,
  locale,
}) {
  const editor = activeEditor?.resourceKey === resourceKey ? activeEditor : null;
  const label = getLocalizedResourceLabel(resourceKey, locale);
  const numericInput = Math.max(0, Math.floor(Number(editor?.value) || 0));
  const canConvertOriginite =
    resourceKey === 'jade' && editor?.mode === 'add' && numericInput > 0 && numericInput <= originiteBalance;
  const editTitle = t('simulator.resource.editTitle', { label });
  const addTitle =
    resourceKey === 'jade' ? t('simulator.resource.convertTitle') : t('simulator.resource.addTitle', { label });
  const editorTitle =
    resourceKey === 'jade' && editor?.mode === 'add'
      ? t('simulator.resource.convertTitle')
      : editor?.mode === 'add'
        ? t('simulator.resource.addTitle', { label })
        : t('simulator.resource.setTitle', { label });

  return (
    <div className="relative min-w-[180px]">
      <div className="flex items-center gap-3 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-3 py-2.5 min-w-0">
        <img
          src={RESOURCE_ICON_URLS[resourceKey]}
          alt={label}
          className="w-7 h-7 object-contain shrink-0"
          loading="lazy"
        />
        <button
          type="button"
          disabled={disableEditing}
          onClick={() => onOpenEditor(resourceKey, 'set', value)}
          className={`min-w-0 flex-1 text-left font-mono font-bold transition-colors ${
            disableEditing
              ? 'cursor-not-allowed text-slate-400 dark:text-zinc-500'
              : 'text-slate-700 dark:text-zinc-200 hover:text-endfield-yellow'
          }`}
          title={editTitle}
        >
          <span className="block text-[10px] uppercase tracking-wider text-slate-500 dark:text-zinc-500">{label}</span>
          {Number.isFinite(Number(value)) ? (
            <span className="block text-sm sm:text-base leading-tight break-all">
              {Number(value || 0).toLocaleString(locale)}
            </span>
          ) : (
            <span className="mt-0.5 inline-flex items-center rounded-full border border-emerald-400/60 bg-[linear-gradient(90deg,rgba(16,185,129,0.12),rgba(34,211,238,0.14),rgba(250,204,21,0.14),rgba(16,185,129,0.12))] px-2 py-0.5 shadow-[0_0_18px_rgba(16,185,129,0.18)] dark:border-emerald-300/50 dark:shadow-[0_0_22px_rgba(45,212,191,0.22)]">
              <span className="rainbow-flow-text animate-rainbow-text block text-xl sm:text-2xl leading-none font-black">
                ∞
              </span>
            </span>
          )}
        </button>
        <button
          type="button"
          disabled={disableEditing}
          onClick={() => onOpenEditor(resourceKey, 'add', '')}
          className={`w-7 h-7 shrink-0 flex items-center justify-center border transition-colors ${
            disableEditing
              ? 'cursor-not-allowed border-zinc-200 dark:border-zinc-800 text-slate-300 dark:text-zinc-600'
              : 'border-zinc-300 dark:border-zinc-700 text-slate-500 dark:text-zinc-400 hover:text-endfield-yellow hover:border-endfield-yellow'
          }`}
          title={addTitle}
        >
          <Plus size={14} />
        </button>
      </div>

      {editor && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-lg p-3 z-30">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-zinc-500 font-bold mb-2">
            {editorTitle}
          </div>
          <input
            type="number"
            min="0"
            step="1"
            value={editor.value}
            onChange={(event) => onOpenEditor(resourceKey, editor.mode, event.target.value)}
            className="w-full bg-transparent px-2 py-2 text-sm font-mono text-slate-800 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 outline-none"
          />

          {resourceKey === 'jade' && editor.mode === 'add' && (
            <div className="mt-3 border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-black/20 px-2 py-2">
              <div className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
                {t('simulator.resource.rate', { rate: exchangeRate })}
              </div>
              <div className="mt-1 text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
                {t('simulator.resource.availableOriginite', { count: originiteBalance.toLocaleString(locale) })}
              </div>
              <button
                type="button"
                onClick={() => {
                  onAdjustResourceAmount(resourceKey, 'convertOriginite', editor.value);
                  onCloseEditor();
                }}
                disabled={!canConvertOriginite}
                className="mt-2 w-full px-2 py-1.5 text-[11px] font-bold border border-amber-500 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('simulator.resource.convertAction', {
                  gain:
                    numericInput > 0
                      ? `(+${(numericInput * exchangeRate).toLocaleString(locale)} ${getLocalizedResourceLabel('jade', locale)})`
                      : '',
                })}
              </button>
            </div>
          )}

          {resourceKey === 'originite' &&
            editor.mode === 'add' &&
            Array.isArray(quickAddPresets) &&
            quickAddPresets.length > 0 && (
              <div className="mt-3 border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-black/20 px-2 py-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
                    {t('simulator.resource.presetTitle')}
                  </div>
                  {showCnOriginiteDoubleBonusToggle && (
                    <button
                      type="button"
                      onClick={onToggleCnOriginiteDoubleBonus}
                      className={`flex items-center gap-1 border px-1.5 py-1 text-[10px] font-bold transition-colors ${
                        cnOriginiteDoubleBonusEnabled
                          ? 'border-amber-500 text-amber-600 dark:text-amber-400 bg-amber-500/10'
                          : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      <span>{t('simulator.resource.doubleLabel')}</span>
                      <span>{cnOriginiteDoubleBonusEnabled ? t('common.on') : t('common.off')}</span>
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {quickAddPresets.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        onAdjustResourceAmount(resourceKey, 'add', preset.amount);
                        onCloseEditor();
                      }}
                      className="border border-zinc-200 dark:border-zinc-700 px-2 py-1.5 text-left hover:border-endfield-yellow hover:text-endfield-yellow transition-colors"
                    >
                      <div className="text-[11px] font-bold">{preset.label}</div>
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono">
                        {preset.displayLabel ||
                          Number(preset.displayAmount ?? preset.amount ?? 0).toLocaleString(locale)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => {
                onAdjustResourceAmount(resourceKey, editor.mode, editor.value);
                onCloseEditor();
              }}
              className="flex-1 px-2 py-1.5 text-[11px] font-bold bg-endfield-yellow text-black hover:brightness-110 transition-colors"
            >
              {editor.mode === 'add' ? t('simulator.resource.addAction') : t('simulator.resource.setAction')}
            </button>
            <button
              type="button"
              onClick={onCloseEditor}
              className="px-2 py-1.5 text-[11px] font-bold border border-zinc-200 dark:border-zinc-700 text-slate-500 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-200 transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const SimulatorToolbar = ({
  currentSimPoolId,
  onExportData,
  onExportReport,
  onInheritRealState,
  inheritBusy = false,
  onReset,
  poolPullCounts,
  resourceLedger,
  resourceSettings,
  onAdjustResourceAmount,
  onShareImage,
  onDownloadImage,
  onCopyImage,
  onShareText,
  onSwitchPool,
  onToggleCnOriginiteDoubleBonus,
  onToggleInfiniteResources,
  onToggleSkipAnimation,
  originiteToJadeRate,
  simulatorPools,
  skipAnimation,
  supportsClipboardImageCopy,
  supportsImageShare,
  shareActionBusy,
  shareActionFeedback,
}) => {
  const { t, locale } = useI18n();
  const [activeEditor, setActiveEditor] = useState(null);
  const [showInheritAccountDropdown, setShowInheritAccountDropdown] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [subgroupExpansionOverrides, setSubgroupExpansionOverrides] = useState({});
  const shareMenuRef = useRef(null);
  const gameAccounts = usePersonalGameAccounts();
  const isEnglishLocale = locale?.toLowerCase().startsWith('en');
  const cnOriginiteDoubleBonusEnabled = Boolean(resourceSettings?.cnOriginiteDoubleBonusEnabled);
  const infiniteResourcesEnabled = Boolean(resourceSettings?.infiniteResources);
  const originiteQuickAddPresets = useMemo(
    () =>
      isEnglishLocale
        ? EN_ORIGINITE_PURCHASE_PRESETS
        : buildChineseOriginitePurchasePresets(cnOriginiteDoubleBonusEnabled),
    [cnOriginiteDoubleBonusEnabled, isEnglishLocale]
  );
  const resourceItems = useMemo(
    () => [
      {
        resourceKey: 'jade',
        value: resourceLedger?.infiniteResources
          ? Number.POSITIVE_INFINITY
          : Math.max(Number(resourceLedger?.jadeBalance || 0), 0),
      },
      {
        resourceKey: 'originite',
        value: resourceLedger?.infiniteResources
          ? Number.POSITIVE_INFINITY
          : Math.max(Number(resourceLedger?.originiteBalance || 0), 0),
      },
      {
        resourceKey: 'arsenalQuota',
        value: resourceLedger?.infiniteResources
          ? Number.POSITIVE_INFINITY
          : Math.max(Number(resourceLedger?.arsenalBalance || 0), 0),
      },
    ],
    [resourceLedger]
  );
  const cumulativeItems = useMemo(
    () => [
      {
        key: 'jadeSpent',
        label: t('simulator.resource.cumulative.jadeSpent'),
        value: Number(resourceLedger?.jadeSpent || 0),
        icon: RESOURCE_ICON_URLS.jade,
      },
      {
        key: 'originiteEquivalent',
        label: t('simulator.resource.cumulative.originiteEquivalent'),
        value: Number(resourceLedger?.originiteEquivalent || 0),
        icon: RESOURCE_ICON_URLS.originite,
      },
      {
        key: 'arsenalGained',
        label: t('simulator.resource.cumulative.arsenalGained'),
        value: Number(resourceLedger?.arsenalGained || 0),
        icon: RESOURCE_ICON_URLS.arsenalQuota,
      },
      {
        key: 'arsenalSpent',
        label: t('simulator.resource.cumulative.arsenalSpent'),
        value: Number(resourceLedger?.arsenalSpent || 0),
        icon: RESOURCE_ICON_URLS.arsenalQuota,
      },
      {
        key: 'aicQuotaTotalPotential',
        label: t('simulator.resource.cumulative.aicQuotaTotalPotential'),
        value: Number(resourceLedger?.aicQuotaTotalPotential || 0),
        icon: RESOURCE_ICON_URLS.aicQuota,
      },
      {
        key: 'bondQuotaDirect',
        label: t('simulator.resource.cumulative.bondQuotaDirect'),
        value: Number(resourceLedger?.bondQuotaDirect || 0),
        icon: RESOURCE_ICON_URLS.bondQuota,
      },
      {
        key: 'endpointQuotaConvertible',
        label: t('simulator.resource.cumulative.endpointQuotaConvertible'),
        value: Number(resourceLedger?.endpointQuotaConvertible || 0),
        icon: RESOURCE_ICON_URLS.endpointQuota,
      },
    ],
    [resourceLedger, t]
  );
  const selectorCatalogGroups = useMemo(
    () =>
      buildPoolSelectorGroups({
        pools: simulatorPools,
        poolPullCounts,
        currentPoolId: currentSimPoolId,
        locale,
      }),
    [currentSimPoolId, locale, poolPullCounts, simulatorPools]
  );
  const selectorGroups = useMemo(
    () =>
      applyPoolSelectorScopeView({
        groups: selectorCatalogGroups,
        currentPoolId: currentSimPoolId,
        subgroupExpansionOverrides,
      }),
    [currentSimPoolId, selectorCatalogGroups, subgroupExpansionOverrides]
  );
  const toggleSubgroup = useCallback((subgroupId, currentlyExpanded) => {
    setSubgroupExpansionOverrides((current) => ({
      ...current,
      [subgroupId]: !currentlyExpanded,
    }));
  }, []);
  const openEditor = (resourceKey, mode, value) => {
    setActiveEditor({
      resourceKey,
      mode,
      value: value === '' ? '' : String(Math.max(0, Math.floor(Number(value) || 0))),
    });
  };

  useEffect(() => {
    if (!showShareMenu) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!shareMenuRef.current?.contains(event.target)) {
        setShowShareMenu(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [showShareMenu]);

  return (
    <div className="mb-6 px-2 space-y-5">
      <PoolGroupCardRail
        groups={selectorGroups}
        currentSelectionId={currentSimPoolId}
        onSelectPool={onSwitchPool}
        onToggleSubgroup={toggleSubgroup}
        showGroupOverviewCards={false}
      />

      <div className="flex flex-col xl:flex-row gap-6">
        {/* 左侧：资源管理 (当前投入与累计统计) */}
        <div className="flex flex-col gap-4 flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            {resourceItems.map((item) => (
              <ResourceChip
                key={item.resourceKey}
                activeEditor={activeEditor}
                disableEditing={infiniteResourcesEnabled}
                cnOriginiteDoubleBonusEnabled={cnOriginiteDoubleBonusEnabled}
                exchangeRate={originiteToJadeRate}
                onAdjustResourceAmount={onAdjustResourceAmount}
                onToggleCnOriginiteDoubleBonus={onToggleCnOriginiteDoubleBonus}
                onOpenEditor={openEditor}
                onCloseEditor={() => setActiveEditor(null)}
                originiteBalance={Math.max(Number(resourceLedger?.originiteBalance || 0), 0)}
                quickAddPresets={item.resourceKey === 'originite' ? originiteQuickAddPresets : null}
                resourceKey={item.resourceKey}
                showCnOriginiteDoubleBonusToggle={item.resourceKey === 'originite' && !isEnglishLocale}
                t={t}
                locale={locale}
                value={item.value}
              />
            ))}
            <button
              type="button"
              onClick={onToggleInfiniteResources}
              className={`ml-auto flex min-w-[156px] items-center justify-between gap-3 border px-3 py-2.5 text-left transition-colors ${
                infiniteResourcesEnabled
                  ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-zinc-200 bg-zinc-100 text-slate-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300'
              }`}
            >
              <span className="text-[10px] font-bold uppercase tracking-wider">
                {t('simulator.toolbar.infiniteResources')}
              </span>
              <span
                className={`flex h-5 w-10 items-center rounded-full border px-0.5 transition-colors ${
                  infiniteResourcesEnabled
                    ? 'border-emerald-500 bg-emerald-500/20 justify-end'
                    : 'border-zinc-300 dark:border-zinc-700 bg-white/70 dark:bg-black/30 justify-start'
                }`}
              >
                <span
                  className={`block h-3.5 w-3.5 rounded-full ${
                    infiniteResourcesEnabled ? 'bg-emerald-500' : 'bg-zinc-400 dark:bg-zinc-500'
                  }`}
                />
              </span>
            </button>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-bold mb-2">
              {t('simulator.toolbar.cumulative')}
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7 gap-2">
              {cumulativeItems.map((item) => (
                <CumulativeChip key={item.key} icon={item.icon} label={item.label} value={item.value} locale={locale} />
              ))}
            </div>
          </div>
        </div>

        {/* 右侧：模拟器控制与功能按钮 */}
        <div className="flex flex-col gap-3 xl:w-[320px] shrink-0 border-t xl:border-t-0 xl:border-l border-zinc-200 dark:border-zinc-800 pt-4 xl:pt-0 xl:pl-6">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-bold mb-1">
            {t('simulator.controls', 'Simulator Controls')}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              onClick={onToggleSkipAnimation}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 cursor-pointer transition-all border select-none rounded-sm ${
                skipAnimation
                  ? 'bg-yellow-50 dark:bg-endfield-yellow/10 border-yellow-600 dark:border-endfield-yellow text-yellow-700 dark:text-endfield-yellow shadow-sm'
                  : 'bg-zinc-50 dark:bg-zinc-900/50 border-zinc-200 dark:border-zinc-800 text-slate-500 dark:text-zinc-500 hover:border-slate-300 dark:hover:border-zinc-700'
              }`}
            >
              <div
                className={`w-3.5 h-3.5 border flex items-center justify-center transition-colors rounded-sm ${skipAnimation ? 'border-yellow-600 dark:border-endfield-yellow bg-yellow-500 dark:bg-endfield-yellow' : 'border-zinc-300 dark:border-zinc-600'}`}
              >
                {skipAnimation && <Check size={10} className="text-white dark:text-black" strokeWidth={4} />}
              </div>
              <span className="text-xs font-bold uppercase truncate">{t('simulator.toolbar.skipAnimation')}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-1">
            {/* Inherit Button */}
            <div className="relative">
              <button
                type="button"
                disabled={inheritBusy}
                aria-busy={inheritBusy}
                onClick={() => {
                  if (gameAccounts.length <= 1) {
                    onInheritRealState(gameAccounts[0] || null);
                    return;
                  }
                  setShowInheritAccountDropdown((visible) => !visible);
                }}
                className="w-full px-3 py-2 flex items-center justify-center gap-2 text-xs font-bold bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 hover:text-endfield-yellow hover:border-endfield-yellow transition-colors rounded-sm disabled:cursor-wait disabled:opacity-60"
                title={t('simulator.toolbar.inheritTitle')}
              >
                <RefreshCw size={14} className={inheritBusy ? 'animate-spin' : ''} />
                <span className="truncate">
                  {inheritBusy ? t('simulator.toolbar.inheritLoading') : t('simulator.toolbar.inheritShort')}
                </span>
                {gameAccounts.length > 1 && (
                  <ChevronDown
                    size={12}
                    className={`transition-transform ${showInheritAccountDropdown ? 'rotate-180' : ''}`}
                  />
                )}
              </button>
              {showInheritAccountDropdown && gameAccounts.length > 1 && (
                <div className="absolute right-0 sm:left-0 top-full mt-1 w-60 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-lg z-50 rounded-md overflow-hidden">
                  {gameAccounts.map((account) => (
                    <button
                      key={account.accountKey || account.account_key || account.gameUid}
                      type="button"
                      disabled={inheritBusy}
                      onClick={() => {
                        onInheritRealState(account);
                        setShowInheritAccountDropdown(false);
                      }}
                      className="w-full px-3 py-2.5 text-left text-xs font-mono hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors text-slate-600 dark:text-zinc-300 border-b border-zinc-100 dark:border-zinc-800/50 last:border-0"
                    >
                      <div className="flex items-center gap-2">
                        <User size={12} className="shrink-0" />
                        <span className="font-bold truncate">{account.nickName}</span>
                        {account.serverTag && (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-sm bg-slate-200 dark:bg-zinc-700 text-slate-500 dark:text-zinc-400">
                            {localizeGameAccountServerTag(account.serverTag, locale)}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[10px] text-slate-400 dark:text-zinc-500">UID: {account.gameUid}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Share Button */}
            <div className="relative" ref={shareMenuRef}>
              <button
                type="button"
                onClick={() => setShowShareMenu((visible) => !visible)}
                disabled={shareActionBusy}
                className={`w-full px-3 py-2 flex items-center justify-center gap-2 text-xs font-bold bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 transition-colors rounded-sm ${
                  shareActionBusy
                    ? 'cursor-not-allowed opacity-60'
                    : 'hover:text-endfield-yellow hover:border-endfield-yellow'
                }`}
                title={t('simulator.toolbar.shareTitle')}
              >
                {shareActionBusy ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
                <span className="truncate">
                  {shareActionBusy ? t('simulator.toolbar.shareBusy') : t('simulator.toolbar.share')}
                </span>
              </button>

              {showShareMenu && (
                <div className="absolute right-0 sm:left-0 top-full mt-1 w-52 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-lg z-50 rounded-md overflow-hidden">
                  {supportsImageShare && (
                    <button
                      type="button"
                      disabled={shareActionBusy}
                      onClick={() => {
                        setShowShareMenu(false);
                        onShareImage();
                      }}
                      className={`w-full text-left px-3 py-2.5 text-xs text-slate-600 dark:text-zinc-300 transition-colors flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800/50 ${shareActionBusy ? 'cursor-not-allowed opacity-60' : 'hover:bg-slate-50 dark:hover:bg-zinc-800'}`}
                    >
                      <Share2 size={14} className="text-zinc-400" />{' '}
                      <span>{t('simulator.toolbar.systemShareImage')}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={shareActionBusy}
                    onClick={() => {
                      setShowShareMenu(false);
                      onDownloadImage();
                    }}
                    className={`w-full text-left px-3 py-2.5 text-xs text-slate-600 dark:text-zinc-300 transition-colors flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800/50 ${shareActionBusy ? 'cursor-not-allowed opacity-60' : 'hover:bg-slate-50 dark:hover:bg-zinc-800'}`}
                  >
                    <Download size={14} className="text-zinc-400" /> <span>{t('simulator.toolbar.downloadPng')}</span>
                  </button>
                  {supportsClipboardImageCopy && (
                    <button
                      type="button"
                      disabled={shareActionBusy}
                      onClick={() => {
                        setShowShareMenu(false);
                        onCopyImage();
                      }}
                      className={`w-full text-left px-3 py-2.5 text-xs text-slate-600 dark:text-zinc-300 transition-colors flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800/50 ${shareActionBusy ? 'cursor-not-allowed opacity-60' : 'hover:bg-slate-50 dark:hover:bg-zinc-800'}`}
                    >
                      <Copy size={14} className="text-zinc-400" /> <span>{t('simulator.toolbar.copyImage')}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={shareActionBusy}
                    onClick={() => {
                      setShowShareMenu(false);
                      onShareText();
                    }}
                    className={`w-full text-left px-3 py-2.5 text-xs text-slate-600 dark:text-zinc-300 transition-colors flex items-center gap-2 ${shareActionBusy ? 'cursor-not-allowed opacity-60' : 'hover:bg-slate-50 dark:hover:bg-zinc-800'}`}
                  >
                    <Copy size={14} className="text-zinc-400" /> <span>{t('simulator.toolbar.copyText')}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Export Button */}
            <div className="relative group">
              <button
                className="w-full px-3 py-2 flex items-center justify-center gap-2 text-xs font-bold bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 hover:text-endfield-yellow hover:border-endfield-yellow transition-colors rounded-sm"
                title={t('simulator.toolbar.exportTitle')}
              >
                <Download size={14} />
                <span className="truncate">{t('simulator.toolbar.export')}</span>
              </button>

              <div className="absolute right-0 sm:left-0 top-full mt-1 w-48 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 rounded-md overflow-hidden">
                <button
                  onClick={() => onExportData('json')}
                  className="w-full text-left px-3 py-2.5 text-xs text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors border-b border-zinc-100 dark:border-zinc-800/50"
                >
                  {t('simulator.toolbar.exportJson')}
                </button>
                <button
                  onClick={() => onExportData('csv')}
                  className="w-full text-left px-3 py-2.5 text-xs text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors border-b border-zinc-100 dark:border-zinc-800/50"
                >
                  {t('simulator.toolbar.exportCsv')}
                </button>
                <button
                  onClick={onExportReport}
                  className="w-full text-left px-3 py-2.5 text-xs text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  {t('simulator.toolbar.exportReport')}
                </button>
              </div>
            </div>

            {/* Reset Button */}
            <button
              onClick={onReset}
              className="w-full px-3 py-2 flex items-center justify-center gap-2 text-xs font-bold bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 hover:text-red-500 hover:border-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors rounded-sm"
              title={t('simulator.toolbar.resetTitle')}
            >
              <RefreshCw size={14} />
              <span className="truncate">{t('simulator.toolbar.reset')}</span>
            </button>
          </div>

          {shareActionFeedback?.phase !== 'idle' && (
            <div className="w-full mt-1">
              <ShareActionStatus feedback={shareActionFeedback} compact />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SimulatorToolbar;
