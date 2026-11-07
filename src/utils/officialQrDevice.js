const STORAGE_KEY = 'endfield.officialQr.deviceId';
let browserDeviceId;

// A site-local identifier, following the official web SDK's persistent-device
// model. It contains no account credential and is never shared across sites.
export function getOfficialQrDeviceId() {
  if (browserDeviceId) return browserDeviceId;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (/^[a-f0-9]{32}$/.test(stored || '')) browserDeviceId = stored;
  } catch { /* The SDK also keeps an in-memory ID when storage is unavailable. */ }
  if (!browserDeviceId) {
    browserDeviceId = crypto.randomUUID().replaceAll('-', '');
    try { localStorage.setItem(STORAGE_KEY, browserDeviceId); } catch { /* Keep this browser session's ID. */ }
  }
  return browserDeviceId;
}
