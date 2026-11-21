import { SPRING_PREVIEW_CN_LIVE_URL as OFFICIAL_CN_LIVE_URL } from './community.js';

// Broadcast time from the official poster supplied for the November 21 program.
// This is a special program, not a version release date.
export const ACTIVE_VERSION_PREVIEW = Object.freeze({
  title: '全新版本 & 2.0 揭幕前瞻',
  titleEn: 'New Version & 2.0 Reveal',
  startsAt: '2026-11-21T19:30:00+08:00',
  // Restore the briefing when the official recap goes live (BV1pvyhzdER5).
  endsAt: '2026-11-21T20:45:00+08:00',
  sourceUrl: 'https://i0.hdslb.com/bfs/new_dyn/d1fb63e04b7d6274d033fdae6a7ae71b1265652806.png',
  liveUrl: OFFICIAL_CN_LIVE_URL,
});

export const VERSION_BRIEFING_URL = 'https://endfield.hypergryph.com/version_briefing/latest?source_from=official';

export const VERSION_8_BRIEFING = Object.freeze({
  url: 'https://endfield.hypergryph.com/version_briefing/latest?source_from=bilibili',
  imageUrl: 'https://i0.hdslb.com/bfs/new_dyn/411083e4dc1913d5b5217efcf16f91101265652806.png',
  announcement: Object.freeze({
    source_id: '5970',
    source_url: 'https://endfield.hypergryph.com/news/5970',
    title: '「穿越甚大蘑境与你相逢」新版本导览 浏览领嵌晶玉',
    published_at: '2026-11-21T12:00:00Z',
  }),
});

// An optional announcedAt keeps scheduled announcements hidden until publication.
export function isVersionPreviewActive(now = Date.now(), preview = ACTIVE_VERSION_PREVIEW) {
  if (!preview) return false;
  const announcedAt = preview.announcedAt ? new Date(preview.announcedAt).getTime() : -Infinity;
  const endsAt = new Date(preview.endsAt).getTime();
  return now >= announcedAt && now < endsAt;
}
