/**
 * @file characterUtils.js
 * @description 角色数据缓存管理工具
 * @date 2026-01-11
 * @feat FEAT-007 卡池详情系统重构 - 角色映射系统
 */

import {
  fetchPublicApiJson,
  shouldAllowPublicSupabaseFallback,
} from '../services/publicResourceClient.js';
import { executeSupabaseMutation, executeSupabaseRead } from '../services/supabaseRequest.js';
import { isSupabaseRealtimeEnabled, supabase } from '../supabaseClient.js';
import { readStorageValue, STORAGE_KEYS, writeStorageValue } from './storageUtils.js';
import { normalizeEntityNameForMatch } from './canonicalEntityUtils.js';
import { isContributorDemoModeEnabled } from '../dev/contributorDemoMode.js';
import { sanitizePublicCharacterRecord } from '../../shared/publicCatalogDto.js';
import { APPROVED_PUBLIC_RESOURCE_HOSTS } from './publicResourceUrl.js';

const PUBLIC_CHARACTERS_API_TIMEOUT_MS = 25000;

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readCharacterSnapshot() {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const rawSnapshot = readStorageValue(STORAGE_KEYS.CHARACTER_CACHE_SNAPSHOT_V1, null, { raw: true });
    if (!rawSnapshot) {
      return [];
    }

    const parsedSnapshot = JSON.parse(rawSnapshot);
    return (Array.isArray(parsedSnapshot?.characters) ? parsedSnapshot.characters : [])
      .map((character) => sanitizePublicCharacterRecord(character, { allowedHosts: APPROVED_PUBLIC_RESOURCE_HOSTS }))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeCharacterSnapshot(characters) {
  if (typeof window === 'undefined' || !Array.isArray(characters)) {
    return;
  }

  try {
    writeStorageValue(STORAGE_KEYS.CHARACTER_CACHE_SNAPSHOT_V1, JSON.stringify({
      characters,
      fetchedAt: Date.now(),
    }), { raw: true });
  } catch {
    // 本地缓存写入失败时静默降级
  }
}

async function fetchCharactersFromPublicApi() {
  const result = await fetchPublicApiJson('/api/stats', {
    params: { type: 'characters' },
    label: 'public characters api',
    timeoutMs: PUBLIC_CHARACTERS_API_TIMEOUT_MS,
    retries: 1,
  });

  return Array.isArray(result?.data?.characters) ? result.data.characters : null;
}

/**
 * 角色数据缓存管理器（单例模式）
 *
 * 功能：
 * 1. 启动时从 Supabase 加载所有角色数据
 * 2. 提供快速查询接口（按ID/名称/别名）
 * 3. 支持本地缓存，减少网络请求
 * 4. 支持实时更新（管理员添加新角色时）
 */
class CharacterCache {
  constructor() {
    /** @type {Map<string, Character>} 角色ID映射表 */
    this.cache = new Map();

    /** @type {Map<string, string>} 别名映射到角色ID */
    this.aliasMap = new Map();

    /** @type {boolean} 是否已加载 */
    this.loaded = false;

    /** @type {boolean} 是否正在加载 */
    this.loading = false;

    /** @type {Array<Function>} 加载完成回调队列 */
    this.loadCallbacks = [];

    /** @type {RealtimeChannel} Supabase实时订阅频道 */
    this.subscription = null;
  }

  applyCharacters(characters = []) {
    this.cache.clear();
    this.aliasMap.clear();

    characters
      .map((character) => sanitizePublicCharacterRecord(character, { allowedHosts: APPROVED_PUBLIC_RESOURCE_HOSTS }))
      .filter(Boolean)
      .forEach((char) => {
        this.cache.set(char.id, char);

        if (char.aliases && Array.isArray(char.aliases)) {
          char.aliases.forEach((alias) => {
            this.aliasMap.set(alias.toLowerCase(), char.id);
          });
        }

        if (char.name) {
          this.aliasMap.set(char.name.toLowerCase(), char.id);
        }
      });
  }

  finishLoading() {
    this.loaded = true;
    this.loading = false;
    this.loadCallbacks.forEach((callback) => callback());
    this.loadCallbacks = [];
  }

  persistSnapshot() {
    writeCharacterSnapshot(this.getAll());
  }

  /**
   * 初始化角色数据（应用启动时调用一次）
   * @returns {Promise<void>}
   */
  async load() {
    // 防止重复加载
    if (this.loaded) {
      return Promise.resolve();
    }

    // 如果正在加载，返回等待Promise
    if (this.loading) {
      return new Promise((resolve) => {
        this.loadCallbacks.push(resolve);
      });
    }

    this.loading = true;

    if (isContributorDemoModeEnabled()) {
      const {
        getContributorDemoSandboxSnapshot,
        initializeContributorDemoSandbox,
      } = await import('../dev/contributorDemoSandboxStore.js');
      await initializeContributorDemoSandbox();
      this.applyCharacters(getContributorDemoSandboxSnapshot().characters);
      this.finishLoading();
      return;
    }

    const cachedCharacters = readCharacterSnapshot();

    try {
      const apiCharacters = await fetchCharactersFromPublicApi().catch(() => null);
      if (Array.isArray(apiCharacters) && apiCharacters.length > 0) {
        this.applyCharacters(apiCharacters);
        this.persistSnapshot();
        this.finishLoading();

        if (isSupabaseRealtimeEnabled() && shouldAllowPublicSupabaseFallback()) {
          this.subscribeToUpdates();
        }
        return;
      }

      if (!supabase || !shouldAllowPublicSupabaseFallback()) {
        if (cachedCharacters.length > 0) {
          this.applyCharacters(cachedCharacters);
        }
        this.finishLoading();
        return;
      }

      const { data, error } = await executeSupabaseRead(
        () => supabase
          .from('characters')
          .select('id, name, avatar_url, rarity, type, aliases, is_limited, release_date, created_at, updated_at, pool_config')
          .order('name'),
        {
          label: 'load characters',
          retries: 2,
        }
      );

      if (error) {
        throw new Error(`加载角色数据失败: ${error.message}`);
      }

      if (Array.isArray(data) && data.length > 0) {
        this.applyCharacters(data);
        this.persistSnapshot();
      } else if (cachedCharacters.length > 0) {
        this.applyCharacters(cachedCharacters);
      } else {
        this.cache.clear();
        this.aliasMap.clear();
      }

      this.finishLoading();
      if (isSupabaseRealtimeEnabled()) {
        this.subscribeToUpdates();
      }
    } catch {
      if (cachedCharacters.length > 0) {
        this.applyCharacters(cachedCharacters);
      } else {
        this.cache.clear();
        this.aliasMap.clear();
      }

      this.finishLoading();

      if (isSupabaseRealtimeEnabled() && shouldAllowPublicSupabaseFallback()) {
        this.subscribeToUpdates();
      }
    }
  }

  /**
   * 订阅角色表的实时更新
   * @private
   */
  subscribeToUpdates() {
    if (this.subscription || !supabase || !isSupabaseRealtimeEnabled()) return;

    try {
      this.subscription = supabase
        .channel('characters_changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'characters',
          },
          (payload) => {
            this.handleRealtimeUpdate(payload);
          }
        )
        .subscribe();
    } catch {
      // Realtime 失败不影响本地缓存读取
    }
  }

  /**
   * 处理实时更新事件
   * @private
   * @param {Object} payload - Supabase实时更新载荷
   */
  handleRealtimeUpdate(payload) {
    const { eventType, new: newRecord, old: oldRecord } = payload;

    switch (eventType) {
      case 'INSERT':
      case 'UPDATE':
        if (newRecord) {
          const safeRecord = sanitizePublicCharacterRecord(newRecord, { allowedHosts: APPROVED_PUBLIC_RESOURCE_HOSTS });
          if (!safeRecord) break;
          this.cache.set(safeRecord.id, safeRecord);
          // 更新别名映射
          if (safeRecord.aliases) {
            safeRecord.aliases.forEach((alias) => {
              this.aliasMap.set(alias.toLowerCase(), safeRecord.id);
            });
          }
          this.aliasMap.set(safeRecord.name.toLowerCase(), safeRecord.id);
          this.persistSnapshot();
        }
        break;

      case 'DELETE':
        if (oldRecord) {
          this.cache.delete(oldRecord.id);
          // 清理别名映射
          if (oldRecord.aliases) {
            oldRecord.aliases.forEach((alias) => {
              this.aliasMap.delete(alias.toLowerCase());
            });
          }
          this.aliasMap.delete(oldRecord.name.toLowerCase());
          this.persistSnapshot();
        }
        break;

      default:
        break;
    }
  }

  /**
   * 根据ID获取角色
   * @param {string} charId - 角色ID，如 'char_levantin'
   * @returns {Character|null} 角色对象或null
   */
  getById(charId) {
    if (!charId) return null;
    return this.cache.get(charId) || null;
  }

  /**
   * 根据名称搜索（支持别名、模糊匹配）
   * @param {string} name - 角色名称或别名
   * @param {boolean} fuzzy - 是否启用模糊匹配（默认true）
   * @returns {Character|null} 角色对象或null
   */
  searchByName(name, fuzzy = true) {
    if (!name) return null;

    const lowerName = name.toLowerCase().trim();

    // 1. 精确匹配（通过别名映射）
    const charId = this.aliasMap.get(lowerName);
    if (charId) {
      return this.cache.get(charId);
    }

    // 2. 模糊匹配（遍历所有角色）
    if (fuzzy) {
      for (const char of this.cache.values()) {
        // 匹配名称
        if (char.name.toLowerCase().includes(lowerName)) {
          return char;
        }
        // 匹配别名
        if (
          char.aliases &&
          char.aliases.some((alias) =>
            alias.toLowerCase().includes(lowerName)
          )
        ) {
          return char;
        }
      }
    }

    return null;
  }

  /**
   * 获取所有角色列表
   * @param {Object} filters - 过滤条件
   * @param {number} [filters.rarity] - 稀有度（3-6）
   * @param {string} [filters.type] - 类型（'character'|'weapon'）
   * @param {boolean} [filters.isLimited] - 是否限定
   * @returns {Array<Character>} 角色列表
   */
  getAll(filters = {}) {
    let characters = Array.from(this.cache.values());

    // 应用过滤器
    if (filters.rarity) {
      characters = characters.filter((c) => c.rarity === filters.rarity);
    }
    if (filters.type) {
      characters = characters.filter((c) => c.type === filters.type);
    }
    if (filters.isLimited !== undefined) {
      characters = characters.filter((c) => c.is_limited === filters.isLimited);
    }

    return characters;
  }

  /**
   * 获取6星角色列表（按限定/常驻分组）
   * @returns {Object} { limited: Character[], standard: Character[] }
   */
  get6StarCharacters() {
    const limited = [];
    const standard = [];

    for (const char of this.cache.values()) {
      if (char.rarity === 6 && char.type === 'character') {
        if (char.is_limited) {
          limited.push(char);
        } else {
          standard.push(char);
        }
      }
    }

    return { limited, standard };
  }

  /**
   * 检查缓存是否已加载
   * @returns {boolean}
   */
  isLoaded() {
    return this.loaded;
  }

  /**
   * 清空缓存（测试用）
   */
  clear() {
    this.cache.clear();
    this.aliasMap.clear();
    this.loaded = false;
    this.loading = false;

    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  /**
   * 手动刷新缓存
   * @returns {Promise<void>}
   */
  async refresh() {
    this.loaded = false;
    this.cache.clear();
    this.aliasMap.clear();
    await this.load();
  }
}

// 导出单例实例
export const characterCache = new CharacterCache();

// 开发环境下暴露到 window（方便调试）
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  window.__characterCache = characterCache;
}

