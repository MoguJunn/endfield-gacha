import { getAppLocale, isEnglishLocale } from '../i18n/index.js';
import useSiteConfigStore from '../stores/useSiteConfigStore.js';
import { characterCache, resolveCharacterRecordByName } from './characterUtils.js';
import { getPoolFeaturedNames, isInternalEntityReference } from './poolFeaturedResolver.js';

export const POOL_LOCALIZATION_CONFIG_KEY = 'pool_localizations';
export const ENTITY_LOCALIZATION_CONFIG_KEY = 'entity_localizations';

const WARFARIN_OPERATOR_PAIRS = [
  ['洛茜', 'Rossi'],
  ['汤汤', 'Tangtang'],
  ['管理员', 'Endministrator'],
  ['黎风', 'Lifeng'],
  ['余烬', 'Ember'],
  ['洁尔佩塔', 'Gilberta'],
  ['艾尔黛拉', 'Ardelia'],
  ['骏卫', 'Pogranichnik'],
  ['莱万汀', 'Laevatain'],
  ['伊冯', 'Yvonne'],
  ['别礼', 'Last Rite'],
  ['陈千语', 'Chen Qianyu'],
  ['昼雪', 'Snowshine'],
  ['赛希', 'Xaihi'],
  ['佩丽卡', 'Perlica'],
  ['狼卫', 'Wulfgard'],
  ['弧光', 'Arclight'],
  ['阿列什', 'Alesh'],
  ['艾维文娜', 'Avywenna'],
  ['大潘', 'Da Pan'],
  ['埃特拉', 'Estella'],
  ['卡契尔', 'Catcher'],
  ['安塔尔', 'Antal'],
  ['萤石', 'Fluorite'],
  ['秋栗', 'Akekuri'],
];

const WARFARIN_WEAPON_PAIRS = [
  ['宏愿', 'Grand Vision'],
  ['白夜新星', 'White Night Nova'],
  ['熔铸火焰', 'Forgeborn Scathe'],
  ['扶摇', 'Rapid Ascent'],
  ['黯色火炬', 'Umbral Torch'],
  ['热熔切割器', 'Thermite Cutter'],
  ['显赫声名', 'Eminent Repute'],
  ['不知归', 'Never Rest'],
  ['光荣记忆', 'Glorious Memory'],
  ['狼之绯', 'Lupine Scarlet'],
  ['O.B.J.轻芒', 'OBJ Edge of Lightness'],
  ['逐鳞3.0', 'Finchaser 3.0'],
  ['钢铁余音', 'Sundering Steel'],
  ['坚城铸造者', 'Fortmaker'],
  ['仰止', 'Aspirant'],
  ['浪潮', 'Wave Tide'],
  ['显锋', 'Prominent Edge'],
  ['塔尔11', 'Tarr 11'],
  ['作品：蚀迹', 'Opus: Etch Figure'],
  ['爆破单元', 'Detonation Unit'],
  ['遗忘', 'Oblivion'],
  ['骑士精神', 'Chivalric Virtues'],
  ['使命必达', 'Delivery Guaranteed'],
  ['沧溟星梦', 'Dreams of the Starry Beach'],
  ['莫奈何', 'Monaihe'],
  ['迷失荒野', 'Wild Wanderer'],
  ['悼亡诗', 'Stanza of Memorials'],
  ['布道自由', 'Freedom to Proselytize'],
  ['O.B.J.术识', 'OBJ Arts Identifier'],
  ['荧光雷羽', 'Fluorescent Roc'],
  ['全自动骇新星', 'Hypernova Auto'],
  ['吉米尼12', 'Jiminy 12'],
  ['典范', 'Exemplar'],
  ['昔日精品', 'Former Finery'],
  ['大雷斑', 'Thunderberge'],
  ['破碎君王', 'Sundered Prince'],
  ['赫拉芬格', 'Khravengger'],
  ['终点之声', 'Finishing Call'],
  ['探骊', 'Seeker of Dark Lung'],
  ['古渠', 'Ancient Canal'],
  ['O.B.J.重荷', 'OBJ Heavy Burden'],
  ['工业零点一', 'Industry 0.1'],
  ['淬火者', 'Quencher'],
  ['达尔霍夫7', 'Darhoff 7'],
  ['J.E.T.', 'JET'],
  ['骁勇', 'Valiant'],
  ['负山', 'Mountain Bearer'],
  ['嵌合正义', 'Chimeric Justice'],
  ['向心之引', 'Cohesive Traction'],
  ['O.B.J.尖峰', 'OBJ Razorhorn'],
  ['寻路者道标', "Pathfinder's Beacon"],
  ['天使杀手', 'Aggeloslayer'],
  ['奥佩罗77', 'Opero 77'],
  ['望乡', 'Home Longing'],
  ['楔子', 'Wedge'],
  ['领航者', 'Navigator'],
  ['同类相食', 'Clannibal'],
  ['艺术暴君', 'Artzy Tyrannical'],
  ['落草', "Brigand's Calling"],
  ['O.B.J.迅极', 'OBJ Velocitous'],
  ['理性告别', 'Rational Farewell'],
  ['作品：众生', 'Opus: The Living'],
  ['呼啸守卫', 'Howling Guard'],
  ['长路', 'Long Road'],
  ['佩科5', 'Peco 5'],
];

