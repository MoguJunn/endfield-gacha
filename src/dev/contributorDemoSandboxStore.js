import { create } from 'zustand';
import { isContributorDemoModeEnabled } from './contributorDemoMode.js';
import {
  CONTRIBUTOR_REAL_FALLBACK_CHARACTERS,
  CONTRIBUTOR_REAL_FALLBACK_POOLS,
  CONTRIBUTOR_REAL_FALLBACK_POOL_CHARACTERS,
  CONTRIBUTOR_REAL_FALLBACK_SITE_CONFIG,
} from './contributorRealFallbackCatalog.js';
import {
  isReservedObjectKey,
  resolveTrustedCatalogApiBase,
  sanitizePublicResourceUrl,
} from '../utils/publicResourceUrl.js';
import { pickPublicSiteConfig } from '../../shared/publicSiteConfig.js';

export const CONTRIBUTOR_DEMO_SANDBOX_STORAGE_KEY = 'gacha_contributor_content_sandbox_v3';
const configuredCatalogHosts = String(import.meta.env?.VITE_CONTRIBUTOR_CATALOG_ALLOWED_HOSTS || '')
  .split(',')
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
export const CONTRIBUTOR_DEMO_CATALOG_API_BASE = resolveTrustedCatalogApiBase(
  import.meta.env?.VITE_CONTRIBUTOR_CATALOG_API_BASE || 'https://ef-gacha.mogujun.icu',
  { allowedHosts: ['ef-gacha.mogujun.icu', ...configuredCatalogHosts] }
);

const SANDBOX_SCHEMA_VERSION = 3;
const LIVE_CATALOG_TIMEOUT_MS = 30000;
const MAX_SANDBOX_BYTES = 4 * 1024 * 1024;
const MAX_POOLS = 250;
const MAX_CHARACTERS = 500;
const MAX_ANNOUNCEMENTS = 100;
const MAX_ANNOUNCEMENT_CONTENT_LENGTH = 20000;
const MAX_SITE_CONFIG_ITEMS = 100;
const MAX_SITE_CONFIG_VALUE_LENGTH = 20000;
const VALID_CONFIG_CATEGORIES = new Set(['alert', 'content', 'legal', 'social', 'general']);

