// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithNetworkRetry } from '../../backend/lib/networkFetch.js';

const networkError = code => Object.assign(new Error(code), { code });
const observe = promise => promise.then(value => ({ value }), error => ({ error }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('shared fetch retry and cancellation', () => {
  it.each(['GET', 'HEAD'])('retries a safe %s after a connection reset', async method => {
    const fetchFn = vi.fn().mockRejectedValueOnce(networkError('ECONNRESET')).mockResolvedValueOnce({ ok: true });
    const result = fetchWithNetworkRetry('https://example.test', { method }, { fetchFn, baseDelayMs: 5 });
    await vi.advanceTimersByTimeAsync(5);
    await expect(result).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_BODY_TIMEOUT'])('does not replay a POST after %s', async code => {
    const fetchFn = vi.fn().mockRejectedValue(networkError(code));
    await expect(fetchWithNetworkRetry(new Request('https://example.test', { method: 'POST' }), undefined, { fetchFn }))
      .rejects.toMatchObject({ code });
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries a write only when the connection was refused before sending', async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(networkError('ECONNREFUSED')).mockResolvedValueOnce({ ok: true });
    const result = fetchWithNetworkRetry('https://example.test', { method: 'POST' }, { fetchFn, baseDelayMs: 5 });
    await vi.advanceTimersByTimeAsync(5);
    await expect(result).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('cancels a retry wait without issuing another request', async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn().mockRejectedValue(networkError('ECONNRESET'));
    const result = observe(fetchWithNetworkRetry('https://example.test', { signal: controller.signal }, { fetchFn, baseDelayMs: 1000 }));
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect((await result).error.name).toBe('AbortError');
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the total timeout active while reading a stalled body without repeating the POST', async () => {
    const cancel = vi.fn();
    const fetchFn = vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const response = await fetchWithNetworkRetry('https://example.test', { method: 'POST' }, { fetchFn, timeoutMs: 40 });
    const reading = observe(response.text());
    await vi.advanceTimersByTimeAsync(40);
    expect((await reading).error).toMatchObject({ name: 'TimeoutError', code: 'ETIMEDOUT' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves response metadata and native body methods and releases the deadline on completion', async () => {
    const original = new Response('{"ok":true}', { status: 201, headers: { 'content-type': 'application/json' } });
    Object.defineProperties(original, { url: { value: 'https://example.test/result' }, redirected: { value: true } });
    const response = await fetchWithNetworkRetry('https://example.test', {}, { fetchFn: vi.fn().mockResolvedValue(original) });
    expect(response).toMatchObject({ status: 201, url: original.url, redirected: true });
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});
