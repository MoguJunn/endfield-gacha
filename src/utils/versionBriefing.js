import { extractGameAnnouncementImageEntries } from './gameAnnouncementCalendar.js';

export function isOfficialVersionBriefing(announcement) {
  if (announcement?.is_active === false || !/新版本导览/u.test(announcement?.title || '')) return false;
  try {
    const url = new URL(announcement.source_url);
    return url.origin === 'https://endfield.hypergryph.com' && url.pathname.startsWith('/news/');
  } catch {
    return false;
  }
}

export function findVersionBriefing(announcements = [], versionPlan, now = Date.now()) {
  const versions = versionPlan?.versions || [];
  const candidates = announcements
    .filter(isOfficialVersionBriefing)
    .filter(record => new Date(record.published_at).getTime() <= now)
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at));

  for (const announcement of candidates) {
    const title = String(announcement.title);
    const quotedName = /[「『【“]([^」』】”]+)[」』】”]\s*新版本导览/u.exec(title)?.[1];
    const version = versions.find(entry => quotedName
      ? entry.name === quotedName.trim()
      : title.startsWith(`${entry.name}新版本导览`));
    if (!version) continue;
    const cover = extractGameAnnouncementImageEntries({ ...announcement, image_urls: [], imageUrls: [] })
      .find(entry => entry.alt === '新版本导览封面');
    return { announcement, version, imageUrl: cover?.url || null };
  }
  return null;
}

export function appendVersionBriefingRecords(records = [], candidates = []) {
  const byKey = new Map(records.map(record => [record.source_id, record]));
  for (const record of candidates.filter(isOfficialVersionBriefing)) {
    const existing = byKey.get(record.source_id);
    const hasCover = entry => /新版本导览封面/u.test(`${entry?.content || ''}${entry?.raw_content || ''}`);
    if (!existing || (!hasCover(existing) && hasCover(record))) {
      byKey.set(record.source_id, record);
    }
  }
  return [...byKey.values()];
}
