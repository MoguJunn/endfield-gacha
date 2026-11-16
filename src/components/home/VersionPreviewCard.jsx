import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Radio } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import { ACTIVE_VERSION_PREVIEW } from '../../constants/versionPreview.js';
import './versionPreviewCard.css';

export default function VersionPreviewCard({ preview = ACTIVE_VERSION_PREVIEW }) {
  const { isEnglish } = useI18n();
  const tt = (zh, en) => isEnglish ? en : zh;
  const [now, setNow] = useState(Date.now);
  const broadcastAt = new Date(preview.startsAt);
  const title = (isEnglish ? preview.titleEn : preview.title) || tt('版本前瞻', 'Version preview');
  const dateParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(broadcastAt);
  const date = Object.fromEntries(dateParts.map(({ type, value }) => [type, value]));
  const remaining = Math.max(0, broadcastAt.getTime() - now);
  const started = remaining === 0;
  useEffect(() => {
    if (started) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [started, preview.startsAt]);
  const parts = [
    Math.floor(remaining / 86400000),
    Math.floor(remaining / 3600000) % 24,
    Math.floor(remaining / 60000) % 60,
    Math.floor(remaining / 1000) % 60,
  ];

  return (
    <article className="version-preview" aria-label={title} data-preview-state={started ? 'started' : 'upcoming'}>
      <div className="version-preview__art">
        <div className="version-preview__texture" aria-hidden="true" />
        <div className="version-preview__sparkles" aria-hidden="true"><i>✦</i><i>✧</i><i>✦</i><i>✧</i><i>✦</i></div>
        <div className="version-preview__brand" aria-hidden="true">
          <small>明日方舟</small>
          <strong>终末地</strong>
          <em>ARKNIGHTS ENDFIELD</em>
        </div>
        <svg className="version-preview__shell" viewBox="0 0 260 230" fill="none" aria-hidden="true">
          <path d="m143 12 16 62 40-51-10 62 60-18-42 45 48 33-64 1 15 59-46-39-28 56-5-64-58 24 35-51-55-30 63-7-20-58 48 38z" fill="#f777ab" />
          <path d="m143 12 16 62 40-51-10 62 60-18-42 45 48 33-64 1 15 59-46-39-28 56-5-64-58 24 35-51-55-30 63-7-20-58 48 38z" stroke="#ffe076" strokeWidth="2" />
          <path d="M52 134c-7-36 24-70 67-75 41-5 85 13 90 44 4 29-30 49-68 62l-27 26-25-41c-19 1-32-5-37-16Z" fill="#713ac7" />
          <path d="M64 128c7-28 42-48 79-43 22 3 42 12 48 24-19-6-54-3-77 16l-14 31-13-18c-12 1-20-3-23-10Z" fill="#a057dd" />
          <path d="m107 153-4-27m8 20 10-27m-5 22 23-27m-18 24 35-22m-31 22 47-12" stroke="#53d6ce" strokeWidth="6" strokeLinecap="round" />
          <circle cx="220" cy="80" r="16" fill="#843bc9" stroke="#ffdf4f" strokeWidth="5" />
          <circle cx="220" cy="80" r="8" fill="#f087cb" />
        </svg>
        <div className="version-preview__lockup">
          <div className="version-preview__version-word" aria-hidden="true">VERSION</div>
          <div className="version-preview__program-mark" aria-hidden="true"><span>➜</span>{tt('特别节目', 'SPECIAL PROGRAM')}</div>
          <div className="version-preview__title-strip">
            <span aria-hidden="true">○=</span><h3>{title}</h3><span aria-hidden="true">○=</span>
          </div>
          <div className="version-preview__subtitle" aria-hidden="true">OVER THE FRONTIER / INTO THE FRONT</div>
        </div>
        <div className="version-preview__art-footer" aria-hidden="true"><b>TALOS-II</b><span>ENDFIELD INDUSTRIES<br />— ENDLESS POSSIBILITIES —</span></div>
      </div>
      <div className="version-preview__details">
        <div className="version-preview__schedule">
          <span className="version-preview__eyebrow">{tt('前瞻特别节目', 'SPECIAL PROGRAM')}</span>
          <time dateTime={preview.startsAt}><b>{date.month}.{date.day}</b><span>{date.hour}:{date.minute}</span><small>{tt('北京时间', 'UTC+8')} · {date.year}</small></time>
        </div>
        <div className="version-preview__countdown">
          <span className="version-preview__countdown-label">{tt('距离开播', 'STARTS IN')}</span>
          {remaining > 0 ? (
            <div className="version-preview__clock" role="timer" aria-label={tt('距离前瞻播出', 'Until the special program')}>
              {parts.map((part, index) => <span key={index}>
                <b>{String(part).padStart(2, '0')}</b>
                <small>{(isEnglish ? ['DAYS', 'HRS', 'MIN', 'SEC'] : ['天', '时', '分', '秒'])[index]}</small>
              </span>)}
            </div>
          ) : <p className="version-preview__started">{tt('已到播出时间', 'Broadcast time reached')}</p>}
        </div>
        <a href={preview.liveUrl} target="_blank" rel="noopener noreferrer">
          <Radio size={13} />{tt('B站直播间', 'Bilibili live')}<ArrowUpRight size={13} />
        </a>
      </div>
    </article>
  );
}