export function resolveCharacterRecordByName(name, { fuzzy = true } = {}) {
  if (!name) {
    return null;
  }

  const normalizedName = String(name).trim();
  if (!normalizedName) {
    return null;
  }

  const directIdMatch = characterCache.getById(normalizedName);
  if (directIdMatch) {
    return directIdMatch;
  }

  const lowerCasedName = normalizedName.toLowerCase();
  const caseInsensitiveIdMatch = characterCache.getAll().find((character) => (
    typeof character?.id === 'string' && character.id.trim().toLowerCase() === lowerCasedName
  ));
  if (caseInsensitiveIdMatch) {
    return caseInsensitiveIdMatch;
  }

  const strictMatch = characterCache.searchByName(normalizedName, false);
  if (strictMatch) {
    return strictMatch;
  }

  if (fuzzy) {
    const fuzzyMatch = characterCache.searchByName(normalizedName, true);
    if (fuzzyMatch) {
      return fuzzyMatch;
    }
  }

  const normalizedTarget = normalizeEntityNameForMatch(normalizedName);
  if (!normalizedTarget) {
    return null;
  }

  return characterCache.getAll().find((character) => {
    if (normalizeEntityNameForMatch(character?.id) === normalizedTarget) {
      return true;
    }

    if (normalizeEntityNameForMatch(character?.name) === normalizedTarget) {
      return true;
    }

    return Array.isArray(character?.aliases)
      && character.aliases.some((alias) => normalizeEntityNameForMatch(alias) === normalizedTarget);
  }) || null;
}

