import React, { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DeviceRedirectGuard from '../DeviceRedirectGuard.jsx';

vi.mock('../../../i18n/index.js', () => ({ useI18n: () => ({ isEnglish: false }) }));

const mounted = vi.fn();
function Destination() {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => { mounted(); }, []);
  return <>
    <output data-testid="destination">{location.pathname}{location.search}{location.hash}</output>
    <button onClick={() => navigate('/')}>返回桌面首页链接</button>
  </>;
}

function open(path = '/') {
  return render(<MemoryRouter initialEntries={[path]}>
    <DeviceRedirectGuard><Destination /></DeviceRedirectGuard>
  </MemoryRouter>);
}

describe('DeviceRedirectGuard platform choice', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mounted.mockClear();
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('matchMedia', () => ({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  function tick(seconds) {
    for (let i = 0; i < seconds; i += 1) act(() => vi.advanceTimersByTime(1000));
  }

  it.each(['mobile', 'desktop'])('automatically continues with saved %s after five visible seconds', preference => {
    vi.useFakeTimers();
    localStorage.setItem('platform-preference', preference);
    open('/settings?from=mail#account');
    expect(screen.getByRole('timer').textContent).toContain('5 秒');
    tick(4);
    expect(screen.queryByTestId('destination')).toBeNull();
    expect(screen.getByRole('timer').textContent).toContain('1 秒');
    tick(1);
    expect(screen.getByTestId('destination').textContent).toBe(`${preference === 'mobile' ? '/m' : ''}/settings?from=mail#account`);
  });

  it.each([null, 'invalid'])('never auto-selects without a valid saved preference (%s)', preference => {
    vi.useFakeTimers();
    if (preference) localStorage.setItem('platform-preference', preference);
    open();
    tick(10);
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.queryByTestId('destination')).toBeNull();
  });

  it.each(['mobile', 'desktop'])('lets the user replace saved %s before timeout without a delayed second redirect', preference => {
    vi.useFakeTimers();
    localStorage.setItem('platform-preference', preference);
    open();
    tick(4);
    const next = preference === 'mobile' ? 'desktop' : 'mobile';
    fireEvent.click(screen.getByRole('button', { name: next === 'mobile' ? /进入移动版/ : /仍然进入桌面版/ }));
    tick(10);
    expect(screen.getByTestId('destination').textContent).toBe(next === 'mobile' ? '/m' : '/');
    expect(localStorage.getItem('platform-preference')).toBe(next);
  });

  it('pauses while hidden and resumes with the remaining time', () => {
    vi.useFakeTimers();
    let visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    localStorage.setItem('platform-preference', 'mobile');
    open();
    tick(2);
    visibility = 'hidden';
    fireEvent(document, new Event('visibilitychange'));
    tick(10);
    expect(screen.getByRole('timer').textContent).toContain('3 秒');
    expect(screen.queryByTestId('destination')).toBeNull();
    visibility = 'visible';
    fireEvent(document, new Event('visibilitychange'));
    tick(3);
    expect(screen.getByTestId('destination').textContent).toBe('/m');
  });

  it.each(['button', 'keyboard'])('allows pausing by %s without forcing the user to race', method => {
    vi.useFakeTimers();
    localStorage.setItem('platform-preference', 'desktop');
    open();
    tick(2);
    if (method === 'button') fireEvent.click(screen.getByRole('button', { name: '暂停倒计时' }));
    else fireEvent.keyDown(document, { key: 'Tab' });
    tick(10);
    expect(screen.getByRole('timer').textContent).toContain('已暂停');
    expect(screen.queryByTestId('destination')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /进入移动版/ }));
    expect(screen.getByTestId('destination').textContent).toBe('/m');
  });

  it.each([null, 'desktop', 'mobile', 'invalid'])(
    'asks before mounting app content despite the saved preference %s', preference => {
      if (preference) localStorage.setItem('platform-preference', preference);
      open();
      expect(screen.getByRole('heading', { name: '选择适合你的浏览版本' })).toBeTruthy();
      expect(screen.getByText(/手机端无法完整显示桌面端内容/)).toBeTruthy();
      expect(screen.queryByTestId('destination')).toBeNull();
      expect(mounted).not.toHaveBeenCalled();
    }
  );

  it('keeps deep-link query and hash when choosing mobile, without the old cooldown', async () => {
    sessionStorage.setItem('_device_redirect_ts', String(Date.now()));
    open('/settings?email_verification=success#account');
    fireEvent.click(screen.getByRole('button', { name: /进入移动版/ }));
    expect((await screen.findByTestId('destination')).textContent).toBe('/m/settings?email_verification=success#account');
    expect(localStorage.getItem('platform-preference')).toBe('mobile');
    fireEvent.click(screen.getByRole('button', { name: '返回桌面首页链接' }));
    expect((await screen.findByTestId('destination')).textContent).toBe('/m');
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('remembers this tab choice across remounts even when another tab changes the saved preference', async () => {
    const first = open('/m');
    fireEvent.click(screen.getByRole('button', { name: /仍然进入桌面版/ }));
    expect((await screen.findByTestId('destination')).textContent).toBe('/');
    first.unmount();
    localStorage.setItem('platform-preference', 'mobile');
    open('/m/details?pool=one#records');
    expect((await screen.findByTestId('destination')).textContent).toBe('/dashboard?pool=one#records');
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it.each(['/privacy', '/terms', '/auth/callback?next=%2Fm', '/reset-password', '/status', '/share/test', '/donations'])(
    'leaves independent page %s accessible before choosing', path => {
      open(path);
      expect(screen.getByTestId('destination').textContent).toBe(path);
      expect(screen.queryByRole('heading')).toBeNull();
    }
  );

  it('does not ask on a wide desktop and ignores corrupt saved preferences', () => {
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    localStorage.setItem('platform-preference', 'invalid');
    open();
    expect(screen.getByTestId('destination').textContent).toBe('/');
    expect(screen.queryByRole('heading')).toBeNull();
  });
});
