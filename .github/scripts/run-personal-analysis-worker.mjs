const workerUrl = String(process.env.WORKER_URL || '').trim();
const workerSecret = String(process.env.WORKER_SECRET || '').trim();
const protectionBypassSecret = String(process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '').trim();
const maxBatches = Math.min(8, Math.max(1, Number.parseInt(process.env.WORKER_MAX_BATCHES || '4', 10) || 4));

function validateConfiguration() {
  if (!workerSecret) {
    throw new Error('Repository secret PERSONAL_ANALYSIS_WORKER_SECRET is not configured');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(workerUrl);
  } catch {
    throw new Error('Repository variable PERSONAL_ANALYSIS_WORKER_URL is invalid');
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('PERSONAL_ANALYSIS_WORKER_URL must use HTTPS');
  }
  if (!parsedUrl.hostname.endsWith('.vercel.app')) {
    throw new Error(
      'PERSONAL_ANALYSIS_WORKER_URL must be an immutable Vercel deployment URL, not the frontend production domain'
    );
  }
  if (parsedUrl.pathname !== '/api/personal-analysis-worker') {
    throw new Error('PERSONAL_ANALYSIS_WORKER_URL must target /api/personal-analysis-worker');
  }
}

function summarizeResult(payload) {
  const result = payload?.result || {};
  const stats = result?.stats || {};
  return {
    code: result?.code || null,
    claimedOwner: Number(stats.claimedOwner || 0),
    claimedScope: Number(stats.claimedScope || 0),
    succeeded: Number(stats.succeeded || 0),
    stale: Number(stats.stale || 0),
    failed: Number(stats.failed || 0),
    backfillHasMore: Boolean(result?.backfill?.hasMore),
  };
}

function assertSuccessfulPayload(payload) {
  const result = payload?.result || {};
  if (payload?.success !== true || payload?.partial === true || result?.ok === false || result?.skipped === true) {
    throw new Error('Worker returned a partial, failed, or skipped result');
  }
}

async function callWorker() {
  const headers = {
    Authorization: `Bearer ${workerSecret}`,
    'Content-Type': 'application/json',
  };
  if (protectionBypassSecret) {
    headers['x-vercel-protection-bypass'] = protectionBypassSecret;
  }

  const response = await fetch(workerUrl, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(75_000),
  });
  const responseText = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error(`Worker returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`Worker returned HTTP ${response.status}`);
  }
  assertSuccessfulPayload(payload);
  return summarizeResult(payload);
}

async function callWorkerWithRetry(batchNumber) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await callWorker();
    } catch (error) {
      lastError = error;
      console.warn(`Worker batch ${batchNumber}/${maxBatches}, attempt ${attempt}/3 failed: ${error.message}`);
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 10_000));
      }
    }
  }
  throw lastError || new Error('Worker failed after 3 attempts');
}

async function main() {
  validateConfiguration();
  const totals = {
    batches: 0,
    claimedOwner: 0,
    claimedScope: 0,
    succeeded: 0,
    stale: 0,
    failed: 0,
  };

  for (let batchNumber = 1; batchNumber <= maxBatches; batchNumber += 1) {
    const summary = await callWorkerWithRetry(batchNumber);
    totals.batches += 1;
    totals.claimedOwner += summary.claimedOwner;
    totals.claimedScope += summary.claimedScope;
    totals.succeeded += summary.succeeded;
    totals.stale += summary.stale;
    totals.failed += summary.failed;
    console.log(JSON.stringify({ batch: batchNumber, ...summary }));

    if (summary.claimedOwner + summary.claimedScope === 0) {
      break;
    }
  }

  console.log(JSON.stringify({ completed: true, totals }));
}

main().catch((error) => {
  console.error(`Personal analysis worker failed: ${error.message}`);
  process.exitCode = 1;
});
