import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';

const LIVE_SHOW_TARGET_AT = '2026-07-10T19:30:00+08:00';
const BILIBILI_LIVE_ROOM_URL = 'https://live.bilibili.com/1921300321';
const YOUTUBE_PREVIEW_URL = 'https://www.youtube.com/watch?v=vNTiJWEYu6Q';

const INK_BARCODE_BARS = [
  { id: 'bar-1', widthPx: 3 },
  { id: 'bar-2', widthPx: 8 },
  { id: 'bar-3', widthPx: 2 },
  { id: 'bar-4', widthPx: 11 },
  { id: 'bar-5', widthPx: 3 },
  { id: 'bar-6', widthPx: 6 },
  { id: 'bar-7', widthPx: 2 },
];

const CARD_COPY_ZH = {
  programTitle: '前瞻特别节目',
  scheduleLabel: '开启时间',
  scheduleText: '7月10日 19:30',
  countdownHint: '距节目开播还有',
  unitDays: '天',
  unitHours: '时',
  unitMinutes: '分',
  unitSeconds: '秒',
  liveNowTitle: '已开播',
  liveNowSubtitle: '前瞻特别节目正在播出，欢迎前往直播间观看',
  bilibiliButton: 'B站直播间',
  youtubeButton: 'YouTube',
  tagline: '向渊而行，新章将启',
};

const CARD_COPY_EN = {
  programTitle: 'Preview Special Program',
  scheduleLabel: 'Starts At',
  scheduleText: 'Jul 10, 19:30',
  countdownHint: 'Program goes live in',
  unitDays: 'Days',
  unitHours: 'Hrs',
  unitMinutes: 'Min',
  unitSeconds: 'Sec',
  liveNowTitle: 'Live Now',
  liveNowSubtitle: 'The preview special program is streaming now',
  bilibiliButton: 'Bilibili Live',
  youtubeButton: 'YouTube',
  tagline: 'Toward the abyss, a new chapter begins',
};

function calculateTimeLeft(targetTimestampMs) {
  const diffMs = targetTimestampMs - Date.now();

  if (diffMs <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, ended: true };
  }

  return {
    days: Math.floor(diffMs / 86400000),
    hours: Math.floor(diffMs / 3600000) % 24,
    minutes: Math.floor(diffMs / 60000) % 60,
    seconds: Math.floor(diffMs / 1000) % 60,
    ended: false,
  };
}

function formatCountdownNumber(value) {
  return String(value).padStart(2, '0');
}

