import { createHash, randomBytes } from 'node:crypto';
import { getSupabaseAdminClient } from '../../_lib/authAdmin.js';
import { getRequesterKey } from '../../_lib/http.js';
import { consumeLotteryRateLimit } from '../../_lib/lotteryRateLimit.js';
import {
  appendSetCookieHeader,
  isSecureRequest,
  loadSiteSession,
  parseCookieHeader,
  serializeCookie,
} from '../../_lib/siteSession.js';

const PRODUCTION_COOKIE = '__Host-eg_summer_lottery_sso';
const LOCAL_COOKIE = 'eg_summer_lottery_sso';
const DEFAULT_AUDIENCE = 'open-lottery';
const STATE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;
const TICKET_TTL_SECONDS = 60;
const PENDING_TTL_SECONDS = 10 * 60;

function normalizeBaseUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (
      !['http:', 'https:'].includes(url.protocol)
      || url.username
      || url.password
      || url.search
      || url.hash
    ) return '';
    const pathname = url.pathname.replace(/\/+$/u, '');
    return `${url.origin}${pathname === '/' ? '' : pathname}`;
  } catch {
    return '';
  }
}

function redirect(res, location, status = 303) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.statusCode = status;
  res.setHeader('Location', location);
  res.end();
}

function sendError(res, status, code, message) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({ success: false, error: code, code, message });
}

function redirectLotteryError(res, lotteryBaseUrl, code) {
  const target = new URL(`${lotteryBaseUrl}/`);
  target.searchParams.set('auth', code);
  return redirect(res, target.toString());
}

function hashHex(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function getCookieName(req) {
  return isSecureRequest(req) ? PRODUCTION_COOKIE : LOCAL_COOKIE;
}

function setPendingStateCookie(req, res, value, maxAgeSeconds = PENDING_TTL_SECONDS) {
  appendSetCookieHeader(res, serializeCookie(getCookieName(req), value, {
    maxAgeSeconds,
    secure: isSecureRequest(req),
    sameSite: 'Lax',
  }));
}

function getPendingState(req) {
  return parseCookieHeader(req.headers?.cookie || '')[getCookieName(req)] || '';
}

function buildMainLoginUrl(req) {
  const configuredOrigin = normalizeBaseUrl(process.env.VITE_APP_URL || process.env.APP_URL);
  if (configuredOrigin) {
    return `${configuredOrigin}/?summer_lottery_login=1`;
  }
  const protocol = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
  const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim();
  return host ? `${protocol}://${host}/?summer_lottery_login=1` : '/?summer_lottery_login=1';
}

export default async function summerLotterySsoStartHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendError(res, 405, 'method_not_allowed', 'Method not allowed.');
  }

  const lotteryBaseUrl = normalizeBaseUrl(process.env.LOTTERY_SITE_URL);
  const audience = String(process.env.LOTTERY_SSO_AUDIENCE || DEFAULT_AUDIENCE).trim().slice(0, 100);
  if (!lotteryBaseUrl || !audience) {
    return sendError(res, 503, 'lottery_sso_not_configured', 'Summer lottery SSO is not configured.');
  }

  const suppliedState = String(req.query?.state || '').trim();
  const state = suppliedState || getPendingState(req);
  if (!STATE_PATTERN.test(state)) {
    return redirectLotteryError(res, lotteryBaseUrl, 'state_error');
  }

  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return redirectLotteryError(res, lotteryBaseUrl, 'service_error');
  }
  let rateLimit;
  try {
    rateLimit = await consumeLotteryRateLimit(adminClient, {
      action: 'sso_start',
      identifiers: [getRequesterKey(req)],
      secret: process.env.LOTTERY_BACKEND_SECRET,
    });
  } catch {
    return redirectLotteryError(res, lotteryBaseUrl, 'service_error');
  }
  if (!rateLimit.allowed) {
    res.setHeader('Retry-After', String(rateLimit.retryAfter));
    return redirectLotteryError(res, lotteryBaseUrl, 'rate_error');
  }

  const session = await loadSiteSession(adminClient, { req, res, touch: false });
  if (!session.ok) {
    return redirectLotteryError(res, lotteryBaseUrl, 'session_error');
  }

  if (!session.authenticated || !session.user?.id) {
    setPendingStateCookie(req, res, state);
    return redirect(res, buildMainLoginUrl(req));
  }
  if (!session.session?.id) {
    return redirectLotteryError(res, lotteryBaseUrl, 'session_error');
  }

  const ticket = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TICKET_TTL_SECONDS * 1000).toISOString();
  const expiredTicketCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const expiredSessionCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [ticketCleanup, sessionCleanup, pendingCleanup] = await Promise.all([
    adminClient.from('summer_lottery_sso_tickets').delete().lt('expires_at', expiredTicketCutoff),
    adminClient.from('summer_lottery_sessions').delete().lt('expires_at', expiredSessionCutoff),
    adminClient
      .from('summer_lottery_sso_tickets')
      .delete()
      .eq('main_session_id', session.session.id)
      .is('consumed_at', null),
  ]);
  if (ticketCleanup.error || sessionCleanup.error || pendingCleanup.error) {
    return redirectLotteryError(res, lotteryBaseUrl, 'service_error');
  }
  const { error } = await adminClient
    .from('summer_lottery_sso_tickets')
    .insert({
      ticket_hash: hashHex(ticket),
      state_hash: hashHex(state),
      audience,
      user_id: session.user.id,
      main_session_id: session.session.id,
      expires_at: expiresAt,
    });

  if (error) {
    return redirectLotteryError(res, lotteryBaseUrl, 'ticket_error');
  }

  setPendingStateCookie(req, res, '', 0);
  const callbackUrl = new URL(`${lotteryBaseUrl}/`);
  callbackUrl.hash = new URLSearchParams({
    sso_ticket: ticket,
    state,
  }).toString();
  return redirect(res, callbackUrl.toString());
}
