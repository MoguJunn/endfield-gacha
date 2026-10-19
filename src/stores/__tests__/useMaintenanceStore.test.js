import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({ value: null }));
vi.mock('../../utils/storageUtils.js', () => ({
  readStorageValue: () => storage.value,
  writeStorageValue: (_key, value) => { storage.value = value; },
}));
beforeEach(() => { vi.resetModules(); storage.value = null; vi.spyOn(Date, 'now').mockReturnValue(100000); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('maintenance browser state', () => {
  it('shows a deployment notice on first visit and keeps it if the network is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { default: store } = await import('../useMaintenanceStore.js');
    expect(store.getState().notice.enabled).toBe(true);
    await store.getState().refresh();
    expect(store.getState().notice.enabled).toBe(true);
    await store.getState().refresh();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('preserves a previously saved off setting when a cold server can only supply the deployment notice', async () => {
    storage.value = JSON.stringify({ enabled: false });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { enabled: true }, meta: { source: 'deployment' } }) }));
    const { default: store } = await import('../useMaintenanceStore.js');
    await store.getState().refresh();
    expect(store.getState().notice.enabled).toBe(false);
  });
  it('accepts a live administrator update and persists off across remounts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { enabled: false }, meta: { source: 'database' } }) }));
    const { default: store } = await import('../useMaintenanceStore.js');
    await store.getState().refresh();
    expect(store.getState().notice.enabled).toBe(false);
    expect(JSON.parse(storage.value).enabled).toBe(false);
    vi.resetModules();
    const { default: remounted } = await import('../useMaintenanceStore.js');
    expect(remounted.getState().notice.enabled).toBe(false);
  });
});
