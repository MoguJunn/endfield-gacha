import { getSupabaseAdminClient } from './authAdmin.js';
import {
  buildCombinedAnnouncementSourceRecords,
  buildOfficialAnnouncementRecordsFromSources,
} from './officialAnnouncementsFeed.js';
import {
  shouldSummarizeAnnouncement,
  stripHtmlToText,
} from './officialAnnouncementPresentation.js';
import { refreshGameAnnouncementDigest } from './gameAnnouncementDigest.js';

const DEFAULT_PAGE_SIZE = 30;
const FULL_REFRESH_PAGE_SIZE = 50;
const MIN_REFRESH_PAGE_SIZE = 1;
const MAX_REFRESH_PAGE_SIZE = 100;
const GAME_ANNOUNCEMENT_PRIORITY = 0;
const ANNOUNCEMENT_TITLE_MAX_LENGTH = 100;
const ANNOUNCEMENT_CONTENT_MAX_LENGTH = 5000;
const ANNOUNCEMENT_VERSION_MAX_LENGTH = 20;
const ANNOUNCEMENT_REFRESH_MODES = Object.freeze({
  INCREMENTAL: 'incremental',
  SUMMARY: 'summary',
  ALL: 'all',
});

const SYNC_COMPARE_FIELDS = [
  'title',
  'summary',
  'content',
  'version',
  'published_at',
  'source_url',
  'is_active',
  'priority',
];

function normalizeComparableValue(value) {
  if (value == null) {
    return '';
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return String(value);
}

function isAnnouncementRecordChanged(currentRecord = {}, nextRecord = {}) {
  return SYNC_COMPARE_FIELDS.some((field) => (
    normalizeComparableValue(currentRecord[field]) !== normalizeComparableValue(nextRecord[field])
  ));
}

function truncateDbText(value, maxLength, suffix = '…') {
  const normalizedValue = String(value || '').trim();
  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  const normalizedSuffix = String(suffix || '');
  const availableLength = Math.max(1, maxLength - normalizedSuffix.length);
  return `${normalizedValue.slice(0, availableLength).trimEnd()}${normalizedSuffix}`;
}

function normalizePersistedAnnouncementRecord(record = {}) {
  const title = truncateDbText(record.title || '官方公告', ANNOUNCEMENT_TITLE_MAX_LENGTH);
  const summary = String(record.summary || '').trim();
  const fallbackContent = summary || title || '官方公告内容请查看原文。';
  const content = truncateDbText(
    record.content || fallbackContent,
    ANNOUNCEMENT_CONTENT_MAX_LENGTH,
    '\n\n> 内容因数据库长度限制已裁剪，请查看官方原文。'
  ) || fallbackContent;

  return {
    ...record,
    title,
    summary,
    content,
    version: truncateDbText(record.version || 'hg-unknown', ANNOUNCEMENT_VERSION_MAX_LENGTH, ''),
  };
}

function normalizeAnnouncementRefreshMode({ refreshMode, forceRefresh = false } = {}) {
  const normalizedValue = String(refreshMode || '').trim().toLowerCase();
  if (Object.values(ANNOUNCEMENT_REFRESH_MODES).includes(normalizedValue)) {
    return normalizedValue;
  }

  return forceRefresh ? ANNOUNCEMENT_REFRESH_MODES.SUMMARY : ANNOUNCEMENT_REFRESH_MODES.INCREMENTAL;
}

function normalizeAnnouncementRefreshLimit(value, fallback = FULL_REFRESH_PAGE_SIZE) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(
    MAX_REFRESH_PAGE_SIZE,
    Math.max(MIN_REFRESH_PAGE_SIZE, Math.floor(numericValue))
  );
}

function isLongAnnouncementSourceRecord(record = {}) {
  return shouldSummarizeAnnouncement({
    title: record.title,
    plainText: stripHtmlToText(record.raw_content || record.content || ''),
  });
}

function shouldRefreshAnnouncementRecord(existingRecord, nextRawRecord, {
  forceRefresh = false,
  refreshMode = null,
} = {}) {
  const normalizedMode = normalizeAnnouncementRefreshMode({ refreshMode, forceRefresh });

  if (normalizedMode === ANNOUNCEMENT_REFRESH_MODES.ALL) {
    return true;
  }

  if (normalizedMode === ANNOUNCEMENT_REFRESH_MODES.SUMMARY) {
    return isLongAnnouncementSourceRecord(nextRawRecord);
  }

  if (!existingRecord) {
    return true;
  }

  if (!normalizeComparableValue(existingRecord.content)) {
    return true;
  }

  return normalizeComparableValue(existingRecord.version) !== normalizeComparableValue(nextRawRecord.version);
}

function normalizeExistingAnnouncementAsSourceRecord(record = {}) {
  return {
    source_id: String(record.source_id || ''),
    title: record.title || '官方公告',
    summary: record.summary || null,
    raw_content: record.content || '',
    version: record.version || `db-${record.source_id || record.id || 'unknown'}`,
    published_at: record.published_at || null,
    source_url: record.source_url || null,
    is_active: record.is_active !== false,
  };
}

