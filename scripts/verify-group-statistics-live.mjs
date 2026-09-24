import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { STATISTICS_GROUPS } from '../shared/statisticsScopes.js';

const origin = process.env.STATISTICS_BASE_URL || 'http://127.0.0.1:5193';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 950 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.setDefaultTimeout(30000);
await page.addInitScript(() => localStorage.setItem('lastCaptchaVerified', String(Date.now())));
const number = async (testId) => Number((await page.getByTestId(testId).innerText()).replaceAll(',', ''));
async function ready() { await page.getByTestId('observation-total').waitFor(); }
async function selectGroup(key) {
  const response = page.waitForResponse((response) => response.url().includes('type=group_statistics') && new URL(response.url()).searchParams.get('groupKey') === key);
  await page.locator(`[data-group-key="${key}"]`).click();
  const result = await response;
  assert.equal(result.status(), 200, `Snapshot must be ready: ${key}`);
  const payload = (await result.json()).data;
  await ready();
  assert.equal(await number('observation-total'), payload.observations.total);
  assert.equal(await number('legacy-regularTotal'), payload.legacy.regularTotal);
  assert.equal(await page.locator('.ex-picker-trigger').count(), 0);
  assert.equal(await page.getByLabel('图表对象星级', { exact: true }).count(), 0);
  assert.ok(await page.getByRole('button', { name: /理论预测|Prediction/, exact: true }).isDisabled());
  assert.equal(await page.locator('[data-chart]').count(), 10);
  assert.equal(payload.observations.items.reduce((sum, item) => sum + item.count, 0), payload.observations.rarities.find((row) => row.rarity === 6)?.count || 0);
  assert.equal(payload.observations.members.reduce((sum, member) => sum + member.total, 0), payload.observations.total);
  assert.doesNotMatch(JSON.stringify(payload), /"(?:user_id|game_uid|accountKey|record_id|history)"\s*:/);
  console.log(JSON.stringify({ group: key, total: payload.observations.total, accounts: payload.observations.participatingAccounts, members: payload.observations.members.length }));
  return payload;
}
async function checkLayout(width) {
  await page.setViewportSize({ width, height: 950 });
  const continueButton = page.getByRole('button', { name: /仍然进入桌面版|Continue with desktop/ });
  if (await continueButton.isVisible()) await continueButton.click();
  await page.waitForFunction(() => document.querySelector('.ex-observation-report'));
  if (await page.locator('[data-group-key="limited"][aria-pressed="true"]').count() === 0) {
    if (!await page.locator('[data-group-key="limited"]').isVisible()) await page.locator('.ex-sidebar-toggle').click();
    await selectGroup('limited');
  }
  assert.equal(await page.locator('.ex-picker-trigger').count(), 0, 'Responsive checks must stay on the group report');
  await page.waitForFunction(() => [...document.querySelectorAll('.ex-chart-frame')].every((frame) => {
    const svg = frame.querySelector('svg.recharts-surface');
    return frame.querySelector('.ex-empty') || svg && Math.abs(svg.getBoundingClientRect().width - frame.clientWidth) < 2;
  }));
  const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll('.ex-workspace-content *')].filter((element) => {
      const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
      return rect.width > 0 && style.position !== 'absolute' && (rect.right > innerWidth + 1 || rect.left < -1);
    }).map((element) => element.className).filter((name) => typeof name === 'string').slice(0, 8) }));
  assert.ok(overflow.scroll <= width + 1, JSON.stringify(overflow));
  assert.deepEqual(overflow.elements, []);
  console.log(`group layout ${width}: PASS`);
}
try {
  await page.goto(`${origin}/summary?platform=desktop`);
  await ready();
  assert.equal(await page.locator('[data-group-key]').count(), 5);
  const single = await page.locator('[data-pool-id][aria-pressed="true"]').getAttribute('data-pool-id');
  for (const group of STATISTICS_GROUPS) await selectGroup(group.key);
  await selectGroup('limited');
  const total = await number('observation-total');
  const series = page.locator('.ex-series input');
  assert.equal(await series.count(), await page.locator('.ex-series input:checked').count());
  await page.getByRole('button', { name: '只看本期目标', exact: true }).click();
  assert.equal(await page.locator('.ex-series input:checked').count(), 1);
  await page.getByRole('button', { name: '显示全部', exact: true }).click();
  await page.getByText('展开资源明细', { exact: true }).click();
  await page.getByText('资源明细', { exact: true }).waitFor();
  await page.getByText('查看成员卡池', { exact: true }).click();
  assert.equal(await page.locator('.ex-scope-members li:visible').count(), 11);
  for (const width of [1366, 1920, 768, 390, 360]) await checkLayout(width);
  await page.screenshot({ path: '.agent-tmp/statistics-live/groups-360.png', fullPage: true });
  await page.setViewportSize({ width: 1366, height: 950 });
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  for (const width of [1366, 768, 360]) await checkLayout(width);
  assert.equal(await number('observation-total'), total);
  await page.screenshot({ path: '.agent-tmp/statistics-live/groups-dark-360.png', fullPage: true });
  await page.setViewportSize({ width: 1366, height: 950 });
  await page.locator(`[data-pool-id="${single}"]`).click();
  await page.locator('.ex-picker-trigger').waitFor();
  assert.equal(await page.locator('[data-chart]').count(), 10);
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await mobile.addInitScript(() => localStorage.setItem('lastCaptchaVerified', String(Date.now())));
  mobile.on('pageerror', (error) => errors.push(error.message));
  await mobile.goto(`${origin}/m/stats?platform=mobile`);
  const mobileGate = mobile.getByRole('button', { name: /进入移动版|Continue with mobile/ });
  await Promise.race([mobileGate.waitFor(), mobile.getByTestId('observation-total').waitFor()]);
  if (await mobileGate.isVisible()) { await mobileGate.click(); await mobile.waitForURL('**/m/**'); await mobile.goto(`${origin}/m/stats?platform=mobile`); }
  await mobile.getByTestId('observation-total').waitFor();
  await mobile.locator('.ex-sidebar-toggle').click();
  await mobile.locator('[data-group-key="limited"]').click();
  await mobile.waitForFunction((expected) => Number(document.querySelector('[data-testid="observation-total"]')?.textContent.replaceAll(',', '')) === expected, total);
  assert.equal(await mobile.locator('.ex-picker-trigger').count(), 0);
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  console.log('PASS: five groups, categories, resources, empty groups, single-pool return, bilingual themes and mobile route');
} finally { await browser.close(); }
