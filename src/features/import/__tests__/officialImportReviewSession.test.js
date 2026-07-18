import { describe, expect, it } from 'vitest';

import {
  clearOfficialImportReviewSession,
  loadOfficialImportReviewSession,
  saveOfficialImportReviewSession,
  shouldClearOfficialImportReviewSessionForError,
} from '../officialImportReviewSession.js';

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

describe('officialImportReviewSession', () => {
  it('只保存恢复审阅所需凭证，不保存官方令牌或记录内容', () => {
    const storage = createMemoryStorage();

    expect(saveOfficialImportReviewSession({
      userId: 'user-a',
      source: 'cn',
      taskId: 'task-a',
      accessKey: 'review-key',
      token: 'official-token-must-not-be-stored',
      records: [{ itemName: '不应保存' }],
    }, storage)).toBe(true);

    const serialized = [...storage.values.values()][0];
    expect(serialized).toContain('task-a');
    expect(serialized).toContain('review-key');
    expect(serialized).not.toContain('official-token-must-not-be-stored');
    expect(serialized).not.toContain('不应保存');
    expect(loadOfficialImportReviewSession({ userId: 'user-a', source: 'cn' }, storage)).toMatchObject({
      taskId: 'task-a',
      accessKey: 'review-key',
      source: 'cn',
    });
  });

  it('按用户和官方来源隔离，并可精确清除', () => {
    const storage = createMemoryStorage();
    saveOfficialImportReviewSession({
      userId: 'user-a', source: 'cn', taskId: 'task-cn', accessKey: 'key-cn',
    }, storage);
    saveOfficialImportReviewSession({
      userId: 'user-a', source: 'intl', taskId: 'task-intl', accessKey: 'key-intl',
    }, storage);

    expect(loadOfficialImportReviewSession({ userId: 'user-b', source: 'cn' }, storage)).toBeNull();
    expect(loadOfficialImportReviewSession({ userId: 'user-a', source: 'intl' }, storage)).toMatchObject({
      taskId: 'task-intl',
    });
    expect(clearOfficialImportReviewSession({ userId: 'user-a', source: 'cn' }, storage)).toBe(true);
    expect(loadOfficialImportReviewSession({ userId: 'user-a', source: 'cn' }, storage)).toBeNull();
    expect(loadOfficialImportReviewSession({ userId: 'user-a', source: 'intl' }, storage)).toMatchObject({
      taskId: 'task-intl',
    });
  });

  it('遇到损坏或不完整数据时清理并安全返回', () => {
    const storage = createMemoryStorage();
    storage.setItem('endfield:official-import-review:v1:user-a:cn', '{bad json');

    expect(loadOfficialImportReviewSession({ userId: 'user-a', source: 'cn' }, storage)).toBeNull();
    expect(storage.values.size).toBe(0);

    const failingStorage = {
      getItem() { throw new Error('storage blocked'); },
      setItem() { throw new Error('storage blocked'); },
      removeItem() { throw new Error('storage blocked'); },
    };
    expect(saveOfficialImportReviewSession({
      userId: 'user-a', source: 'cn', taskId: 'task-a', accessKey: 'key-a',
    }, failingStorage)).toBe(false);
    expect(loadOfficialImportReviewSession({ userId: 'user-a', source: 'cn' }, failingStorage)).toBeNull();
    expect(clearOfficialImportReviewSession({ userId: 'user-a', source: 'cn' }, failingStorage)).toBe(false);
  });

  it('只在审阅任务或访问凭证确定失效时清理恢复数据', () => {
    expect(shouldClearOfficialImportReviewSessionForError({
      data: { code: 'REVIEW_TASK_EXPIRED' },
    })).toBe(true);
    expect(shouldClearOfficialImportReviewSessionForError({
      data: { code: 'REVIEW_ACCESS_DENIED' },
    })).toBe(true);
    expect(shouldClearOfficialImportReviewSessionForError({
      data: { code: 'UNAUTHORIZED' },
      step: 'import-review',
    })).toBe(false);
    expect(shouldClearOfficialImportReviewSessionForError(new Error('network timeout'))).toBe(false);
  });
});
