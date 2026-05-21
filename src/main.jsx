import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import './registerAppFonts.js'
import './index.css'
import AppRouter from './AppRouter'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { preloadPublicBootstrap } from './services/bootstrapService'
import { getDeviceRedirectTarget } from './utils/deviceRedirect.js'
import { appLogger } from './utils/appLogger.js'
import { prepareFreshNavigation } from './utils/serviceWorkerRecovery.js'
import { I18nProvider, ensureLocaleMessages, getAppLocale } from './i18n/index.js'
import { installRuntimeObservability } from './utils/runtimeObservability.js'
import { readStorageValue, STORAGE_KEYS } from './utils/storageUtils.js'
import { markAppMounted, renderAppCrashFallback } from './utils/appCrashFallback.js'

function syncDeviceRedirect() {
  const preference = readStorageValue(STORAGE_KEYS.PLATFORM_PREFERENCE, null, { raw: true });
  const pathname = window.location.pathname;

  const mqMobile = window.matchMedia('(max-width: 768px)').matches;
  const uaMobile = /Mobile|Android|iPhone|iPod|iPad|webOS|BlackBerry|Opera Mini|IEMobile/i.test(navigator.userAgent);
  const shouldUseMobile = preference
    ? preference === 'mobile'
    : (mqMobile || window.innerWidth <= 768 || uaMobile);

  const redirectTarget = getDeviceRedirectTarget(pathname, shouldUseMobile);
  if (redirectTarget) {
    window.location.replace(window.location.origin + redirectTarget);
  }
}

const schedulePreload = typeof window.requestIdleCallback === 'function'
  ? window.requestIdleCallback.bind(window)
  : (callback) => window.setTimeout(callback, 250);

async function bootstrapApp() {
  const { didNavigate } = await prepareFreshNavigation();
  if (didNavigate) {
    return;
  }

  installRuntimeObservability();
  syncDeviceRedirect();

  schedulePreload(() => {
    preloadPublicBootstrap().catch(err => {
      appLogger.warn('预加载数据失败，将使用实时查询:', err);
    });
  });

  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element #root was not found');
  }

  await ensureLocaleMessages(getAppLocale());

  createRoot(rootElement).render(
    <StrictMode>
      <I18nProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ErrorBoundary>
            <AppRouter />
          </ErrorBoundary>
        </BrowserRouter>
      </I18nProvider>
      <Analytics />
      <SpeedInsights />
    </StrictMode>,
  );
  markAppMounted();
}

bootstrapApp().catch((error) => {
  appLogger.error('应用启动失败:', error);
  renderAppCrashFallback(error, { phase: 'bootstrap', force: true });
});
