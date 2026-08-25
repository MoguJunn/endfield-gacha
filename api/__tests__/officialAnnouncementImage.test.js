import { afterEach, describe, expect, it, vi } from 'vitest';
import { __internal } from '../_routes/root/official-announcement-image.js';

function createResponse({
  status = 200,
  headers = {},
  body = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  stream = null,
} = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    body: stream,
    arrayBuffer: vi.fn(async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)),
  };
}

describe('official announcement image proxy boundary', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('accepts only HTTPS allowlisted upstream URLs', () => {
    expect(__internal.normalizeTargetUrl('https://web.hycdn.cn/image.webp')?.hostname).toBe('web.hycdn.cn');
    expect(__internal.normalizeTargetUrl('http://web.hycdn.cn/image.webp')).toBeNull();
    expect(__internal.normalizeTargetUrl('https://web.hycdn.cn:8443/image.webp')).toBeNull();
    expect(__internal.normalizeTargetUrl('https://127.0.0.1/image.webp')).toBeNull();
  });

  it('rejects redirects outside the allowlist before following them', async () => {
    const fetchMock = vi.fn(async () => createResponse({
      status: 302,
      headers: { location: 'https://127.0.0.1/private.png' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(__internal.fetchValidatedImage(
      __internal.normalizeTargetUrl('https://web.hycdn.cn/redirect')
    )).rejects.toThrow('unsafe_redirect');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://web.hycdn.cn/redirect',
      expect.objectContaining({ redirect: 'manual' })
    );
  });

  it('revalidates allowed redirects and accepts bounded raster images', async () => {
    const cancelRedirectBody = vi.fn(async () => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createResponse({
        status: 302,
        headers: { location: '/final.webp' },
        stream: { cancel: cancelRedirectBody },
      }))
      .mockResolvedValueOnce(createResponse({
        headers: { 'content-type': 'image/webp', 'content-length': '3' },
        body: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(__internal.fetchValidatedImage(
      __internal.normalizeTargetUrl('https://web.hycdn.cn/start')
    )).resolves.toMatchObject({ contentType: 'image/webp' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cancelRedirectBody).toHaveBeenCalledWith('redirect');
  });

  it('rejects non-images and oversized responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => createResponse({
      headers: { 'content-type': 'text/html' },
    })));
    await expect(__internal.fetchValidatedImage(
      __internal.normalizeTargetUrl('https://web.hycdn.cn/not-image')
    )).rejects.toThrow('unsupported_image_type');

    vi.stubGlobal('fetch', vi.fn(async () => createResponse({
      headers: {
        'content-type': 'image/png',
        'content-length': String(__internal.MAX_IMAGE_BYTES + 1),
      },
    })));
    await expect(__internal.fetchValidatedImage(
      __internal.normalizeTargetUrl('https://web.hycdn.cn/too-large')
    )).rejects.toThrow('image_too_large');

    vi.stubGlobal('fetch', vi.fn(async () => createResponse({
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array([1, 2, 3]),
    })));
    await expect(__internal.fetchValidatedImage(
      __internal.normalizeTargetUrl('https://web.hycdn.cn/fake-image')
    )).rejects.toThrow('invalid_image_signature');
  });

  it('stops streaming bodies as soon as the actual size exceeds the limit', async () => {
    const cancel = vi.fn(async () => undefined);
    const chunks = [
      new Uint8Array(Math.floor(__internal.MAX_IMAGE_BYTES / 2) + 1),
      new Uint8Array(Math.floor(__internal.MAX_IMAGE_BYTES / 2) + 1),
    ];
    let index = 0;
    vi.stubGlobal('fetch', vi.fn(async () => createResponse({
      headers: { 'content-type': 'image/png' },
      stream: {
        getReader: () => ({
          read: vi.fn(async () => index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true, value: undefined }),
          cancel,
        }),
      },
    })));

    await expect(__internal.fetchValidatedImage(
      __internal.normalizeTargetUrl('https://web.hycdn.cn/chunked-large')
    )).rejects.toThrow('image_too_large');
    expect(cancel).toHaveBeenCalled();
  });

  it('keeps the timeout active while reading a slow body', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => createResponse({
      headers: { 'content-type': 'image/png' },
      stream: {
        getReader: () => ({
          read: () => new Promise((_, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          }),
          cancel: vi.fn(async () => undefined),
        }),
      },
    })));

    const pending = __internal.fetchValidatedImage(
      __internal.normalizeTargetUrl('https://web.hycdn.cn/slow-image')
    );
    const rejection = expect(pending).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(16000);
    await rejection;
  });
});
