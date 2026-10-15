import { randomUUID } from 'node:crypto';
import { readStatisticsPreviewDataset, readStatisticsScopeAggregate } from './statisticsScopeAggregate.js';
import { STATISTICS_SNAPSHOT_VERSION } from '../../shared/statisticsRefreshPolicy.js';
import { buildPersonalStatisticsSnapshot } from './personalStatisticsSnapshot.js';

const DEFER_CHANGED_SCOPE = Symbol('defer-changed-statistics-scope');

async function rpc(db, name, params, signal) {
  const query = db.rpc(name, params);
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  return data;
}

export async function runStatisticsWorker(db, { maxJobs = 8, timeBudgetMs = 240000, now = Date.now,
  aggregate = null, groupAggregate = null, personal = buildPersonalStatisticsSnapshot,
  datasetLoader = readStatisticsPreviewDataset, scopeAggregate = readStatisticsScopeAggregate,
  snapshotVersion = STATISTICS_SNAPSHOT_VERSION,
  onProgress = () => {} } = {}) {
  const started = now();
  const results = [];
  let shared = null;
  const computePublicScope = async (job, signal) => {
    if (!shared) {
      // Capture BEFORE reading history. A later claim may reuse the rows only
      // if its revision matches; publishing still checks the current revision.
      const revisions = await rpc(db, 'read_statistics_job_revisions', {}, signal);
      if (!revisions || typeof revisions !== 'object' || Array.isArray(revisions)) throw new Error('Statistics revisions unavailable');
      const dataset = await datasetLoader(db, { signal });
      shared = { revisions, dataset };
      onProgress({ phase: 'shared-history-ready', rows: dataset.history.length });
    }
    if (String(shared.revisions[job.scopeKey]) !== String(job.revision)) return DEFER_CHANGED_SCOPE;
    return scopeAggregate(db, job.scopeKey, { signal, dataset: shared.dataset });
  };
  for (let index = 0; index < maxJobs && now() - started < timeBudgetMs; index++) {
    const lease = randomUUID();
    const job = await rpc(db, 'claim_statistics_job', { p_lease: lease });
    if (!job) break;
    try {
      const params = { p_scope: job.scopeKey, p_revision: job.revision, p_lease: lease, p_schema: snapshotVersion };
      let published;
      if (job.scopeKey.startsWith('pool:') || job.scopeKey.startsWith('owner:') || job.scopeKey.startsWith('group:')) {
        const signal = AbortSignal.timeout(180000);
        const payload = job.scopeKey.startsWith('pool:')
          ? await (aggregate ? aggregate(db, job.scopeKey.slice(5), { signal }) : computePublicScope(job, signal))
          : job.scopeKey.startsWith('group:') ? await (groupAggregate ? groupAggregate(db, job.scopeKey.slice(6), { signal }) : computePublicScope(job, signal))
            : await personal(db, job.scopeKey.slice(6), { signal });
        if (payload === DEFER_CHANGED_SCOPE) {
          // Submit the captured revision through the existing conflict path.
          // It cannot match this claim, so no payload is written; the lease is
          // released and the database schedules its normal refresh cadence.
          published = await rpc(db, 'publish_statistics_snapshot', {
            ...params, p_revision: shared.revisions[job.scopeKey] ?? -1, p_payload: null,
          });
        } else {
          if (!payload) throw new Error('Empty statistics result');
          published = await rpc(db, 'publish_statistics_snapshot', { ...params, p_payload: payload });
        }
      } else published = await rpc(db, 'compute_and_publish_legacy_statistics', params);
      results.push({ scope: job.scopeKey.startsWith('owner:') ? 'personal' : job.scopeKey, status: published ? 'published' : 'changed-during-calculation' });
    } catch {
      await rpc(db, 'fail_statistics_job', { p_scope: job.scopeKey, p_lease: lease });
      results.push({ scope: job.scopeKey.startsWith('owner:') ? 'personal' : job.scopeKey, status: 'failed' });
    }
    onProgress({ phase: 'job-finished', ...results.at(-1), elapsedMs: now() - started });
  }
  return results;
}
