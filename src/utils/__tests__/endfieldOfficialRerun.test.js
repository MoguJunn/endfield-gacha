import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OFFICIAL_RECORD_REQUESTS,
  MAX_OFFICIAL_RECORD_BATCH_SIZE,
  OFFICIAL_CHARACTER_POOL_TYPES,
  annotateOfficialGachaRecord,
  buildOfficialRecordsUrl,
} from '../../../shared/officialGachaRecordTypes.js';
import { queuedFetch } from '../requestQueue.js';
import { fetchWithTimeout } from '../../services/supabaseRequest.js';
import { fetchAllGachaRecords, fetchAllGachaRecordsConcurrent, POOL_TYPES } from '../endfieldAuthChain.js';
import { convertRecord, convertRecords, ENDFIELD_API, mapPoolType, toDbFormat } from '../endfieldImportAdapter.js';

vi.mock('../requestQueue.js', () => ({ queuedFetch: vi.fn() }));
vi.mock('../../services/authFetchService.js', () => ({ getSupabaseAccessToken: vi.fn() }));
vi.mock('../../services/supabaseRequest.js', () => ({ fetchWithTimeout: vi.fn() }));
vi.mock('../appLogger.js', () => ({ appLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const RERUN = 'E_CharacterGachaPoolType_Rerun';
const characterRecord = { poolId: 'opaque-character-pool', poolVersion: 3, seqId: '101', charId: 'char-1' };
const weaponRecords = [
  { poolId: 'opaque-weapon-pool', poolVersion: 2, poolType: 'rerun', seqId: '201', weaponId: 'weapon-1' },
  { poolId: 'opaque-weapon-pool', poolVersion: 3, poolType: 'standard', seqId: '202', weaponId: 'weapon-2' },
];
const jsonResponse = payload => ({ ok: true, text: async () => JSON.stringify(payload) });
const batchData = {
  results: [
    { type: 'char', poolType: RERUN, records: [characterRecord] },
    { type: 'weapon', records: weaponRecords },
  ],
};

describe('official Rerun request contract', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('shares exactly five character feeds and one weapon feed across both frontend adapters', () => {
    expect(DEFAULT_OFFICIAL_RECORD_REQUESTS).toEqual([
      { type: 'char', poolType: 'E_CharacterGachaPoolType_Special' },
      { type: 'char', poolType: 'E_CharacterGachaPoolType_Joint' },
      { type: 'char', poolType: RERUN },
      { type: 'char', poolType: 'E_CharacterGachaPoolType_Standard' },
      { type: 'char', poolType: 'E_CharacterGachaPoolType_Beginner' },
      { type: 'weapon' },
    ]);
    expect(MAX_OFFICIAL_RECORD_BATCH_SIZE).toBe(6);
    expect(POOL_TYPES.CHARACTER).toBe(OFFICIAL_CHARACTER_POOL_TYPES);
    expect(ENDFIELD_API.CHARACTER_POOL_TYPES).toBe(OFFICIAL_CHARACTER_POOL_TYPES);
  });

  it.each(['ef-webview.hypergryph.com', 'ef-webview.gryphline.com'])('routes Rerun pages through char on %s', (host) => {
    const config = {
      recordsCharEndpoint: `https://${host}/api/record/char`,
      recordsWeaponEndpoint: `https://${host}/api/record/weapon`,
    };
    const url = new URL(buildOfficialRecordsUrl(config, {
      u8Token: 'test-token', type: 'char', poolType: RERUN, seqId: '101', serverId: '2',
    }));
    expect(url.pathname).toBe('/api/record/char');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      token: 'test-token', server_id: '2', lang: 'zh-cn', pool_type: RERUN, seq_id: '101',
    });
    const weaponUrl = new URL(buildOfficialRecordsUrl(config, { u8Token: 'test-token', type: 'weapon' }));
    expect(weaponUrl.pathname).toBe('/api/record/weapon');
    expect(weaponUrl.searchParams.has('pool_type')).toBe(false);
  });

  it.each([false, true])('submits six feeds and keeps Rerun source and version in batch results (queued=%s)', async (queued) => {
    queuedFetch.mockResolvedValue(jsonResponse(queued
      ? { success: true, queued: true, taskId: 'task', taskKey: 'key', position: 1 }
      : { success: true, data: batchData }));
    fetchWithTimeout.mockResolvedValue(jsonResponse({ success: true, data: { status: 'completed', result: batchData } }));

    const records = await fetchAllGachaRecordsConcurrent('test-token', '2', undefined, {}, 'intl');
    expect(JSON.parse(queuedFetch.mock.calls[0][1].body)).toMatchObject({
      pools: DEFAULT_OFFICIAL_RECORD_REQUESTS, serverId: '2', source: 'intl',
    });
    expect(records).toEqual([
      { ...characterRecord, sourcePoolType: RERUN, _poolType: 'extra' },
      { ...weaponRecords[0], sourcePoolType: 'rerun', _poolType: 'extra' },
      { ...weaponRecords[1], sourcePoolType: 'standard', _poolType: 'limited_weapon' },
    ]);
  });

  it('fetches all six serial feeds, advances the Rerun cursor and classifies each weapon independently', async () => {
    vi.useFakeTimers();
    queuedFetch.mockImplementation(async (requestUrl) => {
      const query = new URL(requestUrl, 'http://localhost').searchParams;
      const rerun = query.get('poolType') === RERUN;
      const nextPage = query.has('seqId');
      return jsonResponse({ success: true, data: {
        list: query.get('type') === 'weapon' ? weaponRecords : rerun
          ? [{ ...characterRecord, seqId: nextPage ? '100' : '101', poolVersion: nextPage ? 2 : 3 }]
          : [],
        hasMore: rerun && !nextPage,
      } });
    });
    const pending = fetchAllGachaRecords('test-token', undefined, 'intl', '2');
    await vi.runAllTimersAsync();
    const records = await pending;
    const queries = queuedFetch.mock.calls.map(([url]) => new URL(url, 'http://localhost').searchParams);
    expect(queries).toHaveLength(7);
    expect(queries.filter(q => !q.has('seqId')).map(q => ({
      type: q.get('type'), ...(q.has('poolType') ? { poolType: q.get('poolType') } : {}),
    }))).toEqual(DEFAULT_OFFICIAL_RECORD_REQUESTS);
    expect(queries.every(q => q.get('source') === 'intl' && q.get('serverId') === '2')).toBe(true);
    expect(queries.filter(q => q.get('poolType') === RERUN).map(q => q.get('seqId'))).toEqual([null, '101']);
    expect(records.map(r => r._poolType)).toEqual(['extra', 'extra', 'extra', 'limited_weapon']);
    expect(records.slice(0, 2).map(r => [r.poolId, r.poolVersion, r.sourcePoolType])).toEqual([
      ['opaque-character-pool', 3, RERUN], ['opaque-character-pool', 2, RERUN],
    ]);
  });

  it('names a failed character Rerun feed separately from Joint', async () => {
    queuedFetch.mockResolvedValue(jsonResponse({ success: true, data: { results: [], failed: [{ type: 'char', poolType: RERUN }] } }));
    const progress = vi.fn();
    await fetchAllGachaRecordsConcurrent('test-token', '1', progress);
    expect(progress).toHaveBeenLastCalledWith('部分卡池获取失败: 重构寻访，已获取 0 条记录');
  });

  it('keeps explicit source and independent poolVersion through record conversion', () => {
    const annotated = annotateOfficialGachaRecord(characterRecord, { type: 'char', poolType: RERUN });
    expect(convertRecord(annotated)).toMatchObject({ pool: 'extra', pool_id: characterRecord.poolId, poolVersion: 3, sourcePoolType: RERUN });
    expect(convertRecord(weaponRecords[0], 'weapon')).toMatchObject({ pool: 'extra', pool_id: weaponRecords[0].poolId, poolVersion: 2, sourcePoolType: 'rerun' });
    expect(convertRecord(weaponRecords[1], 'weapon')).toMatchObject({ pool: 'limited_weapon', sourcePoolType: 'standard' });
    expect(mapPoolType('rerun_unconfirmed_prefix')).toBe('unknown');
    expect(annotateOfficialGachaRecord({ poolId: 'rerun_unconfirmed_prefix' }, { type: 'weapon' })._poolType).toBe('limited_weapon');
    expect(annotateOfficialGachaRecord({ poolId: 'rerun_unconfirmed_prefix' }, { type: 'char' })._poolType).toBe('unknown');
  });
});