export default function HomecomingPreviewCard() {
  const { isEnglish } = useI18n();
  const copy = isEnglish ? CARD_COPY_EN : CARD_COPY_ZH;
  const serifDisplayStyle = {
    fontFamily: '"Harmony Sans App", "Noto Serif SC", "Source Han Serif SC", serif',
  };

  const targetTimestampMs = useMemo(() => new Date(LIVE_SHOW_TARGET_AT).getTime(), []);
  const [timeLeft, setTimeLeft] = useState(() => calculateTimeLeft(targetTimestampMs));

  useEffect(() => {
    if (timeLeft.ended) {
      return undefined;
    }

    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft(targetTimestampMs));
    }, 1000);

    return () => clearInterval(timer);
  }, [targetTimestampMs, timeLeft.ended]);

  const countdownUnits = [
    { id: 'days', value: timeLeft.days, label: copy.unitDays },
    { id: 'hours', value: timeLeft.hours, label: copy.unitHours },
    { id: 'minutes', value: timeLeft.minutes, label: copy.unitMinutes },
    { id: 'seconds', value: timeLeft.seconds, label: copy.unitSeconds },
  ];

  const gridPaperStyle = {
    backgroundImage: 'linear-gradient(rgba(24,24,24,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(24,24,24,0.06) 1px, transparent 1px)',
    backgroundSize: '22px 22px',
  };

  return (
    <section className="relative min-h-[300px] overflow-hidden border border-zinc-300 bg-[#f5f3ee] text-zinc-900 shadow-2xl dark:border-white/10">
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0"
          style={{
            background: [
              'radial-gradient(ellipse 44% 36% at 78% 2%, rgba(126,164,138,0.42), transparent 68%)',
              'radial-gradient(ellipse 26% 20% at 60% 16%, rgba(126,164,138,0.22), transparent 70%)',
              'radial-gradient(ellipse 42% 30% at 98% 34%, rgba(84,90,86,0.28), transparent 72%)',
              'linear-gradient(180deg, #f7f5f0 0%, #efede6 100%)',
            ].join(', '),
          }}
        />
        <div
          className="absolute inset-0 opacity-50"
          style={{
            background: [
              'linear-gradient(114deg, transparent 56%, rgba(64,62,58,0.16) 64%, transparent 78%)',
              'linear-gradient(78deg, transparent 28%, rgba(64,62,58,0.08) 35%, transparent 44%)',
            ].join(', '),
          }}
        />
        <svg
          className="absolute bottom-0 left-0 h-14 w-full md:h-20"
          viewBox="0 0 1200 120"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M0,120 L0,92 C120,86 240,98 360,90 C500,80 560,96 680,92 C820,86 900,98 1020,92 C1100,88 1160,94 1200,90 L1200,120 Z"
            fill="#4a4a46"
            opacity="0.45"
          />
          <path
            d="M0,120 L0,74 C50,62 110,84 170,76 C250,66 290,42 350,50 C410,58 450,84 530,80 C610,76 650,54 716,46 C758,42 796,60 848,68 C916,78 976,54 1038,62 C1102,70 1158,84 1200,76 L1200,120 Z"
            fill="#111110"
            opacity="0.92"
          />
        </svg>
        <span className="absolute left-[36%] top-7 hidden h-1.5 w-1.5 bg-[#c8101a]/85 md:block" />
        <span className="absolute left-[33%] top-[58%] hidden h-1 w-1 bg-[#c8101a]/70 md:block" />
      </div>

      <div className="relative z-10 flex min-h-[300px] flex-col md:grid md:grid-cols-[minmax(170px,auto)_1fr]">
        <div className="flex flex-row items-start justify-between gap-4 border-b border-zinc-900/10 p-5 md:flex-col md:items-stretch md:border-b-0 md:border-r md:p-6">
          <div className="flex items-stretch gap-1.5">
            <div className="bg-zinc-950 px-2 py-1.5 text-white">
              <p className="text-[10px] font-black leading-tight tracking-[0.1em]">明日方舟<br />终末地</p>
              <p className="mt-1 text-[6px] uppercase tracking-[0.16em] text-white/65">Arknights Endfield</p>
            </div>
            <div className="flex flex-col items-center justify-center bg-zinc-950 px-2 py-1.5 text-white">
              <p className="text-lg font-black leading-none">26</p>
              <p className="mt-1 text-[7px] font-bold leading-none tracking-[0.1em]">相伴庆典</p>
              <p className="mt-0.5 text-[5px] uppercase tracking-[0.1em] text-white/65">Companionship</p>
            </div>
          </div>

          <div className="flex items-start justify-end gap-3 md:flex-1 md:justify-center md:py-4">
            <div className="hidden items-end gap-[3px] pt-1 md:flex">
              {INK_BARCODE_BARS.map((bar) => (
                <span
                  key={bar.id}
                  className="h-5 bg-zinc-900/85"
                  style={{ width: `${bar.widthPx}px` }}
                />
              ))}
            </div>
            <span className="pt-1 text-[10px] font-bold uppercase tracking-[0.4em] text-zinc-500 md:pt-2 md:[writing-mode:vertical-rl]">
              Homecoming
            </span>
            <div className="relative">
              <span className="absolute inset-y-0 left-1/2 hidden w-[2px] -translate-x-1/2 bg-[#c8101a]/75 md:block" aria-hidden="true" />
              <h2
                className="relative text-3xl font-black tracking-[0.16em] text-zinc-900 md:text-5xl md:leading-none md:tracking-[0.3em] md:[writing-mode:vertical-rl]"
                style={serifDisplayStyle}
              >
                向渊行
              </h2>
            </div>
          </div>

          <p className="hidden text-[10px] tracking-[0.2em] text-zinc-500 md:block">
            {copy.tagline}
          </p>
        </div>

        <div className="flex flex-1 flex-col justify-center p-5 pb-12 md:p-8 md:pb-14">
          <div className="relative mx-auto w-full max-w-xl border border-zinc-900/15 bg-white/90 shadow-[0_18px_44px_-20px_rgba(20,20,18,0.45)]">
            <div className="absolute inset-y-0 right-0 hidden w-7 items-center justify-center border-l border-zinc-900/10 sm:flex">
              <span className="text-[8px] uppercase tracking-[0.32em] text-zinc-500 [writing-mode:vertical-rl]">
                Arknights: Endfield
              </span>
            </div>

            <div className="p-4 md:p-6 sm:pr-11 md:pr-12">
              <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b-2 border-[#c8101a] pb-2.5">
                <h3
                  className="text-lg font-black tracking-[0.1em] text-[#c8101a] md:text-xl"
                  style={serifDisplayStyle}
                >
                  {copy.programTitle}
                </h3>
                <div className="text-right">
                  <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-[#c8101a]">
                    {copy.scheduleLabel}
                  </p>
                  <p className="text-sm font-black tracking-wider text-zinc-900">
                    {copy.scheduleText}
                    <span className="ml-1 text-[9px] font-bold text-zinc-500">UTC+8</span>
                  </p>
                </div>
              </div>

              <div className="relative mt-4 border border-zinc-900/8" style={gridPaperStyle}>
                {timeLeft.ended ? (
                  <div className="flex flex-col items-center gap-1.5 px-4 py-7">
                    <span
                      className="text-4xl font-black tracking-[0.2em] text-[#c8101a] md:text-5xl"
                      style={serifDisplayStyle}
                    >
                      {copy.liveNowTitle}
                    </span>
                    <span className="text-center text-[11px] tracking-[0.12em] text-zinc-600">
                      {copy.liveNowSubtitle}
                    </span>
                  </div>
                ) : (
                  <div className="px-3 py-4 md:py-5">
                    <p className="text-center text-[9px] font-bold uppercase tracking-[0.32em] text-zinc-500">
                      {copy.countdownHint}
                    </p>
                    <div className="mt-2 flex items-start justify-center gap-1.5 md:gap-2.5">
                      {countdownUnits.map((unit, index) => (
                        <React.Fragment key={unit.id}>
                          {index > 0 && (
                            <span className="pt-1 text-2xl font-black leading-none text-zinc-400 md:pt-1.5 md:text-4xl" aria-hidden="true">
                              :
                            </span>
                          )}
                          <div className="flex flex-col items-center">
                            <span className="text-4xl font-black leading-none tracking-tight text-zinc-900 tabular-nums md:text-6xl">
                              {formatCountdownNumber(unit.value)}
                            </span>
                            <span className="mt-1.5 text-[9px] font-bold uppercase tracking-[0.28em] text-zinc-500">
                              {unit.label}
                            </span>
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div
                className="mt-3 h-2"
                style={{
                  background: 'linear-gradient(90deg, rgba(200,16,26,0.14) 0%, rgba(200,16,26,0.92) 22%, #c8101a 58%, rgba(200,16,26,0.3) 100%)',
                }}
              />

              <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[9px] uppercase tracking-[0.26em] text-zinc-600">
                    Endfield Industries
                  </p>
                  <p className="mt-0.5 text-[8px] uppercase tracking-[0.26em] text-zinc-400">
                    — From Talos-II
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={BILIBILI_LIVE_ROOM_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 border border-[#c8101a] bg-[#c8101a] px-3 py-1.5 text-[11px] font-bold tracking-widest text-white transition-colors hover:bg-[#a30d15] focus:outline-none focus:ring-2 focus:ring-zinc-900"
                  >
                    <ExternalLink size={12} />
                    {copy.bilibiliButton}
                  </a>
                  <a
                    href={YOUTUBE_PREVIEW_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 border border-zinc-900/30 bg-white/70 px-3 py-1.5 text-[11px] font-bold tracking-widest text-zinc-800 transition-colors hover:border-zinc-900 hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#c8101a]"
                  >
                    <ExternalLink size={12} />
                    {copy.youtubeButton}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="absolute bottom-2 right-3 z-10 text-[8px] font-bold tracking-[0.24em] text-white/60">
        © HYPERGRYPH
      </p>
    </section>
  );
}
