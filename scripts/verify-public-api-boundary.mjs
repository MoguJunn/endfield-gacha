import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { getApiRouteHandler } from '../api/_routes/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distRoot = path.join(projectRoot, 'dist');
const HOST = '127.0.0.1';
const BLOCKED_PUBLIC_HOST_PATTERNS = [
  /db\.15963574\.xyz/i,
  /\.supabase\.co/i,
];
const BLOCKED_PUBLIC_PATH_PATTERNS = [
  /\/rest\/v1\//i,
  /\/rpc\//i,
];

function loadEnvFile(filePath) {
  return fs.readFile(filePath, 'utf8')
    .then((content) => {
      content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .forEach((line) => {
          const separatorIndex = line.indexOf('=');
          const key = line.slice(0, separatorIndex).trim();
          const rawValue = line.slice(separatorIndex + 1).trim();
          const value = rawValue.replace(/^(['"])(.*)\1$/, '$2');
          if (!process.env[key]) {
            process.env[key] = value;
          }
        });
    })
    .catch(() => {});
}

async function ensureEnvLoaded() {
  await loadEnvFile(path.join(projectRoot, 'backend', '.env.local'));
  await loadEnvFile(path.join(projectRoot, 'backend', '.env'));
  await loadEnvFile(path.join(projectRoot, '.env.local'));
  await loadEnvFile(path.join(projectRoot, '.env'));
}

async function ensureDistExists() {
  const indexPath = path.join(distRoot, 'index.html');
  try {
    await fs.access(indexPath);
  } catch {
    throw new Error('dist/index.html 不存在，请先运行 npm run build');
  }
}

function augmentResponse(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };

  res.json = (payload) => {
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify(payload));
    return res;
  };

  return res;
}

function normalizePath(url) {
  const pathname = new URL(url || '/', `http://${HOST}`).pathname;
  return pathname === '/' ? pathname : pathname.replace(/\/+$/, '');
}

function readQuery(url) {
  return Object.fromEntries(new URL(url || '/', `http://${HOST}`).searchParams.entries());
}

function getContentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg';
  if (filePath.endsWith('.svg')) return 'image/svg+xml; charset=utf-8';
  if (filePath.endsWith('.ico')) return 'image/x-icon';
  if (filePath.endsWith('.woff2')) return 'font/woff2';
  return 'application/octet-stream';
}

function serveVercelObservabilityStub(req, res, requestPath) {
  if (!requestPath.startsWith('/_vercel/insights') && !requestPath.startsWith('/_vercel/speed-insights')) {
    return false;
  }

  if (requestPath.endsWith('/script.js') || requestPath.endsWith('script.js')) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.end(';');
    return true;
  }

  if (req.method === 'POST' || req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  res.statusCode = 404;
  res.end('Not found');
  return true;
}

async function serveStatic(res, requestPath) {
  const relativePath = requestPath === '/' ? '/index.html' : requestPath;
  const resolvedPath = path.normalize(path.join(distRoot, relativePath));

  if (!resolvedPath.startsWith(distRoot)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  try {
    const file = await fs.readFile(resolvedPath);
    res.statusCode = 200;
    res.setHeader('Content-Type', getContentType(resolvedPath));
    res.end(file);
    return;
  } catch {
    const indexHtml = await fs.readFile(path.join(distRoot, 'index.html'));
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(indexHtml);
  }
}

async function startTestServer() {
  await ensureEnvLoaded();
  await ensureDistExists();

  const server = http.createServer(async (req, rawRes) => {
    const res = augmentResponse(rawRes);
    const requestPath = normalizePath(req.url);
    if (serveVercelObservabilityStub(req, res, requestPath)) {
      return;
    }

    const handler = getApiRouteHandler(requestPath);

    if (handler) {
      req.query = readQuery(req.url);
      req.path = requestPath;
      req.body = {};
      await handler(req, res);
      return;
    }

    await serveStatic(res, requestPath);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('测试服务器未返回有效监听端口');
  }

  return {
    server,
    baseUrl: `http://${HOST}:${address.port}`,
  };
}

function isBlockedPublicRequest(url) {
  try {
    const parsed = new URL(url);
    const hostBlocked = BLOCKED_PUBLIC_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname));
    if (hostBlocked) return true;
    return BLOCKED_PUBLIC_PATH_PATTERNS.some((pattern) => pattern.test(parsed.pathname));
  } catch {
    return BLOCKED_PUBLIC_HOST_PATTERNS.some((pattern) => pattern.test(url));
  }
}

async function visitPublicEntry(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
}

async function verify() {
  const { server, baseUrl } = await startTestServer();
  let browser;
  const requestUrls = [];
  const consoleErrors = [];

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addInitScript(() => {
      window.localStorage.setItem('lastCaptchaVerified', Date.now().toString());
      window.localStorage.setItem('gacha_lastCaptchaVerified', Date.now().toString());
    });

    const page = await context.newPage();
    page.on('request', (request) => {
      requestUrls.push(request.url());
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    await visitPublicEntry(page, `${baseUrl}/`);
    await visitPublicEntry(page, `${baseUrl}/m`);

    const blockedRequests = requestUrls.filter(isBlockedPublicRequest);
    if (blockedRequests.length > 0) {
      throw new Error(`公共首屏仍存在浏览器直连数据库请求: ${blockedRequests.join(', ')}`);
    }

    const sameOriginApiRequests = requestUrls.filter((url) => url.startsWith(`${baseUrl}/api/`));
    if (!sameOriginApiRequests.some((url) => url.includes('/api/bootstrap'))) {
      throw new Error('公共首屏未请求 /api/bootstrap');
    }

    return {
      checkedRoutes: ['/', '/m'],
      sameOriginApiRequestCount: sameOriginApiRequests.length,
      sameOriginApiSamples: sameOriginApiRequests.slice(0, 12).map((url) => url.replace(baseUrl, '')),
      consoleErrorCount: consoleErrors.length,
      consoleErrorSamples: consoleErrors.slice(0, 5),
    };
  } finally {
    if (browser) {
      await browser.close();
    }
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

verify()
  .then((result) => {
    console.log('[verify-public-api-boundary] PASS');
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error('[verify-public-api-boundary] FAIL');
    console.error(error);
    process.exitCode = 1;
  });
