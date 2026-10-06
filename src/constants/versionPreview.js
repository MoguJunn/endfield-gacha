import { SPRING_PREVIEW_CN_LIVE_URL as OFFICIAL_CN_LIVE_URL } from './community.js';

// Official announcement: https://www.taptap.cn/moment/854131362418920116
// This is the special-program broadcast time, not the version release date.
export const DANQING_PREVIEW = Object.freeze({
  startsAt: '2026-10-06T19:30:00+08:00',
  // Official briefing announcement: https://endfield.hypergryph.com/news/4774
  endsAt: '2026-10-06T21:00:00+08:00',
  poster: '/danqing-preview-20261006.webp',
  liveUrl: OFFICIAL_CN_LIVE_URL,
});

export const VERSION_BRIEFING_URL = 'https://endfield.hypergryph.com/version_briefing/latest?source_from=official';

// Update this entry with each announced special program. An optional announcedAt
// keeps scheduled announcements hidden until their publication time.
export const ACTIVE_VERSION_PREVIEW = DANQING_PREVIEW;

export function isVersionPreviewActive(now = Date.now(), preview = ACTIVE_VERSION_PREVIEW) {
  if (!preview) return false;
  const announcedAt = preview.announcedAt ? new Date(preview.announcedAt).getTime() : -Infinity;
  const endsAt = new Date(preview.endsAt).getTime();
  return now >= announcedAt && now < endsAt;
}
