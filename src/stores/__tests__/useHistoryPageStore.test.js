import { beforeEach, describe, expect, it } from 'vitest';
import useHistoryPageStore, { createHistoryPageInitialState } from '../useHistoryPageStore.js';

describe('useHistoryPageStore', () => {
  beforeEach(() => {
    useHistoryPageStore.setState(createHistoryPageInitialState());
  });

  it('拒绝 owner 或 scope 切换前的旧响应落地', () => {
    const firstToken = useHistoryPageStore.getState().begin({
      ownerId: 'owner-1',
      scopeKey: 'scope-1',
      reset: true,
    });
    const secondToken = useHistoryPageStore.getState().begin({
      ownerId: 'owner-2',
      scopeKey: 'scope-2',
      reset: true,
    });

    expect(useHistoryPageStore.getState().complete(firstToken, {
      nextCursor: 'stale',
      hasMore: true,
      total: 999,
    })).toBe(false);
    expect(useHistoryPageStore.getState().complete(secondToken, {
      nextCursor: null,
      hasMore: false,
      total: null,
      revision: 'rev-2',
    })).toBe(true);
    expect(useHistoryPageStore.getState()).toMatchObject({
      ownerId: 'owner-2',
      scopeKey: 'scope-2',
      phase: 'ready',
      total: null,
      revision: 'rev-2',
    });
  });

  it('invalidate 提升 generation 并使在途 token 失效', () => {
    const token = useHistoryPageStore.getState().begin({
      ownerId: 'owner-1',
      scopeKey: 'scope-1',
      reset: true,
    });
    const generation = useHistoryPageStore.getState().generation;

    useHistoryPageStore.getState().invalidate('history_mutation');

    expect(useHistoryPageStore.getState()).toMatchObject({
      phase: 'unloaded',
      generation: generation + 1,
      reason: 'history_mutation',
    });
    expect(useHistoryPageStore.getState().fail(token, new Error('late'))).toBe(false);
  });

  it('后续页未返回 total 时保留第一页总数', () => {
    const firstToken = useHistoryPageStore.getState().begin({
      ownerId: 'owner-1',
      scopeKey: 'scope-1',
      reset: true,
    });
    useHistoryPageStore.getState().complete(firstToken, {
      nextCursor: 'page-2',
      hasMore: true,
      total: 250,
      revision: '7',
    });

    const secondToken = useHistoryPageStore.getState().begin({
      ownerId: 'owner-1',
      scopeKey: 'scope-1',
      reset: false,
    });
    useHistoryPageStore.getState().complete(secondToken, {
      nextCursor: null,
      hasMore: false,
      total: null,
      revision: '7',
    });

    expect(useHistoryPageStore.getState()).toMatchObject({
      phase: 'ready',
      hasMore: false,
      total: 250,
      revision: '7',
    });
  });
});
