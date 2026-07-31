export const APP_TAB_IDS = [
  'home',
  'summary',
  'dashboard',
  'overview',
  'details',
  'stats',
  'simulator',
  'lotteryContacts',
  'admin',
  'settings',
  'developerApi',
  'about',
  'tickets'
];

export const DESKTOP_TAB_ROUTES = {
  home: '/',
  summary: '/summary',
  dashboard: '/dashboard',
  simulator: '/simulator',
  lotteryContacts: '/lottery-contacts',
  admin: '/admin',
  settings: '/settings',
  developerApi: '/developer-api',
  about: '/about',
  tickets: '/tickets'
};

export const MOBILE_TAB_ROUTES = {
  home: '/m',
  overview: '/m/overview',
  details: '/m/details',
  stats: '/m/stats',
  simulator: '/m/simulator',
  lotteryContacts: '/m/lottery-contacts',
  admin: '/m/admin',
  settings: '/m/settings',
  developerApi: '/m/developer-api',
  about: '/m/about',
  tickets: '/m/tickets'
};

const DESKTOP_TAB_ALIASES = {
  ticket: 'tickets',
  overview: 'summary',
  stats: 'summary',
  details: 'dashboard'
};

const MOBILE_TAB_ALIASES = {
  ticket: 'tickets',
  summary: 'overview',
  dashboard: 'details'
};

function normalizePathname(pathname) {
  if (!pathname || pathname === '/') return '/';
  const normalized = pathname.replace(/\/+$/, '');
  return normalized || '/';
}

export function normalizeAppTab(tab) {
  const normalizedTab = tab === 'ticket' ? 'tickets' : tab;
  const desktopTab = DESKTOP_TAB_ALIASES[normalizedTab] || normalizedTab;
  return APP_TAB_IDS.includes(desktopTab) ? desktopTab : 'home';
}

function normalizeDesktopTab(tab) {
  const normalizedTab = tab === 'ticket' ? 'tickets' : tab;
  const desktopTab = DESKTOP_TAB_ALIASES[normalizedTab] || normalizedTab;
  return DESKTOP_TAB_ROUTES[desktopTab] ? desktopTab : 'home';
}

function normalizeMobileTab(tab) {
  const normalizedTab = tab === 'ticket' ? 'tickets' : tab;
  const mobileTab = MOBILE_TAB_ALIASES[normalizedTab] || normalizedTab;
  return MOBILE_TAB_ROUTES[mobileTab] ? mobileTab : 'home';
}

export function getDesktopPathForTab(tab) {
  return DESKTOP_TAB_ROUTES[normalizeDesktopTab(tab)] || DESKTOP_TAB_ROUTES.home;
}

export function getMobilePathForTab(tab) {
  return MOBILE_TAB_ROUTES[normalizeMobileTab(tab)] || MOBILE_TAB_ROUTES.home;
}

export function getDesktopTabFromPath(pathname) {
  const normalizedPath = normalizePathname(pathname);
  return Object.entries(DESKTOP_TAB_ROUTES).find(([, route]) => route === normalizedPath)?.[0] || 'home';
}

export function getMobileTabFromPath(pathname) {
  const normalizedPath = normalizePathname(pathname);
  if (normalizedPath === '/m/summary') {
    return 'overview';
  }
  if (normalizedPath === '/m/dashboard') {
    return 'details';
  }
  return Object.entries(MOBILE_TAB_ROUTES).find(([, route]) => route === normalizedPath)?.[0] || 'home';
}

export function resolvePlatformPath(pathname, targetPlatform = 'desktop') {
  const normalizedPath = normalizePathname(pathname);
  const currentPlatform = normalizedPath.startsWith('/m') ? 'mobile' : 'desktop';
  const currentTab = currentPlatform === 'mobile'
    ? getMobileTabFromPath(normalizedPath)
    : getDesktopTabFromPath(normalizedPath);

  if (targetPlatform === 'mobile') {
    return getMobilePathForTab(currentTab);
  }

  return getDesktopPathForTab(currentTab);
}