describe('official import adapter naming, gift and version contract', () => {
  it.each(['nameText', 'name_text', 'itemName', 'item_name'])('keeps the name when the official payload only carries %s', (nameField) => {
    const record = convertRecord({ poolId: 'opaque-weapon-pool', [nameField]: ' 重构申领武器 ', rarity: 5, gachaTs: '1778745600000' }, 'weapon');
    expect(record.name).toBe('重构申领武器');
    expect(record.character_name).toBe('重构申领武器');
  });

  it('falls back to itemId/character_id when charId and weaponId are absent', () => {
    expect(convertRecord({ poolId: 'opaque-pool', nameText: '某武器', itemId: 'weapon-9' }, 'weapon').item_id).toBe('weapon-9');
    expect(convertRecord({ poolId: 'opaque-pool', nameText: '某角色', charName: '', character_id: 'char-9' }).item_id).toBe('char-9');
    expect(convertRecord({ poolId: 'opaque-pool' }, 'weapon')).toMatchObject({ name: '未知', item_id: '' });
  });

  it('accepts snake_case pool_version and ignores values the database cannot store', () => {
    expect(convertRecord({ poolId: 'opaque-pool', nameText: '武器', pool_version: '4' }, 'weapon').poolVersion).toBe(4);
    expect(convertRecord({ poolId: 'opaque-pool', nameText: '武器', pool_version: 'abc' }, 'weapon').poolVersion).toBeNull();
    expect(convertRecord({ poolId: 'opaque-pool', nameText: '武器', poolVersion: 0 }, 'weapon').poolVersion).toBeNull();
  });

  it('drops gift and info-book non-pull events while keeping real pulls in batch conversion', () => {
    const records = [
      { kind: 'gift_intel_book', nameText: '情报书补发', seqId: '1' },
      { nameText: '武库赠礼', seqId: '2' },
      { poolId: 'opaque-weapon-pool', name_text: '军列赠礼 - 限定', seqId: '3' },
      { poolId: 'opaque-weapon-pool', weaponId: 'weapon-1', weaponName: '远山', rarity: 5, seqId: '4', gachaTs: '1778745600000' },
    ];
    const converted = convertRecords(records, 'weapon');
    expect(converted).toHaveLength(1);
    expect(converted[0]).toMatchObject({ name: '远山', item_id: 'weapon-1', seqId: '4' });
    expect(convertRecords(null)).toEqual([]);
  });

  it('writes the independent pool_version column into the local database row format', () => {
    const rows = toDbFormat([
      { name: '远山', pool_id: 'opaque-weapon-pool', pool: 'extra', item_id: 'weapon-1', rarity: 5, timestamp: 1778745600000, seqId: '4', poolVersion: 7 },
      { name: '角色', pool_id: 'opaque-character-pool', pool: 'extra', item_id: 'char-1', rarity: 6, timestamp: 1778745601000, seqId: '5', pool_version: 8 },
      { name: '角色', pool_id: 'opaque-character-pool', pool: 'standard', item_id: 'char-2', rarity: 4, timestamp: 1778745602000, seqId: '6' },
    ], 'user-1');

    expect(rows.map(row => row.pool_version)).toEqual([7, 8, null]);
    expect(rows.map(row => row.pool_type)).toEqual(['extra', 'extra', 'standard']);
  });
});
