import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Bell,
  BookOpen,
  ChevronRight,
  ExternalLink,
  Gamepad2,
  Gift,
  Layers,
  Link2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import { useAppStore, useAuthStore } from '../../stores/index.js';
import usePoolStore from '../../stores/usePoolStore.js';
import useSiteConfigStore, {
  HOME_NEXT_VERSION_TARGET_CONFIG_KEY,
  HOME_VERSION_TIMELINE_CONFIG_KEY,
} from '../../stores/useSiteConfigStore.js';
import {
  getActiveHomeCountdownPools,
  getCurrentUpPoolInfo,
  getHomeRotationPoolSchedule,
  getLimitedPoolCountdownState,
  getLimitedPoolSchedule,
} from '../../utils/poolTimeUtils.js';
import {
  buildHomeRotationVersionSections,
  buildHomeVersionCountdownTitle,
  resolveHomeVersionPlan,
} from '../../utils/homeVersionTimeline.js';
import { getMostImportantAnnouncement, splitSiteAnnouncements } from '../../utils/announcementMeta.js';
import { getLocalizedAnnouncementTitle } from '../../utils/announcementLocale.js';
import { localizeEntityName } from '../../utils/gameDataI18n.js';
import { ACCOUNT_RECOVERY_QQ_GROUP } from '../../constants/community.js';
import './homeLandingDemo.css';

const HomeLandingDialogs = lazy(() => import('./HomeLandingDialogs.jsx'));
const EMPTY = [];
const PANELS = new Set(['bulletin', 'guide', 'mechanics', 'schedule', 'tools', 'support', 'lottery']);

function RemainingTime({ target, openEnded, isEnglish }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const end = target ? new Date(target).getTime() : NaN;
  const remaining = Math.max(0, end - now);
  const parts = [
    Math.floor(remaining / 86400000),
    Math.floor(remaining / 3600000) % 24,
    Math.floor(remaining / 60000) % 60,
    Math.floor(remaining / 1000) % 60,
  ];
  return (
    <>
      <div className="hl-countdown" aria-label={isEnglish ? 'Countdown' : '倒计时'}>
        {parts.map((value, i) => (
          <div key={i}>
            <strong className="countdown-nums">{Number.isFinite(end) ? String(value).padStart(2, '0') : '—'}</strong>
            <span>{(isEnglish ? ['DAYS', 'HRS', 'MIN', 'SEC'] : ['天', '时', '分', '秒'])[i]}</span>
          </div>
        ))}
      </div>
      {!Number.isFinite(end) ? (
        <p className="hl-time-pending">{openEnded || (isEnglish ? 'Schedule to be announced' : '时间待公布')}</p>
      ) : null}
    </>
  );
}

