import { getSupabaseAdminClient } from '../../_lib/authAdmin.js';
import { rejectDisallowedBrowserOrigin } from '../../_lib/http.js';
import { runPersonalAnalysisWorker } from '../../_lib/personalAnalysisWorker.js';

function readEnvironment() {
  return globalThis.process?.env || {};
}

function parseBoundedInteger(value, fallback, { min, max }) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function runPersonalAnalysisWorkerBatches({
  adminClient,
  maxBatches = 1,
  timeBudgetMs = 45000,
  now = () => Date.now(),
} = {}) {
  const startedAt = now();
  const aggregate = {
    ok: true,
    skipped: false,
    code: 'personal_analysis_worker_completed',
    backfill: null,
    stats: {
      claimedOwner: 0,
      claimedScope: 0,
      succeeded: 0,
      stale: 0,
      failed: 0,
    },
    results: [],
    batches: 0,
    timeBudgetReached: false,
  };

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const result = await runPersonalAnalysisWorker({ adminClient });
    if (result?.skipped === true) return result;

    aggregate.batches += 1;
    aggregate.backfill = result?.backfill || aggregate.backfill;
    aggregate.stats.claimedOwner += Number(result?.stats?.claimedOwner || 0);
    aggregate.stats.claimedScope += Number(result?.stats?.claimedScope || 0);
    aggregate.stats.succeeded += Number(result?.stats?.succeeded || 0);
    aggregate.stats.stale += Number(result?.stats?.stale || 0);
    aggregate.stats.failed += Number(result?.stats?.failed || 0);
    aggregate.results.push(...(Array.isArray(result?.results) ? result.results : []));

    if (result?.ok === false) {
      aggregate.ok = false;
      aggregate.code = 'personal_analysis_worker_partial_failure';
      break;
    }

    const claimed = Number(result?.stats?.claimedOwner || 0)
      + Number(result?.stats?.claimedScope || 0);
    if (claimed === 0) break;

    if (now() - startedAt >= timeBudgetMs) {
      aggregate.timeBudgetReached = true;
      break;
    }
  }

  return aggregate;
}

function getAcceptedSecrets(env = readEnvironment()) {
  return [
    env.PERSONAL_ANALYSIS_WORKER_SECRET,
    env.CRON_SECRET,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function readBearerToken(req) {
  return String(req.headers?.authorization || req.headers?.Authorization || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
}

function authorizePersonalAnalysisWorkerRequest(req, env = readEnvironment()) {
  const acceptedSecrets = getAcceptedSecrets(env);
  if (acceptedSecrets.length === 0) {
    return {
      ok: false,
      status: 503,
      error: 'Personal analysis worker secret is not configured',
    };
  }

  const providedSecrets = [
    readBearerToken(req),
    req.headers?.['x-personal-analysis-worker-secret'],
    req.headers?.['X-Personal-Analysis-Worker-Secret'],
    req.headers?.['x-cron-secret'],
    req.headers?.['X-Cron-Secret'],
  ].map((value) => String(value || '').trim()).filter(Boolean);

  if (providedSecrets.some((providedSecret) => acceptedSecrets.includes(providedSecret))) {
    return { ok: true };
  }

  return {
    ok: false,
    status: 401,
    error: 'Unauthorized',
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (rejectDisallowedBrowserOrigin(req, res, {
    methods: 'GET, POST, OPTIONS',
    headers: 'Content-Type, Authorization, X-Personal-Analysis-Worker-Secret, X-Cron-Secret',
  })) {
    return;
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const auth = authorizePersonalAnalysisWorkerRequest(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ success: false, error: auth.error });
  }

  const adminClient = getSupabaseAdminClient();
  if (!adminClient?.rpc || !adminClient?.from) {
    return res.status(503).json({ success: false, error: 'Auth admin not configured' });
  }

  try {
    const requestBody = req.body && typeof req.body === 'object' ? req.body : {};
    const maxBatches = parseBoundedInteger(requestBody.maxBatches, 1, {
      min: 1,
      max: 8,
    });
    const timeBudgetMs = parseBoundedInteger(requestBody.timeBudgetMs, 45000, {
      min: 5000,
      max: 50000,
    });
    const result = await runPersonalAnalysisWorkerBatches({
      adminClient,
      maxBatches,
      timeBudgetMs,
    });
    return res.status(200).json({
      success: true,
      partial: result.ok === false,
      result,
    });
  } catch {
    return res.status(500).json({
      success: false,
      error: 'Failed to run personal analysis worker',
    });
  }
}

export const __internal = {
  authorizePersonalAnalysisWorkerRequest,
  getAcceptedSecrets,
  parseBoundedInteger,
  runPersonalAnalysisWorkerBatches,
};
