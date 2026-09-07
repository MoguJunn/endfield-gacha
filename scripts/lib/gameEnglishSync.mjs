import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { normalizeEntityNameForMatch } from '../../src/utils/canonicalEntityUtils.js';
import { loadOfficialEnglishCatalog } from './officialEnglishCatalog.mjs';
import { loadWarfarinWikiAssetCatalog } from './warfarinWikiAssetCatalog.mjs';
import { resolveSupabaseSecretKey, resolveSupabaseUrl } from './supabaseEnv.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const VALID_TYPES = new Set(['character', 'weapon', 'pool', 'version', 'all']);
const VALID_MODES = new Set(['incremental', 'full']);
const ENTITY_TYPES = new Set(['character', 'weapon']);
const SITE_CONFIG_KEYS = ['entity_localizations', 'home_version_timeline'];
const MAX_POOL_SOURCE_DISTANCE_DAYS = 70;
const MAX_VERSION_SOURCE_DISTANCE_DAYS = 50;
const ENV_FILE_CANDIDATES = [
  path.join(PROJECT_ROOT, '.env.local'),
  path.join(PROJECT_ROOT, '.env'),
  path.join(PROJECT_ROOT, 'backend', '.env.local'),
  path.join(PROJECT_ROOT, 'backend', '.env'),
];

const STATIC_POOL_NAMES = Object.freeze({
  beginner: 'New Horizons Headhunting',
  standard: 'Basic Headhunting',
  weaponbox_constant_1: 'Solid Ice Issue',
  weaponbox_constant_2: 'Cosmic Voice Issue',
  weaponbox_constant_3: 'Far Expedition Issue',
  weaponbox_constant_4: 'Rising Mount Issue',
  weaponbox_constant_5: 'Thunderous Peal Issue',
});

const STATIC_VERSION_NAMES = Object.freeze({
  零号委托: 'Zeroth Directive',
  '新潮起，故渊离': 'Old Deep Water Dies, by Rising Tide It is Denied',
  春晓时: 'At the Wake of Spring',
  寻遗散记: 'Sketches of Lost Heirlooms',
  向渊行: 'Homecoming',
  雪凇幽梦: 'Dreamscape of Wind and Snow',
  雪松幽梦: 'Dreamscape of Wind and Snow',
});

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeComparable(value) {
  return normalizeText(value)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\s'’"“”‘’.,:;!?()[\]{}·—–_-]+/gu, '');
}

function parseJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function readNextArg(args, index, flag) {
  if (!args[index + 1] || args[index + 1].startsWith('--')) {
    throw new Error(`${flag} 需要一个参数`);
  }
  return args[index + 1];
}

export function printGameEnglishSyncHelp(commandName = 'sync:game-english') {
  console.log(`用法:
  npm run ${commandName} -- [选项]

选项:
  --type character|weapon|pool|version|all  同步类型，默认 all
  --mode incremental|full                  同步模式，默认 incremental
  --incremental                            只补缺失英文，等同 --mode incremental
  --full                                   以当前可信来源刷新已有英文
  --dry-run                                演练模式：只展示差异，不写数据库
  --output <file>                          输出 JSON 审计报告
  --no-warfarin                            不读取 Warfarin 中英文实体目录
  --no-official-news                       不读取 GRYPHLINE 英文公告
  --help                                   显示帮助

来源:
  角色/武器：warfarin.wiki 中英文目录按同一实体 ID 配对
  卡池/版本：GRYPHLINE 英文公告按类型、UP 对象与开放时间匹配

示例:
  npm run ${commandName} -- --dry-run
  npm run ${commandName}
  npm run ${commandName} -- --full --output reports/game-english-sync.json`);
}

