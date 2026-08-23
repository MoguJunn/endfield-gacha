import { describe, expect, it } from 'vitest';

import {
  AUTH_EVENT_CLASSIFICATION,
  classifyAuthEvent,
} from '../authEventClassifier.js';

describe('classifyAuthEvent', () => {
  it.each([
    {
      name: '初始会话首次建立 owner',
      input: { event: 'INITIAL_SESSION', nextOwnerId: 'user-a' },
      classification: AUTH_EVENT_CLASSIFICATION.INITIAL_SESSION,
      shouldRefresh: true,
      shouldUpdateLastSeen: true,
    },
    {
      name: '未登录的 INITIAL_SESSION 仍保留事件语义',
      input: { event: 'INITIAL_SESSION', nextOwnerId: null },
      classification: AUTH_EVENT_CLASSIFICATION.INITIAL_SESSION,
      shouldRefresh: false,
      shouldUpdateLastSeen: false,
    },
    {
      name: '首次 SIGNED_IN',
      input: { event: 'SIGNED_IN', nextOwnerId: 'user-a' },
      classification: AUTH_EVENT_CLASSIFICATION.FIRST_SIGNED_IN,
      shouldRefresh: true,
      shouldUpdateLastSeen: true,
    },
    {
      name: '同 owner SIGNED_IN 恢复且已有快照',
      input: {
        event: 'SIGNED_IN',
        currentOwnerId: 'user-a',
        nextOwnerId: 'user-a',
        hasSnapshot: true,
      },
      classification: AUTH_EVENT_CLASSIFICATION.SAME_OWNER_SIGNED_IN_RECOVERY,
      shouldRefresh: false,
      shouldUpdateLastSeen: false,
    },
    {
      name: 'TOKEN_REFRESHED 且已有快照',
      input: {
        event: 'TOKEN_REFRESHED',
        currentOwnerId: 'user-a',
        nextOwnerId: 'user-a',
        hasSnapshot: true,
      },
      classification: AUTH_EVENT_CLASSIFICATION.TOKEN_REFRESHED,
      shouldRefresh: false,
      shouldUpdateLastSeen: false,
    },
    {
      name: 'USER_UPDATED 且已有快照',
      input: {
        event: 'USER_UPDATED',
        currentOwnerId: 'user-a',
        nextOwnerId: 'user-a',
        hasSnapshot: true,
      },
      classification: AUTH_EVENT_CLASSIFICATION.USER_UPDATED,
      shouldRefresh: false,
      shouldUpdateLastSeen: false,
    },
    {
      name: 'PASSWORD_RECOVERY 且已有快照',
      input: {
        event: 'PASSWORD_RECOVERY',
        currentOwnerId: 'user-a',
        nextOwnerId: 'user-a',
        hasSnapshot: true,
      },
      classification: AUTH_EVENT_CLASSIFICATION.PASSWORD_RECOVERY,
      shouldRefresh: false,
      shouldUpdateLastSeen: false,
    },
    {
      name: 'owner 发生切换',
      input: {
        event: 'SIGNED_IN',
        currentOwnerId: 'user-a',
        nextOwnerId: 'user-b',
        hasSnapshot: true,
      },
      classification: AUTH_EVENT_CLASSIFICATION.USER_SWITCH,
      shouldRefresh: true,
      shouldUpdateLastSeen: true,
    },
    {
      name: 'SIGNED_OUT',
      input: {
        event: 'SIGNED_OUT',
        currentOwnerId: 'user-a',
        nextOwnerId: null,
        hasSnapshot: true,
      },
      classification: AUTH_EVENT_CLASSIFICATION.SIGNED_OUT,
      shouldRefresh: false,
      shouldUpdateLastSeen: false,
    },
    {
      name: '站点 Session 同 owner 同步且已有快照',
      input: {
        event: 'SIGNED_IN',
        source: 'site_session',
        currentOwnerId: 'user-a',
        nextOwnerId: 'user-a',
        hasSnapshot: true,
      },
      classification: AUTH_EVENT_CLASSIFICATION.SITE_SESSION_SYNC,
      shouldRefresh: false,
      shouldUpdateLastSeen: false,
    },
    {
      name: '同 owner 缺少成功快照',
      input: {
        event: 'SIGNED_IN',
        currentOwnerId: 'user-a',
        nextOwnerId: 'user-a',
        hasSnapshot: false,
      },
      classification: AUTH_EVENT_CLASSIFICATION.SAME_OWNER_SIGNED_IN_RECOVERY,
      shouldRefresh: true,
      shouldUpdateLastSeen: false,
    },
    {
      name: '显式刷新覆盖已有快照',
      input: {
        event: 'SIGNED_IN',
        currentOwnerId: 'user-a',
        nextOwnerId: 'user-a',
        hasSnapshot: true,
        refreshKind: 'explicit',
      },
      classification: AUTH_EVENT_CLASSIFICATION.SAME_OWNER_SIGNED_IN_RECOVERY,
      shouldRefresh: true,
      shouldUpdateLastSeen: false,
    },
    {
      name: '变更后刷新覆盖已有快照',
      input: {
        event: 'USER_UPDATED',
        currentOwnerId: 'user-a',
        nextOwnerId: 'user-a',
        hasSnapshot: true,
        refreshKind: 'mutation',
      },
      classification: AUTH_EVENT_CLASSIFICATION.USER_UPDATED,
      shouldRefresh: true,
      shouldUpdateLastSeen: false,
    },
  ])('$name', ({ input, classification, shouldRefresh, shouldUpdateLastSeen }) => {
    const result = classifyAuthEvent(input);

    expect(result.classification).toBe(classification);
    expect(result.shouldRefreshPersonalData).toBe(shouldRefresh);
    expect(result.shouldUpdateLastSeen).toBe(shouldUpdateLastSeen);
  });
});