export function getCharacterAvatarUrl(name, { fuzzy = true } = {}) {
  return resolveCharacterRecordByName(name, { fuzzy })?.avatar_url || null;
}

/**
 * @typedef {Object} Character
 * @property {string} id - 角色ID
 * @property {string} name - 角色名称
 * @property {string} [avatar_url] - 头像URL
 * @property {number} rarity - 稀有度（3-6）
 * @property {string} type - 类型（'character'|'weapon'）
 * @property {Array<string>} [aliases] - 别名数组
 * @property {boolean} is_limited - 是否限定
 * @property {string} [release_date] - 上线日期
 * @property {Object} [pool_config] - 卡池配置
 * @property {string} created_at - 创建时间
 * @property {string} updated_at - 更新时间
 */

// ============================================
// 卡池角色查询 API（FEAT-007 扩展）
// ============================================

/**
 * 获取指定卡池的可抽角色列表
 * @param {string} poolType - 卡池类型 ('limited', 'standard', 'weapon')
 * @param {number|null} rarity - 星级过滤（可选，null表示不过滤）
 * @param {boolean} onlyActive - 是否仅返回当前激活的角色（限定池专用，检查轮换移出）
 * @param {Object} poolInfo - 可选的池子信息，用于更精确的过滤
 * @param {string} poolInfo.start_time - 池子开始时间
 * @param {number} poolInfo.rotation_position - 池子在轮换序列中的位置
 * @returns {Array<Character>} 角色列表
 *
 * @example
 * // 获取限定池所有6星角色（包括已移出的）
 * const allSixStar = getPoolCharacters('limited', 6, false);
 *
 * // 获取限定池当前可抽的6星角色（排除已移出的）
 * const activeSixStar = getPoolCharacters('limited', 6, true);
 *
 * // 获取武器池所有角色
 * const weaponChars = getPoolCharacters('weapon');
 *
 * // 获取特定池子的可抽角色（考虑角色引入时间）
 * const poolChars = getPoolCharacters('limited', 6, true, { start_time: '2026-01-22T11:00:00Z' });
 */