export function parseGameEnglishSyncArgs(args = process.argv.slice(2), defaults = {}) {
  const options = {
    commandName: defaults.commandName || 'sync:game-english',
    type: 'all',
    mode: 'incremental',
    dryRun: false,
    output: null,
    useWarfarin: true,
    useOfficialNews: true,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--type') {
      options.type = readNextArg(args, index, arg);
      index += 1;
    } else if (arg === '--mode') {
      options.mode = readNextArg(args, index, arg);
      index += 1;
    } else if (arg === '--incremental') {
      options.mode = 'incremental';
    } else if (arg === '--full' || arg === '--force') {
      options.mode = 'full';
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--output') {
      options.output = readNextArg(args, index, arg);
      index += 1;
    } else if (arg === '--no-warfarin') {
      options.useWarfarin = false;
    } else if (arg === '--no-official-news') {
      options.useOfficialNews = false;
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }

  if (!VALID_TYPES.has(options.type)) {
    throw new Error('--type 必须为 character | weapon | pool | version | all');
  }
  if (!VALID_MODES.has(options.mode)) {
    throw new Error('--mode 必须为 incremental 或 full');
  }
  if (!options.useWarfarin && ['character', 'weapon'].includes(options.type)) {
    throw new Error(`--type ${options.type} 需要启用 Warfarin 来源`);
  }
  if (!options.useOfficialNews && ['pool', 'version'].includes(options.type)) {
    throw new Error(`--type ${options.type} 需要启用 GRYPHLINE 英文公告来源`);
  }

  return options;
}

function normalizeRequestedTypes(type = 'all') {
  return type === 'all'
    ? ['character', 'weapon', 'pool', 'version']
    : [type];
}

function loadEnvironmentFiles() {
  for (const envPath of ENV_FILE_CANDIDATES) {
    try {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) continue;
        const key = trimmed.slice(0, separatorIndex).trim();
        let value = trimmed.slice(separatorIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (typeof process.env[key] === 'undefined') {
          process.env[key] = value;
        }
      }
    } catch {
      // Missing optional environment files are expected.
    }
  }
}

