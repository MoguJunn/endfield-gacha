import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const output = fileURLToPath(new URL('../.agent-tmp/statistics-live/', import.meta.url));
await mkdir(output, { recursive: true });
const origin = process.env.STATISTICS_BASE_URL || 'http://localhost:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 950 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.setDefaultTimeout(60000);
await page.addInitScript(() => {
  localStorage.setItem('lastCaptchaVerified', Date.now().toString());
});

async function layout(width) {
  await page.setViewportSize({ width, height: 950 });
  if (width < 1000 && await page.getByRole('button', { name: /仍然进入桌面版/ }).isVisible()) {
    await page.getByRole('button', { name: /仍然进入桌面版/ }).click();
    await page.getByTestId('observation-total').waitFor();
  }
  await page.waitForFunction(() => [...document.querySelectorAll('.ex-chart-frame')].every((frame) => {
    const svg = frame.querySelector('svg.recharts-surface');
    return frame.querySelector('.ex-empty') || svg && Math.abs(svg.getBoundingClientRect().width - frame.clientWidth) < 2;
  }));
  const result = await page.evaluate(() => {
    const sidebar = document.querySelector('.ex-sidebar').getBoundingClientRect();
    const content = document.querySelector('.ex-workspace-content').getBoundingClientRect();
    return { width: innerWidth, scroll: document.documentElement.scrollWidth, sidebarRight: sidebar.right, contentLeft: content.left,
      chartCount: document.querySelectorAll('[data-chart]').length };
  });
  assert.ok(result.scroll <= width + 1, JSON.stringify(result));
  if (width > 700) assert.ok(result.sidebarRight < result.contentLeft, 'Filters must be a left sidebar');
  assert.equal(result.chartCount, 10);
  await page.locator('.ex-picker-trigger').click();
  const popup = await page.locator('.ex-picker-popup').boundingBox();
  assert.ok(popup.x >= 0 && popup.x + popup.width <= width + 1 && popup.y >= 0 && popup.y + popup.height <= 951, 'Picker must fit the viewport');
  assert.ok(await page.locator('.ex-picker-popup').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
  }), 'Picker must remain above the chart cards');
  if ([1366, 360].includes(width)) await page.screenshot({ path: `${output}/picker-${width}.png` });
  await page.locator('.ex-picker-search input').press('Escape');
  console.log(`layout ${width}: PASS`);
}

