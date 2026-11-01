// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const source = vi.hoisted(() => ({ game: vi.fn() }));
vi.mock('../_lib/gameBulletinFeed.js', () => ({ buildGameBulletinSourceRecords: source.game }));
vi.mock('../_lib/authAdmin.js', () => ({ getSupabaseAdminClient: () => null }));

const response = () => ({ setHeader: vi.fn(), getHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() });
beforeEach(() => {
  vi.resetModules(); source.game.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: { list: [] } }) }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('official announcement collection', () => {
  it('shares upstream collection for a cold burst and reuses the completed feed', async () => {
    let release;
    source.game.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const { handleOfficialAnnouncementsFeed } = await import('../_lib/officialAnnouncementsFeed.js');
    const responses = Array.from({ length: 20 }, response);
    const requests = responses.map(res => handleOfficialAnnouncementsFeed({ method: 'GET', headers: {} }, res));
    expect(source.game).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    release([{ source_id: 'game-bulletin:test', title: '公告', raw_content: '<p>内容</p>',
      source_url: 'https://example.com/news', published_at: '2026-11-01T00:00:00Z' }]);
    await Promise.all(requests);
    for (const res of responses) {
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].records).toHaveLength(1);
    }
    const warm = response();
    await handleOfficialAnnouncementsFeed({ method: 'GET', headers: {} }, warm);
    expect(warm.json.mock.calls[0][0].cached).toBe(true);
    expect(source.game).toHaveBeenCalledOnce();
  });
  it('releases a failed collection so the next request can recover', async () => {
    source.game.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([
      { source_id: 'game-bulletin:test', title: '公告', raw_content: '<p>内容</p>', source_url: 'https://example.com/news' },
    ]);
    const { handleOfficialAnnouncementsFeed } = await import('../_lib/officialAnnouncementsFeed.js');
    const first = response(), second = response();
    await handleOfficialAnnouncementsFeed({ method: 'GET', headers: {} }, first);
    expect(first.status).toHaveBeenCalledWith(500);
    await handleOfficialAnnouncementsFeed({ method: 'GET', headers: {} }, second);
    expect(second.status).toHaveBeenCalledWith(200);
    expect(source.game).toHaveBeenCalledTimes(2);
  });
});
