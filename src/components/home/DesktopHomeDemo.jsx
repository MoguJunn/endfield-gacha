import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Bell,
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Gamepad2,
  HandCoins,
  Layers,
  Link2,
  ShieldCheck,
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
import { localizeEntityName } from '../../utils/gameDataI18n.js';
import { getCharacterAvatarUrl } from '../../utils/characterUtils.js';
import { DONATION_LEDGER, DONATION_TOTALS } from '../../constants/donations.js';
import RotationScheduleCard from './RotationScheduleCard.jsx';
import SummerLotteryBanner from './SummerLotteryBanner.jsx';
import VersionCountdownCard from './VersionCountdownCard.jsx';
import { getDesktopMessageId } from './desktopMessageModel.js';
import { getConfiguredVersionTarget } from './desktopHomeData.js';
import DesktopHomeDialog from './DesktopHomeDialog.jsx';
import './desktopHomeDemo.css';

const HomeLandingDialogs = lazy(() => import('./HomeLandingDialogs.jsx'));
const DonationThanksCard = lazy(() => import('../donations/DonationThanksCard.jsx'));
const EMPTY = [];
const PANELS = new Set(['guide', 'mechanics', 'schedule', 'tools', 'support', 'lottery', 'donations']);

function Clock({ target, openEnded, version = false }) {
  const { isEnglish } = useI18n();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const end = target ? new Date(target).getTime() : NaN;
  if (!Number.isFinite(end))
    return <div className="dh-clock-pending">{openEnded || (isEnglish ? 'Time to be announced' : '时间待公布')}</div>;
  const diff = Math.max(0, end - now);
  if (!diff)
    return (
      <div className="dh-clock-pending">
        {version ? (isEnglish ? 'Version released' : '版本已上线') : isEnglish ? 'Schedule reached' : '已到期'}
      </div>
    );
  const parts = [
    Math.floor(diff / 86400000),
    Math.floor(diff / 3600000) % 24,
    Math.floor(diff / 60000) % 60,
    Math.floor(diff / 1000) % 60,
  ];
  return (
    <div className="dh-clock" aria-label={isEnglish ? 'Time remaining' : '剩余时间'}>
      {parts.map((part, i) => (
        <span key={i}>
          <b className="countdown-nums">{String(part).padStart(2, '0')}</b>
          <small>{(isEnglish ? ['DAYS', 'HRS', 'MIN', 'SEC'] : ['天', '时', '分', '秒'])[i]}</small>
        </span>
      ))}
    </div>
  );
}

function Pager({ page, pages, onChange, label }) {
  const { isEnglish } = useI18n();
  if (pages <= 1) return null;
  return (
    <div className="dh-pager" aria-label={label}>
      <button
        type="button"
        disabled={page === 0}
        aria-label={`${label}：${isEnglish ? 'Previous' : '上一页'}`}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft size={15} />
      </button>
      <span>
        {page + 1} / {pages}
      </span>
      <button
        type="button"
        disabled={page + 1 >= pages}
        aria-label={`${label}：${isEnglish ? 'Next' : '下一页'}`}
        onClick={() => onChange(page + 1)}
      >
        <ChevronRight size={15} />
      </button>
    </div>
  );
}

function Avatar({ name }) {
  const url = getCharacterAvatarUrl(name);
  return (
    <span className="dh-avatar">
      <span>{name?.slice(0, 1) || '—'}</span>
      {url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.visibility = 'hidden';
          }}
        />
      ) : null}
    </span>
  );
}

