import { describe, expect, it, vi } from 'vitest';

const network = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../../../services/publicResourceClient', () => ({ fetchPublicApiJson: network.fetch }));

import { __internal as notificationBadgeInternals } from '../useNotificationBadges.js';

describe('useNotificationBadges announcement normalization', () => {
  it('shares announcement URLs within an hour while keeping the precise display cutoff', async () => {
    network.fetch.mockResolvedValue({ success: true, data: {} });
    await notificationBadgeInternals.loadAnnouncementsFromApi({ cutoffIso: '2026-10-25T12:01:02.345Z' });
    await notificationBadgeInternals.loadAnnouncementsFromApi({ cutoffIso: '2026-10-25T12:59:59.999Z' });
    const calls = network.fetch.mock.calls.slice(-2);
    expect(calls[0][1].params).toEqual(calls[1][1].params);
    expect(calls[0][1].params.cutoffIso).toBe('2026-10-25T12:00:00.000Z');
    const records = notificationBadgeInternals.buildGameAnnouncementDisplaySet({
      recentRecords: [{ source_id: 'test', published_at: '2026-10-25T12:00:30Z' }],
      cutoffIso: '2026-10-25T12:01:02.345Z',
    });
    expect(records[0].is_recent_history_fallback).toBe(true);
  });
  it('loads the official feed through the shared public cache without automatic retries', async () => {
    network.fetch.mockResolvedValue({ success: true, records: [] });
    expect(await notificationBadgeInternals.loadOfficialAnnouncementsFeed()).toEqual([]);
    expect(network.fetch).toHaveBeenLastCalledWith('/api/automation-feed', expect.objectContaining({
      params: { job: 'official-announcements' }, retries: 0, memoryTtlMs: 300000,
    }));
  });
  it('removes the legacy local placeholder announcement before rendering site notices', () => {
    const records = notificationBadgeInternals.normalizeSiteAnnouncementRecords([
      {
        id: '1',
        title: '欢迎使用抽卡分析器',
        is_active: true,
        priority: 999,
        updated_at: '2026-06-05T00:00:00.000Z',
      },
      {
        id: 'real-low',
        title: '真实公告 B',
        is_active: true,
        priority: 1,
        updated_at: '2026-06-04T00:00:00.000Z',
      },
      {
        id: 'real-high',
        title: '真实公告 A',
        is_active: true,
        priority: 10,
        updated_at: '2026-06-03T00:00:00.000Z',
      },
      {
        id: 'inactive',
        title: '已停用公告',
        is_active: false,
        priority: 20,
        updated_at: '2026-06-06T00:00:00.000Z',
      },
    ]);

    expect(records.map(record => record.id)).toEqual(['real-high', 'real-low']);
  });
});
