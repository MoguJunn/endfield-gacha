// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), auth: vi.fn(), client: vi.fn() }));
vi.mock('../_lib/authAdmin.js', () => ({ getSupabaseAdminClient: mocks.client }));
vi.mock('../_lib/siteAuth.js', () => ({ resolveAuthenticatedRequestUser: mocks.auth }));
vi.mock('../_lib/http.js', () => ({ rejectDisallowedBrowserOrigin: () => false }));
import handler from '../_routes/root/data-workbench.js';

const owner = 'cd3eeb45-aa34-4ea1-a504-b745c0eb5e6a';
const requestId = 'bbd869e3-4dd6-4183-a86f-f37974c2cc03';
const response = () => ({ statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; },
  status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; }, end() {} });
const post = async body => {
  const res = response(); await handler({ method: 'POST', url: '/api/data-workbench', headers: {}, body }, res); return res;
};
beforeEach(() => {
  vi.clearAllMocks(); mocks.client.mockReturnValue({ rpc: mocks.rpc });
  mocks.auth.mockResolvedValue({ ok: true, user: { id: owner } });
});
describe('account revision routes', () => {
  it('rejects an unauthenticated caller before reading any revision', async () => {
    mocks.auth.mockResolvedValue({ ok: false, status: 401 });
    const res = response(); await handler({ method: 'GET', url: '/api/data-workbench?mode=revisions', headers: {} }, res);
    expect(res.statusCode).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('reads only the authenticated owner even with a forged owner query', async () => {
    mocks.rpc.mockResolvedValue({ data: { versions: [], limit: 5, retentionDays: 180 }, error: null });
    const res = response(); await handler({ method: 'GET', url: '/api/data-workbench?mode=revisions&userId=other', headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('list_account_data_revisions', { p_user_id: owner });
  });
  it('ignores a forged owner and preserves large integer revision IDs as strings', async () => {
    mocks.rpc.mockResolvedValue({ data: { targetId: '9007199254740993', changes: [], token: 'a'.repeat(32) }, error: null });
    const res = await post({ mode: 'revisions', action: 'preview-revert', targetId: '9007199254740993', userId: 'other' });
    expect(res.statusCode).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('preview_account_data_revert', { p_user_id: owner, p_target_id: '9007199254740993' });
  });
  it('requires a preview and UUID request before a mutation', async () => {
    const res = await post({ mode: 'revisions', action: 'revert', targetId: '1', requestId });
    expect(res.statusCode).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects SQL integer overflow instead of passing it to the database', async () => {
    const res = await post({ mode: 'revisions', action: 'preview-revert', targetId: '9223372036854775808' });
    expect(res.statusCode).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['account_revision_expired', 'account_revision_context_changed', 'account_revision_conflict'])(
    'returns a controlled conflict for %s', async code => {
      mocks.rpc.mockResolvedValue({ data: null, error: { message: code } });
      const res = await post({ mode: 'revisions', action: 'revert', targetId: '1', token: 'a'.repeat(32), requestId });
      expect(res.statusCode).toBe(409); expect(res.body.code).toBe(code);
      expect(mocks.rpc).toHaveBeenCalledWith('revert_account_data_revision', { p_user_id: owner, p_target_id: '1', p_token: 'a'.repeat(32), p_request_id: requestId });
    });
  it('returns the database receipt for an exact retry without making another type of write', async () => {
    mocks.rpc.mockResolvedValue({ data: { revisionId: '2', targetId: '1', changed: 1, replayed: true }, error: null });
    const res = await post({ mode: 'revisions', action: 'revert', targetId: '1', token: 'a'.repeat(32), requestId });
    expect(res.body.result).toMatchObject({ revisionId: '2', replayed: true }); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
