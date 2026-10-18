import { createClient } from '@supabase/supabase-js';
import { resolveSupabaseUrl, resolveSupabaseSecretKey } from '../api/_lib/supabaseEnv.js';
import { runStatisticsWorker } from '../api/_lib/statisticsWorker.js';
import { STATISTICS_SNAPSHOT_VERSION } from '../shared/statisticsRefreshPolicy.js';

const url = resolveSupabaseUrl();
const key = resolveSupabaseSecretKey();
if (!url || !key) throw new Error('Statistics worker requires server Supabase configuration');
const db = createClient(url, key, { auth: { persistSession: false } });
// Run from the supplied systemd timer. Database leases also protect duplicate runners.
const maxJobs = Number(process.env.STATISTICS_MAX_JOBS || 8);
if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 1000) throw new Error('Invalid STATISTICS_MAX_JOBS');
// Match the deployed API's payload contract during independent worker rollout.
const snapshotVersion = process.env.STATISTICS_SNAPSHOT_SCHEMA_VERSION || STATISTICS_SNAPSHOT_VERSION;
if (!/^public-statistics-v[1-9]\d*$/.test(snapshotVersion)) throw new Error('Invalid STATISTICS_SNAPSHOT_SCHEMA_VERSION');
const results = await runStatisticsWorker(db, { maxJobs, snapshotVersion,
  shouldYield: async () => {
    const { data, error } = await db.rpc('statistics_personal_analysis_pending').abortSignal(AbortSignal.timeout(8000));
    if (error) throw error;
    if (typeof data !== 'boolean') throw new Error('Invalid statistics priority response');
    return data;
  },
  onProgress: (progress) => console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...progress,
    memoryMiB: Math.round(process.memoryUsage().rss / 1024 / 1024) })) });
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }));
if (results.some((result) => result.status === 'failed')) process.exitCode = 1;
