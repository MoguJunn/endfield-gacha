/**
 * localStorage 工具函数
 * 用于管理用户偏好设置和状态记忆
 */

// 存储键前缀
const STORAGE_PREFIX = 'gacha_';

// 存储键枚举
export const STORAGE_KEYS = {
  THEME_MODE: 'theme',
  APP_LOCALE: 'app_locale',
  APP_LOCALE_MODE: 'app_locale_mode_v2',
  PLATFORM_PREFERENCE: 'platform-preference',
  CURRENT_POOL_ID: 'gacha_current_pool_id',
  CURRENT_GAME_UID: 'gacha_current_game_uid',
  DASHBOARD_INCLUDE_FREE_PULLS: 'dashboard_include_free_pulls',
  DASHBOARD_SHARE_THEME: 'dashboard_share_theme',
  DASHBOARD_SHARE_THEME_MODE: 'dashboard_share_theme_mode_v2',
  CAPTCHA_MODE_PREFERENCE: 'captchaModePreference',
  PUZZLE_CAPTCHA_DIFFICULTY: 'puzzleCaptchaDifficulty',
  PUZZLE_CAPTCHA_CONSTRAINT_MODE: 'puzzleCaptchaConstraintMode',
  CAPTCHA_LAST_VERIFIED: 'lastCaptchaVerified',
  SIMULATOR_SKIP_ANIMATION: 'simulator_skipAnimation',
  SIMULATOR_MULTIPLE_FREE_TEN: 'simulator_multipleFreeTen',
  SIMULATOR_ORIGINITE_PROMPT_SUPPRESS_DATE: 'simulator_originite_prompt_suppress_date',
  CHARACTER_CACHE_SNAPSHOT_V1: 'character_cache_snapshot_v1',
  SITE_CONFIG_SNAPSHOT_V1: 'site_config_snapshot_v1',
  PUBLIC_BOOTSTRAP_SNAPSHOT_V2: 'public_bootstrap_snapshot_v2',
  PUBLIC_BOOTSTRAP_SNAPSHOT_V3: 'public_bootstrap_snapshot_v3',
  GLOBAL_SUMMARY_STATS_SNAPSHOT: 'global_summary_stats_snapshot',
  CHARACTER_RANKING_SNAPSHOT: 'character_ranking_snapshot_v2',
  CHARACTER_CATALOG_SNAPSHOT: 'character_catalog_snapshot_v1',
  CHARACTER_CATALOG_MANUAL_OVERRIDES: 'character_catalog_manual_overrides_v1',
  USER_RANKING_SNAPSHOT_PREFIX: 'user_ranking_snapshot_v2_',
  ACCOUNT_METADATA: 'gacha_account_metadata',
  // 首页折叠状态
  HOME_ANNOUNCEMENT_COLLAPSED: 'home_announcement_collapsed',
  HOME_TEMPORARY_ANNOUNCEMENTS_COLLAPSED: 'home_temporary_announcements_collapsed',
  HOME_GAME_ANNOUNCEMENTS_COLLAPSED: 'home_game_announcements_collapsed',
  HOME_GAME_CALENDAR_COLLAPSED: 'home_game_calendar_collapsed',
  HOME_GUIDE_COLLAPSED: 'home_guide_collapsed',
  HOME_POOL_MECHANICS_COLLAPSED: 'home_pool_mechanics_collapsed',
  HOME_ROADMAP_COLLAPSED: 'home_roadmap_collapsed',
  // 公告最后查看时间
  ANNOUNCEMENT_LAST_VIEWED: 'announcement_last_viewed',
  // 管理面板最后查看时间
  ADMIN_LAST_VIEWED: 'admin_last_viewed',
  // 工单最后查看时间
  TICKETS_LAST_VIEWED: 'tickets_last_viewed',
  DURABLE_NOTIFICATIONS: 'durable_notifications_v1',
};

function hasStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function resolveStorageKey(key, { raw = false } = {}) {
  return raw ? key : STORAGE_PREFIX + key;
}

function readStorage(key, { raw = false } = {}) {
  if (!hasStorage()) {
    return null;
  }

  try {
    return window.localStorage.getItem(resolveStorageKey(key, { raw }));
  } catch {
    return null;
  }
}

function writeStorage(key, value, { raw = false } = {}) {
  if (!hasStorage()) {
    return false;
  }

  try {
    window.localStorage.setItem(resolveStorageKey(key, { raw }), value);
    return true;
  } catch {
    return false;
  }
}

