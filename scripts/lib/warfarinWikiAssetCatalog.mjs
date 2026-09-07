import { normalizeEntityNameForMatch } from '../../src/utils/canonicalEntityUtils.js';

const WARFARIN_PAGE_CONFIG = Object.freeze({
  character: {
    path: 'operators',
    routeKey: 'routes/$lang.operators._index',
    imageUrl: (record) => record?.id
      ? `https://static.warfarin.wiki/v3/charicon/icon_${record.id}.webp`
      : ''
  },
  weapon: {
    path: 'weapons',
    routeKey: 'routes/$lang.weapons._index',
    imageUrl: (record) => {
      const iconId = record?.iconId || record?.id;
      return iconId ? `https://static.warfarin.wiki/v3/itemicon/${iconId}.webp` : '';
    }
  }
});

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const VALID_LANGUAGES = new Set(['cn', 'en']);

function normalizeRequestedTypes(types = ['character', 'weapon']) {
  return Array.from(new Set(
    (Array.isArray(types) ? types : [types]).filter((type) => (
      Object.prototype.hasOwnProperty.call(WARFARIN_PAGE_CONFIG, type)
    ))
  ));
}

function resolveValue(arr, val, visited = new Set()) {
  if (typeof val === 'number' && val < 0) return undefined;

  if (typeof val === 'number') {
    if (visited.has(val)) return undefined;
    visited.add(val);
    const item = arr[val];

    if (
      item === null ||
      item === undefined ||
      typeof item === 'string' ||
      typeof item === 'boolean' ||
      typeof item === 'number'
    ) {
      return item;
    }

    return resolveValue(arr, item, visited);
  }

  if (val === null || val === undefined) return val;
  if (typeof val === 'string' || typeof val === 'boolean') return val;

  if (Array.isArray(val)) {
    return val.map((item) => resolveValue(arr, item, new Set(visited)));
  }

  if (typeof val === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(val)) {
      if (key.startsWith('_')) {
        const keyIndex = Number.parseInt(key.slice(1), 10);
        const resolvedKey = resolveValue(arr, keyIndex, new Set(visited));
        const resolvedVal = resolveValue(arr, value, new Set(visited));
        if (resolvedKey !== undefined) {
          result[resolvedKey] = resolvedVal;
        }
      } else {
        result[key] = resolveValue(arr, value, new Set(visited));
      }
    }
    return result;
  }

  return val;
}

function parseTurboStream(html) {
  const pattern = /window\.__remixContext\.streamController\.enqueue\("((?:[^"\\]|\\.)*)"\)/g;
  const chunks = [];
  let match;

  while ((match = pattern.exec(html)) !== null) {
    chunks.push(match[1]);
  }

  if (chunks.length === 0) {
    throw new Error('未找到 turbo-stream 数据');
  }

  const raw = chunks
    .map((chunk, index) => {
      try {
        return JSON.parse(`"${chunk}"`);
      } catch (error) {
        throw new Error(`turbo-stream chunk ${index} 解码失败: ${error.message}`);
      }
    })
    .join('');

  const jsonStart = raw.indexOf('[');
  if (jsonStart === -1) {
    throw new Error('未找到 turbo-stream JSON 数组');
  }

  return resolveValue(JSON.parse(raw.slice(jsonStart).trim()), 0);
}

function extractRoutePayload(routeData) {
  if (!routeData || typeof routeData !== 'object') {
    return null;
  }

  return routeData.data ?? routeData.response?.data ?? null;
}

function buildNameLookup(recordsMap) {
  const byName = new Map();
  const duplicateNames = new Set();

  recordsMap.forEach((record) => {
    const key = normalizeEntityNameForMatch(record?.name);
    if (!key) {
      return;
    }

    const existing = byName.get(key);
    if (existing && existing.id !== record.id) {
      duplicateNames.add(key);
      return;
    }

    byName.set(key, record);
  });

  return { byName, duplicateNames };
}

function normalizeAssetRecord(itemType, rawRecord) {
  const config = WARFARIN_PAGE_CONFIG[itemType];
  const id = String(rawRecord?.id || '').trim();
  const name = String(rawRecord?.name || '').trim();
  const imageUrl = config.imageUrl(rawRecord);

  if (!id || !name || !imageUrl) {
    return null;
  }

  return {
    id,
    name,
    imageUrl,
    iconId: rawRecord?.iconId ? String(rawRecord.iconId) : null,
    raw: rawRecord
  };
}

export async function loadWarfarinWikiAssetCatalog(
  types = ['character', 'weapon'],
  { logger = () => {}, language = 'cn' } = {}
) {
  const requestedTypes = normalizeRequestedTypes(types);
  const normalizedLanguage = String(language || 'cn').trim().toLowerCase();
  if (!VALID_LANGUAGES.has(normalizedLanguage)) {
    throw new Error(`不支持的 warfarin.wiki 语言: ${language}`);
  }
  const catalog = {
    character: new Map(),
    weapon: new Map()
  };

  for (const itemType of requestedTypes) {
    const config = WARFARIN_PAGE_CONFIG[itemType];
    const pageUrl = `https://warfarin.wiki/${normalizedLanguage}/${config.path}`;
    logger(`加载 warfarin.wiki ${itemType} 目录: ${pageUrl}`);

    const response = await fetch(pageUrl, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml'
      }
    });

    if (!response.ok) {
      throw new Error(`warfarin.wiki ${itemType} HTTP ${response.status}`);
    }

    const decoded = parseTurboStream(await response.text());
    const routeData = decoded?.loaderData?.[config.routeKey];
    const payload = extractRoutePayload(routeData);
    const records = Array.isArray(payload) ? payload : [];

    records
      .map((record) => normalizeAssetRecord(itemType, record))
      .filter(Boolean)
      .forEach((record) => {
        catalog[itemType].set(record.id, record);
      });

    logger(`warfarin.wiki ${itemType} 目录已提取 ${catalog[itemType].size} 条记录`);
  }

  return catalog;
}

export function buildWarfarinWikiLookup(catalog = {}) {
  const characterById = catalog.character instanceof Map ? catalog.character : new Map();
  const weaponById = catalog.weapon instanceof Map ? catalog.weapon : new Map();

  return {
    character: {
      byId: characterById,
      ...buildNameLookup(characterById)
    },
    weapon: {
      byId: weaponById,
      ...buildNameLookup(weaponById)
    }
  };
}

export function findWarfarinWikiAssetMatch(record, lookup) {
  const typeLookup = lookup?.[record?.type];
  if (!typeLookup) {
    return null;
  }

  const directMatch = typeLookup.byId?.get(record.id);
  if (directMatch?.imageUrl) {
    return directMatch;
  }

  const candidateKeys = new Set([
    normalizeEntityNameForMatch(record?.name),
    ...(Array.isArray(record?.aliases) ? record.aliases.map(normalizeEntityNameForMatch) : [])
  ].filter(Boolean));

  for (const key of candidateKeys) {
    if (typeLookup.duplicateNames?.has(key)) {
      continue;
    }

    const matched = typeLookup.byName?.get(key);
    if (matched?.imageUrl) {
      return matched;
    }
  }

  return null;
}

export default {
  loadWarfarinWikiAssetCatalog,
  buildWarfarinWikiLookup,
  findWarfarinWikiAssetMatch
};
