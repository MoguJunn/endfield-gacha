import { getLocalizedAnnouncementTitle, sanitizeAnnouncementTitle } from './announcementLocale.js';

function getAnnouncementSourceGroup(announcement = {}) {
  const sourceKind = String(announcement?.source_kind || '').toLowerCase();
  const sourceGroup = String(announcement?.source_group || '').toLowerCase();
  const sourceId = String(announcement?.source_id || '');
  const sourceUrl = String(announcement?.source_url || '');

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

function getGameAnnouncementCategory(announcement = {}) {
  const directCategory = String(announcement?.source_category || announcement?.tab || '').toLowerCase();
  if (['events', 'updates', 'news'].includes(directCategory)) {
    return directCategory;
  }

  try {
    const sourceUrl = new URL(String(announcement?.source_url || ''));
    const urlCategory = String(sourceUrl.searchParams.get('tab') || '').toLowerCase();
    if (['events', 'updates', 'news'].includes(urlCategory)) {
      return urlCategory;
    }
  } catch {
    // Keep the digest resilient for legacy records.
  }

  return 'unknown';
}

function normalizeDigestTopic(value) {
  return sanitizeAnnouncementTitle(value)
    .replace(/^【([^】]{2,18})】/u, '$1 ')
    .replace(/^(公告|活动|游戏公告|资讯速报)[:：\s-]*/u, '')
    .replace(/(公告|开启公告|即将开启|限时开启|说明)$/u, '')
    .replace(/[《》「」]/gu, '')
    .trim();
}

function truncateText(value, maxLength) {
  const text = sanitizeAnnouncementTitle(value);
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function buildDigestTopicList(records = [], locale = 'zh-CN') {
  const seen = new Set();
  const topics = [];
  const useEnglish = String(locale || '').toLowerCase().startsWith('en');

  for (const record of records) {
    const topic = normalizeDigestTopic(
      getLocalizedAnnouncementTitle(record, locale) || record.summary || ''
    );
    if (!topic || seen.has(topic) || (useEnglish && /[\u3400-\u9fff]/u.test(topic))) {
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

export function buildGameAnnouncementDigest(announcements = [], t, locale = 'zh-CN') {
  const records = Array.isArray(announcements) ? announcements : [];
  const useEnglish = String(locale || '').toLowerCase().startsWith('en');
  const gameRecords = records.filter(record => getAnnouncementSourceGroup(record) === 'game');
  const officialRecords = records.filter(record => getAnnouncementSourceGroup(record) === 'official');
  const categoryCounts = gameRecords.reduce((acc, record) => {
    const category = getGameAnnouncementCategory(record);
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});

  const categoryParts = [
    ['events', 'announcement.digest.category.events'],
    ['updates', 'announcement.digest.category.updates'],
    ['news', 'announcement.digest.category.news'],
  ]
    .filter(([category]) => categoryCounts[category] > 0)
    .map(([category, key]) => t(key, { count: categoryCounts[category] }));

  const sourceParts = [];
  if (gameRecords.length > 0) {
    const gameCount = t('announcement.digest.gameCount', { count: gameRecords.length });
    sourceParts.push(categoryParts.length > 0 ? `${gameCount} (${categoryParts.join(' / ')})` : gameCount);
  }

  if (officialRecords.length > 0) {
    sourceParts.push(t('announcement.digest.officialCount', { count: officialRecords.length }));
  }

  const latestGameRecord = gameRecords[0] || records[0] || null;
  const topics = buildDigestTopicList(gameRecords.length > 0 ? gameRecords : records, locale);
  const subtitle = topics.length > 0
    ? truncateText(t('announcement.digest.focusTopics', { topics: topics.join(useEnglish ? ', ' : '、') }), useEnglish ? 180 : 96)
    : (sourceParts.length > 0
      ? sourceParts.join(' · ')
      : t('home.autoSummary'));

  return {
    title: topics.length > 0
      ? truncateText(t('announcement.digest.recentTopics', { topics: topics.join(useEnglish ? ', ' : '、') }), useEnglish ? 80 : 32)
      : (gameRecords.length > 0
        ? t('announcement.digest.title')
        : t('announcement.digest.fallbackTitle')),
    subtitle,
    latestGameRecord,
  };
}

export function resolveGameAnnouncementDigest(storedDigest, announcements = [], t, locale = 'zh-CN') {
  const useEnglish = String(locale || '').toLowerCase().startsWith('en');
  const fallbackDigest = buildGameAnnouncementDigest(announcements, t, locale);
  const titleValue = useEnglish
    ? storedDigest?.title_en || storedDigest?.titleEn
    : storedDigest?.title;
  const subtitleValue = useEnglish
    ? storedDigest?.subtitle_en || storedDigest?.subtitleEn
    : storedDigest?.subtitle;
  const title = typeof titleValue === 'string' ? titleValue.trim() : '';
  const subtitle = typeof subtitleValue === 'string' ? subtitleValue.trim() : '';

  if (!title || !subtitle) {
    return fallbackDigest;
  }

  return {
    ...fallbackDigest,
    ...storedDigest,
    title,
    subtitle,
  };
}
