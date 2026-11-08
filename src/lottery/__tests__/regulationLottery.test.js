import { describe, expect, it } from 'vitest';
import archive from '../../assets/lottery/archives/arknights-p3r-collab-2026.json';
import { REGULATION_LOTTERY, createRegulationSiteConfig, getRegulationPublicEnvironment } from '../../../shared/regulationLottery.js';

describe('regulation lottery campaign', () => {
  it('allocates exactly one winner and explicitly disables the legacy second-prize default', () => {
    expect(REGULATION_LOTTERY.prizePlan).toEqual({ first: 1, second: 0 });
    const site = createRegulationSiteConfig(archive.data.site);
    expect(site.prizes).toHaveLength(1);
    expect(site.prizes[0].tier).toBe('first');
    expect(site.prizes[0].description).toContain('¥45');
    expect(site.prizes[0].imageUrls).toEqual([REGULATION_LOTTERY.prizeImage]);
  });

  it('keeps QQ and actual group membership requirements while preserving the previous public archive', () => {
    const original = JSON.stringify(archive);
    const site = createRegulationSiteConfig(archive.data.site);
    expect(site.contact.format).toBe('qq');
    expect(site.contact.notificationRequired).toBe(true);
    expect(site.contact.notificationValue).toBe('1080983185');
    expect(site.hero.sponsor).toContain('Neptune');
    expect(site.archive.url).toBe(`/lottery/archive/${archive.data.campaign.id}`);
    expect(archive.data.entryCount).toBe(56);
    expect(archive.data.user).toBeNull();
    expect(archive.data.entry).toBeNull();
    expect(archive.data.ownWinner).toBeNull();
    expect(JSON.stringify(archive)).toBe(original);
    expect(JSON.stringify(site)).not.toContain('首次开奖');
  });

  it('closes at the end of November 21 in China and exports matching public display settings', () => {
    expect(new Date(REGULATION_LOTTERY.closesAt).toISOString()).toBe('2026-11-21T16:00:00.000Z');
    expect(Date.parse(REGULATION_LOTTERY.drawsAt)).toBeGreaterThan(Date.parse(REGULATION_LOTTERY.closesAt));
    const site = createRegulationSiteConfig(archive.data.site);
    const env = getRegulationPublicEnvironment(site);
    expect(env.LOTTERY_CAMPAIGN_ID).not.toBe(archive.data.campaign.id);
    expect(JSON.parse(env.LOTTERY_PRIZES_JSON)).toEqual(site.prizes);
    expect(JSON.parse(env.LOTTERY_RULES_JSON)).toEqual(site.rules);
  });
});
