import React from 'react';
import { ArrowDownRight, ArrowUpRight, CalendarDays, Gift, ShieldCheck, Users } from 'lucide-react';

export function RegulationEmblem({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 120 124" fill="none" aria-hidden="true">
      <path d="M12 7h35l13 24L73 7h35v39L60 94 12 46V7Z" fill="currentColor" />
      <path d="m12 67 48 42 48-42v17l-48 40-48-40V67Z" fill="currentColor" />
      <path d="m45 7 15 52L76 7M12 31l48 48 48-48" stroke="var(--reg-cutout, #131c19)" strokeWidth="6" />
    </svg>
  );
}

export function RegulationHero({ site, campaign, participantLabel }) {
  const date = campaign?.closesAt
    ? new Date(new Date(campaign.closesAt).getTime() - 1000)
    : null;
  const deadline = date
    ? new Intl.DateTimeFormat('zh-CN', { timeZone: site.timeZone, month: '2-digit', day: '2-digit' }).format(date)
    : '11/21';

  return (
    <section className="reg-hero" aria-labelledby="reg-title">
      <div className="reg-hero__art" aria-hidden="true">
        <div className="reg-hero__red-panel" />
        <div className="reg-hero__orbit" />
        <RegulationEmblem className="reg-hero__emblem" />
        <span className="reg-hero__cyrillic">РЕГЛАМЕНТ</span>
        <div className="reg-hero__architecture"><i /><i /><i /><i /><i /></div>
        <span className="reg-hero__coordinates">RHODES ISLAND / SECTOR 11<br />1097.11 — PROTOCOL ESTABLISHED</span>
      </div>
      <div className="reg-hero__copy">
        <div className="reg-eyebrow"><i /> ARKNIGHTS COMMUNITY EVENT <span>VOL. 03</span></div>
        <div className="reg-hero__label"><RegulationEmblem /><span>卫戍协议<span>TECHNOLOGICAL PROTOCOL</span></span><b>规程</b></div>
        <h1 id="reg-title">协议就绪<span>好礼<span className="reg-hero__comma">，</span><em>待你接入。</em></span></h1>
        <p className="reg-hero__description">{site.hero.description}</p>
        <div className="reg-hero__facts">
          <span><CalendarDays size={15} />即日起 — {deadline} <small>北京时间</small></span>
          <span><Users size={15} />{participantLabel}</span>
        </div>
        <div className="reg-sponsor"><span>特别赞助</span><strong>Neptune</strong><small>备用网址提供者 · 再次为本期送上好礼</small><ArrowUpRight size={15} /></div>
        <a className="reg-hero__discover" href="#reg-prize"><span>查看本期奖品</span><ArrowDownRight size={19} /></a>
      </div>
      <div className="reg-hero__stamp" aria-hidden="true"><span>COMMUNITY<br />SPECIAL DROP</span><b>01</b><small>LUCKY WINNER</small></div>
      <div className="reg-hero__bottom" aria-hidden="true"><span>REGULATION / 2026</span><span>—— CONNECTION ESTABLISHED</span><span>ENDFIELD GACHA +</span></div>
    </section>
  );
}

export function RegulationPrize({ prize, count = 0 }) {
  return (
    <section className="reg-prize" id="reg-prize" aria-labelledby="reg-prize-title">
      <div className="reg-section-heading"><span>01 / SUPPLY DROP</span><h2>本期补给</h2><small>特别奖品 · {count} 位中奖者</small></div>
      <div className="reg-prize__layout">
        <a className="reg-prize__image" href={prize.imageUrl} target="_blank" rel="noopener noreferrer" aria-label="查看全能开发者主题包完整奖品图">
          <img src={prize.imageUrl} alt="全能开发者主题包官方介绍，售价45元，包含终端主题、合成玉及其他道具" loading="lazy" />
          <span><ArrowUpRight size={14} /> 查看完整奖品图</span>
        </a>
        <div className="reg-prize__details">
          <div className="reg-prize__badge"><Gift size={14} /> EXCLUSIVE REWARD <b>× {count}</b></div>
          <p className="reg-prize__overline">卫戍协议终端主题组合包</p>
          <h3 id="reg-prize-title">{prize.title}</h3>
          <p className="reg-prize__theme">「全能的」可露希尔<span>包含卫戍协议专属语音</span></p>
          <div className="reg-prize__value"><small>奖品价值</small><strong><span>¥</span>45</strong><span>1 份完整主题包</span></div>
          <dl className="reg-prize__contents">
            <div><dt>合成玉</dt><dd>2,000</dd></div>
            <div><dt>限定终端主题</dt><dd>1 款</dd></div>
            <div><dt>收藏贴</dt><dd>3 款</dd></div>
            <div><dt>龙门币</dt><dd>100,000</dd></div>
            <div><dt>特级材料提货券</dt><dd>4 张</dd></div>
          </dl>
          <div className="reg-prize__note"><ShieldCheck size={16} /><p>由 Neptune 赞助。沿用上期兑奖规则，可按奖品采购价折现；中奖后通过报名 QQ 联系确认。</p></div>
        </div>
      </div>
    </section>
  );
}