function removeStorage(key, { raw = false } = {}) {
  if (!hasStorage()) {
    return false;
  }

  try {
    window.localStorage.removeItem(resolveStorageKey(key, { raw }));
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取存储的值
 * @param {string} key - 存储键（不含前缀）
 * @param {*} defaultValue - 默认值
 * @returns {*} 存储的值或默认值
 */
export const getStorageItem = (key, defaultValue = null) => {
  try {
    const item = readStorage(key);
    if (item === null) return defaultValue;
    return JSON.parse(item);
  } catch {
    return defaultValue;
  }
};

/**
 * 设置存储的值
 * @param {string} key - 存储键（不含前缀）
 * @param {*} value - 要存储的值
 */
export const setStorageItem = (key, value) => {
  try {
    writeStorage(key, JSON.stringify(value));
  } catch {
    // 静默失败
  }
};

/**
 * 删除存储的值
 * @param {string} key - 存储键（不含前缀）
 */
export const removeStorageItem = (key) => {
  try {
    removeStorage(key);
  } catch {
    // 静默失败
  }
};

export const readStorageValue = (key, defaultValue = null, options = {}) => {
  const value = readStorage(key, options);
  if (value === null || value === 'null' || value === 'undefined') {
    return defaultValue;
  }
  return value;
};

export const writeStorageValue = (key, value, options = {}) =>
  writeStorage(key, String(value), options);

export const removeStorageValue = (key, options = {}) =>
  removeStorage(key, options);

export const readBooleanStorageValue = (key, defaultValue = false, options = {}) => {
  const value = readStorageValue(key, null, options);
  if (value === null) {
    return defaultValue;
  }

  return value === 'true';
};

export const writeBooleanStorageValue = (key, value, options = {}) =>
  writeStorageValue(key, value ? 'true' : 'false', options);

export const readNumberStorageValue = (key, defaultValue = null, options = {}) => {
  const value = readStorageValue(key, null, options);
  if (value === null) {
    return defaultValue;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : defaultValue;
};

export const writeNumberStorageValue = (key, value, options = {}) =>
  writeStorageValue(key, String(value), options);

/**
 * 检查是否有新内容（基于时间戳比较）
 * @param {string} lastViewedKey - 上次查看时间的存储键
 * @param {string|Date} contentUpdatedAt - 内容更新时间
 * @returns {boolean} 是否有新内容
 */
export const hasNewContent = (lastViewedKey, contentUpdatedAt) => {
  if (!contentUpdatedAt) return false;

  const lastViewed = getStorageItem(lastViewedKey, 0);
  const updatedTime = new Date(contentUpdatedAt).getTime();

  return updatedTime > lastViewed;
};

/**
 * 标记内容为已查看
 * @param {string} lastViewedKey - 上次查看时间的存储键
 */
export const markAsViewed = (lastViewedKey) => {
  setStorageItem(lastViewedKey, Date.now());
};

/**
 * 获取首页折叠状态
 * @returns {{ announcement: boolean, temporaryAnnouncements: boolean, gameAnnouncements: boolean, gameCalendar: boolean, guide: boolean, poolMechanics: boolean, roadmap: boolean }}
 */
export const getHomeCollapseState = () => {
  return {
    announcement: getStorageItem(STORAGE_KEYS.HOME_ANNOUNCEMENT_COLLAPSED, false),
    temporaryAnnouncements: getStorageItem(STORAGE_KEYS.HOME_TEMPORARY_ANNOUNCEMENTS_COLLAPSED, false),
    gameAnnouncements: getStorageItem(STORAGE_KEYS.HOME_GAME_ANNOUNCEMENTS_COLLAPSED, true),
    gameCalendar: getStorageItem(STORAGE_KEYS.HOME_GAME_CALENDAR_COLLAPSED, true),
    guide: getStorageItem(STORAGE_KEYS.HOME_GUIDE_COLLAPSED, false),
    poolMechanics: getStorageItem(STORAGE_KEYS.HOME_POOL_MECHANICS_COLLAPSED, false),
    roadmap: getStorageItem(STORAGE_KEYS.HOME_ROADMAP_COLLAPSED, false),
  };
};

/**
 * 保存首页折叠状态
 * @param {'announcement'|'temporaryAnnouncements'|'gameAnnouncements'|'gameCalendar'|'guide'|'poolMechanics'|'roadmap'} section - 区域名称
 * @param {boolean} collapsed - 是否折叠
 */
export const setHomeCollapseState = (section, collapsed) => {
  const keyMap = {
    announcement: STORAGE_KEYS.HOME_ANNOUNCEMENT_COLLAPSED,
    temporaryAnnouncements: STORAGE_KEYS.HOME_TEMPORARY_ANNOUNCEMENTS_COLLAPSED,
    gameAnnouncements: STORAGE_KEYS.HOME_GAME_ANNOUNCEMENTS_COLLAPSED,
    gameCalendar: STORAGE_KEYS.HOME_GAME_CALENDAR_COLLAPSED,
    guide: STORAGE_KEYS.HOME_GUIDE_COLLAPSED,
    poolMechanics: STORAGE_KEYS.HOME_POOL_MECHANICS_COLLAPSED,
    roadmap: STORAGE_KEYS.HOME_ROADMAP_COLLAPSED,
  };
  if (keyMap[section]) {
    setStorageItem(keyMap[section], collapsed);
  }
};
