import React from 'react';
import { ArrowUpRight, CalendarDays, Gift, Sparkles } from 'lucide-react';
import arknightsMonthlyCard from '../../assets/lottery/arknights-monthly-card.png';
import endfieldMonthlyCard from '../../assets/lottery/endfield-monthly-card.png';
import { useI18n } from '../../i18n/index.js';
import './SummerLotteryBanner.css';

const LOTTERY_URL = String(import.meta.env.VITE_SUMMER_LOTTERY_URL || '/lottery').trim();

export default function SummerLotteryBanner({ compact = false }) {
  const { t } = useI18n();
  if (!LOTTERY_URL) return null;

  return (
    <a
      href={LOTTERY_URL}
      className={`summer-lottery-banner group ${compact ? 'summer-lottery-banner--compact mb-6' : ''}`}
      aria-label={t('home.summerLottery.open')}
    >
      <section className="summer-lottery-banner__info">
        <div className="summer-lottery-banner__kicker">
          <Sparkles size={13} /> SPECIAL LOTTERY // 2026
        </div>
        <div className="summer-lottery-banner__partners">
          <span>Arknights</span><b>×</b><span>Persona 3 Reload</span>
        </div>
        <h3>{t('home.summerLottery.title')}</h3>
        <p>{t('home.summerLottery.description')}</p>
        <div className="summer-lottery-banner__meta">
          <span>
            <CalendarDays size={12} /> {t('home.summerLottery.date')}
          </span>
          <span>
            <Gift size={12} /> {t('home.summerLottery.prize')}
          </span>
        </div>
        <span className="summer-lottery-banner__action">
          {t('home.summerLottery.action')} <ArrowUpRight size={16} />
        </span>
      </section>

      <section className="summer-lottery-banner__visual" aria-hidden="true">
        <div className="summer-lottery-banner__sky" />
        <div className="summer-lottery-banner__horizon" />
        <div className="summer-lottery-banner__curve" />
        <div className="summer-lottery-banner__shards"><i /><i /><i /><i /></div>
        <div className="summer-lottery-banner__lockup">
          <strong>ARKNIGHTS</strong>
          <b>×</b>
          <strong>PERSONA 3<br />RELOAD</strong>
          <small>COMMUNITY COLLABORATION // 2026</small>
        </div>
        <div className="summer-lottery-banner__prizes">
          <div className="summer-lottery-banner__choice summer-lottery-banner__choice--1">
            <img src={arknightsMonthlyCard} alt="" />
            <span>OPTION 01</span>
          </div>
          <div className="summer-lottery-banner__choice summer-lottery-banner__choice--2">
            <img src={endfieldMonthlyCard} alt="" />
            <span>OPTION 02</span>
          </div>
        </div>
        <div className="summer-lottery-banner__rail">
          <span>EG // 26</span><b>06.93</b><i />
        </div>
        <div className="summer-lottery-banner__coordinate">AREA 06 // COMMUNITY EVENT</div>
      </section>
    </a>
  );
}
