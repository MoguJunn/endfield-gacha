import { lazyApiRoute } from '../_lib/lazyApiRoute.js';

// Keep literal import paths so the serverless packager includes every route,
// without parsing and initializing unrelated services on each cold instance.
const accountRecoveryRequestHandler = lazyApiRoute(() => import('./root/account-recovery-request.js'));
const accountEmailActionHandler = lazyApiRoute(() => import('./root/account-email-action.js'));
const accountEmailMergeHandler = lazyApiRoute(() => import('./root/account-email-merge.js'));
const accountEmailVerifyHandler = lazyApiRoute(() => import('./root/account-email-verify.js'));
const accountGachaDataHandler = lazyApiRoute(() => import('./root/account-gacha-data.js'));
const dataWorkbenchHandler = lazyApiRoute(() => import('./root/data-workbench.js'));
const accountLastSeenHandler = lazyApiRoute(() => import('./root/account-last-seen.js'));
const accountPasswordSetupHandler = lazyApiRoute(() => import('./root/account-password-setup.js'));
const accountProfileHandler = lazyApiRoute(() => import('./root/account-profile.js'));
const accountSecurityStateHandler = lazyApiRoute(() => import('./root/account-security-state.js'));
const adminHandler = lazyApiRoute(() => import('./root/admin.js'));
const adminHistoryAnomaliesHandler = lazyApiRoute(() => import('./root/admin-history-anomalies.js'));
const adminSummerLotteryContactsHandler = lazyApiRoute(() => import('./root/admin-summer-lottery-contacts.js'));
const adminSummerLotteryOperationsHandler = lazyApiRoute(() => import('./root/admin-summer-lottery-operations.js'));
const adminSummerLotteryPermissionsHandler = lazyApiRoute(() => import('./root/admin-summer-lottery-permissions.js'));
const adminCharactersHandler = lazyApiRoute(() => import('./root/admin-characters.js'));
const adminPoolPushHandler = lazyApiRoute(() => import('./root/admin-pool-push.js'));
const adminPoolsHandler = lazyApiRoute(() => import('./root/admin-pools.js'));
const announcementsHandler = lazyApiRoute(() => import('./root/announcements.js'));
const authEmailActionHandler = lazyApiRoute(() => import('./root/auth-email-action.js'));
const authIdentityUnlinkHandler = lazyApiRoute(() => import('./root/auth-identities.js'), 'authIdentityUnlinkHandler');
const authSessionHandler = lazyApiRoute(() => import('./root/auth-session.js'));
const authSessionLogoutHandler = lazyApiRoute(() => import('./root/auth-session.js'), 'authSessionLogoutHandler');
const authSessionRevokeAllHandler = lazyApiRoute(() => import('./root/auth-session.js'), 'authSessionRevokeAllHandler');
const githubOAuthCallbackHandler = lazyApiRoute(() => import('./root/auth-oauth.js'), 'githubOAuthCallbackHandler');
const githubOAuthStartHandler = lazyApiRoute(() => import('./root/auth-oauth.js'), 'githubOAuthStartHandler');
const linuxdoOAuthCallbackHandler = lazyApiRoute(() => import('./root/auth-oauth.js'), 'linuxdoOAuthCallbackHandler');
const linuxdoSupabaseAuthorizeHandler = lazyApiRoute(() => import('./root/auth-oauth.js'), 'linuxdoSupabaseAuthorizeHandler');
const linuxdoOAuthStartHandler = lazyApiRoute(() => import('./root/auth-oauth.js'), 'linuxdoOAuthStartHandler');
const qqOAuthCallbackHandler = lazyApiRoute(() => import('./root/auth-oauth.js'), 'qqOAuthCallbackHandler');
const qqOAuthStartHandler = lazyApiRoute(() => import('./root/auth-oauth.js'), 'qqOAuthStartHandler');
const authAccountStatusHandler = lazyApiRoute(() => import('./root/auth-account-status.js'));
const authPowChallengeHandler = lazyApiRoute(() => import('./root/auth-pow-challenge.js'));
const authRateLimitHandler = lazyApiRoute(() => import('./root/auth-rate-limit.js'));
const automationFeedHandler = lazyApiRoute(() => import('./root/automation-feed.js'));
const bootstrapHandler = lazyApiRoute(() => import('./root/bootstrap.js'));
const maintenanceHandler = lazyApiRoute(() => import('./root/maintenance.js'));
const mailInboundHandler = lazyApiRoute(() => import('./root/mail-inbound.js'));
const mailDeliveryFeedbackHandler = lazyApiRoute(() => import('./root/mail-delivery-feedback.js'));
const mailOutboxWorkerHandler = lazyApiRoute(() => import('./root/mail-outbox-worker.js'));
const officialAnnouncementImageHandler = lazyApiRoute(() => import('./root/official-announcement-image.js'));
const opsAutomationHandler = lazyApiRoute(() => import('./root/ops-automation.js'));
const personalAnalysisWorkerHandler = lazyApiRoute(() => import('./root/personal-analysis-worker.js'));
const poolRostersHandler = lazyApiRoute(() => import('./root/pool-rosters.js'));
const publicCacheVersionHandler = lazyApiRoute(() => import('./root/public-cache-version.js'));
const puzzlesHandler = lazyApiRoute(() => import('./root/puzzles.js'));
const selfDeleteAccountHandler = lazyApiRoute(() => import('./root/self-delete-account.js'));
const statusAdminHandler = lazyApiRoute(() => import('./root/status-admin.js'));
const statusEndpointProbeHandler = lazyApiRoute(() => import('./root/status-endpoint-probe.js'));
const statusProbeHandler = lazyApiRoute(() => import('./root/status-probe.js'));
const siteStatusHandler = lazyApiRoute(() => import('./root/site-status.js'));
const statsHandler = lazyApiRoute(() => import('./root/stats.js'));
const summerLotteryBackendHandler = lazyApiRoute(() => import('./root/summer-lottery-backend.js'));
const summerLotteryContactRetentionHandler = lazyApiRoute(() => import('./root/summer-lottery-contact-retention.js'));
const summerLotterySsoStartHandler = lazyApiRoute(() => import('./root/summer-lottery-sso.js'));
const ticketReplyHandler = lazyApiRoute(() => import('./root/ticket-reply.js'));
const ticketsHandler = lazyApiRoute(() => import('./root/tickets.js'));
const wikiAssetProxyHandler = lazyApiRoute(() => import('./root/wiki-asset-proxy.js'));
const wikiProxyHandler = lazyApiRoute(() => import('./root/wiki-proxy.js'));
const devApplicationsHandler = lazyApiRoute(() => import('./dev/applications/index.js'));
const devApplicationsMeHandler = lazyApiRoute(() => import('./dev/applications/me.js'));
const devV1AnnouncementsHandler = lazyApiRoute(() => import('./dev/v1/announcements.js'));
const devV1CharacterHandler = lazyApiRoute(() => import('./dev/v1/character.js'));
const devV1CharactersHandler = lazyApiRoute(() => import('./dev/v1/characters.js'));
const devV1MetaHandler = lazyApiRoute(() => import('./dev/v1/meta.js'));
const devV1OpenApiHandler = lazyApiRoute(() => import('./dev/v1/openapi.js'));
const devV1PoolHandler = lazyApiRoute(() => import('./dev/v1/pool.js'));
const devV1PoolsHandler = lazyApiRoute(() => import('./dev/v1/pools.js'));
const devV1BotAnalysisHandler = lazyApiRoute(() => import('./dev/v1/bot/analysis.js'));
const devV1BotDashboardHandler = lazyApiRoute(() => import('./dev/v1/bot/dashboard.js'));
const devV1BotPoolDetailHandler = lazyApiRoute(() => import('./dev/v1/bot/pool-detail.js'));
const devV1BotPoolLogHandler = lazyApiRoute(() => import('./dev/v1/bot/pool-log.js'));
const devV1BotPoolsHandler = lazyApiRoute(() => import('./dev/v1/bot/pools.js'));
const devV1BotRecentPullsHandler = lazyApiRoute(() => import('./dev/v1/bot/recent-pulls.js'));
const devV1BotSelfSummaryHandler = lazyApiRoute(() => import('./dev/v1/bot/self-summary.js'));
const devV1BotShareCardHandler = lazyApiRoute(() => import('./dev/v1/bot/share-card.js'));
const devV1SiteOverviewHandler = lazyApiRoute(() => import('./dev/v1/site/overview.js'));
const devV1StatsDistributionsHandler = lazyApiRoute(() => import('./dev/v1/stats/distributions.js'));
const devV1StatsGlobalHandler = lazyApiRoute(() => import('./dev/v1/stats/global.js'));
const devV1StatsItemHandler = lazyApiRoute(() => import('./dev/v1/stats/item.js'));
const devV1StatsItemsHandler = lazyApiRoute(() => import('./dev/v1/stats/items.js'));
const devV1StatsPoolHandler = lazyApiRoute(() => import('./dev/v1/stats/pool.js'));
const devV1StatsPoolsHandler = lazyApiRoute(() => import('./dev/v1/stats/pools.js'));
const devV1StatsRankingsHandler = lazyApiRoute(() => import('./dev/v1/stats/rankings.js'));
const devV1StatsTrendsHandler = lazyApiRoute(() => import('./dev/v1/stats/trends.js'));
const bindingChallengeHandler = lazyApiRoute(() => import('./integrations/bindings/challenge.js'));
const bindingMeHandler = lazyApiRoute(() => import('./integrations/bindings/me.js'));
const bindingRevokeHandler = lazyApiRoute(() => import('./integrations/bindings/revoke.js'));
const bindingVerifyHandler = lazyApiRoute(() => import('./integrations/bindings/verify.js'));
const botImportNotifyHandler = lazyApiRoute(() => import('./integrations/bot/import-notify.js'));
const historyAnomaliesHandler = lazyApiRoute(() => import('./root/history-anomalies.js'));
const lotterySiteHandler = lazyApiRoute(() => import('open-lottery/api/router.js'));

function normalizeRoutePath(path) {
  const pathname = String(path || '').split('?')[0] || '';
  if (!pathname || pathname === '/') {
    return pathname;
  }

  return pathname.replace(/\/+$/, '');
}

export const API_ROUTE_ENTRIES = [
  ['/api/maintenance', maintenanceHandler],
  ['/api/account-recovery-request', accountRecoveryRequestHandler],
  ['/api/account-email-action', accountEmailActionHandler],
  ['/api/account-email-merge', accountEmailMergeHandler],
  ['/api/account-email-verify', accountEmailVerifyHandler],
  ['/api/account-gacha-data', accountGachaDataHandler],
  ['/api/data-workbench', dataWorkbenchHandler],
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
  ['/api/personal-analysis-worker', personalAnalysisWorkerHandler],
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
