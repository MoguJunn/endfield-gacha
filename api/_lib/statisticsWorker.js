import { randomUUID } from 'node:crypto';
import { readStatisticsScopeAggregate } from './statisticsScopeAggregate.js';
import { STATISTICS_SNAPSHOT_VERSION } from '../../shared/statisticsRefreshPolicy.js';
import { buildPersonalStatisticsSnapshot } from './personalStatisticsSnapshot.js';

async function rpc(db, name, params) {
  const { data, error } = await db.rpc(name, params);
  if (error) throw error;
  return data;
}

export async function runStatisticsWorker(db, { maxJobs = 8, timeBudgetMs = 240000, now = Date.now,
  aggregate = (client, poolId, options) => readStatisticsScopeAggregate(client, `pool:${poolId}`, options),
  groupAggregate = (client, groupKey, options) => readStatisticsScopeAggregate(client, `group:${groupKey}`, options), personal = buildPersonalStatisticsSnapshot } = {}) {
  const started = now();
  const results = [];
  for (let index = 0; index < maxJobs && now() - started < timeBudgetMs; index++) {
    const lease = randomUUID();
    const job = await rpc(db, 'claim_statistics_job', { p_lease: lease });
    if (!job) break;
    try {
      const params = { p_scope: job.scopeKey, p_revision: job.revision, p_lease: lease, p_schema: STATISTICS_SNAPSHOT_VERSION };
      let published;
      if (job.scopeKey.startsWith('pool:') || job.scopeKey.startsWith('owner:') || job.scopeKey.startsWith('group:')) {
        const signal = AbortSignal.timeout(180000);
        const payload = job.scopeKey.startsWith('pool:')
          ? await aggregate(db, job.scopeKey.slice(5), { signal })
          : job.scopeKey.startsWith('group:') ? await groupAggregate(db, job.scopeKey.slice(6), { signal })
            : await personal(db, job.scopeKey.slice(6), { signal });
        if (!payload) throw new Error('Empty statistics result');
        published = await rpc(db, 'publish_statistics_snapshot', { ...params, p_payload: payload });
      } else published = await rpc(db, 'compute_and_publish_legacy_statistics', params);
      results.push({ scope: job.scopeKey.startsWith('owner:') ? 'personal' : job.scopeKey, status: published ? 'published' : 'changed-during-calculation' });
    } catch {
      await rpc(db, 'fail_statistics_job', { p_scope: job.scopeKey, p_lease: lease });
      results.push({ scope: job.scopeKey.startsWith('owner:') ? 'personal' : job.scopeKey, status: 'failed' });
    }
  }
  return results;
}
