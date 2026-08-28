import { describe, expect, it } from 'vitest';
import { formatVisiblePoolRecord } from '../poolReadService.js';

describe('poolReadService public fallback contract', () => {
  it('does not restore creator identity fields from direct Supabase records', () => {
    const pool = formatVisiblePoolRecord({
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
