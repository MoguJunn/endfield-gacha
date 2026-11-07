import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

it('keeps the same device ID after reloading the module instead of creating a device on every login', async () => {
  const uuid = vi.spyOn(crypto, 'randomUUID');
  const first = (await import('../officialQrDevice.js')).getOfficialQrDeviceId();
  vi.resetModules();
  const afterReload = (await import('../officialQrDevice.js')).getOfficialQrDeviceId();
  expect(first).toMatch(/^[a-f0-9]{32}$/);
  expect(afterReload).toBe(first);
  expect(uuid).toHaveBeenCalledOnce();
});

it('keeps an ID for the browser session when persistent storage is unavailable', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  const { getOfficialQrDeviceId } = await import('../officialQrDevice.js');
  const id = getOfficialQrDeviceId();
  expect(id).toMatch(/^[a-f0-9]{32}$/);
  expect(getOfficialQrDeviceId()).toBe(id);
});

it('replaces a malformed stored ID with a random device identifier', async () => {
  localStorage.setItem('endfield.officialQr.deviceId', 'invalid-device');
  const id = (await import('../officialQrDevice.js')).getOfficialQrDeviceId();
  expect(id).toMatch(/^[a-f0-9]{32}$/);
  expect(localStorage.getItem('endfield.officialQr.deviceId')).toBe(id);
});
