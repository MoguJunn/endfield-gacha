// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadOcrWasm, OCR_RESOURCES } from '../ocrResources.js';

const binary = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const setup = () => {
  const entries = new Map();
  const cache = {
    match: vi.fn(async key => entries.get(key)?.clone()),
    put: vi.fn(async (key, response) => { entries.set(key, response.clone()); }),
    delete: vi.fn(async key => entries.delete(key)),
  };
  vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue(cache) });
  const fetch = vi.fn().mockImplementation(async () => new Response(binary));
  vi.stubGlobal('fetch', fetch);
  return { cache, fetch };
};

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('screenshot recognition runtime download', () => {
  it('finishes a download longer than the SDK session timeout before returning the bytes', async () => {
    vi.useFakeTimers();
    const { cache, fetch } = setup();
    fetch.mockResolvedValueOnce({ ok: true, arrayBuffer: () => new Promise(resolve => {
      setTimeout(() => resolve(binary.buffer.slice(0)), 65000);
    }) });
    const pending = loadOcrWasm();
    await vi.advanceTimersByTimeAsync(60000);
    expect(cache.put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(new Uint8Array(await pending)).toEqual(binary);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it('reuses a completed download across separate initializations', async () => {
    const { fetch } = setup();
    await loadOcrWasm();
    expect(new Uint8Array(await loadOcrWasm())).toEqual(binary);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(OCR_RESOURCES.wasm, expect.objectContaining({ cache: 'force-cache' }));
    expect(new URL(fetch.mock.calls[0][0]).hostname).toBe('cdn.jsdelivr.net');
  });

  it('keeps interrupted responses out of the cache and allows another download', async () => {
    const { cache, fetch } = setup();
    fetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => { throw new TypeError('Failed to fetch'); } });
    await expect(loadOcrWasm()).rejects.toThrow('下载失败');
    expect(cache.put).not.toHaveBeenCalled();
    expect(new Uint8Array(await loadOcrWasm())).toEqual(binary);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects a fallback HTML page rather than storing it as a runtime', async () => {
    const { cache, fetch } = setup();
    fetch.mockResolvedValueOnce(new Response('<html>not a runtime</html>'));
    await expect(loadOcrWasm()).rejects.toThrow('下载失败');
    expect(cache.put).not.toHaveBeenCalled();
  });
});
