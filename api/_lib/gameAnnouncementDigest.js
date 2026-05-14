import crypto from 'node:crypto';

import {
  __internal as announcementPresentationInternal,
  stripHtmlToText,
} from './officialAnnouncementPresentation.js';

export const GAME_ANNOUNCEMENT_DIGEST_CONFIG_KEY = 'home_game_announcement_digest';

const DIGEST_MIN_DAYS = 7;
const DIGEST_MAX_DAYS = 15;
const DIGEST_MIN_RECORDS = 5;
const DIGEST_MAX_RECORDS = 18;
const DIGEST_INPUT_TEXT_MAX_LENGTH = 320;
const DIGEST_OUTPUT_MAX_TOKENS = 360;
const DIGEST_FORBIDDEN_FALLBACK_HINT = '近7天游戏公告不足';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeAnnouncementText(value) {
  return normalizeText(value)
    .replace(/\\n|\/n/giu, ' ')
    .replace(/[\r\n]+/gu, ' ')
    .replace(/\s+/gu, ' ');
}

function compactText(value) {
  return sanitizeAnnouncementText(value);
}

function truncateText(value, maxLength) {
  const normalizedValue = compactText(value);
  if (!normalizedValue || normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function getRecordTimestamp(record = {}) {
  const value = new Date(record.published_at || record.updated_at || record.created_at || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

export function getAnnouncementSourceGroup(record = {}) {
  const sourceKind = String(record?.source_kind || '').toLowerCase();
  const sourceGroup = String(record?.source_group || '').toLowerCase();
  const sourceId = String(record?.source_id || '');
  const sourceUrl = String(record?.source_url || '');

  if (
    sourceGroup === 'game'
    || sourceKind === 'game-bulletin'
    || sourceId.startsWith('game-bulletin:')
    || sourceUrl.includes('game_bulletin')
  ) {
    return 'game';
  }

  return 'official';
}

export function getGameAnnouncementCategory(record = {}) {
  const directCategory = String(record?.source_category || record?.tab || '').toLowerCase();
  if (['events', 'updates', 'news'].includes(directCategory)) {
    return directCategory;
  }

  try {
    const sourceUrl = new URL(String(record?.source_url || ''));
    const urlCategory = String(sourceUrl.searchParams.get('tab') || '').toLowerCase();
    if (['events', 'updates', 'news'].includes(urlCategory)) {
      return urlCategory;
    }
  } catch {
    // Legacy official-site records often have no structured category.
  }

  return 'unknown';
}

function getDigestWindowRecords(records = [], now = Date.now()) {
  const normalizedRecords = (Array.isArray(records) ? records : [])
    .filter(record => record?.is_active !== false)
    .filter(record => record?.source_id || record?.source_url || record?.title)
    .map(record => ({
      ...record,
      source_group: record.source_group || getAnnouncementSourceGroup(record),
      source_category: record.source_category || getGameAnnouncementCategory(record),
      timestamp: getRecordTimestamp(record),
    }))
    .filter(record => record.timestamp > 0)
    .sort((a, b) => b.timestamp - a.timestamp);

  const minCutoff = now - DIGEST_MIN_DAYS * 24 * 60 * 60 * 1000;
  const maxCutoff = now - DIGEST_MAX_DAYS * 24 * 60 * 60 * 1000;
  const recentRecords = normalizedRecords.filter(record => record.timestamp >= minCutoff);
  const windowRecords = recentRecords.length >= DIGEST_MIN_RECORDS
    ? recentRecords
    : normalizedRecords.filter(record => record.timestamp >= maxCutoff);

  return windowRecords.slice(0, DIGEST_MAX_RECORDS);
}

function getRecordDigestText(record = {}) {
  return truncateText(
    record.summary
      || record.description
      || stripHtmlToText(record.raw_content || record.content || '')
      || record.title,
    DIGEST_INPUT_TEXT_MAX_LENGTH
  );
}

function getDigestFingerprint(records = [], windowDays) {
  const payload = records.map(record => [
    record.source_id || record.source_url || record.title || '',
    record.version || '',
    record.published_at || record.updated_at || record.created_at || '',
    record.title || '',
    record.summary || '',
  ]);

  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ windowDays, records: payload }))
    .digest('hex')
    .slice(0, 24);
}

function getSourceLabel(record = {}) {
  return getAnnouncementSourceGroup(record) === 'game' ? '游戏内公告' : '官网公告';
}

function getCategoryLabel(record = {}) {
  const category = getGameAnnouncementCategory(record);
  if (category === 'events') return '活动公告';
  if (category === 'updates') return '游戏公告';
  if (category === 'news') return '资讯速报';
  return getAnnouncementSourceGroup(record) === 'game' ? '游戏内公告' : '官网公告';
}

function buildPromptRecords(records = []) {
  return records.map((record, index) => {
    const date = record.published_at
      ? String(record.published_at).slice(0, 10)
      : '未知日期';
    return [
      `${index + 1}. [${date}] ${getSourceLabel(record)} / ${getCategoryLabel(record)}`,
      `标题：${compactText(record.title || '未命名公告')}`,
      `摘要：${getRecordDigestText(record) || '无'}`,
    ].join('\n');
  }).join('\n\n');
}

function normalizeDigestTopic(value) {
  return compactText(value)
    .replace(/^【([^】]{2,18})】/u, '$1 ')
    .replace(/^(公告|活动|游戏公告|资讯速报)[:：\s-]*/u, '')
    .replace(/(公告|开启公告|即将开启|限时开启|说明)$/u, '')
    .replace(/[《》「」]/gu, '')
    .trim();
}

function buildFallbackTopicList(records = []) {
  const seen = new Set();
  const topics = [];

  for (const record of records) {
    const topic = normalizeDigestTopic(record.title || record.summary || '');
    if (!topic || seen.has(topic)) {
      continue;
    }

    seen.add(topic);
    topics.push(topic.length > 10 ? `${topic.slice(0, 9)}…` : topic);
    if (topics.length >= 3) {
      break;
    }
  }

  return topics;
}

export function buildFallbackGameAnnouncementDigest(records = [], {
  now = Date.now(),
} = {}) {
  const selectedRecords = getDigestWindowRecords(records, now);
  const gameRecords = selectedRecords.filter(record => getAnnouncementSourceGroup(record) === 'game');
  const officialRecords = selectedRecords.filter(record => getAnnouncementSourceGroup(record) === 'official');
  const categoryCounts = gameRecords.reduce((acc, record) => {
    const category = getGameAnnouncementCategory(record);
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});
  const categoryParts = [
    ['events', '活动'],
    ['updates', '更新'],
    ['news', '资讯'],
  ]
    .filter(([category]) => categoryCounts[category] > 0)
    .map(([category, label]) => `${label} ${categoryCounts[category]} 条`);
  const sourceParts = [];

  if (gameRecords.length > 0) {
    sourceParts.push(categoryParts.length > 0
      ? `游戏内 ${gameRecords.length} 条（${categoryParts.join(' / ')}）`
      : `游戏内 ${gameRecords.length} 条`);
  }

  if (officialRecords.length > 0) {
    sourceParts.push(`官网 ${officialRecords.length} 条`);
  }

  const topics = buildFallbackTopicList(gameRecords.length > 0 ? gameRecords : selectedRecords);
  const title = topics.length > 0
    ? `近期公告：${topics.join('、')}`
    : (gameRecords.length > 0 ? '近期公告：游戏内更新' : '近期公告：同步内容');
  const subtitle = topics.length > 0
    ? `重点关注 ${topics.join('、')} 等近期公告，导入后可在展开列表查看原文与摘要。`
    : (sourceParts.join(' · ') || '暂无可汇总的近期公告');

  return {
    title: truncateText(title, 32),
    subtitle: truncateText(subtitle, 96),
    mode: 'fallback',
  };
}

function normalizeDigestText(value, maxLength) {
  return truncateText(
    sanitizeAnnouncementText(String(value || ''))
      .replace(new RegExp(DIGEST_FORBIDDEN_FALLBACK_HINT, 'gu'), '')
      .replace(/已用近期历史公告补齐[。.]?/gu, '')
      .replace(/以下已用最近同步的历史公告补齐[。.]?/gu, ''),
    maxLength
  );
}

function parseDigestJson(content) {
  const normalizedContent = normalizeText(content);
  const jsonText = normalizedContent.match(/\{[\s\S]*\}/u)?.[0] || normalizedContent;
  let payload;
  try {
    payload = JSON.parse(jsonText);
  } catch {
    throw new Error('Announcement digest LLM did not return JSON');
  }

  const title = normalizeDigestText(payload?.title, 28);
  const subtitle = normalizeDigestText(payload?.subtitle, 96);
  if (!title || !subtitle) {
    throw new Error('Announcement digest LLM returned empty title or subtitle');
  }

  return { title, subtitle, mode: 'llm' };
}

async function summarizeDigestWithLlm(records, {
  fetchImpl = globalThis.fetch,
  env = process.env,
} = {}) {
  const config = await announcementPresentationInternal.loadAnnouncementLlmConfig(env);
  if (!config.apiKey || typeof fetchImpl !== 'function') {
    throw new Error('Announcement LLM API key is not configured');
  }

  const response = await fetchImpl(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      max_tokens: DIGEST_OUTPUT_MAX_TOKENS,
      stream: false,
      messages: [
        {
          role: 'system',
          content: [
            '你是「终末地抽卡分析器」的资深游戏公告编辑。',
            '任务：把近期多条游戏内公告与官网公告，浓缩为首页折叠栏的主标题 title 与副标题 subtitle。',
            '绝对忠于事实：只基于用户输入公告提炼，不得添加未出现的活动、角色、福利、版本内容或结论。',
            '过滤输入标题和正文中的字面 /n、\\n 与实际换行控制符；输出文本也不得包含这些控制符或真实换行。',
            '输出必须是合法的一行纯 JSON，格式严格为 {"title":"主标题文本","subtitle":"副标题文本"}。',
            '不要 Markdown，不要代码块，不要解释，不要在 JSON 外添加任何字符。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            '以下是近期收集到的公告列表：',
            '<announcements>',
            buildPromptRecords(records),
            '</announcements>',
            '',
            '请根据上述内容生成 title 和 subtitle，并严格满足以下业务要求：',
            '1. title 总长度控制在 12-24 个汉字。优先使用“核心事件一，核心事件二”的并列短语结构，必须使用中文全角逗号。',
            '2. title 必须点出具体活动名、卡池名、角色名、系统名、补偿名或事件名；不要使用“多项活动”“大量更新”“近期公告汇总”等空泛表述。',
            '3. 若近期确实只有一个核心主题，title 可以只写一个主题，但要补足关键信息，避免只有单个泛词。',
            '4. subtitle 总长度控制在 32-72 个汉字。不必写成传统长句，优先使用“近期开放：xx、xx；近期修复：xx；近期资讯：xx”这类可扫读结构。',
            '5. 不要出现“近7天公告不足”“已用近期历史公告补齐”“总结如下”等解释性或元讨论文案。',
            '6. 若公告多为封禁、修复、周边或补偿，只按实际内容概括，不要夸大为活动或福利。',
            '',
            '请直接输出一行纯 JSON，绝不要包含 ```json、Markdown 或任何多余字符。',
          ].join('\n'),
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = typeof response.text === 'function'
      ? truncateText(await response.text().catch(() => ''), 240)
      : '';
    throw new Error(`Announcement digest LLM returned ${response.status}${errorText ? `: ${errorText}` : ''}`);
  }

  const payload = await response.json();
  const choice = payload?.choices?.[0];
  const finishReason = normalizeText(choice?.finish_reason || choice?.finishReason).toLowerCase();
  if (finishReason.includes('length') || finishReason.includes('max_token')) {
    throw new Error('Announcement digest LLM response was truncated');
  }

  return parseDigestJson(choice?.message?.content);
}

function normalizeStoredDigestValue(value) {
  if (!value) return null;

  let payload = value;
  if (typeof value === 'string') {
    try {
      payload = JSON.parse(value);
    } catch {
      return null;
    }
  }

  const title = normalizeDigestText(payload?.title, 28);
  const subtitle = normalizeDigestText(payload?.subtitle, 96);
  if (!title || !subtitle) {
    return null;
  }

  return {
    ...payload,
    title,
    subtitle,
  };
}

function isReusableCachedDigest(cachedDigest, fingerprint) {
  if (
    !cachedDigest?.title
    || !cachedDigest?.subtitle
    || cachedDigest?.fingerprint !== fingerprint
  ) {
    return false;
  }

  // Fallback digests are degradation output after an LLM failure or missing
  // config. Do not let the same fingerprint freeze that degraded title forever;
  // incremental refreshes should retry and replace it once the LLM path works.
  return cachedDigest.mode !== 'fallback';
}

export async function getStoredGameAnnouncementDigest(supabase) {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('site_config')
    .select('value')
    .eq('key', GAME_ANNOUNCEMENT_DIGEST_CONFIG_KEY)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return normalizeStoredDigestValue(data?.value);
}

async function persistGameAnnouncementDigest(supabase, digest) {
  const { error } = await supabase
    .from('site_config')
    .upsert({
      key: GAME_ANNOUNCEMENT_DIGEST_CONFIG_KEY,
      value: JSON.stringify(digest),
      label: '首页游戏公告聚合摘要',
      category: 'content',
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'key',
    });

  if (error) {
    throw error;
  }
}

export async function refreshGameAnnouncementDigest(supabase, records = [], {
  now = Date.now(),
  fetchImpl = globalThis.fetch,
  env = process.env,
  forceRefresh = false,
} = {}) {
  const selectedRecords = getDigestWindowRecords(records, now);
  const windowDays = selectedRecords.some(record => record.timestamp < now - DIGEST_MIN_DAYS * 24 * 60 * 60 * 1000)
    ? DIGEST_MAX_DAYS
    : DIGEST_MIN_DAYS;
  const fingerprint = getDigestFingerprint(selectedRecords, windowDays);
  const cachedDigest = await getStoredGameAnnouncementDigest(supabase).catch(() => null);

  if (selectedRecords.length === 0 && cachedDigest?.title && cachedDigest?.subtitle) {
    return {
      digest: cachedDigest,
      updated: false,
      mode: cachedDigest.mode || 'cached',
    };
  }

  if (!forceRefresh && isReusableCachedDigest(cachedDigest, fingerprint)) {
    return {
      digest: cachedDigest,
      updated: false,
      mode: cachedDigest.mode || 'cached',
    };
  }

  let digest;
  let digestError;
  if (selectedRecords.length > 0) {
    try {
      digest = await summarizeDigestWithLlm(selectedRecords, { fetchImpl, env });
    } catch (error) {
      digestError = error;
    }
  }

  if (!digest) {
    digest = buildFallbackGameAnnouncementDigest(selectedRecords, { now });
  }

  const nextDigest = {
    ...digest,
    fingerprint,
    windowDays,
    sourceCount: selectedRecords.length,
    generatedAt: new Date(now).toISOString(),
    error: digestError?.message,
  };

  await persistGameAnnouncementDigest(supabase, nextDigest);

  return {
    digest: nextDigest,
    updated: true,
    mode: nextDigest.mode,
    error: digestError?.message,
  };
}

export const __internal = {
  DIGEST_MAX_DAYS,
  DIGEST_MIN_DAYS,
  buildFallbackGameAnnouncementDigest,
  buildPromptRecords,
  getDigestWindowRecords,
  isReusableCachedDigest,
  parseDigestJson,
  summarizeDigestWithLlm,
};
