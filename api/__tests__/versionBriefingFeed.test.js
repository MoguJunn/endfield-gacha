// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildOfficialAnnouncementRecords } from '../_lib/officialAnnouncementsFeed.js';
import { findVersionBriefing } from '../../src/utils/versionBriefing.js';

describe('official briefing cover ingestion', () => {
  it.each(['short', 'summarized'])('keeps list cover distinct from the body banner through %s content and persistence', async (mode) => {
    const cover = 'https://web.hycdn.cn/upload/image/cover.png';
    const fetchImpl = async url => ({
      ok: true,
      json: async () => ({ code: 0, data: String(url).includes('/bulletin/4774') ? {
        cid: '4774', title: '「丹青渡」新版本导览上线，浏览领嵌晶玉！', displayTime: 1791289380,
        data: `<img src="https://web.hycdn.cn/upload/image/banner.png"><p>${'浏览官网领取奖励。'.repeat(mode === 'short' ? 1 : 200)}</p>`,
      } : { list: [{ cid: '4774', title: '「丹青渡」新版本导览上线，浏览领嵌晶玉！', cover }] } }),
    });
    const [record] = await buildOfficialAnnouncementRecords(30, { fetchImpl, env: {} });
    const persisted = { ...record, raw_content: undefined, image_urls: undefined };
    const briefing = findVersionBriefing([persisted], { versions: [{ name: '丹青渡' }] }, new Date('2026-11-01').getTime());
    expect(briefing.imageUrl).toBe(cover);
    expect(briefing.imageUrl).not.toContain('banner');
    expect(record.summary_mode).toBe(mode === 'short' ? 'raw' : 'heuristic');
  });
});
