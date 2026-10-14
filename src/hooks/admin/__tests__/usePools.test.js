import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAuthStore } from '../../../stores/index.js';

vi.mock('../../../services/admin/poolService.js', () => ({}));

vi.mock('../../../services/admin/publicCacheService.js', () => ({
  invalidatePublicCache: vi.fn(),
}));

vi.mock('../../../stores/index.js', () => ({
  useAuthStore: vi.fn(),
}));

vi.mock('../../../utils/characterUtils.js', () => ({
  characterCache: {
    refresh: vi.fn(),
  },
}));

import {
  buildPoolDataFromForm,
  buildPoolDraftDiff,
  normalizeDraftPoolCharacters,
  usePools,
} from '../usePools.js';

const characters = [
  { id: 'char_a', name: '莱万汀', type: 'character', rarity: 6 },
  { id: 'char_b', name: '伊冯', type: 'character', rarity: 6 },
  { id: 'char_c', name: '余烬', type: 'character', rarity: 5 },
  { id: 'weapon_a', name: '武器A', type: 'weapon', rarity: 6 },
];

describe('usePools draft helpers', () => {
  it('builds the same pool payload shape used by save and preview', () => {
    const { normalizedPoolType, poolData } = buildPoolDataFromForm({
      name: '  测试卡池  ',
      name_en: '',
      type: 'limited_character',
      up_character: ' 莱万汀 ',
      featured_characters_text: '不会用于普通池',
      banner_url: '',
      description: '  描述  ',
      start_time: '2026-06-05T12:00',
      end_time: '2026-06-26T12:00',
      is_limited_weapon: false,
      locked: false,
    });

    expect(normalizedPoolType).toBe('limited');
    expect(poolData).toMatchObject({
      name: '测试卡池',
      name_en: null,
      type: 'limited',
      up_character: '莱万汀',
      featured_characters: null,
      banner_url: null,
      description: '描述',
      is_limited_weapon: null,
      locked: false,
    });
    expect(poolData.start_time).toBe(new Date('2026-06-05T12:00').toISOString());
    expect(poolData.end_time).toBe(new Date('2026-06-26T12:00').toISOString());
  });

  it('normalizes roster rows by pool type and featured names', () => {
    expect(normalizeDraftPoolCharacters(
      [
        { character_id: 'char_a', is_up: false },
        { character_id: 'char_a', is_up: false },
        { character_id: 'weapon_a', is_up: true },
      ],
      characters,
      'limited',
      ['莱万汀']
    )).toEqual([
      { character_id: 'char_a', is_up: true },
    ]);
  });

  it('builds reconstruction character and weapon template metadata', () => {
    const characterPool = buildPoolDataFromForm({
      name: '重构角色测试',
      type: 'extra',
      extra_rule_profile: 'reconstruction_character_v1',
      extra_series_key: 'reconstruction-laevatain',
      extra_series_phase: '2',
      up_character: '莱万汀',
    });
    const weaponPool = buildPoolDataFromForm({
      name: '重构申领测试',
      type: 'extra',
      extra_rule_profile: 'reconstruction_weapon_v1',
      extra_series_key: 'reconstruction-weapon-a',
      extra_series_phase: 1,
      up_character: '武器A',
    });

    expect(characterPool).toMatchObject({
      expectedCharacterType: 'character',
      featuredCharacters: ['莱万汀'],
      poolData: {
        type: 'extra',
        extra_subtype: 'reconstruction',
        extra_rule_profile: 'reconstruction_character_v1',
        extra_series_key: 'reconstruction-laevatain',
        extra_series_phase: 2,
        up_character: '莱万汀',
        featured_characters: ['莱万汀'],
      },
    });
    expect(weaponPool).toMatchObject({
      expectedCharacterType: 'weapon',
      poolData: {
        extra_subtype: 'reconstruction_claim',
        extra_rule_profile: 'reconstruction_weapon_v1',
        extra_series_key: 'reconstruction-weapon-a',
        extra_series_phase: 1,
        featured_characters: ['武器A'],
      },
    });
    expect(normalizeDraftPoolCharacters(
      [{ character_id: 'char_a', is_up: true }, { character_id: 'weapon_a', is_up: false }],
      characters,
      'extra',
      ['武器A'],
      'reconstruction_weapon_v1'
    )).toEqual([{ character_id: 'weapon_a', is_up: true }]);
  });

  it('builds brilliance festival metadata without series fields', () => {
    const result = buildPoolDataFromForm({
      name: '辉光庆典',
      type: 'extra',
      extra_rule_profile: 'brilliance_festival_v1',
      extra_series_key: 'must-be-cleared',
      extra_series_phase: '3',
      featured_characters_text: '莱万汀\n伊冯\n洁尔佩塔\n余烬',
    });

    expect(result.poolData).toMatchObject({
      type: 'extra',
      extra_subtype: 'special',
      extra_rule_profile: 'brilliance_festival_v1',
      extra_series_key: null,
      extra_series_phase: null,
      featured_characters: ['莱万汀', '伊冯', '洁尔佩塔', '余烬'],
    });
  });

  it('reports field-level and roster-level changes before saving', () => {
    const diff = buildPoolDraftDiff({
      editingPool: {
        pool_id: 'special_manual_old',
        name: '旧卡池',
        name_en: null,
        type: 'limited',
        up_character: '莱万汀',
        featured_characters: null,
        banner_url: null,
        description: null,
        start_time: new Date('2026-06-05T12:00').toISOString(),
        end_time: new Date('2026-06-26T12:00').toISOString(),
        is_limited_weapon: null,
      },
      poolForm: {
        name: '新卡池',
        name_en: '',
        type: 'limited',
        up_character: '伊冯',
        featured_characters_text: '',
        banner_url: '',
        description: '',
        start_time: '2026-06-05T12:00',
        end_time: '2026-06-26T12:00',
        is_limited_weapon: true,
        locked: false,
      },
      originalPoolCharacters: [
        { character_id: 'char_a', is_up: true },
        { character_id: 'char_c', is_up: true },
      ],
      editingPoolCharacters: [
        { character_id: 'char_b', is_up: false },
        { character_id: 'char_c', is_up: true },
      ],
      characters,
    });

    expect(diff.hasChanges).toBe(true);
    expect(diff.fieldChanges.map(change => change.key)).toEqual(['name', 'up_character']);
    expect(diff.roster.added.map(item => item.id)).toEqual(['char_b']);
    expect(diff.roster.removed.map(item => item.id)).toEqual(['char_a']);
    expect(diff.roster.upChanged.map(item => item.id)).toEqual(['char_c']);
    expect(diff.currentRows).toEqual([
      { character_id: 'char_b', is_up: true },
      { character_id: 'char_c', is_up: false },
    ]);
  });

  it('shows automatic UP creation and completeness in the save diff', () => {
    const diff = buildPoolDraftDiff({ poolForm: {
      name: '新名单', type: 'limited', up_character: '新角色', roster_status: 'partial',
    }, characters });
    expect(diff.roster.added).toEqual([expect.objectContaining({ name: '新角色', is_up: true })]);
    expect(diff.currentRows[0].character_id).toBe(diff.roster.added[0].id);
    expect(diff.fieldChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'roster_status', after: 'partial' }),
      expect.objectContaining({ key: 'pool_id', after: diff.poolData.pool_id }),
    ]));
  });

  it('includes an existing UP referenced by ID in the projected roster', () => {
    expect(normalizeDraftPoolCharacters([], characters, 'limited', ['char_a']))
      .toEqual([{ character_id: 'char_a', is_up: true }]);
  });
});

