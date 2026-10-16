import React from 'react';
import { getTimelineBarColor } from '../../utils/timelineVisuals.js';
import { useI18n } from '../../i18n/index.js';

export default function PoolAcquisitionCards({ section, showFiveStarDrops = true }) {
  const { isEnglish, locale } = useI18n();
  const text = (zh, en) => isEnglish ? en : zh;
  const rows = (section.acquisitions || []).filter(row => showFiveStarDrops || row.rarity >= 6);
  const date = value => {
    if (!value || !Number.isFinite(new Date(value).getTime())) return text('时间未知', 'Time unknown');
    return new Date(value).toLocaleString(locale, { year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };
  return <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" aria-label={section.title}>
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <div><h3 className="font-bold text-slate-900 dark:text-zinc-100">{section.title}</h3>
        <p className="mt-1 text-xs text-zinc-500">{section.period} · {section.status?.isExpired ? text('已结束', 'Ended') : section.status?.isUpcoming ? text('未开始', 'Upcoming') : section.status?.isActive ? text('进行中', 'Active') : text('长期开放', 'Permanent')}</p></div>
      <span className="font-mono text-xs text-zinc-500">{text(`${rows.length} 条已知出货`, `${rows.length} known drops`)}</span>
    </header>
    {!Array.isArray(section.acquisitions) ? <p className="p-4 text-sm text-zinc-500" role="status">{text('正在更新逐条出货详情，请稍后刷新。', 'Drop details are being updated. Refresh shortly.')}</p>
      : !rows.length ? <p className="p-4 text-sm text-zinc-500">{text('此卡池暂无符合筛选的高星结果。', 'No high-rarity results match the filter.')}</p>
      : <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">{rows.map((row, index) => {
        const special = row.drawMethod === 'gift' ? text('额外赠送', 'Gift') : row.drawMethod === 'free' ? text('免费十连', 'Free ten-pull') : row.drawMethod === 'info_book' ? text('情报书', 'Intel ticket') : null;
        return <article key={row.id || index} className="relative overflow-hidden rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
          <span className="absolute inset-y-0 left-0 w-1" style={{ background: getTimelineBarColor(section.type, row) }} />
          <div className="mb-3 flex items-center gap-3 pl-1">
            {row.avatarUrl ? <img src={row.avatarUrl} alt="" loading="lazy" className="h-12 w-12 rounded-lg object-cover" /> : <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-100 font-bold text-amber-600 dark:bg-zinc-800">{row.rarity}★</span>}
            <div className="min-w-0"><h4 className="break-words font-bold text-slate-900 dark:text-zinc-100">{row.name}</h4>
              <span className="text-xs text-zinc-500">{row.rarity}★{special ? ` · ${special}` : row.stageKind === 'up' ? ' · UP' : row.stageKind === 'offLimited' ? text(' · 歪其他限定', ' · Other limited') : row.stageKind === 'offStandard' ? text(' · 常驻', ' · Standard') : ''}</span></div>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div><dt className="text-zinc-500">{text('本次出货间隔', 'Pulls since previous drop')}</dt><dd className="mt-1 font-mono font-bold text-slate-800 dark:text-zinc-200">{special || (row.intervalPulls == null ? text('未知', 'Unknown') : text(`${row.intervalPulls} 抽`, `${row.intervalPulls} pulls`))}</dd></div>
            <div><dt className="text-zinc-500">{text('本池已存位置', 'Position in saved banner history')}</dt><dd className="mt-1 font-mono font-bold text-slate-800 dark:text-zinc-200">{row.pullIndex == null ? '—' : text(`第 ${row.pullIndex} 抽`, `Pull #${row.pullIndex}`)}</dd></div>
          </dl>
          <time className="mt-3 block border-t border-zinc-200 pt-2 font-mono text-[11px] text-zinc-500 dark:border-zinc-700" dateTime={row.timestamp || undefined}>{date(row.timestamp)}</time>
        </article>;
      })}</div>}
    {section.type === 'weapon' && <p className="px-4 pb-3 text-[11px] text-zinc-500">{text('位置按已存武器结果计数；十连内序号不等同于申领次数。额外赠送不计入抽数。', 'Positions count saved weapon results; order within a ten-pull is not claim cost. Gifts do not count as pulls.')}</p>}
  </section>;
}
