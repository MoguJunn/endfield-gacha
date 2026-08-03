import accountRecoveryRequestHandler from './root/account-recovery-request.js';
import accountEmailActionHandler from './root/account-email-action.js';
import accountEmailVerifyHandler from './root/account-email-verify.js';
import accountGachaDataHandler from './root/account-gacha-data.js';
import accountLastSeenHandler from './root/account-last-seen.js';
import accountPasswordSetupHandler from './root/account-password-setup.js';
import accountProfileHandler from './root/account-profile.js';
import accountSecurityStateHandler from './root/account-security-state.js';
import adminHandler from './root/admin.js';
import adminHistoryAnomaliesHandler from './root/admin-history-anomalies.js';
import adminSummerLotteryContactsHandler from './root/admin-summer-lottery-contacts.js';
import adminSummerLotteryOperationsHandler from './root/admin-summer-lottery-operations.js';
import adminSummerLotteryPermissionsHandler from './root/admin-summer-lottery-permissions.js';
import adminCharactersHandler from './root/admin-characters.js';
import adminPoolPushHandler from './root/admin-pool-push.js';
import adminPoolsHandler from './root/admin-pools.js';
import announcementsHandler from './root/announcements.js';
import authEmailActionHandler from './root/auth-email-action.js';
import { authIdentityUnlinkHandler } from './root/auth-identities.js';
import authSessionHandler, {
  authSessionLogoutHandler,
  authSessionRevokeAllHandler,
} from './root/auth-session.js';
import {
  githubOAuthCallbackHandler,
  githubOAuthStartHandler,
  linuxdoOAuthCallbackHandler,
  linuxdoSupabaseAuthorizeHandler,
  linuxdoOAuthStartHandler,
  qqOAuthCallbackHandler,
  qqOAuthStartHandler,
} from './root/auth-oauth.js';
import authAccountStatusHandler from './root/auth-account-status.js';
import authPowChallengeHandler from './root/auth-pow-challenge.js';
import authRateLimitHandler from './root/auth-rate-limit.js';
import automationFeedHandler from './root/automation-feed.js';
import bootstrapHandler from './root/bootstrap.js';
import mailInboundHandler from './root/mail-inbound.js';
import mailDeliveryFeedbackHandler from './root/mail-delivery-feedback.js';
import mailOutboxWorkerHandler from './root/mail-outbox-worker.js';
import officialAnnouncementImageHandler from './root/official-announcement-image.js';
import opsAutomationHandler from './root/ops-automation.js';
import poolRostersHandler from './root/pool-rosters.js';
import publicCacheVersionHandler from './root/public-cache-version.js';
import puzzlesHandler from './root/puzzles.js';
import selfDeleteAccountHandler from './root/self-delete-account.js';
import statusAdminHandler from './root/status-admin.js';
import statusEndpointProbeHandler from './root/status-endpoint-probe.js';
import statusProbeHandler from './root/status-probe.js';
import siteStatusHandler from './root/site-status.js';
import statsHandler from './root/stats.js';
import summerLotteryBackendHandler from './root/summer-lottery-backend.js';
import summerLotteryContactRetentionHandler from './root/summer-lottery-contact-retention.js';
import summerLotterySsoStartHandler from './root/summer-lottery-sso.js';
import ticketReplyHandler from './root/ticket-reply.js';
import ticketsHandler from './root/tickets.js';
import wikiAssetProxyHandler from './root/wiki-asset-proxy.js';
import wikiProxyHandler from './root/wiki-proxy.js';
import devApplicationsHandler from './dev/applications/index.js';
import devApplicationsMeHandler from './dev/applications/me.js';
import devV1AnnouncementsHandler from './dev/v1/announcements.js';
import devV1CharacterHandler from './dev/v1/character.js';
import devV1CharactersHandler from './dev/v1/characters.js';
import devV1MetaHandler from './dev/v1/meta.js';
import devV1OpenApiHandler from './dev/v1/openapi.js';
import devV1PoolHandler from './dev/v1/pool.js';
import devV1PoolsHandler from './dev/v1/pools.js';
import devV1BotAnalysisHandler from './dev/v1/bot/analysis.js';
import devV1BotDashboardHandler from './dev/v1/bot/dashboard.js';
import devV1BotPoolDetailHandler from './dev/v1/bot/pool-detail.js';
import devV1BotPoolLogHandler from './dev/v1/bot/pool-log.js';
import devV1BotPoolsHandler from './dev/v1/bot/pools.js';
import devV1BotRecentPullsHandler from './dev/v1/bot/recent-pulls.js';
import devV1BotSelfSummaryHandler from './dev/v1/bot/self-summary.js';
import devV1SiteOverviewHandler from './dev/v1/site/overview.js';
import devV1StatsDistributionsHandler from './dev/v1/stats/distributions.js';
import devV1StatsGlobalHandler from './dev/v1/stats/global.js';
import devV1StatsItemHandler from './dev/v1/stats/item.js';
import devV1StatsItemsHandler from './dev/v1/stats/items.js';
import devV1StatsPoolHandler from './dev/v1/stats/pool.js';
import devV1StatsPoolsHandler from './dev/v1/stats/pools.js';
import devV1StatsRankingsHandler from './dev/v1/stats/rankings.js';
import devV1StatsTrendsHandler from './dev/v1/stats/trends.js';
import bindingChallengeHandler from './integrations/bindings/challenge.js';
import bindingMeHandler from './integrations/bindings/me.js';
import bindingRevokeHandler from './integrations/bindings/revoke.js';
import bindingVerifyHandler from './integrations/bindings/verify.js';
import botImportNotifyHandler from './integrations/bot/import-notify.js';
import historyAnomaliesHandler from './root/history-anomalies.js';
import lotterySiteHandler from 'open-lottery/api/router.js';

