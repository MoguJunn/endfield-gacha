import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Check,
  CheckCheck,
  Clipboard,
  ExternalLink,
  Gamepad2,
  Globe2,
  Megaphone,
  Mouse,
  Trash2,
} from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import { useAppStore } from '../../stores/index.js';
import { getLocalizedAnnouncementContent, getLocalizedAnnouncementTitle } from '../../utils/announcementLocale.js';
import { getAnnouncementSeverityMeta } from '../../utils/announcementMeta.js';
import { sanitizeExternalNavigationUrl } from '../../utils/publicResourceUrl.js';
import { STORAGE_KEYS, markAsViewed } from '../../utils/storageUtils.js';
import DesktopHomeDialog from './DesktopHomeDialog.jsx';
import {
  buildDesktopMessageGroups,
  DESKTOP_MESSAGE_CATEGORIES,
  getAccountAutoNotification,
  getDesktopMessageId,
} from './desktopMessageModel.js';

const SimpleMarkdown = lazy(() => import('../SimpleMarkdown.jsx'));
const EMPTY = [];
const TAB_ICONS = { system: Bell, site: Megaphone, game: Gamepad2, official: Globe2 };
const CATEGORIES = {
  account: ['账号', 'Account'],
  import: ['导入', 'Import'],
  ticket: ['工单', 'Support'],
  cache: ['缓存', 'Cache'],
  'developer-api': ['API', 'API'],
  ops: ['自动化', 'Automation'],
  system: ['系统', 'System'],
};

async function copyDiagnostic(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* Existing local notification copy behavior. */
  }
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.cssText = 'position:fixed;opacity:0;left:-9999px';
  // Keep the fallback control inside the native modal's focus boundary.
  (document.querySelector('.dmc-dialog') || document.body).appendChild(input);
  input.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    input.remove();
  }
}

