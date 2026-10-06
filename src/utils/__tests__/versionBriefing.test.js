import { describe, expect, it } from 'vitest';
import { appendVersionBriefingRecords, findVersionBriefing } from '../versionBriefing.js';

const plan = { versions: [{ name: '丹青渡', nameEn: 'Sanctuary of Ink' }, { name: '下期版本' }] };
const now = new Date('2026-11-01T00:00:00Z').getTime();
const briefing = {
  source_id: '4774',
  title: '「丹青渡」新版本导览上线，浏览领嵌晶玉！',
  source_url: 'https://endfield.hypergryph.com/news/4774',
  published_at: '2026-10-06T12:00:00Z',
  content: '<img src="/api/official-announcement-image?url=cover" alt="新版本导览封面"><img src="/banner.png">',
  image_urls: ['/api/official-announcement-image?url=cover', '/banner.png'],
};

describe('version briefing selection', () => {
  it('uses the official cover instead of the body banner, including persisted markdown summaries', () => {
    expect(findVersionBriefing([briefing], plan, now).imageUrl).toBe('/api/official-announcement-image?url=cover');
    expect(findVersionBriefing([{ ...briefing, content: '![新版本导览封面](/cover.png)\n![公告配图 2](/banner.png)' }], plan, now).imageUrl).toBe('/cover.png');
  });

  it('matches exact managed version names and chooses the newest published matching version', () => {
    const next = { ...briefing, source_id: 'next', title: '「下期版本」新版本导览上线', published_at: '2026-10-31T12:00:00Z' };
    expect(findVersionBriefing([briefing, next], plan, now).version.name).toBe('下期版本');
    expect(findVersionBriefing([briefing], { versions: [{ name: '青渡' }] }, now)).toBeNull();
    expect(findVersionBriefing([briefing, { ...next, published_at: '2026-11-02T00:00:00Z' }], plan, now).version.name).toBe('丹青渡');
  });

  it('rejects unofficial or inactive records and does not guess artwork from an old unmarked body', () => {
    expect(findVersionBriefing([{ ...briefing, source_url: 'https://other.test/news/1' }], plan, now)).toBeNull();
    expect(findVersionBriefing([{ ...briefing, is_active: false }], plan, now)).toBeNull();
    expect(findVersionBriefing([{ ...briefing, content: '<img src="/banner.png">' }], plan, now).imageUrl).toBeNull();
  });

  it('retains older briefings beyond recent list limits and replaces missing covers from the live feed without duplicates', () => {
    const old = { ...briefing, content: '<img src="/banner.png">' };
    expect(appendVersionBriefingRecords([{ source_id: 'other' }], [briefing, briefing])).toHaveLength(2);
    expect(appendVersionBriefingRecords([old], [briefing, old])).toEqual([briefing]);
  });
});
