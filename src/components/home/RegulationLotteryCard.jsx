import React from 'react';
import { ArrowUpRight, CalendarDays, Gift } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import developerPack from '../../assets/lottery/regulation-developer-pack.jpg';
import { RegulationEmblem } from '../../lottery/RegulationHero.jsx';
import './regulationLotteryCard.css';

const LOTTERY_URL = String(import.meta.env.VITE_SUMMER_LOTTERY_URL || '/lottery').trim();

export default function RegulationLotteryCard() {
  const { isEnglish } = useI18n();
  const tt = (zh, en) => isEnglish ? en : zh;
  return (
    <a className="regulation-lottery-card" href={LOTTERY_URL} aria-label={tt('参与卫戍协议规程特别抽奖', 'Enter the Regulation giveaway')}>
      <div className="regulation-lottery-card__copy">
        <div className="regulation-lottery-card__eyebrow"><RegulationEmblem /><span>REGULATION / 2026</span><b>{tt('报名中', 'OPEN')}</b></div>
        <div className="regulation-lottery-card__title"><span>{tt('卫戍协议 · 规程', 'Arknights: Regulation')}</span><h3>{tt('接入协议，赢取好礼', 'Connect. Enter. Win.')}</h3></div>
        <p><Gift size={13} />{tt('全能开发者主题包', 'Developer theme pack')}<strong>¥45 × 1</strong></p>
        <div className="regulation-lottery-card__meta"><CalendarDays size={12} /><span>{tt('至 11.21 23:59 · 北京时间', 'Until Nov 21, 23:59 UTC+8')}</span></div>
        <div className="regulation-lottery-card__footer"><small>{tt('特别赞助', 'SPONSORED BY')} <b>Neptune</b></small><span>{tt('立即参与', 'Enter now')}<ArrowUpRight size={14} /></span></div>
      </div>
      <div className="regulation-lottery-card__art" aria-hidden="true"><img src={developerPack} alt="" loading="lazy" /><span>01<span>LUCKY WINNER</span></span></div>
    </a>
  );
}
