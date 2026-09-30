import { describe, expect, it, vi } from 'vitest';
import { isModuleLoadError, recoverModuleLoad } from '../moduleLoadRecovery.js';

const safariError = () => new TypeError('Importing a module script failed.');
function browser() {
  const values = new Map();
  return { navigator: { onLine: true }, location: { href: 'https://example.com/m?pool=p#report', reload: vi.fn() },
    history: { state: { position: 2 }, replaceState: vi.fn() },
    sessionStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } };
}
describe('module load recovery', () => {
  it('recognizes Safari, Chromium and Firefox load errors but not application exceptions', () => {
    for (const message of ['Importing a module script failed.', 'Failed to fetch dynamically imported module: /assets/view.js',
      'error loading dynamically imported module: /assets/view.js', 'Loading chunk 42 failed.']) {
      expect(isModuleLoadError(new TypeError(message))).toBe(true);
    }
    expect(isModuleLoadError(new TypeError('Cannot read properties of undefined'))).toBe(false);
    expect(isModuleLoadError(new SyntaxError('Unexpected token'))).toBe(false);
  });
  it('preserves location and attempts only once across repeated errors and navigation', () => {
    const win = browser();
    expect(recoverModuleLoad(safariError(), win, 1000000)).toBe(true);
    const target = new URL(win.history.replaceState.mock.calls[0][2]);
    expect(win.history.replaceState.mock.calls[0][0]).toEqual({ position: 2 });
    expect(target.pathname).toBe('/m');
    expect(target.searchParams.get('pool')).toBe('p');
    expect(target.hash).toBe('#report');
    expect(recoverModuleLoad(safariError(), win, 1000001)).toBe(false);
    win.location.href = target.href;
    win.sessionStorage = browser().sessionStorage;
    expect(recoverModuleLoad(safariError(), win, 2000000)).toBe(false);
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });
  it('does not navigate offline, without storage, or for a render bug', () => {
    const win = browser();
    win.navigator.onLine = false;
    expect(recoverModuleLoad(safariError(), win)).toBe(false);
    win.navigator.onLine = true;
    win.sessionStorage.setItem = () => { throw new Error('blocked'); };
    expect(recoverModuleLoad(safariError(), win)).toBe(false);
    expect(recoverModuleLoad(new TypeError('Cannot read properties of undefined'), win)).toBe(false);
    expect(win.location.reload).not.toHaveBeenCalled();
  });
});
