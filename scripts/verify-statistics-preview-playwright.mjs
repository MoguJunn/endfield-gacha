import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, '.agent-tmp/statistics-preview');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const apiRequests = [];
const page = await browser.newPage({ viewport: { width: 1366, height: 950 }, reducedMotion: 'reduce' });
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
});
const url = process.env.STATISTICS_PREVIEW_URL || 'http://localhost:5173/statistics-preview.html';

async function validateLayout(label, expectedCharts = 8) {
  await page.waitForFunction((expected) => {
    const frames = [...document.querySelectorAll('.ex-chart-frame')];
    return frames.length === expected && frames.every((frame) => {
      const svg = frame.querySelector('svg.recharts-surface');
      return frame.querySelector('.ex-empty') || (svg && Math.abs(svg.getBoundingClientRect().width - frame.getBoundingClientRect().width) < 2);
    });
  }, expectedCharts);
  const geometry = await page.evaluate(() => ({
    width: innerWidth,
    pageWidth: document.documentElement.scrollWidth,
    badCharts: [...document.querySelectorAll('.ex-chart')].filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width < 200 || rect.left < 0 || rect.right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 1;
    }).map((el) => el.dataset.chart),
    clippedAxisLabels: [...document.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value')].filter((el) => {
      const rect = el.getBoundingClientRect();
      const bounds = el.closest('svg').getBoundingClientRect();
      return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
    }).map((el) => el.textContent),
    svgCount: document.querySelectorAll('.ex-chart-frame svg.recharts-surface').length,
  }));
  assert.ok(geometry.pageWidth <= geometry.width + 1, `${label}: horizontal page overflow ${JSON.stringify(geometry)}`);
  assert.deepEqual(geometry.badCharts, [], `${label}: chart overflow`);
  assert.deepEqual(geometry.clippedAxisLabels, [], `${label}: axis label clipping`);
  console.log(`${label}: ${JSON.stringify(geometry)}`);
}

try {
  await page.goto(url);
  await page.getByRole('heading', { name: '分卡池详细统计' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.keyboard.press('Tab');
  assert.equal(await page.locator(':focus').innerText(), '分池统计');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator(':focus').innerText(), '使用指南');
  assert.equal(await page.locator(':focus').evaluate((el) => getComputedStyle(el).outlineStyle), 'solid');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: '使用指南', exact: true }).waitFor();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: '分卡池详细统计' }).waitFor();
  for (const width of [360, 390, 768, 1366, 1920]) {
    await page.setViewportSize({ width, height: 950 });
    await validateLayout(`zh/light/${width}`);
    if ([390, 1366].includes(width)) await page.screenshot({ path: resolve(output, `observed-${width}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  for (const width of [360, 768, 1366]) {
    await page.setViewportSize({ width, height: 950 });
    await validateLayout(`en/dark/${width}`);
    if ([360, 1366].includes(width)) await page.screenshot({ path: resolve(output, `observed-dark-${width}.png`), fullPage: true });
  }
  await page.getByLabel('Range start', { exact: true }).fill('20');
  await page.getByLabel('Range end', { exact: true }).fill('80');
  assert.equal(await page.getByLabel('Range start', { exact: true }).inputValue(), '20');
  assert.equal(await page.getByLabel('Range end', { exact: true }).inputValue(), '80');
  await page.getByLabel('Featured operator', { exact: true }).uncheck();
  assert.equal(await page.locator('[data-chart="05"] .recharts-line').count(), 2);
  for (const checkbox of await page.locator('.ex-series input').all()) await checkbox.uncheck();
  assert.equal(await page.locator('.ex-curves .ex-empty').count(), 4);
  assert.equal(await page.getByLabel('First acquisition', { exact: true }).count(), 0);
  await page.getByLabel('Banner', { exact: true }).selectOption('sample-b');
  assert.equal(await page.locator('[data-chart="03"] .ex-empty').count(), 0);
  await page.getByLabel('Sample scope', { exact: true }).selectOption('one');
  await validateLayout('single-account/pool-first');
  await page.getByRole('button', { name: 'Theoretical prediction', exact: true }).click();
  await validateLayout('character/theory', 2);
  await page.getByLabel('Guarantee progress', { exact: true }).fill('119');
  await page.getByLabel('Prediction horizon', { exact: true }).fill('1');
  assert.match(await page.locator('.ex-theory .ex-meta').innerText(), /100.0%/);
  await page.getByLabel('One-time guarantee', { exact: true }).selectOption('used');
  assert.match(await page.locator('.ex-theory .ex-meta').innerText(), /0.4%/);
  await page.getByLabel('Banner', { exact: true }).selectOption('sample-w');
  await validateLayout('weapon/theory', 2);
  assert.ok(await page.getByText('Weapon claims · Reserved-slot model estimate', { exact: true }).count());
  await page.screenshot({ path: resolve(output, 'theory-1366.png'), fullPage: true });
  await page.getByRole('button', { name: 'Getting started', exact: true }).click();
  await page.getByRole('button', { name: 'Import needs review', exact: true }).click();
  await page.getByRole('button', { name: 'Review import result', exact: false }).click();
  await page.getByRole('status').waitFor();
  await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  await page.getByRole('button', { name: 'Reopen guide', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const guideGeometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(guideGeometry.scroll <= guideGeometry.width + 1, 'Guide horizontal overflow');
  const duration = await page.getByRole('button', { name: 'Skip for now', exact: true }).evaluate((el) => getComputedStyle(el).transitionDuration);
  assert.equal(duration, '0s', 'Reduced motion disables transitions');
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.getByRole('button', { name: '浅色', exact: true }).click();
  await page.screenshot({ path: resolve(output, 'guide-390.png'), fullPage: true });
  await page.setViewportSize({ width: 1366, height: 950 });
  await page.screenshot({ path: resolve(output, 'guide-1366.png'), fullPage: true });
  assert.deepEqual(errors, [], 'Browser runtime errors');
  assert.deepEqual(apiRequests, [], 'Preview must not request account or production APIs');
  console.log('PASS: eight charts, responsive layouts, filters, theories, guide flow, keyboard focus, reduced motion, no API requests.');
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
}
