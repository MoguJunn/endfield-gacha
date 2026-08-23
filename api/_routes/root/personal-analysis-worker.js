import { getSupabaseAdminClient } from '../../_lib/authAdmin.js';
import { rejectDisallowedBrowserOrigin } from '../../_lib/http.js';
import { runPersonalAnalysisWorker } from '../../_lib/personalAnalysisWorker.js';

function readEnvironment() {
  return globalThis.process?.env || {};
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
    const result = await runPersonalAnalysisWorker({ adminClient });
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
};
