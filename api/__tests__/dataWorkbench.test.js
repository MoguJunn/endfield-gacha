// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ admin: vi.fn(), auth: vi.fn(), origin: vi.fn() }));
vi.mock('../_lib/authAdmin.js', () => ({ getSupabaseAdminClient: mocks.admin }));
vi.mock('../_lib/siteAuth.js', () => ({ resolveAuthenticatedRequestUser: mocks.auth }));
vi.mock('../_lib/http.js', () => ({ resolveAuthenticatedRequestUser: mocks.auth, rejectDisallowedBrowserOrigin: mocks.origin }));

import handler from '../_routes/root/data-workbench.js';
import { buildWorkbenchPreview, buildWorkspacePreview, normalizeSubmission, normalizeWorkspaceSubmission, payloadFingerprint, WORKBENCH_RULES_VERSION } from '../_lib/dataWorkbench.js';
import { buildPoolLedgerEntry } from '../../shared/dataWorkbench.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const DRAFT = '22222222-2222-4222-8222-222222222222';
const COMMIT = '33333333-3333-4333-8333-333333333333';
const ENTRY = '44444444-4444-4444-8444-444444444444';
const ENTRY_B = '66666666-6666-4666-8666-666666666666';
const ENTRY_C = '77777777-7777-4777-8777-777777777777';
const ID = '55555555-5555-4555-8555-555555555555';
const TOKEN = '88888888-8888-4888-8888-888888888888';
const SCOPE = { gameUid: '123456', serverScope: '1' };
const DETAIL_TIME = '2026-01-10T01:00:00Z';
const entity = { id: 'char_one', name: '角色一', type: 'character', rarity: 6, release_date: '2026-01-01' };
const pool = { pool_id: 'pool_one', type: 'limited', roster_status: 'complete', start_time: '2026-01-01', end_time: '2026-02-01' };

const withValues = (base, overrides) => ({
  ...base,
  ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'values')),
  values: { ...base.values, ...(overrides.values || {}) },
});

const detail = (overrides = {}) => withValues({
  entryId: ENTRY, kind: 'detail', poolId: pool.pool_id, timePrecision: 'second', reviewState: 'confirmed',
  values: { entityId: entity.id, quantity: 1, timestamp: DETAIL_TIME, drawMethod: 'normal' },
}, overrides);
const summary = (overrides = {}) => withValues({
  entryId: ENTRY_B, kind: 'pool-summary', poolId: pool.pool_id, timePrecision: 'range', reviewState: 'confirmed',
  values: { totalPulls: 180, drawMethod: 'normal', rangeStart: '2026-01-01T00:00:00Z', rangeEnd: '2026-02-01T00:00:00Z' },
}, overrides);
const interval = (overrides = {}) => withValues({
  entryId: ENTRY_C, kind: 'six-star-interval', poolId: pool.pool_id, timePrecision: 'range', reviewState: 'confirmed',
  values: { entityId: entity.id, drawMethod: 'normal', intervalPulls: 62, rangeStart: '2026-01-01T00:00:00Z', rangeEnd: '2026-02-01T00:00:00Z' },
}, overrides);
const payload = (entries = [detail()]) => ({ draftId: DRAFT, commitId: COMMIT, scope: SCOPE, entries });
const historyRow = (overrides = {}) => ({
  id: 900, pool_id: pool.pool_id, character_id: entity.id, rarity: 6, timestamp: DETAIL_TIME,
  seq_id: 'seq-1', record_id: 'record-1', game_uid: SCOPE.gameUid, server_scope: SCOPE.serverScope,
  user_id: OWNER, is_free: false, is_info_book: false, special_type: null, ...overrides,
});
const row = () => ({
  id: ID, entry_id: ENTRY, draft_id: DRAFT, user_id: OWNER, game_uid: SCOPE.gameUid,
  server_scope: SCOPE.serverScope, kind: 'detail', pool_id: pool.pool_id, values: detail().values,
  time_precision: 'second', source: 'manual', revision: 1, deleted_at: null,
});
const catalog = () => ({
  entities: [entity],
  pools: [{ ...pool, id: pool.pool_id, six_star_entities: [entity] }],
});
const emptyContext = () => ({ entries: [], history: [], contextToken: 'snapshot-token' });
const preview = (entries, context = emptyContext(), customCatalog = catalog()) => buildWorkbenchPreview({ ...payload(entries), entries }, context, customCatalog);
const codes = result => result.issues.map(item => item.code);

