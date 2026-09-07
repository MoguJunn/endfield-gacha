const OFFICIAL_NEWS_BASE_URL = 'https://web-news.gryphline.com/api';
const OFFICIAL_NEWS_CODE = 'arknights_endfield_official';
const OFFICIAL_LANGUAGE = 'en-us';
const PAGE_SIZE = 20;
const REQUEST_TIMEOUT_MS = 20000;
const DETAIL_CONCURRENCY = 5;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function normalizeText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#x2F;/giu, '/');
}

export function stripOfficialHtml(value) {
  return normalizeText(decodeHtmlEntities(
    String(value || '')
      .replace(/<br\s*\/?\s*>/giu, '\n')
      .replace(/<\/p>/giu, '\n')
      .replace(/<\/div>/giu, '\n')
      .replace(/<\/li>/giu, '\n')
      .replace(/<[^>]+>/gu, ' ')
  ));
}

function buildPublishedAt(displayTime) {
  const timestamp = Number(displayTime) * 1000;
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString()
    : null;
}

function buildSourceUrl(cid) {
  return `https://endfield.gryphline.com/en-us/news/${cid}`;
}

function cleanCatalogName(value) {
  return normalizeText(value)
    .replace(/^Release Celebration\s+/iu, '')
    .replace(/\s+#\d+$/u, '');
}

function extractTargets(context, kind) {
  const entityWord = kind === 'weapon' ? 'weapon' : 'operator';
  const expressions = [
    new RegExp(`6\\s*(?:★|☆|-?star)?\\s*${entityWord}\\s*\\[([^\\]]+)\\]`, 'giu'),
    new RegExp(`${entityWord}\\s*\\[([^\\]]+)\\]`, 'giu'),
  ];
  const targets = [];

  for (const expression of expressions) {
    let match;
    while ((match = expression.exec(context)) !== null) {
      const name = cleanCatalogName(match[1]);
      if (name && !targets.includes(name)) {
        targets.push(name);
      }
    }
  }

  return targets;
}

function addCandidate(candidates, seen, {
  kind,
  name,
  record,
  text,
  matchIndex = 0,
}) {
  const normalizedName = cleanCatalogName(name);
  if (!normalizedName) return;

  const sourceId = String(record?.cid || '').trim();
  const key = `${kind}\u0000${normalizedName.toLowerCase()}\u0000${sourceId}`;
  if (seen.has(key)) return;
  seen.add(key);

  const context = text.slice(Math.max(0, matchIndex), Math.max(0, matchIndex) + 1400);
  candidates.push({
    kind,
    name: normalizedName,
    targetNames: kind === 'version' ? [] : extractTargets(context, kind),
    publishedAt: buildPublishedAt(record?.displayTime),
    sourceId,
    sourceTitle: normalizeText(record?.title),
    sourceUrl: buildSourceUrl(sourceId),
    context,
  });
}

function collectMatches(expression, text, callback) {
  let match;
  while ((match = expression.exec(text)) !== null) {
    callback(match);
  }
}

export function extractOfficialEnglishCandidates(record = {}) {
  const title = normalizeText(record.title);
  const body = stripOfficialHtml(record.data || record.content || '');
  const text = `${title} ${body}`.trim();
  const candidates = [];
  const seen = new Set();

  collectMatches(
    /\[([^\]]+)\]\s+(?:(?:RE-Factor|Chartered|Special)\s+)*Headhunting(?:\s*#\d+)?/giu,
    text,
    (match) => addCandidate(candidates, seen, {
      kind: 'character',
      name: match[1],
      record,
      text,
      matchIndex: match.index,
    })
  );

  collectMatches(
    /\[([^\]]+\sIssue)\]\s+(?:(?:RE-Factor\s+)?Issue(?:\s*#\d+)?|LTO|Limited-Time Offer|Open)/giu,
    text,
    (match) => addCandidate(candidates, seen, {
      kind: 'weapon',
      name: match[1],
      record,
      text,
      matchIndex: match.index,
    })
  );

  const titleBracket = /^.*?\[([^\]]+)\]/u.exec(title);
  if (titleBracket && /Headhunting/iu.test(title)) {
    addCandidate(candidates, seen, {
      kind: 'character',
      name: titleBracket[1],
      record,
      text,
      matchIndex: 0,
    });
  }
  if (titleBracket && /\bIssue\b/iu.test(title) && !/Game Issues/iu.test(title)) {
    addCandidate(candidates, seen, {
      kind: 'weapon',
      name: titleBracket[1],
      record,
      text,
      matchIndex: 0,
    });
  }

  collectMatches(
    /\[([^\]]+)\]\s+(?:Core Chapter\s+)?Version(?:\s+(?:Update Notes|DEV Comm|Preview))?/giu,
    text,
    (match) => addCandidate(candidates, seen, {
      kind: 'version',
      name: match[1],
      record,
      text,
      matchIndex: match.index,
    })
  );
  collectMatches(
    /Version\s+\[([^\]]+)\]/giu,
    text,
    (match) => addCandidate(candidates, seen, {
      kind: 'version',
      name: match[1],
      record,
      text,
      matchIndex: match.index,
    })
  );

  const unbracketedVersion = /^Arknights:\s*Endfield\s+(.+?):\s*DEV Comm$/iu.exec(title);
  if (unbracketedVersion) {
    addCandidate(candidates, seen, {
      kind: 'version',
      name: unbracketedVersion[1],
      record,
      text,
      matchIndex: 0,
    });
  }

  return candidates;
}

