import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useDeviceDetection } from '../../hooks/useDeviceDetection';
import { getDeviceRedirectTarget } from '../../utils/deviceRedirect.js';

const REDIRECT_TS_KEY = '_device_redirect_ts';
const REDIRECT_COOLDOWN_MS = 3000;

function DeviceRedirectGuard({ children }) {
  const location = useLocation();
  const { shouldUseMobile } = useDeviceDetection();

  useEffect(() => {
    const target = getDeviceRedirectTarget(location.pathname, shouldUseMobile, {
      search: location.search,
      hash: location.hash,
    });
    if (!target) return;

    const now = Date.now();
    const lastTs = Number(sessionStorage.getItem(REDIRECT_TS_KEY) || 0);
    if (now - lastTs < REDIRECT_COOLDOWN_MS) return;

    sessionStorage.setItem(REDIRECT_TS_KEY, String(now));
    window.location.replace(window.location.origin + target);
  }, [shouldUseMobile, location.hash, location.pathname, location.search]);

  return children;
}

export default DeviceRedirectGuard;
