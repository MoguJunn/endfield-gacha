import { describe, expect, it, vi } from 'vitest';
import {
  confirmOfficialImportTask,
  getOfficialImportReview,
  loadStagedRows,
  stageOfficialImportTask,
} from '../../backend/lib/officialImportStaging.js';

function createFakeSupabase({ rowLimit = 1000, onStagedRead } = {}) {
  const tables = {
    official_import_tasks: [],
    official_import_staged_records: [],
  };
  const failures = [];
  const reads = [];
  let taskSequence = 0;
  let recordSequence = 0;

  class Query {
    constructor(tableName) {
      this.tableName = tableName;
      this.action = 'select';
      this.payload = null;
      this.filters = [];
      this.orderBy = null;
      this.rangeBounds = null;
    }

    select(columns = '*') {
      this.columns = columns;
      return this;
    }

    insert(payload) {
      this.action = 'insert';
      this.payload = payload;
      return this;
    }

    update(payload) {
      this.action = 'update';
      this.payload = payload;
      return this;
    }

    delete() {
      this.action = 'delete';
      return this;
    }

    eq(field, value) {
      this.filters.push((row) => row[field] === value);
      return this;
    }

    in(field, values) {
      const allowed = new Set(values);
      this.filters.push((row) => allowed.has(row[field]));
      return this;
    }

    order(field, { ascending = true } = {}) {
      this.orderBy = { field, ascending };
      return this;
    }

    range(from, to) {
      this.rangeBounds = [from, to];
      return this;
    }

    abortSignal(signal) {
      this.signal = signal;
      return this;
    }

    single() {
      return this.execute('single');
    }

    maybeSingle() {
      return this.execute('maybeSingle');
    }

    then(resolve, reject) {
      return this.execute('many').then(resolve, reject);
    }

    matches(row) {
      return this.filters.every((filter) => filter(row));
    }

    async execute(mode) {
      this.signal?.throwIfAborted();
      if (this.tableName === 'official_import_staged_records' && this.action === 'select') {
        reads.push({ range: this.rangeBounds, columns: this.columns });
        onStagedRead?.(reads.at(-1), this.signal);
        this.signal?.throwIfAborted();
      }
      const failureIndex = failures.findIndex((failure) => failure.predicate({
        tableName: this.tableName,
        action: this.action,
        payload: this.payload,
        mode,
        range: this.rangeBounds,
        columns: this.columns,
      }));
      if (failureIndex >= 0) {
        const failure = failures[failureIndex];
        failure.remaining -= 1;
        if (failure.remaining <= 0) {
          failures.splice(failureIndex, 1);
        }
        return { data: null, error: structuredClone(failure.error) };
      }

      const table = tables[this.tableName];
      if (!table) {
        return { data: null, error: { message: `Unexpected table ${this.tableName}` } };
      }

      let affected = [];
      if (this.action === 'insert') {
        const payloads = Array.isArray(this.payload) ? this.payload : [this.payload];
        affected = payloads.map((payload) => {
          const row = { ...payload };
          if (this.tableName === 'official_import_tasks') {
            row.id ||= `task-${++taskSequence}`;
            row.created_at ||= new Date().toISOString();
            row.updated_at ||= row.created_at;
          } else {
            row.id ||= ++recordSequence;
            row.created_at ||= new Date().toISOString();
          }
          table.push(row);
          return row;
        });
      } else if (this.action === 'update') {
        affected = table.filter((row) => this.matches(row));
        affected.forEach((row) => Object.assign(row, this.payload));
      } else if (this.action === 'delete') {
        affected = table.filter((row) => this.matches(row));
        for (let index = table.length - 1; index >= 0; index -= 1) {
          if (this.matches(table[index])) table.splice(index, 1);
        }
      } else {
        affected = table.filter((row) => this.matches(row));
      }

      if (this.orderBy) {
        const { field, ascending } = this.orderBy;
        affected = [...affected].sort((left, right) => (
          (Number(left[field]) - Number(right[field])) * (ascending ? 1 : -1)
        ));
      }

      const count = affected.length;
      if (this.action === 'select' && this.tableName === 'official_import_staged_records') {
        const [from, to] = this.rangeBounds || [0, 999];
        affected = affected.slice(from, Math.min(to + 1, from + rowLimit));
      }
      const cloned = affected.map((row) => structuredClone(
        this.action === 'select' && this.columns && this.columns !== '*'
          ? Object.fromEntries(this.columns.split(',').map(key => [key, row[key]]))
          : row
      ));
      if (mode === 'single') {
        return cloned.length === 1
          ? { data: cloned[0], error: null }
          : { data: null, error: { message: `Expected one row, received ${cloned.length}` } };
      }
      if (mode === 'maybeSingle') {
        return cloned.length <= 1
          ? { data: cloned[0] || null, error: null }
          : { data: null, error: { message: `Expected at most one row, received ${cloned.length}` } };
      }
      return { data: cloned, count, error: null };
    }
  }

  return {
    tables,
    reads,
    failNext(predicate, error, times = 1) {
      failures.push({ predicate, error, remaining: times });
    },
    from(tableName) {
      return new Query(tableName);
    },
  };
}