function shouldFetchDetail(record = {}) {
  const title = normalizeText(record.title);
  return /Headhunting|\bIssue\b|Release Celebration|Version (?:Update Notes|DEV Comm)|:\s*DEV Comm/iu.test(title)
    && !/Game Issues/iu.test(title);
}

async function fetchOfficialJson(url, fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;

  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': DEFAULT_USER_AGENT,
      },
      signal: controller.signal,
    });
  } catch (error) {
    const reason = error?.name === 'AbortError'
      ? `请求超时（${REQUEST_TIMEOUT_MS}ms）`
      : error?.message || String(error);
    throw new Error(`GRYPHLINE 英文公告请求失败: ${reason}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`GRYPHLINE 英文公告 HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.code !== 0) {
    throw new Error(payload?.msg || 'GRYPHLINE 英文公告接口返回异常');
  }

  return payload?.data ?? null;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function loadOfficialEnglishCatalog({
  fetchImpl = globalThis.fetch,
  logger = () => {},
} = {}) {
  const list = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;

  while (list.length < total) {
    const query = new URLSearchParams({
      lang: OFFICIAL_LANGUAGE,
      code: OFFICIAL_NEWS_CODE,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    const payload = await fetchOfficialJson(`${OFFICIAL_NEWS_BASE_URL}/bulletin?${query}`, fetchImpl);
    const records = Array.isArray(payload?.list) ? payload.list : [];
    total = Number(payload?.total) || list.length + records.length;
    list.push(...records);
    logger(`GRYPHLINE 英文公告列表: ${Math.min(list.length, total)}/${total}`);
    if (records.length === 0) break;
    page += 1;
  }

  const candidatesForDetails = list.filter(shouldFetchDetail);
  const details = await mapWithConcurrency(candidatesForDetails, DETAIL_CONCURRENCY, async (record) => {
    const query = new URLSearchParams({
      lang: OFFICIAL_LANGUAGE,
      code: OFFICIAL_NEWS_CODE,
    });
    const detail = await fetchOfficialJson(
      `${OFFICIAL_NEWS_BASE_URL}/bulletin/${encodeURIComponent(record.cid)}?${query}`,
      fetchImpl
    );
    return { ...record, ...detail };
  });

  const candidates = details.flatMap(extractOfficialEnglishCandidates);
  logger(`GRYPHLINE 英文公告已提取 ${candidates.length} 个卡池/版本名称候选`);
  return {
    fetchedAt: new Date().toISOString(),
    announcements: details,
    candidates,
  };
}

export default {
  extractOfficialEnglishCandidates,
  loadOfficialEnglishCatalog,
  stripOfficialHtml,
};
