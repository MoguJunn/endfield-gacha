import { createClient } from '@supabase/supabase-js';
import { resolveSupabaseUrl, resolveSupabaseSecretKey } from '../api/_lib/supabaseEnv.js';
import { runStatisticsWorker } from '../api/_lib/statisticsWorker.js';

const url = resolveSupabaseUrl();
const key = resolveSupabaseSecretKey();
if (!url || !key) throw new Error('Statistics worker requires server Supabase configuration');
const db = createClient(url, key, { auth: { persistSession: false } });
// Run from the supplied systemd timer. Database leases also protect duplicate runners.
const results = await runStatisticsWorker(db);
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }));
if (results.some((result) => result.status === 'failed')) process.exitCode = 1;
