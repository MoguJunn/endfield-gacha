// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { __internal } from '../bootstrapService.js';
import { STORAGE_KEYS } from '../../utils/storageUtils.js';

describe('public bootstrap snapshot security', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('filters private config, ownership fields, and unsafe media before caching', () => {
    const normalized = __internal.normalizeBootstrapPayload({
      siteConfig: {
        site_version: 'v-safe',
        mail_runtime_config: '{"secret":"hidden"}',
      },
      pools: [{
        id: 'pool-1',
        name: 'Pool',
        user_id: 'private-user',
        creator_role: 'super_admin',
        banner_url: 'https://127.0.0.1/private.png',
      }],
    });

    expect(normalized.siteConfig).toEqual({ site_version: 'v-safe' });
    expect(normalized.pools).toEqual([{ id: 'pool-1', name: 'Pool', banner_url: null }]);
  });

  it('removes legacy snapshots and only reads versioned sanitized data', () => {
    window.localStorage.setItem(STORAGE_KEYS.PUBLIC_BOOTSTRAP_SNAPSHOT_V2, JSON.stringify({
      data: { siteConfig: { mail_runtime_config: 'secret' } },
    }));

    expect(__internal.readPersistedBootstrapSnapshot()).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.PUBLIC_BOOTSTRAP_SNAPSHOT_V2)).toBeNull();

    __internal.writePersistedBootstrapSnapshot({
      siteConfig: { site_version: 'v-safe', mail_runtime_config: 'secret' },
      pools: [{ id: 'pool-1', name: 'Pool', user_id: 'private-user' }],
    });

    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.PUBLIC_BOOTSTRAP_SNAPSHOT_V3));
    expect(raw.schemaVersion).toBe(__internal.BOOTSTRAP_SNAPSHOT_SCHEMA_VERSION);
    expect(raw.data).toEqual({
      siteConfig: { site_version: 'v-safe' },
      pools: [{ id: 'pool-1', name: 'Pool' }],
    });
    expect(__internal.readPersistedBootstrapSnapshot()?.data).toEqual(raw.data);
  });
});