export function getPoolCharacters(poolType, rarity = null, onlyActive = true, poolInfo = null) {
  const characters = characterCache.getAll();

  return characters.filter(char => {
    // 1. 检查卡池归属
    const pools = char.pool_config?.pools || [];
    if (!pools.includes(poolType)) return false;

    // 2. 星级过滤
    if (rarity !== null && char.rarity !== rarity) return false;

    // 3. 限定池特殊逻辑：优先按池子的轮换位次判断是否仍在池中
    if (poolType === 'limited') {
      const limitedStatus = getLimitedCharacterPoolStatus(char, poolInfo);

      if (!limitedStatus.isIntroduced) {
        return false;
      }

      if (onlyActive && !limitedStatus.isActive) {
        return false;
      }
    }

    return true;
  });
}

export function getLimitedCharacterPoolStatus(character, poolInfo = null) {
  const poolConfig = character?.pool_config || {};
  const removesAfter = normalizeNullableNumber(poolConfig.removes_after);
  const storedRotationCount = Number(poolConfig.limited_rotation_count) || 0;
  const rotationPosition = Number(poolInfo?.rotation_position);
  const hasRotationPosition = Number.isFinite(rotationPosition);
  const effectiveRotationPosition = hasRotationPosition ? rotationPosition : storedRotationCount;

  let isIntroduced = true;
  if (poolInfo?.start_time && poolConfig.introduced_at) {
    const poolStartTime = new Date(poolInfo.start_time);
    const charIntroducedAt = new Date(poolConfig.introduced_at);

    if (!Number.isNaN(poolStartTime.getTime()) && !Number.isNaN(charIntroducedAt.getTime()) && charIntroducedAt > poolStartTime) {
      isIntroduced = false;
    }
  }

  const isRemoved = removesAfter !== null && effectiveRotationPosition >= removesAfter;

  return {
    removesAfter,
    storedRotationCount,
    effectiveRotationPosition,
    isIntroduced,
    isRemoved,
    isActive: isIntroduced && !isRemoved,
    introducedAt: poolConfig.introduced_at || null,
    usesDerivedRotationPosition: hasRotationPosition,
  };
}

