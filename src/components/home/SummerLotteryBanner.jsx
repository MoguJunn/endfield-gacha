import React from 'react';
import { ArrowUpRight, CalendarDays, Gift, Sparkles, Waves } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';

const LOTTERY_URL = String(import.meta.env.VITE_SUMMER_LOTTERY_URL || '').trim();

export default function SummerLotteryBanner({ compact = false }) {
  const { t } = useI18n();
  if (!LOTTERY_URL) return null;

  return (
    <a
      href={LOTTERY_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={compact
        ? 'group relative mb-6 block overflow-hidden rounded-xl border border-cyan-300/70 bg-gradient-to-br from-cyan-500 via-sky-600 to-blue-700 p-4 text-white shadow-lg'
        : 'group relative block overflow-hidden border border-cyan-300/70 bg-gradient-to-r from-sky-700 via-cyan-600 to-cyan-400 px-6 py-5 text-white shadow-md transition-transform hover:-translate-y-0.5 hover:shadow-xl'}
      aria-label={t('home.summerLottery.open')}
    >
      <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_center,white_1px,transparent_1.5px)] [background-size:9px_9px]" />
      <div className="absolute -right-7 -top-7 h-36 w-36 rounded-full bg-yellow-300/90 shadow-[0_0_0_18px_rgba(253,224,71,0.15)]" />
      <Waves className="absolute -bottom-6 right-4 text-white/15" size={compact ? 110 : 150} />
      <div className={`relative z-10 ${compact ? 'space-y-3' : 'flex items-center justify-between gap-6'}`}>
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-[9px] font-black tracking-[0.22em] text-cyan-50">
            <Sparkles size={13} className="text-yellow-200" /> SUMMER CARNIVAL // 2026
          </div>
          <h3 className={`${compact ? 'text-xl' : 'text-2xl'} font-black tracking-tight text-white`}>
            {t('home.summerLottery.title')}
          </h3>
          <p className={`mt-1 max-w-2xl leading-relaxed text-cyan-50/90 ${compact ? 'text-[10px]' : 'text-xs'}`}>
            {t('home.summerLottery.description')}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] font-bold">
            <span className="inline-flex items-center gap-1.5 bg-white/15 px-2 py-1 backdrop-blur-sm">
              <CalendarDays size={12} /> {t('home.summerLottery.date')}
            </span>
            <span className="inline-flex items-center gap-1.5 bg-yellow-300 px-2 py-1 text-sky-900">
              <Gift size={12} /> {t('home.summerLottery.prize')}
            </span>
          </div>
        </div>
        <span className={`relative z-10 inline-flex shrink-0 items-center justify-center gap-2 bg-orange-500 font-black text-white shadow-[5px_5px_0_rgba(255,255,255,0.35)] transition-transform group-hover:-translate-y-0.5 ${compact ? 'w-full px-4 py-3 text-xs' : 'px-5 py-3 text-sm'}`}>
          {t('home.summerLottery.action')} <ArrowUpRight size={16} />
        </span>
      </div>
    </a>
  );
}
