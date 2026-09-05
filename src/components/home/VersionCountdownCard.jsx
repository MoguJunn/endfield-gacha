import React, { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, CheckCircle2, ExternalLink, TimerReset } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import './versionCountdownCard.css';

// Data and actions are supplied by the host; themes can override --vc-* tokens.
export default function VersionCountdownCard({ target, name, onSchedule, onAnnouncements, className = '' }) {
  const { locale, isEnglish } = useI18n();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const tt = (zh, en) => (isEnglish ? en : zh);
  const timestamp = target ? new Date(target).getTime() : NaN;
  const known = Number.isFinite(timestamp);
  const released = known && timestamp <= now;
  const state = !known ? 'pending' : released ? 'released' : 'upcoming';
  const dateLabel = known
    ? new Date(timestamp).toLocaleString(locale, {
        year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : tt('等待官方公布开放时间', 'Waiting for the official release date');
  const remaining = known ? Math.max(0, timestamp - now) : null;
  const parts = remaining === null ? [null, null, null, null] : [
    Math.floor(remaining / 86400000),
    Math.floor(remaining / 3600000) % 24,
    Math.floor(remaining / 60000) % 60,
    Math.floor(remaining / 1000) % 60,
  ];

  return (
    <article className={`version-countdown-card ${className}`} data-version-state={state} aria-label={tt('版本倒计时', 'Version countdown')}>
      <div className="vc-topline">
        <span><TimerReset size={13} />VERSION / TIMELINE</span>
        <b>{!known ? tt('待公布', 'To be announced') : released ? tt('已上线', 'Released') : tt('即将开启', 'Upcoming')}</b>
      </div>
      <div className="vc-main">
        <div className="vc-title">
          <h3>{name || tt('新版本', 'Next version')}</h3>
          <p>{released
            ? tt('后续安排以官方公告为准', 'Follow official notices for the next update.')
            : known ? tt('距离版本开放', 'Until the version opens')
              : tt('版本信息公布后更新', 'Updates when the schedule is announced')}</p>
        </div>
        {released ? (
          <div className="vc-released">
            <CheckCircle2 size={23} />
            <span>
              <strong>{tt('版本已上线', 'Version released')}</strong>
              <small>{tt('可以开始探索了', 'Ready to explore')}</small>
            </span>
          </div>
        ) : (
          <div className="vc-digits" aria-label={tt('版本剩余时间', 'Time until release')}>
            {parts.map((part, index) => (
              <span key={index}>
                <b className="countdown-nums">{part === null ? '—' : String(part).padStart(2, '0')}</b>
                <small>{(isEnglish ? ['DAYS', 'HRS', 'MIN', 'SEC'] : ['天', '时', '分', '秒'])[index]}</small>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="vc-date">
        <CalendarDays size={13} />
        <time dateTime={known ? new Date(timestamp).toISOString() : undefined}>{dateLabel}</time>
      </div>
      <footer>
        <button type="button" onClick={onSchedule}>
          <CalendarDays size={13} />{tt('完整日程', 'Full schedule')}<ArrowRight size={13} />
        </button>
        <button type="button" onClick={onAnnouncements}>
          {tt('版本公告', 'Version notices')}<ExternalLink size={12} />
        </button>
      </footer>
    </article>
  );
}
