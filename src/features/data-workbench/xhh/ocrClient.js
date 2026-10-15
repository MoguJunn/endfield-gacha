export function createOcrClient({ workerFactory = () => new Worker(new URL('./ocr.worker.js', import.meta.url), { type: 'module' }),
  resourceBase = new URL(`${import.meta.env?.BASE_URL || '/'}ocr/xhh/`, globalThis.location?.origin || 'http://localhost').href } = {}) {
  let worker = null;
  let rejectActive = null;
  let cleanupActive = null;
  const cancel = () => {
    worker?.terminate(); worker = null;
    cleanupActive?.(); cleanupActive = null;
    rejectActive?.(Object.assign(new Error('已取消截图识别'), { name: 'AbortError' })); rejectActive = null;
  };
  const request = (type, file, { signal, onProgress } = {}) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(Object.assign(new Error('已取消截图识别'), { name: 'AbortError' })); return; }
    if (rejectActive) { reject(new Error('截图正在识别，请等待或取消后重试')); return; }
    worker ||= workerFactory();
    rejectActive = reject;
    cleanupActive = () => signal?.removeEventListener('abort', cancel);
    const finish = () => { cleanupActive?.(); cleanupActive = null; rejectActive = null; };
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') onProgress?.(data);
      if (data.type === 'result' || data.type === 'initialized') { finish(); resolve(data.result || { initialized: true }); }
      if (data.type === 'error') { finish(); worker?.terminate(); worker = null; reject(new Error(data.message)); }
    };
    worker.onerror = event => { finish(); worker?.terminate(); worker = null; reject(new Error(event.message || 'OCR 工作线程加载失败')); };
    worker.postMessage({ type, file, resourceBase });
  });
  return { recognize: (file, options) => request('recognize', file, options), initialize: options => request('initialize', null, options), cancel, dispose: cancel };
}