function database({ context = emptyContext(), ownEntry = null, commit = null, rpcError = null, catalogPools = [pool], catalogEntities = [entity], roster = [{ pool_id: pool.pool_id, character_id: entity.id }] } = {}) {
  const queries = [];
  const db = {
    queries,
    from: vi.fn((table) => {
      const filters = [];
      const query = { table, filters };
      for (const name of ['select', 'order', 'eq', 'is']) {
        query[name] = vi.fn((...args) => { filters.push([name, ...args]); return query; });
      }
      query.range = vi.fn(async (from, to) => {
        const rows = table === 'characters' ? catalogEntities : roster;
        return { data: rows.slice(from, to + 1), count: rows.length, error: null };
      });
      query.maybeSingle = vi.fn(async () => {
        const data = table === 'account_data_workbench_commits' ? commit : ownEntry;
        return { data: typeof data === 'function' ? data() : data, error: null };
      });
      queries.push(query);
      return query;
    }),
    rpc: vi.fn(async (name, params) => {
      if (rpcError && name !== 'get_app_visible_pools') return { data: null, error: rpcError };
      if (name === 'read_account_data_workbench_context') return { data: context, error: null };
      if (name === 'get_app_visible_pools') return { data: catalogPools, error: null };
      if (name === 'read_account_data_workbench_catalog') return { data: { pools: catalogPools, entities: catalogEntities, roster, catalogToken: 'catalog-token' }, error: null };
      if (name === 'validate_account_data_workbench_workspace') return { data: { validationToken: TOKEN, draftRevision: params.p_request.draftRevision, expiresAt: '2026-10-09T12:15:00Z' }, error: null };
      if (name === 'commit_account_data_workbench_workspace') return { data: { commitId: params.p_request.commitId,
        draftRevision: params.p_request.draftRevision, saved: params.p_request.entries.length, entryIds: params.p_request.entries.length ? [ID] : [],
        operationCount: params.p_request.entries.length + params.p_request.historyChanges.length + params.p_request.supplementChanges.length,
        historyUpdated: params.p_request.historyChanges.length, supplementsUpdated: params.p_request.supplementChanges.filter(change => change.action === 'update').length,
        supplementsDeleted: params.p_request.supplementChanges.filter(change => change.action === 'delete').length,
      }, error: null };
      if (name === 'commit_account_data_workbench') return { data: { commitId: COMMIT, saved: params.p_entries.length, entryIds: [ID] }, error: null };
      if (name === 'mutate_account_data_workbench_entry') return { data: {
        ...ownEntry, revision: params.p_expected_revision + 1,
        ...(params.p_action === 'delete' ? { deleted_at: '2026-02-01T00:00:00Z' } : { values: params.p_entry.values }),
      }, error: null };
      throw new Error(`unexpected rpc: ${name}`);
    }),
  };
  mocks.admin.mockReturnValue(db);
  return db;
}

async function request(method, body, query = '') {
  const res = { statusCode: 200, headers: {}, setHeader: vi.fn(), end: vi.fn() };
  res.status = vi.fn((status) => { res.statusCode = status; return res; });
  res.json = vi.fn((data) => { res.body = data; return res; });
  await handler({ method, url: `/api/data-workbench${query}`, body }, res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: OWNER } });
  mocks.origin.mockReturnValue(false);
});

const ledger = (overrides = {}) => withValues({
  entryId: ENTRY, kind: 'pool-ledger', poolId: pool.pool_id, timePrecision: 'unknown', reviewState: 'confirmed', source: 'xhh', derivation: 'declared',
  values: { drawMethod: 'normal', coverageMode: 'pool', totalPulls: 50, sixStarCount: 1, fiveStarCount: 4, fourStarCount: 45,
    acquisitions: [{ id: 'known-six', entityId: entity.id, rarity: 6, quantity: 1, drawMethod: 'normal', timePrecision: 'unknown' }],
    inferredRecords: [], fillSeed: 'stable',
  },
}, overrides);
const workspacePayload = (overrides = {}) => ({ mode: 'pool-workspace', draftId: DRAFT, commitId: COMMIT, draftRevision: 3,
  scope: SCOPE, entries: [ledger()], historyChanges: [], supplementChanges: [], ...overrides });
const historyChange = (overrides = {}) => ({ recordId: 'record-1', ...SCOPE, currentPoolId: pool.pool_id, seqId: 'seq-1', expectedEditVersion: 1,
  changes: { characterId: entity.id }, reason: '修正实体', ...overrides });

