import { readNumberStorageValue, STORAGE_KEYS } from './storageUtils.js';

export const CAPTCHA_VALIDITY_DURATION_MS = 24 * 60 * 60 * 1000;

export function hasTrustedGateSession() {
  const lastVerifiedAt = readNumberStorageValue(
    STORAGE_KEYS.CAPTCHA_LAST_VERIFIED,
    null,
    { raw: true }
  );

  return Number.isFinite(lastVerifiedAt)
    && Date.now() - lastVerifiedAt < CAPTCHA_VALIDITY_DURATION_MS;
}
