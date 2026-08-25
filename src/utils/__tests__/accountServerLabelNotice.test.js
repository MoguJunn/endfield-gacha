import { beforeEach, describe, expect, it } from 'vitest';

import {
  getAccountServerLabelIssue,
  getVisibleAccountServerLabelIssues,
  ignoreAccountServerLabelIssues,
} from '../accountServerLabelNotice.js';

describe('accountServerLabelNotice', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('flags legacy and missing server identities without flagging valid servers', () => {
    expect(getAccountServerLabelIssue({
      gameUid: '1001',
      serverId: '1',
      serverScope: 'legacy',
    })?.code).toBe('legacy_server_scope');
    expect(getAccountServerLabelIssue({ gameUid: '1002', serverScope: null, serverId: null })?.code)
      .toBe('missing_or_unknown_server');
    expect(getAccountServerLabelIssue({ gameUid: '1003', serverId: '1', serverScope: '1' })).toBeNull();
    expect(getAccountServerLabelIssue({ gameUid: '1004', serverId: 'bilibili', serverScope: 'bilibili' })).toBeNull();
    expect(getAccountServerLabelIssue({ gameUid: '1005', serverId: '2', serverScope: '2' })).toBeNull();
  });

  it('persists ignored issues per owner and leaves new issues visible', () => {
    const firstAccount = { gameUid: '1001', serverId: '1', serverScope: 'legacy' };
    const secondAccount = { gameUid: '1002', serverId: '1', serverScope: 'legacy' };
    const firstIssue = getAccountServerLabelIssue(firstAccount);

    ignoreAccountServerLabelIssues('owner-a', [firstIssue]);

    expect(getVisibleAccountServerLabelIssues('owner-a', [firstAccount])).toEqual([]);
    expect(getVisibleAccountServerLabelIssues('owner-b', [firstAccount])).toHaveLength(1);
    expect(getVisibleAccountServerLabelIssues('owner-a', [firstAccount, secondAccount]))
      .toEqual([expect.objectContaining({ gameUid: '1002' })]);
  });

  it('recovers safely from malformed local preferences', () => {
    window.localStorage.setItem('gacha_account_server_label_notice_ignored_v1:owner-a', '{broken');
    expect(getVisibleAccountServerLabelIssues('owner-a', [
      { gameUid: '1001', serverId: '1', serverScope: 'legacy' },
    ])).toHaveLength(1);
  });
});