function buildBidirectionalMap(pairs) {
  return pairs.reduce((map, [zhName, enName]) => {
    map[zhName] = { 'zh-CN': zhName, 'en-US': enName };
    map[enName] = { 'zh-CN': zhName, 'en-US': enName };
    return map;
  }, {});
}

const CHARACTER_NAME_MAP = buildBidirectionalMap(WARFARIN_OPERATOR_PAIRS);
const WEAPON_NAME_MAP = buildBidirectionalMap(WARFARIN_WEAPON_PAIRS);

function normalizeName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasLatinLetters(value) {
  return /[A-Za-z]/u.test(value);
}

function isLikelyShortCode(value) {
  return /^[A-Z0-9]{1,5}$/u.test(value);
}

function pickBestAlias(aliases = []) {
  const normalizedAliases = (Array.isArray(aliases) ? aliases : [])
    .map((alias) => normalizeName(alias))
    .filter(Boolean);

  const preferred = normalizedAliases.find((alias) => hasLatinLetters(alias) && !isLikelyShortCode(alias));
  if (preferred) {
    return preferred;
  }

  return normalizedAliases.find(hasLatinLetters) || null;
}

function resolveCharacterRecord(name) {
  const normalized = normalizeName(name);
  if (!normalized || !characterCache.isLoaded()) {
    return null;
  }

  return resolveCharacterRecordByName(normalized, { fuzzy: true });
}

function inferEntityType(record, explicitType = null) {
  if (explicitType === 'weapon' || explicitType === 'character') {
    return explicitType;
  }

  if (record?.type === 'weapon') {
    return 'weapon';
  }

  return 'character';
}

function getEntityNameMap(entityType) {
  return entityType === 'weapon' ? WEAPON_NAME_MAP : CHARACTER_NAME_MAP;
}

function normalizePoolLocalizationConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    return {};
  }

  return Object.entries(rawConfig).reduce((accumulator, [key, value]) => {
    const normalizedKey = normalizeName(key);
    if (!normalizedKey) {
      return accumulator;
    }

    if (typeof value === 'string') {
      accumulator[normalizedKey] = {
        'en-US': value,
      };
      return accumulator;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nextEntry = {};
      if (typeof value['zh-CN'] === 'string' && normalizeName(value['zh-CN'])) {
        nextEntry['zh-CN'] = normalizeName(value['zh-CN']);
      }
      if (typeof value['en-US'] === 'string' && normalizeName(value['en-US'])) {
        nextEntry['en-US'] = normalizeName(value['en-US']);
      }

      if (Object.keys(nextEntry).length > 0) {
        accumulator[normalizedKey] = nextEntry;
      }
    }

    return accumulator;
  }, {});
}

function normalizeEntityLocalizationConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    return {};
  }

  return Object.entries(rawConfig).reduce((accumulator, [key, value]) => {
    const normalizedKey = normalizeName(key);
    if (!normalizedKey || !value || typeof value !== 'object' || Array.isArray(value)) {
      return accumulator;
    }

    const nextEntry = {};
    if (typeof value.type === 'string' && normalizeName(value.type)) {
      nextEntry.type = normalizeName(value.type);
    }
    if (typeof value.name === 'string' && normalizeName(value.name)) {
      nextEntry.name = normalizeName(value.name);
    }
    if (typeof value['zh-CN'] === 'string' && normalizeName(value['zh-CN'])) {
      nextEntry['zh-CN'] = normalizeName(value['zh-CN']);
    }
    if (typeof value['en-US'] === 'string' && normalizeName(value['en-US'])) {
      nextEntry['en-US'] = normalizeName(value['en-US']);
    }

    if (nextEntry['zh-CN'] || nextEntry['en-US']) {
      accumulator[normalizedKey] = nextEntry;
    }

    return accumulator;
  }, {});
}

function getPoolLocalizationConfig() {
  const rawConfig = useSiteConfigStore.getState().getJsonConfig(POOL_LOCALIZATION_CONFIG_KEY, {});
  return normalizePoolLocalizationConfig(rawConfig);
}

function getEntityLocalizationConfig() {
  const rawConfig = useSiteConfigStore.getState().getJsonConfig(ENTITY_LOCALIZATION_CONFIG_KEY, {});
  return normalizeEntityLocalizationConfig(rawConfig);
}

function getEntityLocalizedEntry(name, record, type = null) {
  const config = getEntityLocalizationConfig();
  const candidates = [
    record?.id,
    normalizeName(name),
    normalizeName(record?.name),
    ...(Array.isArray(record?.aliases) ? record.aliases : []),
  ]
    .map((value) => normalizeName(value))
    .filter(Boolean);

  const normalizedType = inferEntityType(record, type);

  for (const candidate of candidates) {
    const entry = config[candidate];
    if (!entry) {
      continue;
    }

    if (!entry.type || entry.type === normalizedType) {
      return entry;
    }
  }

  return null;
}

function getPoolLocalizedEntry(pool) {
  const config = getPoolLocalizationConfig();
  const normalizedId = normalizeName(pool?.id);
  const normalizedName = normalizeName(pool?.name);

  return (
    (normalizedId ? config[normalizedId] : null)
    || (normalizedName ? config[normalizedName] : null)
    || null
  );
}

function resolveLocalizedPoolName(pool, locale) {
  if (locale === 'en-US') {
    const explicitEnglishName = normalizeName(pool?.name_en);
    if (explicitEnglishName) {
      return explicitEnglishName;
    }
  }

  const localizedEntry = getPoolLocalizedEntry(pool);
  if (!localizedEntry) {
    return '';
  }

  return normalizeName(localizedEntry[locale]) || normalizeName(localizedEntry['en-US']) || normalizeName(localizedEntry['zh-CN']);
}

function buildGenericPoolFallback(name, pool, locale) {
  const normalizedName = normalizeName(name);
  const normalizedType = pool?.type === 'limited_character'
    ? 'limited'
    : pool?.type === 'limited_weapon'
      ? 'weapon'
      : pool?.type;

  const upCharacter = localizeEntityName(pool?.up_character || pool?.upCharacter || null, {
    locale,
    type: normalizedType === 'weapon' ? 'weapon' : 'character'
  });

  const limitedMatch = normalizedName.match(/^限定[-\s]*(.+)$/u);
  if (limitedMatch) {
    return upCharacter || `${localizeEntityName(limitedMatch[1], { locale, type: 'character' })} Featured Banner`;
  }

  const weaponMatch = normalizedName.match(/^武器[-\s]*(.+)$/u);
  if (weaponMatch) {
    return `${localizeEntityName(weaponMatch[1], { locale, type: 'weapon' })} Weapon Banner`;
  }

  if (normalizedType === 'weapon' && upCharacter) {
    return `${upCharacter} Weapon Banner`;
  }

  if ((normalizedType === 'limited' || normalizedType === 'limited_character') && upCharacter) {
    return `${upCharacter} Featured Banner`;
  }

  if (normalizedType === 'standard') {
    return 'Standard Banner';
  }

  if (normalizedType === 'beginner') {
    return 'Beginner Banner';
  }

  return isInternalEntityReference(normalizedName) ? '' : normalizedName;
}