describe('usePools confirmation and independent recalculation', () => {
  function setup() {
    useAuthStore.mockImplementation((selector) => selector({ userRole: 'super_admin' }));
    const pool = { pool_id: 'pool-a', name: '测试池', type: 'limited', up_character: '莱万汀', roster_status: 'complete' };
    const service = {
      loadPools: vi.fn().mockResolvedValue({ success: true, data: [pool] }),
      loadCharacters: vi.fn().mockResolvedValue({ success: true, data: characters }),
      loadAllPoolCharacters: vi.fn().mockResolvedValue({ success: true, data: {} }),
      loadPoolCharactersForEdit: vi.fn().mockResolvedValue({ success: true, data: [{ character_id: 'char_a', is_up: true }] }),
      savePool: vi.fn().mockResolvedValue({ success: true, poolId: 'pool-a', addedCount: 1 }),
      recalculateIsStandard: vi.fn(),
    };
    const showToast = vi.fn();
    const invalidateCache = vi.fn();
    const refreshCharacterCatalog = vi.fn();
    const hook = renderHook(() => usePools(showToast, { service, invalidateCache, refreshCharacterCatalog }));
    return { ...hook, pool, service, showToast, invalidateCache };
  }

  it('requires confirmation again after editing UP context or roster and saves without recalculation', async () => {
    const { result, pool, service } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.startEdit(pool); });
    await act(async () => { await result.current.handleSavePool(); });
    expect(service.savePool).not.toHaveBeenCalled();
    act(() => result.current.setPoolForm((form) => ({ ...form, confirm_roster_complete: true })));
    act(() => result.current.toggleCharacterInPool(characters[1], false));
    expect(result.current.poolForm.confirm_roster_complete).toBe(false);
    act(() => result.current.setPoolForm((form) => ({ ...form, confirm_roster_complete: true })));
    act(() => result.current.setPoolForm((form) => ({ ...form, start_time: '2026-09-19T12:00' })));
    expect(result.current.poolForm.confirm_roster_complete).toBe(false);
    act(() => result.current.setPoolForm((form) => ({ ...form, confirm_roster_complete: true })));
    await act(async () => { await result.current.handleSavePool(); });
    expect(service.savePool).toHaveBeenCalledWith(expect.objectContaining({ roster_status: 'complete' }),
      pool, characters, expect.any(Array), { confirmRosterComplete: true });
    expect(service.recalculateIsStandard).not.toHaveBeenCalled();
  });

  it('previews scope before confirmation and applies only its token', async () => {
    const { result, service, invalidateCache } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    service.recalculateIsStandard.mockResolvedValueOnce({ success: true, changedCount: 2, previewToken: 'token',
      scope: { recordCount: 10, affectedUserCount: 1, affectedPoolIds: ['pool-a'] } })
      .mockResolvedValueOnce({ success: true, changedCount: 2 });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => { await result.current.handleRecalculateIsStandard(); });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('10 条六星记录'));
    expect(service.recalculateIsStandard.mock.calls).toEqual([
      [{ mode: 'preview' }], [{ mode: 'apply', previewToken: 'token' }],
    ]);
    expect(invalidateCache).toHaveBeenCalledWith('stats', 'admin:pool:recalculate-is-standard');
    confirm.mockRestore();
  });
});
