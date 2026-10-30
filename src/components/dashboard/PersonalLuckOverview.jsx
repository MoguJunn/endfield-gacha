import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import { useAuthStore, usePoolStore } from '../../stores/index.js';
import { buildGameAccountKey, isGameAccountSelectionMatch } from '../../utils/gameAccountMetadata.js';
import { loadPersonalStatistics } from '../../services/scheduledStatisticsService.js';
import PersonalLuckPanel from './PersonalLuckPanel.jsx';
import { useSnapshotVersion } from '../../hooks/app/useSnapshotVersion.js';

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
  useEffect(() => {
    if (!ownerId) return;
    const controller = new AbortController();
    loadPersonalStatistics(controller.signal, { ownerId, checkVersion: refresh > 0 }).then(result => {
      if (controller.signal.aborted) return;
      if (result.meta?.ownerId !== ownerId || result.meta?.truncated) throw new Error('Incomplete account statistics');
      setResponse(previous => previous === result ? previous : result); setError(false);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [ownerId, statisticsVersion, refresh]);
  const snapshot = response?.data;
  const accounts = snapshot?.accounts || [];
  const selected = accounts.find(account => choice?.base === currentGameUid && account.key === choice.value)
    || accounts.find(account => isGameAccountSelectionMatch(account, currentGameUid)) || accounts[0];
  const account = snapshot?.luck?.version === 1 ? snapshot.luck.accounts?.find(item => item.key === selected?.key) : null;
  return <div className="space-y-6" data-personal-luck-overview>
    {!ownerId ? <p className="p-6 text-sm text-zinc-500">{tt('登录后查看个人手气和抽卡高光。', 'Sign in to view your luck and pull highlights.')}</p> : <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex max-w-full flex-wrap items-center gap-3 text-xs font-bold text-zinc-500">{tt('游戏账号', 'Game account')}
          <select className="max-w-full border border-zinc-300 bg-white px-3 py-2 text-slate-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            aria-label={tt('游戏账号', 'Game account')} value={selected?.key || ''} disabled={!accounts.length}
            onChange={event => {
              setChoice({ base: currentGameUid, value: event.target.value });
              const next = accounts.find(item => item.key === event.target.value);
              if (next) switchGameAccount?.(buildGameAccountKey(next));
            }}>
            {!accounts.length && <option value="">—</option>}
            {accounts.map(item => <option key={item.key} value={item.key}>{item.name} · {item.gameUid} · {item.serverScope}</option>)}
          </select></label>
        <button type="button" className="inline-flex items-center gap-2 text-xs text-zinc-500" onClick={() => { setError(false); setRefresh(value => value + 1); }}>
          <RefreshCw size={14} />{tt('获取最新结果', 'Refresh results')}</button>
      </div>
      {error && <p role="alert" className="text-sm text-amber-600">{tt('统计读取失败，请重试。', 'Statistics could not be loaded. Please retry.')}</p>}
      {!response && !error && <p role="status" className="p-6 text-sm text-zinc-500">{tt('正在读取个人概览…', 'Loading personal overview…')}</p>}
      {response && !snapshot && <p role="status" className="p-6 text-sm text-zinc-500">{tt('个人概览正在等待后台首次计算，完成后自动显示。', 'Your overview is awaiting its first background calculation.')}</p>}
      {snapshot && !accounts.length && <p role="status" className="p-6 text-sm text-zinc-500">{tt('暂无已保存的游戏账号记录。', 'No saved game account records yet.')}</p>}
      {response && accounts.length > 0 && !account && <p role="status" className="p-6 text-sm text-zinc-500">{snapshot?.luck?.version === 1
        ? tt('该账号暂无可用于评价的完整抽卡记录。', 'This account has no complete pull records available for a luck rating.')
        : tt('手气评价正在等待后台更新，完成后自动显示。', 'Luck ratings are awaiting a background update and will appear automatically.')}</p>}
      {account && <PersonalLuckPanel key={account.key} account={account} />}
      {snapshot?.luck?.fetchedAt && <p className="text-[10px] text-zinc-500">{tt('更新于', 'Updated')} {new Date(snapshot.luck.fetchedAt).toLocaleString(locale)}
        {response?.meta?.stale ? ` · ${tt('正在等待后台更新', 'Awaiting background update')}` : ''}</p>}
      {snapshot && renderStatistics && <details onToggle={event => setStatisticsOpen(event.currentTarget.open)} className="border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"><summary className="cursor-pointer text-sm font-bold text-slate-800 dark:text-zinc-100">{tt('更多统计与图鉴', 'More statistics and collection')}</summary>
        {statisticsOpen && <div className="mt-6">{renderStatistics(snapshot)}</div>}</details>}
    </>}
  </div>;
}
