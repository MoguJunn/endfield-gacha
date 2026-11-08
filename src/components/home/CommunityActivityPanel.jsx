import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BarChart3, Gift, MessagesSquare } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import './communityActivityPanel.css';

const LOTTERY_ARCHIVE_URL = '/lottery/archive/arknights-p3r-collab-2026';

export default function CommunityActivityPanel({ onOpenCommunity }) {
  const { isEnglish } = useI18n();
  const tt = (zh, en) => isEnglish ? en : zh;
  return (
    <div className="community-activity-panel">
      <div className="community-activity-panel__feature">
        <div className="community-activity-panel__ghost-number" aria-hidden="true">26</div>
        <div className="community-activity-panel__eyebrow"><Gift size={14} />{tt('社区活动档案', 'COMMUNITY ARCHIVE')}<span>{tt('已结束', 'ENDED')}</span></div>
        <div className="community-activity-panel__feature-copy">
          <h3>{tt('感谢每一份参与', 'Thanks for taking part')}</h3>
          <p>{tt('往期活动记录与中奖公示持续保留，也欢迎查看全服观测与社区动态。', 'Previous event records and results remain available. Explore community data and news here.')}</p>
        </div>
        <a className="community-activity-panel__archive-link" href={LOTTERY_ARCHIVE_URL}>{tt('查看往期记录', 'View event archive')}<ArrowUpRight size={14} /></a>
      </div>
      <div className="community-activity-panel__links">
        <Link to="/summary">
          <span className="community-activity-panel__link-icon"><BarChart3 size={17} /></span>
          <span><strong>{tt('全服寻访观测', 'Community data')}</strong><small>{tt('查看匿名卡池统计', 'Explore anonymous banner data')}</small></span>
          <ArrowUpRight size={15} />
        </Link>
        <button type="button" onClick={onOpenCommunity}>
          <span className="community-activity-panel__link-icon community-activity-panel__link-icon--warm"><MessagesSquare size={17} /></span>
          <span><strong>{tt('交流与反馈', 'Connect & share')}</strong><small>{tt('分享建议与使用心得', 'Share ideas and experiences')}</small></span>
          <ArrowUpRight size={15} />
        </button>
      </div>
    </div>
  );
}
