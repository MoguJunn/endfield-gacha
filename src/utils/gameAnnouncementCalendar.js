import { sanitizeAnnouncementTitle } from './announcementLocale.js';

const CALENDAR_HINT_RE = /版本日历|版本活动|活动日历|日程|日历|calendar|schedule/iu;
const STRONG_CALENDAR_HINT_RE = /版本\s*日历|活动\s*日历|version\s*calendar|calendar/iu;
const SECONDARY_CALENDAR_HINT_RE = /日程|日历|schedule/iu;
const NON_CALENDAR_TITLE_RE = /寻访|补给|更新说明|系列更新|衍生品|共贺|故障|修复|维护|封禁|导引|礼包/iu;
const IMAGE_MARKDOWN_RE = /!\[[^\]]*\]\(([^)\s]+)\)/giu;
const IMAGE_TAG_RE = /<img\b[^>]*\ssrc=(["'])(.*?)\1/giu;
const ALT_ATTRIBUTE_RE = /\salt=(["'])(.*?)\1/iu;

export const STATIC_GAME_CALENDAR_IMAGE = Object.freeze({
  sourceId: 'game-bulletin:1381',
  imageUrl: '/game-calendar/spring-2026-version-calendar.png',
  title: '「春晓时」版本日历',
  sourceUrl: 'https://ef-webview.hypergryph.com/page/game_bulletin?platform=Windows&channel=1&lang=zh-cn&server=1&subChannel=1&tab=events#1381',
});

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

function stripMarkupForContext(value) {
  return String(value || '')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function getImageContext(value, index) {
  const text = String(value || '');
  const normalizedIndex = Math.max(0, Number(index) || 0);
  const beforeLines = text.slice(0, normalizedIndex).split(/\r?\n/u).slice(-2).join(' ');
  const rest = text.slice(normalizedIndex);
  const currentLine = rest.split(/\r?\n/u)[0] || '';
  return stripMarkupForContext(`${beforeLines} ${currentLine}`);
}

function collectImageEntriesFromText(value, entries, source) {
  const text = String(value || '');
  if (!text) {
    return;
  }

  for (const match of text.matchAll(IMAGE_MARKDOWN_RE)) {
    entries.push({
      url: match[1],
      alt: sanitizeAnnouncementTitle(match[0].replace(/^!\[/u, '').replace(/\]\(.+$/u, '')),
      context: getImageContext(text, match.index || 0),
      source,
    });
  }

  for (const match of text.matchAll(IMAGE_TAG_RE)) {
    const tag = match[0] || '';
    const altMatch = ALT_ATTRIBUTE_RE.exec(tag);
    entries.push({
      url: match[2],
      alt: sanitizeAnnouncementTitle(altMatch?.[2] || ''),
      context: getImageContext(text, match.index || 0),
      source,
    });
  }
}

export function extractGameAnnouncementImageEntries(announcement = {}) {
  const seen = new Set();
  const entries = [];
  const directUrls = [
    ...(Array.isArray(announcement.image_urls) ? announcement.image_urls : []),
    ...(Array.isArray(announcement.imageUrls) ? announcement.imageUrls : []),
  ];

  directUrls.forEach((url, index) => {
    const normalizedUrl = String(url || '').trim();
    if (normalizedUrl && !seen.has(normalizedUrl)) {
      seen.add(normalizedUrl);
      entries.push({
        url: normalizedUrl,
        alt: '',
        context: '',
        source: 'direct',
        index,
      });
    }
  });

  [
    announcement.content,
    announcement.content_en,
    announcement.raw_content,
    announcement.rawContent,
    announcement.summary,
  ].forEach((value, fieldIndex) => collectImageEntriesFromText(value, entries, `content:${fieldIndex}`));

  return entries
    .map((entry, index) => ({
      ...entry,
      url: String(entry.url || '').trim(),
      index: Number.isFinite(entry.index) ? entry.index : index,
    }))
    .filter((entry) => {
      if (!entry.url || seen.has(`entry:${entry.url}`)) {
        return false;
      }
      seen.add(`entry:${entry.url}`);
      return true;
    });
}

export function extractGameAnnouncementImageUrls(announcement = {}) {
  return extractGameAnnouncementImageEntries(announcement).map(entry => entry.url);
}

function getCalendarHintStrength(value) {
  const text = sanitizeAnnouncementTitle(value);
  if (!text) {
    return 0;
  }

  if (STRONG_CALENDAR_HINT_RE.test(text)) {
    return 3;
  }

  if (SECONDARY_CALENDAR_HINT_RE.test(text)) {
    return 2;
  }

  if (CALENDAR_HINT_RE.test(text)) {
    return 1;
  }

  return 0;
}

function getCalendarCandidateScore(announcement, imageEntry) {
  if (!imageEntry?.url) {
    return 0;
  }

  const title = sanitizeAnnouncementTitle(announcement?.title || announcement?.title_en || '');
  const titleStrength = getCalendarHintStrength(title);
  const imageStrength = getCalendarHintStrength([
    imageEntry.alt,
    imageEntry.context,
    imageEntry.url,
  ].join(' '));
  const sourceGroup = getAnnouncementSourceGroup(announcement);
  const displayType = String(announcement?.display_type || announcement?.displayType || '').toLowerCase();
  const haystack = [
    title,
    announcement?.summary,
    announcement?.content,
    announcement?.raw_content,
    announcement?.source_url,
  ].map(value => String(value || '')).join('\n');

  let score = 1;
  if (sourceGroup === 'game') score += 20;
  if (displayType.includes('picture') || displayType.includes('image')) score += 18;
  score += titleStrength * 90;
  score += imageStrength * 70;
  if (!titleStrength && !imageStrength && CALENDAR_HINT_RE.test(haystack)) score += 8;
  if (!titleStrength && NON_CALENDAR_TITLE_RE.test(title)) score -= 45;
  score -= Math.min(8, Math.max(0, Number(imageEntry.index) || 0) * 2);

  const timestamp = new Date(announcement?.published_at || announcement?.updated_at || announcement?.created_at || 0).getTime();
  if (Number.isFinite(timestamp)) {
    score += Math.min(5, Math.max(0, timestamp / 10 ** 13));
  }

  return score;
}

export function findGameAnnouncementCalendarImage(announcements = []) {
  const candidates = (Array.isArray(announcements) ? announcements : [])
    .flatMap((announcement) => {
      const imageEntries = extractGameAnnouncementImageEntries(announcement);
      return imageEntries.map((imageEntry) => {
        const title = sanitizeAnnouncementTitle(announcement?.title || announcement?.title_en || '');
        const strongMatch = getCalendarHintStrength(title) >= 2
          || getCalendarHintStrength(`${imageEntry.alt} ${imageEntry.context} ${imageEntry.url}`) >= 2;
        return {
          announcement,
          imageEntry,
          imageUrl: imageEntry.url,
          imageUrls: imageEntries.map(entry => entry.url),
          strongMatch,
          score: getCalendarCandidateScore(announcement, imageEntry),
        };
      });
    })
    .filter(candidate => candidate.imageUrl && candidate.score > 1);

  const strongCandidates = candidates.filter(candidate => candidate.strongMatch);
  if (strongCandidates.length === 0) {
    return null;
  }

  const sortableCandidates = strongCandidates.sort((a, b) => b.score - a.score);

  const best = sortableCandidates[0];
  if (!best) {
    return null;
  }

  return {
    imageUrl: best.imageUrl,
    imageUrls: best.imageUrls,
    announcement: best.announcement,
    title: sanitizeAnnouncementTitle(best.announcement?.title || best.announcement?.title_en || ''),
    sourceUrl: best.announcement?.source_url || '',
  };
}

export function resolveGameAnnouncementCalendarImage(announcements = []) {
  const detectedCalendar = findGameAnnouncementCalendarImage(announcements);

  if (!detectedCalendar) {
    return {
      ...STATIC_GAME_CALENDAR_IMAGE,
      imageUrls: [STATIC_GAME_CALENDAR_IMAGE.imageUrl],
      announcement: null,
      originalImageUrl: null,
    };
  }

  if (detectedCalendar.announcement?.source_id !== STATIC_GAME_CALENDAR_IMAGE.sourceId) {
    return detectedCalendar;
  }

  return {
    ...detectedCalendar,
    imageUrl: STATIC_GAME_CALENDAR_IMAGE.imageUrl,
    imageUrls: [STATIC_GAME_CALENDAR_IMAGE.imageUrl],
    title: detectedCalendar.title || STATIC_GAME_CALENDAR_IMAGE.title,
    sourceUrl: detectedCalendar.sourceUrl || STATIC_GAME_CALENDAR_IMAGE.sourceUrl,
    originalImageUrl: detectedCalendar.imageUrl,
  };
}
