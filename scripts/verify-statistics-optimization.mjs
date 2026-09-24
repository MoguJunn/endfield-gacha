import { execFileSync } from 'node:child_process';
import { resolve, dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { readStatisticsPreviewDataset, readStatisticsScopeAggregate } from '../api/_lib/statisticsScopeAggregate.js';
import { resolveSupabaseUrl, resolveSupabaseServerKey } from '../api/_lib/supabaseEnv.js';
import { STATISTICS_GROUPS } from '../shared/statisticsScopes.js';

// Read-only database verification. Both implementations consume the SAME in-memory
// rows. Only comparison summaries are printed; private rows are never persisted.
// Pass the commit containing the pre-optimization implementation as argument 1.
const revision = process.argv[2];
if (!revision || revision.startsWith('-')) throw new Error('Provide the pre-optimization Git revision');
const root = resolve('.');
const referencePaths = new Set(['api/_lib/statisticsScopeAggregate.js', 'src/utils/poolObservationStats.js',
  'src/utils/storedPoolObservations.js', 'src/utils/groupPoolObservations.js', 'src/utils/scopedLegacyStatistics.js']);
const urls = new Map();
function referenceUrl(path) {
  if (urls.has(path)) return urls.get(path);
  const source = execFileSync('git', ['show', `${revision}:${path}`], { cwd: root, encoding: 'utf8' })
    .replace(/(from\s*|import\s*)['"](\.{1,2}\/[^'"]+)['"]/g, (_, prefix, specifier) => {
      const absolute = resolve(root, dirname(path), specifier);
      const target = relative(root, absolute).replaceAll('\\', '/');
      return `${prefix}'${referencePaths.has(target) ? referenceUrl(target) : pathToFileURL(absolute).href}'`;
    });
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  urls.set(path, url);
  return url;
}
const reference = await import(referenceUrl('api/_lib/statisticsScopeAggregate.js'));
const env = { ...loadEnv('development', root, ''), ...process.env };
const db = createClient(resolveSupabaseUrl(env), resolveSupabaseServerKey(env));
const dataset = await readStatisticsPreviewDataset(db, { signal: AbortSignal.timeout(180000) });
console.log(JSON.stringify({ phase: 'dataset-ready', rows: dataset.history.length }));
const scopes = [...dataset.pools.map((pool) => `pool:${pool.id}`), ...STATISTICS_GROUPS.map((group) => `group:${group.key}`)];
for (const scope of scopes) {
  const started = performance.now();
  const current = await readStatisticsScopeAggregate(db, scope, { dataset });
  const currentMs = Math.round(performance.now() - started);
  const expected = await reference.readStatisticsScopeAggregate(db, scope, { dataset });
  for (const field of ['observations', 'legacy', 'memberIds', 'memberSignature']) {
    if (!isDeepStrictEqual(current[field], expected[field])) throw new Error(`Algorithm comparison differs: ${scope}, ${field}`);
  }
  console.log(JSON.stringify({ scope, comparison: 'equal', total: current.observations.total, currentMs }));
}
console.log(JSON.stringify({ phase: 'complete', scopes: scopes.length }));
