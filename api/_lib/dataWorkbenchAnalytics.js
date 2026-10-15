import { aggregateWorkbenchMetrics } from '../../shared/dataWorkbenchAnalytics.js';

const PAGE_SIZE = 1000;
const MAX_PAGES = 100;
const ENTRY_FIELDS = 'id,user_id,game_uid,server_scope,pool_id,entry_id,draft_id,kind,source,values,time_precision,revision,deleted_at';

export function unavailableWorkbenchAnalytics() {
  return { ...aggregateWorkbenchMetrics([], { status: 'unavailable' }), code: 'workbench_unavailable' };
}

async function readPages(query) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await query().range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < PAGE_SIZE) return rows;
  }
  throw Object.assign(new Error('Workbench analytics page limit exceeded'), { code: 'workbench_page_limit' });
}

export async function loadWorkbenchEntriesForAnalytics(client, userId = null) {
  try {
    const entries = await readPages(() => {
      let query = client.from('account_data_workbench_entries').select(ENTRY_FIELDS).is('deleted_at', null).order('id', { ascending: true });
      if (userId) query = query.eq('user_id', userId);
      return query;
    });
    return { entries, status: 'ready' };
  } catch (error) {
    if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error?.code)) {
      return { entries: [], status: 'unavailable', code: 'workbench_unavailable' };
    }
    throw error;
  }
}

// Manual ledgers are available for private editing only. Public statistics never read them.
export async function loadPublicWorkbenchAnalytics() {
  return { ...aggregateWorkbenchMetrics([], { status: 'excluded', scope: 'statistics' }), code: 'manual_data_excluded' };
}
