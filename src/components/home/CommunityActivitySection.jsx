import React, { useEffect, useId, useState } from 'react';
import { Gamepad2 } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import CommunityActivityPanel from './CommunityActivityPanel.jsx';
import DanqingPreviewCard from './DanqingPreviewCard.jsx';
import VersionBriefingCard from './VersionBriefingCard.jsx';
import { ACTIVE_VERSION_PREVIEW, isVersionPreviewActive } from '../../constants/versionPreview.js';
import './communityActivitySection.css';

export default function CommunityActivitySection({ onOpenCommunity, preview = ACTIVE_VERSION_PREVIEW }) {
  const { isEnglish } = useI18n();
  const tt = (zh, en) => isEnglish ? en : zh;
  const [page, setPage] = useState(1);
  const [now, setNow] = useState(Date.now);
  const showPreview = isVersionPreviewActive(now, preview);
  const panelId = useId();
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <>
    <header className="dh-section-heading">
      <h2><Gamepad2 size={16} />{tt('社区活动', 'Community event')}</h2>
      <div className="community-page-switch" aria-label={tt('社区活动分页', 'Community pages')}>
        {[tt('社区', 'Community'), showPreview ? tt('前瞻', 'Preview') : tt('导览', 'Briefing')].map((label, index) => (
          <button key={index} type="button" aria-pressed={page === index} aria-controls={panelId}
            onClick={() => setPage(index)} aria-label={tt(`第${index + 1}页：${label}`, `Page ${index + 1}: ${label}`)}>
            <span>0{index + 1}</span>{label}
          </button>
        ))}
      </div>
    </header>
    <div id={panelId} className="community-page" data-community-page={page + 1}>
      {page === 0 ? <CommunityActivityPanel onOpenCommunity={onOpenCommunity} />
        : showPreview ? <DanqingPreviewCard /> : <VersionBriefingCard />}
    </div>
  </>;
}
