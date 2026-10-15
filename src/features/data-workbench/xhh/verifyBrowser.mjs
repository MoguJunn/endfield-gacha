// Local-only browser verification. Optional --image=<absolute _docs path> is read in place.
// No API writes, image copies, screenshots or external browser requests are made.
import http from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const xhhPath = path.join(root, 'src', 'features', 'data-workbench', 'xhh');
const publicPath = path.join(root, 'public');
const image = process.argv.find(arg => arg.startsWith('--image='))?.slice(8);
const existingOrigin = process.argv.find(arg => arg.startsWith('--origin='))?.slice(9);
const selectedPoolId = process.argv.find(arg => arg.startsWith('--pool-id='))?.slice(10);
if (existingOrigin && !['127.0.0.1', 'localhost'].includes(new URL(existingOrigin).hostname)) throw new Error('仅允许本机服务验证');
if (image && !path.resolve(image).toLowerCase().includes(`${path.sep}_docs${path.sep}`.toLowerCase())) throw new Error('真实图验证只读取工作区 _docs 下的样例路径');
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.tar': 'application/x-tar', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const requests = [];
const workerPolicy = "connect-src 'self'";
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  requests.push(url.pathname);
  res.setHeader('Content-Security-Policy', workerPolicy);
  if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><title>OCR 本地验证</title>'); return; }
  let file;
  if (url.pathname === '/sample' && image) file = image;
  else if (url.pathname.startsWith('/modules/')) file = path.resolve(xhhPath, url.pathname.slice(9));
  else if (url.pathname.startsWith('/ocr/xhh/')) file = path.resolve(publicPath, url.pathname.slice(1));
  if (!file || (url.pathname !== '/sample' && !file.startsWith(xhhPath + path.sep) && !file.startsWith(publicPath + path.sep))) { res.writeHead(404); res.end(); return; }
  try { const bytes = await readFile(file); res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); res.end(bytes); }
  catch { res.writeHead(404); res.end(); }
});
if (!existingOrigin) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = existingOrigin || `http://127.0.0.1:${server.address().port}`;
const temporaryPath = fileURLToPath(new URL('../../../../../ocr-browser-temp/', import.meta.url));
await mkdir(temporaryPath, { recursive: true });
// Playwright creates its profile from the parent Node process's os.tmpdir(), before
// starting Chromium, so relocate both the parent and child temporary directories.
process.env.TEMP = temporaryPath;
process.env.TMP = temporaryPath;
process.env.TMPDIR = temporaryPath;
const browser = await chromium.launch({ headless: true, env: { ...process.env } });
try {
  const page = await browser.newPage();
  const failures = [];
  page.on('request', request => { if (request.url().startsWith(origin)) requests.push(new URL(request.url()).pathname); });
  page.on('requestfailed', request => { if (request.url().includes('/ocr/') || request.url().includes('/xhh/')) failures.push({ url: request.url(), error: request.failure()?.errorText }); });
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (!url.startsWith(origin) || !['GET', 'HEAD'].includes(route.request().method())) { await route.abort(); return; }
    if (new URL(url).pathname.endsWith('ocr.worker.js')) {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': workerPolicy } });
      return;
    }
    await route.continue();
  });
  page.on('pageerror', error => console.error(`浏览器错误：${error.message}`));
  const mainResponse = await page.goto(existingOrigin ? `${origin}/__workbench-preview?theme=dark` : origin);
  if (existingOrigin) await page.waitForLoadState('networkidle');
  const result = await page.evaluate(async ({ origin, imageBytes, integrated, selectedPoolId }) => {
    const moduleBase = integrated ? '/src/features/data-workbench/xhh/' : '/modules/';
    const { createOcrClient } = await import(`${moduleBase}ocrClient.js`);
    const client = createOcrClient({ resourceBase: `${origin}/ocr/xhh/` });
    const progress = [];
    try {
      const initialized = await client.initialize({ onProgress: value => progress.push(value.message) });
      let blob;
      if (imageBytes) blob = new Blob([Uint8Array.from(atob(imageBytes), ch => ch.charCodeAt(0))], { type: 'image/png' });
      else {
        const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 500;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 900, 500);
        ctx.fillStyle = '#111'; ctx.font = '48px "Microsoft YaHei", sans-serif';
        ['2026年', '合计 80 抽', '垫 27 抽', '免费十连', '68抽'].forEach((text, i) => ctx.fillText(text, 50, 65 + i * 85));
        blob = await new Promise(resolve => canvas.toBlob(resolve));
      }
      const recognized = await client.recognize(blob, { onProgress: value => progress.push(value.message) });
      let semanticSummary = null;
      if (integrated && selectedPoolId) {
        // The existing local preview endpoint is read-only. Only its public catalog fields
        // enter the parser; existing account history is neither printed nor modified.
        const { pools, entities } = await (await fetch('/api/workbench-preview-account')).json();
        if (!pools?.some(pool => String(pool.id) === selectedPoolId)) throw new Error('所选池不在本地预览目录中');
        const { analyzeScreenshot } = await import(`${moduleBase}semantics.js`);
        const { addVisualCandidates } = await import(`${moduleBase}visualCandidates.js`);
        const parsed = analyzeScreenshot({ ...recognized, pools, entities, selectedPoolId });
        const visual = await addVisualCandidates(parsed, blob, { pools, entities });
        const rows = visual.segments.flatMap(segment => segment.rows);
        semanticSummary = { poolSegmentCount: visual.segments.length, recordCandidateCount: rows.length,
          freeRecordCandidateCount: rows.filter(row => row.drawMethod === 'free').length,
          batchRecordCandidateCount: rows.filter(row => row.origin === 'grid').length,
          identitySuggestionCount: rows.filter(row => row.entityId).length,
          unknownIdentityCount: rows.filter(row => !row.entityId).length,
          unconfirmedRowCount: rows.filter(row => !row.confirmed).length,
          explicitPityDetected: visual.segments.some(segment => segment.pity !== ''),
          warnings: visual.warnings,
          declaredComplete: visual.segments.some(segment => segment.complete),
          sourceRectCount: rows.filter(row => row.sourceBox && row.sourceIconBox).length };
      }
      return { initialized: initialized.initialized, texts: recognized.tokens.map(t => t.text), diagnostics: recognized.diagnostics, progress, semanticSummary,
        anchorDiagnostics: recognized.tokens.filter(token => /第.*\d|^\s*\d{1,2}\s*$/.test(token.text)).map(token => ({ label: /^第\s*\d+\s*个?\s*十.{0,2}$/.test(token.text) ? token.text : token.text.replace(/[^\d]/g, ''), box: token.box })) };
    } finally { client.dispose(); }
  }, { origin, imageBytes: image ? (await readFile(image)).toString('base64') : null, integrated: Boolean(existingOrigin), selectedPoolId });
  assert.equal(result.initialized, true, '真实 PaddleOCR 模型未初始化');
  assert.ok(result.texts.length > 0, '真实推理没有文字结果');
  assert.ok(requests.some(url => url.endsWith('.wasm')), '浏览器未加载真实本地 WASM');
  assert.ok(requests.some(url => url.endsWith('tiny_det_onnx_infer.tar')) && requests.some(url => url.endsWith('small_rec_onnx_infer.tar')), '本地模型未加载');
  assert.equal(result.diagnostics.failedTiles.length, 0, '有 OCR 分块识别失败');
  if (result.semanticSummary) {
    if (!result.semanticSummary.recordCandidateCount) console.log(JSON.stringify({ tokenCount: result.texts.length, diagnostics: result.diagnostics, semanticSummary: result.semanticSummary, anchorDiagnostics: result.anchorDiagnostics }));
    assert.ok(result.semanticSummary.recordCandidateCount > 0, '真实图语义链没有记录候选');
    assert.equal(result.semanticSummary.unconfirmedRowCount, result.semanticSummary.recordCandidateCount, '自动识别结果被误标为已确认');
    assert.equal(result.semanticSummary.declaredComplete, false, '截图被自动声明完整');
  }
  console.log(JSON.stringify({ verified: true, model: result.diagnostics.model, tokenCount: result.texts.length,
    origin, documentContentSecurityPolicy: mainResponse.headers()['content-security-policy'] || null,
    enforcedWorkerContentSecurityPolicy: workerPolicy, failedRequests: failures,
    semanticSummary: result.semanticSummary,
    texts: image ? '(真实图文字不输出)' : result.texts, wasmRequests: [...new Set(requests.filter(url => url.endsWith('.wasm')))],
    sourceWidth: result.diagnostics.sourceWidth, sourceHeight: result.diagnostics.sourceHeight }, null, 2));
} finally { await browser.close(); if (!existingOrigin) await new Promise(resolve => server.close(resolve)); }