const DEFAULT_ANNOUNCEMENTS = Object.freeze([
  {
    id: 'sandbox-announcement-welcome',
    title: '本地内容沙盒已启用',
    title_en: 'Local content sandbox is active',
    content: '游戏目录优先读取正式站公开数据。你可以在管理后台修改本公告，修改只会保存在当前浏览器。',
    content_en: 'The game catalog is loaded from the public production API. You can edit this announcement in the admin console; changes stay in this browser.',
    version: '1.0.0',
    announcement_type: 'update',
    severity: 'info',
    is_active: true,
    priority: 100,
    created_at: '2026-08-27T12:00:00.000Z',
    updated_at: '2026-08-27T12:00:00.000Z',
  },
  {
    id: 'sandbox-announcement-maintenance',
    title: '所有内容操作均为本地模拟',
    title_en: 'All content operations are local simulations',
    content: '公告、卡池、角色、武器、版本时间线和站点配置可编辑；邮件、账号、开奖、密钥和自动化任务不会执行。',
    content_en: 'Announcements, pools, entities, version timelines, and site settings are editable. Mail, accounts, draws, secrets, and automation jobs never execute.',
    version: '1.0.0',
    announcement_type: 'temporary',
    severity: 'maintenance',
    is_active: true,
    priority: 90,
    created_at: '2026-08-27T11:00:00.000Z',
    updated_at: '2026-08-27T11:00:00.000Z',
  },
]);

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value, maxLength = 240) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeEntityId(value) {
  const normalized = normalizeText(value, 160);
  return /^[A-Za-z0-9_.:-]+$/u.test(normalized) && !isReservedObjectKey(normalized)
    ? normalized
    : '';
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function normalizePool(pool = {}) {
  const poolId = normalizeEntityId(pool.pool_id || pool.id);
  if (!poolId) return null;
  const sixStarEntities = Array.isArray(pool.six_star_entities)
    ? pool.six_star_entities.slice(0, 100).flatMap((entity) => {
      const id = normalizeEntityId(entity?.id);
      const name = normalizeText(entity?.name);
      const type = entity?.type === 'weapon' ? 'weapon' : entity?.type === 'character' ? 'character' : null;
      return id && name && type ? [{ id, name, type, is_up: Boolean(entity?.is_up) }] : [];
    })
    : [];
  return {
    id: poolId,
    pool_id: poolId,
    name: normalizeText(pool.name || poolId),
    name_en: normalizeText(pool.name_en, 240) || null,
    type: ['limited', 'weapon', 'extra', 'standard', 'beginner'].includes(pool.type) ? pool.type : 'standard',
    extra_subtype: normalizeText(pool.extra_subtype, 80) || null,
    extra_rule_profile: normalizeText(pool.extra_rule_profile, 120) || null,
    extra_series_key: normalizeText(pool.extra_series_key, 160) || null,
    extra_series_phase: Number.isInteger(Number(pool.extra_series_phase)) ? Number(pool.extra_series_phase) : null,
    locked: Boolean(pool.locked),
    is_limited_weapon: pool.is_limited_weapon !== false && pool.isLimitedWeapon !== false,
    up_character: normalizeText(pool.up_character) || null,
    description: normalizeText(pool.description, 5000) || null,
    banner_url: sanitizePublicResourceUrl(pool.banner_url),
    start_time: normalizeTimestamp(pool.start_time),
    end_time: normalizeTimestamp(pool.end_time),
    featured_characters: Array.isArray(pool.featured_characters)
      ? pool.featured_characters.slice(0, 100).map((item) => normalizeText(item)).filter(Boolean)
      : null,
    created_at: normalizeTimestamp(pool.created_at),
    updated_at: normalizeTimestamp(pool.updated_at),
    six_star_entities: sixStarEntities,
    six_star_roster_complete: Boolean(pool.six_star_roster_complete && sixStarEntities.length > 0),
  };
}

function normalizeAliases(value) {
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => normalizeText(item, 120)).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value.split(/[\n,，、;；|]+/u).slice(0, 100).map((item) => normalizeText(item, 120)).filter(Boolean);
}

function normalizeCharacter(character = {}) {
  const id = normalizeEntityId(character.id);
  if (!id) return null;
  const type = character.type === 'weapon' ? 'weapon' : 'character';
  const rawPoolConfig = character.pool_config && typeof character.pool_config === 'object'
    ? character.pool_config
    : {};
  const pools = (Array.isArray(rawPoolConfig.pools) ? rawPoolConfig.pools : [])
    .filter((pool) => ['limited', 'standard', 'weapon', 'extra'].includes(pool));
  return {
    id,
    name: normalizeText(character.name || id),
    rarity: Math.min(Math.max(Number(character.rarity) || 4, 3), 6),
    type,
    aliases: normalizeAliases(character.aliases),
    is_limited: Boolean(character.is_limited),
    avatar_url: sanitizePublicResourceUrl(character.avatar_url),
    release_date: normalizeTimestamp(character.release_date),
    created_at: normalizeTimestamp(character.created_at),
    updated_at: normalizeTimestamp(character.updated_at),
    pool_config: {
      pools: pools.length > 0 ? [...new Set(pools)] : type === 'weapon' ? ['weapon'] : ['standard', 'limited'],
      limited_rotation_count: Math.max(0, Math.trunc(Number(rawPoolConfig.limited_rotation_count) || 0)),
      removes_after: rawPoolConfig.removes_after == null ? null : Math.max(0, Math.trunc(Number(rawPoolConfig.removes_after) || 0)),
      is_active_in_limited: rawPoolConfig.is_active_in_limited !== false,
      introduced_at: normalizeTimestamp(rawPoolConfig.introduced_at),
    },
  };
}

