const KNOWN_UNKNOWN_ITEM_NAMES = new Set([
  '',
  '未知',
  'unknown',
  '未知目标',
  '未知角色或武器',
]);

export function getImportAnomalyItems(result = {}) {
  return Array.isArray(result?.summary?.anomalyItems)
    ? result.summary.anomalyItems.filter(Boolean)
    : [];
}

export function getImportAnomalyCount(result = {}) {
  const summary = result?.summary || {};
  return Math.max(
    Number(summary.anomalyRecords || 0),
    getImportAnomalyItems(result).length,
  );
}

export function getImportAnomalyMessage(anomaly = {}, t) {
  if (anomaly?.issueCode === 'OFFICIAL_IMPORT_UNKNOWN_ITEM' || anomaly?.issue_code === 'OFFICIAL_IMPORT_UNKNOWN_ITEM') {
    return t('import.anomaly.missingIdentity');
  }
  return anomaly?.message || '';
}

export function getImportAnomalyDisplayName(
  anomaly = {},
  t,
  unknownItemKey = 'import.anomaly.unknownItem',
) {
  const rawName = String(
    anomaly?.itemName
    || anomaly?.details?.itemName
    || anomaly?.details?.item_name
    || '',
  ).trim();
  if (
    KNOWN_UNKNOWN_ITEM_NAMES.has(rawName.toLowerCase())
    || KNOWN_UNKNOWN_ITEM_NAMES.has(rawName)
  ) {
    return t(unknownItemKey);
  }
  return rawName || t(unknownItemKey);
}

export function hasImportPoolFetchIssues(result = {}) {
  const summary = result?.summary || {};
  const partialPools = Array.isArray(summary.partialPools) ? summary.partialPools : [];
  const failedPools = Array.isArray(summary.failedPools) ? summary.failedPools : [];
  return partialPools.length > 0 || failedPools.length > 0;
}

export function getVisibleImportWarnings(result = {}, t) {
  const summary = result?.summary || {};
  const warnings = Array.isArray(summary.warnings) ? summary.warnings : [];
  let hasSkippedRecordWarning = false;

  const visibleWarnings = warnings.map((warning) => {
    const code = typeof warning === 'object' ? String(warning?.code || '') : '';
    const text = typeof warning === 'string'
      ? warning.trim()
      : String(warning?.message || '').trim();
    if (code === 'OFFICIAL_IMPORT_ANOMALY_RECORDS') {
      return '';
    }
    if (code === 'OFFICIAL_IMPORT_ANOMALY_REMINDER_FAILED') {
      return t('import.warning.anomalyReminderFailed');
    }
    if (code === 'OFFICIAL_IMPORT_UNSAFE_RECORDS_SKIPPED') {
      hasSkippedRecordWarning = true;
      return t('import.warning.skippedRecords', {
        count: Number(warning?.count ?? summary.skippedRecords ?? 0),
      });
    }
    if (code === 'OFFICIAL_IMPORT_NON_PULL_REPAIR_FAILED') {
      return t('import.warning.nonPullRepairFailed', {
        count: Number(warning?.count || 0),
      });
    }
    if (!text) {
      return '';
    }

    if (Number(summary.anomalyRecords || 0) > 0 && text.includes('已导入记录需要后续核对')) {
      return '';
    }
    if (text.includes('异常提醒创建失败')) {
      return t('import.warning.anomalyReminderFailed');
    }
    if (text.includes('无法安全写入')) {
      hasSkippedRecordWarning = true;
      return t('import.warning.skippedRecords', {
        count: Number(summary.skippedRecords || 0),
      });
    }
    return text;
  }).filter(Boolean);

  if (Number(summary.skippedRecords || 0) > 0 && !hasSkippedRecordWarning) {
    visibleWarnings.unshift(t('import.warning.skippedRecords', {
      count: Number(summary.skippedRecords),
    }));
  }

  return visibleWarnings;
}

export function shouldAutoCloseSuccessfulImport(result = {}) {
  if (!result?.success) {
    return false;
  }

  const summary = result.summary || {};
  const anomalyRecords = Math.max(
    Number(summary.anomalyRecords || 0),
    getImportAnomalyItems(result).length
  );
  const skippedRecords = Number(summary.skippedRecords || 0);
  const partialPools = Array.isArray(summary.partialPools) ? summary.partialPools : [];
  const failedPools = Array.isArray(summary.failedPools) ? summary.failedPools : [];
  const warnings = Array.isArray(summary.warnings) ? summary.warnings.filter(Boolean) : [];

  return anomalyRecords === 0
    && skippedRecords === 0
    && partialPools.length === 0
    && failedPools.length === 0
    && warnings.length === 0;
}

export default {
  getImportAnomalyCount,
  getImportAnomalyDisplayName,
  getImportAnomalyMessage,
  getImportAnomalyItems,
  hasImportPoolFetchIssues,
  getVisibleImportWarnings,
  shouldAutoCloseSuccessfulImport,
};
