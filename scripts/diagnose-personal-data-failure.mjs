import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = process.env.CANDIDATE_BASE_URL || 'http://127.0.0.1:5184';
const secretPath = process.env.TEST_ACCOUNT_SECRET_PATH
  || path.resolve(repoRoot, '..', '..', 'test_account.secret');
const [email, password] = (await fs.readFile(secretPath, 'utf8'))
  .split(/\r?\n/u)
  .map((value) => value.trim())
  .filter(Boolean);

if (!email || !password) {
  throw new Error('测试账号文件缺少邮箱或密码');
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addInitScript(() => {
  localStorage.setItem('lastCaptchaVerified', String(Date.now()));
});
const page = await context.newPage();
const requests = [];
const startedRequests = new Map();
const consoleErrors = [];

page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    consoleErrors.push({ type: message.type(), text: message.text().slice(0, 500) });
  }
});
page.on('request', (request) => {
  const pathname = new URL(request.url()).pathname;
  if (pathname === '/api/account-gacha-data') {
    startedRequests.set(request, Date.now());
  }
});
page.on('response', async (response) => {
  const request = response.request();
  const startedAt = startedRequests.get(request);
  if (!startedAt) return;
  const entry = {
    method: request.method(),
    url: request.url(),
    status: response.status(),
    durationMs: Date.now() - startedAt,
    body: null,
  };
  try {
    const text = await response.text();
    entry.body = text.slice(0, 1200);
  } catch (error) {
    entry.body = `response-read-failed:${error?.message || error}`;
  }
  requests.push(entry);
});

async function readState() {
  return page.evaluate(async () => {
    const { useAuthStore, useHistoryStore, usePersonalDataStore, usePoolStore } = await import('/src/stores/index.js');
    const auth = useAuthStore.getState();
    const personal = usePersonalDataStore.getState();
    return {
      userId: auth.user?.id || null,
      userRole: auth.userRole,
      syncing: auth.syncing,
      syncError: auth.syncError,
      ownerId: personal.ownerId,
      phase: personal.phase,
      refreshing: personal.refreshing,
      hasSnapshot: personal.hasSnapshot,
      personalError: personal.error,
      historyCount: useHistoryStore.getState().history.length,
      poolCount: usePoolStore.getState().pools.length,
    };
  });
}

try {
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByTestId('desktop-app-shell').waitFor({ timeout: 30000 });
  const loginResult = await page.evaluate(async ({ loginEmail, loginPassword }) => {
    const { supabase } = await import('/src/supabaseClient.js');
    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });
    return {
      ok: !error && Boolean(data?.user?.id),
      error: error?.message || null,
    };
  }, { loginEmail: email, loginPassword: password });

  const samples = [];
  const deadline = Date.now() + 75000;
  while (Date.now() < deadline) {
    const state = await readState();
    samples.push({ atMs: 75000 - (deadline - Date.now()), ...state });
    if (!state.syncing && ['ready', 'empty', 'error'].includes(state.phase)) break;
    await page.waitForTimeout(500);
  }

  console.log(JSON.stringify({
    loginResult,
    finalState: await readState(),
    requests,
    samples: samples.filter((_, index) => index === 0 || index === samples.length - 1 || index % 5 === 0),
    consoleErrors,
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
