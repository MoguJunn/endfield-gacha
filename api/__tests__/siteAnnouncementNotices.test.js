// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), result: { data: [], error: null } }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('../_lib/supabaseEnv.js', () => ({ resolveSupabaseUrl: () => 'https://db.test', resolveSupabaseServerKey: () => 'key' }));

function response() {
  return { headers: {}, setHeader(name, value) { this.headers[name] = value; },
    getHeader(name) { return this.headers[name]; }, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
}

describe('网站公告轻量检查', () => {
  let handler;
  let from;
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    mocks.result = { data: [{ id: 'notice', source_id: null, priority: 100 }], error: null };
    from = vi.fn(table => {
      expect(table).toBe('announcements');
      const query = { select() { return this; }, eq() { return this; }, is() { return this; }, order() { return this; },
        then(resolve, reject) { return Promise.resolve(mocks.result).then(resolve, reject); } };
      return query;
    });
    mocks.createClient.mockReturnValue({ from });
    handler = (await import('../_routes/root/announcements.js')).default;
  });
  afterEach(() => { vi.useRealTimers(); });

  it('只读取网站公告，共享并发与15秒缓存，过期才重新查询', async () => {
    const req = { method: 'GET', url: '/api/announcements?scope=site', headers: {} };
    const first = response();
    const second = response();
    await Promise.all([handler(req, first), handler(req, second)]);
    expect(first.body).toEqual({ success: true, data: { siteAnnouncements: [{ id: 'notice', source_id: null, priority: 100 }] } });
    expect(second.body).toEqual(first.body);
    expect(from).toHaveBeenCalledTimes(2);
    expect(first.headers['Cache-Control']).toBe('public, max-age=15, s-maxage=15, must-revalidate');
    await handler(req, response());
    expect(from).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15001);
    await handler(req, response());
    expect(from).toHaveBeenCalledTimes(4);
  });

  it('读取失败返回不可缓存的503，不以空成功响应覆盖现有公告', async () => {
    mocks.result = { data: null, error: new Error('private database details') };
    const res = response();
    await handler({ method: 'GET', url: '/api/announcements?scope=site', headers: {} }, res);
    expect(res.statusCode).toBe(503);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.body).toEqual({ success: false, error: 'Announcements unavailable' });
  });
});
