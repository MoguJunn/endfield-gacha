import { describe, expect, it } from 'vitest';
import { buildPoolLedgerEntry, createWorkbenchDraft } from '../../../../shared/dataWorkbench.js';
import { normalizeWorkspaceSubmission } from '../../../../api/_lib/dataWorkbench.js';
import { buildWorkspacePayload } from '../workbenchStorage.js';
import {
  buildInputLedger,
  buildQuestionnaireResult,
  createQuestionnairePoolState,
  entitiesForPool,
  normalizeInputLedgerValues,
  parseConvertedWorkbenchJson,
} from '../workbenchInputAdapters.js';
import { buildImportConvertPrompt, buildWorkbenchConversionTemplate } from '../importConvertPrompt.js';

const scope = { gameUid: 'game-123', serverScope: 'cn-1' };
const pools = [
  { id: 'real-pool', name: '角色测试池', type: 'limited', rosterEntityIds: ['six-a', 'six-b', 'five-a', 'four-a'] },
  { id: 'weapon-pool', name: '武器测试池', type: 'weapon', rosterEntityIds: ['weapon-a'] },
];
const entities = [
  { id: 'six-a', name: '六星甲', rarity: 6, type: 'character' },
  { id: 'six-b', name: '六星乙', rarity: 6, type: 'character' },
  { id: 'five-a', name: '五星甲', rarity: 5, type: 'character' },
  { id: 'four-a', name: '四星甲', rarity: 4, type: 'character' },
  { id: 'weapon-a', name: '六星武器', rarity: 6, type: 'weapon' },
];
const catalog = { scope, pools, entities };
const acquisition = (patch = {}) => ({
  id: 'acq-1',
  entityId: 'six-a',
  rarity: 6,
  quantity: 1,
  drawMethod: 'normal',
  timePrecision: 'unknown',
  ...patch,
});
const historyRecord = (patch = {}) => ({
  ...scope,
  id: 'official-record',
  poolId: 'real-pool',
  character_id: 'six-a',
  rarity: 6,
  timestamp: '2026-01-23T08:09:10Z',
  seqId: 'official-seq',
  editVersion: 3,
  isStandard: false,
  ...patch,
});
function payload(values = { acquisitions: [acquisition()] }, patch = {}) {
  return {
    ...buildWorkbenchConversionTemplate(catalog),
    supplements: {
      schemaVersion: 1,
      workbenchEntries: [
        {
          entryId: 'transfer-entry',
          draftId: 'transfer-draft',
          ...scope,
          kind: 'pool-ledger',
          poolId: 'real-pool',
          source: 'file',
          derivation: 'declared',
          values,
        },
      ],
    },
    ...patch,
  };
}

