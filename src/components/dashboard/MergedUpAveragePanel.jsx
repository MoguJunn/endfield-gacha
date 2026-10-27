import React, { useState } from 'react';
import { Layers, Swords, User } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import { localizePoolName } from '../../utils/gameDataI18n.js';
import { aggregateMergedUpAverage } from '../../utils/mergedUpAverage.js';

export default function MergedUpAveragePanel({ data, pools = [], includeFree = false, mobile = false, className = '' }) {
  const { t, locale, formatNumber } = useI18n();
  const [categories, setCategories] = useState(['limited', 'reconstruction']);
  return (
    <section aria-label={t('dashboard.mergedUp.title')} className={`${mobile ? 'mobile-ux-card' : 'border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'} p-4 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-zinc-200">
          <Layers size={16} className="text-amber-500" />{t('dashboard.mergedUp.title')}
        </h3>
        <div role="group" aria-label={t('dashboard.mergedUp.scope')} className="flex gap-1 rounded-sm bg-zinc-100 p-1 dark:bg-zinc-950">
          {['limited', 'reconstruction'].map(category => (
            <button key={category} type="button" aria-pressed={categories.includes(category)}
              onClick={() => setCategories(current => current.includes(category) ? current.filter(value => value !== category) : [...current, category])}
              className={`rounded-sm border px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-amber-500 ${categories.includes(category) ? 'border-amber-400 bg-amber-100 text-amber-800 dark:border-yellow-600 dark:bg-yellow-500/15 dark:text-yellow-300' : 'border-transparent text-zinc-500'}`}>
              {t(`dashboard.mergedUp.${category}`)}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-zinc-500">{t('dashboard.mergedUp.accountScope')}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {['character', 'weapon'].map(entityType => {
          const result = aggregateMergedUpAverage(data, { entityType, categories, includeFree });
          const Icon = entityType === 'character' ? User : Swords;
          const statusKey = !categories.length ? 'chooseScope' : !result ? 'pending' : result.incomplete ? 'incomplete'
            : result.unknownSixCount > 0 ? 'unknown' : result.pulls === 0 ? 'empty' : result.upCount === 0 ? 'noUp' : null;
          const names = (result?.poolIds || []).map(id => {
            const pool = pools.find(item => String(item.id ?? item.pool_id) === id);
            return pool ? localizePoolName(pool, { locale }) : id;
          });
          return <div key={entityType} aria-label={t(`dashboard.mergedUp.${entityType}`)} className="min-w-0 border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
            <div className="flex items-center gap-2 text-xs font-bold text-zinc-500"><Icon size={14} />{t(`dashboard.mergedUp.${entityType}`)}</div>
            <div className="mt-2 font-mono text-2xl font-black text-slate-800 dark:text-zinc-100">
              {statusKey ? '—' : result.average.toFixed(2)}
              <span className="ml-2 text-xs font-normal text-zinc-500">{t('dashboard.mergedUp.unit')}</span>
            </div>
            {result && <p className="mt-2 text-xs text-zinc-500">{t('dashboard.mergedUp.counts', { pulls: formatNumber(result.pulls), count: formatNumber(result.upCount) })}</p>}
            {statusKey && <p role="status" className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-400">{t(`dashboard.mergedUp.${statusKey}`, { count: result?.unknownSixCount || 0 })}</p>}
            {names.length > 0 && <details className="mt-2 text-xs text-zinc-500"><summary className="cursor-pointer py-1">{t('dashboard.mergedUp.pools', { count: names.length })}</summary><p className="mt-1 break-words leading-5">{names.join(' / ')}</p></details>}
          </div>;
        })}
      </div>
      <details className="mt-3 border-t border-zinc-200 pt-2 text-xs leading-5 text-zinc-500 dark:border-zinc-800">
        <summary className="cursor-pointer py-1">{t('dashboard.mergedUp.method')} · {t(includeFree ? 'dashboard.mergedUp.withFree' : 'dashboard.mergedUp.withoutFree')}</summary>
        <p className="mt-1">{t('dashboard.mergedUp.note')}</p>
      </details>
    </section>
  );
}