describe('atomic pool workspace API', () => {
  const futurePool = { ...pool, pool_id: 'pool_future', name: '未开放卡池', start_time: '2099-01-01', end_time: '2099-02-01' };
  it.each([
    ['import', { entries: [ledger({ poolId: futurePool.pool_id })] }, emptyContext()],
    ['move into', { entries: [], historyChanges: [historyChange({ changes: { poolId: futurePool.pool_id } })] }, { ...emptyContext(), history: [historyRow()] }],
    ['move out of', { entries: [], historyChanges: [historyChange({ currentPoolId: futurePool.pool_id, changes: { poolId: pool.pool_id } })] }, { ...emptyContext(), history: [historyRow({ pool_id: futurePool.pool_id })] }],
    ['edit supplement', { entries: [], supplementChanges: [{ id: ID, expectedRevision: 1, action: 'update', entry: ledger() }] }, { ...emptyContext(), entries: [{ ...row(), pool_id: futurePool.pool_id }] }],
    ['delete supplement', { entries: [], supplementChanges: [{ id: ID, expectedRevision: 1, action: 'delete', reason: '移除' }] }, { ...emptyContext(), entries: [{ ...row(), pool_id: futurePool.pool_id }] }],
  ])('blocks %s involving an unopened pool at validation and commit', async (_name, overrides, context) => {
    const db = database({ context, catalogPools: [pool, futurePool], roster: [pool, futurePool].map(item => ({ pool_id: item.pool_id, character_id: entity.id })) });
    const body = workspacePayload(overrides);
    const validated = await request('POST', { ...body, action: 'validate' });
    expect(validated.body.preview.canCommit).toBe(false);
    expect(codes(validated.body.preview)).toContain('pool_not_open');
    expect(validated.body.validationToken).toBeNull();
    const committed = await request('POST', { ...body, action: 'commit', validationToken: TOKEN });
    expect(committed.statusCode).toBe(409);
    expect(committed.body.code).toBe('pool_not_open');
    expect(db.rpc.mock.calls.some(([name]) => name.startsWith('commit_') || name.startsWith('validate_'))).toBe(false);
  });

  it('preserves successful exact retries even if the pool catalog changes afterward', async () => {
    const body = workspacePayload();
    const result = { commitId: COMMIT, operationCount: 1, saved: 1 };
    const db = database({ catalogPools: [futurePool], commit: { payload_hash: payloadFingerprint(normalizeWorkspaceSubmission(body)), result } });
    const res = await request('POST', { ...body, action: 'commit', validationToken: TOKEN });
    expect(res.body.result).toEqual(result);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('returns both histories and supplements from the identical requested context', async () => {
    const history = [historyRow({ edit_version: 2 })];
    const db = database({ context: { ...emptyContext(), history, entries: [row()] } });
    const res = await request('GET', null, '?gameUid=123456&serverScope=1&includeHistory=1');
    expect(res.body).toMatchObject({ success: true, contextToken: 'snapshot-token', history });
    expect(res.body.entries).toHaveLength(1);
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it('validates unknown dates in full-pool coverage and issues a database-bound credential', async () => {
    const db = database({ context: { ...emptyContext(), history: [historyRow({ timestamp: null })] } });
    const body = workspacePayload();
    const res = await request('POST', { ...body, action: 'validate' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ validationToken: TOKEN, draftRevision: 3, preview: { canCommit: true } });
    expect(codes(res.body.preview)).not.toContain('coverage_time_unknown');
    expect(res.body.preview.checks).not.toHaveLength(0);
    const params = db.rpc.mock.calls.find(([name]) => name === 'validate_account_data_workbench_workspace')[1];
    expect(params).toMatchObject({ p_user_id: OWNER, p_context_token: 'snapshot-token', p_catalog_token: 'catalog-token', p_rules_version: WORKBENCH_RULES_VERSION });
    expect(params.p_payload_hash).toBe(payloadFingerprint(normalizeWorkspaceSubmission(body)));
    expect(params.p_operations.entries[0]).toMatchObject({ source: 'xhh', derivation: 'declared' });
    expect(db.rpc.mock.calls.some(([name]) => name.startsWith('commit_') || name.startsWith('mutate_') || name === 'update_history_record_controlled')).toBe(false);
  });

  it('rejects missing credential before any commit request and preserves exact-request retries', async () => {
    const db = database();
    const body = workspacePayload();
    const missing = await request('POST', { ...body, action: 'commit' });
    expect(missing.statusCode).toBe(409); expect(missing.body.code).toBe('workbench_validation_required');
    expect(db.rpc).not.toHaveBeenCalled();
    for (let retry = 0; retry < 2; retry += 1) {
      const res = await request('POST', { ...body, action: 'commit', validationToken: TOKEN });
      expect(res.statusCode).toBe(200); expect(res.body.result).toMatchObject({ commitId: COMMIT, draftRevision: 3, operationCount: 1 });
    }
    const calls = db.rpc.mock.calls.filter(([name]) => name === 'commit_account_data_workbench_workspace');
    expect(calls).toHaveLength(2); expect(calls[0]).toEqual(calls[1]);
    expect(calls[0][0]).toBe('commit_account_data_workbench_workspace');
    expect(calls[0][1].p_payload_hash).toBe(payloadFingerprint(normalizeWorkspaceSubmission(body)));
  });

  it('resolves simultaneous history and supplement modifications before applying shared rules', async () => {
    const original = { ...row(), kind: 'pool-ledger', source: 'file', values: ledger().values, time_precision: 'unknown' };
    const db = database({ context: { ...emptyContext(), entries: [original], history: [historyRow({ character_id: null, rarity: 4, edit_version: 1 })] } });
    const body = workspacePayload({ entries: [], historyChanges: [historyChange()], supplementChanges: [{ id: ID, expectedRevision: 1,
      action: 'update', entry: ledger({ values: { totalPulls: 51, fourStarCount: 46 } }), reason: '补充抽数' }] });
    const res = await request('POST', { ...body, action: 'validate' });
    expect(res.statusCode).toBe(200); expect(res.body.preview.issues).toEqual([]); expect(res.body.validationToken).toBe(TOKEN);
    const params = db.rpc.mock.calls.find(([name]) => name === 'validate_account_data_workbench_workspace')[1];
    expect(params.p_operations.historyChanges[0].changes).toEqual({ character_id: entity.id, character_name: entity.name, item_name: entity.name, rarity: 6 });
    expect(params.p_operations.supplementChanges[0].entry.source).toBe('file');
    const committed = await request('POST', { ...body, action: 'commit', validationToken: TOKEN });
    expect(committed.statusCode).toBe(200); expect(committed.body.result).toMatchObject({ saved: 0, historyUpdated: 1, supplementsUpdated: 1, operationCount: 2 });
    expect(db.rpc.mock.calls.filter(([name]) => name === 'commit_account_data_workbench_workspace')).toHaveLength(1);
    expect(db.rpc.mock.calls.some(([name]) => ['update_history_record_controlled', 'mutate_account_data_workbench_entry', 'commit_account_data_workbench'].includes(name))).toBe(false);
  });

  it.each(['history', 'supplement'])('validates and commits only %s changes with zero new entries', async mode => {
    const original = { ...row(), kind: 'pool-ledger', source: 'xhh', values: ledger().values, time_precision: 'unknown' };
    const db = database({ context: { ...emptyContext(), entries: [original], history: [historyRow({ character_id: null, rarity: 4, edit_version: 1 })] } });
    const body = workspacePayload({ entries: [],
      historyChanges: mode === 'history' ? [historyChange()] : [],
      supplementChanges: mode === 'supplement' ? [{ id: ID, expectedRevision: 1, action: 'update',
        entry: ledger({ values: { totalPulls: 51, fourStarCount: 46 } }), reason: '完善存档' }] : [],
    });
    const validation = await request('POST', { ...body, action: 'validate' });
    expect(validation.statusCode).toBe(200);
    expect(validation.body.preview).toMatchObject({ canCommit: true, entries: [], operationCount: 1 });
    expect(validation.body.validationToken).toBe(TOKEN);
    const committed = await request('POST', { ...body, action: 'commit', validationToken: TOKEN });
    expect(committed.statusCode).toBe(200);
    expect(committed.body.result).toMatchObject({ saved: 0, entryIds: [], operationCount: 1,
      historyUpdated: mode === 'history' ? 1 : 0, supplementsUpdated: mode === 'supplement' ? 1 : 0,
    });
    const operations = db.rpc.mock.calls.find(([name]) => name === 'validate_account_data_workbench_workspace')[1].p_operations;
    expect(operations.entries).toEqual([]);
    if (mode === 'supplement') expect(operations.supplementChanges[0].entry.source).toBe('xhh');
    expect(db.rpc.mock.calls.filter(([name]) => name === 'commit_account_data_workbench_workspace')).toHaveLength(1);
    expect(db.rpc.mock.calls.some(([name]) => ['update_history_record_controlled', 'mutate_account_data_workbench_entry', 'commit_account_data_workbench'].includes(name))).toBe(false);
  });

  it('does not issue credentials for duplicate coverage, rule violations or revision conflicts', async () => {
    const original = { ...row(), kind: 'pool-ledger', values: ledger().values, time_precision: 'unknown' };
    const db = database({ context: { ...emptyContext(), entries: [original] } });
    const duplicate = await request('POST', { ...workspacePayload({ entries: [ledger({ entryId: ENTRY_B })] }), action: 'validate' });
    expect(duplicate.body.preview.canCommit).toBe(false); expect(duplicate.body.validationToken).toBeNull();
    const conflict = await request('POST', { ...workspacePayload({ entries: [], supplementChanges: [{ id: ID, expectedRevision: 2,
      action: 'update', entry: ledger(), reason: '' }] }), action: 'validate' });
    expect(codes(conflict.body.preview)).toContain('workbench_revision_conflict');
    expect(conflict.body.validationToken).toBeNull();
    expect(db.rpc.mock.calls.some(([name]) => name === 'validate_account_data_workbench_workspace')).toBe(false);
    database();
    const violation = await request('POST', { ...workspacePayload({ entries: [ledger({ values: { pity: 80 } })] }), action: 'validate' });
    expect(codes(violation.body.preview)).toContain('pity_over_hard_limit'); expect(violation.body.validationToken).toBeNull();
  });

  it('permits deleting and replacing saved coverage in a single atomic draft', async () => {
    const original = { ...row(), kind: 'pool-ledger', values: ledger().values, time_precision: 'unknown' };
    database({ context: { ...emptyContext(), entries: [original] } });
    const body = workspacePayload({ entries: [ledger({ entryId: ENTRY_B })], supplementChanges: [{ id: ID, expectedRevision: 1, action: 'delete', reason: '重新整理' }] });
    const result = await request('POST', { ...body, action: 'validate' });
    expect(result.body.preview.canCommit).toBe(true); expect(result.body.validationToken).toBe(TOKEN);
  });

  it('blocks history moves into an existing official sequence before issuing a credential', async () => {
    const context = { ...emptyContext(), history: [historyRow({ edit_version: 1 }), historyRow({ id: 901, record_id: 'record-other', character_id: null, pool_id: 'pool_other' })] };
    const base = normalizeWorkspaceSubmission(workspacePayload({ entries: [], historyChanges: [historyChange({ changes: { poolId: 'pool_other' } })] }));
    const result = buildWorkspacePreview(base, context, { ...catalog(), pools: [...catalog().pools, { ...catalog().pools[0], id: 'pool_other', pool_id: 'pool_other' }] });
    expect(result.canCommit).toBe(false); expect(codes(result)).toContain('history_record_duplicate');
  });

  it.each(['workbench_validation_mismatch', 'workbench_validation_expired', 'workbench_catalog_changed', 'workbench_context_changed', 'workbench_rules_changed'])('maps database credential invalidation to a conflict: %s', async code => {
    const db = database();
    const read = db.rpc.getMockImplementation();
    db.rpc.mockImplementation((name, params) => name === 'commit_account_data_workbench_workspace'
      ? { data: null, error: { message: code, code: '40001' } } : read(name, params));
    const res = await request('POST', { ...workspacePayload(), action: 'commit', validationToken: TOKEN });
    expect(res.statusCode).toBe(409); expect(res.body.code).toBe(code);
    expect(db.rpc.mock.calls.filter(([name]) => name === 'commit_account_data_workbench_workspace')).toHaveLength(1);
  });

  it('rejects scope spoofing, forbidden identity fields, invalid count and noncatalog acquisitions', async () => {
    const db = database();
    const spoof = await request('POST', { ...workspacePayload({ historyChanges: [historyChange({ gameUid: 'other' })] }), action: 'validate' });
    expect(spoof.body.code).toBe('workbench_scope_mismatch'); expect(db.rpc).not.toHaveBeenCalled();
    const injected = ledger({ values: { acquisitions: [{ ...ledger().values.acquisitions[0], seqId: 'fake' }] } });
    const injectRes = await request('POST', { ...workspacePayload({ entries: [injected] }), action: 'validate' });
    expect(codes(injectRes.body.preview)).toContain('workbench_unknown_value_field');
    const malformed = await request('POST', { ...workspacePayload({ entries: [ledger({ values: { totalPulls: -1 } })] }), action: 'validate' });
    expect(codes(malformed.body.preview)).toContain('invalid_count');
    const badEntity = await request('POST', { ...workspacePayload({ entries: [ledger({ values: { acquisitions: [{ ...ledger().values.acquisitions[0], entityId: 'fake' }] } })] }), action: 'validate' });
    expect(codes(badEntity.body.preview)).toContain('entity_required');
  });

  it('binds changes and draft revision in canonical payload hashes', () => {
    const base = normalizeWorkspaceSubmission(workspacePayload());
    expect(payloadFingerprint(base)).not.toBe(payloadFingerprint({ ...base, draftRevision: 4 }));
    expect(payloadFingerprint(base)).not.toBe(payloadFingerprint({ ...base, historyChanges: [historyChange()] }));
    expect(payloadFingerprint(base)).not.toBe(payloadFingerprint({ ...base, entries: [ledger({ source: 'file' })] }));
    const result = buildWorkspacePreview(base, emptyContext(), catalog());
    expect(result.canCommit).toBe(true);
  });

  it('accepts compact deterministic fills from the shared builder without changing the request hash', async () => {
    const four = { id: 'char_four', name: '四星角色', rarity: 4, type: 'character', pool_config: { pools: ['standard'] } };
    const generated = buildPoolLedgerEntry({ entryId: ENTRY, poolId: pool.pool_id, source: 'file', values: ledger().values },
      { entities: [entity, four], pools: [{ ...pool, id: pool.pool_id }] });
    generated.reviewState = 'confirmed';
    generated.values.totalPulls = '50';
    const db = database({ catalogEntities: [entity, four], roster: [entity, four].map(item => ({ pool_id: pool.pool_id, character_id: item.id })) });
    const body = workspacePayload({ entries: [generated] });
    const fingerprint = payloadFingerprint(normalizeWorkspaceSubmission(body));
    const res = await request('POST', { ...body, action: 'validate' });
    expect(res.statusCode).toBe(200); expect(res.body.preview.issues).toEqual([]); expect(res.body.validationToken).toBe(TOKEN);
    const params = db.rpc.mock.calls.find(([name]) => name === 'validate_account_data_workbench_workspace')[1];
    expect(params.p_operations.entries[0].values.inferredFill).toMatchObject({ count: 45, entityIds: ['char_four'], derivation: 'inferred' });
    expect(params.p_operations.entries[0].values.totalPulls).toBe(50);
    expect(params.p_request.entries[0].values.totalPulls).toBe('50');
    expect(payloadFingerprint(params.p_request)).toBe(fingerprint);
    expect(params.p_payload_hash).toBe(fingerprint);
  });

  it('keeps backup preview and commit usable for ledgers while enforcing shared rules', async () => {
    const db = database();
    const body = { ...payload([ledger()]), action: 'commit' };
    expect((await request('POST', body)).statusCode).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith('commit_account_data_workbench', expect.anything());
    const saved = db.rpc.mock.calls.find(([name]) => name === 'commit_account_data_workbench')[1];
    expect(saved.p_entries[0].source).toBe('xhh');
    const invalid = await request('POST', { ...payload([ledger({ values: { pity: 80 } })]), action: 'preview' });
    expect(codes(invalid.body.preview)).toContain('pity_over_hard_limit');
    expect(invalid.body.preview.canCommit).toBe(false);
  });
});

describe('data workbench API', () => {
  it.each(['PATCH', 'DELETE'])('blocks %s on an unopened saved pool', async method => {
    const db = database({ ownEntry: row(), catalogPools: [{ ...pool, start_time: '2099-01-01' }] });
    const res = await request(method, { id: ID, expectedRevision: 1, entry: detail(), reason: '调整' });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('pool_not_open');
    expect(db.rpc.mock.calls.some(([name]) => name.startsWith('mutate_'))).toBe(false);
  });

  it('blocks summary submission when existing detail times cannot establish coverage', async () => {
    database({ context: { ...emptyContext(), history: [historyRow({ timestamp: null })] } });
    const res = await request('POST', { ...payload([summary({ values: { totalPulls: 180 } })]), action: 'commit' });
    expect(res.statusCode).toBe(409);
    expect(codes(res.body.preview)).toContain('coverage_time_unknown');
    expect(mocks.admin().rpc).not.toHaveBeenCalledWith('commit_account_data_workbench', expect.anything());
  });

  it('requires authentication and rejects browser origins before database access', async () => {
    const db = database();
    mocks.auth.mockResolvedValue({ ok: false, status: 401 });
    expect((await request('GET', null, '?gameUid=123456&serverScope=1')).statusCode).toBe(401);
    expect(db.rpc).not.toHaveBeenCalled();
    mocks.origin.mockReturnValue(true);
    await request('POST', payload());
    expect(mocks.auth).toHaveBeenCalledTimes(1);
  });

  it('lists only requested owner scope and omits deleted rows', async () => {
    const db = database({ context: { ...emptyContext(), entries: [row(), { ...row(), id: COMMIT, deleted_at: '2026-02-01' }] } });
    const res = await request('GET', null, '?gameUid=123456&serverScope=1&user_id=other');
    expect(res.statusCode).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0]).toMatchObject({ id: ID, entryId: ENTRY, reviewState: 'confirmed' });
    expect(db.rpc).toHaveBeenCalledWith('read_account_data_workbench_context', { p_user_id: OWNER, p_game_uid: '123456', p_server_scope: '1' });
  });

  it('returns metrics alongside preview and never mutates storage', async () => {
    const db = database();
    const res = await request('POST', { ...payload([summary({ values: { totalPulls: 180, sixStarCount: 1 } })]), action: 'preview' });
    expect(res.statusCode).toBe(200);
    expect(res.body.preview.canCommit).toBe(true);
    expect(res.body.preview.metrics.combined).toMatchObject({ totalPulls: 180, sixStarCount: 1 });
    expect(db.rpc.mock.calls.some(([name]) => name === 'commit_account_data_workbench')).toBe(false);
  });

  it('revalidates commit, authenticates the owner and preserves the portable channel', async () => {
    const db = database();
    const body = payload();
    body.user_id = 'attacker';
    body.entries[0].source = 'xhh';
    const res = await request('POST', { ...body, action: 'commit', preview: { canCommit: true } });
    expect(res.body.preview?.issues || []).toEqual([]);
    expect(res.statusCode).toBe(200);
    const params = db.rpc.mock.calls.find(([name]) => name === 'commit_account_data_workbench')[1];
    expect(params.p_user_id).toBe(OWNER);
    expect(params.p_context_token).toBe('snapshot-token');
    expect(params.p_entries[0]).toMatchObject({ kind: 'detail', entryId: ENTRY });
    expect(params.p_entries[0].source).toBe('xhh');
    const invalid = payload([detail({ reviewState: 'unreviewed' })]);
    expect((await request('POST', { ...invalid, action: 'commit', preview: { canCommit: true } })).statusCode).toBe(409);
    expect(db.rpc.mock.calls.filter(([name]) => name === 'commit_account_data_workbench')).toHaveLength(1);
  });

  it('supports matching retries and rejects different payloads with the same commitId', async () => {
    const result = { commitId: COMMIT, saved: 1, entryIds: [ID] };
    const db = database({ commit: { payload_hash: payloadFingerprint(normalizeSubmission(payload())), result } });
    expect((await request('POST', { ...payload(), action: 'commit' })).body.result).toEqual(result);
    expect(db.rpc).not.toHaveBeenCalled();
    const changed = payload([detail({ values: { notes: 'different' } })]);
    const res = await request('POST', { ...changed, action: 'commit' });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('workbench_idempotency_conflict');
    expect((await request('GET', null, `?commitId=${COMMIT}`)).body.result).toEqual(result);
    expect(db.queries.every((query) => query.filters.some(([name, field, value]) => name === 'eq' && field === 'user_id' && value === OWNER))).toBe(true);
  });

  it.each([false, true])('resolves a concurrent commit before reporting blocked preview (changed payload: %s)', async (changed) => {
    const result = { commitId: COMMIT, saved: 1, entryIds: [ID] };
    const saved = { payload_hash: payloadFingerprint(normalizeSubmission(payload())), result };
    const commit = vi.fn().mockReturnValueOnce(null).mockReturnValue(saved);
    const db = database({ commit, context: { ...emptyContext(), entries: [row()] } });
    const body = changed ? payload([detail({ values: { notes: '另一次编辑' } })]) : payload();
    const res = await request('POST', { ...body, action: 'commit' });
    expect(res.statusCode).toBe(changed ? 409 : 200);
    if (changed) expect(res.body.code).toBe('workbench_idempotency_conflict');
    else expect(res.body.result).toEqual(result);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(db.rpc.mock.calls.some(([name]) => name === 'commit_account_data_workbench')).toBe(false);
  });

  it.each([[], Array(101).fill(detail())])('rejects batches outside 1..100 without truncation', async (entries) => {
    const db = database();
    const res = await request('POST', { ...payload(entries), action: 'commit', entries });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('invalid_workbench_batch');
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('rejects duplicate entry IDs and invalid JSON', async () => {
    database();
    expect((await request('POST', { ...payload([detail(), detail()]), action: 'commit', entries: [detail(), detail()] })).body.code).toBe('duplicate_workbench_entry_id');
    expect((await request('POST', '{broken')).body.code).toBe('invalid_json');
  });

  it('blocks a detail that duplicates an official pull before commit', async () => {
    const db = database({ context: { ...emptyContext(), history: [historyRow()] } });
    const res = await request('POST', { ...payload(), action: 'commit' });
    expect(res.statusCode).toBe(409);
    expect(res.body.preview.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'detail_covered', conflictSource: 'history', conflictId: 'record-1' }),
    ]));
    expect(db.rpc.mock.calls.some(([name]) => name === 'commit_account_data_workbench')).toBe(false);
  });

  it('edits no-sequence entries using CAS and excludes itself from duplicates', async () => {
    const db = database({ ownEntry: row(), context: { ...emptyContext(), entries: [row()] } });
    const res = await request('PATCH', { id: ID, expectedRevision: 1, entry: detail({ values: { notes: '修正说明' } }) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ revision: 2, entry: { id: ID, values: { notes: '修正说明' } } });
    expect(db.rpc).toHaveBeenCalledWith('mutate_account_data_workbench_entry', expect.objectContaining({ p_id: ID, p_expected_revision: 1, p_action: 'update', p_user_id: OWNER }));
  });

  it('anchors edits to the saved owner, scope, and entry identity', async () => {
    const db = database({ ownEntry: row(), context: { ...emptyContext(), entries: [row()] } });
    const res = await request('PATCH', {
      id: ID, expectedRevision: 1, user_id: 'other', scope: { gameUid: 'other', serverScope: '2' },
      entry: { ...detail({ entryId: ENTRY_B }), source: 'official', draftId: COMMIT },
    });
    expect(res.statusCode).toBe(200);
    expect(db.queries[0].filters).toContainEqual(['eq', 'user_id', OWNER]);
    expect(db.rpc).toHaveBeenCalledWith('read_account_data_workbench_context', {
      p_user_id: OWNER, p_game_uid: SCOPE.gameUid, p_server_scope: SCOPE.serverScope,
    });
    expect(db.rpc).toHaveBeenCalledWith('mutate_account_data_workbench_entry', expect.objectContaining({
      p_user_id: OWNER, p_entry: expect.objectContaining({ entryId: ENTRY, source: 'manual' }),
    }));
  });

  it.each(['PATCH', 'DELETE'])('returns current values for stale %s revisions', async (method) => {
    const db = database({ ownEntry: { ...row(), revision: 3, values: { ...detail().values, notes: '服务器修订' } } });
    const res = await request(method, { id: ID, expectedRevision: 1, entry: detail(), reason: '重复' });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'workbench_revision_conflict', latest: {
      id: ID, revision: 3, values: { notes: '服务器修订' }, scope: SCOPE,
    } });
    expect(res.body.latest).not.toHaveProperty('user_id');
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it.each(['workbench_revision_conflict', 'workbench_context_changed'])('returns latest after database %s races', async (code) => {
    const revision = code === 'workbench_revision_conflict' ? 2 : 1;
    const ownEntry = vi.fn().mockReturnValueOnce(row()).mockReturnValue({ ...row(), revision });
    const db = database({ ownEntry, context: { ...emptyContext(), entries: [row()] } });
    const rpc = db.rpc.getMockImplementation();
    db.rpc.mockImplementation((name, params) => name === 'mutate_account_data_workbench_entry'
      ? Promise.resolve({ error: { code: '40001', message: code } })
      : rpc(name, params));
    const res = await request('PATCH', { id: ID, expectedRevision: 1, entry: detail() });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code, latest: { id: ID, revision } });
    const reads = db.queries.filter((query) => query.table === 'account_data_workbench_entries');
    expect(reads).toHaveLength(2);
    expect(reads.every((query) => query.filters.some(([name, field, value]) => name === 'eq' && field === 'user_id' && value === OWNER))).toBe(true);
    expect(reads[1].filters).not.toContainEqual(['is', 'deleted_at', null]);
  });

  it('reports a revision change discovered while building preview with latest values', async () => {
    const db = database({ ownEntry: row(), context: { ...emptyContext(), entries: [{ ...row(), revision: 2 }] } });
    const res = await request('PATCH', { id: ID, expectedRevision: 1, entry: detail() });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'workbench_revision_conflict', latest: { id: ID, revision: 2 } });
    expect(db.rpc.mock.calls.some(([name]) => name === 'mutate_account_data_workbench_entry')).toBe(false);
  });

  it('returns deletion state when a stale edit refers to a tombstone', async () => {
    const db = database({ ownEntry: { ...row(), revision: 2, deleted_at: '2026-02-01' } });
    const res = await request('PATCH', { id: ID, expectedRevision: 1, entry: detail() });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'workbench_revision_conflict', latest: { id: ID, revision: 2, deletedAt: '2026-02-01' } });
    expect((await request('PATCH', { id: ID, expectedRevision: 2, entry: detail() })).statusCode).toBe(404);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('returns the deleted revision when deletion wins after the first read', async () => {
    const ownEntry = vi.fn().mockReturnValueOnce(row()).mockReturnValue({ ...row(), revision: 2, deleted_at: '2026-02-01' });
    const db = database({ ownEntry, rpcError: { message: 'workbench_entry_not_found' } });
    const res = await request('DELETE', { id: ID, expectedRevision: 1, reason: '重复' });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'workbench_revision_conflict', latest: { id: ID, revision: 2, deletedAt: '2026-02-01' } });
    expect(db.rpc.mock.calls.filter(([name]) => name === 'mutate_account_data_workbench_entry')).toHaveLength(1);
  });

  it('soft deletes without an official sequence after checking the pool opening time', async () => {
    const db = database({ ownEntry: row() });
    const res = await request('DELETE', { id: ID, expectedRevision: 1, reason: '重复补录' });
    expect(res.statusCode).toBe(200);
    expect(res.body.entries[0].deletedAt).toBeTruthy();
    expect(db.rpc.mock.calls.filter(([name]) => name === 'mutate_account_data_workbench_entry')).toHaveLength(1);
    expect(db.rpc).toHaveBeenCalledWith('mutate_account_data_workbench_entry', expect.objectContaining({ p_action: 'delete', p_reason: '重复补录', p_expected_revision: 1 }));
  });

  it('rejects stale revisions, other owners, and missing delete reasons', async () => {
    let db = database({ ownEntry: { ...row(), revision: 2 } });
    expect((await request('PATCH', { id: ID, expectedRevision: 1, entry: detail() })).statusCode).toBe(409);
    expect(db.rpc).not.toHaveBeenCalled();
    db = database();
    expect((await request('DELETE', { id: ID, expectedRevision: 1, reason: 'test' })).statusCode).toBe(404);
    expect(db.queries[0].filters).toContainEqual(['eq', 'user_id', OWNER]);
    database({ ownEntry: row() });
    expect((await request('DELETE', { id: ID, expectedRevision: 1 })).statusCode).toBe(400);
  });

  it.each(['42P01', 'PGRST202', 'PGRST205'])('reports missing migration %s as 503', async (code) => {
    database({ rpcError: { code } });
    const res = await request('GET', null, '?gameUid=123456&serverScope=1');
    expect(res.statusCode).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('workbench_unavailable');
  });

  it('surfaces database concurrency conflicts', async () => {
    const db = database();
    db.rpc.mockImplementation(async (name) => name === 'commit_account_data_workbench'
      ? { error: { code: '40001', message: 'workbench_context_changed' } }
      : { data: name === 'get_app_visible_pools' ? [pool] : emptyContext() });
    expect((await request('POST', { ...payload(), action: 'commit' })).body.code).toBe('workbench_context_changed');
  });
});