try {
  await page.goto(`${origin}/summary?platform=desktop`);
  await page.getByRole('heading', { name: '分卡池详细统计', exact: true }).waitFor();
  await page.getByTestId('observation-total').waitFor();
  const total = Number((await page.getByTestId('observation-total').innerText()).replaceAll(',', ''));
  assert.ok(total > 0, 'Expected real community records');
  const poolId = await page.locator('.ex-sidebar [data-pool-id][aria-pressed="true"]').getAttribute('data-pool-id');
  const response = await page.request.get(`${origin}/api/stats?type=pool_observations&poolId=${encodeURIComponent(poolId)}`);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.data.observations.total, total);
  assert.ok(['scheduled-snapshot', 'local-snapshot'].includes(payload.data.meta.source));
  assert.ok(payload.data.meta.updatedAt);
  assert.ok(payload.data.meta.nextRefreshAt);
  assert.ok(payload.data.observations.items.filter((item) => item.rarity === 6).reduce((sum, item) => sum + item.first.sampleCount, 0) > 0);
  assert.equal(await page.locator('[data-chart="03"] .ex-empty, [data-chart="05"] .ex-empty, [data-chart="06"] .ex-empty').count(), 0);
  assert.doesNotMatch(JSON.stringify(payload), /"(?:user_id|game_uid|accountKey|record_id|history)"\s*:/);
  assert.equal(payload.data.observations.firstMode, 'pool');
  assert.equal(payload.data.modes, undefined);
  const meta = payload.data.observations.meta;
  assert.equal(payload.data.observations.rarities.reduce((sum, item) => sum + item.count, 0), total);
  assert.equal(payload.data.observations.items.reduce((sum, item) => sum + item.count, 0) + meta.unidentifiedRecords, total);
  console.log(`Real pool ${poolId}: ${total} recorded results, ${payload.data.observations.participatingAccounts} accounts; ${JSON.stringify(meta)}`);
  const focusSelect = page.getByLabel('关注对象', { exact: true });
  const originalFocus = await focusSelect.getAttribute('data-value');
  const observations = payload.data.observations;
  const focus = observations.items.find((item) => item.itemId === originalFocus);
  assert.ok(focus, 'The featured target should resolve to a recorded item');
  const orderedCosts = focus.first.points.flatMap((point) => Array(point.count).fill(point.cost));
  assert.equal(await page.locator('[data-insight="median"]').innerText(), String(orderedCosts[Math.ceil(orderedCosts.length / 2) - 1]));
  assert.equal(await page.locator('[data-insight="mean"]').innerText(), focus.first.mean.toFixed(1));
  assert.equal(await page.locator('[data-insight="samples"]').innerText(), String(focus.first.sampleCount));
  assert.equal(await page.locator('[data-insight="obtained"]').innerText(), `${observations.participatingAccounts - focus.nonObtainingAccounts} / ${observations.participatingAccounts}`);
  await page.waitForFunction(() => document.querySelector('.ex-target-identity img')?.naturalWidth > 0);
  const directory = (await (await page.request.get(`${origin}/api/stats?type=characters`)).json()).data.characters;
  const six = observations.items.filter((item) => Number(item.rarity) === 6);
  const groupRank = (item) => item.itemId === originalFocus ? 0 : directory.find((record) => record.id === item.itemId)?.is_limited ? 1 : 2;
  const orderedSix = [...six].sort((a, b) => groupRank(a) - groupRank(b) || a.name.localeCompare(b.name, 'zh-Hans-u-co-pinyin'));
  assert.deepEqual(await page.locator('.ex-series label').allTextContents(), orderedSix.map((item) => item.name));
  assert.deepEqual(await page.locator('.ex-series label:has(input:checked)').allTextContents(), orderedSix.filter((item) => groupRank(item) < 2).map((item) => item.name));
  for (const rarity of [5, 4]) {
    await page.getByLabel('图表对象星级', { exact: true }).selectOption(String(rarity));
    const names = observations.items.filter((item) => Number(item.rarity) === rarity).map((item) => item.name).sort((a, b) => a.localeCompare(b, 'zh-Hans-u-co-pinyin'));
    assert.deepEqual(await page.locator('.ex-series label').allTextContents(), names);
  }
  await page.getByLabel('图表对象星级', { exact: true }).selectOption('6');
  for (const showAllFirst of [false, true]) {
    if (showAllFirst) await page.getByRole('button', { name: '显示全部', exact: true }).click();
    for (let repeat = 0; repeat < 2; repeat++) {
      await page.getByRole('button', { name: '只看本期目标', exact: true }).click();
      assert.equal(await page.getByLabel('图表对象星级', { exact: true }).inputValue(), '6');
      assert.deepEqual(await page.locator('.ex-series label:has(input:checked)').allTextContents(), [focus.name]);
    }
  }
  await page.getByLabel('图表对象星级', { exact: true }).selectOption('all');
  await page.getByRole('button', { name: '只看本期目标', exact: true }).click();
  assert.equal(await page.getByLabel('图表对象星级', { exact: true }).inputValue(), '6');
  await focusSelect.click();
  assert.deepEqual(await page.locator('.ex-picker-group > span:first-child').allTextContents(), ['本期目标 · 六星', '池内其他限定 · 六星', '常驻 · 六星', '五星', '四星']);
  assert.equal(await page.locator('.ex-picker-option img').count(), observations.items.length);
  await page.getByRole('combobox', { name: '搜索关注对象', exact: true }).fill('no-match-zzzz');
  assert.equal(await page.locator('.ex-picker-popup').getByRole('option').count(), 0);
  assert.ok(await page.getByText('没有匹配的对象', { exact: true }).isVisible());
  await page.getByRole('combobox', { name: '搜索关注对象', exact: true }).press('Escape');
  assert.ok(await focusSelect.evaluate((element) => element === document.activeElement));
  const rows = await page.locator('.ex-coverage-row').evaluateAll((elements) => elements.map((element) => ({ name: element.querySelector('button').textContent, rate: element.querySelector('b').textContent })));
  for (const row of rows) {
    const item = observations.items.find((entry) => entry.name === row.name);
    assert.equal(row.rate, `${((observations.participatingAccounts - item.nonObtainingAccounts) / observations.participatingAccounts * 100).toFixed(1)}%`);
  }
  const interval = page.locator('[data-chart="10"]');
  await interval.getByRole('button', { name: '后续获得', exact: true }).click();
  assert.match(await interval.locator('.ex-interval-values').first().innerText(), new RegExp(`样本 ${focus.repeat.sampleCount}`));
  await interval.getByRole('button', { name: '本期首次', exact: true }).click();
  const alternate = observations.items.find((item) => item.rarity === 6 && item.itemId !== originalFocus);
  await page.locator('.ex-coverage-list').getByRole('button', { name: alternate.name, exact: true }).click();
  assert.equal(await focusSelect.getAttribute('data-value'), alternate.itemId);
  await focusSelect.press('ArrowDown');
  await page.getByRole('combobox', { name: '搜索关注对象', exact: true }).fill(focus.name);
  await page.getByRole('combobox', { name: '搜索关注对象', exact: true }).press('Enter');
  assert.equal(await focusSelect.getAttribute('data-value'), originalFocus);
  assert.ok(await focusSelect.evaluate((element) => element === document.activeElement));
  await page.getByRole('button', { name: '只看本期目标', exact: true }).click();
  assert.equal(await page.locator('.ex-series input:checked').count(), 1);
  assert.equal(await page.getByLabel('解读对象', { exact: true }).inputValue(), originalFocus);
  const cdfBefore = await page.locator('[data-chart="05"] .recharts-line-curve').getAttribute('d');
  const readoutBefore = await page.locator('[data-readout="first"]').innerText();
  const frequencyBefore = await page.locator('[data-chart="06"] .recharts-line-curve').getAttribute('d');
  await page.getByLabel('频数合并区间', { exact: true }).selectOption('20');
  assert.equal(await page.locator('[data-chart="05"] .recharts-line-curve').getAttribute('d'), cdfBefore, 'Grouping must not change the CDF');
  assert.equal(await page.locator('[data-readout="first"]').innerText(), readoutBefore);
  assert.notEqual(await page.locator('[data-chart="06"] .recharts-line-curve').getAttribute('d'), frequencyBefore);
  await page.getByLabel('起始抽数', { exact: true }).fill('10');
  await page.getByLabel('结束抽数', { exact: true }).fill('21');
  assert.equal(await page.locator('[data-readout="first"]').innerText(), readoutBefore, 'Zoom must not change readout denominators');
  await page.getByLabel('观察阈值', { exact: true }).fill('20');
  const expectedShare = orderedCosts.filter((cost) => cost <= 20).length / orderedCosts.length;
  assert.equal(await page.locator('[data-readout="first"] dd').last().innerText(), `${(expectedShare * 100).toFixed(1)}%`);
  await page.locator('.ex-series input:checked').uncheck();
  assert.equal(await page.locator('[data-readout="first"] dd').first().innerText(), '—');
  assert.equal(await page.locator('.ex-curves .ex-empty').count(), 4);
  await page.getByLabel('图表对象星级', { exact: true }).selectOption('5');
  assert.ok(await page.locator('.ex-series input:checked').count() > 0, 'Hiding six-stars must not hide other rarities');
  await page.getByLabel('图表对象星级', { exact: true }).selectOption('6');
  assert.equal(await page.locator('.ex-series input:checked').count(), 0);
  await page.getByRole('button', { name: '显示全部', exact: true }).click();
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await page.getByLabel('频数合并区间', { exact: true }).selectOption('10');
  await page.getByLabel('观察阈值', { exact: true }).fill('80');
  console.log('PASS: target portrait, exact snapshot metrics, coverage, interval toggle, focus selection, frequency grouping, zoom and hidden-series state');
  assert.equal(await page.locator('.ex-sidebar .pool-card-rail').count(), 0);
  const cards = await page.locator('.ex-sidebar [data-pool-id]').evaluateAll((elements) => elements.slice(0, 3).map((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, bottom: rect.bottom, height: rect.height };
  }));
  assert.ok(cards.length > 1);
  assert.ok(cards[1].top >= cards[0].bottom && Math.abs(cards[1].left - cards[0].left) < 2, 'Pool rows must stack vertically');
  assert.ok(cards.every((card) => card.height < 110), 'Pool rows must be compact');
  const countsResponse = await page.request.get(`${origin}/api/stats?type=pool_counts`);
  const counts = (await countsResponse.json()).data.counts;
  const countTexts = await page.locator('.ex-pool-row[data-pool-id]').evaluateAll((rows) => rows.map((row) => ({ id: row.dataset.poolId, text: row.querySelector('.ex-pool-count').textContent })));
  for (const row of countTexts) assert.ok(row.text.includes(counts[row.id].toLocaleString('zh-CN')), `Missing count for ${row.id}`);
  await page.getByRole('button', { name: '获取最新结果', exact: true }).click();
  const again = await (await page.request.get(`${origin}/api/stats?type=pool_observations&poolId=${poolId}`)).json();
  assert.equal(again.data.meta.updatedAt, payload.data.meta.updatedAt, 'Page reads must not recalculate statistics');
  for (const width of [1366, 1920, 768, 390, 360]) await layout(width);
  await page.locator('.ex-sidebar-toggle').click();
  assert.ok(await page.getByRole('region', { name: '具体卡池', exact: true }).isVisible());
  assert.equal(await page.getByLabel('首次定义', { exact: true }).count(), 0);
  assert.equal(Number((await page.getByTestId('observation-total').innerText()).replaceAll(',', '')), total);
  await page.screenshot({ path: `${output}/real-360.png`, fullPage: true });
  await page.setViewportSize({ width: 1366, height: 950 });
  await layout(1366);
  await page.screenshot({ path: `${output}/real-1366.png`, fullPage: true });
  await page.getByRole('button', { name: '理论预测', exact: true }).click();
  await page.getByLabel('保障累计', { exact: true }).fill('119');
  await page.getByLabel('预测范围', { exact: true }).fill('1');
  assert.match(await page.locator('.ex-theory .ex-meta').innerText(), /100.0%/);
  await page.getByRole('button', { name: '真实记录图表', exact: true }).click();
  await page.getByLabel('搜索卡池', { exact: true }).fill('伊冯');
  await page.locator('[data-pool-id="joint_manual_extra_reconstruction_yvonne_p1"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="observation-total"]')?.textContent === '0');
  assert.equal(await page.locator('[data-chart]').count(), 10);
  assert.equal(await page.locator('[data-insight="median"]').innerText(), '—');
  assert.doesNotMatch(await page.locator('.ex-observation-report').innerText(), /NaN|Infinity|undefined/);
  await page.getByLabel('搜索卡池', { exact: true }).fill('');
  await page.locator(`[data-pool-id="${poolId}"]`).click();
  await page.getByTestId('observation-total').waitFor();
  await page.getByRole('button', { name: '综合概览与图鉴', exact: true }).click();
  await page.getByRole('button', { name: '角色图鉴', exact: true }).waitFor();
  await page.getByRole('button', { name: '真实记录图表', exact: true }).click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('heading', { name: 'Banner detail statistics', exact: true }).waitFor();
  // Theme button in the existing main-site header.
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await layout(1366);
  await page.screenshot({ path: `${output}/real-dark-1366.png`, fullPage: true });
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.goto(`${origin}/m/stats`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: '分卡池详细统计', exact: true }).waitFor();
  await page.getByTestId('observation-total').waitFor();
  await layout(390);
  assert.deepEqual(errors, []);
  console.log('PASS: real snapshots, compact vertical rows, all pool counts, populated first charts, stable calculation timestamp, theory, empty banner and mobile');
} catch (error) {
  console.error('Page state:', (await page.locator('body').innerText()).slice(0, 1600));
  console.error('Runtime errors:', errors);
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  throw error;
} finally {
  await browser.close();
}
