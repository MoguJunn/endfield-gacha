import React, { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DesktopMessageCenter from '../DesktopMessageCenter.jsx';
import { buildDesktopMessageGroups } from '../desktopMessageModel.js';

const { state, viewed } = vi.hoisted(() => ({
  state: { announcements: [], gameAnnouncements: [] },
  viewed: vi.fn(),
}));
vi.mock('../../../stores/index.js', () => ({ useAppStore: (selector) => selector(state) }));
vi.mock('../../../i18n/index.js', () => ({ useI18n: () => ({ isEnglish: false, locale: 'zh-CN' }) }));
vi.mock('../../../utils/storageUtils.js', () => ({
  STORAGE_KEYS: { ANNOUNCEMENT_LAST_VIEWED: 'viewed' },
  markAsViewed: viewed,
}));
vi.mock('../../SimpleMarkdown.jsx', () => ({ default: ({ content }) => <p>{content}</p> }));

const notice = (id, props = {}) => ({
  id,
  category: 'system',
  title: `通知 ${id}`,
  message: `消息 ${id}`,
  createdAt: '2026-09-01T00:00:00Z',
  type: 'info',
  readAt: null,
  actions: [],
  ...props,
});
function Harness({ initial = [], request = null, hasNew = true }) {
  const [notifications, setNotifications] = useState(initial);
  const [open, setOpen] = useState(request);
  const [newAnnouncement, setNew] = useState(hasNew);
  return (
    <DesktopMessageCenter
      notifications={notifications}
      unreadCount={notifications.filter((item) => !item.readAt).length}
      request={open}
      onOpen={(category, id) => setOpen({ category, id })}
      onClose={() => setOpen(null)}
      hasNewAnnouncement={newAnnouncement}
      setHasNewAnnouncement={setNew}
      onMarkRead={(id) => setNotifications((items) => items.map((n) => (n.id === id ? { ...n, readAt: 'now' } : n)))}
      onMarkAllRead={() => setNotifications((items) => items.map((n) => ({ ...n, readAt: 'now' })))}
      onDismiss={(id) => setNotifications((items) => items.filter((n) => n.id !== id))}
      onClearRead={() => setNotifications((items) => items.filter((n) => !n.readAt))}
    />
  );
}

describe('DesktopMessageCenter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    viewed.mockClear();
    state.announcements = [
      { id: 'site', announcement_type: 'temporary', title: '站点维护', content: '本站说明', severity: 'critical' },
    ];
    state.gameAnnouncements = [
      {
        source_id: 'game-bulletin:1',
        source_group: 'game',
        source_category: 'news',
        title: '游戏内资讯',
        content: '游戏说明',
      },
      {
        source_id: 'web:1',
        source_group: 'official',
        source_category: 'updates',
        title: '官网更新',
        content: '官网说明',
      },
    ];
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value() {
        this.setAttribute('open', '');
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value() {
        this.removeAttribute('open');
      },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('groups by source, retains temporary site announcements, and deduplicates shared records', () => {
    const groups = buildDesktopMessageGroups([notice('local')], state.announcements, [
      ...state.gameAnnouncements,
      state.announcements[0],
      { id: 'hidden', is_active: false },
    ]);
    expect(groups.system).toHaveLength(1);
    expect(groups.site.map((n) => n.id)).toEqual(['site']);
    expect(groups.game.map((n) => n.title)).toEqual(['游戏内资讯']);
    expect(groups.official.map((n) => n.title)).toEqual(['官网更新']);
  });

  it('keeps site-announcement unread state when opening notifications or game sources', async () => {
    render(<Harness request={{ category: 'system' }} initial={[notice('one')]} />);
    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /^游戏内公告/ }));
    });
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    expect(viewed).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: /网站公告.*有未读消息/ })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /^网站公告/ }));
    });
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(viewed).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: /^网站通知/ }));
    expect(within(dialog).getByRole('button', { name: '标为已读' })).toBeInTheDocument();
  });

  it('preserves notification read, dismiss, clear and diagnostic actions in the unified dialog', async () => {
    const copy = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    render(
      <Harness
        request={{ category: 'system', id: 'second' }}
        initial={[
          notice('first'),
          notice('second', {
            diagnosticText: 'request failed: redacted',
            copyDiagnosticLabel: '复制诊断',
            copiedDiagnosticLabel: '已复制',
            actions: [{ label: '前往设置', href: '/settings' }],
          }),
        ]}
      />
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: '通知 second' })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '复制诊断' }));
    });
    expect(copy).toHaveBeenCalledWith('request failed: redacted');
    expect(within(dialog).getByRole('link', { name: '前往设置' })).toHaveAttribute('href', '/settings');
    fireEvent.click(within(dialog).getByRole('button', { name: '标为已读' }));
    expect(within(dialog).queryByRole('button', { name: '标为已读' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '移除通知' }));
    expect(within(dialog).getByRole('heading', { name: '通知 first' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '全部已读' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '清理已读' }));
    expect(within(dialog).getByRole('heading', { name: '暂无消息' })).toBeInTheDocument();
    expect(state.announcements).toHaveLength(1);
  });

  it('auto-opens account errors, suppresses manual-close reopening, and allows a later error', () => {
    const props = {
      request: null,
      onOpen: vi.fn(),
      onClose: vi.fn(),
      unreadCount: 1,
      hasNewAnnouncement: false,
      setHasNewAnnouncement: vi.fn(),
    };
    const first = notice('auth-one', { category: 'account', type: 'error' });
    const { rerender } = render(<DesktopMessageCenter {...props} notifications={[first]} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<DesktopMessageCenter {...props} notifications={[{ ...first }]} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(
      <DesktopMessageCenter
        {...props}
        notifications={[notice('auth-two', { category: 'account', type: 'warning' }), first]}
      />
    );
    expect(screen.getByRole('heading', { name: '通知 auth-two' })).toBeInTheDocument();
  });
});