describe('workbench preview coverage rules', () => {
  it('lets a 180-pull summary coexist with 100 known pulls and adds the unknown remainder', () => {
    const result = preview([
      summary({ values: { totalPulls: 180, sixStarCount: 1 } }),
    ], { ...emptyContext(), history: Array.from({ length: 100 }, (_, index) => historyRow({
      id: 900 + index, seq_id: `seq-${index}`, record_id: `record-${index}`, rarity: index === 0 ? 6 : 4,
    })) });
    expect(result.canCommit).toBe(true);
    expect(result.metrics.confirmed).toMatchObject({ totalPulls: 100, sixStarCount: 1 });
    expect(result.metrics.supplemental).toMatchObject({ totalPulls: 80, sixStarCount: 0 });
    expect(result.metrics.combined).toMatchObject({ totalPulls: 180, sixStarCount: 1 });
    expect(result.metrics.coverage.ranges[0]).toMatchObject({ entryId: ENTRY_B, delta: { totalPulls: 80 } });
  });

  it('blocks a summary that claims fewer pulls than the details already inside its range', () => {
    const result = preview([summary({ values: { totalPulls: 1 } })], { ...emptyContext(), history: [
      historyRow(), historyRow({ id: 901, seq_id: 'seq-2', record_id: 'record-2' }),
    ] });
    expect(result.canCommit).toBe(false);
    expect(codes(result)).toContain('summary_less_than_details');
  });

  it('blocks summaries that overlap by range and draw method', () => {
    const result = preview([
      summary(),
      summary({ entryId: ENTRY_C, values: { rangeStart: '2026-01-15T00:00:00Z', rangeEnd: '2026-02-15T00:00:00Z' } }),
    ]);
    expect(result.canCommit).toBe(false);
    expect(codes(result)).toContain('overlapping_summaries');
  });

  it('treats adjacent ranges as half-open instead of overlapping', () => {
    const result = preview([
      summary({ values: { rangeEnd: '2026-01-15T00:00:00Z' } }),
      summary({ entryId: ENTRY_C, values: { rangeStart: '2026-01-15T00:00:00Z', rangeEnd: '2026-02-01T00:00:00Z' } }),
    ]);
    expect(result.canCommit).toBe(true);
    expect(codes(result)).not.toContain('overlapping_summaries');
  });

  it('keeps a six-star interval usable even when the same range holds details', () => {
    const result = preview([
      interval(),
    ], { ...emptyContext(), history: [historyRow()] });
    expect(result.canCommit).toBe(true);
    expect(result.metrics.intervals).toEqual([{ entryId: ENTRY_C, pulls: 62 }]);
  });

  it('blocks duplicate details from history, from saved entries, and inside one batch', () => {
    expect(codes(preview([detail()], { ...emptyContext(), history: [historyRow()] }))).toContain('detail_covered');
    expect(codes(preview([detail()], { ...emptyContext(), entries: [row()] }))).toContain('workbench_overlap');
    const duplicated = preview([detail(), detail({ entryId: ENTRY_C })]);
    expect(duplicated.canCommit).toBe(false);
    expect(codes(duplicated)).toContain('workbench_overlap');
  });

  it('allows the same entity at a different timestamp', () => {
    const other = preview([detail()], { ...emptyContext(), history: [historyRow({ timestamp: '2026-01-11T01:00:00Z', record_id: 'record-2' })] });
    expect(other.canCommit).toBe(true);
  });

  it('does not let an older covered entry block an unrelated new detail', () => {
    const result = preview([detail({ entryId: ENTRY_B, values: { timestamp: '2026-01-11T01:00:00Z' } })], {
      ...emptyContext(), entries: [row()], history: [historyRow()],
    });
    expect(result.canCommit).toBe(true);
    expect(result.metrics.combined.totalPulls).toBe(2);
  });

  it('blocks potential evidence that duplicates a pull or another evidence reference', () => {
    const evidence = detail({
      entryId: ENTRY_B, kind: 'potential-evidence',
      values: { evidenceRef: '活动奖励#1' },
    });
    expect(codes(preview([evidence], { ...emptyContext(), history: [historyRow()] }))).toContain('workbench_overlap');
    const duplicatedEvidence = [
      evidence,
      detail({ entryId: ENTRY_C, kind: 'potential-evidence', values: { evidenceRef: '活动奖励#1' } }),
    ];
    expect(preview(duplicatedEvidence).canCommit).toBe(false);
    const distinctEvidence = preview([
      evidence,
      detail({ entryId: ENTRY_C, kind: 'potential-evidence', values: { evidenceRef: '活动奖励#2' } }),
    ]);
    expect(distinctEvidence.canCommit).toBe(true);
  });
});

