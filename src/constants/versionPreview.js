import { SPRING_PREVIEW_CN_LIVE_URL as OFFICIAL_CN_LIVE_URL } from './community.js';

// Broadcast time from the official poster supplied for the November 21 program.
// This is a special program, not a version release date.
export const ACTIVE_VERSION_PREVIEW = Object.freeze({
  title: '全新版本 & 2.0 揭幕前瞻',
  titleEn: 'New Version & 2.0 Reveal',
  startsAt: '2026-11-21T19:30:00+08:00',
  // Local card display window: keep the live link through broadcast day.
  // The poster does not announce the actual program duration.
  endsAt: '2026-11-22T00:00:00+08:00',
  sourceUrl: 'https://i0.hdslb.com/bfs/new_dyn/d1fb63e04b7d6274d033fdae6a7ae71b1265652806.png',
  liveUrl: OFFICIAL_CN_LIVE_URL,
});

export const VERSION_BRIEFING_URL = 'https://endfield.hypergryph.com/version_briefing/latest?source_from=official';

// An optional announcedAt keeps scheduled announcements hidden until publication.
export function isVersionPreviewActive(now = Date.now(), preview = ACTIVE_VERSION_PREVIEW) {
  if (!preview) return false;
  const announcedAt = preview.announcedAt ? new Date(preview.announcedAt).getTime() : -Infinity;
  const endsAt = new Date(preview.endsAt).getTime();
  return now >= announcedAt && now < endsAt;
}
