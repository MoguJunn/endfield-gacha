// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SiteAnnouncementPopup from '../SiteAnnouncementPopup.jsx';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), setAnnouncements: vi.fn(), auth: { showAuthModal: false }, ui: { modalState: { type: null } },
}));
vi.mock('../../../services/supabaseRequest.js', () => ({ fetchWithTimeout: mocks.fetch }));
vi.mock('../../../stores', () => ({
  useAppStore: { getState: () => ({ setAnnouncements: mocks.setAnnouncements }) },
  useAuthStore: selector => selector(mocks.auth),
  useUIStore: selector => selector(mocks.ui),
}));
vi.mock('../../../i18n/index.js', () => ({ useI18n: () => ({ locale: 'zh-CN', isEnglish: false }) }));
vi.mock('../../../dev/contributorDemoMode.js', () => ({ isContributorDemoModeEnabled: () => false }));
vi.mock('../../SimpleMarkdown.jsx', () => ({ default: ({ content }) => <p>{content}</p> }));

const notice = { id: 'restore', title: '服务已恢复', content: '当前可能稍慢。', is_active: true,
  announcement_type: 'temporary', updated_at: '2026-11-02T14:00:00Z', priority: 10 };
const response = records => ({ ok: true, json: async () => ({ success: true, data: { siteAnnouncements: records } }) });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('网站公告自动弹窗', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    localStorage.clear();
    mocks.auth.showAuthModal = false;
    mocks.ui.modalState.type = null;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    mocks.fetch.mockResolvedValue(response([notice]));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('首次提示最新网站公告，确认后重进不再弹，同一公告更新后重新提示', async () => {
    let view = render(<SiteAnnouncementPopup />);
    await flush();
    expect(screen.getByRole('dialog', { name: notice.title })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '我知道了' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    view.unmount();
    view = render(<SiteAnnouncementPopup />);
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    mocks.fetch.mockResolvedValue(response([{ ...notice, updated_at: '2026-11-02T15:00:00Z', content: '新进展' }]));
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('新进展')).toBeTruthy();
    expect(mocks.fetch.mock.calls.every(([url]) => url === '/api/announcements?scope=site')).toBe(true);
  });

  it('忽略游戏公告、停用公告，并让新低优先级网站公告越过旧置顶公告', async () => {
    mocks.fetch.mockResolvedValue(response([
      { ...notice, id: 'old', title: '旧置顶', updated_at: '2026-10-01', priority: 999 },
      { ...notice, id: 'game', source_id: 'game:123', updated_at: '2026-12-01' },
      { ...notice, id: 'inactive', is_active: false, updated_at: '2026-12-01' }, notice,
    ]));
    render(<SiteAnnouncementPopup />);
    await flush();
    expect(screen.getByRole('dialog', { name: notice.title })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭公告' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('登录或导入弹窗关闭后再提示，后台不轮询，恢复可见时检查但密集焦点事件不重复请求', async () => {
    mocks.auth.showAuthModal = true;
    const view = render(<SiteAnnouncementPopup />);
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    mocks.auth.showAuthModal = false;
    mocks.ui.modalState.type = 'import';
    view.rerender(<SiteAnnouncementPopup />);
    expect(screen.queryByRole('dialog')).toBeNull();
    mocks.ui.modalState.type = null;
    view.rerender(<SiteAnnouncementPopup />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 10; index++) window.dispatchEvent(new Event('focus'));
    await flush();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('请求失败不清空公告列表，其他标签页确认后当前弹窗同步关闭', async () => {
    render(<SiteAnnouncementPopup />);
    await flush();
    mocks.fetch.mockRejectedValue(new Error('offline'));
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(mocks.setAnnouncements).toHaveBeenCalledTimes(1);
    localStorage.setItem('gacha_site_announcement_popup_seen_v1', JSON.stringify({ restore: `restore:${notice.updated_at}` }));
    await act(async () => { window.dispatchEvent(new StorageEvent('storage')); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
