import { describe, expect, it } from 'vitest';

import {
  getImportAnomalyCount,
  getImportAnomalyDisplayName,
  getImportAnomalyMessage,
  getImportAnomalyItems,
  getVisibleImportWarnings,
  hasImportPoolFetchIssues,
  shouldAutoCloseSuccessfulImport,
} from '../importCompletionPolicy.js';

describe('importCompletionPolicy', () => {
  it('closes a clean successful import without showing a confirmation screen', () => {
    expect(shouldAutoCloseSuccessfulImport({
      success: true,
      summary: {
        anomalyRecords: 0,
        skippedRecords: 0,
        partialPools: [],
        failedPools: [],
        warnings: [],
      },
    })).toBe(true);
  });

  it.each([
    { anomalyRecords: 1 },
    { anomalyItems: [{ recordId: 'record-1' }] },
    { skippedRecords: 1 },
    { partialPools: [{ type: 'char' }] },
    { failedPools: [{ type: 'weapon' }] },
    { warnings: ['异常提醒创建失败'] },
  ])('keeps the result open when user attention is required: %o', (override) => {
    expect(shouldAutoCloseSuccessfulImport({
      success: true,
      summary: {
        anomalyRecords: 0,
        skippedRecords: 0,
        partialPools: [],
        failedPools: [],
        warnings: [],
        ...override,
      },
    })).toBe(false);
  });

  it('returns only the abnormal record summaries supplied by the backend', () => {
    const anomaly = {
      recordId: 'record-1',
      poolId: 'special_demo',
      seqId: '42',
      itemName: '未知角色或武器',
    };

    expect(getImportAnomalyItems({
      summary: {
        anomalyItems: [anomaly, null],
      },
    })).toEqual([anomaly]);
  });

  it('uses item summaries when the backend anomaly count is stale', () => {
    expect(getImportAnomalyCount({
      summary: {
        anomalyRecords: 0,
        anomalyItems: [{ recordId: 'record-1' }, { recordId: 'record-2' }],
      },
    })).toBe(2);
  });

  it('localizes official unknown-item placeholders instead of exposing backend copy', () => {
    const t = (key) => `translated:${key}`;

    expect(getImportAnomalyDisplayName({
      issue_code: 'OFFICIAL_IMPORT_UNKNOWN_ITEM',
      details: { itemName: '未知角色或武器' },
    }, t)).toBe('translated:import.anomaly.unknownItem');
  });

  it('detects partial and failed pool fetches', () => {
    expect(hasImportPoolFetchIssues({ summary: { partialPools: [{ type: 'char' }] } })).toBe(true);
    expect(hasImportPoolFetchIssues({ summary: { failedPools: [{ type: 'weapon' }] } })).toBe(true);
    expect(hasImportPoolFetchIssues({ summary: { partialPools: [], failedPools: [] } })).toBe(false);
  });

  it('uses the localized explanation for a known identity anomaly', () => {
    const t = (key) => `translated:${key}`;

    expect(getImportAnomalyMessage({
      issueCode: 'OFFICIAL_IMPORT_UNKNOWN_ITEM',
      message: '后端中文说明',
    }, t)).toBe('translated:import.anomaly.missingIdentity');
  });

  it('localizes known backend warnings and hides the duplicate anomaly summary', () => {
    const t = (key, values = {}) => `${key}:${values.count ?? ''}`;

    expect(getVisibleImportWarnings({
      summary: {
        anomalyRecords: 1,
        skippedRecords: 2,
        warnings: [
          '有 1 条已导入记录需要后续核对。',
          '有 2 条记录缺少卡池、账号、序号、时间或有效品质，无法安全写入。',
          '记录已写入，但异常提醒创建失败：数据库暂时不可用',
        ],
      },
    }, t)).toEqual([
      'import.warning.skippedRecords:2',
      'import.warning.anomalyReminderFailed:',
    ]);
  });

  it('derives a skipped-record warning even when an older backend omits warning text', () => {
    const t = (key, values = {}) => `${key}:${values.count ?? ''}`;

    expect(getVisibleImportWarnings({
      summary: {
        skippedRecords: 3,
        warnings: [],
      },
    }, t)).toEqual(['import.warning.skippedRecords:3']);
  });

  it('localizes a structured legacy Intel Book repair warning', () => {
    const t = (key, values = {}) => `${key}:${values.count ?? ''}`;

    expect(getVisibleImportWarnings({
      summary: {
        warnings: [{ code: 'OFFICIAL_IMPORT_NON_PULL_REPAIR_FAILED', count: 2 }],
      },
    }, t)).toEqual(['import.warning.nonPullRepairFailed:2']);
  });
});