export function localizeEntityName(name, { locale = getAppLocale(), type = null } = {}) {
  const normalizedName = normalizeName(name);
  if (!normalizedName) {
    return '';
  }

  const record = resolveCharacterRecord(normalizedName);
  const resolvedType = inferEntityType(record, type);
  const manualLocalizedEntry = getEntityLocalizedEntry(normalizedName, record, resolvedType);
  if (manualLocalizedEntry) {
    return (
      normalizeName(manualLocalizedEntry[locale])
      || normalizeName(manualLocalizedEntry['en-US'])
      || normalizeName(manualLocalizedEntry['zh-CN'])
      || normalizedName
    );
  }

  const entityNameMap = getEntityNameMap(resolvedType);
  const mappedName = entityNameMap[normalizedName]?.[locale];
  if (mappedName) {
    return mappedName;
  }

  const reverseMappedName = entityNameMap[normalizedName]?.['en-US'];
  if (reverseMappedName) {
    return reverseMappedName;
  }

  const alias = pickBestAlias(record?.aliases);
  if (alias && isEnglishLocale(locale)) {
    return alias;
  }

  return isInternalEntityReference(normalizedName) ? '' : normalizedName;
}

export function localizeEntityList(names = [], options = {}) {
  return (Array.isArray(names) ? names : [])
    .map((name) => localizeEntityName(name, options))
    .filter(Boolean);
}

export function localizePoolName(poolOrName, { locale = getAppLocale(), poolType = null, upCharacter = null } = {}) {
  const resolvedPool = poolOrName && typeof poolOrName === 'object'
    ? poolOrName
    : {
        name: poolOrName,
        type: poolType,
        up_character: upCharacter
      };
  const name = normalizeName(resolvedPool?.name);
  if (!name) {
    return '';
  }

  const localizedPoolName = resolveLocalizedPoolName(resolvedPool, locale);
  if (localizedPoolName) {
    return localizedPoolName;
  }

  if (!isEnglishLocale(locale)) {
    return name;
  }

  return buildGenericPoolFallback(name, resolvedPool, locale);
}

export function localizeHistoryItemName(item, { locale = getAppLocale(), fallback = null, type = null } = {}) {
  if (!item) {
    return fallback || (isEnglishLocale(locale) ? 'Unknown target' : '未知目标');
  }

  const rawName = item?.item_name || item?.character_name || item?.characterName || item?.name || fallback;
  return localizeEntityName(rawName, { locale, type }) || fallback || (isEnglishLocale(locale) ? 'Unknown target' : '未知目标');
}

export function localizePoolFeaturedName(pool, { locale = getAppLocale() } = {}) {
  if (!pool) {
    return '';
  }

  const localizedFeaturedList = localizePoolFeaturedList(pool, { locale });
  if (localizedFeaturedList.length > 1) {
    const leadName = localizedFeaturedList[0];
    return isEnglishLocale(locale)
      ? `${leadName} +${localizedFeaturedList.length - 1}`
      : `${leadName} 等${localizedFeaturedList.length}名`;
  }

  if (localizedFeaturedList.length === 1) {
    return localizedFeaturedList[0];
  }

  return localizeEntityName(pool?.up_character || pool?.upCharacter || pool?.name || '', {
    locale,
    type: pool?.type === 'weapon' || pool?.type === 'limited_weapon' ? 'weapon' : 'character'
  });
}

export function localizePoolFeaturedList(pool, { locale = getAppLocale(), type = null } = {}) {
  const names = getPoolFeaturedNames(pool);
  return localizeEntityList(names, {
    locale,
    type: type || (pool?.type === 'weapon' || pool?.type === 'limited_weapon' ? 'weapon' : 'character')
  });
}
