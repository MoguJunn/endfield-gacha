import { resolvePlatformPath } from '../constants/appRoutes';

const DEVICE_REDIRECT_BYPASS_PREFIXES = ['/privacy', '/terms', '/share', '/reset-password', '/auth', '/status'];

function normalizePathname(pathname) {
  if (!pathname || pathname === '/') {
    return '/';
  }

  const normalized = pathname.replace(/\/+$/, '');
  return normalized || '/';
}

export function shouldBypassDeviceRedirect(pathname) {
  const normalizedPath = normalizePathname(pathname);

  return DEVICE_REDIRECT_BYPASS_PREFIXES.some((prefix) => (
    normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
  ));
}

function appendLocationState(pathname, {
  search = '',
  hash = '',
} = {}) {
  const normalizedSearch = String(search || '').trim();
  const normalizedHash = String(hash || '').trim();
  const searchSuffix = normalizedSearch
    ? (normalizedSearch.startsWith('?') ? normalizedSearch : `?${normalizedSearch}`)
    : '';
  const hashSuffix = normalizedHash
    ? (normalizedHash.startsWith('#') ? normalizedHash : `#${normalizedHash}`)
    : '';
  return `${pathname}${searchSuffix}${hashSuffix}`;
}

export function getDeviceRedirectTarget(pathname, shouldUseMobile, locationState = {}) {
  const normalizedPath = normalizePathname(pathname);
  if (shouldBypassDeviceRedirect(normalizedPath)) {
    return null;
  }

  const isMobilePath = normalizedPath.startsWith('/m');
  if (shouldUseMobile && !isMobilePath) {
    return appendLocationState(resolvePlatformPath(normalizedPath, 'mobile'), locationState);
  }

  if (!shouldUseMobile && isMobilePath) {
    return appendLocationState(resolvePlatformPath(normalizedPath, 'desktop'), locationState);
  }

  return null;
}

export default {
  getDeviceRedirectTarget,
  shouldBypassDeviceRedirect
};