function MessageReader({
  initialRequest,
  groups,
  unreadCount,
  hasNewAnnouncement,
  onSiteViewed,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onClearRead,
}) {
  const { isEnglish, locale } = useI18n();
  const tt = (zh, en) => (isEnglish ? en : zh);
  const [category, setCategory] = useState(initialRequest.category);
  const [selectedId, setSelectedId] = useState(initialRequest.id);
  const [copyState, setCopyState] = useState('');
  const copyTimer = useRef(null);
  const items = groups[category] || EMPTY;
  const current = items.find((item) => getDesktopMessageId(item) === selectedId) || items[0];
  const system = category === 'system';
  const title = system ? current?.title : getLocalizedAnnouncementTitle(current, locale);
  const content = system ? '' : getLocalizedAnnouncementContent(current, locale);
  const hasContentImage = /!\[[^\]]*\]\(|<img\b/iu.test(content || '');
  const value = system
    ? current?.updatedAt || current?.createdAt
    : current?.published_at || current?.updated_at || current?.created_at;
  const parsed = value ? new Date(value) : null;
  const time =
    parsed && Number.isFinite(parsed.getTime())
      ? parsed.toLocaleString(locale, {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      : tt('时间未提供', 'Date unavailable');
  const source = sanitizeExternalNavigationUrl(current?.source_url);
  const group = DESKTOP_MESSAGE_CATEGORIES.find((item) => item.id === category);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  useEffect(() => {
    if (category !== 'site' || !current || !hasNewAnnouncement) return undefined;
    // The existing site-announcement watermark is category-wide, not per-item.
    const timer = window.setTimeout(onSiteViewed, 2000);
    return () => window.clearTimeout(timer);
  }, [category, current, hasNewAnnouncement, onSiteViewed]);

  return (
    <div className={`dmc-reader ${system ? 'dmc-reader--system' : ''}`}>
      <nav className="dmc-tabs" aria-label={tt('消息分类', 'Message categories')}>
        {DESKTOP_MESSAGE_CATEGORIES.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={category === tab.id}
            title={`${isEnglish ? tab.en : tab.zh} · ${groups[tab.id].length}`}
            onClick={() => {
              setCategory(tab.id);
              setSelectedId(null);
              setCopyState('');
            }}
          >
            <i className="dmc-tab-icon" aria-hidden="true">
              {React.createElement(TAB_ICONS[tab.id], { size: 24, strokeWidth: 2 })}
            </i>
            <span>{isEnglish ? tab.en : tab.zh}</span>
            <small className="sr-only">{groups[tab.id].length}</small>
            {(tab.id === 'system' && unreadCount > 0) || (tab.id === 'site' && hasNewAnnouncement) ? (
              <i className="dmc-tab-unread" aria-label={tt('有未读消息', 'Unread messages')} />
            ) : null}
          </button>
        ))}
        <span className="dmc-top-signature" aria-hidden="true">
          // ENDFIELD GACHA
        </span>
      </nav>
      {system ? (
        <div className="dmc-toolbar">
          <span>
            {isEnglish ? group.en : group.zh} · {items.length} {tt('条', 'items')}
          </span>
          <div>
            <button type="button" onClick={onMarkAllRead} disabled={!unreadCount}>
              <CheckCheck size={14} />
              {tt('全部已读', 'Mark all read')}
            </button>
            <button type="button" onClick={onClearRead} disabled={!items.some((n) => n.readAt)}>
              <Trash2 size={14} />
              {tt('清理已读', 'Clear read')}
            </button>
          </div>
        </div>
      ) : null}
      <div className="dmc-columns">
        <aside className="dmc-list" aria-label={tt('消息列表', 'Message list')}>
          {items.map((item) => {
            const itemDate = new Date(
              system ? item.updatedAt || item.createdAt : item.published_at || item.updated_at || item.created_at
            );
            const validDate = Number.isFinite(itemDate.getTime());
            const itemTitle = system ? item.title : getLocalizedAnnouncementTitle(item, locale);
            return (
              <button
                key={getDesktopMessageId(item)}
                type="button"
                title={itemTitle || tt('通知', 'Notification')}
                aria-pressed={item === current}
                onClick={() => {
                  setSelectedId(getDesktopMessageId(item));
                  setCopyState('');
                }}
              >
                <span className="dmc-date">
                  <strong>{validDate ? String(itemDate.getDate()).padStart(2, '0') : '—'}</strong>
                  <small>{validDate ? `${itemDate.getMonth() + 1}${tt('月', '/MO')}` : '—'}</small>
                </span>
                <span className="dmc-list-title">{itemTitle || tt('通知', 'Notification')}</span>
                {system && !item.readAt ? (
                  <i className="dmc-news-stamp" aria-label={tt('未读', 'Unread')}>
                    <small>BREAKING</small>
                    <b>NEWS</b>
                  </i>
                ) : null}
              </button>
            );
          })}
          {!items.length ? (
            <div className="dmc-empty">
              <Bell size={24} />
              <p>{tt('此分类暂无消息', 'No messages in this category')}</p>
            </div>
          ) : null}
        </aside>
        <article className="dmc-paper" key={`${category}:${getDesktopMessageId(current)}`}>
          {current ? (
            <>
              <header className="dmc-title-strip">
                <h3>{title}</h3>
              </header>
              {/* Official artwork belongs to the original content. Do not place a
                  second generated headline above the game's own banner. */}
              {(system || category === 'site') && !hasContentImage ? (
                <div className="dmc-article-banner" aria-hidden="true">
                  <span className="dmc-banner-emblem">
                    <b>终末地</b>
                    <small>ENDFIELD</small>
                  </span>
                  <strong>{isEnglish ? group.en : group.zh}</strong>
                </div>
              ) : null}
              {system ? (
                <>
                  <p className="dmc-notification-text">{current.message}</p>
                  {current.source ? <p className="dmc-source">{current.source}</p> : null}
                  <div className="dmc-actions">
                    {!current.readAt ? (
                      <button type="button" onClick={() => onMarkRead(current.id)}>
                        <Check size={14} />
                        {tt('标为已读', 'Mark as read')}
                      </button>
                    ) : (
                      <span>{tt('已读', 'Read')}</span>
                    )}
                    <button type="button" onClick={() => onDismiss(current.id)}>
                      <Trash2 size={14} />
                      {tt('移除通知', 'Dismiss')}
                    </button>
                    {current.diagnosticText ? (
                      <button
                        type="button"
                        onClick={async () => {
                          const result = await copyDiagnostic(current.diagnosticText);
                          setCopyState(result ? 'ok' : 'failed');
                          clearTimeout(copyTimer.current);
                          copyTimer.current = window.setTimeout(() => setCopyState(''), 1800);
                        }}
                      >
                        <Clipboard size={14} />
                        {copyState === 'ok'
                          ? current.copiedDiagnosticLabel || tt('已复制', 'Copied')
                          : current.copyDiagnosticLabel || tt('复制诊断', 'Copy diagnostics')}
                      </button>
                    ) : null}
                    {current.actions?.map((action, index) => (
                      <a key={index} href={action.href} className={action.variant === 'primary' ? 'is-primary' : ''}>
                        {action.label}
                        <ExternalLink size={13} />
                      </a>
                    ))}
                  </div>
                  <p role="status" className="dmc-copy-status">
                    {copyState === 'failed'
                      ? tt(
                          '复制失败，请检查浏览器剪贴板权限后重试。',
                          'Copy failed. Check clipboard permissions and try again.'
                        )
                      : ''}
                  </p>
                </>
              ) : (
                <Suspense fallback={<p>{tt('正在加载正文…', 'Loading…')}</p>}>
                  <SimpleMarkdown content={content} className="dmc-markdown" />
                </Suspense>
              )}
              <footer className="dmc-meta">
                <time>{time}</time>
                {system ? <span>{(CATEGORIES[current.category] || CATEGORIES.system)[isEnglish ? 1 : 0]}</span> : null}
                {current.announcement_type === 'temporary' ? (
                  <span>
                    {tt('临时公告', 'Temporary')} · {getAnnouncementSeverityMeta(current.severity, locale).displayLabel}
                  </span>
                ) : null}
                {source ? (
                  <a href={source} target="_blank" rel="noreferrer">
                    {tt('查看原文', 'Original')}
                    <ExternalLink size={13} />
                  </a>
                ) : null}
              </footer>
            </>
          ) : (
            <div className="dmc-empty">
              <Bell size={36} />
              <h3>{tt('暂无消息', 'No messages')}</h3>
              <p>{tt('可以切换分类，或稍后再来查看。', 'Choose another category or check again later.')}</p>
            </div>
          )}
        </article>
      </div>
      <div className="dmc-reader-hints" aria-hidden="true">
        <span>
          <Mouse size={16} />
          {tt('滚动阅读', 'Scroll')}
        </span>
        <span>
          <kbd>ESC</kbd>
          {tt('关闭', 'Close')}
        </span>
      </div>
    </div>
  );
}

