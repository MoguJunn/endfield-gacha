import {
  useAuthStore,
  useHistoryStore,
  usePersonalDataStore,
  usePoolStore,
} from '../stores/index.js';
import { applyCloudAnalysisToStores } from '../utils/cloudDataSync.js';
import {
  CONTRIBUTOR_DEMO_USER,
  clearContributorDemoAndSupabaseBrowserState,
  isContributorDemoModeEnabled,
  isContributorDemoSessionActive,
  isContributorDemoUser,
  markContributorDemoSessionActive,
} from './contributorDemoMode.js';
import {
  getContributorDemoSandboxSnapshot,
  initializeContributorDemoSandbox,
} from './contributorDemoSandboxStore.js';
import {
  CONTRIBUTOR_DEMO_ACCOUNT_KEY,
  getContributorDemoRuntimeAnalysis,
  invalidateContributorDemoRuntimeData,
} from './contributorDemoRuntimeData.js';
import { characterCache } from '../utils/characterUtils.js';
import { logoutSiteSession } from '../services/siteSessionService.js';
import { getGlobalQueue } from '../utils/requestQueue.js';

function getPreferredSandboxPoolId(pools = []) {
  const now = Date.now();
  const active = pools.find((pool) => {
    const start = pool.start_time ? new Date(pool.start_time).getTime() : -Infinity;
    const end = pool.end_time ? new Date(pool.end_time).getTime() : Infinity;
    return start <= now && now < end && pool.type !== 'standard';
  });
  return active?.id || active?.pool_id || pools[0]?.id || pools[0]?.pool_id || null;
}

export async function activateContributorDemoSession({ reapply = false } = {}) {
  if (!isContributorDemoModeEnabled()) {
    return null;
  }

  if (reapply && (
    !isContributorDemoSessionActive()
    || !isContributorDemoUser(useAuthStore.getState().user)
  )) {
    return null;
  }

  await initializeContributorDemoSandbox();
  if (reapply && (
    !isContributorDemoSessionActive()
    || !isContributorDemoUser(useAuthStore.getState().user)
  )) {
    return null;
  }

  if (!reapply) {
    getGlobalQueue().clear();
    clearContributorDemoAndSupabaseBrowserState();
    const siteSessionCleared = await logoutSiteSession();
    if (!siteSessionCleared) {
      return null;
    }
    if (!markContributorDemoSessionActive(true)) {
      return null;
    }
  }
  const snapshot = getContributorDemoSandboxSnapshot();
  const pools = snapshot.pools;
  invalidateContributorDemoRuntimeData();
  const analysis = getContributorDemoRuntimeAnalysis({
    accountKey: CONTRIBUTOR_DEMO_ACCOUNT_KEY,
    viewKey: '__group_all',
    locale: 'zh-CN',
  });
  const personalData = usePersonalDataStore.getState();
  personalData.switchOwner(CONTRIBUTOR_DEMO_USER.id);
  personalData.setPublicPools(pools);
  useHistoryStore.getState().setHistory([]);
  useAuthStore.getState().login(CONTRIBUTOR_DEMO_USER, 'super_admin');
  characterCache.applyCharacters(snapshot.characters);

  const poolStore = usePoolStore.getState();
  const ownerState = usePersonalDataStore.getState();
  const token = ownerState.beginRequest({
    ownerId: CONTRIBUTOR_DEMO_USER.id,
    ownerGeneration: ownerState.ownerGeneration,
    kind: 'contributor-demo',
    reason: 'contributor_demo_activate',
  });
  const cloudData = {
    kind: 'analysis',
    ownerId: CONTRIBUTOR_DEMO_USER.id,
    pools,
    analysis,
    source: 'contributor-local-sandbox',
    warnings: analysis.warnings,
  };
  const applied = applyCloudAnalysisToStores(cloudData, {
    setPools: poolStore.setPools,
    switchPool: poolStore.switchPool,
    switchGameAccount: poolStore.switchGameAccount,
    preferredPoolId: getPreferredSandboxPoolId(pools),
  });
  if (token && applied) {
    usePersonalDataStore.getState().completeRequest(token, cloudData);
  }

  return CONTRIBUTOR_DEMO_USER;
}

export async function reapplyContributorDemoSandboxSession() {
  if (!isContributorDemoModeEnabled()) return null;
  return activateContributorDemoSession({ reapply: true });
}

export function deactivateContributorDemoSession() {
  markContributorDemoSessionActive(false);
}
