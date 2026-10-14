import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const inspect = process.argv.includes('--inspect');
const browser = await chromium.launch();
try {
  for (const [name, viewport, route] of [
    ['desktop', { width: 1366, height: 900 }, '/data-workbench'],
    ['mobile', { width: 390, height: 844 }, '/m/data-workbench'],
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:5186${route}`);
    if (name === 'mobile') await page.getByRole('button', { name: /进入移动版（推荐）/ }).click();
    await page.locator('.wb-overview strong').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    for (const dark of [false, true]) {
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
      const report = [];
      for (const selector of ['.wb-page-header h1', '.wb-overview strong', '.wb-pool-sidebar .ex-pool-count', '.wb-button']) {
        const style = await page.locator(selector).first().evaluate(el => {
          const s = getComputedStyle(el), root = getComputedStyle(document.documentElement);
          return { family: s.fontFamily, weight: s.fontWeight, radius: s.borderRadius, color: s.color,
            mainFamily: root.getPropertyValue('--font-sans').trim(), numberFamily: root.getPropertyValue('--font-number').trim() };
        });
        const { root } = await cdp.send('DOM.getDocument');
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
        const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
        report.push({ selector, ...style, fonts });
        if (!inspect) {
          assert.ok(style.family.includes('Novecento Sans Wide Digits App'), `${selector} 必须继承主站字体`);
          if (await page.locator(selector).first().isVisible()) assert.ok(fonts.some(font => font.isCustomFont), `${selector} 不应回退系统字体`);
          if (selector === '.wb-button') assert.equal(style.radius, '0px');
          if (selector === '.wb-overview strong') assert.ok(fonts.some(font => font.familyName.includes('Novecento')));
        }
      }
      if (!inspect) {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: fileURLToPath(new URL(`../../_tmp/workbench-fonts-${name}-${dark ? 'dark' : 'light'}.png`, import.meta.url)), fullPage: true });
      }
      console.log(JSON.stringify(inspect ? { name, dark, report, errors } : { name, dark, passed: true,
        overviewFonts: report.find(item => item.selector === '.wb-overview strong').fonts.map(font => font.familyName), errors }));
    }
    if (!inspect) {
      await page.getByRole('button', { name: '选择导入方式', exact: true }).click();
      const chooser = page.getByRole('dialog', { name: '选择导入方式', exact: true });
      await chooser.waitFor();
      assert.equal(await chooser.evaluate(el => getComputedStyle(el).borderRadius), '0px');
      assert.ok((await chooser.evaluate(el => getComputedStyle(el).fontFamily)).includes('Harmony Sans App'));
      await chooser.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      await page.getByRole('button', { name: '开始导入／修改', exact: true }).click();
      await page.getByRole('button', { name: /逐卡池问卷/ }).click();
      const dialog = page.getByRole('dialog', { name: /通过问卷.*记录/ });
      await dialog.waitFor();
      const style = await dialog.evaluate(el => { const s = getComputedStyle(el); return { family: s.fontFamily, radius: s.borderRadius }; });
      assert.ok(style.family.includes('Novecento Sans Wide Digits App'), 'portal 弹窗必须使用主站字体');
      assert.deepEqual(errors, []);
    }
    await page.close();
  }
} finally { await browser.close(); }