describe('workbench catalog rules', () => {
  it('rejects unknown values and official sequence fields', () => {
    const result = preview([detail({ values: { seq_id: 'official-pretend' } })]);
    expect(codes(result)).toContain('invalid_workbench_values');
    expect(result.canCommit).toBe(false);
  });

  it('requires a standard visible pool and a matching entity type', () => {
    expect(preview([detail()], emptyContext(), { ...catalog(), pools: [] }).canCommit).toBe(false);
    expect(preview([detail()], emptyContext(), { ...catalog(), entities: [{ ...entity, type: 'weapon' }] }).canCommit).toBe(false);
  });

  it('requires complete roster membership and consistent release timing', () => {
    const missingFromRoster = preview([detail()], emptyContext(), {
      ...catalog(),
      pools: [{ ...catalog().pools[0], six_star_entities: [] }],
    });
    expect(codes(missingFromRoster)).toContain('entity_not_in_historical_roster');
    // 名单包含该实体也不能覆盖明确矛盾的发行时间。
    const lateRelease = preview([detail()], emptyContext(), {
      ...catalog(),
      entities: [{ ...entity, release_date: '2026-03-01' }],
    });
    expect(codes(lateRelease)).toContain('entity_not_released');
  });

  it('blocks an absent entity in a complete roster even when general pool config allows it', () => {
    const result = preview([detail()], emptyContext(), {
      entities: [{ ...entity, pool_config: { pools: ['standard', 'limited'] } }],
      pools: [{ ...catalog().pools[0], six_star_entities: [] }],
    });
    expect(result.canCommit).toBe(false);
    expect(codes(result)).toContain('entity_not_in_historical_roster');
  });

  it('does not require a complete roster before catalog audit', () => {
    const partial = preview([detail()], emptyContext(), {
      ...catalog(),
      pools: [{ ...catalog().pools[0], roster_status: 'partial' }],
    });
    expect(partial.canCommit).toBe(true);
  });

  it('allows permanent pools to reuse their own roster configuration', () => {
    const standard = preview([detail({ poolId: 'standard' })], emptyContext(), {
      entities: [{ ...entity, pool_config: { pools: ['standard'] }, release_date: null }],
      pools: [{ id: 'standard', pool_id: 'standard', type: 'standard', roster_status: 'missing', start_time: null, end_time: null, six_star_entities: [] }],
    });
    expect(standard.canCommit).toBe(true);
  });

  it('does not admit limited-only entities to permanent pools without roster evidence', () => {
    const result = preview([detail({ poolId: 'standard' })], emptyContext(), {
      entities: [{ ...entity, pool_config: { pools: ['limited'] } }],
      pools: [{ id: 'standard', type: 'standard', roster_status: 'missing', six_star_entities: [] }],
    });
    expect(result.canCommit).toBe(false);
    expect(codes(result)).toContain('entity_not_in_historical_roster');
  });
});
