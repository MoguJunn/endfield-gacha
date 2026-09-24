import { readFile } from 'node:fs/promises';
import { STATISTICS_SNAPSHOT_VERSION, statisticsRefreshMeta } from '../../shared/statisticsRefreshPolicy.js';
import { getSupabaseAdminClient } from './authAdmin.js';
import { resolveAuthenticatedRequestUser } from './siteAuth.js';

// Explicit local preview only. Production always reads the persistent DB snapshot.
async function localSnapshots() {
  const file = process.env.NODE_ENV !== 'production' && process.env.STATISTICS_LOCAL_SNAPSHOT_FILE;
  return file ? JSON.parse(await readFile(file, 'utf8')) : null;
}

export async function readScheduledStatistic(db, scope) {
  const local = scope.startsWith('owner:') ? null : await localSnapshots();
  let snapshot;
  if (local) snapshot = local.snapshots[scope];
  else {
    const { data, error } = await db.rpc('read_statistics_snapshot', { p_scope: scope });
    if (error) throw error;
    snapshot = data;
  }
  if (!snapshot || snapshot.schema_version !== STATISTICS_SNAPSHOT_VERSION) {
    return { payload: null, meta: { availability: 'building', updatedAt: null, nextRefreshAt: null } };
  }
  return { payload: snapshot.payload, meta: { ...statisticsRefreshMeta(snapshot),
    pendingChanges: Boolean(snapshot.pending_changes), source: local ? 'local-snapshot' : 'scheduled-snapshot' } };
}

export async function handlePersonalStatistics(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const db = getSupabaseAdminClient();
  const auth = await resolveAuthenticatedRequestUser(req, { adminClient: db, touch: false });
  if (!auth.ok) return res.status(auth.status || 401).json({ success: false, error: '请先登录' });
  if (!db) return res.status(503).json({ success: false, error: '统计服务暂不可用' });
  try {
    const { payload, meta } = await readScheduledStatistic(db, `owner:${auth.user.id}`);
    return res.status(payload ? 200 : 202).json({ success: true, data: payload, meta: { ...meta, ownerId: auth.user.id } });
  } catch {
    return res.status(503).json({ success: false, error: '个人统计尚未准备完成' });
  }
}

export async function readStatisticsPoolCounts(db) {
  const local = await localSnapshots();
  if (local) return local.poolCounts;
  const { data, error } = await db.rpc('read_statistics_pool_counts');
  if (error) throw error;
  return data || {};
}

export async function handleStatisticsPoolCounts(_req, res, db) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    return res.json({ success: true, data: { counts: await readStatisticsPoolCounts(db) } });
  } catch {
    return res.status(503).json({ success: false, error: '卡池汇总尚未准备完成' });
  }
}

export async function handleScheduledStatistics(_req, res, db, scope, transform = (value) => value) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { payload, meta } = await readScheduledStatistic(db, scope);
    const key = { global_summary: 'globalSummary', character_ranking: 'characterRanking', character_catalog: 'characterCatalog' }[scope];
    return res.status(payload ? 200 : 202).json({ success: true, cached: true, partial: !payload,
      data: { [key]: payload ? { ...transform(payload), meta: { ...payload.meta, ...meta } } : null }, meta });
  } catch {
    return res.status(503).json({ success: false, error: '定时统计服务暂不可用' });
  }
}
