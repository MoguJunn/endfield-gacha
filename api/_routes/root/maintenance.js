import { getSupabaseAdminClient } from '../../_lib/authAdmin.js';
import { rejectDisallowedBrowserOrigin } from '../../_lib/http.js';
import { MAINTENANCE_CONFIG_KEY, DEFAULT_MAINTENANCE_NOTICE, normalizeMaintenanceNotice } from '../../../shared/siteMaintenance.js';

// Cache the single public notice rather than reading the full bootstrap during
// an outage. Never replace the last successful value with a failed read.
let cached = null;
let fetchedAt = 0;
let retryAfter = 0;
let inFlight = null;

export async function readMaintenanceNotice(db, now = Date.now) {
  if (cached && now() - fetchedAt < 60000) return { notice: cached, source: 'cache' };
  if (now() < retryAfter) return { notice: cached || { ...DEFAULT_MAINTENANCE_NOTICE }, source: cached ? 'last-known' : 'deployment' };
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      if (!db) throw new Error('unavailable');
      const { data, error } = await db.from('site_config').select('value').eq('key', MAINTENANCE_CONFIG_KEY)
        .maybeSingle().abortSignal(AbortSignal.timeout(4000));
      if (error) throw error;
      cached = normalizeMaintenanceNotice(data?.value ?? DEFAULT_MAINTENANCE_NOTICE);
      fetchedAt = now();
      retryAfter = 0;
      return { notice: cached, source: 'database' };
    } catch {
      retryAfter = now() + 60000;
      return { notice: cached || { ...DEFAULT_MAINTENANCE_NOTICE }, source: cached ? 'last-known' : 'deployment' };
    }
  })();
  try { return await inFlight; } finally { inFlight = null; }
}

export function resetMaintenanceNoticeCache() { cached = null; fetchedAt = 0; retryAfter = 0; }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30');
  if (rejectDisallowedBrowserOrigin(req, res, { methods: 'GET, OPTIONS' })) return;
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  let db = null;
  try { db = getSupabaseAdminClient(); } catch { /* The deployment notice also works without database access. */ }
  const result = await readMaintenanceNotice(db);
  return res.status(200).json({ success: true, data: result.notice, meta: { source: result.source } });
}
