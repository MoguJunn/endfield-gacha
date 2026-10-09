import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5174';
const executablePath =
  process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const errors = [];
const privateRequests = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(() => {
    localStorage.setItem('lastCaptchaVerified', String(Date.now()));
    localStorage.setItem('simulator_skipAnimation', 'true');
    sessionStorage.setItem('endfield_contributor_demo_session_v1', 'active');
  });
  const page = await context.newPage();
  page.on('crash', () => console.log('Browser page crashed'));
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.includes('/rest/v1/') ||
      url.pathname.includes('/auth/v1/') ||
      url.pathname === '/api/account-gacha-data'
    )
      privateRequests.push(`${request.method()} ${url.pathname}`);
  });
  await page.goto(`${base}/simulator`);
  await page.getByTestId('contributor-demo-banner').waitFor();
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('单次寻访') && !b.disabled),
    null,
    { timeout: 45000 }
  );
  await page.getByRole('button', { name: /^继承$/ }).click();
  await page.getByText(/已继承.+全部模拟卡池/).waitFor({ timeout: 30000 });
  const scope = 'u:demo%3Acontributor-admin|g:demo-cn-001%3A%3Aserver%3A1';
  const read = () =>
    page.evaluate(async (scopeValue) => {
      const { loadSimulatorSession } = await import('/src/features/simulator/simulatorRepository.js');
      const { getResourceLedger } = await import('/shared/simulator/engine.js');
      const result = await loadSimulatorSession(scopeValue);
      return { ...result, resourceLedger: result.session ? getResourceLedger(result.session) : null };
    }, scope);
  const inherited = await read();
  assert.equal(Object.values(inherited.histories).flat().length, 168);
  assert.equal(inherited.session.version, 2);
  assert.ok(inherited.session.inheritance);
  console.log('Demo inheritance preserves all 168 history outcomes and uses no private API.');

  // Seed a deterministic isolated browser save through the real repository, then
  // validate the unchanged UI against zero-pull/shared/book/free edge cases.
  const fixture = await page.evaluate(async (scopeValue) => {
    const { usePoolStore } = await import('/src/stores/index.js');
    const { buildSimulatorDescriptors } = await import('/src/features/simulator/simulatorSessionView.js');
    const { createSession, replayHistoryEvent } = await import('/shared/simulator/engine.js');
    const { loadSimulatorSession, commitSimulatorSession } =
      await import('/src/features/simulator/simulatorRepository.js');
    const pools = usePoolStore.getState().pools;
    const descriptors = buildSimulatorDescriptors(pools);
    const limited = Object.values(descriptors)
      .filter((d) => d.capabilities.infoBookEnabled)
      .sort((a, b) => new Date(a.pool.start_time) - new Date(b.pool.start_time));
    const a = limited[0];
    const b = limited[1];
    let session = createSession({ scope: scopeValue });
    const records = [];
    for (let index = 0; index < 60; index++) {
      const record = {
        eventId: `fixture:${index}`,
        sequenceIndex: index + 1,
        kind: 'paid',
        rarity: index === 19 ? 6 : 4,
        isUp: index === 19,
        characterName: index === 19 ? a.pool.up_character : '四星样本',
        characterId: index === 19 ? 'up-fixture' : 'four-fixture',
        timestamp: index,
      };
      session = replayHistoryEvent(session, record, a);
      records.push(record);
    }
    session.currentPoolId = b.id;
    const existing = await loadSimulatorSession(scopeValue);
    session.revision = existing.session.revision + 1;
    await commitSimulatorSession({
      scope: scopeValue,
      session,
      expectedRevision: existing.session.revision,
      replaceHistories: { [a.id]: records },
    });
    return { a: a.id, b: b.id, aName: a.pool.name, bName: b.pool.name };
  }, scope);
  await page.reload();
  await page
    .waitForFunction(() =>
      [...document.querySelectorAll('button')].some((b) => b.textContent.includes('十连') && !b.disabled)
    )
    .catch(async (error) => {
      console.log(
        'Fixture:',
        fixture,
        'Errors:',
        errors,
        'View:',
        (await page.locator('body').innerText()).slice(-1800)
      );
      throw error;
    });
  let saved = await read();
  assert.equal(saved.session.sharedPityState.sixStarPity, 40);
  assert.equal(saved.histories[fixture.b], undefined);
  const beforeJade = saved.resourceLedger.jadeSpent;
  await page.getByRole('button', { name: /情报书十连/ }).click();
  await page.waitForFunction(
    async ({ scopeValue, poolId }) => {
      const { loadSimulatorSession } = await import('/src/features/simulator/simulatorRepository.js');
      return (await loadSimulatorSession(scopeValue)).histories[poolId]?.length === 10;
    },
    { scopeValue: scope, poolId: fixture.b }
  );
  saved = await read();
  assert.equal(saved.histories[fixture.b].filter((r) => r.kind === 'info_book').length, 10);
  assert.equal(saved.resourceLedger.jadeSpent, beforeJade);
  assert.equal(saved.session.infoBooks[fixture.a].used, true);
  await page.reload();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some((b) => b.textContent.includes('单次寻访') && !b.disabled)
  );
  await page.getByRole('button', { name: /单次寻访/ }).click();
  await page.waitForFunction(
    async ({ scopeValue, poolId }) => {
      const { loadSimulatorSession } = await import('/src/features/simulator/simulatorRepository.js');
      return (await loadSimulatorSession(scopeValue)).histories[poolId]?.length === 11;
    },
    { scopeValue: scope, poolId: fixture.b }
  );
  assert.equal((await read()).histories[fixture.b].at(-1).kind, 'paid');
  console.log('Zero-pull pool restores shared progress; info-book ten is used once and charges no jade.');

  const poolButton = page.getByRole('button').filter({ hasText: fixture.aName }).first();
  await poolButton.click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some((b) => b.textContent.includes('免费十连') && !b.disabled)
  );
  const previous = await read();
  await page.getByRole('button', { name: /免费十连/ }).click();
  await page.waitForFunction(
    async ({ scopeValue, poolId }) => {
      const { loadSimulatorSession } = await import('/src/features/simulator/simulatorRepository.js');
      return (await loadSimulatorSession(scopeValue)).histories[poolId]?.length === 70;
    },
    { scopeValue: scope, poolId: fixture.a }
  );
  saved = await read();
  assert.equal(
    saved.histories[fixture.a].slice(-10).every((r) => r.kind === 'free'),
    true
  );
  assert.deepEqual(saved.session.sharedPityState, previous.session.sharedPityState);
  assert.equal(saved.resourceLedger.jadeSpent, previous.resourceLedger.jadeSpent);
  assert.equal(new Set(saved.histories[fixture.a].map((r) => r.sequenceIndex)).size, 70);
  console.log('Free ten keeps shared pity and resources unchanged and has unique display sequences.');

  await page.getByRole('button', { name: /^导出$/ }).hover();
  const exportedPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /导出为 JSON/ }).click();
  const downloaded = await exportedPromise;
  const stream = await downloaded.createReadStream();
  let json = '';
  for await (const chunk of stream) json += chunk;
  const exported = JSON.parse(json);
  assert.equal(exported.length, 70);
  assert.equal(exported.filter((r) => r.isFree).length, 10);
  assert.equal(
    exported.every((r) => r.poolId === fixture.a),
    true
  );
  const competingPage = await context.newPage();
  competingPage.on('pageerror', (error) => errors.push(error.message));
  await competingPage.goto(`${base}/simulator`);
  await competingPage.waitForFunction(() =>
    [...document.querySelectorAll('button')].some((b) => b.textContent.includes('单次寻访') && !b.disabled)
  );
  await page.getByText('跳过动画', { exact: true }).click();
  await page.getByRole('button', { name: /单次寻访/ }).click();
  assert.equal(await page.getByRole('button', { name: /单次寻访/ }).isDisabled(), true);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some((b) => b.textContent.includes('单次寻访') && !b.disabled)
  );
  assert.equal((await read()).histories[fixture.a].length, 71);
  await competingPage.getByRole('button', { name: /单次寻访/ }).click();
  await competingPage.getByText(/另一页面已更新模拟器存档/).waitFor();
  assert.equal((await read()).histories[fixture.a].length, 71);
  await competingPage.close();
  await page.getByText('跳过动画', { exact: true }).click();
  console.log('Normal animation completes after the transaction; a stale second page cannot overwrite the save.');
  await page.getByRole('button', { name: '无限资源', exact: true }).click();
  await page.waitForFunction(async (scopeValue) => {
    const { loadSimulatorSession } = await import('/src/features/simulator/simulatorRepository.js');
    return (await loadSimulatorSession(scopeValue)).session.resourceSettings.infiniteResources;
  }, scope);
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: /Single Pull/ }).waitFor();
  assert.ok(!(await page.locator('body').innerText()).includes('simulator.toast.'));
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.getByRole('button', { name: '分享', exact: true }).click();
  const imagePromise = page.waitForEvent('download', { timeout: 60000 });
  await page.getByRole('button', { name: '下载分享卡 PNG', exact: true }).click();
  const image = await imagePromise;
  assert.ok(image.suggestedFilename().endsWith('.png'));
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await page.getByRole('button', { name: '确认重置', exact: true }).click();
  await page.waitForFunction(async (scopeValue) => {
    const { loadSimulatorSession } = await import('/src/features/simulator/simulatorRepository.js');
    const state = await loadSimulatorSession(scopeValue);
    return Object.keys(state.histories).length === 0;
  }, scope);
  console.log('JSON export preserves free markers; resource controls, both languages, PNG sharing and reset passed.');
  assert.deepEqual(errors, []);
  assert.deepEqual(privateRequests, []);
  await context.close();
} finally {
  await browser.close();
}
