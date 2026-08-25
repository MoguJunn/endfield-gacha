import { createClient } from '@supabase/supabase-js';
import {
  resolveSupabaseServerKey,
  resolveSupabaseUrl,
} from './supabaseEnv.js';
import { getCanonicalExtraPoolSubtype } from '../../shared/extraPoolSubtype.js';

function getSupabaseClient() {
  const supabaseUrl = resolveSupabaseUrl();
  const supabaseKey = resolveSupabaseServerKey();

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseKey);
}

function normalizeRemotePoolType(type, isLimitedWeaponFlag) {
  if (type === 'limited_character') return 'limited';
  if (type === 'limited_weapon') return 'weapon';
  if (type === 'extra') return 'extra';
  if (type === 'weapon' && isLimitedWeaponFlag === false) return 'weapon';
  return type || 'standard';
}

function normalizeQueryValue(value) {
  return String(value || '').trim();
}

function normalizeBooleanQuery(value) {
  const normalized = normalizeQueryValue(value).toLowerCase();
  if (['1', 'true', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no'].includes(normalized)) return false;
  return null;
}

function normalizeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLimit(value, {
  defaultValue = 50,
  max = 100,
} = {}) {
  const parsed = normalizeInteger(value);
  if (!parsed || parsed < 1) {
    return defaultValue;
  }

  return Math.min(parsed, max);
}

function encodeCursor(offset) {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) {
    return 0;
  }

  const decoded = Number.parseInt(Buffer.from(String(cursor), 'base64url').toString('utf8'), 10);
  return Number.isFinite(decoded) && decoded > 0 ? decoded : 0;
}

function paginateArray(items, {
  limit,
  cursor,
}) {
  const safeLimit = normalizeLimit(limit);
  const offset = decodeCursor(cursor);
  const pageItems = items.slice(offset, offset + safeLimit);
  const nextOffset = offset + pageItems.length;

  return {
    items: pageItems,
    page: {
      limit: safeLimit,
      nextCursor: nextOffset < items.length ? encodeCursor(nextOffset) : null,
      hasMore: nextOffset < items.length,
      total: items.length,
    },
  };
}

function parseDateMs(value) {
  if (!value) {
    return NaN;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : NaN;
}

function getPoolStatus(pool, nowMs = Date.now()) {
  const startMs = parseDateMs(pool?.start_time);
  const endMs = parseDateMs(pool?.end_time);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return 'permanent';
  }

  if (nowMs < startMs) {
    return 'upcoming';
  }

  if (nowMs >= endMs) {
    return 'ended';
  }

  return 'active';
}

function splitFeaturedValue(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(/[、,，/|]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeFeaturedCharacters(pool) {
  if (Array.isArray(pool?.featured_characters)) {
    return pool.featured_characters
      .map((item) => {
        if (typeof item === 'string') {
          return { name: item, rarity: null, type: null };
        }

        return {
          name: item?.name || item?.character_name || item?.item_name || '',
          rarity: item?.rarity ?? null,
          type: item?.type || null,
        };
      })
      .filter((item) => item.name);
  }

  return splitFeaturedValue(pool?.up_character).map((name) => ({
    name,
    rarity: 6,
    type: normalizeRemotePoolType(pool?.type, pool?.isLimitedWeapon) === 'weapon' ? 'weapon' : 'character',
  }));
}

function getDisplayName(record, locale = 'zh-CN') {
  const normalizedLocale = String(locale || '').toLowerCase();
  if (normalizedLocale.startsWith('en')) {
    return record?.name_en || record?.title_en || record?.name || record?.title || '';
  }

  return record?.name || record?.title || record?.name_en || record?.title_en || '';
}

export function toPublicPoolDto(pool, {
  locale = 'zh-CN',
  nowMs = Date.now(),
} = {}) {
  const id = getPoolRecordId(pool);
  const type = normalizeRemotePoolType(pool?.type, pool?.isLimitedWeapon);

  return {
    id,
    pool_id: id,
    name: getDisplayName(pool, locale),
    names: {
      zh_CN: pool?.name || null,
      en: pool?.name_en || null,
    },
    type,
    extraSubtype: getCanonicalExtraPoolSubtype(pool),
    extraRuleProfile: pool?.extra_rule_profile || pool?.extraRuleProfile || null,
    extraSeriesKey: pool?.extra_series_key || pool?.extraSeriesKey || null,
    extraSeriesPhase: pool?.extra_series_phase ?? pool?.extraSeriesPhase ?? null,
    status: getPoolStatus(pool, nowMs),
    startAt: pool?.start_time || null,
    endAt: pool?.end_time || null,
    featured: normalizeFeaturedCharacters(pool),
    upCharacter: pool?.up_character || null,
    isLimitedWeapon: pool?.isLimitedWeapon !== false,
    bannerUrl: pool?.banner_url || null,
    description: pool?.description || null,
    updatedAt: pool?.updated_at || pool?.created_at || null,
  };
}

export function toPublicCharacterDto(character, {
  locale = 'zh-CN',
  pools = [],
} = {}) {
  const name = character?.name || '';
  const relatedPools = pools
    .filter((pool) => normalizeFeaturedCharacters(pool).some((item) => item.name === name))
    .slice(0, 20)
    .map((pool) => ({
      id: getPoolRecordId(pool),
      name: getDisplayName(pool, locale),
      type: normalizeRemotePoolType(pool?.type, pool?.isLimitedWeapon),
      status: getPoolStatus(pool),
    }));

  return {
    id: character?.id || name,
    name,
    names: {
      zh_CN: name || null,
      en: character?.name_en || null,
    },
    avatarUrl: character?.avatar_url || null,
    rarity: character?.rarity ?? null,
    type: character?.type || 'character',
    aliases: Array.isArray(character?.aliases) ? character.aliases : [],
    isLimited: character?.is_limited === true,
    releaseDate: character?.release_date || null,
    poolConfig: character?.pool_config || null,
    relatedPools,
    updatedAt: character?.updated_at || character?.created_at || null,
  };
}

function toPublicAnnouncementDto(announcement, {
  locale = 'zh-CN',
} = {}) {
  const normalizedLocale = String(locale || '').toLowerCase();
  const useEnglish = normalizedLocale.startsWith('en');

  return {
    id: announcement?.id || announcement?.source_id || null,
    title: useEnglish
      ? announcement?.title_en || announcement?.title || ''
      : announcement?.title || announcement?.title_en || '',
    titles: {
      zh_CN: announcement?.title || null,
      en: announcement?.title_en || null,
    },
    summary: announcement?.summary || null,
    content: useEnglish
      ? announcement?.content_en || announcement?.content || null
      : announcement?.content || announcement?.content_en || null,
    version: announcement?.version || null,
    type: announcement?.announcement_type || 'update',
    severity: announcement?.severity || 'info',
    sourceUrl: announcement?.source_url || null,
    publishedAt: announcement?.published_at || announcement?.created_at || null,
    updatedAt: announcement?.updated_at || null,
  };
}

function filterPoolDtos(pools, query = {}) {
  const type = normalizeQueryValue(query.type).toLowerCase();
  const status = normalizeQueryValue(query.status).toLowerCase();

  return pools.filter((pool) => {
    if (type && pool.type !== type) {
      return false;
    }

    if (status && pool.status !== status) {
      return false;
    }

    return true;
  });
}

function filterCharacterDtos(characters, query = {}) {
  const type = normalizeQueryValue(query.type).toLowerCase();
  const rarity = normalizeInteger(query.rarity);
  const limited = normalizeBooleanQuery(query.limited);
  const q = normalizeQueryValue(query.q).toLowerCase();

  return characters.filter((character) => {
    if (type && character.type !== type) {
      return false;
    }

    if (rarity && Number(character.rarity) !== rarity) {
      return false;
    }

    if (limited !== null && character.isLimited !== limited) {
      return false;
    }

    if (q) {
      const searchCorpus = [
        character.name,
        character.names?.en,
        ...(character.aliases || []),
      ].join('\n').toLowerCase();

      if (!searchCorpus.includes(q)) {
        return false;
      }
    }

    return true;
  });
}

function getPoolRecordId(record) {
  return record?.pool_id || record?.id || null;
}

function getPoolSortTimestamp(record) {
  const source = record?.start_time || record?.created_at || record?.updated_at || 0;
  const value = new Date(source).getTime();
  return Number.isFinite(value) ? value : 0;
}

function sortPoolRecords(left, right) {
  const diff = getPoolSortTimestamp(right) - getPoolSortTimestamp(left);
  if (diff !== 0) {
    return diff;
  }

  return String(getPoolRecordId(left) || '').localeCompare(String(getPoolRecordId(right) || ''));
}

function dedupeVisiblePoolRecords(records) {
  const deduped = new Map();

  (records || []).forEach((record) => {
    const poolId = getPoolRecordId(record);
    if (!poolId) {
      return;
    }

    if (!deduped.has(poolId)) {
      deduped.set(poolId, record);
    }
  });

  return Array.from(deduped.values()).sort(sortPoolRecords);
}

function formatVisiblePoolRecord(record) {
  return {
    id: record.pool_id,
    name: record.name,
    name_en: record.name_en || null,
    type: normalizeRemotePoolType(record.type, record.is_limited_weapon),
    extra_subtype: getCanonicalExtraPoolSubtype(record),
    extra_rule_profile: record.extra_rule_profile || null,
    extra_series_key: record.extra_series_key || null,
    extra_series_phase: record.extra_series_phase ?? null,
    locked: record.locked || false,
    isLimitedWeapon: record.is_limited_weapon !== false,
    created_at: record.created_at || null,
    updated_at: record.updated_at || null,
    user_id: record.user_id || null,
    creator_username: record.creator_username || null,
    creator_role: record.creator_role || null,
    up_character: record.up_character || null,
    description: record.description || null,
    banner_url: record.banner_url || null,
    start_time: record.start_time || null,
    end_time: record.end_time || null,
    featured_characters: record.featured_characters || null,
  };
}

export async function fetchVisiblePools(supabase = getSupabaseClient()) {
  if (!supabase) {
    throw new Error('Supabase client not configured');
  }

  const { data, error } = await supabase.rpc('get_app_visible_pools');
  if (error) {
    throw error;
  }

  return dedupeVisiblePoolRecords(data || []).map(formatVisiblePoolRecord);
}

export async function fetchCharacters(supabase = getSupabaseClient()) {
  if (!supabase) {
    throw new Error('Supabase client not configured');
  }

  const { data, error } = await supabase
    .from('characters')
    .select('id, name, avatar_url, rarity, type, aliases, is_limited, release_date, created_at, updated_at, pool_config')
    .order('name');

  if (error) {
    throw error;
  }

  return data || [];
}

export async function fetchAnnouncements(supabase = getSupabaseClient(), {
  locale = 'zh-CN',
  limit = 50,
  cursor = null,
} = {}) {
  if (!supabase) {
    throw new Error('Supabase client not configured');
  }

  const safeLimit = normalizeLimit(limit);
  const offset = decodeCursor(cursor);
  const { data, error, count } = await supabase
    .from('announcements')
    .select('id, title, title_en, content, content_en, version, announcement_type, severity, is_active, source_url, published_at, summary, created_at, updated_at', { count: 'exact' })
    .eq('is_active', true)
    .order('published_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + safeLimit - 1);

  if (error) {
    throw error;
  }

  const items = (data || []).map((announcement) => toPublicAnnouncementDto(announcement, { locale }));
  const nextOffset = offset + items.length;

  return {
    announcements: items,
    page: {
      limit: safeLimit,
      nextCursor: Number.isFinite(count) && nextOffset < count ? encodeCursor(nextOffset) : null,
      hasMore: Number.isFinite(count) ? nextOffset < count : items.length === safeLimit,
      total: Number.isFinite(count) ? count : null,
    },
  };
}

export async function buildPoolsCatalog(supabase = getSupabaseClient(), query = {}) {
  const pools = await fetchVisiblePools(supabase);
  const dtos = filterPoolDtos(
    pools.map((pool) => toPublicPoolDto(pool, { locale: query.locale })),
    query
  );
  const { items, page } = paginateArray(dtos, query);

  return {
    pools: items,
    page,
  };
}

export async function buildPoolDetail(supabase = getSupabaseClient(), {
  id,
  locale = 'zh-CN',
} = {}) {
  const pools = await fetchVisiblePools(supabase);
  const pool = pools.find((item) => getPoolRecordId(item) === id);

  if (!pool) {
    return null;
  }

  return {
    pool: toPublicPoolDto(pool, { locale }),
  };
}

export async function buildCharactersCatalog(supabase = getSupabaseClient(), query = {}) {
  const [characters, pools] = await Promise.all([
    fetchCharacters(supabase),
    fetchVisiblePools(supabase),
  ]);
  const dtos = filterCharacterDtos(
    characters.map((character) => toPublicCharacterDto(character, {
      locale: query.locale,
      pools,
    })),
    query
  );
  const { items, page } = paginateArray(dtos, query);

  return {
    characters: items,
    page,
  };
}

export async function buildCharacterDetail(supabase = getSupabaseClient(), {
  id,
  locale = 'zh-CN',
} = {}) {
  const [characters, pools] = await Promise.all([
    fetchCharacters(supabase),
    fetchVisiblePools(supabase),
  ]);
  const normalizedId = normalizeQueryValue(id);
  const character = characters.find((item) => String(item.id || item.name) === normalizedId);

  if (!character) {
    return null;
  }

  return {
    character: toPublicCharacterDto(character, { locale, pools }),
  };
}

export async function fetchGlobalSummary(supabase = getSupabaseClient()) {
  if (!supabase) {
    throw new Error('Supabase client not configured');
  }

  const { data, error } = await supabase.rpc('get_global_stats_cached');
  if (error) {
    throw error;
  }

  return data ?? null;
}

export async function fetchCharacterRanking(supabase = getSupabaseClient()) {
  if (!supabase) {
    throw new Error('Supabase client not configured');
  }

  const { data, error } = await supabase.rpc('get_character_ranking_stats_cached');
  if (error) {
    throw error;
  }

  return data ?? null;
}

export default {
  buildCharacterDetail,
  buildCharactersCatalog,
  buildPoolDetail,
  buildPoolsCatalog,
  fetchAnnouncements,
  fetchVisiblePools,
  fetchCharacters,
  fetchGlobalSummary,
  fetchCharacterRanking,
  toPublicCharacterDto,
  toPublicPoolDto,
};