export default function DesktopHomeDemo({ unreadCount = 0, onOpenMessages }) {
  const { t, locale, isEnglish } = useI18n();
  const tt = (zh, en) => (isEnglish ? en : zh);
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const openAuthModal = useAuthStore((s) => s.openAuthModal);
  const poolsValue = usePoolStore((s) => s.pools);
  const siteValue = useAppStore((s) => s.announcements);
  const gameValue = useAppStore((s) => s.gameAnnouncements);
  const timeline = useSiteConfigStore((s) => s.config[HOME_VERSION_TIMELINE_CONFIG_KEY]);
  const legacyTarget = useSiteConfigStore((s) => s.config[HOME_NEXT_VERSION_TARGET_CONFIG_KEY]);
  const pools = Array.isArray(poolsValue) ? poolsValue : EMPTY;
  const site = Array.isArray(siteValue) ? siteValue : EMPTY;
  const game = Array.isArray(gameValue) ? gameValue : EMPTY;
  const [now, setNow] = useState(() => new Date());
  const [poolPage, setPoolPage] = useState(0);
  const [compact, setCompact] = useState(false);
  const [workspace, setWorkspace] = useState('banners');
  const container = useRef(null);
  const rotationContainer = useRef(null);
  const panelValue = new URLSearchParams(location.search).get('panel');
  const panel = PANELS.has(panelValue) ? panelValue : null;
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      // 1366×768 fits the whole home. Tabs are reserved for smaller windows.
      setCompact(entry.contentRect.height < 626 || entry.contentRect.width < 1180);
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const version = useMemo(
    () => resolveHomeVersionPlan({ timelineConfig: timeline, legacyTargetAt: legacyTarget, locale, now }),
    [timeline, legacyTarget, locale, now]
  );
  const schedule = useMemo(() => (pools.length ? getHomeRotationPoolSchedule(pools) : EMPTY), [pools]);
  const sections = useMemo(
    () => buildHomeRotationVersionSections({ poolSchedule: schedule, versionPlan: version, now }),
    [schedule, version, now]
  );
  const versionTarget = getConfiguredVersionTarget(version, timeline, legacyTarget);
  const versionTitle = versionTarget
    ? buildHomeVersionCountdownTitle(version, { baseTitle: tt('版本日程', 'Version schedule') })
    : tt('版本时间待公布', 'Version date to be announced');
  const versionName = versionTarget ? version.countdownVersion?.displayName : null;
  const currentUpInfo = useMemo(() => getCurrentUpPoolInfo(pools, now), [pools, now]);
  const activePools = useMemo(() => {
    if (!pools.length) return EMPTY;
    const active = getActiveHomeCountdownPools(pools, now);
    const limited = getLimitedPoolCountdownState(getLimitedPoolSchedule(pools), now);
    if (limited && !active.some((p) => p.id === limited.id || p.name === limited.name))
      active.unshift({ ...limited, poolType: 'limited' });
    return active;
  }, [pools, now]);
  const { temporary } = useMemo(() => splitSiteAnnouncements(site), [site]);
  const important = getMostImportantAnnouncement(temporary);
  const poolPages = Math.max(1, Math.ceil(activePools.length / 2));
  const activePage = Math.min(poolPage, poolPages - 1);
  const nameOf = (pool) =>
    pool?.homeNodeKind === 'reconstruction-character'
      ? localizeEntityName(pool.homeCharacterName, { locale, type: 'character' }) || pool.homeCharacterName
      : pool?.poolType === 'extra'
        ? pool.displayName || pool.name
        : localizeEntityName(pool?.name, { locale, type: 'character' }) || pool?.name;
  const dateLabel = (value) =>
    value && Number.isFinite(new Date(value).getTime())
      ? new Date(value).toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : tt('待公布', 'TBA');
  const openPanel = (id) => {
    const query = new URLSearchParams(location.search);
    query.set('panel', id);
    navigate({ pathname: '/', search: query.toString() }, { replace: true });
  };
  const closePanel = () => {
    const query = new URLSearchParams(location.search);
    query.delete('panel');
    navigate({ pathname: '/', search: query.toString() }, { replace: true });
  };
  const moveRotation = (direction) => {
    const rail = rotationContainer.current?.querySelector('.pool-card-rail-scrollbar');
    rail?.scrollBy({
      left: direction * rail.clientWidth * 0.8,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  };

  return (
    <div
      ref={container}
      className={`dh-home ${compact ? 'dh-home--compact' : ''}`}
      data-testid="desktop-home-demo"
      data-workspace={compact ? workspace : 'all'}
    >
      {compact ? (
        <nav className="dh-workspaces" aria-label={tt('首页分区', 'Home sections')}>
          {[
            ['banners', '寻访与活动', 'Banners & event'],
            ['schedule', '轮换与版本', 'Rotation & version'],
          ].map(([id, zh, en]) => (
            <button key={id} type="button" aria-pressed={workspace === id} onClick={() => setWorkspace(id)}>
              {isEnglish ? en : zh}
            </button>
          ))}
        </nav>
      ) : null}
      <div className="dh-commandbar">
        <div className="dh-guidance-layout">
          <div className="dh-guidance-intro">
            <small className="dh-guidance-eyebrow">ENDFIELD GACHA</small>
            <h1>{tt('寻访记录与日程', 'Your pulls & schedule')}</h1>
            <p className="dh-guidance-description">
              {tt('记录每一次寻访，了解你的保底进度与出货分布。', 'Track your pulls, pity progress and drop rates.')}
              <span>{tt('关注卡池轮换与版本日程，准备好下一次出发。', 'Keep up with banner rotations and prepare for the next version.')}</span>
            </p>
          </div>
          <nav className="dh-guidance-actions" aria-label={tt('首页操作', 'Home actions')}>
            <button
              className="dh-primary"
              type="button"
              onClick={() => (user ? navigate('/dashboard?home-demo=unified') : openAuthModal())}
            >
              {user ? tt('我的分析', 'My analysis') : tt('登录 / 导入', 'Sign in / import')}
              <ArrowRight size={18} />
            </button>
            <div className="dh-guidance-links">
              <button type="button" onClick={() => openPanel('guide')}>
                <BookOpen size={18} />
                <span><strong>{tt('指南', 'Guide')}</strong><small>{tt('从导入到备份', 'From import to backup')}</small></span>
              </button>
              <Link to="/simulator?home-demo=unified">
                <Gamepad2 size={18} />
                <span><strong>{tt('模拟器', 'Simulator')}</strong><small>{tt('试试下一次寻访', 'Try your next pull')}</small></span>
              </Link>
              <button type="button" onClick={() => openPanel('mechanics')}>
                <Layers size={18} />
                <span><strong>{tt('机制', 'Rules')}</strong><small>{tt('概率、保底与继承', 'Rates, pity and carry-over')}</small></span>
              </button>
              <button type="button" onClick={() => openPanel('tools')}>
                <Link2 size={18} />
                <span><strong>{tt('友链', 'Links')}</strong><small>{tt('地图、规划与实用工具', 'Maps, planners and tools')}</small></span>
              </button>
            </div>
            <Link to="/" replace className="dh-exit">
              {tt('退出预览', 'Exit preview')}
            </Link>
          </nav>
        </div>
      </div>
      <div className="dh-content-grid">
        <section className="dh-pools-area" data-home-section="pools" hidden={compact && workspace !== 'banners'}>
          <header className="dh-section-heading">
            <h2>
              <Layers size={16} />
              {tt('当前寻访', 'Current banners')}
            </h2>
            <div>
              <span>
                {activePools.length} {tt('组', 'pools')}
              </span>
              <Pager page={activePage} pages={poolPages} onChange={setPoolPage} label={tt('当前卡池', 'Banners')} />
            </div>
          </header>
          <div
            className={`dh-pools ${Math.min(2, activePools.length - activePage * 2) > 1 ? 'dh-pools--multiple' : ''}`}
            key={activePage}
          >
            {activePools.slice(activePage * 2, activePage * 2 + 2).map((pool) => {
              const names = pool.homeCharacterName
                ? [pool.homeCharacterName]
                : pool.featuredNames?.length
                  ? pool.featuredNames
                  : [pool.name];
              return (
                <article
                  className={`dh-pool-card ${pool.poolType === 'extra' ? 'dh-pool-card--extra' : ''}`}
                  key={pool.id || pool.name}
                >
                  <div className="dh-pool-card-content">
                    <div className="dh-pool-type">
                      <span>
                        {pool.poolType === 'extra' ? tt('附加寻访', 'Extra banner') : tt('限定寻访', 'Limited banner')}
                      </span>
                      <b>{pool.isActive ? tt('进行中', 'OPEN') : tt('即将开启', 'NEXT')}</b>
                    </div>
                    <div className="dh-pool-main">
                      <div className="dh-pool-name">
                        <div className="dh-avatar-stack">
                          {names.slice(0, 4).map((n) => (
                            <Avatar key={n} name={n} />
                          ))}
                        </div>
                        <div>
                          <h3>{nameOf(pool)}</h3>
                          <p title={names.join(' / ')}>
                            {pool.poolType !== 'extra' && names.length === 1
                              ? tt('本期概率提升干员', 'Featured operator')
                              : `UP · ${names.map((n) => localizeEntityName(n, { locale, type: 'character' }) || n).join(' / ')}`}
                          </p>
                        </div>
                      </div>
                      <div className="dh-pool-timer">
                        <span>{pool.isActive ? tt('距离结束', 'Ends in') : tt('距离开启', 'Starts in')}</span>
                        <Clock target={pool.targetDate} openEnded={pool.hasOpenEndedSchedule ? pool.endLabel : null} />
                      </div>
                    </div>
                    <div className="dh-pool-period">
                      <CalendarDays size={12} />
                      <span>
                        {dateLabel(pool.startDate)} — {pool.endDate ? dateLabel(pool.endDate) : pool.endLabel}
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
            {!activePools.length ? (
              <div className="dh-empty">
                {tt('当前没有可展示的寻访日程。', 'No current banner schedule available.')}
                <button type="button" className="dh-text-action" onClick={() => openPanel('schedule')}>
                  {tt('查看完整日程', 'Full schedule')}
                  <ArrowRight size={13} />
                </button>
              </div>
            ) : null}
          </div>
        </section>
        <section className="dh-schedule-area" aria-label={tt('轮换与版本日程', 'Rotation & version schedule')} hidden={compact && workspace !== 'schedule'}>
        <div
          ref={rotationContainer}
          className="dh-original-rotation"
          data-home-section="rotation"
          aria-label={tt('轮换计划', 'Rotation schedule')}
        >
          {schedule.length ? (
            <RotationScheduleCard poolSchedule={schedule} versionSections={sections} now={now} />
          ) : (
            <div className="dh-empty">{tt('后续轮换暂未公布', 'Upcoming banners have not been announced')}</div>
          )}
          <div className="dh-rotation-controls">
            <button type="button" onClick={() => openPanel('schedule')}>
              {tt('展开日程', 'Expand schedule')}
              <ExternalLink size={12} />
            </button>
            <button
              type="button"
              onClick={() => moveRotation(-1)}
              disabled={!schedule.length}
              aria-label={tt('轮换计划：上一段', 'Previous rotation segment')}
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              onClick={() => moveRotation(1)}
              disabled={!schedule.length}
              aria-label={tt('轮换计划：下一段', 'Next rotation segment')}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
        <div
          className="dh-version-area"
          data-home-section="version"
        >
          <VersionCountdownCard
            target={versionTarget}
            name={versionName}
            onSchedule={() => openPanel('schedule')}
            onAnnouncements={() => onOpenMessages('game')}
          />
        </div>
        </section>
        <section
          className="dh-original-event"
          data-home-section="event"
          aria-label={tt('社区活动', 'Community event')}
          hidden={compact && workspace !== 'banners'}
        >
          <header className="dh-section-heading">
            <h2><Gamepad2 size={16} />{tt('社区活动', 'Community event')}</h2>
          </header>
          <SummerLotteryBanner onOpenDetails={() => openPanel('lottery')} />
        </section>
      </div>

      <nav className="dh-utility-rail" aria-label={tt('消息与支持', 'Messages & support')}>
        <button
          type="button"
          className="dh-message-entry"
          onClick={() =>
            important ? onOpenMessages('site', getDesktopMessageId(important)) : onOpenMessages('system')
          }
        >
          <Bell size={16} />
          <span>{tt('公告与通知', 'Announcements')}</span>
          {important ? (
            <b>{tt('有重要公告', 'Important notice')}</b>
          ) : unreadCount ? (
            <b>
              {unreadCount} {tt('条未读', 'unread')}
            </b>
          ) : null}
          <ChevronRight size={13} />
        </button>
        <button type="button" className="dh-support-entry" onClick={() => openPanel('support')}>
          <ShieldCheck size={16} />
          <span>{tt('安全与社区', 'Safety & community')}</span>
          <ChevronRight size={13} />
        </button>
        <button type="button" className="dh-donation-entry" onClick={() => openPanel('donations')}>
          <HandCoins size={16} />
          <span>{tt('捐赠公示', 'Supporters')}</span>
          <b>¥{DONATION_TOTALS.amountCny}</b>
          <small>
            {DONATION_LEDGER.length} {tt('位支持者', 'supporters')}
          </small>
          <ChevronRight size={13} />
        </button>
      </nav>

      {panel === 'donations' ? (
        <DesktopHomeDialog title={tt('捐赠公示', 'Supporters')} onClose={closePanel}>
          <div className="dh-donation-dialog">
            <Suspense fallback={<p>{t('common.loading')}</p>}>
              <DonationThanksCard />
            </Suspense>
          </div>
        </DesktopHomeDialog>
      ) : panel ? (
        <Suspense
          fallback={
            <div className="dh-loading" role="status">
              {t('common.loading')}
            </div>
          }
        >
          <HomeLandingDialogs
            key={panel}
            panel={panel}
            onClose={closePanel}
            siteNotices={site}
            officialNotices={game}
            schedule={schedule}
            versionSections={sections}
            now={now}
            currentUpInfo={currentUpInfo}
            versionTitle={versionTitle}
            versionTarget={versionTarget || undefined}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