describe('questionnaire input adapters', () => {
  it('limits candidates to the database roster without falling back to the complete entity catalog', () => {
    expect(entitiesForPool({ ...pools[0], rosterEntityIds: ['six-a'] }, entities).map(entity => entity.id)).toEqual(['six-a']);
    expect(entitiesForPool({ ...pools[0], rosterEntityIds: [] }, entities)).toEqual([]);
    expect(entitiesForPool({ id: 'missing', type: 'limited' }, entities)).toEqual([]);
    expect(() => buildInputLedger({ poolId: 'real-pool', values: { acquisitions: [acquisition({ entityId: 'six-b' })] } },
      { entities, pools: [{ ...pools[0], rosterEntityIds: ['six-a'] }] })).toThrow('不在本池可获得名单');
  });
  it('keeps unknown numbers absent and uses the shared deterministic generator', () => {
    const input = { totalPulls: '40', fiveStarCount: '0', sixStarCount: '', pity: '', acquisitions: [acquisition()] };
    const entry = buildInputLedger({ poolId: 'real-pool', values: input }, catalog);
    expect(entry).toMatchObject({
      kind: 'pool-ledger',
      source: 'manual',
      derivation: 'declared',
      values: { totalPulls: 40, fiveStarCount: 0 },
    });
    expect(entry.values).not.toHaveProperty('sixStarCount');
    expect(entry.values).not.toHaveProperty('pity');
    expect(entry.values.acquisitions[0]).not.toHaveProperty('timestamp');
    expect(entry.values.acquisitions[0]).not.toHaveProperty('seqId');
    expect(entry.values.fillSeed).toBe(entry.entryId);
    const generated = buildInputLedger(
      { poolId: 'real-pool', entryId: 'stable-entry', values: { totalPulls: 40, fiveStarCount: 0, sixStarCount: 1 } },
      catalog
    );
    expect(generated.values.inferredFill).toMatchObject({ count: 39, seed: 'stable-entry', derivation: 'inferred' });
  });

  it('prefills scoped official history and the selected saved ledger without duplicating official acquisitions', () => {
    const original = {
      ...buildPoolLedgerEntry(
        {
          poolId: 'real-pool',
          source: 'file',
          values: { totalPulls: 80, sixStarCount: 2, acquisitions: [acquisition()] },
        },
        catalog
      ),
      id: 'saved-id',
      revision: 4,
      ...scope,
    };
    const record = historyRecord();
    const state = createQuestionnairePoolState('real-pool', {
      scope,
      mode: 'edit',
      existingEntries: [original],
      existingHistory: [record, historyRecord({ id: 'foreign', serverScope: 'intl' })],
    });
    expect(state.values.totalPulls).toBe(80);
    expect(state.acquisitions).toHaveLength(2);
    expect(buildQuestionnaireResult([state], catalog)).toMatchObject({
      entries: [],
      historyChanges: [],
      supplementChanges: [],
    });
    state.acquisitions[0].entityId = 'six-b';
    state.values.pity = '20';
    const result = buildQuestionnaireResult([state], catalog);
    expect(result.entries).toEqual([]);
    expect(result.historyChanges).toEqual([
      {
        recordId: 'official-record',
        gameUid: scope.gameUid,
        serverScope: scope.serverScope,
        currentPoolId: 'real-pool',
        seqId: 'official-seq',
        expectedEditVersion: 3,
        changes: { characterId: 'six-b' },
      },
    ]);
    expect(result.supplementChanges[0]).toMatchObject({
      id: 'saved-id',
      expectedRevision: 4,
      action: 'update',
      entry: { source: 'file', entryId: original.entryId, values: { totalPulls: 80, sixStarCount: 2, pity: 20 } },
    });
    expect(result.supplementChanges[0].entry.values.acquisitions).toHaveLength(1);
    expect(result.supplementChanges[0].entry.values.fillSeed).toBe(original.values.fillSeed);
    expect(record.character_id).toBe('six-a');
  });

  it('returns history-only changes without creating an empty supplement', () => {
    const state = createQuestionnairePoolState('real-pool', { scope, existingHistory: [historyRecord()] });
    state.acquisitions[0].isOffRate = true;
    const result = buildQuestionnaireResult([state], catalog);
    expect(result.entries).toEqual([]);
    expect(result.historyChanges[0]).toMatchObject({ expectedEditVersion: 3, changes: { isStandard: true } });
  });

  it('preserves screenshot channel and weapon batch evidence when editing through the questionnaire', () => {
    const original = { ...buildPoolLedgerEntry({ poolId: 'weapon-pool', source: 'xhh', values: {
      totalPulls: 40, acquisitions: [acquisition({ entityId: 'weapon-a', batchIndex: 4 })],
    } }, catalog), id: crypto.randomUUID(), revision: 2, scope };
    const state = createQuestionnairePoolState('weapon-pool', { scope, mode: 'edit', existingEntries: [original] });
    state.values.pity = 10;
    const changed = buildQuestionnaireResult([state], catalog).supplementChanges[0].entry;
    expect(changed.source).toBe('xhh');
    expect(changed.values.acquisitions[0].batchIndex).toBe(4);
    expect(changed.values.fillSeed).toBe(original.values.fillSeed);
  });

  it('passes flat history changes and saved revisions through the real workspace payload builder', () => {
    const savedId = crypto.randomUUID();
    const original = {
      ...buildPoolLedgerEntry({ poolId: 'real-pool', source: 'file', values: { totalPulls: 80 } }, catalog),
      id: savedId,
      revision: 4,
      scope,
    };
    const state = createQuestionnairePoolState('real-pool', {
      scope,
      mode: 'edit',
      existingEntries: [original],
      existingHistory: [historyRecord()],
    });
    state.acquisitions[0].entityId = 'six-b';
    state.acquisitions[0].drawMethod = 'gift';
    state.values.pity = 20;
    const result = buildQuestionnaireResult([state], catalog);
    const payload = buildWorkspacePayload({ ...createWorkbenchDraft({ scope }), ...result }, crypto.randomUUID());
    expect(payload.historyChanges).toEqual([
      {
        recordId: 'official-record',
        currentPoolId: 'real-pool',
        seqId: 'official-seq',
        ...scope,
        expectedEditVersion: 3,
        changes: { characterId: 'six-b', drawMethod: 'gift' },
      },
    ]);
    expect(payload.supplementChanges[0]).toMatchObject({
      id: savedId,
      expectedRevision: 4,
      action: 'update',
      entry: { source: 'file', entryId: original.entryId },
    });
    const normalized = normalizeWorkspaceSubmission(payload);
    expect(normalized.historyChanges[0]).toMatchObject(payload.historyChanges[0]);
    expect(normalized.supplementChanges[0]).toMatchObject(payload.supplementChanges[0]);
  });

  it('edits an existing unsaved scoped ledger without treating its entryId as a saved database id', () => {
    const original = {
      ...buildPoolLedgerEntry(
        { poolId: 'real-pool', values: { totalPulls: 80, fiveStarCount: 0, sixStarCount: 1 } },
        catalog
      ),
      scope,
    };
    const sample = original.values.inferredRecords;
    const state = createQuestionnairePoolState('real-pool', { scope, mode: 'edit', existingEntries: [original] });
    state.values.pity = '20';
    const result = buildQuestionnaireResult([state], catalog);
    expect(result.supplementChanges).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].entryId).toBe(original.entryId);
    expect(result.entries[0].values.inferredFill).toEqual(original.values.inferredFill);
    expect(result.entries[0].values.inferredRecords).toEqual(sample);
    expect(sample.length).toBeLessThanOrEqual(16);
  });

  it('preserves unknown official dates and the latest projected identity while editing other known fields', () => {
    const state = createQuestionnairePoolState('real-pool', {
      scope,
      existingHistory: [historyRecord({ characterId: 'six-b', character_id: 'six-a', timestamp: null })],
    });
    expect(state.acquisitions[0]).toMatchObject({ entityId: 'six-b', timePrecision: 'unknown' });
    expect(buildQuestionnaireResult([state], catalog).historyChanges).toEqual([]);
    state.acquisitions[0].drawMethod = 'free';
    expect(buildQuestionnaireResult([state], catalog).historyChanges[0].changes).toEqual({ drawMethod: 'free' });
  });

  it('checks a total against official high stars while retaining unknown whitespace as absent', () => {
    const state = createQuestionnairePoolState('real-pool', { scope, existingHistory: [historyRecord()] });
    state.values.sixStarCount = '0';
    expect(() => buildQuestionnaireResult([state], catalog)).toThrow('对应星级');
    expect(normalizeInputLedgerValues({ totalPulls: '  ', pity: '\t' })).not.toHaveProperty('totalPulls');
    expect(() => normalizeInputLedgerValues({ totalPulls: false })).toThrow('整数');
  });

  it('marks skipped pools, leaves them untouched, and refuses missing edit versions', () => {
    const state = createQuestionnairePoolState('real-pool', {
      scope,
      existingHistory: [historyRecord({ editVersion: undefined })],
    });
    state.acquisitions[0].entityId = 'six-b';
    expect(() => buildQuestionnaireResult([state], catalog)).toThrow('编辑版本');
    state.skipped = true;
    const result = buildQuestionnaireResult([state], catalog);
    expect(result.entries).toEqual([]);
    expect(result.historyChanges).toEqual([]);
    expect(result.warnings).toEqual(['已跳过 角色测试池，本次不更新这个卡池。']);
    const missingSeq = createQuestionnairePoolState('real-pool', {
      scope,
      existingHistory: [historyRecord({ seqId: null })],
    });
    missingSeq.acquisitions[0].drawMethod = 'free';
    expect(() => buildQuestionnaireResult([missingSeq], catalog)).toThrow('准确定位');
  });

  it('rejects contradictory totals, positions, and mismatched real entities', () => {
    expect(() => normalizeInputLedgerValues({ totalPulls: 1, sixStarCount: 2 })).toThrow('不能超过总抽数');
    expect(() =>
      buildInputLedger(
        { poolId: 'real-pool', values: { totalPulls: 5, acquisitions: [acquisition({ pullIndex: 6 })] } },
        catalog
      )
    ).toThrow('位置');
    expect(() =>
      buildInputLedger(
        { poolId: 'real-pool', values: { acquisitions: [acquisition({ entityId: 'weapon-a' })] } },
        catalog
      )
    ).toThrow('类型不匹配');
    expect(() =>
      buildInputLedger(
        {
          poolId: 'real-pool',
          values: { acquisitions: [acquisition({ timePrecision: 'unknown', timestamp: '2026-01-23' })] },
        },
        catalog
      )
    ).toThrow('日期未知');
  });
});

