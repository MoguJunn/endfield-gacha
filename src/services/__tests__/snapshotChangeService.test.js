import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const network = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../supabaseRequest.js', () => ({ fetchJsonWithTimeout: network.fetch }));
vi.mock('../authFetchService.js', () => ({ getSameOriginAuthHeaders: async () => ({ headers: {} }) }));
vi.mock('../../dev/contributorDemoMode.js', () => ({ isContributorDemoModeEnabled: () => false }));
const versions = (statistics = 's1', pending = false) => ({ catalogVersion: 'c1', public: { global_summary: 'g1' },
  personal: { ownerId: 'owner', statistics, analysis: 'a1', statisticsPending: pending, analysisPending: false } });
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); sessionStorage.clear(); network.fetch.mockReset();
  network.fetch.mockResolvedValue({ response: { ok: true }, data: { success: true, data: versions() } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('change-driven snapshot subscriptions', () => {
  it('coalesces remounts and foreground events for 30 seconds while mutations still check immediately', async () => {
    const { useSnapshotVersion } = await import('../../hooks/app/useSnapshotVersion.js');
    const api = await import('../snapshotChangeService.js');
    renderHook(() => useSnapshotVersion('owner'));
    await act(async () => {});
    renderHook(() => useSnapshotVersion('owner'));
    renderHook(() => useSnapshotVersion(''));
    await act(async () => {
      for (let index = 0; index < 20; index++) {
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
      }
    });
    expect(network.fetch).toHaveBeenCalledOnce();
    await act(async () => api.notifySnapshotMutation('owner'));
    expect(network.fetch).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(network.fetch).toHaveBeenCalledTimes(3);
  });
  it('uses shared caching only for ordinary public checks and bypasses it for explicit refreshes', async () => {
    network.fetch.mockResolvedValue({ response: { ok: true }, data: { success: true, data: { ...versions(), personal: null } } });
    const api = await import('../snapshotChangeService.js');
    await api.checkSnapshotVersions();
    expect(network.fetch.mock.calls[0][0]).toBe('/api/stats?type=snapshot_versions');
    expect(network.fetch.mock.calls[0][1].cache).toBe('default');
    await api.checkSnapshotVersions('', { force: true });
    expect(network.fetch.mock.calls[1][0]).toMatch(/&ts=\d+$/);
    expect(network.fetch.mock.calls[1][1].cache).toBe('no-store');
  });
  it('does no periodic checks for unchanged completed data and only notifies actual changes', async () => {
    const { useSnapshotVersion } = await import('../../hooks/app/useSnapshotVersion.js');
    const { result } = renderHook(() => useSnapshotVersion('owner'));
    await act(async () => {});
    const first = result.current;
    await act(async () => vi.advanceTimersByTimeAsync(3_600_000));
    expect(network.fetch).toHaveBeenCalledTimes(1);
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(network.fetch).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(first);
    network.fetch.mockResolvedValue({ response: { ok: true }, data: { success: true, data: versions('s2') } });
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(result.current.personal.statistics).toBe('s2');
  });
  it('combines checks for concurrent views and checks only known pending work with a finite budget', async () => {
    network.fetch.mockResolvedValue({ response: { ok: true }, data: { success: true, data: versions('s1', true) } });
    const { useSnapshotVersion } = await import('../../hooks/app/useSnapshotVersion.js');
    renderHook(() => { useSnapshotVersion('owner'); useSnapshotVersion('owner'); });
    await act(async () => {});
    expect(network.fetch).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1_000_000));
    expect(network.fetch.mock.calls.length).toBeLessThanOrEqual(6);
    const count = network.fetch.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(1_000_000));
    expect(network.fetch).toHaveBeenCalledTimes(count);
  });
  it.each(['', 'owner'])('does not poll while other users keep public statistics pending: owner=%s', async ownerId => {
    network.fetch.mockResolvedValue({ response: { ok: true }, data: { success: true,
      data: { ...versions(), publicPending: true, ...(!ownerId ? { personal: null } : {}) } } });
    const { useSnapshotVersion } = await import('../../hooks/app/useSnapshotVersion.js');
    renderHook(() => useSnapshotVersion(ownerId));
    await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(3_600_000));
    expect(network.fetch).toHaveBeenCalledTimes(1);
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(network.fetch).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(3_600_000));
    expect(network.fetch).toHaveBeenCalledTimes(2);
  });
  it('does not renew the personal completion-check budget when public snapshots keep changing', async () => {
    let publication = 0;
    network.fetch.mockImplementation(async () => ({ response: { ok: true }, data: { success: true,
      data: { ...versions('s1', true), publicPending: true, public: { global_summary: `g${++publication}` } } } }));
    const { useSnapshotVersion } = await import('../../hooks/app/useSnapshotVersion.js');
    renderHook(() => useSnapshotVersion('owner'));
    await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(1_000_000));
    expect(network.fetch).toHaveBeenCalledTimes(6);
    await act(async () => vi.advanceTimersByTimeAsync(3_600_000));
    expect(network.fetch).toHaveBeenCalledTimes(6);
  });
  it('does not let a request finishing after sign-out restore the old owner version', async () => {
    const api = await import('../snapshotChangeService.js');
    let finish;
    network.fetch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const request = api.checkSnapshotVersions('owner');
    await act(async () => {});
    api.forgetSnapshotOwner('owner');
    finish({ response: { ok: true }, data: { success: true, data: versions() } });
    await expect(request).rejects.toThrow('Snapshot owner changed');
    expect(api.getKnownSnapshotVersions('owner')).toBeNull();
  });
});
