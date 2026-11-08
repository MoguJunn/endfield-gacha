import React, { useEffect, useId, useState } from 'react';
import { Gamepad2 } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import CommunityActivityPanel from './CommunityActivityPanel.jsx';
import DanqingPreviewCard from './DanqingPreviewCard.jsx';
import VersionBriefingCard from './VersionBriefingCard.jsx';
import RegulationLotteryCard from './RegulationLotteryCard.jsx';
import { REGULATION_LOTTERY } from '../../../shared/regulationLottery.js';
import { ACTIVE_VERSION_PREVIEW, isVersionPreviewActive } from '../../constants/versionPreview.js';
import './communityActivitySection.css';

const isLotteryActive = now => now >= Date.parse(REGULATION_LOTTERY.previewStartsAt)
  && now < Date.parse(REGULATION_LOTTERY.closesAt);

export default function CommunityActivitySection({ onOpenCommunity, preview = ACTIVE_VERSION_PREVIEW }) {
  const { isEnglish } = useI18n();
  const tt = (zh, en) => isEnglish ? en : zh;
  const [page, setPage] = useState(() => isLotteryActive(Date.now()) ? 'lottery' : 'version');
  const [now, setNow] = useState(Date.now);
  const showPreview = isVersionPreviewActive(now, preview);
  const showLottery = isLotteryActive(now);
  const pages = [
    ...(showLottery ? [{ id: 'lottery', label: tt('抽奖', 'Giveaway') }] : []),
    { id: 'community', label: tt('社区', 'Community') },
    { id: 'version', label: showPreview ? tt('前瞻', 'Preview') : tt('导览', 'Briefing') },
  ];
  const activePage = page === 'lottery' && !showLottery ? 'version' : page;
  const panelId = useId();
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <>
    <header className="dh-section-heading">
      <h2><Gamepad2 size={16} />{tt('社区活动', 'Community event')}</h2>
      <div className="community-page-switch" aria-label={tt('社区活动分页', 'Community pages')}>
        {pages.map(({ id, label }, index) => (
          <button key={id} type="button" aria-pressed={activePage === id} aria-controls={panelId}
            onClick={() => setPage(id)} aria-label={tt(`第${index + 1}页：${label}`, `Page ${index + 1}: ${label}`)}>
            <span>0{index + 1}</span>{label}
          </button>
        ))}
      </div>
    </header>
    <div id={panelId} className="community-page" data-community-page={pages.findIndex(({ id }) => id === activePage) + 1}>
      {activePage === 'lottery' ? <RegulationLotteryCard />
        : activePage === 'community' ? <CommunityActivityPanel onOpenCommunity={onOpenCommunity} />
        : showPreview ? <DanqingPreviewCard /> : <VersionBriefingCard />}
    </div>
  </>;
}