describe('converted internal JSON', () => {
  it('preserves known day precision, unknown dates, explicit zero, source, and draw methods', () => {
    const json = payload({
      totalPulls: null,
      fiveStarCount: 0,
      acquisitions: [
        acquisition({ drawMethod: 'gift', entityId: undefined, intervalPulls: 20 }),
        acquisition({ id: 'acq-day', timePrecision: 'day', timestamp: '2026-01-23', isOffRate: false }),
      ],
    });
    json.supplements.workbenchEntries[0].source = 'manual';
    const result = parseConvertedWorkbenchJson(JSON.stringify(json), catalog);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ source: 'manual', derivation: 'declared', values: { fiveStarCount: 0 } });
    expect(result.entries[0].values).not.toHaveProperty('totalPulls');
    expect(result.entries[0].values.acquisitions[0]).toMatchObject({
      drawMethod: 'gift',
      intervalPulls: 20,
      timePrecision: 'unknown',
    });
    expect(result.entries[0].values.acquisitions[0]).not.toHaveProperty('timestamp');
    expect(result.entries[0].values.acquisitions[1]).toMatchObject({
      timestamp: '2026-01-23',
      timePrecision: 'day',
      isOffRate: false,
    });
  });

  it('converts known history into declared acquisitions in its summary without adding the summary twice', () => {
    const json = payload({ totalPulls: 80, sixStarCount: 1, acquisitions: [] }, { history: [historyRecord()] });
    const result = parseConvertedWorkbenchJson(json, catalog);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      source: 'file',
      derivation: 'declared',
      values: { totalPulls: 80, sixStarCount: 1 },
    });
    expect(result.entries[0].values.acquisitions).toHaveLength(1);
    expect(result.entries[0].values.acquisitions[0]).toMatchObject({
      entityId: 'six-a',
      timestamp: '2026-01-23T08:09:10Z',
      timePrecision: 'second',
    });
    expect(result.entries[0].values.acquisitions[0]).not.toHaveProperty('seqId');
    expect(result.entries[0].values.acquisitions[0].id).not.toBe('official-record');
    expect(result.historyChanges).toEqual([]);
    expect(result.warnings.join('')).toContain('手动声明');
  });

  it('rejects repeated original history identities and dates outside the summary range', () => {
    const duplicate = payload({ totalPulls: 80 }, { history: [historyRecord(), historyRecord()] });
    expect(() => parseConvertedWorkbenchJson(duplicate, catalog)).toThrow('重复明细');
    const outside = payload(
      { coverageMode: 'range', rangeStart: '2026-01-24', rangeEnd: '2026-01-25', totalPulls: 80 },
      { history: [historyRecord()] }
    );
    expect(() => parseConvertedWorkbenchJson(outside, catalog)).toThrow('覆盖范围之外');
    expect(() =>
      parseConvertedWorkbenchJson(
        payload({ acquisitions: [acquisition({ timePrecision: 'day', timestamp: '2026-02-30' })] }),
        catalog
      )
    ).toThrow('真实有效');
  });

  it('keeps free and normal known four-star counts in their actual draw methods', () => {
    const json = payload(undefined, {
      supplements: { schemaVersion: 1, workbenchEntries: [] },
      history: [
        historyRecord({ character_id: 'four-a', rarity: 4 }),
        historyRecord({ id: 'free-four', seqId: 'free-four-seq', character_id: 'four-a', rarity: 4, isFree: true }),
      ],
    });
    const result = parseConvertedWorkbenchJson(json, catalog);
    expect(result.entries).toHaveLength(2);
    expect(result.entries.map((entry) => entry.values)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ drawMethod: 'normal', fourStarCount: 1 }),
        expect.objectContaining({ drawMethod: 'free', fourStarCount: 1 }),
      ])
    );
    expect(result.entries.every((entry) => entry.values.totalPulls === undefined)).toBe(true);
  });

  it('explains wrong scope, unknown pools and entities, and unknown dates in history', () => {
    expect(() =>
      parseConvertedWorkbenchJson(payload({}, { accounts: [{ ...scope, gameUid: 'other' }] }), catalog)
    ).toThrow('其他账号');
    const foreign = payload();
    foreign.supplements.workbenchEntries[0].serverScope = 'intl';
    expect(() => parseConvertedWorkbenchJson(foreign, catalog)).toThrow('不一致');
    const wrongPool = payload();
    wrongPool.supplements.workbenchEntries[0].poolId = 'fake-pool';
    expect(() => parseConvertedWorkbenchJson(wrongPool, catalog)).toThrow('未知卡池');
    expect(() =>
      parseConvertedWorkbenchJson(payload({ acquisitions: [acquisition({ entityId: 'fake-entity' })] }), catalog)
    ).toThrow('未知角色');
    expect(() =>
      parseConvertedWorkbenchJson(payload(undefined, { history: [historyRecord({ timestamp: undefined })] }), catalog)
    ).toThrow('日期未知');
    expect(() => parseConvertedWorkbenchJson('```json\n{}\n```', catalog)).toThrow('纯 JSON');
  });

  it('whitelists real catalog and selected scope and excludes caller credentials from templates and prompts', () => {
    const options = {
      scope: { ...scope, ownerId: 'secret-owner', token: 'secret-token' },
      pools: [{ ...pools[0], credential: 'pool-secret' }],
      entities,
      selectedPoolId: 'real-pool',
    };
    const template = buildWorkbenchConversionTemplate(options);
    expect(template).toMatchObject({ formatId: 'internal_json_v3', accounts: [scope], pools: [{ id: 'real-pool' }] });
    expect(template.entityMap).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'six-a' })]));
    expect(template.history).toEqual([]);
    expect(template.supplements.workbenchEntries).toEqual([]);
    const prompt = buildImportConvertPrompt(options);
    for (const secret of ['secret-owner', 'secret-token', 'pool-secret']) expect(prompt).not.toContain(secret);
    expect(prompt).toContain('DeepSeek');
    expect(prompt).toContain('深度思考');
    expect(prompt).toContain('不得补造时分秒');
    expect(prompt).toContain('不输出登录账号');
    expect(prompt).toContain('timePrecision');
  });
});
