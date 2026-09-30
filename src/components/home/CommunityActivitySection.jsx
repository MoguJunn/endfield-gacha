import React, { useId, useState } from 'react';
import { Gamepad2 } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import CommunityActivityPanel from './CommunityActivityPanel.jsx';
import DanqingPreviewCard from './DanqingPreviewCard.jsx';
import './communityActivitySection.css';

export default function CommunityActivitySection({ onOpenCommunity }) {
  const { isEnglish } = useI18n();
  const tt = (zh, en) => isEnglish ? en : zh;
  const [page, setPage] = useState(1);
  const panelId = useId();
  return <>
    <header className="dh-section-heading">
      <h2><Gamepad2 size={16} />{tt('社区活动', 'Community event')}</h2>
      <div className="community-page-switch" aria-label={tt('社区活动分页', 'Community pages')}>
        {[tt('社区', 'Community'), tt('前瞻', 'Preview')].map((label, index) => (
          <button key={index} type="button" aria-pressed={page === index} aria-controls={panelId}
            onClick={() => setPage(index)} aria-label={tt(`第${index + 1}页：${label}`, `Page ${index + 1}: ${label}`)}>
            <span>0{index + 1}</span>{label}
          </button>
        ))}
      </div>
    </header>
    <div id={panelId} className="community-page" data-community-page={page + 1}>
      {page === 0 ? <CommunityActivityPanel onOpenCommunity={onOpenCommunity} /> : <DanqingPreviewCard />}
    </div>
  </>;
}
