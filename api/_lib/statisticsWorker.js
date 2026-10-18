import { randomUUID } from 'node:crypto';
import { readStatisticsPreviewDataset, readStatisticsScopeAggregate, statisticsDatasetCoversScope } from './statisticsScopeAggregate.js';
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
  shouldYield = async () => false,
  onProgress = () => {} } = {}) {
  const started = now();
  const results = [];
  let shared = null;
  let sharedLoad = null;
  let sharedReadFailed = false;
  let nextPriorityCheck = 0;
  let failurePhase = 'compute';
  const yieldToPersonal = async (force = false) => {
    if (!force && now() < nextPriorityCheck) return;
    nextPriorityCheck = now() + 10000;
    if (await shouldYield()) {
      throw Object.assign(new Error('Personal analysis has priority'), { code: 'statistics_personal_priority' });
    }
  };
  const computePublicScope = async (job, signal) => {
    if (shared && !statisticsDatasetCoversScope(shared.dataset, job.scopeKey)) {
      // A weapon-only read must never be reused for character context or a
      // different weapon pool. Release the old rows before loading that scope.
      shared = null;
      sharedLoad = null;
    }
    if (!shared) {
      // Capture BEFORE reading history. A later claim may reuse the rows only
      // if its revision matches; publishing still checks the current revision.
      // Keep a failed attempt too: other public jobs in this run must not
      // repeat the same expensive read while the database is overloaded.
      sharedLoad ??= (async () => {
        failurePhase = 'shared-revisions';
        const revisions = await rpc(db, 'read_statistics_job_revisions', {}, signal);
        if (!revisions || typeof revisions !== 'object' || Array.isArray(revisions)) throw new Error('Statistics revisions unavailable');
        failurePhase = 'shared-history';
        const dataset = await datasetLoader(db, { signal, scope: job.scopeKey, beforeRead: yieldToPersonal,
          onProgress: progress => { failurePhase = progress.phase; onProgress(progress); } });
        onProgress({ phase: 'shared-history-ready', rows: dataset.history.length });
        return { revisions, dataset };
      })();
      try { shared = await sharedLoad; } catch (error) { sharedReadFailed = true; throw error; }
    }
    if (String(shared.revisions[job.scopeKey]) !== String(job.revision)) return DEFER_CHANGED_SCOPE;
    failurePhase = 'scope-compute';
    return scopeAggregate(db, job.scopeKey, { signal, dataset: shared.dataset });
  };
  for (let index = 0; index < maxJobs && now() - started < timeBudgetMs; index++) {
    if (await shouldYield()) {
      onProgress({ phase: 'yielded-to-personal', elapsedMs: now() - started });
      break;
    }
    const lease = randomUUID();
    const job = await rpc(db, 'claim_statistics_job', { p_lease: lease });
    if (!job) break;
    failurePhase = 'compute';
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
          failurePhase = 'publish-conflict';
          // Submit the captured revision through the existing conflict path.
          // It cannot match this claim, so no payload is written; the lease is
          // released and the database schedules its normal refresh cadence.
          published = await rpc(db, 'publish_statistics_snapshot', {
            ...params, p_revision: shared.revisions[job.scopeKey] ?? -1, p_payload: null,
          });
        } else {
          if (!payload) throw new Error('Empty statistics result');
          failurePhase = 'publish';
          published = await rpc(db, 'publish_statistics_snapshot', { ...params, p_payload: payload });
        }
      } else {
        failurePhase = 'legacy-compute';
        published = await rpc(db, 'compute_and_publish_legacy_statistics', params);
      }
      results.push({ scope: job.scopeKey.startsWith('owner:') ? 'personal' : job.scopeKey, status: published ? 'published' : 'changed-during-calculation' });
    } catch (error) {
      if (error?.code === 'statistics_personal_priority') {
        await rpc(db, 'defer_statistics_job', { p_scope: job.scopeKey, p_lease: lease });
        results.push({ scope: job.scopeKey.startsWith('owner:') ? 'personal' : job.scopeKey, status: 'yielded-to-personal' });
        onProgress({ phase: 'yielded-to-personal', elapsedMs: now() - started });
        break;
      }
      await rpc(db, 'fail_statistics_job', { p_scope: job.scopeKey, p_lease: lease });
      // Log only a controlled phase and SQLSTATE; messages may contain payloads.
      const code = /^[0-9A-Z]{5}$/.test(String(error?.code || '')) ? error.code
        : error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'read_deadline' : 'statistics_job_failed';
      results.push({ scope: job.scopeKey.startsWith('owner:') ? 'personal' : job.scopeKey, status: 'failed', failurePhase, code });
    }
    onProgress({ phase: 'job-finished', ...results.at(-1), elapsedMs: now() - started });
    // A shared source failure applies to this run, not to every queued pool.
    // Leave other leases untouched and let the next normal run try again.
    if (sharedReadFailed) break;
  }
  return results;
}
