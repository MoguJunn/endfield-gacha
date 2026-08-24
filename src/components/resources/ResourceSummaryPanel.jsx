import React from 'react';
import {
  RESOURCE_ICON_URLS,
  formatOriginiteEquivalent
} from '../../utils/resourceEconomy';
import { useI18n } from '../../i18n/index.js';

function formatCompactNumber(value, locale) {
  const numericValue = Number(value) || 0;
  const absoluteValue = Math.abs(numericValue);

  if (absoluteValue < 10000) {
    return null;
  }

  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(numericValue);
}

function getItems(resources, variant, t, formatNumber) {
  if (!resources) {
    return [];
  }

  const baseItems = {
    jadeSpent: {
      key: 'jadeSpent',
      label: t('dashboard.resources.jadeSpent'),
      rawValue: Number(resources.jadeSpent || 0),
      fullValue: formatNumber(resources.jadeSpent || 0),
      icon: RESOURCE_ICON_URLS.jade,
      tone: 'text-cyan-600 dark:text-cyan-400'
    },
    originiteEquivalent: {
      key: 'originiteEquivalent',
      label: t('dashboard.resources.originiteEquivalent'),
      rawValue: Number(resources.originiteEquivalent || 0),
      fullValue: formatNumber(Number(formatOriginiteEquivalent(resources.originiteEquivalent || 0)), {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      }),
      icon: RESOURCE_ICON_URLS.originite,
      tone: 'text-amber-600 dark:text-amber-400'
    },
    arsenalGained: {
      key: 'arsenalGained',
      label: t('dashboard.resources.arsenalGained'),
      rawValue: Number(resources.arsenalGained || 0),
      fullValue: formatNumber(resources.arsenalGained || 0),
      icon: RESOURCE_ICON_URLS.arsenalQuota,
      tone: 'text-blue-600 dark:text-blue-400'
    },
    arsenalSpent: {
      key: 'arsenalSpent',
      label: t('dashboard.resources.arsenalSpent'),
      rawValue: Number(resources.arsenalSpent || 0),
      fullValue: formatNumber(resources.arsenalSpent || 0),
      icon: RESOURCE_ICON_URLS.arsenalQuota,
      tone: 'text-rose-600 dark:text-rose-400'
    },
    arsenalNet: {
      key: 'arsenalNet',
      label: t('dashboard.resources.arsenalNet'),
      rawValue: Number(resources.arsenalNet || 0),
      fullValue: formatNumber(resources.arsenalNet || 0),
      icon: RESOURCE_ICON_URLS.arsenalQuota,
      tone: Number(resources.arsenalNet || 0) >= 0
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-rose-600 dark:text-rose-400'
    },
    aicQuotaDirect: {
      key: 'aicQuotaDirect',
      label: t('dashboard.resources.aicQuotaDirect', {}, '集成配额（直得）'),
      rawValue: Number(resources.aicQuotaDirect || 0),
      fullValue: formatNumber(resources.aicQuotaDirect || 0),
      icon: RESOURCE_ICON_URLS.aicQuota,
      tone: 'text-sky-600 dark:text-sky-400'
    },
    aicQuotaConvertible: {
      key: 'aicQuotaConvertible',
      label: t('dashboard.resources.aicQuotaConvertible', {}, '集成配额（可兑换）'),
      rawValue: Number(resources.aicQuotaConvertible || 0),
      fullValue: formatNumber(resources.aicQuotaConvertible || 0),
      icon: RESOURCE_ICON_URLS.aicQuota,
      tone: 'text-cyan-600 dark:text-cyan-400'
    },
    bondQuotaDirect: {
      key: 'bondQuotaDirect',
      label: t('dashboard.resources.bondQuotaDirect', {}, '保障配额'),
      rawValue: Number(resources.bondQuotaDirect || 0),
      fullValue: formatNumber(resources.bondQuotaDirect || 0),
      icon: RESOURCE_ICON_URLS.bondQuota,
      tone: 'text-amber-600 dark:text-amber-400'
    },
    endpointQuotaConvertible: {
      key: 'endpointQuotaConvertible',
      label: t('dashboard.resources.endpointQuotaConvertible', {}, '终点配额'),
      rawValue: Number(resources.endpointQuotaConvertible || 0),
      fullValue: formatNumber(resources.endpointQuotaConvertible || 0),
      icon: RESOURCE_ICON_URLS.endpointQuota,
      tone: 'text-fuchsia-600 dark:text-fuchsia-400'
    }
  };

  if (variant === 'character') {
    return [
      baseItems.jadeSpent,
      baseItems.originiteEquivalent,
      baseItems.arsenalGained,
      baseItems.aicQuotaDirect,
      baseItems.aicQuotaConvertible,
      baseItems.bondQuotaDirect,
      baseItems.endpointQuotaConvertible
    ];
  }

  if (variant === 'weapon') {
    return [
      baseItems.arsenalSpent,
      baseItems.aicQuotaDirect
    ];
  }

  return [
    baseItems.jadeSpent,
    baseItems.originiteEquivalent,
    baseItems.arsenalGained,
    baseItems.aicQuotaDirect,
      baseItems.aicQuotaConvertible,
      baseItems.bondQuotaDirect,
      baseItems.endpointQuotaConvertible,
      baseItems.arsenalSpent
  ];
}