export default function HomeLandingDemo({ mobile = false }) {
  const { t, locale, isEnglish } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const openAuthModal = useAuthStore((s) => s.openAuthModal);
  const poolValue = usePoolStore((s) => s.pools);
  const siteValue = useAppStore((s) => s.announcements);
  const officialValue = useAppStore((s) => s.gameAnnouncements);
  const timeline = useSiteConfigStore((s) => s.config[HOME_VERSION_TIMELINE_CONFIG_KEY]);
  const legacyTarget = useSiteConfigStore((s) => s.config[HOME_NEXT_VERSION_TARGET_CONFIG_KEY]);
  const [now, setNow] = useState(() => new Date());
  const [selection, setSelection] = useState(null);
  const pools = Array.isArray(poolValue) ? poolValue : EMPTY;
  const officialNotices = Array.isArray(officialValue) ? officialValue : EMPTY;
  const notices = Array.isArray(siteValue) ? siteValue : EMPTY;
  const tt = (zh, en) => (isEnglish ? en : zh);
  const params = new URLSearchParams(location.search);
  const panel = params.get('panel');
  const activePanel = PANELS.has(panel) ? panel : null;
  const version = useMemo(
    () => resolveHomeVersionPlan({ timelineConfig: timeline, legacyTargetAt: legacyTarget, locale, now }),
    [timeline, legacyTarget, locale, now]
  );
  const schedule = useMemo(() => getHomeRotationPoolSchedule(pools), [pools]);
  const versionSections = useMemo(
    () => buildHomeRotationVersionSections({ poolSchedule: schedule, versionPlan: version, now }),
    [schedule, version, now]
  );
  const versionTitle = buildHomeVersionCountdownTitle(version, { baseTitle: t('home.nextVersionCountdown') });
  const currentUpInfo = useMemo(() => getCurrentUpPoolInfo(pools, now), [pools, now]);
  const countdowns = useMemo(() => {
    const active = getActiveHomeCountdownPools(pools, now);
    const limited = getLimitedPoolCountdownState(getLimitedPoolSchedule(pools), now);
    if (limited && !active.some((p) => p.id === limited.id || p.name === limited.name))
      active.unshift({ ...limited, poolType: 'limited' });
    return [...active, { id: 'version', isVersion: true, targetDate: version.targetAt }];
  }, [pools, now, version.targetAt]);
  const current = countdowns.find((p) => p.id === selection) || countdowns[0];
  const { temporary, updates } = useMemo(() => splitSiteAnnouncements(notices), [notices]);
  const importantNotice = getMostImportantAnnouncement(temporary);
  const siteNotices = useMemo(() => [...temporary, ...updates], [temporary, updates]);
  const upcoming = schedule.find((p) => new Date(p.startDate) > now);
  const image = current?.backgroundImage;
  const nameOf = (pool) => {
    if (pool?.isVersion) return versionTitle;
    if (pool?.homeNodeKind === 'reconstruction-character')
      return localizeEntityName(pool.homeCharacterName, { locale, type: 'character' }) || pool.homeCharacterName;
    if (pool?.poolType === 'extra') return pool.displayName || pool.name;
    return localizeEntityName(pool?.name, { locale, type: 'character' }) || pool?.name;
  };
  const dateLabel = (value) =>
    value && Number.isFinite(new Date(value).getTime())
      ? new Date(value).toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : tt('待公布', 'To be announced');
  const openPanel = (id, category, notice) => {
    const next = new URLSearchParams(location.search);
    next.set('panel', id);
    if (category) next.set('notice-category', category);
    else next.delete('notice-category');
    if (notice) next.set('notice-id', String(notice.id || notice.source_id));
    else next.delete('notice-id');
    navigate({ pathname: location.pathname, search: next.toString() }, { replace: true });
  };
  const closePanel = () => {
    const next = new URLSearchParams(location.search);
    next.delete('panel');
    next.delete('notice-category');
    next.delete('notice-id');
    navigate({ pathname: location.pathname, search: next.toString() }, { replace: true });
  };
  const page = (desktop, phone = desktop) => `${mobile ? `/m/${phone}` : `/${desktop}`}?home-demo=unified`;
  const goToWorkspace = () => (user ? navigate(page('dashboard', 'details')) : openAuthModal());
  const exitParams = new URLSearchParams(location.search);
  ['home-demo', 'panel', 'notice-category', 'notice-id'].forEach((key) => exitParams.delete(key));

  useEffect(() => {
    // Only the clock digits update each second; page-level scheduling runs once a minute.
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={`hl-home hl-theme ${mobile ? 'hl-home--mobile' : ''}`} data-testid="home-landing-demo">
      <div className="hl-content">
        <div className="hl-preview-note">
          <span>
            {tt('首页预览', 'Home preview')} <b>02</b>
          </span>
          <Link to={{ pathname: location.pathname, search: exitParams.toString() }} replace>
            {tt('返回原版', 'Original home')}
            <ExternalLink size={12} />
          </Link>
        </div>
        <section className="hl-hero">
          <div className="hl-intro hl-reveal">
            <div className="hl-eyebrow">
              <i />
              ENDFIELD GACHA OBSERVATORY
            </div>
            <h1>
              {tt('每一次寻访，', 'Every pull,')}
              <br />
              <em>{tt('都值得被记录。', 'worth remembering.')}</em>
            </h1>
            <p className="hl-description">
              {tt(
                '整理寻访记录，看清保底与出货。国服、国际服与多个游戏账号，一处管理。',
                'Keep your pulls together and understand your pity and results. One place for your CN and global accounts.'
              )}
            </p>
            <div className="hl-primary-actions">
              <button type="button" className="hl-primary" onClick={goToWorkspace}>
                {user ? tt('进入我的分析', 'My analysis') : tt('登录并导入记录', 'Sign in & import')}
                <ArrowRight size={17} />
              </button>
              <button type="button" className="hl-secondary" onClick={() => openPanel('guide')}>
                <BookOpen size={16} />
                {tt('使用指南', 'Getting started')}
              </button>
            </div>
            <div className="hl-explore">
              <p>{tt('开始之前，也可以试试', 'Explore before you start')}</p>
              <div>
                <Link to={page('simulator')}>
                  <Gamepad2 size={16} />
                  {tt('抽卡模拟器', 'Simulator')}
                </Link>
                <button type="button" onClick={() => openPanel('mechanics')}>
                  <Layers size={16} />
                  {tt('卡池机制', 'Pool rules')}
                </button>
                <button type="button" onClick={() => openPanel('tools')}>
                  <Link2 size={16} />
                  {tt('更多工具', 'More tools')}
                </button>
              </div>
            </div>
          </div>

          <section className="hl-pool-panel hl-reveal" aria-label={tt('当前寻访日程', 'Current banner schedule')}>
            <div className="hl-pool-tabs">
              <div aria-label={tt('选择寻访', 'Choose banner')}>
                {countdowns.map((pool, index) => (
                  <button
                    key={pool.id || index}
                    type="button"
                    aria-pressed={pool === current}
                    onClick={() => setSelection(pool.id)}
                  >
                    {pool.isVersion ? tt('版本前瞻', 'Next version') : nameOf(pool)}
                  </button>
                ))}
              </div>
              <span>
                <i />
                {tt('日程', 'SCHEDULE')}
              </span>
            </div>
            <div className="hl-pool-visual" key={current?.id || current?.name}>
              {image ? <img src={image} alt="" /> : null}
              <div className="hl-pool-shade" />
              <div className="hl-pool-grid" />
              <div className="hl-pool-details">
                <span className="hl-eyebrow">
                  {current?.isVersion
                    ? tt('版本前瞻', 'VERSION PREVIEW')
                    : current?.isActive
                      ? tt('正在进行', 'NOW AVAILABLE')
                      : tt('即将开放', 'COMING SOON')}
                </span>
                <h2>{nameOf(current) || tt('寻访信息待公布', 'Banner details pending')}</h2>
                <p>
                  {current?.isVersion
                    ? tt('距离版本开放', 'Until the next version')
                    : current?.isActive
                      ? tt('距离本期结束', 'Until this banner ends')
                      : tt('距离寻访开启', 'Until this banner starts')}
                </p>
                <RemainingTime
                  target={current?.targetDate}
                  openEnded={current?.hasOpenEndedSchedule ? current.endLabel : null}
                  isEnglish={isEnglish}
                />
                <div className="hl-pool-date">
                  {current?.isActive ? tt('结束时间', 'Ends at') : tt('开放时间', 'Starts at')} ·{' '}
                  {dateLabel(current?.targetDate)}
                </div>
              </div>
            </div>
            <div className="hl-next">
              <div>
                <small>{tt('下一轮换', 'UP NEXT')}</small>
                <strong>{upcoming ? nameOf(upcoming) : tt('后续卡池待公布', 'Next banner to be announced')}</strong>
                <span>
                  {upcoming ? dateLabel(upcoming.startDate) : tt('以官方公告为准', 'Subject to official announcements')}
                </span>
              </div>
              <button type="button" onClick={() => openPanel('schedule')}>
                {tt('完整日程', 'Full schedule')}
                <ArrowRight size={15} />
              </button>
            </div>
          </section>
        </section>

        {importantNotice ? (
          <button
            type="button"
            className="hl-important hl-reveal"
            onClick={() => openPanel('bulletin', 'site', importantNotice)}
          >
            <Bell size={18} />
            <span>
              <b>{tt('重要通知', 'Important notice')}</b>
              {getLocalizedAnnouncementTitle(importantNotice, locale)}
            </span>
            <ChevronRight size={16} />
          </button>
        ) : null}

        <section className="hl-information hl-reveal" aria-label={tt('最新消息与活动', 'News and events')}>
          <div className="hl-news">
            <div className="hl-section-heading">
              <h2>
                <Bell size={17} />
                {tt('最新消息', 'Latest news')}
              </h2>
              <button type="button" onClick={() => openPanel('bulletin')}>
                {tt('全部公告', 'All announcements')}
                <ArrowRight size={14} />
              </button>
            </div>
            {[
              { item: updates[0], tag: tt('本站', 'SITE'), category: 'site' },
              {
                item: officialNotices[0],
                tag: tt('官方', 'GAME'),
                category: ['updates', 'events', 'news'].includes(officialNotices[0]?.source_category)
                  ? officialNotices[0].source_category
                  : 'news',
              },
            ].map(({ item, tag, category }) => (
              <button
                className="hl-news-row"
                type="button"
                key={tag}
                onClick={() => openPanel('bulletin', category, item)}
              >
                <span>{tag}</span>
                <strong>
                  {item
                    ? getLocalizedAnnouncementTitle(item, locale)
                    : tt('暂无可展示公告，打开公告中心查看', 'No announcement loaded. Open the news center.')}
                </strong>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
          <button type="button" className="hl-event" onClick={() => openPanel('lottery')}>
            <div>
              <span>
                <Gift size={17} />
                {tt('社区活动', 'Community event')}
              </span>
              <small>{t('home.summerLottery.date')}</small>
            </div>
            <h2>{t('home.summerLottery.title')}</h2>
            <p>
              {t('home.summerLottery.prize')}
              <ArrowRight size={17} />
            </p>
          </button>
        </section>

        <section className="hl-facts hl-reveal" aria-label={tt('功能与服务', 'Features and services')}>
          <button type="button" onClick={() => openPanel('guide')}>
            <strong>{tt('国服 / 国际服', 'CN / Global')}</strong>
            <span>{tt('多账号管理 · 导入与备份', 'Multiple accounts · import & backup')}</span>
          </button>
          <button type="button" onClick={() => openPanel('mechanics')}>
            <strong>{tt('保底与继承', 'Pity & carry-over')}</strong>
            <span>{tt('限定 · 常驻 · 武器 · 附加寻访', 'Limited · standard · weapon · extra')}</span>
          </button>
          <button type="button" onClick={() => openPanel('schedule')}>
            <strong>{versionTitle}</strong>
            <span>{dateLabel(version.targetAt)}</span>
          </button>
          <button type="button" onClick={() => openPanel('support')}>
            <strong>{tt('社区一起维护', 'Community supported')}</strong>
            <span>{tt('问题反馈 · 捐赠公示', 'Support · donation disclosure')}</span>
          </button>
        </section>
        <div className="hl-home-footer">
          <p>
            <ShieldCheck size={15} />
            {tt(
              '导入前可预览，确认后保存。请妥善保管个人凭据。',
              'Preview imports before saving. Keep your credentials private.'
            )}
          </p>
          <nav aria-label={tt('社区与站点地址', 'Community and site links')}>
            <button type="button" onClick={() => openPanel('support')}>
              <Users size={14} />
              {isEnglish ? 'Discord' : `QQ ${ACCOUNT_RECOVERY_QQ_GROUP}`}
            </button>
            <a href="https://ef-gacha.mogujun.icu/" target="_blank" rel="noreferrer">
              {tt('主站', 'Primary')}
              <ExternalLink size={11} />
            </a>
            <a href="https://ef.nepst.cn/" target="_blank" rel="noreferrer">
              {tt('备用站', 'Backup')}
              <ExternalLink size={11} />
            </a>
          </nav>
        </div>
      </div>
      {activePanel ? (
        <Suspense
          fallback={
            <div className="hl-loading" role="status">
              {t('common.loading')}
            </div>
          }
        >
          <HomeLandingDialogs
            key={activePanel}
            panel={activePanel}
            onClose={closePanel}
            category={params.get('notice-category')}
            noticeId={params.get('notice-id')}
            siteNotices={siteNotices}
            officialNotices={officialNotices}
            schedule={schedule}
            versionSections={versionSections}
            now={now}
            currentUpInfo={currentUpInfo}
            versionTitle={versionTitle}
            versionTarget={version.targetAt}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