function normalizeAnnouncement(announcement = {}, fallbackId = '') {
  const id = normalizeEntityId(announcement.id || fallbackId);
  const title = normalizeText(announcement.title, 240);
  if (!id || !title) return null;
  return {
    id,
    title,
    title_en: normalizeText(announcement.title_en, 240),
    content: normalizeText(announcement.content, MAX_ANNOUNCEMENT_CONTENT_LENGTH),
    content_en: normalizeText(announcement.content_en, MAX_ANNOUNCEMENT_CONTENT_LENGTH),
    version: normalizeText(announcement.version || '1.0.0', 40),
    announcement_type: announcement.announcement_type === 'temporary' ? 'temporary' : 'update',
    severity: ['info', 'success', 'maintenance', 'warning', 'critical'].includes(announcement.severity)
      ? announcement.severity
      : 'info',
    is_active: announcement.is_active !== false,
    priority: Math.trunc(Number(announcement.priority) || 0),
    created_at: normalizeTimestamp(announcement.created_at) || new Date().toISOString(),
    updated_at: normalizeTimestamp(announcement.updated_at) || new Date().toISOString(),
  };
}

function normalizeSiteConfigItem(item = {}) {
  const key = normalizeEntityId(item.key);
  if (!key) return null;
  const category = VALID_CONFIG_CATEGORIES.has(item.category) ? item.category : 'general';
  return {
    key,
    value: normalizeText(item.value, MAX_SITE_CONFIG_VALUE_LENGTH),
    label: normalizeText(item.label || key, 120),
    category,
    description: normalizeText(item.description, 1000) || null,
    format: item.format === 'json' ? 'json' : item.format === 'text' ? 'text' : undefined,
    updated_at: normalizeTimestamp(item.updated_at),
    updated_by: item.updated_by === 'local-sandbox' ? 'local-sandbox' : null,
  };
}

function hydrateRosterCharacters(poolCharacters = {}, characters = []) {
  const characterById = new Map(characters.filter(Boolean).map((item) => [item.id, item]));
  return Object.fromEntries(Object.entries(poolCharacters || {}).flatMap(([rawPoolId, rows]) => {
    const poolId = normalizeEntityId(rawPoolId);
    if (!poolId) return [];
    return [[poolId, (Array.isArray(rows) ? rows : []).slice(0, MAX_CHARACTERS).flatMap((row) => {
      const characterId = normalizeEntityId(row?.character_id || row?.characters?.id);
      const entity = characterById.get(characterId) || (row?.characters ? normalizeCharacter(row.characters) : null);
      if (!characterId || !entity) return [];
      return [{
        pool_id: poolId,
        character_id: characterId,
        is_up: Boolean(row?.is_up),
        characters: entity,
      }];
    })]];
  }));
}

function toSiteConfigItems(config = {}) {
  const metadata = {
    site_version: ['站点版本', 'general'],
    build_info: ['构建信息', 'general'],
    homepage_notice: ['首页提示', 'content'],
    home_next_version_target_at: ['下版本目标时间', 'content'],
    home_version_timeline: ['首页版本时间线', 'content'],
  };
  return Object.entries(config || {}).slice(0, MAX_SITE_CONFIG_ITEMS).flatMap(([key, value]) => {
    const item = normalizeSiteConfigItem({
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      label: metadata[key]?.[0] || key,
      category: metadata[key]?.[1] || 'general',
      updated_at: null,
      updated_by: null,
    });
    return item ? [item] : [];
  });
}

function siteConfigItemsToObject(items = []) {
  return Object.fromEntries((Array.isArray(items) ? items : []).filter(Boolean).map((item) => [item.key, item.value]));
}

function createFallbackCatalog() {
  const characters = clone(CONTRIBUTOR_REAL_FALLBACK_CHARACTERS).slice(0, MAX_CHARACTERS).map(normalizeCharacter).filter(Boolean);
  const pools = clone(CONTRIBUTOR_REAL_FALLBACK_POOLS).slice(0, MAX_POOLS).map(normalizePool).filter(Boolean);
  return {
    pools,
    characters,
    poolCharacters: hydrateRosterCharacters(clone(CONTRIBUTOR_REAL_FALLBACK_POOL_CHARACTERS), characters),
    siteConfigItems: toSiteConfigItems(CONTRIBUTOR_REAL_FALLBACK_SITE_CONFIG),
    catalogSource: 'repository-real-fallback',
    catalogFetchedAt: null,
    catalogError: null,
  };
}