function createSupabaseClient() {
  loadEnvironmentFiles();
  const supabaseUrl = resolveSupabaseUrl();
  const secretKey = resolveSupabaseSecretKey();
  if (!supabaseUrl || !secretKey) {
    throw new Error(
      '缺少 SUPABASE_URL/VITE_SUPABASE_URL 或 SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY，无法同步数据库英文'
    );
  }
  return createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function buildLogger(prefix) {
  return (message, level = 'log') => {
    const text = `[${prefix}] ${message}`;
    if (level === 'warn') console.warn(text);
    else if (level === 'error') console.error(text);
    else console.log(text);
  };
}

async function loadDatabaseSnapshot(supabase) {
  const [charactersResult, poolsResult, configResult] = await Promise.all([
    supabase.from('characters').select('id, name, type, aliases').order('type').order('id'),
    supabase
      .from('pools')
      .select('pool_id, name, name_en, type, up_character, start_time, extra_subtype, extra_rule_profile')
      .order('start_time', { ascending: true, nullsFirst: false }),
    supabase.from('site_config').select('key, value, label, category').in('key', SITE_CONFIG_KEYS),
  ]);

  if (charactersResult.error) throw charactersResult.error;
  if (poolsResult.error) throw poolsResult.error;
  if (configResult.error) throw configResult.error;

  return {
    characters: Array.isArray(charactersResult.data) ? charactersResult.data : [],
    pools: Array.isArray(poolsResult.data) ? poolsResult.data : [],
    configByKey: new Map((configResult.data || []).map((row) => [row.key, row])),
  };
}

export function buildBilingualEntityCatalog(chineseCatalog = {}, englishCatalog = {}) {
  const result = { character: new Map(), weapon: new Map() };
  for (const type of ENTITY_TYPES) {
    const chineseRecords = chineseCatalog[type] instanceof Map ? chineseCatalog[type] : new Map();
    const englishRecords = englishCatalog[type] instanceof Map ? englishCatalog[type] : new Map();
    for (const [sourceId, chineseRecord] of chineseRecords) {
      const englishRecord = englishRecords.get(sourceId);
      const zhName = normalizeText(chineseRecord?.name);
      const enName = normalizeText(englishRecord?.name);
      if (!zhName || !enName) continue;
      result[type].set(sourceId, {
        id: sourceId,
        type,
        zhName,
        enName,
        sourceUrl: `https://warfarin.wiki/en/${type === 'weapon' ? 'weapons' : 'operators'}`,
      });
    }
  }
  return result;
}

function buildSourceNameLookup(sourceRecords) {
  const byName = new Map();
  const duplicates = new Set();
  for (const record of sourceRecords.values()) {
    const key = normalizeEntityNameForMatch(record.zhName);
    if (!key) continue;
    if (byName.has(key) && byName.get(key).id !== record.id) duplicates.add(key);
    else byName.set(key, record);
  }
  return { byName, duplicates };
}

function findEntityTranslation(record, bilingualCatalog) {
  const sourceRecords = bilingualCatalog?.[record?.type];
  if (!(sourceRecords instanceof Map)) return null;
  const direct = sourceRecords.get(record.id);
  if (direct) return direct;

  const { byName, duplicates } = buildSourceNameLookup(sourceRecords);
  const keys = [record.name, ...(Array.isArray(record.aliases) ? record.aliases : [])]
    .map(normalizeEntityNameForMatch)
    .filter(Boolean);
  for (const key of keys) {
    if (!duplicates.has(key) && byName.has(key)) return byName.get(key);
  }
  return null;
}

function isInternalAlias(value) {
  return /^(?:manual_|char_manual_|weapon_manual_)/u.test(normalizeText(value));
}

function buildLocalizationEntry(existing, desired, mode) {
  const current = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  if (mode === 'full') {
    return {
      ...current,
      type: desired.type,
      name: desired.zhName,
      'zh-CN': desired.zhName,
      'en-US': desired.enName,
    };
  }
  return {
    ...current,
    type: normalizeText(current.type) || desired.type,
    name: normalizeText(current.name) || desired.zhName,
    'zh-CN': normalizeText(current['zh-CN']) || desired.zhName,
    'en-US': normalizeText(current['en-US']) || desired.enName,
  };
}

function entriesDiffer(left, right) {
  return ['type', 'name', 'zh-CN', 'en-US'].some((key) => normalizeText(left?.[key]) !== normalizeText(right?.[key]));
}

export function buildEntityTranslationPlan({
  records = [],
  bilingualCatalog = {},
  existingConfig = {},
  mode = 'incremental',
  requestedTypes = ['character', 'weapon'],
} = {}) {
  const nextConfig = { ...existingConfig };
  const changes = [];
  const unresolved = [];
  const requested = new Set(requestedTypes.filter((type) => ENTITY_TYPES.has(type)));

  for (const record of records.filter((item) => requested.has(item.type))) {
    const translation = findEntityTranslation(record, bilingualCatalog);
    const currentEnglish = normalizeText(nextConfig[record.id]?.['en-US'] || nextConfig[record.name]?.['en-US']);
    if (!translation) {
      if (!currentEnglish) unresolved.push({ type: record.type, id: record.id, name: record.name });
      continue;
    }

    const keys = [
      record.id,
      record.name,
      ...(Array.isArray(record.aliases) ? record.aliases.filter(isInternalAlias) : []),
    ].filter(Boolean);
    let changed = false;
    for (const key of new Set(keys)) {
      const nextEntry = buildLocalizationEntry(nextConfig[key], translation, mode);
      if (entriesDiffer(nextConfig[key], nextEntry)) {
        nextConfig[key] = nextEntry;
        changed = true;
      }
    }

    if (changed) {
      changes.push({
        type: record.type,
        id: record.id,
        zh: record.name,
        before: currentEnglish || null,
        after: translation.enName,
        source: 'warfarin',
        sourceUrl: translation.sourceUrl,
      });
    }
  }

  return { nextConfig, changes, unresolved };
}

function differenceInDays(left, right) {
  const leftMs = new Date(left || '').getTime();
  const rightMs = new Date(right || '').getTime();
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return Number.POSITIVE_INFINITY;
  return Math.abs(leftMs - rightMs) / (24 * 60 * 60 * 1000);
}

function containsComparableName(value, expectedName) {
  const haystack = normalizeComparable(value);
  const needle = normalizeComparable(expectedName);
  return Boolean(needle) && haystack.includes(needle);
}

function getPoolCandidateKind(pool = {}) {
  if (pool.type === 'weapon' || pool.extra_subtype === 'reconstruction_claim' || pool.extra_rule_profile === 'reconstruction_weapon_v1') {
    return 'weapon';
  }
  return 'character';
}

export function selectPoolEnglishName(pool, candidates = [], expectedTarget = '') {
  const expectedKind = getPoolCandidateKind(pool);
  const scored = candidates
    .filter((candidate) => candidate.kind === expectedKind)
    .map((candidate) => {
      const distanceDays = differenceInDays(pool.start_time, candidate.publishedAt);
      const explicitTarget = candidate.targetNames?.some((name) => normalizeComparable(name) === normalizeComparable(expectedTarget));
      const contextTarget = containsComparableName(candidate.context, expectedTarget);
      return {
        candidate,
        distanceDays,
        explicitTarget,
        contextTarget,
        score: (explicitTarget ? 220 : 0) + (contextTarget ? 80 : 0) + Math.max(0, 80 - distanceDays),
      };
    })
    .filter((item) => item.distanceDays <= MAX_POOL_SOURCE_DISTANCE_DAYS)
    .filter((item) => !expectedTarget || item.explicitTarget || item.contextTarget)
    .sort((left, right) => right.score - left.score || left.distanceDays - right.distanceDays);

  if (scored.length === 0) return null;
  const best = scored[0];
  const competing = scored.find((item, index) => (
    index > 0
    && normalizeComparable(item.candidate.name) !== normalizeComparable(best.candidate.name)
  ));
  if (competing && best.score - competing.score < 12) return null;
  return best.candidate;
}

export function selectVersionEnglishName(version, candidates = []) {
  const scored = candidates
    .filter((candidate) => candidate.kind === 'version')
    .map((candidate) => ({
      candidate,
      distanceDays: differenceInDays(version.starts_at || version.startsAt, candidate.publishedAt),
    }))
    .filter((item) => item.distanceDays <= MAX_VERSION_SOURCE_DISTANCE_DAYS)
    .sort((left, right) => left.distanceDays - right.distanceDays);
  if (scored.length === 0) return null;

  const best = scored[0];
  const competing = scored.find((item, index) => (
    index > 0
    && normalizeComparable(item.candidate.name) !== normalizeComparable(best.candidate.name)
  ));
  if (competing && competing.distanceDays - best.distanceDays < 5) return null;
  return best.candidate;
}

function buildEnglishNameByChineseName(records, bilingualCatalog, existingConfig) {
  const lookup = new Map();
  for (const record of records) {
    const source = findEntityTranslation(record, bilingualCatalog);
    const englishName = source?.enName
      || normalizeText(existingConfig[record.id]?.['en-US'])
      || normalizeText(existingConfig[record.name]?.['en-US']);
    if (record.name && englishName) lookup.set(normalizeEntityNameForMatch(record.name), englishName);
  }
  return lookup;
}

export function buildPoolTranslationPlan({
  pools = [],
  candidates = [],
  englishByChineseName = new Map(),
  mode = 'incremental',
} = {}) {
  const changes = [];
  const unresolved = [];

  for (const pool of pools) {
    const before = normalizeText(pool.name_en);
    if (mode === 'incremental' && before) continue;

    const expectedTarget = englishByChineseName.get(normalizeEntityNameForMatch(pool.up_character)) || '';
    const sourceCandidate = selectPoolEnglishName(pool, candidates, expectedTarget);
    const after = normalizeText(sourceCandidate?.name || STATIC_POOL_NAMES[pool.pool_id]);
    if (!after) {
      if (!before) unresolved.push({ type: 'pool', id: pool.pool_id, name: pool.name, up: pool.up_character || null });
      continue;
    }
    if (before === after) continue;

    changes.push({
      type: 'pool',
      id: pool.pool_id,
      zh: pool.name,
      before: before || null,
      after,
      source: sourceCandidate ? 'gryphline' : 'verified-static',
      sourceUrl: sourceCandidate?.sourceUrl || null,
      sourceTitle: sourceCandidate?.sourceTitle || null,
    });
  }

  return { changes, unresolved };
}

export function buildVersionTranslationPlan({
  timelineConfig = {},
  candidates = [],
  mode = 'incremental',
} = {}) {
  const versions = Array.isArray(timelineConfig?.versions) ? timelineConfig.versions : [];
  const changes = [];
  const unresolved = [];
  const nextVersions = versions.map((version) => {
    const before = normalizeText(version.name_en || version.nameEn);
    if (mode === 'incremental' && before) return version;

    const sourceCandidate = selectVersionEnglishName(version, candidates);
    const after = normalizeText(sourceCandidate?.name || STATIC_VERSION_NAMES[version.name]);
    if (!after) {
      if (!before) unresolved.push({ type: 'version', id: version.id || null, name: version.name || null });
      return version;
    }
    if (before === after) return version;

    changes.push({
      type: 'version',
      id: version.id || null,
      zh: version.name,
      before: before || null,
      after,
      source: sourceCandidate ? 'gryphline' : 'verified-static',
      sourceUrl: sourceCandidate?.sourceUrl || null,
      sourceTitle: sourceCandidate?.sourceTitle || null,
    });
    return { ...version, name_en: after };
  });

  return {
    nextConfig: { ...timelineConfig, versions: nextVersions },
    changes,
    unresolved,
  };
}

async function upsertSiteConfig(supabase, currentRow, { key, value, label, category }) {
  const { error } = await supabase.from('site_config').upsert({
    key,
    value: JSON.stringify(value),
    label: currentRow?.label || label,
    category: currentRow?.category || category,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
  if (error) throw error;
}

async function applyPoolChanges(supabase, changes) {
  for (const change of changes) {
    const { data, error } = await supabase
      .from('pools')
      .update({ name_en: change.after, updated_at: new Date().toISOString() })
      .eq('pool_id', change.id)
      .select('pool_id');
    if (error) throw error;
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error(`卡池英文写回未命中: ${change.id}`);
    }
  }
}

async function invalidatePublicCache(supabase) {
  const payload = {
    version: String(Date.now()),
    scope: 'game-english-sync',
    reason: 'script:sync-game-english',
    updatedAt: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('site_config')
    .update({ value: JSON.stringify(payload), updated_at: new Date().toISOString() })
    .eq('key', 'public_cache_epoch')
    .select('key');
  if (error) throw error;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('公共缓存版本配置不存在，无法通知前端刷新英文数据');
  }
}

function writeAuditOutput(outputPath, report) {
  if (!outputPath) return;
  const resolvedPath = path.resolve(PROJECT_ROOT, outputPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
}

function printChangeSummary(logger, changes) {
  if (changes.length === 0) {
    logger('未发现需要写入的英文差异');
    return;
  }
  logger(`计划更新 ${changes.length} 项:`);
  for (const change of changes) {
    logger(`  ${change.type}:${change.id}  ${change.before || '∅'} -> ${change.after}  [${change.source}]`);
  }
}

export async function runGameEnglishSync(options) {
  const logger = buildLogger(options.commandName || 'sync:game-english');
  const requestedTypes = normalizeRequestedTypes(options.type);
  const requestedTypeSet = new Set(requestedTypes);
  const supabase = createSupabaseClient();

  logger('开始同步游戏目录英文名称');
  logger(`类型: ${requestedTypes.join(', ')}`);
  logger(`模式: ${options.mode === 'full' ? '全量刷新' : '增量补充'}${options.dryRun ? ' / 演练模式' : ''}`);

  const snapshot = await loadDatabaseSnapshot(supabase);
  const entityConfigRow = snapshot.configByKey.get('entity_localizations');
  const timelineConfigRow = snapshot.configByKey.get('home_version_timeline');
  const existingEntityConfig = parseJsonObject(entityConfigRow?.value, {});
  const existingTimelineConfig = parseJsonObject(timelineConfigRow?.value, { versions: [] });

  let bilingualCatalog = { character: new Map(), weapon: new Map() };
  if (options.useWarfarin && requestedTypes.some((type) => ENTITY_TYPES.has(type) || type === 'pool')) {
    const neededEntityTypes = requestedTypeSet.has('pool')
      ? ['character', 'weapon']
      : requestedTypes.filter((type) => ENTITY_TYPES.has(type));
    const [chineseCatalog, englishCatalog] = await Promise.all([
      loadWarfarinWikiAssetCatalog(neededEntityTypes, {
        language: 'cn',
        logger: (message) => logger(message),
      }),
      loadWarfarinWikiAssetCatalog(neededEntityTypes, {
        language: 'en',
        logger: (message) => logger(message),
      }),
    ]);
    bilingualCatalog = buildBilingualEntityCatalog(chineseCatalog, englishCatalog);
  }

  let officialCatalog = { announcements: [], candidates: [] };
  if (options.useOfficialNews && requestedTypes.some((type) => type === 'pool' || type === 'version')) {
    officialCatalog = await loadOfficialEnglishCatalog({ logger: (message) => logger(message) });
  }

  const entityTypes = requestedTypes.filter((type) => ENTITY_TYPES.has(type));
  const entityPlan = entityTypes.length > 0
    ? buildEntityTranslationPlan({
      records: snapshot.characters,
      bilingualCatalog,
      existingConfig: existingEntityConfig,
      mode: options.mode,
      requestedTypes: entityTypes,
    })
    : { nextConfig: existingEntityConfig, changes: [], unresolved: [] };

  const englishByChineseName = buildEnglishNameByChineseName(
    snapshot.characters,
    bilingualCatalog,
    entityPlan.nextConfig
  );
  const poolPlan = requestedTypeSet.has('pool')
    ? buildPoolTranslationPlan({
      pools: snapshot.pools,
      candidates: officialCatalog.candidates,
      englishByChineseName,
      mode: options.mode,
    })
    : { changes: [], unresolved: [] };
  const versionPlan = requestedTypeSet.has('version')
    ? buildVersionTranslationPlan({
      timelineConfig: existingTimelineConfig,
      candidates: officialCatalog.candidates,
      mode: options.mode,
    })
    : { nextConfig: existingTimelineConfig, changes: [], unresolved: [] };

  const changes = [...entityPlan.changes, ...poolPlan.changes, ...versionPlan.changes];
  const unresolved = [...entityPlan.unresolved, ...poolPlan.unresolved, ...versionPlan.unresolved];
  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.mode,
    dryRun: options.dryRun,
    requestedTypes,
    sources: {
      warfarin: {
        characters: bilingualCatalog.character.size,
        weapons: bilingualCatalog.weapon.size,
      },
      gryphline: {
        announcements: officialCatalog.announcements.length,
        candidates: officialCatalog.candidates.length,
      },
    },
    changes,
    unresolved,
  };

  printChangeSummary(logger, changes);
  if (unresolved.length > 0) {
    logger(`仍有 ${unresolved.length} 项缺少可信英文来源，已跳过并写入审计报告`, 'warn');
  }
  writeAuditOutput(options.output, report);

  if (options.dryRun || changes.length === 0) {
    logger(options.dryRun ? '演练完成，未写数据库' : '同步完成，数据库无需变更');
    return report;
  }

  if (entityPlan.changes.length > 0) {
    await upsertSiteConfig(supabase, entityConfigRow, {
      key: 'entity_localizations',
      value: entityPlan.nextConfig,
      label: '角色与武器本地化',
      category: 'content',
    });
  }
  if (poolPlan.changes.length > 0) {
    await applyPoolChanges(supabase, poolPlan.changes);
  }
  if (versionPlan.changes.length > 0) {
    await upsertSiteConfig(supabase, timelineConfigRow, {
      key: 'home_version_timeline',
      value: versionPlan.nextConfig,
      label: '首页版本时间线',
      category: 'content',
    });
  }
  await invalidatePublicCache(supabase);

  logger(`同步完成，已写入 ${changes.length} 项并刷新公共缓存`);
  return report;
}

export default {
  buildBilingualEntityCatalog,
  buildEntityTranslationPlan,
  buildPoolTranslationPlan,
  buildVersionTranslationPlan,
  parseGameEnglishSyncArgs,
  printGameEnglishSyncHelp,
  runGameEnglishSync,
  selectPoolEnglishName,
  selectVersionEnglishName,
};