function createStagedRecord({ blocked = false, ordinalName = '测试角色' } = {}) {
  const issues = blocked
    ? [{ code: 'MISSING_QUALITY', severity: 'blocking', message: '缺少品质' }]
    : [];
  return {
    historyRecord: {
      record_id: `record-${ordinalName}`,
      pool_id: 'special_test',
      seq_id: ordinalName,
      game_uid: '10001',
      character_name: ordinalName,
      item_name: ordinalName,
      rarity: blocked ? null : 5,
      timestamp: '2026-07-16T00:00:00.000Z',
    },
    normalized: {
      rawItemId: blocked ? null : `chr-${ordinalName}`,
      itemName: blocked ? null : ordinalName,
      itemType: 'character',
      quality: blocked ? null : 5,
      poolId: 'special_test',
      seqId: ordinalName,
      timestamp: '2026-07-16T00:00:00.000Z',
      gameUid: '10001',
    },
    rawMin: { itemName: ordinalName },
    issues,
    blocked,
  };
}

async function createReview(supabase) {
  return stageOfficialImportTask({
    supabase,
    userId: 'user-1',
    source: 'cn',
    importMode: 'incremental',
    account: { gameUid: '10001', serverId: '1', region: 'cn' },
    pools: [{
      pool_id: 'special_test',
      name: '测试卡池',
      type: 'extra',
      extra_subtype: 'reconstruction',
      extra_rule_profile: 'reconstruction_character_v1',
      extra_series_key: 'staged-series',
      extra_series_phase: 2,
    }],
    stagedRecords: [
      createStagedRecord(),
      createStagedRecord({ blocked: true, ordinalName: '异常记录' }),
    ],
    reviewSummary: {
      totalRecords: 2,
      issueRecords: 1,
      blockingRecords: 1,
      issues: [{ code: 'MISSING_QUALITY', severity: 'blocking', recordIndex: 1 }],
    },
    importSummary: { newRecords: 2 },
  });
}

