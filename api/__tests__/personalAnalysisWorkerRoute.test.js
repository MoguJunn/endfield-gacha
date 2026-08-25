// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseAdminClient: vi.fn(),
  runPersonalAnalysisWorker: vi.fn(),
}));

vi.mock('../_lib/authAdmin.js', () => ({
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
}));

vi.mock('../_lib/personalAnalysisWorker.js', () => ({
  runPersonalAnalysisWorker: mocks.runPersonalAnalysisWorker,
}));

import handler, { __internal } from '../_routes/root/personal-analysis-worker.js';

function createRequest(method = 'GET', headers = {}, body = undefined) {
  return { method, headers, body };
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    ended: false,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    getHeader(name) { return this.headers[name]; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { this.ended = true; return this; },
  };
}

describe('personal analysis worker route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PERSONAL_ANALYSIS_WORKER_SECRET;
    delete process.env.CRON_SECRET;
  });

  it('fails closed when no worker secret is configured', async () => {
    const res = createResponse();
    await handler(createRequest(), res);

    expect(__internal.authorizePersonalAnalysisWorkerRequest(createRequest(), {})).toEqual({
      ok: false,
      status: 503,
      error: 'Personal analysis worker secret is not configured',
    });
    expect(res.statusCode).toBe(503);
    expect(mocks.getSupabaseAdminClient).not.toHaveBeenCalled();
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('rejects a wrong secret before creating the admin client', async () => {
    process.env.PERSONAL_ANALYSIS_WORKER_SECRET = 'worker-secret';
    const res = createResponse();
    await handler(createRequest('POST', {
      'x-personal-analysis-worker-secret': 'wrong-secret',
    }), res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ success: false, error: 'Unauthorized' });
    expect(mocks.getSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it('returns 503 when the protected route has no admin client', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    mocks.getSupabaseAdminClient.mockReturnValue(null);
    const res = createResponse();
    await handler(createRequest('GET', {
      authorization: 'Bearer cron-secret',
    }), res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ success: false, error: 'Auth admin not configured' });
    expect(mocks.runPersonalAnalysisWorker).not.toHaveBeenCalled();
  });

  it('runs successfully with the dedicated header secret', async () => {
    process.env.PERSONAL_ANALYSIS_WORKER_SECRET = 'worker-secret';
    const adminClient = { rpc: vi.fn(), from: vi.fn() };
    const workerResult = {
      ok: true,
      skipped: false,
      code: 'personal_analysis_worker_completed',
      stats: { claimedOwner: 1, claimedScope: 0, succeeded: 1, stale: 0, failed: 0 },
      results: [{ kind: 'owner', status: 'succeeded', code: 'personal_analysis_snapshot_published' }],
    };
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.runPersonalAnalysisWorker.mockResolvedValue(workerResult);
    const res = createResponse();
    await handler(createRequest('POST', {
      'x-personal-analysis-worker-secret': 'worker-secret',
    }), res);

    expect(mocks.runPersonalAnalysisWorker).toHaveBeenCalledWith({ adminClient });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      partial: false,
      result: {
        ok: true,
        code: 'personal_analysis_worker_completed',
        batches: 1,
        stats: workerResult.stats,
        results: workerResult.results,
      },
    });
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('processes requested batches sequentially until the queue is empty', async () => {
    process.env.PERSONAL_ANALYSIS_WORKER_SECRET = 'worker-secret';
    const adminClient = { rpc: vi.fn(), from: vi.fn() };
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.runPersonalAnalysisWorker
      .mockResolvedValueOnce({
        ok: true,
        skipped: false,
        code: 'personal_analysis_worker_completed',
        stats: { claimedOwner: 1, claimedScope: 2, succeeded: 3, stale: 0, failed: 0 },
        results: [{ kind: 'owner', status: 'succeeded' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        skipped: false,
        code: 'personal_analysis_worker_completed',
        stats: { claimedOwner: 1, claimedScope: 1, succeeded: 2, stale: 0, failed: 0 },
        results: [{ kind: 'scope', status: 'succeeded' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        skipped: false,
        code: 'personal_analysis_worker_completed',
        stats: { claimedOwner: 0, claimedScope: 0, succeeded: 0, stale: 0, failed: 0 },
        results: [],
      });
    const res = createResponse();

    await handler(createRequest('POST', {
      authorization: 'Bearer worker-secret',
    }, {
      maxBatches: 4,
      timeBudgetMs: 45000,
    }), res);

    expect(mocks.runPersonalAnalysisWorker).toHaveBeenCalledTimes(3);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      partial: false,
      result: {
        batches: 3,
        timeBudgetReached: false,
        stats: {
          claimedOwner: 2,
          claimedScope: 3,
          succeeded: 5,
          stale: 0,
          failed: 0,
        },
      },
    });
  });

  it('accepts preflight requests without worker credentials', async () => {
    const res = createResponse();
    await handler(createRequest('OPTIONS'), res);

    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
    expect(mocks.getSupabaseAdminClient).not.toHaveBeenCalled();
  });
});
