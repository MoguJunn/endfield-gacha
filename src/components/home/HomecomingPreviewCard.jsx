import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Play, TimerReset } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';

export const VERSION_RESOURCE_IMAGE_URL = 'https://i0.hdslb.com/bfs/new_dyn/25b3a28988e2c78d210aec1affcee0b01265652806.png';
export const VERSION_PREVIEW_VIDEO_URL = 'https://www.bilibili.com/video/BV1VQ8i6uEr4/';

function resolveCountdown(targetDate, now) {
  const target = new Date(targetDate);
  if (Number.isNaN(target.getTime())) return null;

  const diff = target.getTime() - now.getTime();
  if (diff <= 0) {
    return { ended: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
  }

  return {
    ended: false,
    days: Math.floor(diff / 86400000),
    hours: Math.floor((diff % 86400000) / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
  };
}

export default function HomecomingPreviewCard({
  targetDate,
  title = '',
  compact = false,
}) {
  const { t, isEnglish } = useI18n();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const countdown = useMemo(() => resolveCountdown(targetDate, now), [now, targetDate]);
  const units = [
    ['days', isEnglish ? 'D' : '天'],
    ['hours', isEnglish ? 'H' : '时'],
    ['minutes', isEnglish ? 'M' : '分'],
    ['seconds', isEnglish ? 'S' : '秒'],
  ];

  return (
    <section className={`group relative h-full flex-1 overflow-hidden border border-sky-200 bg-zinc-950 text-white shadow-xl dark:border-sky-900/70 ${compact ? 'rounded-xl' : ''}`}>
      <div className={`relative ${compact ? 'aspect-[16/11]' : 'h-full min-h-[360px]'}`}>
        <img
          src={VERSION_RESOURCE_IMAGE_URL}
          alt={t('home.versionPreview.imageAlt')}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/5 to-black/10" />
        <div className="absolute inset-x-0 bottom-0 h-[52%] bg-gradient-to-t from-black/95 via-black/65 to-transparent" />

        <div className={`absolute bottom-0 right-0 z-10 border-l border-t border-white/20 bg-black/75 backdrop-blur-xl ${compact ? 'w-full p-3' : 'm-4 w-[min(92%,430px)] p-4'}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-sky-200">
                <TimerReset size={12} /> {t('home.versionPreview.countdownLabel')}
              </p>
              {title ? <p className="mt-1 truncate text-xs font-bold text-white/80">{title}</p> : null}
            </div>
            <a
              href={VERSION_PREVIEW_VIDEO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 bg-sky-500 px-3 py-2 text-[10px] font-black text-white shadow-lg transition-colors hover:bg-sky-400"
            >
              <Play size={12} fill="currentColor" />
              {t('home.versionPreview.videoAction')}
              <ArrowUpRight size={11} />
            </a>
          </div>

          <div className="mt-3">
            {countdown?.ended ? (
              <p className="border border-sky-300/40 bg-sky-400/15 px-3 py-2 text-center text-sm font-black text-sky-100">
                {t('home.versionLaunched')}
              </p>
            ) : countdown ? (
              <div className="grid grid-cols-4 gap-1.5">
                {units.map(([key, label]) => (
                  <div key={key} className="border border-white/15 bg-white/10 px-1 py-2 text-center">
                    <strong className={`${compact ? 'text-lg' : 'text-2xl'} block font-mono font-black leading-none`}>
                      {String(countdown[key]).padStart(2, '0')}
                    </strong>
                    <span className="mt-1 block text-[8px] font-bold uppercase tracking-widest text-white/55">{label}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-white/60">{t('home.nextVersionWaiting')}</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
