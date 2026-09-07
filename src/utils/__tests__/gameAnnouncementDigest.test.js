import { describe, expect, it } from 'vitest';
import { resolveGameAnnouncementDigest } from '../gameAnnouncementDigest.js';

const MESSAGES = {
  'announcement.digest.title': 'Recent Game Notices',
  'announcement.digest.fallbackTitle': 'Recent Synced Notices',
  'announcement.digest.gameCount': 'In-game {count}',
  'announcement.digest.officialCount': 'Official site {count}',
  'announcement.digest.category.events': 'Events {count}',
  'announcement.digest.category.updates': 'Updates {count}',
  'announcement.digest.category.news': 'News {count}',
  'announcement.digest.recentTopics': 'Recent notices: {topics}',
  'announcement.digest.focusTopics': 'Highlights: {topics}.',
  'home.autoSummary': 'Auto-synced summaries',
};

function t(key, params = {}) {
  return String(MESSAGES[key] || key).replace(/\{(\w+)\}/gu, (_, name) => String(params[name] ?? ''));
}

describe('game announcement digest localization', () => {
  it('uses the stored English digest in English mode', () => {
    const digest = resolveGameAnnouncementDigest({
      title: '中文标题',
      subtitle: '中文摘要',
      title_en: 'Dreamscape Update Now Live',
      subtitle_en: 'Winter Hunt and the new narrative event are now available.',
    }, [], t, 'en-US');

    expect(digest).toMatchObject({
      title: 'Dreamscape Update Now Live',
      subtitle: 'Winter Hunt and the new narrative event are now available.',
    });
  });

  it('does not leak untranslated Chinese topics into the English fallback', () => {
    const digest = resolveGameAnnouncementDigest(null, [{
      title: '雪凇幽梦版本更新',
      content: '中文公告正文',
      source_id: 'game-bulletin:1',
      source_url: 'https://example.test/game_bulletin?tab=updates',
      published_at: new Date().toISOString(),
    }], t, 'en-US');

    expect(digest.title).toBe('Recent Game Notices');
    expect(digest.subtitle).toContain('In-game 1');
    expect(`${digest.title}${digest.subtitle}`).not.toMatch(/[\u3400-\u9fff]/u);
  });
});
