// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchSiteOverview } from '../_lib/siteOverview.js';
import {
  HOME_NEXT_VERSION_TARGET_CONFIG_KEY,
  HOME_VERSION_TIMELINE_CONFIG_KEY,
} from '../../src/utils/homeVersionTimeline.js';

function createAdminClient({
  siteConfigRows = [],
  poolRows = [],
} = {}) {
  const siteConfigQuery = {
    select: vi.fn(() => ({
      in: vi.fn(async (_column, keys) => ({
        data: siteConfigRows.filter((row) => keys.includes(row.key)),
        error: null,
      })),
    })),
  };

  return {
    from: vi.fn((table) => {
      if (table === 'site_config') {
        return siteConfigQuery;
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: vi.fn(async (name) => {
      if (name === 'get_app_visible_pools') {
        return { data: poolRows, error: null };
      }

      throw new Error(`Unexpected rpc: ${name}`);
    }),
    __queries: {
      siteConfigQuery,
    },
  };
}

describe('fetchSiteOverview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T00:00:00+08:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns next-version metadata from the shared homepage timeline config', async () => {
    const adminClient = createAdminClient({
      siteConfigRows: [
        {
          key: HOME_VERSION_TIMELINE_CONFIG_KEY,
          value: JSON.stringify([
            {
              id: 'current',
              name: '当前版本',
              name_en: 'Current',
              starts_at: '2026-06-01T12:00:00+08:00',
              ends_at: '2026-06-30T12:00:00+08:00',
            },
            {
              id: 'next',
              name: '下个版本',
              name_en: 'Next',
              starts_at: '2026-07-01T12:00:00+08:00',
            },
          ]),
        },
      ],
      poolRows: [
        {
          pool_id: 'pool-active',
          name: '当前卡池',
          name_en: 'Active Pool',
          type: 'limited_character',
          start_time: '2026-06-01T12:00:00+08:00',
          end_time: '2026-06-30T12:00:00+08:00',
          up_character: '测试角色',
        },
      ],
    });

    const overview = await fetchSiteOverview(adminClient, { siteUrl: 'https://example.test' });

    expect(adminClient.from).toHaveBeenCalledWith('site_config');
    expect(adminClient.__queries.siteConfigQuery.select).toHaveBeenCalledWith('key, value');
    expect(adminClient.rpc).toHaveBeenCalledWith('get_app_visible_pools');
    expect(overview.next_version).toMatchObject({
      target_at: '2026-07-01T12:00:00+08:00',
      name: '下个版本',
      name_en: 'Next',
      source: HOME_VERSION_TIMELINE_CONFIG_KEY,
    });
    expect(overview.current_version).toMatchObject({
      id: 'current',
      name: '当前版本',
      name_en: 'Current',
      starts_at: '2026-06-01T12:00:00+08:00',
      ends_at: '2026-06-30T12:00:00+08:00',
    });
    expect(overview.next_version.countdown.days).toBeGreaterThan(0);
    expect(overview.current_limited_pool).toMatchObject({
      pool_id: 'pool-active',
      name: '当前卡池',
      type: 'limited',
      status: 'active',
    });
  });

  it('keeps the legacy next-version target when no timeline config exists', async () => {
    const adminClient = createAdminClient({
      siteConfigRows: [
        {
          key: HOME_NEXT_VERSION_TARGET_CONFIG_KEY,
          value: '2026-06-20T12:00:00+08:00',
        },
      ],
    });

    const overview = await fetchSiteOverview(adminClient);

    expect(overview.next_version).toMatchObject({
      target_at: '2026-06-20T12:00:00+08:00',
      name: '寻遗散记',
      name_en: 'Lost Heirlooms',
      source: HOME_NEXT_VERSION_TARGET_CONFIG_KEY,
    });
  });
});