async function devV1BotShareCardHandler(req, res) {
  const mod = await import('./dev/v1/bot/share-card.js');
  return mod.default(req, res);
}

function normalizeRoutePath(path) {
  const pathname = String(path || '').split('?')[0] || '';
  if (!pathname || pathname === '/') {
    return pathname;
  }

  return pathname.replace(/\/+$/, '');
}

export const API_ROUTE_ENTRIES = [
  ['/api/account-recovery-request', accountRecoveryRequestHandler],
  ['/api/account-email-action', accountEmailActionHandler],
  ['/api/account-email-verify', accountEmailVerifyHandler],
  ['/api/account-gacha-data', accountGachaDataHandler],
  ['/api/account-last-seen', accountLastSeenHandler],
  ['/api/account-password-setup', accountPasswordSetupHandler],
  ['/api/account-profile', accountProfileHandler],
  ['/api/account-security-state', accountSecurityStateHandler],
  ['/api/admin', adminHandler],
  ['/api/admin-history-anomalies', adminHistoryAnomaliesHandler],
  ['/api/admin-summer-lottery-contacts', adminSummerLotteryContactsHandler],
  ['/api/admin-summer-lottery-operations', adminSummerLotteryOperationsHandler],
  ['/api/admin-summer-lottery-permissions', adminSummerLotteryPermissionsHandler],
  ['/api/admin-account-recovery', adminHandler],
  ['/api/admin-announcements', adminHandler],
  ['/api/admin-characters', adminCharactersHandler],
  ['/api/admin-pool-push', adminPoolPushHandler],
  ['/api/admin-pools', adminPoolsHandler],
  ['/api/admin-ops-automation', adminHandler],
  ['/api/admin-mail-alert', adminHandler],
  ['/api/admin-mail-budget-config', adminHandler],
  ['/api/admin-mail-outbox-drain', adminHandler],
  ['/api/admin-mail-smoke-test', adminHandler],
  ['/api/admin-public-cache-bump', adminHandler],
  ['/api/admin-reset-recovery-password', adminHandler],
  ['/api/admin-site-health', adminHandler],
  ['/api/admin-user-data', adminHandler],
  ['/api/admin-users', adminHandler],
  ['/api/admin-delete-user', adminHandler],
  ['/api/admin-user-reset-password', adminHandler],
  ['/api/announcements', announcementsHandler],
  ['/api/auth-account-status', authAccountStatusHandler],
  ['/api/auth-email-action', authEmailActionHandler],
  ['/api/auth/oauth/github/callback', githubOAuthCallbackHandler],
  ['/api/auth/oauth/github/start', githubOAuthStartHandler],
  ['/api/auth/oauth/linuxdo/callback', linuxdoOAuthCallbackHandler],
  ['/api/auth/oauth/linuxdo/start', linuxdoOAuthStartHandler],
  ['/api/auth/oauth/linuxdo/supabase-authorize', linuxdoSupabaseAuthorizeHandler],
  ['/api/auth/oauth/qq/callback', qqOAuthCallbackHandler],
  ['/api/auth/oauth/qq/start', qqOAuthStartHandler],
  ['/api/auth/identities/unlink', authIdentityUnlinkHandler],
  ['/api/auth/session', authSessionHandler],
  ['/api/auth/session/logout', authSessionLogoutHandler],
  ['/api/auth/session/revoke-all', authSessionRevokeAllHandler],
  ['/api/auth-pow-challenge', authPowChallengeHandler],
  ['/api/auth-rate-limit', authRateLimitHandler],
  ['/api/automation-feed', automationFeedHandler],
  ['/api/bootstrap', bootstrapHandler],
  ['/api/history-anomalies', historyAnomaliesHandler],
  ['/api/lottery', lotterySiteHandler],
  ['/api/lottery/enter', lotterySiteHandler],
  ['/api/lottery/health', lotterySiteHandler],
  ['/api/auth/sso/start', lotterySiteHandler],
  ['/api/auth/sso/callback', lotterySiteHandler],
  ['/api/auth/logout', lotterySiteHandler],
  ['/api/mail-delivery-feedback', mailDeliveryFeedbackHandler],
  ['/api/mail-inbound', mailInboundHandler],
  ['/api/mail-outbox-worker', mailOutboxWorkerHandler],
  ['/api/official-announcement-image', officialAnnouncementImageHandler],
  ['/api/ops-automation', opsAutomationHandler],
  ['/api/pool-rosters', poolRostersHandler],
  ['/api/public-cache-version', publicCacheVersionHandler],
  ['/api/puzzles', puzzlesHandler],
  ['/api/self-delete-account', selfDeleteAccountHandler],
  ['/api/status-admin', statusAdminHandler],
  ['/api/status-endpoint-probe', statusEndpointProbeHandler],
  ['/api/status-probe', statusProbeHandler],
  ['/api/site-status', siteStatusHandler],
  ['/api/stats', statsHandler],
  ['/api/summer-lottery-backend', summerLotteryBackendHandler],
  ['/api/summer-lottery-contact-retention', summerLotteryContactRetentionHandler],
  ['/api/summer-lottery-sso/start', summerLotterySsoStartHandler],
  ['/api/tickets', ticketsHandler],
  ['/api/tickets/reply', ticketReplyHandler],
  ['/api/wiki-asset-proxy', wikiAssetProxyHandler],
  ['/api/wiki-proxy', wikiProxyHandler],
  ['/api/dev/applications', devApplicationsHandler],
  ['/api/dev/applications/me', devApplicationsMeHandler],
  ['/api/dev/v1/announcements', devV1AnnouncementsHandler],
  ['/api/dev/v1/character', devV1CharacterHandler],
  ['/api/dev/v1/characters', devV1CharactersHandler],
  ['/api/dev/v1/meta', devV1MetaHandler],
  ['/api/dev/v1/openapi', devV1OpenApiHandler],
  ['/api/dev/v1/pool', devV1PoolHandler],
  ['/api/dev/v1/pools', devV1PoolsHandler],
  ['/api/dev/v1/bot/analysis', devV1BotAnalysisHandler],
  ['/api/dev/v1/bot/dashboard', devV1BotDashboardHandler],
  ['/api/dev/v1/bot/pool-detail', devV1BotPoolDetailHandler],
  ['/api/dev/v1/bot/pool-log', devV1BotPoolLogHandler],
  ['/api/dev/v1/bot/pools', devV1BotPoolsHandler],
  ['/api/dev/v1/bot/recent-pulls', devV1BotRecentPullsHandler],
  ['/api/dev/v1/bot/self-summary', devV1BotSelfSummaryHandler],
  ['/api/dev/v1/bot/share-card', devV1BotShareCardHandler],
  ['/api/dev/v1/site/overview', devV1SiteOverviewHandler],
  ['/api/dev/v1/stats/distributions', devV1StatsDistributionsHandler],
  ['/api/dev/v1/stats/global', devV1StatsGlobalHandler],
  ['/api/dev/v1/stats/item', devV1StatsItemHandler],
  ['/api/dev/v1/stats/items', devV1StatsItemsHandler],
  ['/api/dev/v1/stats/pool', devV1StatsPoolHandler],
  ['/api/dev/v1/stats/pools', devV1StatsPoolsHandler],
  ['/api/dev/v1/stats/rankings', devV1StatsRankingsHandler],
  ['/api/dev/v1/stats/trends', devV1StatsTrendsHandler],
  ['/api/integrations/bindings/challenge', bindingChallengeHandler],
  ['/api/integrations/bindings/me', bindingMeHandler],
  ['/api/integrations/bindings/revoke', bindingRevokeHandler],
  ['/api/integrations/bindings/verify', bindingVerifyHandler],
  ['/api/integrations/bot/import-notify', botImportNotifyHandler],
];

const API_ROUTE_MAP = new Map(
  API_ROUTE_ENTRIES.map(([path, handler]) => [normalizeRoutePath(path), handler])
);

export function getApiRouteEntries() {
  return API_ROUTE_ENTRIES.map(([path, handler]) => [normalizeRoutePath(path), handler]);
}

export function getApiRouteHandler(path) {
  return API_ROUTE_MAP.get(normalizeRoutePath(path)) || null;
}
