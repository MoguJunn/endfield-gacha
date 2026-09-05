import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, ChevronLeft, ExternalLink, ShieldCheck, Users, X } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import { ACCOUNT_RECOVERY_QQ_GROUP, ENGLISH_COMMUNITY_DISCORD_URL } from '../../constants/community.js';
import { getLocalizedAnnouncementContent, getLocalizedAnnouncementTitle } from '../../utils/announcementLocale.js';
import { sanitizeExternalNavigationUrl } from '../../utils/publicResourceUrl.js';

const SimpleMarkdown = lazy(() => import('../SimpleMarkdown.jsx'));
const GuideCard = lazy(() => import('./GuideCard.jsx'));
const PoolMechanicsCard = lazy(() => import('./PoolMechanicsCard.jsx'));
const RotationScheduleCard = lazy(() => import('./RotationScheduleCard.jsx'));
const HomecomingPreviewCard = lazy(() => import('./HomecomingPreviewCard.jsx'));
const FriendlyLinksCard = lazy(() => import('./FriendlyLinksCard.jsx'));
const DonationThanksCard = lazy(() => import('../donations/DonationThanksCard.jsx'));
const SummerLotteryBanner = lazy(() => import('./SummerLotteryBanner.jsx'));

const TITLES = {
  bulletin: ['公告中心', 'Announcements'],
  guide: ['使用指南', 'Getting started'],
  mechanics: ['卡池机制', 'Pool rules'],
  schedule: ['完整日程', 'Banner schedule'],
  tools: ['友情链接', 'Useful links'],
  support: ['社区与支持', 'Community & support'],
  lottery: ['社区活动', 'Community event'],
};

function NoticeReader({ siteNotices, officialNotices, initialCategory, initialNoticeId }) {
  const { locale, isEnglish } = useI18n();
  const [category, setCategory] = useState(
    ['site', 'events', 'updates', 'news'].includes(initialCategory) ? initialCategory : 'site'
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedId, setSelectedId] = useState(initialNoticeId);
  const [reading, setReading] = useState(Boolean(initialNoticeId));
  const tabs = [
    ['site', '观测站公告', 'Site'],
    ['events', '活动公告', 'Events'],
    ['updates', '游戏公告', 'Updates'],
    ['news', '资讯速报', 'News'],
  ];
  const items =
    category === 'site'
      ? siteNotices
      : officialNotices.filter((item) => {
          const value = String(item.source_category || item.tab || '').toLowerCase();
          // Official website articles have no in-game category; they belong to news.
          const group = ['events', 'updates', 'news'].includes(value) ? value : 'news';
          return group === category;
        });
  const selected =
    items.find((item) => String(item.id || item.source_id) === selectedId) || items[selectedIndex] || items[0];
  const sourceUrl = sanitizeExternalNavigationUrl(selected?.source_url);
  const date = (item) => {
    const value = item?.published_at || item?.updated_at || item?.created_at;
    const parsed = value ? new Date(value) : null;
    return parsed && Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString(locale) : '—';
  };

  return (
    <div className={`hl-bulletin ${reading ? 'hl-bulletin--reading' : ''}`}>
      <nav className="hl-bulletin-tabs" aria-label={isEnglish ? 'Announcement categories' : '公告分类'}>
        {tabs.map(([id, zh, en]) => (
          <button
            key={id}
            type="button"
            aria-pressed={category === id}
            onClick={() => {
              setCategory(id);
              setSelectedIndex(0);
              setSelectedId(null);
              setReading(false);
            }}
          >
            {isEnglish ? en : zh}
          </button>
        ))}
      </nav>
      <div className="hl-bulletin-layout">
        <aside aria-label={isEnglish ? 'Announcement list' : '公告列表'} className="hl-bulletin-list">
          {items.length ? (
            items.map((item, index) => (
              <button
                key={item.id || item.source_id || index}
                type="button"
                aria-pressed={selected === item}
                onClick={() => {
                  setSelectedIndex(index);
                  setSelectedId(null);
                  setReading(true);
                }}
              >
                <small>{date(item)}</small>
                <strong>{getLocalizedAnnouncementTitle(item, locale)}</strong>
                {item.announcement_type === 'temporary' ? <span>{isEnglish ? 'NOTICE' : '临时通知'}</span> : null}
              </button>
            ))
          ) : (
            <p className="hl-empty">
              {isEnglish ? 'No announcements to display in this category.' : '此分类暂无可展示公告。'}
            </p>
          )}
        </aside>
        <article
          className="hl-bulletin-article"
          key={`${category}-${selected?.id || selected?.source_id || selectedIndex}`}
        >
          <button type="button" className="hl-bulletin-back" onClick={() => setReading(false)}>
            <ChevronLeft size={16} />
            {isEnglish ? 'Back to list' : '返回公告列表'}
          </button>
          {selected ? (
            <>
              <header>
                <small>ENDFIELD // {date(selected)}</small>
                <h3>{getLocalizedAnnouncementTitle(selected, locale)}</h3>
                {sourceUrl ? (
                  <a href={sourceUrl} target="_blank" rel="noreferrer">
                    {isEnglish ? 'View original' : '查看原文'}
                    <ExternalLink size={13} />
                  </a>
                ) : null}
              </header>
              <SimpleMarkdown
                content={getLocalizedAnnouncementContent(selected, locale)}
                className="text-sm leading-7 text-slate-700 dark:text-zinc-300"
              />
            </>
          ) : (
            <div className="hl-empty">
              <Bell size={28} />
              <p>{isEnglish ? 'Choose another category or check back later.' : '可以切换其他分类，或稍后再查看。'}</p>
            </div>
          )}
        </article>
      </div>
    </div>
  );
}