function buildWarningMessage(...messages) {
  const normalizedMessages = messages
    .flat()
    .map(message => String(message || '').trim())
    .filter(Boolean);

  return normalizedMessages.length > 0 ? normalizedMessages.join('；') : undefined;
}

async function loadExistingAnnouncementSourceRecords(supabase, limit = FULL_REFRESH_PAGE_SIZE) {
  const { data, error } = await supabase
    .from('announcements')
    .select('id, source_id, title, summary, content, version, published_at, source_url, is_active')
    .eq('is_active', true)
    .not('source_id', 'is', null)
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data || [])
    .map(normalizeExistingAnnouncementAsSourceRecord)
    .filter(record => record.source_id && record.title);
}

async function persistAnnouncementRecord(supabase, record, isExistingRecord) {
  if (isExistingRecord) {
    return supabase
      .from('announcements')
      .update(record)
      .eq('source_id', record.source_id);
  }

  return supabase
    .from('announcements')
    .insert(record);
}

export async function syncAnnouncements({
  forceRefresh = false,
  refreshMode = null,
  announcementLimit = null,
} = {}) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return { synced: 0, skipped: 0, error: 'Database not configured' };
  }

  const normalizedRefreshMode = normalizeAnnouncementRefreshMode({ refreshMode, forceRefresh });
  const normalizedAnnouncementLimit = normalizeAnnouncementRefreshLimit(announcementLimit);
  const pageSize = normalizedRefreshMode === ANNOUNCEMENT_REFRESH_MODES.ALL
    ? normalizedAnnouncementLimit
    : DEFAULT_PAGE_SIZE;
  let sourceFetchError = null;
  let sourceFallbackUsed = false;
  let rawRecords = [];
  try {
    rawRecords = await buildCombinedAnnouncementSourceRecords(pageSize);
  } catch (error) {
    sourceFetchError = error;
    if (normalizedRefreshMode === ANNOUNCEMENT_REFRESH_MODES.INCREMENTAL) {
      return {
        synced: 0,
        skipped: 0,
        summarized: 0,
        total: 0,
        forceRefresh: false,
        refreshMode: normalizedRefreshMode,
        announcementLimit: pageSize,
        error: error?.message || '官方公告源抓取失败',
      };
    }

    rawRecords = await loadExistingAnnouncementSourceRecords(supabase, pageSize);
    sourceFallbackUsed = true;
  }

  if (rawRecords.length === 0) {
    return {
      synced: 0,
      skipped: 0,
      summarized: 0,
      total: 0,
      forceRefresh: normalizedRefreshMode !== ANNOUNCEMENT_REFRESH_MODES.INCREMENTAL,
      refreshMode: normalizedRefreshMode,
      announcementLimit: pageSize,
      warning: sourceFetchError
        ? `官方公告源抓取失败，且数据库中没有可回退公告：${sourceFetchError.message}`
        : undefined,
    };
  }

  const sourceWarning = sourceFetchError
    ? `官方公告源抓取失败，已使用数据库现有公告重算：${sourceFetchError.message}`
    : undefined;
  let digestRefreshResult = null;
  let digestWarning = undefined;

  try {
    digestRefreshResult = await refreshGameAnnouncementDigest(supabase, rawRecords, {
      forceRefresh: normalizedRefreshMode !== ANNOUNCEMENT_REFRESH_MODES.INCREMENTAL,
    });
  } catch (error) {
    digestWarning = `首页公告聚合摘要刷新失败：${error?.message || '未知错误'}`;
  }

  const sourceDigestWarning = buildWarningMessage(sourceWarning, digestWarning);

  const sourceIds = rawRecords.map(record => String(record.source_id));

  const { data: existing, error: selectError } = await supabase
    .from('announcements')
    .select('source_id, title, summary, content, version, published_at, source_url, is_active, priority')
    .in('source_id', sourceIds);
  if (selectError) {
    return {
      synced: 0,
      skipped: 0,
      summarized: 0,
      total: rawRecords.length,
      forceRefresh: normalizedRefreshMode !== ANNOUNCEMENT_REFRESH_MODES.INCREMENTAL,
      refreshMode: normalizedRefreshMode,
      announcementLimit: pageSize,
      sourceFallbackUsed,
      warning: sourceDigestWarning,
      error: selectError.message,
      digest: digestRefreshResult,
      records: rawRecords,
      rawRecords,
    };
  }

  const existingById = new Map((existing || []).map(r => [String(r.source_id), r]));
  const recordsNeedingSummary = rawRecords.filter((record) => {
    const existingRecord = existingById.get(String(record.source_id));
    return shouldRefreshAnnouncementRecord(existingRecord, record, {
      refreshMode: normalizedRefreshMode,
      forceRefresh,
    });
  });

  if (recordsNeedingSummary.length === 0) {
    return {
      synced: 0,
      created: 0,
      updated: 0,
      skipped: rawRecords.length,
      summarized: 0,
      total: rawRecords.length,
      forceRefresh: normalizedRefreshMode !== ANNOUNCEMENT_REFRESH_MODES.INCREMENTAL,
      refreshMode: normalizedRefreshMode,
      announcementLimit: pageSize,
      sourceFallbackUsed,
      warning: sourceDigestWarning,
      digest: digestRefreshResult,
      records: rawRecords,
      rawRecords,
    };
  }

  const records = await buildOfficialAnnouncementRecordsFromSources(recordsNeedingSummary, {
    allowLlm: true,
    bypassLlmCache: normalizedRefreshMode !== ANNOUNCEMENT_REFRESH_MODES.INCREMENTAL,
    allowHeuristicSummary: false,
  });
  const summaryErrorRecords = records.filter(record => record.summary_mode === 'llm_failed');
  const summaryErrors = summaryErrorRecords.map(record => ({
    source_id: record.source_id,
    title: record.title,
    error: record.summary_error || 'LLM 摘要生成失败',
  }));
  const summaryFailed = summaryErrors.length;
  const summaryWarning = summaryFailed > 0
    ? `LLM 摘要失败 ${summaryFailed} 条，已保留数据库现有内容，未用原文覆盖摘要`
    : undefined;
  const syncWarning = buildWarningMessage(sourceDigestWarning, summaryWarning);
  const persistableRecords = records.filter(record => record.summary_mode !== 'llm_failed');

  const persistRecords = persistableRecords.map(record => normalizePersistedAnnouncementRecord({
    source_id: record.source_id,
    title: record.title,
    summary: record.summary,
    content: record.content,
    version: record.version,
    published_at: record.published_at,
    source_url: record.source_url,
    is_active: true,
    priority: GAME_ANNOUNCEMENT_PRIORITY,
  }));

  const recordsToPersist = normalizedRefreshMode === ANNOUNCEMENT_REFRESH_MODES.INCREMENTAL
    ? persistRecords.filter((record) => {
      const existingRecord = existingById.get(String(record.source_id));
      return !existingRecord || isAnnouncementRecordChanged(existingRecord, record);
    })
    : persistRecords;

  if (recordsToPersist.length === 0) {
    return {
      synced: 0,
      created: 0,
      updated: 0,
      skipped: rawRecords.length,
      summarized: records.length,
      total: rawRecords.length,
      forceRefresh: normalizedRefreshMode !== ANNOUNCEMENT_REFRESH_MODES.INCREMENTAL,
      refreshMode: normalizedRefreshMode,
      announcementLimit: pageSize,
      sourceFallbackUsed,
      warning: syncWarning,
      summaryFailed,
      summaryErrors: summaryErrors.length > 0 ? summaryErrors : undefined,
      digest: digestRefreshResult,
      records: rawRecords,
      updatedRecords: records,
      rawRecords,
    };
  }

  let synced = 0;
  let created = 0;
  let updated = 0;
  const errors = [];

  for (const record of recordsToPersist) {
    try {
      const isExistingRecord = existingById.has(String(record.source_id));
      const { error } = await persistAnnouncementRecord(supabase, record, isExistingRecord);

      if (error) throw error;
      synced++;
      if (isExistingRecord) {
        updated++;
      } else {
        created++;
      }
    } catch (err) {
      errors.push({ source_id: record.source_id, title: record.title, error: err.message });
    }
  }

  const skipped = rawRecords.length - recordsToPersist.length;
  return {
    synced,
    created,
    updated,
    skipped,
    summarized: records.length,
    total: rawRecords.length,
    forceRefresh: normalizedRefreshMode !== ANNOUNCEMENT_REFRESH_MODES.INCREMENTAL,
    refreshMode: normalizedRefreshMode,
    announcementLimit: pageSize,
    sourceFallbackUsed,
    warning: syncWarning,
    summaryFailed,
    summaryErrors: summaryErrors.length > 0 ? summaryErrors : undefined,
    digest: digestRefreshResult,
    error: errors.length > 0 && synced === 0 ? '公告写入数据库失败' : undefined,
    errors: errors.length > 0 ? errors : undefined,
    records: rawRecords,
    updatedRecords: records,
    rawRecords,
  };
}

export const __internal = {
  ANNOUNCEMENT_REFRESH_MODES,
  ANNOUNCEMENT_CONTENT_MAX_LENGTH,
  ANNOUNCEMENT_TITLE_MAX_LENGTH,
  ANNOUNCEMENT_VERSION_MAX_LENGTH,
  FULL_REFRESH_PAGE_SIZE,
  MAX_REFRESH_PAGE_SIZE,
  MIN_REFRESH_PAGE_SIZE,
  GAME_ANNOUNCEMENT_PRIORITY,
  isAnnouncementRecordChanged,
  isLongAnnouncementSourceRecord,
  loadExistingAnnouncementSourceRecords,
  normalizeAnnouncementRefreshMode,
  normalizeAnnouncementRefreshLimit,
  normalizeExistingAnnouncementAsSourceRecord,
  normalizePersistedAnnouncementRecord,
  persistAnnouncementRecord,
  shouldRefreshAnnouncementRecord,
};