export default function DesktopMessageCenter({
  request,
  onOpen,
  onClose,
  notifications,
  unreadCount,
  hasNewAnnouncement,
  setHasNewAnnouncement,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onClearRead,
}) {
  const site = useAppStore((s) => s.announcements);
  const official = useAppStore((s) => s.gameAnnouncements);
  const { isEnglish } = useI18n();
  const [suppressedId, setSuppressedId] = useState(null);
  const groups = useMemo(
    () => buildDesktopMessageGroups(notifications, site || EMPTY, official || EMPTY),
    [notifications, site, official]
  );
  const automatic = getAccountAutoNotification(notifications);
  const effective =
    request || (automatic && automatic.id !== suppressedId ? { category: 'system', id: automatic.id } : null);
  const close = () => {
    if (automatic) setSuppressedId(automatic.id);
    onClose();
  };
  const siteViewed = React.useCallback(() => {
    markAsViewed(STORAGE_KEYS.ANNOUNCEMENT_LAST_VIEWED);
    setHasNewAnnouncement(false);
  }, [setHasNewAnnouncement]);
  return (
    <>
      <button
        type="button"
        className="dmc-launcher"
        aria-label={isEnglish ? 'Open message center' : '打开消息中心'}
        aria-expanded={Boolean(effective)}
        onClick={() => onOpen('system')}
      >
        <Bell size={19} />
        <span>{isEnglish ? 'Messages' : '消息'}</span>
        {unreadCount > 0 ? <b>{unreadCount > 99 ? '99+' : unreadCount}</b> : hasNewAnnouncement ? <i /> : null}
      </button>
      {effective ? (
        <DesktopHomeDialog title={isEnglish ? 'Message center' : '消息中心'} className="dmc-dialog" onClose={close}>
          <MessageReader
            key={`${effective.category}:${effective.id || ''}`}
            initialRequest={effective}
            groups={groups}
            unreadCount={unreadCount}
            hasNewAnnouncement={hasNewAnnouncement}
            onSiteViewed={siteViewed}
            onMarkRead={onMarkRead}
            onMarkAllRead={onMarkAllRead}
            onDismiss={onDismiss}
            onClearRead={onClearRead}
          />
        </DesktopHomeDialog>
      ) : null}
    </>
  );
}
