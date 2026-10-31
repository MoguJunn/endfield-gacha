import { getSameOriginAuthHeaders } from './authFetchService.js';
import { fetchJsonWithTimeout } from './supabaseRequest.js';
import { isContributorDemoModeEnabled } from '../dev/contributorDemoMode.js';
import { registerPrivateFeatureCacheClearer } from './privateFeatureCacheRegistry.js';

const states = new Map();
const subscribers = new Map();
let removeEvents;
export const SNAPSHOT_MUTATION_EVENT = 'endfield:snapshot-mutation';
const keyFor = ownerId => ownerId || '';
const PENDING_DELAYS = [3000, 10000, 30000, 90000, 180000];
const stateFor = ownerId => {
  const key = keyFor(ownerId);
  if (!states.has(key)) states.set(key, { value: null, promise: null });
  return states.get(key);
};

function checkPending(ownerId, state) {
  // Community imports can keep public work pending for hours. Only this
  // owner's pending work may schedule completion checks; unrelated public
  // publications must not reset the owner's finite check budget.
  const pending = state.value?.personal?.statisticsPending || state.value?.personal?.analysisPending;
  const signature = pending ? JSON.stringify([state.value.personal.statistics, state.value.personal.analysis]) : null;
  if (state.pendingSignature !== signature) { state.attempt = 0; state.pendingSignature = signature; }
  if (!pending) { clearTimeout(state.timer); state.timer = null; return; }
  if (state.timer || !subscribers.has(keyFor(ownerId)) || state.attempt >= PENDING_DELAYS.length) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    if (document.visibilityState === 'hidden') return;
    state.attempt++;
    void checkSnapshotVersions(ownerId, { force: true }).catch(() => {});
  }, PENDING_DELAYS[state.attempt || 0]);
}

export function getKnownSnapshotVersions(ownerId = '') {
  return stateFor(ownerId).value;
}

export async function checkSnapshotVersions(ownerId = '', { force = false } = {}) {
  if (isContributorDemoModeEnabled()) return null;
  const state = stateFor(ownerId);
  if (state.promise) return state.promise;
  if (!force && state.value) return state.value;
  const request = (async () => {
    const { headers } = ownerId
      ? await getSameOriginAuthHeaders({ Accept: 'application/json' }, { syncSiteSession: false, useSiteSessionCache: true, allowSiteSessionToken: false })
      : { headers: { Accept: 'application/json' } };
    const { response, data } = await fetchJsonWithTimeout(`/api/stats?type=snapshot_versions${ownerId ? '&personal=1' : ''}`, {
      headers, credentials: 'same-origin', cache: 'no-store',
    }, { label: 'snapshot versions', retries: 0, timeoutMs: 15000 });
    if (!response.ok || !data?.success || !data.data?.public || (ownerId && data.data.personal?.ownerId !== ownerId)) {
      throw new Error('Snapshot versions unavailable');
    }
    if (states.get(keyFor(ownerId)) !== state) throw new Error('Snapshot owner changed');
    const previous = JSON.stringify(state.value);
    state.value = data.data;
    if (previous !== JSON.stringify(state.value)) {
      for (const callback of subscribers.get(keyFor(ownerId)) || []) callback(state.value);
    }
    checkPending(ownerId, state);
    if (ownerId) {
      const publicState = stateFor('');
      const publicValue = { ...state.value, personal: null };
      const changed = JSON.stringify(publicState.value) !== JSON.stringify(publicValue);
      publicState.value = publicValue;
      if (changed) for (const callback of subscribers.get('') || []) callback(publicValue);
    }
    return state.value;
  })().finally(() => { if (state.promise === request) state.promise = null; });
  state.promise = request;
  return request;
}

export function forgetSnapshotOwner(ownerId) {
  if (ownerId) { clearTimeout(states.get(keyFor(ownerId))?.timer); states.delete(keyFor(ownerId)); }
}

export function notifySnapshotMutation(ownerId) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SNAPSHOT_MUTATION_EVENT, { detail: { ownerId } }));
  try { localStorage.setItem('endfield-snapshot-change', JSON.stringify({ ownerId, at: Date.now() })); } catch { /* optional tab notification */ }
}

export function subscribeSnapshotChanges(ownerId, callback) {
  const key = keyFor(ownerId);
  if (!subscribers.has(key)) subscribers.set(key, new Set());
  subscribers.get(key).add(callback);
  if (!removeEvents && typeof window !== 'undefined') {
    const check = () => {
      if (document.visibilityState === 'hidden') return;
      const owners = [...subscribers.keys()].filter(Boolean);
      for (const target of owners.length ? owners : ['']) void checkSnapshotVersions(target, { force: true }).catch(() => {});
    };
    const mutation = event => {
      if (event.type === 'storage' && event.key !== 'endfield-snapshot-change') return;
      check();
    };
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    window.addEventListener(SNAPSHOT_MUTATION_EVENT, mutation);
    window.addEventListener('storage', mutation);
    removeEvents = () => {
      window.removeEventListener('focus', check); window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener(SNAPSHOT_MUTATION_EVENT, mutation); window.removeEventListener('storage', mutation);
      removeEvents = null;
    };
  }
  return () => {
    subscribers.get(key)?.delete(callback);
    if (!subscribers.get(key)?.size) {
      subscribers.delete(key);
      clearTimeout(states.get(key)?.timer);
      if (states.has(key)) states.get(key).timer = null;
    }
    if (!subscribers.size) removeEvents?.();
  };
}

export function publicSnapshotScope(type, scope) {
  return scope?.kind === 'pool' ? `pool:${scope.poolId}` : scope?.kind === 'group' ? `group:${scope.groupKey}` : type;
}

export const isPublicStatistic = type => ['global_summary', 'character_ranking', 'character_catalog', 'pool_counts', 'pool_observations', 'group_statistics'].includes(type);

registerPrivateFeatureCacheClearer('snapshot-versions', () => {
  for (const ownerId of states.keys()) if (ownerId) forgetSnapshotOwner(ownerId);
});
