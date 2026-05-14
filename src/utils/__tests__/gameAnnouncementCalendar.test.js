import { describe, expect, it } from 'vitest';

import {
  extractGameAnnouncementImageUrls,
  findGameAnnouncementCalendarImage,
  resolveGameAnnouncementCalendarImage,
  STATIC_GAME_CALENDAR_IMAGE,
} from '../gameAnnouncementCalendar.js';

describe('gameAnnouncementCalendar', () => {
  it('extracts markdown and html image urls', () => {
    const urls = extractGameAnnouncementImageUrls({
      content: '![版本日历](/api/official-announcement-image?url=https%3A%2F%2Fexample.test%2Fcalendar.png)',
      summary: '<img src="https://example.test/backup.png" alt="">',
    });

    expect(urls).toEqual([
      '/api/official-announcement-image?url=https%3A%2F%2Fexample.test%2Fcalendar.png',
      'https://example.test/backup.png',
    ]);
  });

  it('prefers pinned calendar-like game announcements', () => {
    const result = findGameAnnouncementCalendarImage([
      {
        title: '近期多项活动更新与供给',
        content: '<p>版本活动一览</p><img src="https://example.test/wrong.png">',
        source_kind: 'game-bulletin',
        display_type: 'picture',
        published_at: '2026-05-20T00:00:00.000Z',
      },
      {
        title: '「春晓时」版本日历',
        content: '![calendar](https://example.test/calendar.png)',
        source_kind: 'game-bulletin',
        display_type: 'picture',
        published_at: '2026-05-01T00:00:00.000Z',
      },
    ]);

    expect(result).toMatchObject({
      imageUrl: 'https://example.test/calendar.png',
      title: '「春晓时」版本日历',
    });
  });

  it('can select the calendar image inside a multi-image announcement', () => {
    const result = findGameAnnouncementCalendarImage([
      {
        title: '「春晓时」版本日历',
        content: [
          '![普通活动图](https://example.test/banner.png)',
          '版本日历',
          '![春晓时版本日历](https://example.test/calendar.png)',
        ].join('\n'),
        source_kind: 'game-bulletin',
        display_type: 'picture',
      },
    ]);

    expect(result?.imageUrl).toBe('https://example.test/calendar.png');
  });

  it('uses the static public calendar asset for the bundled current version calendar', () => {
    const result = resolveGameAnnouncementCalendarImage([
      {
        source_id: STATIC_GAME_CALENDAR_IMAGE.sourceId,
        title: '「春晓时」版本日历',
        content: '![版本日历](/api/official-announcement-image?url=https%3A%2F%2Fweb.hycdn.cn%2Fupload%2Fimage%2F20260415%2Fc12891f0e79f61d7c7578941e17424a6.png)',
        source_kind: 'game-bulletin',
        display_type: 'rich_text',
      },
    ]);

    expect(result).toMatchObject({
      imageUrl: STATIC_GAME_CALENDAR_IMAGE.imageUrl,
      originalImageUrl: '/api/official-announcement-image?url=https%3A%2F%2Fweb.hycdn.cn%2Fupload%2Fimage%2F20260415%2Fc12891f0e79f61d7c7578941e17424a6.png',
      title: '「春晓时」版本日历',
    });
  });

  it('keeps remote calendar images when the detected calendar is newer than the bundled static asset', () => {
    const result = resolveGameAnnouncementCalendarImage([
      {
        source_id: 'game-bulletin:future-calendar',
        title: '「下一版本」版本日历',
        content: '![版本日历](https://example.test/future-calendar.png)',
        source_kind: 'game-bulletin',
        display_type: 'rich_text',
      },
    ]);

    expect(result?.imageUrl).toBe('https://example.test/future-calendar.png');
    expect(result?.originalImageUrl).toBeUndefined();
  });
});
