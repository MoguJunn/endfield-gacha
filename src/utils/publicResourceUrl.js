import {
  isUnsafePublicHostname,
  sanitizePublicCatalogResourceUrl,
} from '../../shared/publicCatalogDto.js';

const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export const APPROVED_PUBLIC_RESOURCE_HOSTS = Object.freeze([
  'ef-gacha.mogujun.icu',
  ...String(import.meta.env?.VITE_PUBLIC_RESOURCE_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
]);

export function isReservedObjectKey(value) {
  return RESERVED_OBJECT_KEYS.has(String(value || '').trim().toLowerCase());
}

export function isUnsafeNetworkHostname(hostname) {
  return isUnsafePublicHostname(hostname);
}

export function sanitizePublicResourceUrl(value, {
  allowRelative = true,
  allowedAbsoluteHosts = APPROVED_PUBLIC_RESOURCE_HOSTS,
} = {}) {
  return sanitizePublicCatalogResourceUrl(value, {
    allowRelative,
    allowedHosts: allowedAbsoluteHosts,
  });
}

export function sanitizeExternalNavigationUrl(value, { allowMailto = false } = {}) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 2048) return null;
  if (normalized.startsWith('/') && !normalized.startsWith('//')) return normalized;
  if (normalized.startsWith('#')) return normalized;

  try {
    const url = new URL(normalized);
    if (allowMailto && url.protocol === 'mailto:') return url.toString();
    if (url.protocol !== 'https:' || url.username || url.password || isUnsafeNetworkHostname(url.hostname)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function resolveTrustedCatalogApiBase(value, {
  allowedHosts = ['ef-gacha.mogujun.icu'],
  fallback = 'https://ef-gacha.mogujun.icu',
} = {}) {
  const allowed = new Set(Array.from(allowedHosts, (host) => String(host || '').trim().toLowerCase()).filter(Boolean));
  try {
    const url = new URL(String(value || '').trim());
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || url.search
      || url.hash
      || !['', '/'].includes(url.pathname)
      || isUnsafeNetworkHostname(url.hostname)
      || !allowed.has(url.hostname.toLowerCase())
    ) {
      return fallback;
    }
    return url.origin;
  } catch {
    return fallback;
  }
}