function createInitialSandboxState(catalog = createFallbackCatalog()) {
  return {
    schemaVersion: SANDBOX_SCHEMA_VERSION,
    revision: 0,
    initialized: false,
    initializing: false,
    ...catalog,
    announcements: clone(DEFAULT_ANNOUNCEMENTS).map(normalizeAnnouncement).filter(Boolean),
    persistenceError: null,
    idCounters: {
      announcement: 2,
      pool: 0,
      character: 0,
      config: 0,
    },
  };
}

function readPersistedSandbox() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CONTRIBUTOR_DEMO_SANDBOX_STORAGE_KEY) || '';
    if (!raw || raw.length > MAX_SANDBOX_BYTES) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schemaVersion !== SANDBOX_SCHEMA_VERSION) return null;
    if (!Array.isArray(parsed.pools) || !Array.isArray(parsed.characters) || !Array.isArray(parsed.announcements)) return null;
    const characters = parsed.characters.slice(0, MAX_CHARACTERS).map(normalizeCharacter).filter(Boolean);
    const pools = parsed.pools.slice(0, MAX_POOLS).map(normalizePool).filter(Boolean);
    const announcements = parsed.announcements.slice(0, MAX_ANNOUNCEMENTS)
      .map((item, index) => normalizeAnnouncement(item, `sandbox-announcement-${index + 1}`))
      .filter(Boolean);
    const siteConfigItems = (Array.isArray(parsed.siteConfigItems) ? parsed.siteConfigItems : [])
      .slice(0, MAX_SITE_CONFIG_ITEMS)
      .map(normalizeSiteConfigItem)
      .filter(Boolean);
    return {
      ...createInitialSandboxState(),
      revision: Math.max(0, Math.trunc(Number(parsed.revision) || 0)),
      pools,
      characters,
      poolCharacters: hydrateRosterCharacters(parsed.poolCharacters, characters),
      announcements,
      siteConfigItems,
      catalogSource: parsed.catalogSource === 'production-public-api'
        ? 'production-public-api'
        : 'repository-real-fallback',
      catalogFetchedAt: normalizeTimestamp(parsed.catalogFetchedAt),
      catalogError: normalizeText(parsed.catalogError, 1000) || null,
      idCounters: {
        announcement: Math.max(announcements.length, Math.trunc(Number(parsed.idCounters?.announcement) || 0)),
        pool: Math.max(0, Math.trunc(Number(parsed.idCounters?.pool) || 0)),
        character: Math.max(0, Math.trunc(Number(parsed.idCounters?.character) || 0)),
        config: Math.max(0, Math.trunc(Number(parsed.idCounters?.config) || 0)),
      },
      persistenceError: null,
      initialized: true,
      initializing: false,
    };
  } catch {
    return null;
  }
}

