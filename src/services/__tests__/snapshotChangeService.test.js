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