// Native modal dialogs keep keyboard focus inside the reader and make the
// underlying app inert, including on narrow mobile layouts.
export default function HomeLandingDialogs({
  panel,
  onClose,
  siteNotices,
  officialNotices,
  category,
  noticeId,
  schedule,
  versionSections,
  now,
  currentUpInfo,
  versionTitle,
  versionTarget,
}) {
  const { t, isEnglish } = useI18n();
  const dialog = useRef(null);
  const timer = useRef(null);
  const [closing, setClosing] = useState(false);
  const [guideOpen, setGuideOpen] = useState(true);
  const title = TITLES[panel]?.[isEnglish ? 1 : 0];
  const requestClose = useCallback(() => {
    if (closing) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onClose();
      return;
    }
    setClosing(true);
    timer.current = window.setTimeout(onClose, 160);
  }, [closing, onClose]);

  useEffect(() => {
    const element = dialog.current;
    const active = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element?.showModal();
    return () => {
      clearTimeout(timer.current);
      element?.close();
      document.body.style.overflow = overflow;
      if (active?.isConnected) active.focus({ preventScroll: true });
    };
  }, []);

  if (!title) return null;
  return createPortal(
    <dialog
      ref={dialog}
      className={`hl-dialog hl-theme ${closing ? 'hl-dialog--closing' : ''}`}
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const targets = [
          ...event.currentTarget.querySelectorAll(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          ),
        ].filter((el) => el.getClientRects().length);
        const first = targets[0];
        const last = targets[targets.length - 1];
        if (!first) {
          event.preventDefault();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          requestClose();
      }}
    >
      <div className="hl-dialog-head">
        <div>
          <small>ENDFIELD GACHA</small>
          <h2>{title}</h2>
        </div>
        <button type="button" onClick={requestClose} aria-label={isEnglish ? 'Close' : '关闭'}>
          <X size={21} />
        </button>
      </div>
      <div className={`hl-dialog-body ${panel === 'bulletin' ? 'hl-dialog-body--reader' : ''}`}>
        <Suspense fallback={<div className="hl-empty">{t('common.loading')}</div>}>
          {panel === 'bulletin' ? (
            <NoticeReader
              siteNotices={siteNotices}
              officialNotices={officialNotices}
              initialCategory={category}
              initialNoticeId={noticeId}
            />
          ) : null}
          {panel === 'guide' ? (
            <GuideCard isOpen={guideOpen} onToggle={() => setGuideOpen(!guideOpen)} onBeforeAuth={onClose} />
          ) : null}
          {panel === 'mechanics' ? <PoolMechanicsCard currentUpInfo={currentUpInfo} interactive={false} /> : null}
          {panel === 'schedule' ? (
            <div className="space-y-4">
              <RotationScheduleCard poolSchedule={schedule} versionSections={versionSections} now={now} />
              <HomecomingPreviewCard targetDate={versionTarget} title={versionTitle} />
            </div>
          ) : null}
          {panel === 'tools' ? <FriendlyLinksCard /> : null}
          {panel === 'lottery' ? <SummerLotteryBanner /> : null}
          {panel === 'support' ? (
            <div className="hl-support-grid">
              <section>
                <ShieldCheck size={22} />
                <h3>{t('home.securityTitle')}</h3>
                <p>{t('home.securityCopy1')}</p>
                <p>{t('home.securityCopy2')}</p>
              </section>
              <section>
                <Users size={22} />
                <h3>{t('home.communityTitle')}</h3>
                <p>{t('home.communityCopy1')}</p>
                {isEnglish ? (
                  <a href={ENGLISH_COMMUNITY_DISCORD_URL} target="_blank" rel="noreferrer">
                    Discord <ExternalLink size={13} />
                  </a>
                ) : (
                  <strong className="hl-community-number">QQ {ACCOUNT_RECOVERY_QQ_GROUP}</strong>
                )}
                <p>{t('home.communityCopy2')}</p>
              </section>
              <div className="hl-donations">
                <DonationThanksCard />
              </div>
            </div>
          ) : null}
        </Suspense>
      </div>
    </dialog>,
    document.body
  );
}
