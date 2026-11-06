import React, { useState } from 'react';
import { useI18n } from '../../i18n/index.js';
import { getStorageItem, setStorageItem } from '../../utils/storageUtils.js';
import { EXTRA_RULE_PROFILES } from '../../utils/poolCapabilities.js';

const PREFERENCE_KEY = 'dashboard_gift_progress_visibility';

export default function PoolGiftProgress({ stats, capabilities, isLimitedWeapon = true }) {
  const { t, locale } = useI18n();
  const english = locale === 'en-US';
  const [visibility, setVisibility] = useState(() => getStorageItem(PREFERENCE_KEY, {}) || {});
  const paidTotal = stats.rewardPaidTotal ?? stats.paidTotal ?? stats.total;
  const isWeapon = capabilities.entityType === 'weapon';
  const reconstructionWeapon = capabilities.ruleProfile === EXTRA_RULE_PROFILES.RECONSTRUCTION_WEAPON;
  const reconstructionCharacter = capabilities.ruleProfile === EXTRA_RULE_PROFILES.RECONSTRUCTION_CHARACTER;
  const rules = capabilities.rules || {};
  const rows = [];
  if (!isWeapon && capabilities.basePoolType === 'limited') {
    rows.push({ key: 'character', first: 240, interval: 240,
      label: t(reconstructionCharacter ? 'dashboard.analysis.reconstructionCharacterToken240' : 'dashboard.analysis.potential240') });
  }
  if (isWeapon && isLimitedWeapon) {
    const interval = Number(rules.giftAlternateInterval) * 2;
    rows.push({ key: 'weapon', first: Number(rules.firstLimitedGift), interval,
      label: t('dashboard.analysis.targetWeaponReward') });
    rows.push({ key: 'arsenal', first: Number(rules.firstStandardGift), interval,
      label: t('dashboard.analysis.arsenalGiftReward') });
  }
  const rewards = rows.filter(row => row.first > 0 && row.interval > 0);
  if (!rewards.length || stats.personalData?.totalKnown === false || stats.statisticsContinuity?.cumulativeHistoryKnown === false) return null;
  const toggle = key => {
    const next = { ...visibility, [key]: visibility[key] === false };
    setVisibility(next);
    setStorageItem(PREFERENCE_KEY, next);
  };

  return <div className="space-y-3">
    <details className="text-xs text-slate-600 dark:text-zinc-300">
      <summary className="cursor-pointer py-1 font-medium">{english ? 'Reward display options' : '赠送进度显示设置'}</summary>
      <div className="flex flex-wrap gap-x-4 gap-y-2 py-2">
        {rewards.map(row => <label key={row.key} className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={visibility[row.key] !== false} onChange={() => toggle(row.key)} className="accent-amber-500" />
          {english ? `Show ${row.label}` : `显示${row.label}`}
        </label>)}
      </div>
    </details>
    {rewards.filter(row => visibility[row.key] !== false).map(row => {
      const next = paidTotal < row.first ? row.first : row.first + (Math.floor((paidTotal - row.first) / row.interval) + 1) * row.interval;
      const previous = next === row.first ? 0 : next - row.interval;
      const progress = Math.max(0, paidTotal - previous);
      const remaining = Math.max(0, next - paidTotal);
      const divisor = reconstructionWeapon ? 10 : 1;
      const unit = t(reconstructionWeapon ? 'dashboard.unit.claim' : 'dashboard.unit.pull');
      const obtained = row.key === 'weapon' ? stats.gifts?.limitedCount : row.key === 'arsenal' ? stats.gifts?.standardCount : null;
      return <div key={row.key} role="group" className="border-l-2 border-amber-500 bg-zinc-50 p-3 dark:bg-zinc-900" aria-label={row.label}>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-bold text-slate-700 dark:text-zinc-200">{row.label}</span>
          <span className="font-mono text-slate-600 dark:text-zinc-300">{paidTotal / divisor} / {next / divisor} {unit}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-zinc-200 dark:bg-zinc-800">
          <div className="h-full bg-amber-500" style={{ width: `${Math.min(100, progress / (next - previous) * 100)}%` }} />
        </div>
        <p className="mt-1 text-xs text-slate-600 dark:text-zinc-400">
          {english ? `${remaining / divisor} ${unit} until the next reward` : `距离下次赠送还需 ${remaining / divisor} ${unit}`}
        </p>
        {obtained != null && <p className="mt-1 text-xs text-slate-600 dark:text-zinc-400">{t('dashboard.analysis.obtainedSummary')} {obtained}</p>}
      </div>;
    })}
    {reconstructionWeapon && <p className="text-xs text-slate-600 dark:text-zinc-400">{t('dashboard.analysis.reconstructionWeaponGiftRule')}</p>}
  </div>;
}
