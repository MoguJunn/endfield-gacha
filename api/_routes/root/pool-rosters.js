import { createClient } from '@supabase/supabase-js';
import { rejectDisallowedBrowserOrigin } from '../../_lib/http.js';
import { readCompletePoolRoster } from '../../_lib/poolRosterRead.js';
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

const CACHE_TTL = 60 * 1000;
const MAX_POOL_IDS = 120;

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

function parsePoolIds(req) {
  const url = new URL(req.url || '', 'https://example.com');
  const rawValues = [
    ...url.searchParams.getAll('poolIds'),
    ...url.searchParams.getAll('poolId')
  ];

  return Array.from(new Set(
    rawValues
      .flatMap((value) => String(value || '').split(','))
      .map((value) => value.trim())
      .filter((value) => value && value.length <= 128)
  )).slice(0, MAX_POOL_IDS);
}

function getCacheKey(poolIds) {
  return poolIds.slice().sort().join(',');
}

function createEmptyPayload(poolIds = []) {
  return {
    poolRosters: Object.fromEntries(poolIds.map((poolId) => [poolId, []]))
  };
}

function groupPoolRosterRows(rows = [], poolIds = []) {
  const grouped = createEmptyPayload(poolIds).poolRosters;

  rows.forEach((row) => {
    const poolId = row?.pool_id;
    if (!poolId) {
      return;
    }

    if (!Array.isArray(grouped[poolId])) {
      grouped[poolId] = [];
    }

    grouped[poolId].push(row);
  });

  return {
    poolRosters: grouped
  };
}

async function fetchPoolRosterPayload(supabase, poolIds) {
  const rows = await readCompletePoolRoster(supabase, poolIds);
  return groupPoolRosterRows(rows, poolIds);
}

async function getFreshPayload(supabase, poolIds, cacheKey) {
  if (inFlightByKey.has(cacheKey)) {
    return inFlightByKey.get(cacheKey);
  }

  const promise = fetchPoolRosterPayload(supabase, poolIds)
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

  const poolIds = parsePoolIds(req);
  const supabase = getSupabaseClient();
  const cacheVersion = await resolvePublicCacheVersion(supabase, {
    requestVersion: readRequestCacheVersion(req)
  });

  if (poolIds.length === 0) {
    return sendPublicJson(res, {
      cached: false,
      partial: false,
      data: createEmptyPayload(),
      source: 'origin',
      cacheKey: buildPublicCacheKey(['pool-rosters', 'empty', `v${cacheVersion}`]),
      cacheVersion,
      lastFetch: Date.now()
    });
  }

  const now = Date.now();
  const cacheKey = buildPublicCacheKey(['pool-rosters', getCacheKey(poolIds), `v${cacheVersion}`]);
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
    if (!cached) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).json({ success: false, code: 'pool_rosters_unavailable', error: '卡池名单暂不可用，请重试' });
    }
    return sendPublicJson(res, {
      cached: true,
      partial: true,
      data: cached?.payload || createEmptyPayload(poolIds),
      source: cached ? 'memory-cache' : 'default',
      stale: Boolean(cached),
      cacheKey,
      cacheVersion,
      lastFetch: cached?.lastFetch || 0,
      message: 'Database not configured, returning cached/default data'
    });
  }

  try {
    const payload = await getFreshPayload(supabase, poolIds, cacheKey);
    cacheByKey.set(cacheKey, {
      payload,
      partial: false,
      lastFetch: Date.now()
    });

    return sendPublicJson(res, {
      cached: false,
      partial: false,
      data: payload,
      source: 'origin',
      cacheKey,
      cacheVersion,
      lastFetch: cacheByKey.get(cacheKey)?.lastFetch || Date.now()
    });
  } catch (error) {
    if (!cached) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).json({ success: false, code: 'pool_rosters_unavailable', error: '卡池名单读取失败，请重试' });
    }
    return sendPublicJson(res, {
      cached: Boolean(cached),
      partial: true,
      data: cached?.payload || createEmptyPayload(poolIds),
      source: cached ? 'memory-cache' : 'default',
      stale: Boolean(cached),
      cacheKey,
      cacheVersion,
      lastFetch: cached?.lastFetch || 0,
      message: error?.message || 'Failed to load pool rosters'
    });
  }
}

export const __internal = {
  CACHE_TTL,
  MAX_POOL_IDS,
  cacheByKey,
  createEmptyPayload,
  getCacheKey,
  groupPoolRosterRows,
  parsePoolIds
};
