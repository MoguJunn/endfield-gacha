import { createHash } from 'node:crypto';
import { rejectDisallowedBrowserOrigin } from './http.js';
import {
  buildAnnouncementDisplayContent,
  normalizeOfficialHtml,
} from './officialAnnouncementPresentation.js';
import { getSupabaseAdminClient } from './authAdmin.js';
import { buildGameBulletinSourceRecords } from './gameBulletinFeed.js';

const OFFICIAL_NEWS_BASE_URL = 'https://web-news.hypergryph.com/api';
const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_GAME_BULLETIN_PAGE_SIZE = 30;
const OFFICIAL_NEWS_REQUEST_TIMEOUT_MS = 15000;
const OFFICIAL_NEWS_HEADERS = Object.freeze({
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Referer: 'https://endfield.hypergryph.com/',
  Origin: 'https://endfield.hypergryph.com',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
});
const cache = {
  records: null,
  fetchedAt: 0,
};
const CACHE_TTL_MS = 5 * 60 * 1000;

function buildOfficialArticleUrl(cid) {
  return `https://endfield.hypergryph.com/news/${cid}`;
}

function createContentHash(...values) {
  return createHash('sha256')
    .update(values.map((value) => String(value || '').replace(/\s+/g, ' ').trim()).join('\n'))
    .digest('hex')
    .slice(0, 8);
}

function buildVersion(displayTime, cid, title, summary, rawContent) {
  return `hg-${createContentHash(displayTime, cid, title, summary, rawContent)}`;
}

function buildPublishedAt(displayTime) {
  if (!displayTime) {
    return null;
  }

  return new Date(Number(displayTime) * 1000).toISOString();
}

async function loadOfficialAnnouncementRecordsFromDatabase(limit = DEFAULT_PAGE_SIZE) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from('announcements')
    .select('source_id, title, summary, content, version, published_at, source_url, is_active')
    .eq('is_active', true)
    .not('source_id', 'is', null)
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data || [])
    .filter(record => record?.source_id && record?.title)
    .map(record => ({
      source_id: String(record.source_id),
      title: record.title,
      summary: record.summary || record.title,
      content: record.content || record.summary || record.title,
      raw_content: record.content || '',
      image_urls: [],
      summary_mode: 'database',
      summary_error: null,
      version: record.version || `db-${record.source_id}`,
      published_at: record.published_at || null,
      source_url: record.source_url || null,
      is_active: record.is_active !== false,
    }));
}

async function fetchOfficialNewsJson(url, fetchImpl = globalThis.fetch) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), OFFICIAL_NEWS_REQUEST_TIMEOUT_MS)
    : null;

  let response;
  try {
    response = await fetchImpl(url, {
      headers: OFFICIAL_NEWS_HEADERS,
      signal: controller?.signal,
    });
  } catch (error) {
    const reason = error?.name === 'AbortError'
      ? `timeout after ${OFFICIAL_NEWS_REQUEST_TIMEOUT_MS}ms`
      : (error?.message || String(error));
    throw new Error(`Official news API fetch failed: ${reason}`);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Official news API returned ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  if (result?.code !== 0) {
    throw new Error(result?.msg || 'Official news API returned non-zero code');
  }

  return result?.data ?? null;
}

async function fetchOfficialNewsList(pageSize = DEFAULT_PAGE_SIZE, fetchImpl = globalThis.fetch) {
  const query = new URLSearchParams({
    lang: 'zh-cn',
    code: 'endfield_web',
    page: '1',
    pageSize: String(pageSize),
  });

  return fetchOfficialNewsJson(`${OFFICIAL_NEWS_BASE_URL}/bulletin?${query.toString()}`, fetchImpl);
}

async function fetchOfficialNewsDetail(cid, fetchImpl = globalThis.fetch) {
  const query = new URLSearchParams({
    lang: 'zh-cn',
    code: 'endfield_web',
  });

  return fetchOfficialNewsJson(`${OFFICIAL_NEWS_BASE_URL}/bulletin/${cid}?${query.toString()}`, fetchImpl);
}

