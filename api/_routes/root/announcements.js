import { createClient } from '@supabase/supabase-js';
import { rejectDisallowedBrowserOrigin } from '../../_lib/http.js';
import {
  buildPublicCacheKey,
  PUBLIC_CACHE_CONTROL,
  readRequestCacheVersion,
  resolvePublicCacheVersion,
  sendPublicJson,
} from '../../_lib/publicCache.js';
import {
  resolveSupabaseServerKey,
  resolveSupabaseUrl,
} from '../../_lib/supabaseEnv.js';
import { getStoredGameAnnouncementDigest } from '../../_lib/gameAnnouncementDigest.js';

const CACHE_TTL = 60 * 1000;
const DEFAULT_GAME_LIMIT = 5;
const MAX_GAME_LIMIT = 20;
const DEFAULT_RECENT_DAYS = 7;
const ANNOUNCEMENT_COLUMNS = [
  'id',
  'title',
  'title_en',
  'content',
  'content_en',
  'version',
  'announcement_type',
  'severity',
  'is_active',
  'priority',
  'source_id',
  'source_url',
  'published_at',
  'summary',
  'created_at',
  'updated_at'
].join(', ');

const cacheByKey = new Map();
const inFlightByKey = new Map();

function getSupabaseClient() {
  const supabaseUrl = resolveSupabaseUrl();
  const supabaseKey = resolveSupabaseServerKey();

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseKey);
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_GAME_LIMIT;
  }

  return Math.min(parsed, MAX_GAME_LIMIT);
}

