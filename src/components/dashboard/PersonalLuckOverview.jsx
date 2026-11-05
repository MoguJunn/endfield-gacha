import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import { useAuthStore, usePoolStore } from '../../stores/index.js';
import { buildGameAccountKey, isGameAccountSelectionMatch } from '../../utils/gameAccountMetadata.js';
import { loadPersonalStatistics } from '../../services/scheduledStatisticsService.js';
import PersonalLuckPanel from './PersonalLuckPanel.jsx';
import { useSnapshotVersion } from '../../hooks/app/useSnapshotVersion.js';
import GameAccountPicker from '../pool/GameAccountPicker.jsx';

export default function PersonalLuckOverview({ renderStatistics = null }) {
  const user = useAuthStore(state => state.user);
  return <PersonalLuckSession key={user?.id || 'guest'} ownerId={user?.id} renderStatistics={renderStatistics} />;
}

function PersonalLuckSession({ ownerId, renderStatistics }) {
  const { isEnglish, locale } = useI18n();
  const tt = (zh, en) => isEnglish ? en : zh;
  const currentGameUid = usePoolStore(state => state.currentGameUid);
  const switchGameAccount = usePoolStore(state => state.switchGameAccount);
  const versions = useSnapshotVersion(ownerId);
  const statisticsVersion = versions?.personal?.statistics;
  const [response, setResponse] = useState(null), [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0), [choice, setChoice] = useState(null);
  const [statisticsOpen, setStatisticsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false), [refreshMessage, setRefreshMessage] = useState('');
  useEffect(() => {
    if (!ownerId) return;
    const controller = new AbortController();
    loadPersonalStatistics(controller.signal, { ownerId, checkVersion: refresh > 0, forceRefresh: refresh > 0 }).then(result => {
      if (controller.signal.aborted) return;
      if (result.meta?.ownerId !== ownerId || result.meta?.truncated) throw new Error('Incomplete account statistics');
      setResponse(previous => previous === result ? previous : result); setError(false);
      if (refresh > 0) setRefreshMessage(result.meta?.stale || !result.data
        ? 'pending' : 'ready');
    }).catch(() => { if (!controller.signal.aborted) { setError(true); setRefreshMessage(''); } })
      .finally(() => { if (!controller.signal.aborted) setRefreshing(false); });
    return () => controller.abort();
  }, [ownerId, statisticsVersion, refresh]);
  const snapshot = response?.data;
  const accounts = snapshot?.accounts || [];
  const selected = accounts.find(account => choice?.base === currentGameUid && account.key === choice.value)
    || accounts.find(account => isGameAccountSelectionMatch(account, currentGameUid)) || accounts[0];
  const account = snapshot?.luck?.version === 1 ? snapshot.luck.accounts?.find(item => item.key === selected?.key) : null;
  const controls = <div className="ml-auto flex w-full max-w-72 shrink-0 flex-col gap-2" aria-label={tt('账号与结果更新', 'Account and result updates')}>
          <GameAccountPicker accounts={accounts} value={selected?.key || ''} locale={locale}
            onChange={value => {
              setChoice({ base: currentGameUid, value });
              const next = accounts.find(item => item.key === value);
              if (next) switchGameAccount?.(buildGameAccountKey(next));
            }} />
        <button type="button" disabled={refreshing} aria-busy={refreshing} className="inline-flex min-h-10 items-center justify-center gap-2 border border-zinc-300 px-3 py-2 text-xs font-bold text-slate-700 hover:border-yellow-500 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200"
          onClick={() => { setRefreshing(true); setRefreshMessage(''); setError(false); setRefresh(value => value + 1); }}>
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />{refreshing ? tt('正在获取…', 'Refreshing…') : tt('获取最新结果', 'Refresh results')}</button>
        {refreshMessage && <p role="status" className="text-xs text-zinc-500">{refreshMessage === 'pending'
          ? tt('已获取当前结果，后台仍在更新。', 'Current results loaded; the background update is pending.') : tt('已获取最新结果。', 'Latest results loaded.')}</p>}
      </div>;
  return <div className="space-y-6" data-personal-luck-overview>
    {!ownerId ? <p className="p-6 text-sm text-zinc-500">{tt('登录后查看个人手气和抽卡高光。', 'Sign in to view your luck and pull highlights.')}</p> : <>
      {!account && controls}
      {error && <p role="alert" className="text-sm text-amber-600">{tt('统计读取失败，请重试。', 'Statistics could not be loaded. Please retry.')}</p>}
      {!response && !error && <p role="status" className="p-6 text-sm text-zinc-500">{tt('正在读取个人概览…', 'Loading personal overview…')}</p>}
      {response && !snapshot && <p role="status" className="p-6 text-sm text-zinc-500">{tt('个人概览正在等待后台首次计算，完成后自动显示。', 'Your overview is awaiting its first background calculation.')}</p>}
      {snapshot && !accounts.length && <p role="status" className="p-6 text-sm text-zinc-500">{tt('暂无已保存的游戏账号记录。', 'No saved game account records yet.')}</p>}
      {response && accounts.length > 0 && !account && <p role="status" className="p-6 text-sm text-zinc-500">{snapshot?.luck?.version === 1
        ? tt('该账号暂无可用于评价的完整抽卡记录。', 'This account has no complete pull records available for a luck rating.')
        : tt('手气评价正在等待后台更新，完成后自动显示。', 'Luck ratings are awaiting a background update and will appear automatically.')}</p>}
      {account && <PersonalLuckPanel key={account.key} account={account} toolbar={controls} />}
      {snapshot?.luck?.fetchedAt && <p className="text-[10px] text-zinc-500">{tt('更新于', 'Updated')} {new Date(snapshot.luck.fetchedAt).toLocaleString(locale)}
        {response?.meta?.stale ? ` · ${tt('正在等待后台更新', 'Awaiting background update')}` : ''}</p>}
      {snapshot && renderStatistics && <details onToggle={event => setStatisticsOpen(event.currentTarget.open)} className="border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"><summary className="cursor-pointer text-sm font-bold text-slate-800 dark:text-zinc-100">{tt('更多统计与图鉴', 'More statistics and collection')}</summary>
        {statisticsOpen && <div className="mt-6">{renderStatistics(snapshot)}</div>}</details>}
    </>}
  </div>;
}
