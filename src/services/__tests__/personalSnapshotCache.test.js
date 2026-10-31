import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPersonalSnapshotCache, readPersonalSnapshot, waitForPersonalSnapshot } from '../personalSnapshotCache.js';
beforeEach(() => { sessionStorage.clear(); clearPersonalSnapshotCache(); });
const result = (ownerId = 'owner', count = 10) => ({ data: { count }, meta: { ownerId } });
const options = fetcher => ({ ownerId: 'owner', key: 'statistics', version: 'v1', fetcher });

describe('private versioned snapshot reuse', () => {
  it('shares reads across panels and keeps the same result object until its revision changes', async () => {
    const fetcher = vi.fn(async () => result());
    const [a,b] = await Promise.all([readPersonalSnapshot(options(fetcher)), readPersonalSnapshot(options(fetcher))]);
    expect(a).toBe(b); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await readPersonalSnapshot(options(fetcher))).toBe(a);
    await readPersonalSnapshot({ ...options(fetcher), version: 'v2' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('separates accounts/views/owners and never reuses a mismatched response', async () => {
    const fetcher = vi.fn(async () => result());
    await readPersonalSnapshot(options(fetcher));
    await readPersonalSnapshot({ ...options(fetcher), key: 'analysis:account-b:pool-p:en-US' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(readPersonalSnapshot({ ...options(fetcher), ownerId: 'other' })).rejects.toThrow('owner mismatch');
  });
  it('cannot restore results arriving after owner cache cleanup', async () => {
    let finish; const fetcher = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const pending = readPersonalSnapshot(options(fetcher));
    clearPersonalSnapshotCache(); finish(result()); await pending;
    expect(Object.keys(sessionStorage).filter(key => key.startsWith('endfield-personal-snapshot'))).toHaveLength(0);
    const fresh = vi.fn(async () => result()); await readPersonalSnapshot(options(fresh));
    expect(fresh).toHaveBeenCalledTimes(1);
  });
  it('prevents a late old revision from replacing a completed newer revision', async () => {
    let finish;
    const old = readPersonalSnapshot(options(() => new Promise(resolve => { finish = resolve; })));
    const newer = await readPersonalSnapshot({ ...options(async () => result('owner', 20)), version: 'v2' });
    finish(result()); await old;
    expect(await readPersonalSnapshot({ ...options(vi.fn()), version: 'v2' })).toBe(newer);
  });
  it('allows one panel to cancel waiting without cancelling the shared read', async () => {
    const controller = new AbortController(); let finish;
    const source = new Promise(resolve => { finish = resolve; });
    const cancelled = expect(waitForPersonalSnapshot(source, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); finish(result()); await cancelled;
    expect(await source).toEqual(result());
  });
});
