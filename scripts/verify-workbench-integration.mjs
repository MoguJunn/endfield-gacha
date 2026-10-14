import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { buildWorkbenchConversionTemplate } from '../src/features/data-workbench/importConvertPrompt.js';
const origin = process.env.WORKBENCH_INTEGRATION_ORIGIN || 'http://127.0.0.1:5186';
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, viewport, route] of [
    ['desktop', { width: 1366, height: 900 }, '/data-workbench'],
    ['mobile', { width: 390, height: 844 }, '/m/data-workbench'],
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = []; const remote = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', req => { if (/^https?:/u.test(req.url()) && new URL(req.url()).origin !== origin && !req.url().includes('/avatars/')) remote.push(req.url()); });
    await page.goto(origin + route);
    if (name === 'mobile') await page.getByRole('button', { name: /进入移动版（推荐）/ }).click();
    await page.getByRole('heading', { name: '手动导入／修改', exact: true }).waitFor({ timeout: 20000 });
    await page.getByRole('combobox', { name: '补录所属账号与区服' }).waitFor({ timeout: 20000 });
    await page.locator('.wb-history-row, .wb-timeline-card--history').first().waitFor({ timeout: 20000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: fileURLToPath(new URL(`../../_tmp/workbench-main-${name}.png`, import.meta.url)), fullPage: true });
    const account = page.getByRole('combobox', { name: '补录所属账号与区服' });
    const scope = { gameUid: `DEMO-TEST-${name}-${Date.now()}`, serverScope: '1' };
    await account.selectOption('new');
    const newAccount = page.getByRole('dialog', { name: '添加游戏账号', exact: true });
    await newAccount.getByLabel('游戏 UID', { exact: true }).fill(scope.gameUid);
    await newAccount.getByRole('combobox').selectOption('1');
    await newAccount.getByRole('button', { name: '确认账号与区服', exact: true }).click();
    try { await page.getByRole('button', { name: /转换其他平台文件/ }).waitFor({ timeout: 2000 }); }
    catch { await page.getByRole('button', { name: '开始导入／修改', exact: true }).click(); }
    await page.getByRole('button', { name: /转换其他平台文件/ }).click();
    const conversion = page.getByRole('dialog', { name: '转换其他格式的记录', exact: true });
    const data = await (await fetch(origin + '/__workbench-initial')).json();
    const template = buildWorkbenchConversionTemplate({ scope, pools: data.pools, entities: data.entities, selectedPoolId: 'standard' });
    delete template._conversionGuide;
    template.supplements.workbenchEntries = [{ entryId: crypto.randomUUID(), draftId: crypto.randomUUID(), kind: 'pool-ledger', poolId: 'standard', source: 'file', derivation: 'declared', scope,
      values: { drawMethod: 'normal', coverageMode: 'pool', totalPulls: name === 'desktop' ? 20 : 30, fiveStarCount: 2, sixStarCount: 1, complete: false, acquisitions: [] } }];
    await conversion.getByLabel('或粘贴转换后的 JSON').fill(JSON.stringify(template));
    await conversion.getByRole('button', { name: '检查转换内容', exact: true }).click();
    await conversion.getByRole('button', { name: '加入本次草稿', exact: true }).click();
    await page.getByRole('button', { name: '规则验证', exact: true }).click();
    await page.getByRole('region', { name: '规则验证结果' }).getByRole('checkbox').check();
    await page.getByRole('button', { name: '保存导入／修改', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '导入／修改已整体保存' }).waitFor();
    if (name === 'desktop') {
      await page.getByRole('button', { name: '开始导入／修改', exact: true }).click();
      await page.getByRole('button', { name: /小黑盒截图识别/ }).click();
      const screenshot = page.getByRole('dialog', { name: '小黑盒截图识别', exact: true });
      await screenshot.getByRole('combobox', { name: '截图的卡池类型', exact: true }).click();
      await screenshot.getByRole('option', { name: '武器池', exact: true }).click();
      await screenshot.getByLabel('选择小黑盒截图').setInputFiles(fileURLToPath(new URL('../../_docs/小黑盒/改版对照-20260919/sample5-weapon.jpg', import.meta.url)));
      await screenshot.getByRole('button', { name: '开始识别', exact: true }).click();
      await screenshot.getByRole('status').filter({ hasText: /识别完成：/ }).waitFor({ timeout: 120000 });
      assert.equal(await screenshot.locator('.xhh-row').count(), 8);
      const corrections = screenshot.locator('.xhh-corrections'); const box = await corrections.boundingBox();
      await page.mouse.move(box.x + 8, box.y + box.height / 2); await page.mouse.wheel(0, 350);
      await page.waitForFunction(() => document.querySelector('.xhh-corrections').scrollTop > 0);
      assert.equal(await screenshot.locator('.wb-dialog-content').evaluate(el => el.scrollTop), 0);
      await page.screenshot({ path: fileURLToPath(new URL('../../_tmp/workbench-main-ocr.png', import.meta.url)), fullPage: true });
    }
    assert.deepEqual(errors, []); assert.deepEqual(remote, []);
    console.log(JSON.stringify({ name, passed: true, localSave: true, screenshotScroll: name === 'desktop', errors, remote }));
    await page.close();
  }
} finally { await browser.close(); }
