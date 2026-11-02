import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, X } from 'lucide-react';
import { useAppStore, useAuthStore, useUIStore } from '../../stores';
import { useI18n } from '../../i18n/index.js';
import { getStorageItem, setStorageItem } from '../../utils/storageUtils.js';
import { getLocalizedAnnouncementContent, getLocalizedAnnouncementTitle } from '../../utils/announcementLocale.js';
import { getAnnouncementSeverityMeta, getAnnouncementTypeLabel } from '../../utils/announcementMeta.js';
import { fetchWithTimeout } from '../../services/supabaseRequest.js';
import { isContributorDemoModeEnabled } from '../../dev/contributorDemoMode.js';

const SimpleMarkdown = lazy(() => import('../SimpleMarkdown.jsx'));
const SEEN_KEY = 'site_announcement_popup_seen_v1';
const CHECK_INTERVAL = 60 * 1000;

function revisionOf(announcement) {
  return `${announcement.id}:${announcement.updated_at || announcement.created_at || announcement.version || ''}`;
}

function latestNotice(records) {
  // Only the newest site notice opens automatically; old notices remain in the
  // message center instead of becoming a backlog of dialogs on first visit.
  return records.filter(record => record?.id && record.is_active !== false && !String(record.source_id || '').trim())
    .sort((left, right) => (
      new Date(right.updated_at || right.created_at || 0) - new Date(left.updated_at || left.created_at || 0)
      || Number(right.priority || 0) - Number(left.priority || 0)
    ))[0] || null;
}

function NoticeDialog({ announcement, onRead }) {
  const { locale, isEnglish } = useI18n();
  const ref = useRef(null);
  const title = getLocalizedAnnouncementTitle(announcement, locale);
  const content = getLocalizedAnnouncementContent(announcement, locale);
  const severity = getAnnouncementSeverityMeta(announcement.severity, locale);

  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby="site-announcement-title"
      aria-modal="true"
      className="m-auto w-[calc(100%_-_1.5rem)] max-w-2xl max-h-[calc(100dvh_-_2rem)] overflow-hidden border border-zinc-300 bg-white p-0 text-zinc-900 shadow-2xl backdrop:bg-black/60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      onCancel={event => { event.preventDefault(); onRead(); }}
    >
      <div className="flex max-h-[calc(100dvh_-_2rem)] flex-col border-t-4 border-endfield-yellow">
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-700">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold">
              <Bell size={15} />
              <span>{isEnglish ? 'New site announcement' : '新的网站公告'}</span>
              <span className={`px-2 py-0.5 ${severity.badge}`}>{getAnnouncementTypeLabel(announcement.announcement_type, locale)}</span>
            </div>
            <h2 id="site-announcement-title" className="break-words text-lg font-bold leading-relaxed">{title}</h2>
          </div>
          <button type="button" onClick={onRead} className="shrink-0 p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label={isEnglish ? 'Close announcement' : '关闭公告'}>
            <X size={20} />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
          <Suspense fallback={<p>{isEnglish ? 'Loading…' : '加载中…'}</p>}>
            <SimpleMarkdown content={content} className="text-sm leading-7 text-zinc-700 dark:text-zinc-300" />
          </Suspense>
        </div>
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-200 px-5 py-3 dark:border-zinc-700">
          <p className="text-xs text-zinc-500">{isEnglish ? 'Read again in the message center.' : '可随时在消息中心再次查看。'}</p>
          <button type="button" onClick={onRead} className="shrink-0 bg-endfield-yellow px-5 py-2.5 text-sm font-bold text-black hover:bg-yellow-400">
            {isEnglish ? 'Got it' : '我知道了'}
          </button>
        </footer>
      </div>
    </dialog>, document.body
  );
}

export default function SiteAnnouncementPopup() {
  const showAuthModal = useAuthStore(state => state.showAuthModal);
  const modalType = useUIStore(state => state.modalState.type);
  const [announcement, setAnnouncement] = useState(null);
  const [seen, setSeen] = useState(() => getStorageItem(SEEN_KEY, {}));

  useEffect(() => {
    if (isContributorDemoModeEnabled()) return undefined;
    let cancelled = false;
    let inFlight = false;
    let checkedAt = -Infinity;
    const controller = new AbortController();
    const refresh = async () => {
      if (document.visibilityState === 'hidden' || inFlight || Date.now() - checkedAt < 15000) return;
      inFlight = true;
      checkedAt = Date.now();
      try {
        const response = await fetchWithTimeout('/api/announcements?scope=site', {
          signal: controller.signal,
          cache: 'default',
        }, { timeoutMs: 10000, retries: 0, label: 'site announcements' });
        if (!response.ok) return;
        const payload = await response.json();
        if (cancelled || payload.success !== true || !Array.isArray(payload.data?.siteAnnouncements)) return;
        useAppStore.getState().setAnnouncements(payload.data.siteAnnouncements);
        setAnnouncement(latestNotice(payload.data.siteAnnouncements));
      } catch { /* Keep the current notice and try at the next scheduled check. */ }
      finally { inFlight = false; }
    };
    const onStorage = () => setSeen(getStorageItem(SEEN_KEY, {}));
    refresh();
    const timer = window.setInterval(refresh, CHECK_INTERVAL);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const revision = announcement ? revisionOf(announcement) : null;
  const acknowledge = () => {
    const next = { ...seen, ...getStorageItem(SEEN_KEY, {}), [announcement.id]: revision };
    setStorageItem(SEEN_KEY, next);
    setSeen(next);
  };

  if (!announcement || seen?.[announcement.id] === revision || showAuthModal || modalType) return null;
  return <NoticeDialog key={revision} announcement={announcement} onRead={acknowledge} />;
}
