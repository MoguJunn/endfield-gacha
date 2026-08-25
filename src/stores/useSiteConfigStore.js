import { useMemo } from 'react';
import { create } from 'zustand';
import { invalidatePublicCache } from '../services/admin/publicCacheService.js';
import { getBootstrapSiteConfig } from '../services/bootstrapService.js';
import { saveAdminSiteConfigItem } from '../services/admin/siteConfigService.js';
import { executeSupabaseRead } from '../services/supabaseRequest.js';
import { supabase } from '../supabaseClient.js';
import { APP_BUILD_INFO, APP_VERSION_LABEL } from '../constants/appMeta.js';
import { readStorageValue, STORAGE_KEYS, writeStorageValue } from '../utils/storageUtils.js';
import {
  DEFAULT_HOME_NEXT_VERSION_TARGET_DATE,
  DEFAULT_HOME_VERSION_TIMELINE,
  HOME_NEXT_VERSION_TARGET_CONFIG_KEY,
  HOME_VERSION_TIMELINE_CONFIG_KEY,
} from '../utils/homeVersionTimeline.js';
import {
  isPublicSiteConfigKey,
  pickPublicSiteConfig,
  PUBLIC_SITE_CONFIG_KEYS,
} from '../../shared/publicSiteConfig.js';

export {
  DEFAULT_HOME_NEXT_VERSION_TARGET_DATE,
  DEFAULT_HOME_VERSION_TIMELINE,
  HOME_NEXT_VERSION_TARGET_CONFIG_KEY,
  HOME_VERSION_TIMELINE_CONFIG_KEY,
};

const VERSION_CONFIG_METADATA = {
  site_version: { label: '站点版本', category: 'general' },
  build_info: { label: '构建信息', category: 'general' },
};

function isBlankConfigValue(value) {
  return value == null || String(value).trim() === '';
}

function normalizeVersionConfig(config) {
  const normalizedConfig = pickPublicSiteConfig(config);

  return {
    ...normalizedConfig,
    site_version: isBlankConfigValue(normalizedConfig.site_version)
      ? APP_VERSION_LABEL
      : normalizedConfig.site_version,
    build_info: isBlankConfigValue(normalizedConfig.build_info)
      ? APP_BUILD_INFO
      : normalizedConfig.build_info,
  };
}

function readSiteConfigSnapshot() {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const rawSnapshot = readStorageValue(STORAGE_KEYS.SITE_CONFIG_SNAPSHOT_V1, null, { raw: true });
    if (!rawSnapshot) {
      return {};
    }

    const parsedSnapshot = JSON.parse(rawSnapshot);
    return parsedSnapshot && typeof parsedSnapshot.config === 'object' && parsedSnapshot.config !== null
      ? normalizeVersionConfig(pickPublicSiteConfig(parsedSnapshot.config))
      : {};
  } catch {
    return {};
  }
}

function writeSiteConfigSnapshot(config) {
  if (typeof window === 'undefined' || !config || typeof config !== 'object') {
    return;
  }

  try {
    writeStorageValue(STORAGE_KEYS.SITE_CONFIG_SNAPSHOT_V1, JSON.stringify({
      config: normalizeVersionConfig(pickPublicSiteConfig(config)),
      fetchedAt: Date.now(),
    }), { raw: true });
  } catch {
    // 本地缓存写入失败时静默降级
  }
}

const INITIAL_SITE_CONFIG_SNAPSHOT = readSiteConfigSnapshot();

/**
 * 站点配置状态管理
 * 从数据库 site_config 表读取可编辑的站点配置（备案号、作者信息等）
 */
const useSiteConfigStore = create((set, get) => ({
  config: INITIAL_SITE_CONFIG_SNAPSHOT,
  loaded: Object.keys(INITIAL_SITE_CONFIG_SNAPSHOT).length > 0,
  updateError: null,

  /**
   * 从数据库加载所有站点配置
   */
  loadConfig: async () => {
    const snapshot = readSiteConfigSnapshot();
    const bootstrapConfig = await getBootstrapSiteConfig().catch(() => null);

    if (bootstrapConfig && Object.keys(bootstrapConfig).length > 0) {
      writeSiteConfigSnapshot(bootstrapConfig);
      set({ config: normalizeVersionConfig(bootstrapConfig), loaded: true });
      return;
    }

    if (supabase) {
      try {
        const { data, error } = await executeSupabaseRead(
          () => supabase
            .from('site_config')
            .select('key, value')
            .in('key', PUBLIC_SITE_CONFIG_KEYS),
          {
            label: 'load site config'
          }
        );

        if (!error && Array.isArray(data) && data.length > 0) {
          const nextConfig = Object.fromEntries(
            data
              .filter((row) => isPublicSiteConfigKey(row?.key))
              .map((row) => [row.key, row.value])
          );
          const normalizedConfig = normalizeVersionConfig(nextConfig);
          writeSiteConfigSnapshot(normalizedConfig);
          set({ config: normalizedConfig, loaded: true });
          return;
        }
      } catch {
        // 本地直连失败时回退到快照
      }
    }

    set({ config: normalizeVersionConfig(snapshot), loaded: true });
  },

  /**
   * 获取配置值，未加载时返回 fallback
   */
  getConfig: (key, fallback = '') => {
    const { config } = get();
    return config[key] ?? fallback;
  },

  /**
   * 获取 JSON 配置值，自动解析，解析失败返回 defaultValue
   */
  getJsonConfig: (key, defaultValue = null) => {
    const { config } = get();
    const raw = config[key];
    if (raw == null || raw === '') return defaultValue;
    if (typeof raw !== 'string') return raw;
    try {
      return JSON.parse(raw);
    } catch {
      return defaultValue;
    }
  },

  /**
   * 管理员更新配置项
   */
  updateConfig: async (key, value, meta = {}) => {
    try {
      const versionMeta = VERSION_CONFIG_METADATA[key];
      const savedItem = await saveAdminSiteConfigItem({
        key,
        value,
        label: meta.label || versionMeta?.label || key,
        category: meta.category || versionMeta?.category || 'general',
      });

      if (isPublicSiteConfigKey(key)) {
        const nextConfig = normalizeVersionConfig({ ...get().config, [key]: savedItem?.value ?? value });
        writeSiteConfigSnapshot(nextConfig);
        set({ config: nextConfig, updateError: null });
      } else {
        set({ updateError: null });
      }

      if (key !== 'public_cache_epoch') {
        await invalidatePublicCache('site-config', `admin:site-config:${key}`);
      }

      return true;
    } catch (error) {
      set({ updateError: error });
      return false;
    }
  },
}));

/**
 * React 19 safe hook: select raw config value and memoize JSON parsing.
 * Avoids creating new object references inside Zustand selectors which
 * breaks useSyncExternalStore's getSnapshot caching.
 */
export function useJsonConfig(key, defaultValue = null) {
  const raw = useSiteConfigStore(s => s.config[key]);
  return useMemo(() => {
    if (raw == null || raw === '') return defaultValue;
    if (typeof raw !== 'string') return raw;
    try { return JSON.parse(raw); } catch { return defaultValue; }
  }, [raw, defaultValue]);
}

export default useSiteConfigStore;
