import React from 'react';
import { ArrowUpRight, BookOpen, Gift } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import { VERSION_BRIEFING_URL } from '../../constants/versionPreview.js';
import { useAppStore } from '../../stores/index.js';
import useSiteConfigStore from '../../stores/useSiteConfigStore.js';
import { HOME_VERSION_TIMELINE_CONFIG_KEY, resolveHomeVersionPlan } from '../../utils/homeVersionTimeline.js';
import { findVersionBriefing } from '../../utils/versionBriefing.js';
import './versionBriefingCard.css';

export default function VersionBriefingCard() {
  const { isEnglish } = useI18n();
  const tt = (zh, en) => isEnglish ? en : zh;
  const announcements = useAppStore(state => state.gameAnnouncements);
  const timelineConfig = useSiteConfigStore(state => state.config[HOME_VERSION_TIMELINE_CONFIG_KEY]);
  const briefing = findVersionBriefing(announcements, resolveHomeVersionPlan({ timelineConfig }));
  const versionName = isEnglish ? briefing?.version.nameEn : briefing?.version.name;

  return (
    <article className={`version-briefing${briefing?.imageUrl ? ' version-briefing--with-art' : ''}`} aria-label={tt('新版本导览', 'New version briefing')}>
      {briefing?.imageUrl && <a className="version-briefing__art" href={VERSION_BRIEFING_URL} target="_blank" rel="noopener noreferrer"
        aria-label={tt('查看官方新版本导览', 'View the official new version briefing')}>
        <img src={briefing.imageUrl} alt={tt(`「${versionName}」新版本导览`, `${versionName} version briefing`)} decoding="async" />
      </a>}
      <div className="version-briefing__details">
        <div className="version-briefing__intro">
          <div className="version-briefing__eyebrow"><BookOpen size={14} />{tt('官方版本资讯', 'OFFICIAL BRIEFING')}</div>
          <h3>{tt('新版本导览', 'Version briefing')}</h3>
          {versionName && <strong className="version-briefing__version">{versionName}</strong>}
          <p>{tt('新内容、新干员与版本活动，前往官方网站一览。', 'Explore new content, operators and events on the official website.')}</p>
        </div>
        <div className="version-briefing__reward">
          <Gift size={24} aria-hidden="true" />
          <div>
            <strong>{tt('浏览导览，领取嵌晶玉', 'Origeometry rewards')}</strong>
            <p>{tt('领取规则以官网为准。', 'See official claim rules.')}</p>
          </div>
        </div>
        <a className="version-briefing__action" href={VERSION_BRIEFING_URL} target="_blank" rel="noopener noreferrer">
          {tt('查看导览 · 领取奖励', 'View & claim rewards')}<ArrowUpRight size={16} />
        </a>
      </div>
    </article>
  );
}
