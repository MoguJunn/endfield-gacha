import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Radio } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import { DANQING_PREVIEW } from '../../constants/versionPreview.js';
import './danqingPreviewCard.css';

export default function DanqingPreviewCard() {
  const { isEnglish } = useI18n();
  const tt = (zh, en) => isEnglish ? en : zh;
  const [now, setNow] = useState(Date.now);
  const remaining = Math.max(0, new Date(DANQING_PREVIEW.startsAt).getTime() - now);
  const started = remaining === 0;
  useEffect(() => {
    if (started) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [started]);
  const parts = [
    Math.floor(remaining / 86400000),
    Math.floor(remaining / 3600000) % 24,
    Math.floor(remaining / 60000) % 60,
    Math.floor(remaining / 1000) % 60,
  ];

  return (
    <article className="danqing-preview" aria-label={tt('丹青渡版本前瞻', 'Sanctuary of Ink special program')}>
      <div className="danqing-preview__art">
        <img src={DANQING_PREVIEW.poster} width="1920" height="1080"
          alt={tt('丹青渡，前瞻特别节目，2026年10月6日19:30', 'Sanctuary of Ink special program — October 6, 2026, 19:30 UTC+8')}
          decoding="async" />
      </div>
      <div className="danqing-preview__details">
        <div className="danqing-preview__eyebrow">{tt('前瞻特别节目', 'SPECIAL PROGRAM')}</div>
        <time dateTime={DANQING_PREVIEW.startsAt}>10.06 <span>19:30</span><small>{tt('北京时间', 'UTC+8')} · 2026</small></time>
        {remaining > 0 ? (
          <div className="danqing-preview__clock" role="timer" aria-label={tt('距离前瞻播出', 'Until the special program')}>
            {parts.map((part, index) => <span key={index}>
              <b className="countdown-nums">{String(part).padStart(2, '0')}</b>
              <small>{(isEnglish ? ['DAYS', 'HRS', 'MIN', 'SEC'] : ['天', '时', '分', '秒'])[index]}</small>
            </span>)}
          </div>
        ) : <p className="danqing-preview__started">{tt('已到播出时间', 'Broadcast time reached')}</p>}
        <a href={DANQING_PREVIEW.liveUrl} target="_blank" rel="noopener noreferrer">
          <Radio size={13} />{tt('B站直播间', 'Bilibili live')}<ArrowUpRight size={13} />
        </a>
      </div>
    </article>
  );
}