function normalizeCutoffIso(value) {
  const parsed = new Date(value || '').getTime();
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString();
  }

  return new Date(Date.now() - DEFAULT_RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function parseQuery(req) {
  const url = new URL(req.url || '', 'https://example.com');
  return {
    cutoffIso: normalizeCutoffIso(url.searchParams.get('cutoffIso')),
    limit: normalizeLimit(url.searchParams.get('limit'))
  };
}

function getCacheKey({ cutoffIso, limit }) {
  return `${cutoffIso}:${limit}`;
}

function createEmptyPayload() {
  return {
    siteAnnouncements: [],
    recentGameAnnouncements: [],
    latestGameAnnouncements: [],
    versionBriefingAnnouncements: [],
    gameAnnouncementDigest: null
  };
}

function inferAnnouncementSourceMeta(record = {}) {
  const sourceId = String(record.source_id || '');
  const sourceUrl = String(record.source_url || '');
  const isGameBulletin = sourceId.startsWith('game-bulletin:') || sourceUrl.includes('game_bulletin');
  let sourceCategory = isGameBulletin ? 'game' : 'official';

  if (isGameBulletin) {
    try {
      const url = new URL(sourceUrl);
      sourceCategory = url.searchParams.get('tab') || sourceCategory;
    } catch {
      sourceCategory = 'game';
    }
  }

  if (!sourceId) {
    return record;
  }

  return {
    ...record,
    source_kind: isGameBulletin ? 'game-bulletin' : 'official-site',
    source_category: sourceCategory,
  };
}

function isManualAnnouncementSourceId(value) {
  return String(value ?? '').trim() === '';
}

function decorateAnnouncementRecords(records) {
  return (Array.isArray(records) ? records : []).map(inferAnnouncementSourceMeta);
}

function dedupeAnnouncements(records = []) {
  const byKey = new Map();
  records.forEach((record) => {
    const key = record?.id || record?.source_id || `${record?.title || ''}:${record?.updated_at || record?.created_at || ''}`;
    if (!key || byKey.has(key)) return;
    byKey.set(key, record);
  });
  return Array.from(byKey.values());
}

function sortSiteAnnouncements(records = []) {
  return dedupeAnnouncements(records)
    .filter(record => isManualAnnouncementSourceId(record?.source_id))
    .sort((left, right) => {
      const priorityDelta = Number(right?.priority || 0) - Number(left?.priority || 0);
      if (priorityDelta !== 0) return priorityDelta;
      return new Date(right?.updated_at || right?.created_at || 0).getTime()
        - new Date(left?.updated_at || left?.created_at || 0).getTime();
    });
}

function mergePayload(previousPayload, nextPartialPayload) {
  const previous = previousPayload || createEmptyPayload();
  const next = nextPartialPayload || {};

  return {
    siteAnnouncements: next.siteAnnouncements ?? previous.siteAnnouncements ?? [],
    recentGameAnnouncements: next.recentGameAnnouncements ?? previous.recentGameAnnouncements ?? [],
    latestGameAnnouncements: next.latestGameAnnouncements ?? previous.latestGameAnnouncements ?? [],
    versionBriefingAnnouncements: next.versionBriefingAnnouncements ?? previous.versionBriefingAnnouncements ?? [],
    gameAnnouncementDigest: next.gameAnnouncementDigest ?? previous.gameAnnouncementDigest ?? null
  };
}

async function fetchSiteAnnouncements(supabase) {
  const [nullSourceResult, emptySourceResult] = await Promise.all([
    supabase
      .from('announcements')
      .select(ANNOUNCEMENT_COLUMNS)
      .eq('is_active', true)
      .is('source_id', null)
      .order('priority', { ascending: false })
      .order('updated_at', { ascending: false }),
    supabase
      .from('announcements')
      .select(ANNOUNCEMENT_COLUMNS)
      .eq('is_active', true)
      .eq('source_id', '')
      .order('priority', { ascending: false })
      .order('updated_at', { ascending: false })
  ]);

  if (nullSourceResult.error) {
    throw nullSourceResult.error;
  }
  if (emptySourceResult.error) {
    throw emptySourceResult.error;
  }

  return decorateAnnouncementRecords(sortSiteAnnouncements([
    ...(nullSourceResult.data || []),
    ...(emptySourceResult.data || [])
  ]));
}

async function fetchRecentGameAnnouncements(supabase, cutoffIso) {
  const { data, error } = await supabase
    .from('announcements')
    .select(ANNOUNCEMENT_COLUMNS)
    .eq('is_active', true)
    .not('source_id', 'is', null)
    .neq('source_id', '')
    .gte('published_at', cutoffIso)
    .order('published_at', { ascending: false });

  if (error) {
    throw error;
  }

  return decorateAnnouncementRecords(data || []);
}

async function fetchLatestGameAnnouncements(supabase, limit) {
  const { data, error } = await supabase
    .from('announcements')
    .select(ANNOUNCEMENT_COLUMNS)
    .eq('is_active', true)
    .not('source_id', 'is', null)
    .neq('source_id', '')
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return decorateAnnouncementRecords(data || []);
}

async function fetchVersionBriefingAnnouncements(supabase) {
  const { data, error } = await supabase
      .from('announcements')
      .select(ANNOUNCEMENT_COLUMNS)
      .eq('is_active', true)
      .not('source_id', 'is', null)
      .neq('source_id', '')
      .ilike('title', '%新版本导览%')
      .like('source_url', 'https://endfield.hypergryph.com/news/%')
      .order('published_at', { ascending: false })
      .limit(DEFAULT_GAME_LIMIT);

  if (error) throw error;
  return decorateAnnouncementRecords(data || []);
}

async function fetchAnnouncementsPayload(supabase, query, previousPayload) {
  const [siteResult, recentGameResult, latestGameResult, digestResult, briefingResult] = await Promise.allSettled([
    fetchSiteAnnouncements(supabase),
    fetchRecentGameAnnouncements(supabase, query.cutoffIso),
    fetchLatestGameAnnouncements(supabase, query.limit),
    getStoredGameAnnouncementDigest(supabase),
    fetchVersionBriefingAnnouncements(supabase)
  ]);

  const payload = mergePayload(previousPayload, {
    siteAnnouncements: siteResult.status === 'fulfilled' ? siteResult.value : undefined,
    recentGameAnnouncements: recentGameResult.status === 'fulfilled' ? recentGameResult.value : undefined,
    latestGameAnnouncements: latestGameResult.status === 'fulfilled' ? latestGameResult.value : undefined,
    versionBriefingAnnouncements: briefingResult.status === 'fulfilled' ? briefingResult.value : undefined,
    gameAnnouncementDigest: digestResult.status === 'fulfilled' ? digestResult.value : undefined
  });

  const partial = [siteResult, recentGameResult, latestGameResult, digestResult, briefingResult]
    .some((result) => result.status === 'rejected');

  return {
    payload,
    partial
  };
}

async function getFreshPayload(supabase, query, cacheKey, previousPayload) {
  if (inFlightByKey.has(cacheKey)) {
    return inFlightByKey.get(cacheKey);
  }

  const promise = fetchAnnouncementsPayload(supabase, query, previousPayload)
    .finally(() => {
      inFlightByKey.delete(cacheKey);
    });

  inFlightByKey.set(cacheKey, promise);
  return promise;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', PUBLIC_CACHE_CONTROL);

  if (rejectDisallowedBrowserOrigin(req, res, {
    methods: 'GET, OPTIONS'
  })) {
    return;
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  const query = parseQuery(req);
  const now = Date.now();
  const supabase = getSupabaseClient();
  const cacheVersion = await resolvePublicCacheVersion(supabase, {
    requestVersion: readRequestCacheVersion(req)
  });
  const cacheKey = buildPublicCacheKey(['announcements', getCacheKey(query), `v${cacheVersion}`]);
  const cached = cacheByKey.get(cacheKey);

  if (cached && now - cached.lastFetch < CACHE_TTL) {
    return sendPublicJson(res, {
      cached: true,
      partial: Boolean(cached.partial),
      data: cached.payload,
      source: 'memory-cache',
      cacheKey,
      cacheVersion,
      lastFetch: cached.lastFetch
    });
  }

  if (!supabase) {
    return sendPublicJson(res, {
      cached: true,
      partial: true,
      data: cached?.payload || createEmptyPayload(),
      source: cached ? 'memory-cache' : 'default',
      stale: Boolean(cached),
      cacheKey,
      cacheVersion,
      lastFetch: cached?.lastFetch || 0,
      message: 'Database not configured, returning cached/default data'
    });
  }

  try {
    const { payload, partial } = await getFreshPayload(supabase, query, cacheKey, cached?.payload);
    cacheByKey.set(cacheKey, {
      payload,
      partial,
      lastFetch: Date.now()
    });

    return sendPublicJson(res, {
      cached: false,
      partial,
      data: payload,
      source: partial ? 'origin-partial' : 'origin',
      cacheKey,
      cacheVersion,
      lastFetch: cacheByKey.get(cacheKey)?.lastFetch || Date.now()
    });
  } catch (error) {
    return sendPublicJson(res, {
      cached: Boolean(cached),
      partial: true,
      data: cached?.payload || createEmptyPayload(),
      source: cached ? 'memory-cache' : 'default',
      stale: Boolean(cached),
      cacheKey,
      cacheVersion,
      lastFetch: cached?.lastFetch || 0,
      message: error?.message || 'Failed to load announcements'
    });
  }
}

export const __internal = {
  CACHE_TTL,
  cacheByKey,
  createEmptyPayload,
  getCacheKey,
  mergePayload,
  normalizeCutoffIso,
  sortSiteAnnouncements,
  normalizeLimit,
  parseQuery
};
