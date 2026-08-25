import { preloadPublicBootstrap } from './bootstrapService';

const routePreloaders = {
  home: () => import('../components/home/HomePage'),
  summary: () => import('../components/SummaryView'),
  dashboard: () => import('../components/app/DesktopDashboardWorkspace'),
  records: () => import('../components/records/RecordsView'),
  simulator: () => import('../features/simulator/GachaSimulator'),
  settings: () => import('../components/SettingsPanel'),
  about: () => import('../components/AboutPanel'),
  tickets: () => import('../components/TicketPanel'),
  admin: () => import('../components/AdminPanel'),
  mobileOverview: () => import('../mobile/views/MobileOverviewView'),
  mobileDetails: () => import('../mobile/views/MobileDashboardView'),
  mobileStats: () => import('../mobile/views/MobileStatsView'),
  mobileSimulator: () => import('../mobile/views/MobileSimulatorView'),
  mobileTickets: () => import('../mobile/views/MobileTicketView'),
  mobileAdmin: () => import('../mobile/views/MobileAdminView'),
};

const routeWarmupPromises = new Map();
let criticalStartupPromise = null;

function canPreloadNonCriticalModules() {
  if (typeof navigator === 'undefined') {
    return true;
  }

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!connection) {
    return true;
  }

  return connection.saveData !== true && !['slow-2g', '2g'].includes(connection.effectiveType);
}

export function prepareCriticalStartup() {
  if (!criticalStartupPromise) {
    criticalStartupPromise = preloadPublicBootstrap().catch(() => null);
  }
  return criticalStartupPromise;
}

export function preloadRouteOnIntent(routeId) {
  const preload = routePreloaders[routeId];
  if (!preload || !canPreloadNonCriticalModules()) {
    return Promise.resolve(null);
  }

  if (!routeWarmupPromises.has(routeId)) {
    routeWarmupPromises.set(
      routeId,
      Promise.resolve()
        .then(preload)
        .catch(() => null)
    );
  }

  return routeWarmupPromises.get(routeId);
}

export function schedulePostInteractiveWarmup(routeIds = []) {
  if (!canPreloadNonCriticalModules() || routeIds.length === 0 || typeof window === 'undefined') {
    return () => {};
  }

  const run = () => {
    routeIds.forEach((routeId) => {
      void preloadRouteOnIntent(routeId);
    });
  };
  const idleCallbackId = typeof window.requestIdleCallback === 'function'
    ? window.requestIdleCallback(run, { timeout: 3000 })
    : window.setTimeout(run, 1500);

  return () => {
    if (typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(idleCallbackId);
    } else {
      window.clearTimeout(idleCallbackId);
    }
  };
}

// Compatibility exports for callers that have not moved to intent-based
// preloading yet. Neither function imports route modules.
export function preloadApplicationModules() {
  return Promise.resolve();
}

export function warmupApplication() {
  return prepareCriticalStartup();
}

export default {
  prepareCriticalStartup,
  preloadApplicationModules,
  preloadRouteOnIntent,
  schedulePostInteractiveWarmup,
  warmupApplication
};
