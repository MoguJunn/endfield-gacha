// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveLotterySiteUrls } from '../../shared/lotterySiteUrls.js';

const env = { MAIN_SITE_URL: 'https://ef-gacha.mogujun.icu', LOTTERY_SITE_URL: 'https://ef-gacha.mogujun.icu/lottery' };
const req = host => ({ headers: { host, 'x-forwarded-proto': 'https' } });

describe('lottery URLs and host-only sessions', () => {
  it.each(['ef-gacha.mogujun.icu', 'ef.nepst.cn'])('keeps the approved domain %s throughout SSO', host => {
    expect(resolveLotterySiteUrls(req(host), env)).toEqual({ mainSiteOrigin: `https://${host}`, lotteryOrigin: `https://${host}`, lotteryBaseUrl: `https://${host}/lottery` });
  });
  it.each(['attacker.example', 'ef.nepst.cn.attacker.example', 'ef.nepst.cn@attacker.example', 'ef.nepst.cn/path'])('does not trust a forged Host %s', host => {
    expect(resolveLotterySiteUrls(req(host), env).mainSiteOrigin).toBe(env.MAIN_SITE_URL);
  });
  it('does not use forwarded hosts to choose the login callback', () => {
    expect(resolveLotterySiteUrls({ headers: { ...req('ef-gacha.mogujun.icu').headers, 'x-forwarded-host': 'attacker.example' } }, env).lotteryBaseUrl).toBe(env.LOTTERY_SITE_URL);
  });
  it('preserves the separately hosted activity contract', () => {
    const separate = { MAIN_SITE_URL: 'https://main.example', LOTTERY_SITE_URL: 'https://lottery.example' };
    expect(resolveLotterySiteUrls(req('lottery.example'), separate)).toEqual({ mainSiteOrigin: 'https://main.example', lotteryOrigin: 'https://lottery.example', lotteryBaseUrl: 'https://lottery.example' });
  });
});
