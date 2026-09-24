import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import { resolveSupabaseUrl, resolveSupabaseServerKey } from '../api/_lib/supabaseEnv.js';
import { readStatisticsScopeAggregate, readStatisticsPreviewDataset } from '../api/_lib/statisticsScopeAggregate.js';
import { STATISTICS_GROUPS } from '../shared/statisticsScopes.js';
import { STATISTICS_SNAPSHOT_VERSION } from '../shared/statisticsRefreshPolicy.js';

// Read-only production access; output is an ignored local aggregate file.
const env = { ...loadEnv('development', process.cwd(), ''), ...process.env };
const db = createClient(resolveSupabaseUrl(env), resolveSupabaseServerKey(env));
const { data: pools, error } = await db.rpc('get_app_visible_pools');
if (error) throw new Error('Cannot read public pool catalog');
const poolCounts = {};
for (let offset = 0; offset < pools.length; offset += 4) {
  await Promise.all(pools.slice(offset, offset + 4).map(async (pool) => {
    const { count, error: countError } = await db.from('history').select('id', { count: 'exact', head: true })
      .eq('pool_id', pool.pool_id).or('special_type.is.null,special_type.neq.gift').in('rarity', [4, 5, 6])
      .not('game_uid', 'is', null).neq('game_uid', '').gt('timestamp', '1970-01-01T00:00:00Z');
    if (countError) throw new Error('Cannot read pool count');
    poolCounts[pool.pool_id] = count;
  }));
}
const directory = resolve('.agent-tmp/statistics-live');
await mkdir(directory, { recursive: true });
const target = resolve(directory, 'snapshots.json');
let snapshots = {};
try { snapshots = JSON.parse(await readFile(target, 'utf8')).snapshots; } catch (error) { if (error.code !== 'ENOENT') throw error; }
async function save() {
  await writeFile(`${target}.next`, JSON.stringify({ poolCounts, snapshots }));
  // On Windows, a concurrent preview GET may briefly hold the destination open.
  for (let attempt = 0; ; attempt++) {
    try { await rename(`${target}.next`, target); break; }
    catch (error) {
      if (!['EPERM', 'EBUSY'].includes(error.code) || attempt >= 20) throw error;
      await setTimeout(100);
    }
  }
}
const wrap = (payload, computedAt = new Date().toISOString()) => ({ schema_version: STATISTICS_SNAPSHOT_VERSION, payload,
  computed_at: computedAt, next_refresh_at: new Date(Date.parse(computedAt) + 3600000).toISOString(), refresh_minutes: 60 });
const selected = process.argv.slice(2);
function verifyExisting(scope, payload) {
  if (!selected.includes('--verify-existing')) return;
  const previous = snapshots[scope]?.payload;
  if (!previous) throw new Error(`Missing comparison snapshot: ${scope}`);
  for (const field of ['observations', 'legacy', 'memberIds', 'memberSignature']) {
    if (!isDeepStrictEqual(previous[field], payload[field])) throw new Error(`Snapshot differs (${scope}, ${field}); check source changes before treating this as an algorithm regression`);
  }
  console.log(JSON.stringify({ scope, comparison: 'equal' }));
}
const dataset = selected.includes('--all') || selected.includes('--missing') ? await readStatisticsPreviewDataset(db, { signal: AbortSignal.timeout(180000) }) : null;
if (dataset) console.log(JSON.stringify({ phase: 'preview-context-ready', rows: dataset.history.length }));
for (const pool of pools) {
  if (selected.includes('--groups')) continue;
  if (selected.includes('--missing') && snapshots[`pool:${pool.pool_id}`]?.schema_version === STATISTICS_SNAPSHOT_VERSION) continue;
  if (!selected.includes('--all') && !selected.includes('--missing') && !selected.includes(pool.pool_id) && poolCounts[pool.pool_id] > 0) continue;
  const started = performance.now();
  const payload = await readStatisticsScopeAggregate(db, `pool:${pool.pool_id}`, { signal: AbortSignal.timeout(180000), dataset });
  verifyExisting(`pool:${pool.pool_id}`, payload);
  snapshots[`pool:${pool.pool_id}`] = wrap(payload);
  poolCounts[pool.pool_id] = payload.observations.total;
  await save();
  console.log(JSON.stringify({ pool: pool.pool_id, total: payload.observations.total, elapsedMs: Math.round(performance.now() - started), bytes: Buffer.byteLength(JSON.stringify(payload)), rssMiB: Math.round(process.memoryUsage().rss / 1048576),
    firstSixSamples: payload.observations.items.filter((item) => item.rarity === 6).reduce((sum, item) => sum + item.first.sampleCount, 0) }));
}
for (const group of STATISTICS_GROUPS) {
  if (!selected.includes('--groups') && !selected.includes('--all') && !selected.includes('--missing') && !selected.includes(`group:${group.key}`)) continue;
  if (selected.includes('--missing') && snapshots[`group:${group.key}`]?.schema_version === STATISTICS_SNAPSHOT_VERSION) continue;
  const started = performance.now();
  const payload = await readStatisticsScopeAggregate(db, `group:${group.key}`, { signal: AbortSignal.timeout(180000), dataset,
    onProgress: (progress) => console.log(JSON.stringify({ group: group.key, ...progress, elapsedMs: Math.round(performance.now() - started) })) });
  verifyExisting(`group:${group.key}`, payload);
  snapshots[`group:${group.key}`] = wrap(payload);
  await save();
  console.log(JSON.stringify({ group: group.key, total: payload.observations.total, accounts: payload.observations.participatingAccounts,
    contextRows: payload.meta.contextRows, elapsedMs: Math.round(performance.now() - started), bytes: Buffer.byteLength(JSON.stringify(payload)), rssMiB: Math.round(process.memoryUsage().rss / 1048576),
    peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024) }));
}
const { data: caches, error: cacheError } = await db.from('stats_cache').select('cache_key,cached_data,computed_at')
  .or('cache_key.like.global_stats%,cache_key.like.character_ranking%,cache_key.like.character_catalog%').order('computed_at', { ascending: false });
if (cacheError) throw new Error('Cannot read existing legacy statistics caches');
for (const [scope, prefix] of [['global_summary', 'global_stats'], ['character_ranking', 'character_ranking'], ['character_catalog', 'character_catalog']]) {
  const row = caches.find((cache) => cache.cache_key.startsWith(prefix));
  if (row) snapshots[scope] = wrap(row.cached_data, row.computed_at);
}
await save();
console.log(`Local snapshot ready: ${Object.keys(poolCounts).length} pool counts; ${Object.keys(snapshots).length} snapshots`);
