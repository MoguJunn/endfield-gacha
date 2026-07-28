// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { getApiRouteEntries, getApiRouteHandler } from '../_routes/index.js';
import { buildDevApiOpenApiSpec } from '../_lib/devApiOpenApi.js';

const OFFICIAL_BOT_PATHS = [
  '/api/dev/v1/bot/analysis',
  '/api/dev/v1/bot/dashboard',
  '/api/dev/v1/bot/pool-detail',
  '/api/dev/v1/bot/pool-log',
  '/api/dev/v1/bot/pools',
  '/api/dev/v1/bot/recent-pulls',
  '/api/dev/v1/bot/self-summary',
  '/api/dev/v1/bot/share-card',
];

const INTERNAL_OPERATION_PATHS = [
  '/api/admin-account-recovery',
  '/api/admin-announcements',
  '/api/admin-characters',
  '/api/admin-mail-alert',
  '/api/admin-mail-budget-config',
  '/api/admin-mail-outbox-drain',
  '/api/admin-mail-smoke-test',
  '/api/admin-pool-push',
  '/api/admin-pools',
  '/api/admin-site-health',
  '/api/admin-summer-lottery-contacts',
  '/api/admin-summer-lottery-operations',
  '/api/admin-summer-lottery-permissions',
  '/api/admin-user-data',
  '/api/mail-delivery-feedback',
  '/api/mail-inbound',
  '/api/mail-outbox-worker',
  '/api/status-admin',
  '/api/status-endpoint-probe',
  '/api/status-probe',
  '/api/summer-lottery-contact-retention',
];

const AUTH_OPERATION_PATHS = [
  '/api/auth-email-action',
  '/api/auth/oauth/github/callback',
  '/api/auth/oauth/github/start',
  '/api/auth/oauth/linuxdo/callback',
  '/api/auth/oauth/linuxdo/start',
  '/api/auth/oauth/linuxdo/supabase-authorize',
  '/api/auth/oauth/qq/callback',
  '/api/auth/oauth/qq/start',
  '/api/auth/identities/unlink',
  '/api/auth/session',
  '/api/auth/session/logout',
  '/api/summer-lottery-backend',
  '/api/summer-lottery-sso/start',
];

const USER_OPERATION_PATHS = [
  '/api/account-email-action',
  '/api/account-email-verify',
  '/api/account-gacha-data',
  '/api/account-last-seen',
  '/api/account-password-setup',
  '/api/account-profile',
  '/api/tickets',
  '/api/tickets/reply',
];

const PUBLIC_STATUS_PATHS = ['/api/site-status'];

describe('API route registry', () => {
  it('registers every public v1 OpenAPI path in the single-function router map', () => {
    const openApiPaths = Object.keys(buildDevApiOpenApiSpec().paths);
    const routeEntries = new Map(getApiRouteEntries());

    expect(openApiPaths.length).toBeGreaterThan(0);
    openApiPaths.forEach((path) => {
      expect(routeEntries.has(path)).toBe(true);
      expect(getApiRouteHandler(path)).toEqual(expect.any(Function));
    });
  });

  it('registers all official bot private v1 endpoints', () => {
    const routeEntries = new Map(getApiRouteEntries());

    OFFICIAL_BOT_PATHS.forEach((path) => {
      expect(routeEntries.has(path)).toBe(true);
      expect(getApiRouteHandler(path)).toEqual(expect.any(Function));
    });
  });

  it('registers internal operation endpoints used by workers and providers', () => {
    const routeEntries = new Map(getApiRouteEntries());

    INTERNAL_OPERATION_PATHS.forEach((path) => {
      expect(routeEntries.has(path)).toBe(true);
      expect(getApiRouteHandler(path)).toEqual(expect.any(Function));
    });
  });

  it('registers same-origin auth operation endpoints', () => {
    const routeEntries = new Map(getApiRouteEntries());

    AUTH_OPERATION_PATHS.forEach((path) => {
      expect(routeEntries.has(path)).toBe(true);
      expect(getApiRouteHandler(path)).toEqual(expect.any(Function));
    });
  });

  it('registers authenticated user operation endpoints', () => {
    const routeEntries = new Map(getApiRouteEntries());

    USER_OPERATION_PATHS.forEach((path) => {
      expect(routeEntries.has(path)).toBe(true);
      expect(getApiRouteHandler(path)).toEqual(expect.any(Function));
    });
  });

  it('registers public service status endpoints', () => {
    const routeEntries = new Map(getApiRouteEntries());

    PUBLIC_STATUS_PATHS.forEach((path) => {
      expect(routeEntries.has(path)).toBe(true);
      expect(getApiRouteHandler(path)).toEqual(expect.any(Function));
    });
  });
});