export async function buildOfficialAnnouncementSourceRecords(pageSize = DEFAULT_PAGE_SIZE, {
  fetchImpl = globalThis.fetch,
} = {}) {
  const listPayload = await fetchOfficialNewsList(pageSize, fetchImpl);
  const list = Array.isArray(listPayload?.list) ? listPayload.list : [];

  const validList = list.filter(item => item?.cid && item?.title);
  const detailResults = await Promise.allSettled(
    validList.map(async (item) => {
      const detail = await fetchOfficialNewsDetail(item.cid, fetchImpl);
      return {
        ...item,
        ...detail,
      };
    })
  );
  const details = detailResults
    .filter(result => result.status === 'fulfilled')
    .map(result => result.value);

  if (validList.length > 0 && details.length === 0) {
    const firstError = detailResults.find(result => result.status === 'rejected')?.reason;
    throw new Error(`Official news detail API failed for all records: ${firstError?.message || 'unknown error'}`);
  }

  return details.map((detail) => {
    const publishedAt = buildPublishedAt(detail.displayTime);
    const sourceUrl = buildOfficialArticleUrl(detail.cid);
    const normalizedSummary = typeof detail.brief === 'string' && detail.brief.trim()
      ? detail.brief.trim()
      : null;
    const rawContent = normalizeOfficialHtml(detail.data || '', sourceUrl);

    return {
      source_id: String(detail.cid),
      title: String(detail.title || ''),
      summary: normalizedSummary,
      raw_content: rawContent,
      version: buildVersion(detail.displayTime, detail.cid, detail.title, normalizedSummary, rawContent),
      published_at: publishedAt,
      source_url: sourceUrl,
      is_active: true,
      source_kind: 'official-site',
      source_category: 'official',
    };
  });
}

export async function buildOfficialAnnouncementRecordsFromSources(sourceRecords = [], {
  fetchImpl = globalThis.fetch,
  env = process.env,
  allowLlm = false,
  bypassLlmCache = false,
  allowHeuristicSummary = true,
} = {}) {
  return Promise.all(sourceRecords.map(async (detail) => {
    const presentation = await buildAnnouncementDisplayContent({
      title: detail.title,
      summary: detail.summary,
      rawHtml: detail.raw_content || '',
      sourceUrl: detail.source_url,
      publishedAt: detail.published_at,
      fetchImpl,
      env,
      allowLlm,
      bypassLlmCache,
      allowHeuristicSummary,
    });

    return {
      source_id: detail.source_id,
      title: detail.title,
      summary: presentation.summaryText || detail.summary,
      content: presentation.content,
      raw_content: presentation.rawContent,
      image_urls: presentation.imageUrls,
      summary_mode: presentation.summaryMode,
      summary_error: presentation.summaryError || null,
      version: detail.version,
      published_at: detail.published_at,
      source_url: detail.source_url,
      is_active: true,
      source_kind: detail.source_kind || null,
      source_category: detail.source_category || detail.tab || null,
      display_type: detail.display_type || null,
    };
  }));
}

export async function buildCombinedAnnouncementSourceRecords(pageSize = DEFAULT_PAGE_SIZE, {
  fetchImpl = globalThis.fetch,
} = {}) {
  const requestedPageSize = Number(pageSize) || DEFAULT_PAGE_SIZE;
  const [gameResult, officialResult] = await Promise.allSettled([
    buildGameBulletinSourceRecords(
      Math.max(requestedPageSize, DEFAULT_GAME_BULLETIN_PAGE_SIZE),
      { fetchImpl }
    ),
    buildOfficialAnnouncementSourceRecords(requestedPageSize, { fetchImpl }),
  ]);

  const records = [];
  const errors = [];

  if (gameResult.status === 'fulfilled') {
    records.push(...gameResult.value);
  } else {
    errors.push(`Game bulletin source failed: ${gameResult.reason?.message || 'unknown error'}`);
  }

  if (officialResult.status === 'fulfilled') {
    records.push(...officialResult.value);
  } else {
    errors.push(`Official news source failed: ${officialResult.reason?.message || 'unknown error'}`);
  }

  if (records.length === 0) {
    throw new Error(errors.join('; ') || 'No announcement source returned records');
  }

  return records.sort((a, b) => (
    new Date(b?.published_at || 0) - new Date(a?.published_at || 0)
  ));
}

export async function buildCombinedAnnouncementRecords(pageSize = DEFAULT_PAGE_SIZE, {
  fetchImpl = globalThis.fetch,
  env = process.env,
  allowLlm = false,
  bypassLlmCache = false,
  allowHeuristicSummary = true,
} = {}) {
  const sourceRecords = await buildCombinedAnnouncementSourceRecords(pageSize, { fetchImpl });
  return buildOfficialAnnouncementRecordsFromSources(sourceRecords, {
    fetchImpl,
    env,
    allowLlm,
    bypassLlmCache,
    allowHeuristicSummary,
  });
}

