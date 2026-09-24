import { buildStoredPoolObservations, STORED_OBSERVATION_VERSION } from '../../src/utils/storedPoolObservations.js';
import { isReservedPoolTypeId } from '../../shared/poolIdValidation.js';
import { resolvePoolCapabilities } from '../../src/utils/poolCapabilities.js';
import { readScheduledStatistic } from './scheduledStatistics.js';

const PAGE_SIZE = 1000;
const HISTORY_FIELDS = 'id,record_id,user_id,game_uid,server_scope,server_id,region,pool_id,character_id,character_name,rarity,timestamp,seq_id,is_new,is_free,is_info_book,special_type';

export async function readPoolObservationAggregate(supabase, poolId, { maxRows = Infinity, signal } = {}) {
  const { data: pool, error: poolError } = await supabase.from('pools')
    .select('pool_id,name,type').eq('pool_id', poolId).maybeSingle().abortSignal(signal);
  if (poolError) throw poolError;
  if (!pool) throw Object.assign(new Error('Unknown pool'), { status: 404 });
  const { data: directory, error: directoryError } = await supabase.from('characters')
    .select('id,name,aliases,rarity,type').abortSignal(signal);
  if (directoryError) throw directoryError;
  const { data: newest, error: newestError } = await supabase.from('history').select('id')
    .eq('pool_id', poolId).order('id', { ascending: false }).limit(1).abortSignal(signal);
  if (newestError) throw newestError;
  const lastId = newest?.[0]?.id;
  const history = [];
  if (lastId != null) {
    const { count, error: countError } = await supabase.from('history').select('id', { count: 'exact', head: true })
      .eq('pool_id', poolId).lte('id', lastId).abortSignal(signal);
    if (countError) throw countError;
    if (!Number.isInteger(count) || count < 0) throw new Error('Invalid history count');
    if (count > maxRows) throw Object.assign(new Error('Aggregation scope too large'), { status: 503 });
    // A fixed upper ID bounds concurrent imports. Fetch four pages at a time;
    // if deletion changes the row count, reject the incomplete read.
    for (let offset = 0; offset < count; offset += PAGE_SIZE * 4) {
      const starts = [0, 1, 2, 3].map((index) => offset + index * PAGE_SIZE).filter((start) => start < count);
      const pages = await Promise.all(starts.map(async (start) => {
        const end = Math.min(start + PAGE_SIZE, count) - 1;
        const { data, error } = await supabase.from('history').select(HISTORY_FIELDS).eq('pool_id', poolId)
          .lte('id', lastId).order('id', { ascending: true }).range(start, end).abortSignal(signal);
        if (error) throw error;
        if (!Array.isArray(data) || data.length !== end - start + 1) throw new Error('History changed during aggregation');
        return data;
      }));
      for (const rows of pages) history.push(...rows);
    }
  }
  // Public labels are sourced exclusively from the public directory, never user-entered record names.
  const observations = buildStoredPoolObservations({ history, poolId, directory: directory || [],
    entityType: resolvePoolCapabilities(pool).entityType });
  // This DTO contains only counters and distributions: no owner, UID, record IDs or raw rows.
  return { schemaVersion: STORED_OBSERVATION_VERSION, poolId, observations,
    meta: { source: 'database', updatedAt: new Date().toISOString(), storedRows: history.length,
      prefixVerified: false } };
}

export async function handlePoolObservations(req, res, supabase) {
  const poolId = String(req.query.poolId || '').trim();
  res.setHeader('Cache-Control', 'no-store');
  if (!/^[\w-]{1,160}$/u.test(poolId) || isReservedPoolTypeId(poolId)) {
    return res.status(400).json({ success: false, error: 'Invalid poolId' });
  }
  if (!supabase) return res.status(503).json({ success: false, error: '统计数据服务暂不可用' });
  try {
    const { data: visible, error } = await supabase.rpc('get_app_visible_pools');
    if (error) throw error;
    if (!visible?.some((pool) => (pool.pool_id || pool.id) === poolId)) return res.status(404).json({ success: false, error: '未找到该卡池' });
    const { payload, meta } = await readScheduledStatistic(supabase, `pool:${poolId}`);
    return res.status(payload ? 200 : 202).json({ success: true, cached: true,
      data: payload ? { ...payload, meta: { ...payload.meta, ...meta } } : { poolId, observations: null, meta } });
  } catch (error) {
    return res.status(error.status || 503).json({ success: false,
      error: error.status === 404 ? '未找到该卡池' : '分池统计暂未计算完成，请稍后重试',
      code: 'pool_observations_unavailable' });
  }
}
