import { createHash } from 'node:crypto';
import { normalizeOfficialHtml } from './officialAnnouncementPresentation.js';

const GAME_BULLETIN_BASE_URL = 'https://game-hub.hypergryph.com/bulletin';
const GAME_BULLETIN_CODE = 'endfield_5SD9TN';
const GAME_BULLETIN_LANG = 'zh-cn';
const GAME_BULLETIN_PLATFORM = 'Windows';
const GAME_BULLETIN_SERVER = '1';
const GAME_BULLETIN_CHANNEL = '1';
const GAME_BULLETIN_SUB_CHANNEL = '1';
const GAME_BULLETIN_TYPE = '0';
const GAME_BULLETIN_REQUEST_TIMEOUT_MS = 15000;
const GAME_BULLETIN_SOURCE_URL = 'https://ef-webview.hypergryph.com/page/game_bulletin?platform=Windows&channel=1&lang=zh-cn&server=1&subChannel=1';
const GAME_BULLETIN_HEADERS = Object.freeze({
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 HGWebPC/1.32.1',
});

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildGameBulletinSourceId(cid) {
  return `game-bulletin:${cid}`;
}

function createContentHash(...values) {
  return createHash('sha256')
    .update(values.map((value) => String(value || '').replace(/\s+/g, ' ').trim()).join('\n'))
    .digest('hex')
    .slice(0, 8);
}

function buildGameBulletinVersion(version, cid, startAt, title, tab, displayType, rawContent) {
  return `gb-${createContentHash(version, cid, startAt, title, tab, displayType, rawContent)}`;
}

function buildPublishedAt(startAt) {
  if (!startAt) {
    return null;
  }

  return new Date(Number(startAt) * 1000).toISOString();
}

function buildAggregateUrl({ includeDetail = true } = {}) {
  const query = new URLSearchParams({
    lang: GAME_BULLETIN_LANG,
    platform: GAME_BULLETIN_PLATFORM,
    server: GAME_BULLETIN_SERVER,
    channel: GAME_BULLETIN_CHANNEL,
    subChannel: GAME_BULLETIN_SUB_CHANNEL,
    type: GAME_BULLETIN_TYPE,
    code: GAME_BULLETIN_CODE,
  });

  if (!includeDetail) {
    query.set('hideDetail', '1');
  }

  return `${GAME_BULLETIN_BASE_URL}/v2/aggregate?${query.toString()}`;
}

function buildDetailUrl(cid) {
  const query = new URLSearchParams({
    lang: GAME_BULLETIN_LANG,
    code: GAME_BULLETIN_CODE,
  });
  return `${GAME_BULLETIN_BASE_URL}/detail/${encodeURIComponent(cid)}?${query.toString()}`;
}

async function fetchGameBulletinJson(url, fetchImpl = globalThis.fetch) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), GAME_BULLETIN_REQUEST_TIMEOUT_MS)
    : null;

  let response;
  try {
    response = await fetchImpl(url, {
      headers: GAME_BULLETIN_HEADERS,
      signal: controller?.signal,
    });
  } catch (error) {
    const reason = error?.name === 'AbortError'
      ? `timeout after ${GAME_BULLETIN_REQUEST_TIMEOUT_MS}ms`
      : (error?.message || String(error));
    throw new Error(`Game bulletin API fetch failed: ${reason}`);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Game bulletin API returned ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  if (result?.code !== 0) {
    throw new Error(result?.msg || 'Game bulletin API returned non-zero code');
  }

  return result?.data ?? null;
}

function buildPictureHtml(item) {
  const title = normalizeText(item?.header || item?.title);
  const imageUrl = normalizeText(item?.data?.url);
  const link = normalizeText(item?.data?.link);
  const lines = [];

  if (title) {
    lines.push(`<p>${escapeHtml(title)}</p>`);
  }

  if (imageUrl) {
    lines.push(`<p><img src="${escapeHtml(imageUrl)}" /></p>`);
  }

  if (link) {
    lines.push(`<p><a href="${escapeHtml(link)}">查看详情</a></p>`);
  }

  return lines.join('');
}

function normalizeGameBulletinItem(item = {}) {
  const cid = normalizeText(item.cid);
  const title = normalizeText(item.header || item.title);
  const tab = normalizeText(item.tab);
  const rawHtml = item?.data?.html
    ? String(item.data.html)
    : buildPictureHtml(item);
  const sourceUrl = tab
    ? `${GAME_BULLETIN_SOURCE_URL}&tab=${encodeURIComponent(tab)}#${encodeURIComponent(cid)}`
    : `${GAME_BULLETIN_SOURCE_URL}#${encodeURIComponent(cid)}`;
  const rawContent = normalizeOfficialHtml(rawHtml, sourceUrl);
  const displayType = normalizeText(item.displayType);

  return {
    source_id: buildGameBulletinSourceId(cid),
    title,
    summary: title || null,
    raw_content: rawContent,
    version: buildGameBulletinVersion(item.version, cid, item.startAt, title, tab, displayType, rawContent),
    published_at: buildPublishedAt(item.startAt),
    source_url: sourceUrl,
    is_active: true,
    source_kind: 'game-bulletin',
    source_category: tab || null,
    tab: tab || null,
    display_type: displayType || null,
  };
}

async function fetchMissingDetails(items, fetchImpl) {
  const detailResults = await Promise.allSettled(
    items.map(async (item) => {
      const detail = await fetchGameBulletinJson(buildDetailUrl(item.cid), fetchImpl);
      return { ...item, ...detail };
    })
  );

  const details = detailResults
    .filter(result => result.status === 'fulfilled')
    .map(result => result.value);

  if (items.length > 0 && details.length === 0) {
    const firstError = detailResults.find(result => result.status === 'rejected')?.reason;
    throw new Error(`Game bulletin detail API failed for all records: ${firstError?.message || 'unknown error'}`);
  }

  return details;
}

export async function buildGameBulletinSourceRecords(pageSize = 10, {
  fetchImpl = globalThis.fetch,
  includeDetail = true,
} = {}) {
  const aggregate = await fetchGameBulletinJson(buildAggregateUrl({ includeDetail }), fetchImpl);
  const list = Array.isArray(aggregate?.list) ? aggregate.list : [];
  const validList = list
    .filter(item => item?.cid && item?.title)
    .slice(0, Math.max(1, Number(pageSize) || 10));
  const hasInlineDetails = validList.every(item => item?.data && typeof item.data === 'object');
  const details = hasInlineDetails
    ? validList
    : await fetchMissingDetails(validList, fetchImpl);

  return details
    .filter(item => item?.cid && item?.title)
    .map(normalizeGameBulletinItem)
    .filter(record => record.source_id && record.title && record.raw_content);
}

export const __internal = {
  GAME_BULLETIN_CODE,
  GAME_BULLETIN_SOURCE_URL,
  buildAggregateUrl,
  buildDetailUrl,
  buildGameBulletinSourceId,
  buildGameBulletinVersion,
  buildPictureHtml,
  normalizeGameBulletinItem,
};
