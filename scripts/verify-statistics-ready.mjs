import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { handlePoolObservations } from '../api/_lib/poolObservations.js';
import { handleGroupStatistics } from '../api/_lib/groupStatistics.js';
import { handlePersonalStatistics, handleScheduledStatistics, handleStatisticsPoolCounts } from '../api/_lib/scheduledStatistics.js';
import { resolveSupabaseUrl, resolveSupabaseSecretKey } from '../api/_lib/supabaseEnv.js';
import { STATISTICS_GROUPS } from '../shared/statisticsScopes.js';

// Read-only verification of the actual route handlers against prepared database
// snapshots. Never prints credentials, personal identity, or snapshot payloads.
const db = createClient(resolveSupabaseUrl(), resolveSupabaseSecretKey(), { auth: { persistSession: false } });
const response = () => ({ statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; },
  status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } });
const { data: pools, error } = await db.rpc('get_app_visible_pools');
assert.ifError(error);
for (const pool of pools) {
  const res = response();
  await handlePoolObservations({ query: { poolId: pool.pool_id } }, res, db);
  assert.equal(res.statusCode, 200, `pool:${pool.pool_id}`);
  assert.equal(res.body.data.meta.source, 'scheduled-snapshot');
  assert.ok(res.body.data.observations && res.body.data.legacy);
}
for (const group of STATISTICS_GROUPS) {
  const res = response();
  await handleGroupStatistics({ query: { groupKey: group.key } }, res, db);
  assert.equal(res.statusCode, 200, `group:${group.key}`);
  assert.equal(res.body.data.meta.source, 'scheduled-snapshot');
}
for (const scope of ['global_summary', 'character_catalog', 'character_ranking']) {
  const res = response();
  await handleScheduledStatistics({}, res, db, scope);
  assert.equal(res.statusCode, 200, scope);
}
const counts = response();
await handleStatisticsPoolCounts({}, counts, db);
assert.equal(counts.statusCode, 200);
const privateResponse = response();
await handlePersonalStatistics({ headers: {}, cookies: {}, query: {} }, privateResponse);
assert.equal(privateResponse.statusCode, 401);
assert.equal(privateResponse.headers['Cache-Control'], 'private, no-store');
console.log(JSON.stringify({ publicPools: pools.length, groups: STATISTICS_GROUPS.length, legacyScopes: 3,
  counts: 'ready', anonymousPersonal: 'rejected', result: 'passed' }));
