import { describe, expect, it } from 'vitest';
import {
  buildSimulatorResourceLedger,
} from '../resourceEconomy.js';
import {
  buildCharacterCatalogRows,
  buildQuotaLedgerFromSimulatorStates,
  calculateCharacterQuotaForCopy,
  calculateWeaponQuotaFromCounts,
  calculateWeaponQuotaForCopy,
  attachRankingInfoToCatalogRows,
  normalizeGlobalCharacterCatalog
} from '../quotaEconomy.js';
import { hasPrivateIdentifierFields } from '../characterCatalogViewModel.js';

describe('quotaEconomy', () => {
  it('calculates character quota for first, duplicate, full-potential, and excess copies', () => {
    expect(calculateCharacterQuotaForCopy({ rarity: 6, copyNumber: 1 })).toMatchObject({
      aicQuotaDirect: 30,
      bondQuotaDirect: 0,
      endpointQuotaConvertible: 0,
      trustTokensGained: 0,
    });

    expect(calculateCharacterQuotaForCopy({ rarity: 6, copyNumber: 2 })).toMatchObject({
      aicQuotaDirect: 0,
      bondQuotaDirect: 50,
      endpointQuotaConvertible: 0,
      trustTokensGained: 1,
    });

    expect(calculateCharacterQuotaForCopy({ rarity: 6, copyNumber: 7 })).toMatchObject({
      bondQuotaDirect: 50,
      endpointQuotaConvertible: 10,
      trustTokensGained: 1,
      excessTrustTokens: 1,
    });

    expect(calculateCharacterQuotaForCopy({ rarity: 5, copyNumber: 7 })).toMatchObject({
      bondQuotaDirect: 10,
      aicQuotaConvertible: 20,
      excessTrustTokens: 1,
    });

    expect(calculateCharacterQuotaForCopy({ rarity: 4, copyNumber: 7 })).toMatchObject({
      bondQuotaDirect: 0,
      aicQuotaConvertible: 5,
      excessTrustTokens: 1,
    });
  });

  it('calculates weapon quota without potential tokens', () => {
    expect(calculateWeaponQuotaForCopy({ rarity: 6 })).toMatchObject({
      aicQuotaDirect: 50,
      trustTokensGained: 0,
    });
    expect(calculateWeaponQuotaForCopy({ rarity: 5 })).toMatchObject({
      aicQuotaDirect: 10,
      trustTokensGained: 0,
    });
    expect(calculateWeaponQuotaFromCounts({ 6: 2, '6_std': 1, 5: 4 })).toMatchObject({
      aicQuotaDirect: 190,
      aicQuotaTotalPotential: 190,
      bondQuotaDirect: 0,
    });
  });

  it('maps history pool_id to pool metadata and adds extra-pool per pull or expedited pull Bond quota', () => {
    const ledger = buildCharacterCatalogRows({
      pools: [
        {
          id: 'db-extra',
          pool_id: 'official-extra',
          type: 'extra',
          extra_rule_profile: 'brilliance_festival_v1',
        },
        { id: 'db-weapon', pool_id: 'official-weapon', type: 'weapon' },
      ],
      characters: [
        { id: 'char_alpha', name: 'Alpha', rarity: 6, type: 'character' },
      ],
      history: [
        { id: 1, pool_id: 'official-extra', character_name: 'Alpha', item_name: 'Alpha', rarity: 6 },
        { id: 2, pool_id: 'official-extra', character_name: 'Beta', item_name: 'Beta', rarity: 4, isFree: true },
        { id: 3, pool_id: 'official-weapon', character_name: 'Blade', item_name: 'Blade', rarity: 6 },
      ],
    }).ledger;

    expect(ledger.characterQuota).toMatchObject({
      aicQuotaDirect: 60,
      bondQuotaDirect: 2,
    });
    expect(ledger.weaponQuota).toMatchObject({
      aicQuotaDirect: 50,
      bondQuotaDirect: 0,
    });
  });

  it('attaches extra banner ranking information to catalog rows', () => {
    const catalog = attachRankingInfoToCatalogRows({
      rows: [
        { id: 'char_alpha', name: 'Alpha', rarity: 6 },
        { id: 'char_beta', name: 'Beta', rarity: 5 },
      ],
    }, {
      extra: {
        sixStarUp: [{ name: 'Alpha', count: 3 }],
        fiveStar: [{ name: 'Beta', count: 2 }],
      },
    });

    expect(catalog.rows[0].rankingInfo).toEqual([
      { section: 'extraUp', rank: 1, count: 3 },
    ]);
    expect(catalog.rows[1].rankingInfo).toEqual([
      { section: 'extraFive', rank: 1, count: 2 },
    ]);
  });

  it('adds extra-pool Bond quota for simulator paid pulls and free ten expedited pulls', () => {
    const states = [
      {
        poolId: 'sim_extra',
        poolType: 'extra',
        extraRuleProfile: 'brilliance_festival_v1',
        pullHistory: [
          { id: 'extra-paid-1', characterName: 'Alpha', rarity: 4 },
          { id: 'extra-paid-2', characterName: 'Beta', rarity: 5 },
          { id: 'extra-free', characterName: 'Gamma', rarity: 4, isFreePull: true },
        ],
      },
    ];

    const ledger = buildQuotaLedgerFromSimulatorStates(states);
    expect(ledger.characterQuota).toMatchObject({
      aicQuotaDirect: 90,
      bondQuotaDirect: 3,
    });

    const resourceLedger = buildSimulatorResourceLedger(states);
    expect(resourceLedger).toMatchObject({
      aicQuotaDirect: 90,
      bondQuotaDirect: 3,
    });
  });

  it('counts extra-pool free ten pulls for Bond quota but not paid pull cost', () => {
    const states = [
      {
        poolId: 'sim_extra',
        poolType: 'extra',
        extraRuleProfile: 'brilliance_festival_v1',
        pullHistory: [
          ...Array.from({ length: 80 }).map((_, index) => ({
            id: `extra-paid-${index + 1}`,
            characterName: `Paid ${index + 1}`,
            rarity: 4,
          })),
          ...Array.from({ length: 10 }).map((_, index) => ({
            id: `extra-free-${index + 1}`,
            characterName: `Free ${index + 1}`,
            rarity: 4,
            isFreePull: true,
          })),
        ],
      },
    ];

    const resourceLedger = buildSimulatorResourceLedger(states);
    expect(resourceLedger).toMatchObject({
      characterPulls: 80,
      jadeSpent: 40000,
      bondQuotaDirect: 90,
    });
  });

  it('uses character or weapon economy for reconstruction profiles without per-pull Bond quota', () => {
    const states = [
      {
        poolId: 'sim_reconstruction_character',
        poolType: 'extra',
        extraRuleProfile: 'reconstruction_character_v1',
        pullHistory: [
          { id: 'char-copy', characterName: 'Alpha', rarity: 6 },
        ],
      },
      {
        poolId: 'sim_reconstruction_weapon',
        poolType: 'extra',
        extraRuleProfile: 'reconstruction_weapon_v1',
        pullHistory: [
          { id: 'weapon-copy', characterName: 'Blade', rarity: 6 },
        ],
      },
    ];
    const ledger = buildQuotaLedgerFromSimulatorStates(states);

    expect(ledger.characterQuota).toMatchObject({
      aicQuotaDirect: 30,
      bondQuotaDirect: 0,
    });
    expect(ledger.weaponQuota).toMatchObject({
      aicQuotaDirect: 50,
      bondQuotaDirect: 0,
    });
    expect(buildSimulatorResourceLedger(states)).toMatchObject({
      characterPulls: 1,
      weaponPulls: 1,
    });
  });

  it('builds local character catalog rows from history including free and info-book records', () => {
    const characters = [
      { id: 'char_alpha', name: 'Alpha', rarity: 6, type: 'character', is_limited: true },
      { id: 'char_beta', name: 'Beta', rarity: 5, type: 'character', is_limited: false },
    ];
    const pools = [{ id: 'pool_limited', type: 'limited' }];
    const history = Array.from({ length: 7 }).map((_, index) => ({
      id: index + 1,
      poolId: 'pool_limited',
      character_name: 'Alpha',
      item_name: 'Alpha',
      rarity: 6,
      timestamp: `2026-01-0${Math.min(index + 1, 9)}T00:00:00.000Z`,
      isFree: index === 1,
      isInfoBookPull: index === 2,
    }));

    const catalog = buildCharacterCatalogRows({ history, pools, characters });
    const alpha = catalog.rows.find((row) => row.id === 'char_alpha');
    const beta = catalog.rows.find((row) => row.id === 'char_beta');

    expect(catalog.summary).toMatchObject({
      totalCharacters: 2,
      ownedCharacters: 1,
      unownedCharacters: 1,
      ownershipRate: 0.5,
      fullPotentialCharacters: 1,
      excessTrustTokens: 1,
    });
    expect(alpha).toMatchObject({
      acquisitionCount: 7,
      owned: true,
      potentialLevel: 5,
      trustTokensGained: 6,
      excessTrustTokens: 1,
    });
    expect(alpha.acquisitionPulls).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'free', pulls: null }),
    ]));
    expect(alpha.quota).toMatchObject({
      aicQuotaDirect: 30,
      bondQuotaDirect: 300,
      endpointQuotaConvertible: 10,
    });
    expect(beta).toMatchObject({
      acquisitionCount: 0,
      owned: false,
    });
  });

  it('records local acquisition pull labels for normal pity, 120 guarantee, and 240-cycle gifts', () => {
    const characters = [
      { id: 'char_alpha', name: 'Alpha', rarity: 6, type: 'character' },
    ];
    const pools = [{ id: 'pool_limited', type: 'limited' }];
    const makeRecord = (id, overrides = {}) => ({
      id,
      poolId: 'pool_limited',
      character_name: `Filler ${id}`,
      item_name: `Filler ${id}`,
      rarity: 4,
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, id)).toISOString(),
      ...overrides,
    });
    const history = [
      ...Array.from({ length: 64 }, (_, index) => makeRecord(index + 1)),
      makeRecord(65, { character_name: 'Alpha', item_name: 'Alpha', rarity: 6 }),
      ...Array.from({ length: 54 }, (_, index) => makeRecord(index + 66)),
      makeRecord(120, { character_name: 'Alpha', item_name: 'Alpha', rarity: 6, specialType: 'guaranteed' }),
      makeRecord(121, { character_name: 'Alpha', item_name: 'Alpha', rarity: 6, specialType: 'gift' }),
    ];

    const catalog = buildCharacterCatalogRows({ history, pools, characters });
    const alpha = catalog.rows.find((row) => row.id === 'char_alpha');

    expect(alpha.acquisitionPulls).toEqual([
      { pulls: 65, kind: 'normal' },
      { pulls: 120, kind: 'pity' },
      { pulls: 120, kind: 'cycle' },
    ]);
    expect(alpha).toMatchObject({
      acquisitionCount: 3,
      potentialLevel: 2,
      owned: true,
    });
  });

  it('uses timeline acquisition metadata for local catalog pull labels and pool names', () => {
    const characters = [
      { id: 'char_alpha', name: 'Alpha', rarity: 6, type: 'character' },
    ];
    const pools = [{ id: 'pool_limited', name: 'Limited Alpha', type: 'limited' }];
    const acquisitionIndex = {
      byRecordKey: new Map([
        ['six-1', {
          pulls: 72,
          kind: 'pity',
          timelineElementId: 'timeline-stage-pool_limited-1',
          timelineEntryId: 'pool_limited-stage-1',
          timelineSectionId: 'pool_limited',
          poolId: 'pool_limited',
          poolName: 'Limited Alpha',
        }],
      ]),
    };

    const catalog = buildCharacterCatalogRows({
      characters,
      pools,
      acquisitionIndex,
      history: [{
        id: 'six-1',
        poolId: 'pool_limited',
        character_name: 'Alpha',
        item_name: 'Alpha',
        rarity: 6,
        timestamp: '2026-01-01T00:00:00.000Z',
      }],
    });
    const alpha = catalog.rows.find((row) => row.id === 'char_alpha');

    expect(alpha.firstAcquiredPoolName).toBe('Limited Alpha');
    expect(alpha.lastAcquiredPoolName).toBe('Limited Alpha');
    expect(alpha.acquisitionPulls).toEqual([
      expect.objectContaining({
        pulls: 72,
        kind: 'pity',
        timelineElementId: 'timeline-stage-pool_limited-1',
        poolName: 'Limited Alpha',
      }),
    ]);
  });

  it('builds simulator quota ledger for cumulative AIC, Bond, and Endpoint quota', () => {
    const states = [
      {
        poolId: 'sim_limited',
        poolType: 'limited',
        pullHistory: Array.from({ length: 7 }).map((_, index) => ({
          id: `alpha-${index + 1}`,
          name: 'Alpha',
          characterName: 'Alpha',
          rarity: 6,
          timestamp: `2026-02-0${Math.min(index + 1, 9)}T00:00:00.000Z`,
        })),
      },
      {
        poolId: 'sim_weapon',
        poolType: 'weapon',
        pullHistory: [
          { id: 'weapon-6', name: 'Blade', rarity: 6 },
          { id: 'weapon-5', name: 'Guard', rarity: 5 },
        ],
      },
    ];

    const ledger = buildQuotaLedgerFromSimulatorStates(states);

    expect(ledger.quota).toMatchObject({
      aicQuotaDirect: 90,
      aicQuotaConvertible: 0,
      aicQuotaTotalPotential: 90,
      bondQuotaDirect: 300,
      endpointQuotaConvertible: 10,
    });
    expect(ledger.characterQuota).toMatchObject({
      aicQuotaDirect: 30,
      bondQuotaDirect: 300,
      endpointQuotaConvertible: 10,
    });
    expect(ledger.weaponQuota).toMatchObject({
      aicQuotaDirect: 60,
      bondQuotaDirect: 0,
      endpointQuotaConvertible: 0,
    });

    const resourceLedger = buildSimulatorResourceLedger(states);
    expect(resourceLedger).toMatchObject({
      aicQuotaDirect: 90,
      aicQuotaConvertible: 0,
      aicQuotaTotalPotential: 90,
      bondQuotaDirect: 300,
      endpointQuotaConvertible: 10,
    });
  });

  it('normalizes global catalog payload without carrying private identifiers', () => {
    const normalized = normalizeGlobalCharacterCatalog({
      totalContributors: 2,
      summary: {
        totalCharacters: 1,
        ownedCharacters: 1,
        unownedCharacters: 0,
        ownershipRate: 1,
        fullPotentialCharacters: 1,
      },
      characters: [
        {
          id: 'char_alpha',
          name: 'Alpha',
          rarity: 6,
          type: 'character',
          ownerUsers: 2,
          unownedUsers: 0,
          ownershipRate: 1,
          fullPotentialUsers: 1,
          fullPotentialRateOfOwners: 0.5,
          fullPotentialRateOfContributors: 0.5,
          totalCopies: 7,
          avgCopiesPerOwner: 3.5,
          copyDistribution: { 0: 0, 1: 1, 6: 1 },
          quotaAggregate: { aicQuotaDirect: 60 },
          user_id: 'private-user',
          game_uid: 'private-game',
          record_id: 'private-record',
        },
      ],
    });

    expect(normalized.rows[0]).toMatchObject({
      id: 'char_alpha',
      ownerUsers: 2,
      fullPotentialRateOfOwners: 0.5,
      totalCopies: 7,
    });
    expect(hasPrivateIdentifierFields(normalized)).toBe(false);
  });
});
