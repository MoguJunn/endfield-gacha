import { describe, expect, it, vi } from 'vitest';
import { __internal } from '../_routes/root/bootstrap.js';
import { PUBLIC_SITE_CONFIG_KEYS } from '../../shared/publicSiteConfig.js';

describe('/api/bootstrap public contract', () => {
  it('queries and returns only explicitly public site config keys', async () => {
    const inMock = vi.fn(async () => ({
      data: [
        { key: 'site_version', value: 'v-safe' },
        { key: 'mail_runtime_config', value: '{"secret":"hidden"}' },
      ],
      error: null,
    }));
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ in: inMock })),
      })),
    };

    await expect(__internal.fetchSiteConfig(supabase)).resolves.toEqual({ site_version: 'v-safe' });
    expect(inMock).toHaveBeenCalledWith('key', PUBLIC_SITE_CONFIG_KEYS);
  });

  it('drops creator identifiers and unsafe banners from public pools', () => {
    const pool = __internal.formatVisiblePoolRecord({
      pool_id: 'pool-1',
      name: 'Pool',
      type: 'limited',
      user_id: 'private-user',
      creator_username: 'private-name',
      creator_role: 'super_admin',
      banner_url: 'https://127.0.0.1/private.png',
    });

    expect(pool).toMatchObject({ id: 'pool-1', name: 'Pool', banner_url: null });
    expect(pool).not.toHaveProperty('user_id');
    expect(pool).not.toHaveProperty('creator_username');
    expect(pool).not.toHaveProperty('creator_role');
  });
});
