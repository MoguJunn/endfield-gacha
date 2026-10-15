import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const origin = process.env.WORKBENCH_REVISION_ORIGIN || 'http://127.0.0.1:5189';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/data-workbench');
  await page.locator('.wb-timeline-card--history').first().waitFor();
  await page.locator('.wb-pool-sidebar [data-pool-id="standard"]').click();
  await page.locator('.wb-timeline-card--history').first().waitFor();
  const account = page.getByRole('combobox', { name: '补录所属账号与区服' });
  const [gameUid, serverScope] = JSON.parse(await account.inputValue());
  const readContext = async () => (await fetch(`${origin}/api/data-workbench?${new URLSearchParams({ gameUid, serverScope, includeHistory: '1' })}`)).json();
  const edit = async seconds => {
    await page.locator('.wb-timeline-card--history .wb-row-edit').first().click();
    const editor = page.getByRole('dialog', { name: '修改原有明细', exact: true });
    const time = editor.getByLabel('准确时间');
    const before = await time.inputValue();
    const date = new Date(before); date.setSeconds(date.getSeconds() + seconds);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
    await time.fill(local);
    await editor.getByLabel('修改原因').fill('本机真实账号预览：验证增量版本与撤回，线上记录不变');
    await editor.getByRole('button', { name: '返回卡片核对', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '修改记录', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '规则验证', exact: true }).click();
    await page.getByRole('region', { name: '规则验证结果' }).waitFor();
    const warnings = page.getByRole('region', { name: '规则验证结果' }).getByRole('checkbox');
    if (await warnings.count()) await warnings.check();
    if (await page.getByRole('button', { name: '保存导入／修改', exact: true }).isDisabled()) {
      throw new Error(await page.getByRole('region', { name: '规则验证结果' }).innerText());
    }
    await page.getByRole('button', { name: '保存导入／修改', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '导入／修改已整体保存' }).waitFor();
    return { before: new Date(before).getTime(), after: date.getTime() };
  };
  const show = async count => {
    await page.getByRole('button', { name: '修改记录', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '修改记录与撤回', exact: true });
    await dialog.getByRole('button', { name: `查看撤回最近 ${count} 次`, exact: true }).click();
    await dialog.getByRole('region', { name: '撤回影响预览' }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: '确认撤回', exact: true }).isDisabled(), true);
    return dialog;
  };
  const confirm = async dialog => {
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: '确认撤回', exact: true }).click();
    await dialog.getByRole('status').filter({ hasText: '已撤回' }).waitFor();
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  };
  const initial = await readContext();
  const first = await edit(1);
  const changed = await readContext();
  const record = changed.history.find(row => initial.history.find(original => original.record_id === row.record_id)?.timestamp !== row.timestamp);
  assert.ok(record); assert.equal(new Date(record.timestamp).getTime(), first.after);
  // The editor shows seconds; compare reverts with the original stored timestamp, including milliseconds.
  first.before = new Date(initial.history.find(row => row.record_id === record.record_id).timestamp).getTime();
  let dialog = await show(1);
  assert.ok((await dialog.getByRole('region', { name: '撤回影响预览' }).innerText()).includes('还原修改内容：1 条'));
  await page.screenshot({ path: fileURLToPath(new URL('../../_tmp/workbench-revisions-preview.png', import.meta.url)) });
  await confirm(dialog);
  const reverted = await readContext();
  assert.equal(new Date(reverted.history.find(row => row.record_id === record.record_id).timestamp).getTime(), first.before);
  assert.ok(reverted.history.filter(row => row.pool_id === record.pool_id).every(row => row.statistics_excluded === true));
  dialog = await show(1); await confirm(dialog);
  assert.equal(new Date((await readContext()).history.find(row => row.record_id === record.record_id).timestamp).getTime(), first.after);
  await edit(2); await edit(3);
  dialog = await show(2); await confirm(dialog);
  assert.equal(new Date((await readContext()).history.find(row => row.record_id === record.record_id).timestamp).getTime(), first.after);
  const versionData = await (await fetch(origin + '/api/data-workbench?mode=revisions')).json();
  assert.equal(versionData.versions.length, 5);
  await page.reload(); await page.locator('.wb-timeline-card--history').first().waitFor();
  assert.equal(new Date((await readContext()).history.find(row => row.record_id === record.record_id).timestamp).getTime(), first.after);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '/m/data-workbench');
  await page.getByRole('button', { name: /进入移动版（推荐）/ }).click();
  await page.getByRole('button', { name: '修改记录', exact: true }).click();
  const mobileDialog = page.getByRole('dialog', { name: '修改记录与撤回', exact: true });
  await mobileDialog.getByRole('button', { name: '查看撤回最近 1 次', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: fileURLToPath(new URL('../../_tmp/workbench-revisions-mobile.png', import.meta.url)) });
  assert.deepEqual(errors, []);
  console.log('真实账号页面：保存、确认前禁用、撤回、撤回的恢复、连续两次撤回、刷新保留、最近五次和手机界面全部通过。');
} finally { await browser.close(); }
