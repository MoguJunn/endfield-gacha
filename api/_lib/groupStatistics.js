import { getStatisticsGroup, getStatisticsGroupPools, statisticsMemberSignature } from '../../shared/statisticsScopes.js';
import { readScheduledStatistic } from './scheduledStatistics.js';

export async function handleGroupStatistics(req, res, db) {
  res.setHeader('Cache-Control', 'no-store');
  const groupKey = String(req.query.groupKey || '');
  if (!getStatisticsGroup(groupKey)) return res.status(400).json({ success: false, error: 'Invalid statistics group' });
  if (!db) return res.status(503).json({ success: false, error: '统计服务暂不可用' });
  try {
    const { data: visible, error } = await db.rpc('get_app_visible_pools');
    if (error || !Array.isArray(visible)) throw new Error('Public catalog unavailable');
    const members = getStatisticsGroupPools(visible, groupKey);
    const { payload, meta } = await readScheduledStatistic(db, `group:${groupKey}`);
    if (!payload || payload.memberSignature !== statisticsMemberSignature(members)) {
      return res.status(202).json({ success: true, cached: true, data: { groupKey, observations: null,
        meta: { availability: 'building', updatedAt: null, nextRefreshAt: meta.nextRefreshAt } } });
    }
    return res.json({ success: true, cached: true, data: { ...payload, meta: { ...payload.meta, ...meta } } });
  } catch {
    return res.status(503).json({ success: false, error: '合池统计暂不可用' });
  }
}
