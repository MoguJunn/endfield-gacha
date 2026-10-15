// Only account/pool identities and time bounds; excluded outcomes stay unread.
export async function readStatisticsHistoryGaps(db, { userId = null, signal } = {}) {
  const rows = [];
  for (let page = 0; ; page++) {
    let query = db.from('statistics_history_gaps')
      .select('user_id,game_uid,server_scope,pool_id,history_start_at,history_end_at,history_time_unknown');
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query.order('user_id').order('game_uid').order('server_scope').order('pool_id')
      .range(page * 1000, page * 1000 + 999).abortSignal(signal);
    if (error || !Array.isArray(data)) throw new Error('Statistics history boundaries unavailable');
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
