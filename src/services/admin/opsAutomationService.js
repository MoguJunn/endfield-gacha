import { getSupabaseAccessToken } from '../authFetchService.js';
import { fetchJsonWithTimeout } from '../supabaseRequest';
import {
  createContributorDemoReadonlyError,
  isContributorDemoModeEnabled,
} from '../../dev/contributorDemoMode.js';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function loadOpsAutomationRuns({
  jobId = 'all',
  status = 'all',
  triggerType = 'all',
  limit = 20,
} = {}) {
  if (isContributorDemoModeEnabled()) {
    throw createContributorDemoReadonlyError('ops-automation-load');
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 200);
  const normalizedJobId = normalizeText(jobId);
  const normalizedStatus = normalizeText(status);
  const normalizedTriggerType = normalizeText(triggerType);
  const params = new URLSearchParams({
    limit: String(safeLimit),
  });
  if (normalizedJobId && normalizedJobId !== 'all') params.set('jobId', normalizedJobId);
  if (normalizedStatus && normalizedStatus !== 'all') params.set('status', normalizedStatus);
  if (normalizedTriggerType && normalizedTriggerType !== 'all') params.set('triggerType', normalizedTriggerType);

  const token = await getSupabaseAccessToken({
    syncSiteSession: false,
    useSiteSessionCache: true,
    allowSiteSessionToken: false,
  });
  const headers = {
    Accept: 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const { response, data } = await fetchJsonWithTimeout(`/api/admin-ops-automation?${params.toString()}`, {
    method: 'GET',
    credentials: 'same-origin',
    headers,
  }, {
    label: 'admin-ops-automation-load',
    timeoutMs: 45000,
    retries: 1,
  });

  if (!response.ok || data?.success !== true) {
    const error = new Error(data?.error || `请求失败 (${response.status})`);
    error.status = response.status;
    error.code = 'admin_ops_automation_load_failed';
    throw error;
  }

  return Array.isArray(data.runs) ? data.runs : [];
}

export async function triggerManualSync(job = 'official-announcements', {
  forceRefresh = false,
  refreshMode = forceRefresh ? 'summary' : 'incremental',
  announcementLimit = null,
} = {}) {
  if (isContributorDemoModeEnabled()) {
    throw createContributorDemoReadonlyError('ops-automation-trigger');
  }
  const token = await getSupabaseAccessToken({
    syncSiteSession: false,
    useSiteSessionCache: true,
    allowSiteSessionToken: false,
  });
  const headers = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const { response: res, data: json } = await fetchJsonWithTimeout('/api/admin-ops-automation', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      ...headers,
    },
    body: JSON.stringify({ job, forceRefresh, refreshMode, announcementLimit }),
  }, {
    label: 'admin-ops-automation-trigger',
    timeoutMs: 45000,
    retries: 0,
  });

  if (!res.ok) {
    throw new Error(json.error || `请求失败 (${res.status})`);
  }
  return json;
}

export default { loadOpsAutomationRuns, triggerManualSync };
