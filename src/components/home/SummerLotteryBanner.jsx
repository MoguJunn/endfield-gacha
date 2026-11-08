import React from 'react';
import { ArrowUpRight, CalendarDays, Gift, Sparkles } from 'lucide-react';
import developerPack from '../../assets/lottery/regulation-developer-pack.jpg';
import { RegulationEmblem } from '../../lottery/RegulationHero.jsx';
import { useI18n } from '../../i18n/index.js';
import './SummerLotteryBanner.css';

const LOTTERY_URL = String(import.meta.env.VITE_SUMMER_LOTTERY_URL || '/lottery').trim();

export default function SummerLotteryBanner({ compact = false, onOpenDetails }) {
  const { t, isEnglish } = useI18n();
  if (!LOTTERY_URL) return null;
  const Container = onOpenDetails ? 'div' : 'a';

  return (
    <Container
      href={onOpenDetails ? undefined : LOTTERY_URL}
      className={`summer-lottery-banner summer-lottery-banner--regulation group ${compact ? 'summer-lottery-banner--compact mb-6' : ''}`}
      aria-label={onOpenDetails ? undefined : t('home.summerLottery.open')}
    >
      <section className="summer-lottery-banner__info">
        <div className="summer-lottery-banner__kicker">
          <Sparkles size={13} /> REGULATION // SPECIAL GIVEAWAY
        </div>
        <div className="summer-lottery-banner__partners">
          <span>ARKNIGHTS</span><b>/</b><span>卫戍协议 · 规程</span>
        </div>
        <h3>{t('home.summerLottery.title')}</h3>
        <p>{t('home.summerLottery.description')}</p>
        <p className="summer-lottery-banner__sponsor">{isEnglish ? 'Sponsored by Neptune' : '感谢 Neptune 再次赞助本期奖品'}</p>
        <div className="summer-lottery-banner__meta">
          <span>
            <CalendarDays size={12} /> {t('home.summerLottery.date')}
          </span>
          <span>
            <Gift size={12} /> {t('home.summerLottery.prize')}
          </span>
        </div>
        {onOpenDetails ? (
          <div className="summer-lottery-banner__actions">
            <a href={LOTTERY_URL} className="summer-lottery-banner__action" aria-label={t('home.summerLottery.open')}>
              {t('home.summerLottery.action')} <ArrowUpRight size={16} />
            </a>
            <button type="button" onClick={onOpenDetails} className="summer-lottery-banner__details">
              {isEnglish ? 'Event details' : '活动详情'} <ArrowUpRight size={13} />
            </button>
          </div>
        ) : (
          <span className="summer-lottery-banner__action">
            {t('home.summerLottery.action')} <ArrowUpRight size={16} />
          </span>
        )}
      </section>

      <section className="summer-lottery-banner__visual" aria-hidden="true">
        <div className="summer-lottery-banner__lockup">
          <RegulationEmblem />
          <strong>卫戍协议<span>规程</span></strong>
          <small>РЕГЛАМЕНТ / COMMUNITY EVENT</small>
        </div>
        <div className="summer-lottery-banner__prizes">
          <div className="summer-lottery-banner__choice">
            <img src={developerPack} alt="" />
            <span>{isEnglish ? 'CNY 45 · ONE WINNER' : '全能开发者主题包 · 1 位中奖者'}</span>
          </div>
        </div>
        <div className="summer-lottery-banner__rail">
          <span>REG // 26</span><b>01</b><i />
        </div>
        <div className="summer-lottery-banner__coordinate">PROTOCOL ESTABLISHED / 2026.11</div>
      </section>
    </Container>
  );
}