/**
 * 获取限定池UP角色（6星）
 * @param {string} currentUpCharacter - 当前UP角色名称
 * @returns {Character|null} UP角色对象或null
 *
 * @example
 * const upChar = getLimitedUpCharacter('莱万汀');
 */
export function getLimitedUpCharacter(currentUpCharacter) {
  if (!currentUpCharacter) return null;
  return characterCache.searchByName(currentUpCharacter);
}

/**
 * 获取限定池可歪角色（6星，排除当前UP）
 * @param {string} currentUpCharacter - 当前UP角色名称
 * @returns {Array<Character>} 可歪角色列表
 *
 * @example
 * const offBannerChars = getLimitedOffBannerCharacters('莱万汀');
 * // 返回：[艾尔黛拉, 骏卫, 别礼, 余烬, 黎风, 伊冯, 洁尔佩塔]（排除莱万汀）
 */
export function getLimitedOffBannerCharacters(currentUpCharacter) {
  const allSixStar = getPoolCharacters('limited', 6, true);
  return allSixStar.filter(char => char.name !== currentUpCharacter);
}

/**
 * 增加限定角色的轮换次数（管理功能）
 * @param {string} characterId - 角色ID
 * @returns {Promise<Object>} 更新后的角色数据
 * @throws {Error} 如果角色不存在或更新失败
 *
 * @example
 * // 新UP池开启时，增加莱万汀的轮换次数
 * await incrementRotationCount('char_levantin');
 */
export async function incrementRotationCount(characterId) {
  const char = characterCache.getById(characterId);
  if (!char) {
    throw new Error(`角色不存在: ${characterId}`);
  }

  const currentCount = char.pool_config?.limited_rotation_count || 0;
  const newCount = currentCount + 1;
  const removesAfter = char.pool_config?.removes_after;

  // 计算是否还在限定池中
  const isActiveInLimited = removesAfter === null || removesAfter === undefined || newCount < removesAfter;

  const updatedPoolConfig = {
    ...char.pool_config,
    limited_rotation_count: newCount,
    is_active_in_limited: isActiveInLimited
  };

  // 更新数据库
  const { data, error } = await executeSupabaseMutation(
    () => supabase
      .from('characters')
      .update({
        pool_config: updatedPoolConfig,
        updated_at: new Date().toISOString()
      })
      .eq('id', characterId)
      .select()
      .single(),
    {
      label: 'increment character rotation count'
    }
  );

  if (error) {
    throw new Error(`更新轮换次数失败: ${error.message}`);
  }

  return data;
}