export async function buildOfficialAnnouncementRecords(pageSize = DEFAULT_PAGE_SIZE, {
  fetchImpl = globalThis.fetch,
  env = process.env,
  allowLlm = false,
  bypassLlmCache = false,
  allowHeuristicSummary = true,
} = {}) {
  const sourceRecords = await buildOfficialAnnouncementSourceRecords(pageSize, { fetchImpl });
  return buildOfficialAnnouncementRecordsFromSources(sourceRecords, {
    fetchImpl,
    env,
    allowLlm,
    bypassLlmCache,
    allowHeuristicSummary,
  });
}

export async function buildPreferredAnnouncementSourceRecords(pageSize = DEFAULT_PAGE_SIZE, {
  fetchImpl = globalThis.fetch,
} = {}) {
  try {
    return await buildGameBulletinSourceRecords(
      Math.max(Number(pageSize) || DEFAULT_PAGE_SIZE, DEFAULT_GAME_BULLETIN_PAGE_SIZE),
      { fetchImpl }
    );
  } catch (gameBulletinError) {
    try {
      return await buildOfficialAnnouncementSourceRecords(pageSize, { fetchImpl });
    } catch (officialNewsError) {
      throw new Error([
        `Game bulletin source failed: ${gameBulletinError?.message || 'unknown error'}`,
        `Official news source failed: ${officialNewsError?.message || 'unknown error'}`,
      ].join('; '));
    }
  }
}

export async function buildPreferredAnnouncementRecords(pageSize = DEFAULT_PAGE_SIZE, {
  fetchImpl = globalThis.fetch,
  env = process.env,
  allowLlm = false,
  bypassLlmCache = false,
  allowHeuristicSummary = true,
} = {}) {
  const sourceRecords = await buildPreferredAnnouncementSourceRecords(pageSize, { fetchImpl });
  return buildOfficialAnnouncementRecordsFromSources(sourceRecords, {
    fetchImpl,
    env,
    allowLlm,
    bypassLlmCache,
    allowHeuristicSummary,
  });
}

export async function handleOfficialAnnouncementsFeed(req, res) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800');

  if (rejectDisallowedBrowserOrigin(req, res, {
    methods: 'GET, OPTIONS',
    headers: 'Content-Type',
  })) {
    return;
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  }

  const now = Date.now();
  if (cache.records && now - cache.fetchedAt < CACHE_TTL_MS) {
    return res.status(200).json({
      success: true,
      cached: true,
      records: cache.records,
    });
  }

  try {
    const records = await buildCombinedAnnouncementRecords(DEFAULT_PAGE_SIZE, {
      allowLlm: false,
      allowHeuristicSummary: false,
    });
    cache.records = records;
    cache.fetchedAt = now;

    return res.status(200).json({
      success: true,
      cached: false,
      records,
    });
  } catch (error) {
    if (cache.records) {
      return res.status(200).json({
        success: true,
        cached: true,
        stale: true,
        records: cache.records,
        warning: error?.message || 'Official announcement feed refresh failed',
      });
    }

    try {
      const records = await loadOfficialAnnouncementRecordsFromDatabase(DEFAULT_PAGE_SIZE);
      if (records.length > 0) {
        cache.records = records;
        cache.fetchedAt = now;
        return res.status(200).json({
          success: true,
          cached: false,
          databaseFallback: true,
          records,
          warning: error?.message || 'Official announcement feed refresh failed',
        });
      }
    } catch {
      // Fall through to the original source-fetch error below.
    }

    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to build official announcements feed',
    });
  }
}

export default async function handler(req, res) {
  await handleOfficialAnnouncementsFeed(req, res);
}

export const __internal = {
  buildOfficialAnnouncementRecords,
  buildOfficialAnnouncementRecordsFromSources,
  buildOfficialAnnouncementSourceRecords,
  buildCombinedAnnouncementRecords,
  buildCombinedAnnouncementSourceRecords,
  buildPreferredAnnouncementRecords,
  buildPreferredAnnouncementSourceRecords,
  buildOfficialArticleUrl,
  buildVersion,
  loadOfficialAnnouncementRecordsFromDatabase,
};
