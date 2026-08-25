import assert from 'node:assert/strict';
import fs from 'node:fs';
import process from 'node:process';
import { chromium } from 'playwright';

function findBrowserExecutable() {
  const candidates = [
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function classifyDataRequest(request, baseOrigin) {
  try {
    const parsed = new URL(request.url());
    const isAllowedCatalog = request.method() === 'GET'
      && parsed.origin === 'https://ef-gacha.mogujun.icu'
      && (
        parsed.pathname === '/api/bootstrap'
        || parsed.pathname === '/api/pool-rosters'
        || parsed.pathname === '/api/stats'
      );
    if (isAllowedCatalog) return 'public-catalog';
    const isAllowedSessionCleanup = request.method() === 'POST'
      && parsed.origin === baseOrigin
      && parsed.pathname === '/api/auth/session/logout';
    if (isAllowedSessionCleanup) return 'session-cleanup';
    if (
      parsed.pathname.startsWith('/api/')
      || parsed.pathname.includes('/rest/v1/')
      || parsed.pathname.includes('/auth/v1/')
      || parsed.hostname === 'db.15963574.xyz'
    ) return 'private';
    return 'other';
  } catch {
    return 'other';
  }
}

async function run() {
  const executablePath = findBrowserExecutable();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const privateRequests = [];
  const publicCatalogRequests = [];
  const sessionCleanupRequests = [];
  const unsafeMediaRequests = [];
  const consoleErrors = [];
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';
  const baseOrigin = new URL(baseUrl).origin;

  await page.addInitScript(() => {
    localStorage.setItem('lastCaptchaVerified', Date.now().toString());
    if (!sessionStorage.getItem('contributor-sandbox-test-initialized')) {
      localStorage.removeItem('gacha_contributor_content_sandbox_v3');
      localStorage.setItem('sb-security-test-auth-token', '{"access_token":"must-be-removed"}');
      sessionStorage.setItem('contributor-sandbox-test-initialized', '1');
    }
  });

  page.on('request', (request) => {
    if (request.resourceType() === 'image') {
      const mediaUrl = new URL(request.url());
      if (![baseOrigin, 'https://ef-gacha.mogujun.icu'].includes(mediaUrl.origin)) {
        unsafeMediaRequests.push(`${request.method()} ${request.url()}`);
      }
    }
    const classification = classifyDataRequest(request, baseOrigin);
    if (classification === 'private') {
      privateRequests.push(`${request.method()} ${request.url()}`);
    } else if (classification === 'public-catalog') {
      publicCatalogRequests.push(`${request.method()} ${request.url()}`);
    } else if (classification === 'session-cleanup') {
      sessionCleanupRequests.push(`${request.method()} ${request.url()}`);
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('contributor-demo-banner').waitFor({ timeout: 15000 });
    await page.getByText(/贡献者内容沙盒 · 正式公开目录/).waitFor({ timeout: 30000 });
    await page.waitForFunction(() => document.body.textContent.includes('本地内容沙盒已启用'), null, { timeout: 15000 });

    await page.getByRole('button', { name: '登录' }).first().click();
    await page.getByTestId('contributor-demo-login-card').waitFor();
    await page.getByRole('button', { name: '填入演示账号' }).click();
    assert.equal(await page.locator('input[type="email"]').inputValue(), 'demo-admin@local.invalid');
    assert.equal(await page.locator('input[type="password"]').inputValue(), 'frontend-demo');
    await page.locator('form').getByRole('button', { name: '登录', exact: true }).click();

    await page.getByText('SUPER-ENDMIN').waitFor({ timeout: 15000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('sb-security-test-auth-token')), null, '登录沙盒时应清除残留 Supabase token');
    await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('contributor-demo-banner').waitFor();
    await page.waitForFunction(() => document.body.textContent.includes('抽数') || document.body.textContent.includes('寻访'), null, { timeout: 15000 });
    assert.equal((await page.locator('body').innerText()).includes('余烬回响'), false, '不应继续出现旧虚构卡池');

    await page.goto(`${baseUrl}/summary`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.textContent.includes('128,640'), null, { timeout: 15000 });

    await page.goto(`${baseUrl}/admin`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('contributor-demo-admin-panel').waitFor({ timeout: 15000 });
    await page.getByText('LIVE CATALOG').waitFor();
    await page.getByRole('button', { name: /卡池与版本/ }).click();
    await page.getByRole('button', { name: /新增卡池/ }).waitFor();
    await page.getByText('点绘申领').first().waitFor();

    await page.getByRole('button', { name: /公告管理/ }).click();
    await page.getByRole('button', { name: '新建公告' }).click();
    await page.getByPlaceholder('公告标题').fill('Playwright 本地公告');
    await page.getByPlaceholder('输入中文公告内容，支持 Markdown。').fill('这条公告只保存在浏览器沙盒。');
    await page.getByRole('button', { name: '保存' }).click();
    await page.getByText('Playwright 本地公告').waitFor();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('contributor-demo-admin-panel').waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: /公告管理/ }).click();
    await page.getByText('Playwright 本地公告').waitFor({ timeout: 15000 });

    assert.ok(publicCatalogRequests.length >= 4, '应通过正式站公共 GET 接口读取真实目录与阵容');
    assert.ok(sessionCleanupRequests.length >= 1, '激活沙盒前应通过同源 logout 清除残留 HttpOnly 会话');
    assert.deepEqual(privateRequests, [], `沙盒不应请求私有 API、Supabase 或真实写入：${privateRequests.join(' | ')}`);
    assert.deepEqual(unsafeMediaRequests, [], `沙盒不应加载未批准主机的图片：${unsafeMediaRequests.join(' | ')}`);
    const relevantConsoleErrors = consoleErrors.filter((message) => !message.includes('favicon.ico'));
    assert.deepEqual(relevantConsoleErrors, [], `演示模式存在控制台错误：${relevantConsoleErrors.join(' | ')}`);
    console.log('Contributor content sandbox Playwright verification passed');
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
