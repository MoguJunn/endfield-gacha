import { createClient } from '@supabase/supabase-js';
import { resolveSupabaseSecretKey, resolveSupabaseUrl } from '../api/_lib/supabaseEnv.js';
import { buildPersonalStatisticsSnapshot } from '../api/_lib/personalStatisticsSnapshot.js';
import { PERSONAL_LUCK_CALCULATION_VERSION } from '../src/utils/personalLuckVersions.js';

// Run under the existing shared host flock; never bypass the publication check.
const url = resolveSupabaseUrl(), key = resolveSupabaseSecretKey();
if (!url || !key) throw new Error('Personal luck backfill requires server Supabase configuration');
const db = createClient(url, key, { auth: { persistSession: false } });
const budget = Number(process.env.LUCK_BACKFILL_BUDGET_MS || 600000);
const limit = Number(process.env.LUCK_BACKFILL_MAX_JOBS || 5000);
if (!Number.isInteger(budget) || budget < 1000 || budget > 600000
  || !Number.isInteger(limit) || limit < 1 || limit > 5000) throw new Error('Invalid luck backfill budget');
const started = Date.now(), counts = { published: 0, changed: 0, skipped: 0, failed: 0 };
const errorCodes = {};
const errorCode = error => /^[A-Za-z0-9_-]{1,64}$/.test(error?.code) ? error.code : 'luck_backfill_failed';
let after = '', scanned = 0;
const report = phase => console.log(JSON.stringify({ phase, ...counts, scanned, errorCodes,
  elapsedMs: Date.now() - started, memoryMiB: Math.round(process.memoryUsage().rss / 1048576) }));
const processJob = async job => {
  try {
    if (!/^owner:[0-9a-f-]{36}$/i.test(job.scopeKey)) throw new Error('Invalid owner scope');
    if (!job.needsLuck) { counts.skipped++; return; }
    // An unchanged empty snapshot already proves there is no account history.
    const luck = job.hasAccounts === false ? { version: 1, calculationVersion: PERSONAL_LUCK_CALCULATION_VERSION,
      fetchedAt: new Date().toISOString(), accounts: [] }
      : await buildPersonalStatisticsSnapshot(db, job.scopeKey.slice(6), {
        signal: AbortSignal.timeout(180000), luckOnly: true,
      });
    const result = await db.rpc('publish_personal_luck_backfill', {
      p_scope: job.scopeKey, p_revision: job.revision, p_luck: luck,
    });
    if (result.error) throw result.error;
    if (typeof result.data !== 'boolean') throw new Error('Luck backfill publication failed');
    counts[result.data ? 'published' : 'changed']++;
  } catch (error) {
    counts.failed++;
    const code = errorCode(error);
    errorCodes[code] = (errorCodes[code] || 0) + 1;
  }
};
while (Date.now() - started < budget && scanned < limit) {
  const { data, error } = await db.rpc('read_personal_luck_backfill_batch', { p_after_scope: after, p_limit: 20 });
  if (error || !Array.isArray(data)) {
    errorCodes[errorCode(error)] = (errorCodes[errorCode(error)] || 0) + 1;
    report('candidate-read-failed');
    process.exitCode = 1;
    break;
  }
  if (!data.length) break;
  // Three independent owners overlap I/O on the same capped CPU/container.
  for (let index = 0; index < data.length; index += 3) {
    if (Date.now() - started >= budget || scanned >= limit) break;
    const chunk = data.slice(index, index + Math.min(3, limit - scanned));
    after = chunk.at(-1).scopeKey;
    scanned += chunk.length;
    await Promise.all(chunk.map(processJob));
    if (scanned % 25 < 3) report('progress');
  }
}
report('completed');
if (counts.failed) process.exitCode = 1;