describe('official import staging', () => {
  it('reads large tasks with small pages and preserves the exact commit payload', async () => {
    const supabase = createFakeSupabase();
    const staged = await stageOfficialImportTask({
      supabase, userId: 'user-1', source: 'cn', importMode: 'full',
      account: { gameUid: '10001', serverId: '1' },
      stagedRecords: Array.from({ length: 242 }, (_, i) => createStagedRecord({ ordinalName: String(i) })),
      importSummary: { newRecords: 242 },
    });
    // Model the failing cross-region response size, rather than only checking
    // which range and column strings the implementation happens to construct.
    supabase.failNext(({ tableName, action, range, columns }) => tableName === 'official_import_staged_records'
      && action === 'select' && (range[1] - range[0] + 1 > 100 || columns === '*'),
    { message: 'TimeoutError: Total request deadline exceeded' }, 10);
    const commit = vi.fn(async ({ rows }) => ({ savedRecords: rows.length }));
    await confirmOfficialImportTask({ supabase, taskId: staged.task.id, userId: 'user-1', accessKey: staged.accessKey, commit });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][0].rows.map(row => row.normalized_record))
      .toEqual(supabase.tables.official_import_staged_records.map(row => row.normalized_record));
    expect(supabase.reads.map(read => read.range)).toEqual([[0, 99], [100, 199], [200, 299]]);
    expect(commit.mock.calls[0][0].rows.every(row => !Object.hasOwn(row, 'raw_min'))).toBe(true);
  });

  it('retries only the timed-out page without dropping or duplicating prior records', async () => {
    const supabase = createFakeSupabase();
    const staged = await stageOfficialImportTask({
      supabase, userId: 'user-1', source: 'cn', account: { gameUid: '10001' },
      stagedRecords: Array.from({ length: 220 }, (_, i) => createStagedRecord({ ordinalName: String(i) })),
      importSummary: { newRecords: 220 },
    });
    supabase.failNext(({ tableName, action, range }) => tableName === 'official_import_staged_records'
      && action === 'select' && range[0] === 100,
    { message: 'TimeoutError: Total request deadline exceeded' });
    const logger = { warn: vi.fn() };
    const commit = vi.fn(async ({ rows }) => ({ savedRecords: rows.length }));
    const result = await confirmOfficialImportTask({
      supabase, taskId: staged.task.id, userId: 'user-1', accessKey: staged.accessKey, commit,
      connectionRetryOptions: { logger },
    });
    expect(result.result.savedRecords).toBe(220);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][0].rows.map(row => row.ordinal)).toEqual(Array.from({ length: 220 }, (_, i) => i));
    expect(supabase.reads.map(read => read.range[0])).toEqual([0, 100, 100, 200]);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(staged.task.id);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(staged.accessKey);
  });

  it.each(['TimeoutError: Total request deadline exceeded', 'permission denied'])('stops safely on a persistent read failure: %s', async message => {
    const supabase = createFakeSupabase();
    const staged = await createReview(supabase);
    supabase.failNext(({ tableName, action }) => tableName === 'official_import_staged_records' && action === 'select', { message }, 10);
    const commit = vi.fn();
    await expect(confirmOfficialImportTask({
      supabase, taskId: staged.task.id, userId: 'user-1', accessKey: staged.accessKey, commit,
      connectionRetryOptions: { logger: { warn: vi.fn() } },
    })).rejects.toMatchObject({ code: 'STAGED_RECORDS_LOAD_FAILED', details: { offset: 0, pageSize: 100 } });
    expect(supabase.reads).toHaveLength(message.startsWith('TimeoutError') ? 2 : 1);
    expect(commit).not.toHaveBeenCalled();
    expect(supabase.tables.official_import_tasks[0].status).toBe('awaiting_confirmation');
  });

  it('cancels a page read without retrying or returning a partial snapshot', async () => {
    const controller = new AbortController();
    const supabase = createFakeSupabase({ onStagedRead: (_read, signal) => {
      expect(signal).toBe(controller.signal);
      controller.abort(new DOMException('Cancelled', 'AbortError'));
    } });
    await expect(loadStagedRows(supabase, 'task-1', {}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(supabase.reads).toHaveLength(1);
  });

  it('loads review metadata without normalized payloads or raw records', async () => {
    const supabase = createFakeSupabase();
    const staged = await createReview(supabase);
    const review = await getOfficialImportReview({ supabase, taskId: staged.task.id, userId: 'user-1', accessKey: staged.accessKey });
    expect(review.records).toHaveLength(2);
    expect(review.records[0]).toMatchObject({ ordinal: 0, poolId: 'special_test', itemName: '测试角色', selectedAction: 'keep' });
    expect(supabase.reads[0].columns).not.toContain('normalized_record');
    expect(supabase.reads[0].columns).not.toContain('raw_min');
  });

  it.each([1001, 1363, 5000])('commits all %i staged records across the REST row limit', async (size) => {
    const supabase = createFakeSupabase();
    const staged = await stageOfficialImportTask({
      supabase, userId: 'user-1', source: 'intl', importMode: 'full',
      account: { gameUid: '10001', serverId: '2' },
      stagedRecords: Array.from({ length: size }, (_, index) => createStagedRecord({ ordinalName: String(index) })),
      importSummary: { newRecords: size },
    });
    const commit = vi.fn(async ({ rows }) => ({ savedRecords: rows.length }));
    const result = await confirmOfficialImportTask({
      supabase, taskId: staged.task.id, userId: 'user-1', accessKey: staged.accessKey, commit,
    });
    expect(result.result.savedRecords).toBe(size);
    expect(commit.mock.calls[0][0].rows.at(-1).ordinal).toBe(size - 1);
  });

  it('refuses a missing ordinal before calling commit', async () => {
    const supabase = createFakeSupabase();
    const staged = await createReview(supabase);
    supabase.tables.official_import_staged_records[1].ordinal = 2;
    const commit = vi.fn();
    await expect(confirmOfficialImportTask({
      supabase, taskId: staged.task.id, userId: 'user-1', accessKey: staged.accessKey, commit,
    })).rejects.toMatchObject({ code: 'STAGED_RECORDS_INCOMPLETE' });
    expect(commit).not.toHaveBeenCalled();
  });

  it('continues through pages capped below the requested size', async () => {
    const supabase=createFakeSupabase({rowLimit:1});
    const staged=await createReview(supabase);
    const review=await getOfficialImportReview({supabase,taskId:staged.task.id,userId:'user-1',accessKey:staged.accessKey});
    expect(review.records).toHaveLength(2);
  });

  it('rejects a missing final record even when returned ordinals are contiguous', async () => {
    const supabase=createFakeSupabase(); const staged=await createReview(supabase);
    supabase.tables.official_import_staged_records.pop();
    const commit=vi.fn();
    await expect(confirmOfficialImportTask({supabase,taskId:staged.task.id,userId:'user-1',accessKey:staged.accessKey,commit}))
      .rejects.toMatchObject({code:'STAGED_RECORDS_INCOMPLETE'});
    expect(commit).not.toHaveBeenCalled();
  });

  const poolTimeout = {
    code: 'PGRST003',
    message: 'Timed out acquiring connection from connection pool.',
  };
  const retryImmediately = {
    baseDelayMs: 0,
    maxDelayMs: 0,
    random: () => 0,
    sleep: vi.fn(async () => {}),
    logger: { warn: vi.fn() },
  };

  it('stores only an access-key hash and defaults blocking records to skip', async () => {
    const supabase = createFakeSupabase();
    const staged = await createReview(supabase);

    expect(staged.accessKey).toBeTruthy();
    expect(supabase.tables.official_import_staged_records[0].normalized_record.pool).toMatchObject({
      pool_id: 'special_test',
      type: 'extra',
      extra_subtype: 'reconstruction',
      extra_rule_profile: 'reconstruction_character_v1',
      extra_series_key: 'staged-series',
      extra_series_phase: 2,
    });
    expect(supabase.tables.official_import_tasks[0].access_key_hash).not.toBe(staged.accessKey);
    expect(JSON.stringify(supabase.tables)).not.toContain(staged.accessKey);
    expect(staged.records.map((record) => record.selectedAction)).toEqual(['keep', 'skip']);
  });

  it('rejects an invalid access key without exposing staged records', async () => {
    const supabase = createFakeSupabase();
    const staged = await createReview(supabase);

    await expect(getOfficialImportReview({
      supabase,
      taskId: staged.task.id,
      userId: 'user-1',
      accessKey: 'wrong-key',
    })).rejects.toMatchObject({ code: 'REVIEW_ACCESS_DENIED', statusCode: 403 });
  });

  it('requires blocking records to be skipped and keeps confirmation idempotent', async () => {
    const supabase = createFakeSupabase();
    const staged = await createReview(supabase);
    const commit = vi.fn(async ({ rows }) => ({ savedRecords: rows.length }));

    await expect(confirmOfficialImportTask({
      supabase,
      taskId: staged.task.id,
      userId: 'user-1',
      accessKey: staged.accessKey,
      decisions: [{ ordinal: 1, action: 'keep' }],
      commit,
    })).rejects.toMatchObject({ code: 'BLOCKING_RECORDS_MUST_BE_SKIPPED' });

    const first = await confirmOfficialImportTask({
      supabase,
      taskId: staged.task.id,
      userId: 'user-1',
      accessKey: staged.accessKey,
      decisions: [{ ordinal: 1, action: 'skip' }],
      commit,
    });
    const second = await confirmOfficialImportTask({
      supabase,
      taskId: staged.task.id,
      userId: 'user-1',
      accessKey: staged.accessKey,
      commit,
    });

    expect(first).toMatchObject({ idempotent: false, result: { savedRecords: 1 } });
    expect(second).toMatchObject({ idempotent: true, result: { savedRecords: 1 } });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(supabase.tables.official_import_staged_records[1]).toMatchObject({
      ordinal: 1,
      selected_action: 'skip',
      item_type: 'character',
    });
    expect(supabase.tables.official_import_staged_records[1].normalized_record).toBeTruthy();
  });

  it('allows a locatable unknown item to be written for post-import review', async () => {
    const supabase = createFakeSupabase();
    const issues = [
      { code: 'MISSING_ITEM_ID_AND_NAME', severity: 'blocking', message: '缺少物品身份' },
      { code: 'MISSING_QUALITY', severity: 'blocking', message: '缺少品质' },
    ];
    const staged = await stageOfficialImportTask({
      supabase,
      userId: 'user-1',
      source: 'cn',
      importMode: 'incremental',
      account: { gameUid: '10001', serverId: '1', region: 'cn' },
      pools: [{ pool_id: 'special_test', name: '测试卡池', type: 'limited' }],
      stagedRecords: [{
        historyRecord: {
          record_id: 'record-unknown',
          pool_id: 'special_test',
          seq_id: '42',
          game_uid: '10001',
          server_id: '1',
          rarity: 4,
          timestamp: '2026-07-16T00:00:00.000Z',
        },
        normalized: {
          itemName: null,
          itemType: 'character',
          quality: null,
          poolId: 'special_test',
          seqId: '42',
          gameUid: '10001',
        },
        issues,
        blocked: true,
      }],
      reviewSummary: { totalRecords: 1, issueRecords: 1, blockingRecords: 1, issues },
      importSummary: { newRecords: 1 },
    });
    const commit = vi.fn(async ({ rows }) => ({ savedRecords: rows.length }));

    expect(staged.records[0]).toMatchObject({
      selectedAction: 'keep',
      quality: null,
    });
    const confirmed = await confirmOfficialImportTask({
      supabase,
      taskId: staged.task.id,
      userId: 'user-1',
      accessKey: staged.accessKey,
      commit,
    });

    expect(confirmed.result.savedRecords).toBe(1);
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({
      rows: [expect.objectContaining({
        selected_action: 'keep',
        normalized_record: expect.objectContaining({
          history: expect.objectContaining({ rarity: 4 }),
        }),
      })],
    }));
  });

  it('accepts a task status committed by the atomic database callback', async () => {
    const supabase = createFakeSupabase();
    const staged = await createReview(supabase);
    const commit = vi.fn(async ({ task, rows }) => {
      const storedTask = supabase.tables.official_import_tasks.find((item) => item.id === task.id);
      Object.assign(storedTask, {
        status: 'committed',
        committed_at: new Date().toISOString(),
        summary: {
          ...storedTask.summary,
          commitResult: { savedRecords: rows.length, atomicCommit: true },
        },
      });
      return {
        savedRecords: rows.length,
        atomicCommit: true,
        taskCommittedAtomically: true,
      };
    });

    const first = await confirmOfficialImportTask({
      supabase,
      taskId: staged.task.id,
      userId: 'user-1',
      accessKey: staged.accessKey,
      decisions: [{ ordinal: 1, action: 'skip' }],
      commit,
    });
    const second = await confirmOfficialImportTask({
      supabase,
      taskId: staged.task.id,
      userId: 'user-1',
      accessKey: staged.accessKey,
      commit,
    });

    expect(first).toMatchObject({
      idempotent: false,
      task: { status: 'committed' },
      result: { savedRecords: 1, atomicCommit: true },
    });
    expect(first.result).not.toHaveProperty('taskCommittedAtomically');
    expect(second).toMatchObject({ idempotent: true, result: { savedRecords: 1, atomicCommit: true } });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('recovers when the first task read cannot acquire a connection', async () => {
    const supabase = createFakeSupabase();
    const staged = await createReview(supabase);
    const commit = vi.fn(async ({ rows }) => ({ savedRecords: rows.length }));
    supabase.failNext(
      ({ tableName, action }) => tableName === 'official_import_tasks' && action === 'select',
      poolTimeout
    );

    const confirmed = await confirmOfficialImportTask({
      supabase,
      taskId: staged.task.id,
      userId: 'user-1',
      accessKey: staged.accessKey,
      commit,
      connectionRetryOptions: retryImmediately,
    });

    expect(confirmed).toMatchObject({ idempotent: false, result: { savedRecords: 1 } });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('retries a PGRST003 while acquiring the confirmation lock', async () => {
    const supabase = createFakeSupabase();
    const staged = await createReview(supabase);
    const commit = vi.fn(async ({ rows }) => ({ savedRecords: rows.length }));
    supabase.failNext(
      ({ tableName, action, payload }) => (
        tableName === 'official_import_tasks'
        && action === 'update'
        && payload?.status === 'confirming'
      ),
      poolTimeout
    );

    const confirmed = await confirmOfficialImportTask({
      supabase,
      taskId: staged.task.id,
      userId: 'user-1',
      accessKey: staged.accessKey,
      commit,
      connectionRetryOptions: retryImmediately,
    });

    expect(confirmed.result.savedRecords).toBe(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('reports database busy instead of a false concurrent confirmation after retries are exhausted', async () => {
    const supabase = createFakeSupabase();
    const staged = await createReview(supabase);
    const commit = vi.fn();
    supabase.failNext(
      ({ tableName, action, payload }) => (
        tableName === 'official_import_tasks'
        && action === 'update'
        && payload?.status === 'confirming'
      ),
      poolTimeout,
      3
    );

    await expect(confirmOfficialImportTask({
      supabase,
      taskId: staged.task.id,
      userId: 'user-1',
      accessKey: staged.accessKey,
      commit,
      connectionRetryOptions: retryImmediately,
    })).rejects.toMatchObject({
      code: 'REVIEW_DATABASE_BUSY',
      statusCode: 503,
      details: {
        operation: 'lock-review-task',
        retryable: true,
        sourceCode: 'PGRST003',
      },
    });
    expect(commit).not.toHaveBeenCalled();
    expect(supabase.tables.official_import_tasks[0].status).toBe('awaiting_confirmation');
  });

  it('treats a committed task as success when the atomic callback response is lost', async () => {
    const supabase = createFakeSupabase();
    const staged = await createReview(supabase);
    const commit = vi.fn(async ({ task, rows }) => {
      const storedTask = supabase.tables.official_import_tasks.find((item) => item.id === task.id);
      Object.assign(storedTask, {
        status: 'committed',
        committed_at: new Date().toISOString(),
        summary: {
          ...storedTask.summary,
          commitResult: { savedRecords: rows.length, atomicCommit: true },
        },
      });
      throw new Error('response lost after commit');
    });

    const confirmed = await confirmOfficialImportTask({
      supabase,
      taskId: staged.task.id,
      userId: 'user-1',
      accessKey: staged.accessKey,
      commit,
      connectionRetryOptions: retryImmediately,
    });

    expect(confirmed).toMatchObject({
      idempotent: true,
      task: { status: 'committed' },
      result: { savedRecords: 1, atomicCommit: true },
    });
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
