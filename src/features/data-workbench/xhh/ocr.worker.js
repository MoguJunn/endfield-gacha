/* eslint-disable no-await-in-loop -- OCR tiles run sequentially to bound model memory and report progress. */
import { buildTilePlan, dedupeOcrTokens, mapOcrItemsToTokens, normalizeOcrBox } from './tokens.js';

let enginePromise;
let imageDataToMat;
const progress = data => self.postMessage({ type: 'progress', ...data });

async function cachedModel(url) {
  const cache = globalThis.caches ? await caches.open('workbench-xhh-models-v1').catch(() => null) : null;
  let response = await cache?.match(url);
  if (!response) {
    response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error('截图识别资源暂不可用，请刷新后重试或改用问卷填写。');
    if ((response.headers.get('content-type') || '').includes('text/html')) throw new Error('未能加载截图识别资源，请刷新后重试或改用问卷填写。');
    await cache?.put(url, response.clone()).catch(() => {});
  }
  return response;
}

async function initialize(resourceBase) {
  if (!enginePromise) enginePromise = (async () => {
    progress({ message: '加载本地 OCR 引擎与模型；首次加载稍久', current: 0, total: 1 });
    const sdk = await import(/* @vite-ignore */ `${resourceBase}paddleocr.mjs`);
    const { PaddleOCR } = sdk;
    imageDataToMat = sdk.imageDataToMat;
    const engine = await PaddleOCR.create({
      textDetectionModelName: 'PP-OCRv6_tiny_det', textDetectionModelAsset: { url: `${resourceBase}PP-OCRv6_tiny_det_onnx_infer.tar` },
      textRecognitionModelName: 'PP-OCRv6_small_rec', textRecognitionModelAsset: { url: `${resourceBase}PP-OCRv6_small_rec_onnx_infer.tar` },
      // Use the SDK's supported fetch hook so CacheStorage returns a Response for the
      // original same-origin model URL. connect-src 'self' does not permit blob fetches.
      fetch: cachedModel,
      textDetectionBatchSize: 1, textRecognitionBatchSize: 6,
      ortOptions: { backend: 'wasm', wasmPaths: `${resourceBase}wasm/`, numThreads: 1, proxy: false },
    });
    progress({ message: '本地 OCR 模型初始化完成', initialized: true, current: 1, total: 1 });
    return engine;
  })().catch(error => { enginePromise = null; throw error; });
  return enginePromise;
}

self.onmessage = async ({ data }) => {
  try {
    const engine = await initialize(data.resourceBase);
    if (data.type === 'initialize') { self.postMessage({ type: 'initialized' }); return; }
    const image = await createImageBitmap(data.file);
    try {
      const plan = buildTilePlan(image.width, image.height);
      const raw = [];
      const failedTiles = [];
      for (let index = 0; index < plan.tiles.length; index += 1) {
        const tile = plan.tiles[index];
        progress({ message: `识别截图分块 ${index + 1} / ${plan.tiles.length}`, current: index, total: plan.tiles.length });
        const canvas = new OffscreenCanvas(Math.round(tile.work.width), Math.round(tile.work.height));
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, tile.source.x, tile.source.y, tile.source.width, tile.source.height, 0, 0, canvas.width, canvas.height);
        let mat;
        try {
          // SDK's main-thread Blob adapter uses document. Pass a cv.Mat as its supported
          // input instead, exactly as its worker platform converts OffscreenCanvas pixels.
          mat = await imageDataToMat(ctx.getImageData(0, 0, canvas.width, canvas.height));
          const [result] = await engine.predict(mat, { textDetLimitSideLen: 736, textDetLimitType: 'min', textRecScoreThresh: 0.1 });
          raw.push(...mapOcrItemsToTokens(result?.items || [], tile, plan));
        } catch (error) { failedTiles.push({ tileId: tile.id, message: error.message }); }
        finally { mat?.delete(); }
        canvas.width = 1; canvas.height = 1;
        progress({ message: `已识别 ${index + 1} / ${plan.tiles.length} 个分块`, current: index + 1, total: plan.tiles.length });
      }
      if (failedTiles.length === plan.tiles.length) throw new Error(`截图识别失败：${failedTiles[0]?.message || '没有识别结果'}`);
      // Full-image detection often misses tiny quantity badges. Only revisit the
      // grid to the left of a recognized claim label, at original resolution.
      const batches = dedupeOcrTokens(raw).filter(token => /第\s*\d+\s*个?\s*十[连連]/u.test(token.text)).slice(0, 80);
      for (let index = 0; index < batches.length; index++) {
        const anchor = batches[index].sourceBox;
        const source = { x: 0, y: Math.max(0, anchor.y - anchor.height * 2.5), width: Math.max(1, anchor.x), height: 0 };
        source.height = Math.min(image.height - source.y, anchor.y + anchor.height * 1.5 - source.y);
        if (source.width < 30 || source.height < 15) continue;
        const zoom = Math.min(3, 1800 / source.width);
        const canvas = new OffscreenCanvas(Math.round(source.width * zoom), Math.round(source.height * zoom));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height);
        // White digits on dark corner badges need contrast independent of the image artwork.
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let at = 0; at < pixels.data.length; at += 4) {
          const luminance = (pixels.data[at] * 0.299 + pixels.data[at + 1] * 0.587 + pixels.data[at + 2] * 0.114);
          const mono = luminance > 185 ? 0 : 255;
          pixels.data[at] = pixels.data[at + 1] = pixels.data[at + 2] = mono;
        }
        ctx.putImageData(pixels, 0, 0);
        progress({ message: `补充识别武器方格角标 ${index + 1} / ${batches.length}`, current: index, total: batches.length });
        let mat;
        try {
          mat = await imageDataToMat(ctx.getImageData(0, 0, canvas.width, canvas.height));
          const [result] = await engine.predict(mat, { textDetLimitSideLen: 1800, textDetLimitType: 'max', textDetThresh: 0.1, textDetBoxThresh: 0.2, textDetUnclipRatio: 2, textRecScoreThresh: 0.1 });
          for (const [at, item] of (result?.items || []).entries()) {
            const local = normalizeOcrBox(item);
            const text = String(item.text || item.recText || '').trim();
            if (!local || !text) continue;
            const sourceBox = { x: source.x + local.x / zoom, y: source.y + local.y / zoom, width: local.width / zoom, height: local.height / zoom };
            raw.push({ id: `claim-${index}-${at}`, text, normalizedText: text.replace(/\s/gu, '').toLowerCase(), confidence: Number(item.score ?? item.confidence ?? 0), sourceBox,
              box: Object.fromEntries(Object.entries(sourceBox).map(([key, value]) => [key, value * plan.scale])), tileIds: [`claim-${index}`], conflicts: [] });
          }
        } catch (error) { failedTiles.push({ tileId: `claim-${index}`, message: error.message }); }
        finally { mat?.delete(); canvas.width = 1; canvas.height = 1; }
      }
      self.postMessage({ type: 'result', result: { tokens: dedupeOcrTokens(raw), diagnostics: { ...plan, tiles: undefined,
        model: 'PP-OCRv6_tiny_det+small_rec', failedTiles, status: failedTiles.length ? 'partial' : 'completed' } } });
    } finally { image.close(); }
  } catch (error) { self.postMessage({ type: 'error', message: error?.message || 'OCR 识别失败' }); }
};
