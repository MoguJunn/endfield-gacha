import { describe, expect, it, vi } from 'vitest';

import {
  serializeHistoryForUpsert,
  serializePoolForUpsert,
  upsertHistoryRowsWithOptionalColumnFallback,
} from '../cloudDataWriteRows.js';

describe('cloudDataWriteRows', () => {
  it('serializes extra pool subtype fields and clears them for non-extra pools', () => {
    expect(serializePoolForUpsert({
      id: 'manual-extra',
      name: '重构申领',
      type: 'extra',
      extraSubtype: 'reconstruction',
      extraRuleProfile: 'reconstruction_weapon_v1',
      extraSeriesKey: 'reconstruction-weapon-a',
      extraSeriesPhase: '2',
    }, 'user-1')).toMatchObject({
      type: 'extra',
      extra_subtype: 'reconstruction_claim',
      extra_rule_profile: 'reconstruction_weapon_v1',
      extra_series_key: 'reconstruction-weapon-a',
      extra_series_phase: 2,
    });

    expect(serializePoolForUpsert({
      id: 'limited-test',
      name: '限定池',
      type: 'limited',
      extra_subtype: 'special',
      extra_rule_profile: 'brilliance_festival_v1',
    }, 'user-1')).toMatchObject({
      type: 'limited',
      extra_subtype: null,
      extra_rule_profile: null,
      extra_series_key: null,
      extra_series_phase: null,
    });
  });

  it('stores server id and normalized region on history rows', () => {
    const cnRow = serializeHistoryForUpsert({
      id: '1001',
      poolId: 'special_1_2_1',
      rarity: 6,
      seqId: '1',
      gameUid: '10000001',
      serverId: '1',
      serverRegion: '官服',
      isInfoBook: true,
      timestamp: '2026-06-05T12:00:00.000Z',
    }, 'user-1');
    const intlRow = serializeHistoryForUpsert({
      id: '1002',
      poolId: 'special_1_2_2',
      rarity: 5,
      seqId: '2',
      gameUid: '20000001',
      server_id: '3',
      region: 'global',
      timestamp: '2026-06-05T12:01:00.000Z',
    }, 'user-1');

    expect(cnRow).toMatchObject({
      user_id: 'user-1',
      server_id: '1',
      region: 'cn',
      is_info_book: true,
    });
    expect(intlRow).toMatchObject({
      user_id: 'user-1',
      server_id: '3',
      region: 'intl',
    });
  });

  it('preserves text record ids without numeric coercion', () => {
    const row = serializeHistoryForUpsert({
      id: '00123-official',
      poolId: 'special_1_2_1',
      rarity: 5,
      seqId: '9007199254740993',
      gameUid: '10000001',
      serverId: '1',
      timestamp: '2026-06-05T12:00:00.000Z',
    }, 'user-1');

    expect(row.record_id).toBe('00123-official');
  });

  it('retries history upserts without unavailable optional columns', async () => {
    const rows = [{
      user_id: 'user-1',
      record_id: 1001,
      pool_id: 'special_1_2_1',
      rarity: 6,
      character_id: 'char_1',
      server_id: '2',
      region: 'intl',
      game_uid: '20000001',
      seq_id: '1',
    }];
    const executeUpsert = vi.fn(async (pendingRows) => {
      if (executeUpsert.mock.calls.length === 1) {
        return { error: { message: "Could not find the 'server_id' column of 'history' in the schema cache" } };
      }
      if (executeUpsert.mock.calls.length === 2) {
        return { error: { message: "Could not find the 'region' column of 'history' in the schema cache" } };
      }
      return { data: pendingRows, error: null };
    });

    await upsertHistoryRowsWithOptionalColumnFallback(rows, executeUpsert);

    expect(executeUpsert).toHaveBeenCalledTimes(3);
    expect(executeUpsert.mock.calls[0][0][0]).toMatchObject({
      character_id: 'char_1',
      server_id: '2',
      region: 'intl',
    });
    expect(executeUpsert.mock.calls[1][0][0]).toMatchObject({
      character_id: 'char_1',
      region: 'intl',
    });
    expect(executeUpsert.mock.calls[1][0][0]).not.toHaveProperty('server_id');
    expect(executeUpsert.mock.calls[2][0][0]).toMatchObject({
      character_id: 'char_1',
    });
    expect(executeUpsert.mock.calls[2][0][0]).not.toHaveProperty('server_id');
    expect(executeUpsert.mock.calls[2][0][0]).not.toHaveProperty('region');
    expect(executeUpsert.mock.calls[2][1]).toBe('user_id,game_uid,pool_id,seq_id');
  });

  it('falls back to record id when server-scoped conflict targets are unavailable', async () => {
    const rows = [{
      user_id: 'user-1',
      record_id: 1001,
      pool_id: 'special_1_2_1',
      rarity: 6,
      character_id: 'char_1',
      server_id: '2',
      region: 'intl',
      game_uid: '20000001',
      seq_id: '1',
    }];
    const missingConflictTarget = {
      code: '42P10',
      message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification',
    };
    const executeUpsert = vi.fn(async (pendingRows) => {
      if (executeUpsert.mock.calls.length <= 2) {
        return { error: missingConflictTarget };
      }
      return { data: pendingRows, error: null };
    });

    await upsertHistoryRowsWithOptionalColumnFallback(rows, executeUpsert);

    expect(executeUpsert).toHaveBeenCalledTimes(3);
    expect(executeUpsert.mock.calls[0][1]).toBe('user_id,game_uid,server_scope,pool_id,seq_id');
    expect(executeUpsert.mock.calls[1][1]).toBe('user_id,game_uid,pool_id,seq_id');
    expect(executeUpsert.mock.calls[2][1]).toBe('user_id,record_id');
    expect(executeUpsert.mock.calls[2][0][0]).toMatchObject({
      record_id: 1001,
      server_id: '2',
      region: 'intl',
      game_uid: '20000001',
      seq_id: '1',
    });
  });
});
