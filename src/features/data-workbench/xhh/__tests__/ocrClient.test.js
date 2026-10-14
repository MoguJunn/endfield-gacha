import { describe, expect, it, vi } from 'vitest';
import { createOcrClient } from '../ocrClient.js';

function fakeWorker() { return { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null }; }

describe('真实 OCR Worker 客户端合同', () => {
  it('转发图片、同源资源地址与阶段进度，返回真实 token 结构', async () => {
    const worker = fakeWorker(); const progress = vi.fn();
    const client = createOcrClient({ workerFactory: () => worker, resourceBase: 'http://localhost/ocr/xhh/' });
    const file = new Blob(['binary image']);
    const pending = client.recognize(file, { onProgress: progress });
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'recognize', file, resourceBase: 'http://localhost/ocr/xhh/' });
    worker.onmessage({ data: { type: 'progress', message: '识别分块', current: 1, total: 3 } });
    worker.onmessage({ data: { type: 'result', result: { tokens: [{ text: '68抽' }], diagnostics: { status: 'completed' } } } });
    expect((await pending).tokens[0].text).toBe('68抽');
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ current: 1, total: 3 }));
    client.dispose();
  });
  it('取消立即终止计算线程且拒绝旧任务；重试建立新线程', async () => {
    const workers = [fakeWorker(), fakeWorker()];
    const factory = vi.fn().mockReturnValueOnce(workers[0]).mockReturnValueOnce(workers[1]);
    const client = createOcrClient({ workerFactory: factory });
    const signal = new AbortController();
    const pending = client.recognize(new Blob(), { signal: signal.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    signal.abort(); await rejected;
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    const retry = client.initialize();
    workers[1].onmessage({ data: { type: 'initialized' } });
    expect(await retry).toEqual({ initialized: true });
    expect(factory).toHaveBeenCalledTimes(2);
    client.dispose();
  });
  it('模型缺失错误反馈并销毁失效线程，不静默生成空草稿', async () => {
    const worker = fakeWorker(); const client = createOcrClient({ workerFactory: () => worker });
    const pending = client.recognize(new Blob());
    worker.onmessage({ data: { type: 'error', message: '本地模型资源缺失' } });
    await expect(pending).rejects.toThrow('本地模型资源缺失');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
