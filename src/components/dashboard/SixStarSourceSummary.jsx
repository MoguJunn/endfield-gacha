import React, { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';

/** Inline addition beside the existing count; only recorded gifts are added. */
export default function SixStarSourceSummary({ stats, category = 'target', showWinRate = true }) {
  const { isEnglish } = useI18n();
  const id = useId();
  const [trigger, setTrigger] = useState(null);
  const drawn = Number(stats?.counts?.[6] || 0) + Number(stats?.counts?.['6_std'] || 0);
  const target = stats?.winRateTargetCount ?? stats?.upSixStarCount;
  const sample = stats?.winRateTotalCount ?? stats?.sixStarCount;
  const gifted = stats?.sixStarSources?.[category === 'target' ? 'giftedTarget' : 'giftedOffrate'];
  const guaranteed = stats?.sixStarSources?.guaranteed;
  const hasSample = showWinRate && Number.isFinite(target) && Number.isFinite(sample);
  const excluded = hasSample ? Math.max(0, drawn - sample) : 0;
  const notes = [];
  if (!Number.isFinite(gifted)) {
    notes.push(isEnglish ? 'Gift / selection counts are not available in this snapshot yet.' : '此快照尚未统计赠送／自选明细。');
  } else if (gifted > 0) {
    notes.push(isEnglish
      ? `+${gifted}: gifts / selections, excluded from pull counts, pity and target rate.`
      : `+${gifted}：赠送／自选获得，不计入抽数、保底和不歪率。`);
  }
  if (category === 'target' && showWinRate) {
    if (Number.isFinite(guaranteed) && guaranteed > 0) {
      notes.push(isEnglish
        ? `${guaranteed} guaranteed hits are included in the original pull count and excluded from target rate.`
        : `原抽取数量中含 ${guaranteed} 个保障出货，按规则不计入不歪率，仍按抽取处理保底。`);
    }
    const otherExcluded = Math.max(0, excluded - (Number.isFinite(guaranteed) ? guaranteed : 0));
    if (otherExcluded > 0) notes.push(isEnglish
      ? `${otherExcluded} other displayed 6★ are outside the target-rate sample; this snapshot does not identify their sources.`
      : `另有 ${otherExcluded} 个展示六星未计入不歪率，此快照未提供具体来源。`);
  }
  if (!notes.length) return null;
  if (category === 'target' && hasSample) notes.push(isEnglish
    ? `Target rate: ${target}/${sample} (eligible UP / eligible 6★).`
    : `不歪率：${target}/${sample}（计入的 UP／计入的六星）。`);
  const label = isEnglish ? 'Six-star count details' : '六星数量说明';
  const position = (event) => {
    if (event.newState !== 'open' || !trigger) return;
    const panel = event.currentTarget;
    const anchor = trigger.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 24);
    panel.style.width = `${width}px`;
    panel.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12))}px`;
    const height = panel.getBoundingClientRect().height;
    panel.style.top = `${Math.max(12, anchor.bottom + height + 12 <= window.innerHeight ? anchor.bottom + 6 : anchor.top - height - 6)}px`;
  };

  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 align-baseline font-normal">
      {Number.isFinite(gifted) && gifted > 0 && (
        <span className="font-mono text-sm text-slate-500 dark:text-zinc-400">+{gifted}</span>
      )}
      <button ref={setTrigger} type="button" popoverTarget={id} aria-label={label} title={notes.join('\n')}
        className="relative z-10 inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-1 dark:text-zinc-500 dark:hover:text-zinc-200">
        <CircleAlert size={13} aria-hidden="true" />
      </button>
      {trigger && createPortal(
        <div id={id} popover="auto" role="note" aria-label={label} onToggle={position}
          className="fixed m-0 space-y-1.5 rounded border border-zinc-200 bg-white p-3 text-left font-sans text-xs font-normal leading-relaxed text-slate-600 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {notes.map((note) => <p key={note}>{note}</p>)}
        </div>, document.body,
      )}
    </span>
  );
}
