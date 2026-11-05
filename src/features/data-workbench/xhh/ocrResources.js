const npmCdn = 'https://cdn.jsdelivr.net/npm';
export const OCR_RESOURCES = Object.freeze({
  sdk: `${npmCdn}/@paddleocr/paddleocr-js@0.4.2/+esm`,
  opencv: `${npmCdn}/@techstark/opencv-js@4.10.0-release.1/+esm`,
  ort: `${npmCdn}/onnxruntime-web@1.26.0/+esm`,
  wasmBase: `${npmCdn}/onnxruntime-web@1.26.0/dist/`,
  wasm: `${npmCdn}/onnxruntime-web@1.26.0/dist/ort-wasm-simd-threaded.jsep.wasm`,
});

export async function loadOcrWasm() {
  const url = OCR_RESOURCES.wasm;
  const cache = globalThis.caches ? await caches.open('workbench-xhh-models-v1').catch(() => null) : null;
  const cached = await cache?.match(url);
  try {
    const response = cached || await fetch(url, { cache: 'force-cache', signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const binary = await response.arrayBuffer();
    const header = new Uint8Array(binary, 0, Math.min(8, binary.byteLength));
    if (header.length < 8 || header[0] !== 0 || header[1] !== 97 || header[2] !== 115 || header[3] !== 109) {
      await cache?.delete(url);
      throw new Error('Invalid recognition runtime');
    }
    if (!cached) await cache?.put(url, new Response(binary, { headers: { 'Content-Type': 'application/wasm' } })).catch(() => {});
    return binary;
  } catch (error) {
    const message = error.name === 'TimeoutError'
      ? '截图识别资源下载超时，请检查网络后重试；已下载的资源会保留。'
      : '截图识别资源下载失败，请检查网络后重试；已下载的资源会保留。';
    throw new Error(message, { cause: error });
  }
}
