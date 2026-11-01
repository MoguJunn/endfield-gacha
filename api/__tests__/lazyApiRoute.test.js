// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lazyApiRoute } from '../_lib/lazyApiRoute.js';

const routes = vi.hoisted(() => ({ maintenanceLoads: 0, statsLoads: 0, authLoads: 0,
  maintenance: vi.fn(), logout: vi.fn() }));
vi.mock('../_routes/root/maintenance.js', () => {
  routes.maintenanceLoads++;
  return { default: routes.maintenance };
});
vi.mock('../_routes/root/stats.js', () => {
  routes.statsLoads++;
  return { default: vi.fn() };
});
vi.mock('../_routes/root/auth-session.js', () => {
  routes.authLoads++;
  return { default: vi.fn(), authSessionLogoutHandler: routes.logout };
});

describe('API module initialization', () => {
  it('shares one initialization across concurrent requests without sharing request data', async () => {
    let resolveModule;
    const handler = vi.fn((req, res) => res.json(req.owner));
    const importer = vi.fn(() => new Promise(resolve => { resolveModule = resolve; }));
    const lazy = lazyApiRoute(importer);
    expect(importer).not.toHaveBeenCalled();
    const first = { json: vi.fn() }, second = { json: vi.fn() };
    const requests = [lazy({ owner: 'one' }, first), lazy({ owner: 'two' }, second)];
    expect(importer).toHaveBeenCalledOnce();
    resolveModule({ default: handler });
    await Promise.all(requests);
    expect(first.json).toHaveBeenCalledWith('one');
    expect(second.json).toHaveBeenCalledWith('two');
    await lazy({ owner: 'three' }, first);
    expect(importer).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('preserves errors from the selected handler', async () => {
    const error = new Error('unauthorized');
    const lazy = lazyApiRoute(async () => ({ named: () => { throw error; } }), 'named');
    await expect(lazy({}, {})).rejects.toBe(error);
  });
});

describe('single-function route isolation', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it('does not initialize business modules for route lookup or missing paths', async () => {
    const { default: router } = await import('../router.js');
    expect(routes.maintenanceLoads + routes.statsLoads + routes.authLoads).toBe(0);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await router({ url: '/api/missing' }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(routes.maintenanceLoads + routes.statsLoads + routes.authLoads).toBe(0);
  });

  it('loads only maintenance and leaves statistics/auth initialization untouched', async () => {
    const { default: router } = await import('../router.js');
    const req = { method: 'GET', url: '/api/router?__path=/maintenance&v=1' }, res = {};
    await router(req, res);
    expect(routes.maintenance).toHaveBeenCalledWith(req, res);
    expect(req.url).toBe('/api/maintenance?v=1');
    expect(routes.maintenanceLoads).toBe(1);
    expect(routes.statsLoads + routes.authLoads).toBe(0);
  });

  it('dispatches named auth exports and preserves the rewritten query', async () => {
    const { default: router } = await import('../router.js');
    const req = { method: 'POST', url: '/api/router?__path=/auth/session/logout&v=1' }, res = {};
    await router(req, res);
    expect(routes.logout).toHaveBeenCalledWith(req, res);
    expect(req.url).toBe('/api/auth/session/logout?v=1');
    expect(req.query).toEqual({ v: '1' });
    expect(routes.statsLoads).toBe(0);
  });
});