function persistSandbox(state) {
  if (typeof window === 'undefined') return false;
  try {
    const compactPoolCharacters = Object.fromEntries(
      Object.entries(state.poolCharacters || {}).map(([poolId, rows]) => [
        poolId,
        (Array.isArray(rows) ? rows : []).map(({ character_id, is_up }) => ({ character_id, is_up })),
      ])
    );
    const serializable = {
      schemaVersion: SANDBOX_SCHEMA_VERSION,
      revision: state.revision,
      pools: state.pools,
      characters: state.characters,
      poolCharacters: compactPoolCharacters,
      announcements: state.announcements,
      siteConfigItems: state.siteConfigItems,
      catalogSource: state.catalogSource,
      catalogFetchedAt: state.catalogFetchedAt,
      catalogError: state.catalogError,
      idCounters: state.idCounters,
      savedAt: new Date().toISOString(),
    };
    const serialized = JSON.stringify(serializable);
    if (serialized.length > MAX_SANDBOX_BYTES) return false;
    window.localStorage.setItem(CONTRIBUTOR_DEMO_SANDBOX_STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

async function fetchJson(path) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), LIVE_CATALOG_TIMEOUT_MS);
  try {
    const response = await fetch(`${CONTRIBUTOR_DEMO_CATALOG_API_BASE}${path}`, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`public catalog returned ${response.status}`);
    const payload = await response.json();
    if (payload?.success !== true) throw new Error(payload?.error || 'public catalog returned failure');
    return payload.data || {};
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function loadLiveCatalog() {
  const [poolPayload, characterPayload, bootstrapPayload] = await Promise.all([
    fetchJson('/api/stats?type=pool_catalog'),
    fetchJson('/api/stats?type=characters'),
    fetchJson('/api/bootstrap'),
  ]);
  const pools = (Array.isArray(poolPayload.pools) ? poolPayload.pools : []).map(normalizePool);
  const characters = (Array.isArray(characterPayload.characters) ? characterPayload.characters : []).map(normalizeCharacter);
  if (pools.length === 0 || characters.length === 0) {
    throw new Error('正式站公开目录为空');
  }
  const poolIds = pools.map((pool) => pool.pool_id).filter(Boolean);
  const rosterPayload = await fetchJson(`/api/pool-rosters?poolIds=${encodeURIComponent(poolIds.join(','))}`);
  const poolCharacters = hydrateRosterCharacters(rosterPayload.poolRosters || {}, characters);
  const publicSiteConfig = pickPublicSiteConfig(bootstrapPayload.siteConfig);
  const mergedSiteConfig = {
    ...CONTRIBUTOR_REAL_FALLBACK_SITE_CONFIG,
    ...publicSiteConfig,
    build_info: 'Contributor sandbox · live public catalog · local edits only',
    homepage_notice: '当前为本地内容沙盒。游戏目录来自正式站公开 API，所有内容修改只保存在本浏览器。',
  };
  return {
    pools,
    characters,
    poolCharacters,
    siteConfigItems: toSiteConfigItems(mergedSiteConfig),
    catalogSource: 'production-public-api',
    catalogFetchedAt: new Date().toISOString(),
    catalogError: null,
  };
}

function commitSandbox(set, get, patch, { persist = true } = {}) {
  const nextPatch = typeof patch === 'function' ? patch(get()) : patch;
  set((state) => ({
    ...nextPatch,
    revision: state.revision + 1,
  }));
  const persisted = !persist || persistSandbox(get());
  set({
    persistenceError: persisted
      ? null
      : '本地沙盒超过浏览器存储上限或存储不可用；本次修改不会在刷新后保留。',
  });
  return get();
}

export const useContributorDemoSandboxStore = create((set, get) => ({
  ...createInitialSandboxState(),

  replaceSandbox: (sandbox, options) => commitSandbox(set, get, sandbox, options),

  saveAnnouncement: (form, editingAnnouncement = null) => {
    const now = new Date().toISOString();
    let saved = null;
    commitSandbox(set, get, (state) => {
      if (!editingAnnouncement && state.announcements.length >= MAX_ANNOUNCEMENTS) return {};
      const nextCounter = state.idCounters.announcement + 1;
      const id = editingAnnouncement?.id || `sandbox-announcement-${nextCounter}`;
      saved = normalizeAnnouncement({
        ...(editingAnnouncement || {}),
        ...form,
        id,
        created_at: editingAnnouncement?.created_at || now,
        updated_at: now,
      });
      if (!saved) return {};
      const announcements = editingAnnouncement
        ? state.announcements.map((item) => item.id === editingAnnouncement.id ? saved : item)
        : [saved, ...state.announcements];
      return {
        announcements,
        idCounters: { ...state.idCounters, announcement: nextCounter },
      };
    });
    return clone(saved);
  },

  toggleAnnouncement: (id) => commitSandbox(set, get, (state) => ({
    announcements: state.announcements.map((item) => item.id === id
      ? { ...item, is_active: !item.is_active, updated_at: new Date().toISOString() }
      : item),
  })),

  deleteAnnouncement: (id) => commitSandbox(set, get, (state) => ({
    announcements: state.announcements.filter((item) => item.id !== id),
  })),

  savePool: (poolData, editingPool = null, rosterRows = []) => {
    let saved = null;
    commitSandbox(set, get, (state) => {
      if (!editingPool && state.pools.length >= MAX_POOLS) return {};
      const nextCounter = state.idCounters.pool + 1;
      const poolId = editingPool?.pool_id || editingPool?.id || `sandbox-pool-${nextCounter}`;
      const now = new Date().toISOString();
      saved = normalizePool({
        ...(editingPool || {}),
        ...poolData,
        id: poolId,
        pool_id: poolId,
        created_at: editingPool?.created_at || now,
        updated_at: now,
      });
      if (!saved) return {};
      const pools = editingPool
        ? state.pools.map((item) => item.pool_id === poolId ? saved : item)
        : [saved, ...state.pools];
      const characterById = new Map(state.characters.map((item) => [item.id, item]));
      const normalizedRoster = rosterRows.flatMap((row) => {
        const entity = characterById.get(row.character_id);
        return entity ? [{ pool_id: poolId, character_id: row.character_id, is_up: Boolean(row.is_up), characters: entity }] : [];
      });
      return {
        pools,
        poolCharacters: { ...state.poolCharacters, [poolId]: normalizedRoster },
        idCounters: { ...state.idCounters, pool: nextCounter },
      };
    });
    return clone(saved);
  },

  deletePool: (poolId) => commitSandbox(set, get, (state) => {
    const poolCharacters = { ...state.poolCharacters };
    delete poolCharacters[poolId];
    return {
      pools: state.pools.filter((item) => item.pool_id !== poolId),
      poolCharacters,
    };
  }),

  saveCharacter: (characterData, editingCharacter = null) => {
    const saved = normalizeCharacter({ ...(editingCharacter || {}), ...characterData });
    if (!saved || (!editingCharacter && get().characters.length >= MAX_CHARACTERS)) return null;
    commitSandbox(set, get, (state) => {
      const oldId = editingCharacter?.id || null;
      const characters = editingCharacter
        ? state.characters.map((item) => item.id === oldId ? saved : item)
        : [saved, ...state.characters];
      const poolCharacters = Object.fromEntries(Object.entries(state.poolCharacters).map(([poolId, rows]) => [
        poolId,
        rows.map((row) => row.character_id === oldId || row.character_id === saved.id
          ? { ...row, character_id: saved.id, characters: saved }
          : row),
      ]));
      return { characters, poolCharacters };
    });
    return clone(saved);
  },

  deleteCharacters: (ids) => commitSandbox(set, get, (state) => {
    const idSet = new Set(ids);
    return {
      characters: state.characters.filter((item) => !idSet.has(item.id)),
      poolCharacters: Object.fromEntries(Object.entries(state.poolCharacters).map(([poolId, rows]) => [
        poolId,
        rows.filter((row) => !idSet.has(row.character_id)),
      ])),
    };
  }),

  batchUpdateCharacters: (ids, batchForm) => commitSandbox(set, get, (state) => {
    const idSet = new Set(ids);
    const characters = state.characters.map((item) => {
      if (!idSet.has(item.id)) return item;
      const nextPools = new Set(Array.isArray(item.pool_config?.pools) ? item.pool_config.pools : []);
      Object.entries(batchForm?.pools || {}).forEach(([pool, enabled]) => {
        if (enabled === true) nextPools.add(pool);
        if (enabled === false) nextPools.delete(pool);
      });
      return normalizeCharacter({
        ...item,
        is_limited: batchForm?.is_limited === null || batchForm?.is_limited === undefined
          ? item.is_limited
          : batchForm.is_limited,
        pool_config: { ...(item.pool_config || {}), pools: Array.from(nextPools) },
      });
    });
    const characterById = new Map(characters.map((item) => [item.id, item]));
    return {
      characters,
      poolCharacters: Object.fromEntries(Object.entries(state.poolCharacters).map(([poolId, rows]) => [
        poolId,
        rows.map((row) => ({ ...row, characters: characterById.get(row.character_id) || row.characters })),
      ])),
    };
  }),

  upsertSiteConfig: (key, value, metadata = {}) => {
    const now = new Date().toISOString();
    const item = normalizeSiteConfigItem({
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      label: metadata.label || key,
      category: metadata.category || 'general',
      description: metadata.description || null,
      updated_at: now,
      updated_by: 'local-sandbox',
    });
    if (!item) return false;
    if (!get().siteConfigItems.some((entry) => entry.key === item.key) && get().siteConfigItems.length >= MAX_SITE_CONFIG_ITEMS) {
      return false;
    }
    commitSandbox(set, get, (state) => {
      const exists = state.siteConfigItems.some((entry) => entry.key === item.key);
      return {
        siteConfigItems: exists
          ? state.siteConfigItems.map((entry) => entry.key === item.key ? item : entry)
          : [...state.siteConfigItems, item],
      };
    });
    return !get().persistenceError;
  },

  deleteSiteConfig: (key) => commitSandbox(set, get, (state) => ({
    siteConfigItems: state.siteConfigItems.filter((item) => item.key !== key),
  })),
}));

let initializePromise = null;

export async function initializeContributorDemoSandbox({ forceCatalogRefresh = false, resetContent = false } = {}) {
  if (!isContributorDemoModeEnabled()) return useContributorDemoSandboxStore.getState();
  if (initializePromise) return initializePromise;
  const current = useContributorDemoSandboxStore.getState();
  if (current.initialized && !forceCatalogRefresh && !resetContent) return current;

  initializePromise = (async () => {
    useContributorDemoSandboxStore.setState({ initializing: true });
    const persisted = !resetContent && !forceCatalogRefresh ? readPersistedSandbox() : null;
    if (persisted) {
      useContributorDemoSandboxStore.setState(persisted);
      return useContributorDemoSandboxStore.getState();
    }

    let catalog;
    try {
      catalog = await loadLiveCatalog();
    } catch (error) {
      catalog = {
        ...createFallbackCatalog(),
        catalogError: error?.message || String(error),
      };
    }
    const seed = createInitialSandboxState(catalog);
    seed.initialized = true;
    useContributorDemoSandboxStore.setState(seed);
    persistSandbox(useContributorDemoSandboxStore.getState());
    return useContributorDemoSandboxStore.getState();
  })().finally(() => {
    initializePromise = null;
    useContributorDemoSandboxStore.setState({ initializing: false });
  });

  return initializePromise;
}

export async function refreshContributorDemoLiveCatalog({ preserveContent = true } = {}) {
  const current = useContributorDemoSandboxStore.getState();
  const liveCatalog = await loadLiveCatalog();
  const patch = preserveContent
    ? {
      ...liveCatalog,
      announcements: current.announcements,
      siteConfigItems: current.siteConfigItems,
      initialized: true,
    }
    : { ...createInitialSandboxState(liveCatalog), initialized: true };
  useContributorDemoSandboxStore.getState().replaceSandbox(patch);
  return useContributorDemoSandboxStore.getState();
}

export async function resetContributorDemoSandbox() {
  let baseline;
  try {
    baseline = await loadLiveCatalog();
  } catch (error) {
    baseline = { ...createFallbackCatalog(), catalogError: error?.message || String(error) };
  }
  const seed = createInitialSandboxState(baseline);
  seed.initialized = true;
  useContributorDemoSandboxStore.setState(seed);
  persistSandbox(useContributorDemoSandboxStore.getState());
  return useContributorDemoSandboxStore.getState();
}

export function clearContributorDemoSandboxStorage() {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.removeItem(CONTRIBUTOR_DEMO_SANDBOX_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function getContributorDemoSandboxSnapshot() {
  const state = useContributorDemoSandboxStore.getState();
  return clone({
    pools: state.pools,
    characters: state.characters,
    poolCharacters: state.poolCharacters,
    announcements: state.announcements,
    siteConfigItems: state.siteConfigItems,
    siteConfig: siteConfigItemsToObject(state.siteConfigItems),
    catalogSource: state.catalogSource,
    catalogFetchedAt: state.catalogFetchedAt,
    catalogError: state.catalogError,
    persistenceError: state.persistenceError,
    revision: state.revision,
  });
}

export const contributorDemoSandboxAdapters = {
  announcements: {
    save(form, editing) {
      return useContributorDemoSandboxStore.getState().saveAnnouncement(form, editing);
    },
    toggle(id) {
      return useContributorDemoSandboxStore.getState().toggleAnnouncement(id);
    },
    delete(id) {
      return useContributorDemoSandboxStore.getState().deleteAnnouncement(id);
    },
  },
  pools: {
    async loadPools() {
      return { success: true, data: clone(useContributorDemoSandboxStore.getState().pools) };
    },
    async loadCharacters() {
      return { success: true, data: clone(useContributorDemoSandboxStore.getState().characters) };
    },
    async loadAllPoolCharacters() {
      const state = useContributorDemoSandboxStore.getState();
      return {
        success: true,
        data: Object.fromEntries(Object.entries(state.poolCharacters).map(([poolId, rows]) => [
          poolId,
          rows.map(({ character_id, is_up }) => ({ character_id, is_up })),
        ])),
      };
    },
    async loadPoolCharactersForEdit(poolId) {
      const rows = useContributorDemoSandboxStore.getState().poolCharacters[poolId] || [];
      return { success: true, data: clone(rows.map(({ character_id, is_up }) => ({ character_id, is_up }))) };
    },
    async createUpCharacter(name, poolType, introducedAt, rotationCount, expectedType) {
      const type = expectedType === 'weapon' ? 'weapon' : 'character';
      const id = `sandbox-${type}-${Date.now().toString(36)}`;
      const entity = {
        id,
        name,
        rarity: 6,
        type,
        aliases: [],
        is_limited: poolType !== 'standard',
        avatar_url: null,
        pool_config: {
          pools: type === 'weapon' ? ['weapon'] : poolType === 'standard' ? ['standard'] : ['limited'],
          introduced_at: introducedAt,
          limited_rotation_count: rotationCount || 0,
        },
      };
      const saved = useContributorDemoSandboxStore.getState().saveCharacter(entity, null);
      if (!saved || useContributorDemoSandboxStore.getState().persistenceError) {
        throw new Error(useContributorDemoSandboxStore.getState().persistenceError || '本地实体数据无效');
      }
      return saved;
    },
    async savePool(poolData, editingPool, characters, rosterRows) {
      const pool = useContributorDemoSandboxStore.getState().savePool(poolData, editingPool, rosterRows);
      const persistenceError = useContributorDemoSandboxStore.getState().persistenceError;
      if (!pool || persistenceError) {
        return { success: false, error: persistenceError || '本地卡池数据无效' };
      }
      return { success: true, isNew: !editingPool, addedCount: rosterRows.length, poolId: pool.pool_id };
    },
    async deletePool(poolId) {
      useContributorDemoSandboxStore.getState().deletePool(poolId);
      const error = useContributorDemoSandboxStore.getState().persistenceError;
      return error ? { success: false, error } : { success: true };
    },
    async recalculateIsStandard() {
      return { success: true, changedCount: 0, message: '本地沙盒不修改抽卡历史；目录预览已是最新状态。' };
    },
  },
  characters: {
    async loadCharacters() {
      return { data: clone(useContributorDemoSandboxStore.getState().characters), error: null };
    },
    async saveCharacter(data, editing) {
      const saved = useContributorDemoSandboxStore.getState().saveCharacter(data, editing);
      const message = useContributorDemoSandboxStore.getState().persistenceError;
      return saved && !message ? { success: true, error: null } : { success: false, error: new Error(message || '本地实体数据无效') };
    },
    async deleteCharacter(id) {
      useContributorDemoSandboxStore.getState().deleteCharacters([id]);
      const message = useContributorDemoSandboxStore.getState().persistenceError;
      return message ? { success: false, error: new Error(message) } : { success: true, error: null };
    },
    async batchDeleteCharacters(ids) {
      useContributorDemoSandboxStore.getState().deleteCharacters(ids);
      const message = useContributorDemoSandboxStore.getState().persistenceError;
      return message ? { success: false, error: new Error(message) } : { success: true, error: null };
    },
    async batchUpdateCharacters(ids, form) {
      useContributorDemoSandboxStore.getState().batchUpdateCharacters(ids, form);
      const message = useContributorDemoSandboxStore.getState().persistenceError;
      return message
        ? { success: false, updateCount: 0, error: new Error(message) }
        : { success: true, updateCount: ids.length, error: null };
    },
  },
  siteConfig: {
    async loadItems() {
      return clone(useContributorDemoSandboxStore.getState().siteConfigItems);
    },
    async updateConfig(key, value, metadata) {
      return useContributorDemoSandboxStore.getState().upsertSiteConfig(key, value, metadata);
    },
    async deleteConfig(key) {
      useContributorDemoSandboxStore.getState().deleteSiteConfig(key);
      return !useContributorDemoSandboxStore.getState().persistenceError;
    },
  },
};

export default useContributorDemoSandboxStore;