const ResourceSummaryPanel = ({
  title = '资源换算',
  resources,
  variant = 'all',
  compact = false,
  stacked = false,
  layout = 'grid',
  mobile = false,
  className = ''
}) => {
  const { locale, t, formatNumber } = useI18n();
  const items = getItems(resources, variant, t, formatNumber);

  if (items.length === 0) {
    return null;
  }

  const getGridTemplateColumns = (sectionLayout = layout, sectionStacked = stacked) => (
    mobile
      ? 'repeat(2, minmax(0, 1fr))'
      : sectionLayout === 'fixed3'
      ? 'repeat(3, minmax(0, 1fr))'
      : compact || sectionStacked
      ? 'minmax(0, 1fr)'
      : sectionLayout === 'grouped'
      ? 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))'
      : 'repeat(auto-fit, minmax(min(100%, 13rem), 1fr))'
  );

  const renderItem = (item) => {
    const compactValue = formatCompactNumber(item.rawValue, locale);
    // Remove the text- prefix from tone to get the border/hover colors if needed, but we'll just use the text color for the value
    return (
      <div
        key={item.key}
        className={`flex min-w-0 items-center bg-zinc-50 dark:bg-[#151518] border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors group relative ${
          mobile ? 'gap-2 p-2.5' : 'gap-3 p-3'
        }`}
        style={{ clipPath: mobile ? undefined : 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)' }}
      >
        <div
          className={`${mobile ? 'h-8 w-8' : 'w-10 h-10'} bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center shrink-0`}
          style={{ clipPath: mobile ? undefined : 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' }}
        >
          <img src={item.icon} alt={item.label} loading="lazy" className={`${mobile ? 'h-5 w-5' : 'h-6 w-6'} object-contain shrink-0`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className={`${mobile ? 'text-[9px]' : 'text-[11px]'} text-slate-500 dark:text-zinc-500 font-bold tracking-wider uppercase mb-0.5 truncate`} title={item.label}>
            {item.label}
          </div>
          <div className="flex min-w-0 items-baseline">
            <span className={`min-w-0 max-w-full truncate ${mobile ? 'text-[16px]' : 'text-[19px]'} font-black leading-none tabular-nums tracking-tight ${item.tone}`} title={item.fullValue}>
              {compactValue || item.fullValue}
            </span>
          </div>
          {compactValue && (
            <div className={`${mobile ? 'text-[8px]' : 'text-[10px]'} text-slate-400 dark:text-zinc-600 mt-0.5 truncate`}>
              {item.fullValue}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 ${mobile ? 'p-3' : 'p-5'} relative ${className}`} style={{ clipPath: mobile ? undefined : 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))' }}>
      <div className="absolute top-0 left-0 w-full h-[2px] bg-yellow-500"></div>
      <div className="absolute top-0 left-0 h-full w-[2px] bg-yellow-500"></div>

      <div className={mobile ? 'mb-3 pl-1' : 'mb-4'}>
        <span className={`${mobile ? 'text-sm tracking-wide' : 'text-lg tracking-widest'} font-bold uppercase text-slate-800 dark:text-white`}>{title}</span>
      </div>

      <div className={`grid ${mobile ? 'gap-2' : 'gap-3'}`} style={{ gridTemplateColumns: getGridTemplateColumns() }}>
        {items.map(renderItem)}
      </div>
    </div>
  );
};

export default ResourceSummaryPanel;
