import { describe, expect, it, vi } from 'vitest';

vi.mock('../../supabaseClient.js', () => ({
  supabase: null,
}));

vi.mock('../supabaseRequest.js', () => ({
  SUPABASE_RPC_TIMEOUT_MS: 30000,
  executeSupabaseRpc: vi.fn(),
  fetchJsonWithTimeout: vi.fn(),
  fetchWithTimeout: vi.fn(),
  isRetryableSupabaseError: vi.fn(() => false),
}));

vi.mock('../../utils/appLogger.js', () => ({
  appLogger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../utils/storageUtils.js', () => ({
  STORAGE_KEYS: {
    GLOBAL_SUMMARY_STATS_SNAPSHOT: 'global-summary',
    CHARACTER_RANKING_SNAPSHOT: 'character-ranking',
    CHARACTER_CATALOG_SNAPSHOT: 'character-catalog',
    USER_RANKING_SNAPSHOT_PREFIX: 'user-ranking:',
  },
  readStorageValue: vi.fn(() => null),
  writeStorageValue: vi.fn(),
}));

import { normalizeGlobalStats } from '../statsService.js';

describe('normalizeGlobalStats', () => {
  it('retains metric-specific workbench data through normalization and cache serialization', () => {
    const workbench = { status: 'ready', supplemental: { totalPulls: 80, sixStarCount: 1 }, rates: { sixStarNumerator: 3, sixStarDenominator: 180 }, coverage: { unknownFourStar: 1 } };
    const normalized = normalizeGlobalStats({ totalPulls: 100, byType: {}, workbench });
    expect(normalized.workbench).toEqual(workbench);
    expect(JSON.parse(JSON.stringify(normalized)).workbench).toEqual(workbench);
    expect(normalized.totalPulls).toBe(100);
    expect(normalized.counts[4]).toBeUndefined();
  });
  it('normalizes contributor activity and region summary fields', () => {
    const normalized = normalizeGlobalStats({
      totalPulls: 10,
      totalUsers: 8,
      totalContributors: 6,
      active_users_30d: '3',
      newUsers30d: '2',
      contributorsByRegion: {
        cn: '4',
        intl: 2,
      },
      contributor_activity: {
        windowDays: 30,
        activeUsers: 3,
        newUsers: 2,
      },
      byType: {},
    });

    expect(normalized.totalUsers).toBe(8);
    expect(normalized.totalContributors).toBe(6);
    expect(normalized.activeUsers30d).toBe(3);
    expect(normalized.newUsers30d).toBe(2);
    expect(normalized.contributorsByRegion).toEqual({
      cn: 4,
      intl: 2,
    });
    expect(normalized.contributorActivity).toMatchObject({
      windowDays: 30,
      activeUsers: 3,
      newUsers: 2,
    });
  });

  it('includes extra banner data in character aggregates', () => {
    const normalized = normalizeGlobalStats({
      totalPulls: 80,
      counts: { '6': 4, '6_std': 1, '5': 6, '4': 69 },
      byType: {
        extra: {
          total: 40,
          chargedPulls: 40,
          six: 2,
          sixStarLimited: 2,
          sixStarStandard: 0,
          avgPity: '20.0',
          avgPityTarget: '20.0',
          counts: { '6': 2, '6_std': 0, '5': 2, '4': 36 },
          distribution: [{ range: '1-10', limited: 1, standard: 0 }],
        },
        limited: {
          total: 30,
          chargedPulls: 25,
          six: 1,
          sixStarLimited: 1,
          sixStarStandard: 0,
          avgPity: '30.0',
          avgPityTarget: '30.0',
          avgPityExcludingFree: '25.0',
          counts: { '6': 1, '6_std': 0, '5': 1, '4': 28 },
          distribution: [{ range: '11-20', limited: 1, standard: 0 }],
        },
        standard: {
          total: 10,
          chargedPulls: 10,
          six: 1,
          sixStarLimited: 0,
          sixStarStandard: 1,
          avgPity: '10.0',
          counts: { '6': 0, '6_std': 1, '5': 0, '4': 9 },
          distribution: [{ range: '1-10', limited: 0, standard: 1 }],
        },
        weapon: {
          total: 5,
          chargedPulls: 5,
          six: 0,
          sixStarLimited: 0,
          sixStarStandard: 0,
          counts: { '6': 0, '6_std': 0, '5': 0, '4': 5 },
          distribution: [],
        },
      },
    });

    expect(normalized.byType.extra.total).toBe(40);
    expect(normalized.chargedCharacterPulls).toBe(75);
    expect(normalized.byType.character.total).toBe(80);
    expect(normalized.byType.character.chargedPulls).toBe(75);
    expect(normalized.byType.character.six).toBe(4);
    expect(normalized.byType.character.sixStarLimited).toBe(3);
    expect(normalized.byType.character.sixStarStandard).toBe(1);
    expect(normalized.byType.character.avgPity).toBe('20.0');
    expect(normalized.byType.character.avgPityTarget).toBe('23.3');
    expect(normalized.byType.character.avgPityUp).toBe('23.3');
    expect(normalized.byType.character.counts).toMatchObject({
      '6': 3,
      '6_std': 1,
      '5': 3,
      '4': 73,
    });
    expect(normalized.byType.character.distribution).toEqual([
      { range: '1-10', limited: 1, standard: 1, count: 2 },
      { range: '11-20', limited: 1, standard: 0, count: 1 },
      { range: '21-30', limited: 0, standard: 0, count: 0 },
      { range: '31-40', limited: 0, standard: 0, count: 0 },
      { range: '41-50', limited: 0, standard: 0, count: 0 },
      { range: '51-60', limited: 0, standard: 0, count: 0 },
      { range: '61-70', limited: 0, standard: 0, count: 0 },
      { range: '71-80', limited: 0, standard: 0, count: 0 },
    ]);
  });

  it('normalizes extra banner stats as target-only six-star data', () => {
    const normalized = normalizeGlobalStats({
      totalPulls: 2,
      counts: { '6': 1, '6_std': 0, '5': 0, '4': 1 },
      byType: {
        extra: {
          total: 2,
          chargedPulls: 2,
          six: 1,
          sixStarLimited: 1,
          sixStarStandard: 0,
          avgPity: '2.0',
          avgPityTarget: '2.0',
          counts: { '6': 1, '6_std': 0, '5': 0, '4': 1 },
          distribution: [{ range: '1-10', limited: 1, standard: 0 }],
        },
      },
    });

    expect(normalized.byType.extra.total).toBe(2);
    expect(normalized.byType.extra.sixStarLimited).toBe(1);
    expect(normalized.byType.extra.sixStarStandard).toBe(0);
    expect(normalized.byType.extra.avgPityTarget).toBe('2.0');
    expect(normalized.byType.character.total).toBe(2);
    expect(normalized.byType.character.sixStarLimited).toBe(1);
    expect(normalized.byType.character.sixStarStandard).toBe(0);
    expect(normalized.byType.character.avgPityTarget).toBe('2.0');
  });

  it('uses pool-type quota summaries for global classified resource cards', () => {
    const normalized = normalizeGlobalStats({
      totalPulls: 16,
      counts: { '6': 3, '6_std': 1, '5': 3, '4': 9 },
      byType: {
        extra: {
          total: 3,
          chargedPulls: 2,
          six: 1,
          sixStarLimited: 1,
          counts: { '6': 1, '6_std': 0, '5': 1, '4': 1 },
          quotaSummary: {
            aicQuotaDirect: 60,
            aicQuotaConvertible: 0,
            aicQuotaTotalPotential: 60,
            bondQuotaDirect: 3,
            endpointQuotaConvertible: 0,
          },
        },
        limited: {
          total: 5,
          chargedPulls: 5,
          six: 1,
          sixStarLimited: 1,
          counts: { '6': 1, '6_std': 0, '5': 1, '4': 3 },
          quotaSummary: {
            aicQuotaDirect: 90,
            aicQuotaConvertible: 20,
            aicQuotaTotalPotential: 110,
            bondQuotaDirect: 10,
            endpointQuotaConvertible: 0,
          },
        },
        standard: {
          total: 4,
          chargedPulls: 4,
          six: 1,
          sixStarStandard: 1,
          counts: { '6': 0, '6_std': 1, '5': 1, '4': 2 },
          quotaSummary: {
            aicQuotaDirect: 30,
            aicQuotaConvertible: 5,
            aicQuotaTotalPotential: 35,
            bondQuotaDirect: 0,
            endpointQuotaConvertible: 0,
          },
        },
        weapon: {
          total: 4,
          chargedPulls: 4,
          six: 1,
          counts: { '6': 1, '6_std': 0, '5': 0, '4': 3 },
        },
      },
    });

    expect(normalized.byType.extra.resources).toMatchObject({
      chargedCharacterPulls: 2,
      aicQuotaDirect: 60,
      bondQuotaDirect: 3,
    });
    expect(normalized.byType.limited.resources).toMatchObject({
      aicQuotaDirect: 90,
      aicQuotaConvertible: 20,
      aicQuotaTotalPotential: 110,
      bondQuotaDirect: 10,
    });
    expect(normalized.byType.standard.resources).toMatchObject({
      aicQuotaDirect: 30,
      aicQuotaConvertible: 5,
      aicQuotaTotalPotential: 35,
    });
    expect(normalized.byType.weapon.resources).toMatchObject({
      chargedWeaponPulls: 4,
      aicQuotaDirect: 50,
    });
  });
});
