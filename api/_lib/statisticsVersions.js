import { createHash } from 'node:crypto';
import { getSupabaseAdminClient } from './authAdmin.js';
import { resolveAuthenticatedRequestUser } from './siteAuth.js';
import { resolvePublicCacheVersion } from './publicCache.js';
import { STATISTICS_GROUPS } from '../../shared/statisticsScopes.js';

const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
const snapshotFields = 'scope_key,schema_version,source_revision,computed_at';

// No history or JSON payloads cross the database connection for a version check.
export async function handleStatisticsVersions(req, res, publicDb) {
  res.setHeader('Cache-Control', 'no-store');
  const personal = req.query.personal === '1';
  const db = personal ? getSupabaseAdminClient() : publicDb;
  if (!db) return res.status(503).json({ success: false, error: '统计版本暂不可用' });
  let ownerId = null;
  if (personal) {
    const auth = await resolveAuthenticatedRequestUser(req, { adminClient: db, touch: false });
    if (!auth.ok) return res.status(auth.status || 401).json({ success: false, error: '请先登录' });
    ownerId = auth.user.id;
    res.setHeader('Cache-Control', 'private, no-store');
  }
  try {
    const [catalogVersion, visible] = await Promise.all([
      resolvePublicCacheVersion(db), db.rpc('get_app_visible_pools'),
    ]);
    if (visible.error || !Array.isArray(visible.data)) throw new Error('Catalog unavailable');
    const scopes = ['global_summary', 'character_ranking', 'character_catalog',
      ...visible.data.map(pool => `pool:${pool.pool_id || pool.id}`), ...STATISTICS_GROUPS.map(group => `group:${group.key}`)];
    const [snapshots, jobs] = await Promise.all([
      db.from('statistics_snapshots').select(snapshotFields).in('scope_key', scopes).order('scope_key'),
      db.from('statistics_jobs').select('scope_key,revision,published_revision').in('scope_key', scopes),
    ]);
    if (snapshots.error || jobs.error) throw new Error('Public versions unavailable');
    const rows = snapshots.data || [];
    const publicPending = (jobs.data || []).some(job => String(job.revision) !== String(job.published_revision));
    const versions = Object.fromEntries(scopes.map(scope => [scope, fingerprint([catalogVersion, rows?.find(row => row.scope_key === scope) || null])]));
    versions.pool_counts = fingerprint([catalogVersion, rows.filter(row => row.scope_key.startsWith('pool:'))]);
    let owner = null;
    if (ownerId) {
      const results = await Promise.all([
        db.from('statistics_snapshots').select(snapshotFields).eq('scope_key', `owner:${ownerId}`).maybeSingle(),
        db.from('statistics_jobs').select('revision,published_revision').eq('scope_key', `owner:${ownerId}`).maybeSingle(),
        db.from('personal_analysis_owner_state').select('history_revision,snapshot_revision,analysis_schema_version,computed_at').eq('user_id', ownerId).maybeSingle(),
        db.from('personal_analysis_scope_state').select('scope_game_uid,server_scope,history_revision,snapshot_revision,analysis_schema_version,computed_at').eq('user_id', ownerId).order('scope_game_uid').order('server_scope'),
      ]);
      if (results.some(result => result.error)) throw new Error('Personal versions unavailable');
      const [snapshot, job, analysisOwner, analysisScopes] = results.map(result => result.data);
      const pending = state => Boolean(state && String(state.history_revision) !== String(state.snapshot_revision));
      owner = { ownerId, statistics: fingerprint([catalogVersion, snapshot]),
        statisticsPending: Boolean(job && String(job.revision) !== String(job.published_revision)),
        analysis: fingerprint([catalogVersion, analysisOwner, analysisScopes]),
        analysisPending: pending(analysisOwner) || (analysisScopes || []).some(pending) };
    }
    return res.json({ success: true, data: { catalogVersion, public: versions, publicPending, personal: owner } });
  } catch {
    return res.status(503).json({ success: false, error: '统计版本暂不可用' });
  }
}
