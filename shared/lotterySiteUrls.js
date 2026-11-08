const MAIN_SITE_ORIGINS = new Set(['https://ef-gacha.mogujun.icu', 'https://ef.nepst.cn']);

function parseBaseUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

// Main-site cookies and SSO state are host-only. Keep a same-domain deployment
// on its validated current domain throughout start, callback, and Origin checks.
export function resolveLotterySiteUrls(req, env = process.env) {
  const main = parseBaseUrl(env.MAIN_SITE_URL || env.VITE_APP_URL || env.APP_URL);
  const lottery = parseBaseUrl(env.LOTTERY_SITE_URL);
  const configured = {
    mainSiteOrigin: main?.origin || '',
    lotteryOrigin: lottery?.origin || '',
    lotteryBaseUrl: lottery ? `${lottery.origin}${lottery.pathname.replace(/\/+$/u, '')}` : '',
  };
  if (!main || !lottery || main.origin !== lottery.origin) return configured;

  const host = String(req?.headers?.host || '').trim();
  const protocol = String(req?.headers?.['x-forwarded-proto'] || (req?.socket?.encrypted ? 'https' : 'http')).split(',')[0].trim();
  const current = parseBaseUrl(`${protocol}://${host}`);
  if (!current || current.host !== host || current.pathname !== '/') return configured;
  const trusted = current.origin === main.origin
    || (MAIN_SITE_ORIGINS.has(main.origin) && MAIN_SITE_ORIGINS.has(current.origin));
  if (!trusted) return configured;
  return {
    mainSiteOrigin: current.origin,
    lotteryOrigin: current.origin,
    lotteryBaseUrl: `${current.origin}${lottery.pathname.replace(/\/+$/u, '')}`,
  };
}
