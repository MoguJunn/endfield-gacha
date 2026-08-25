import { useEffect } from 'react';
import { isContributorDemoModeEnabled, isContributorDemoUser } from '../../dev/contributorDemoMode.js';
import {
  getContributorDemoSandboxSnapshot,
  useContributorDemoSandboxStore,
} from '../../dev/contributorDemoSandboxStore.js';
import { reapplyContributorDemoSandboxSession } from '../../dev/contributorDemoSession.js';
import { useAppStore, useAuthStore, usePersonalDataStore, usePoolStore } from '../../stores/index.js';
import useSiteConfigStore from '../../stores/useSiteConfigStore.js';
import { characterCache } from '../../utils/characterUtils.js';

export function useContributorDemoSandboxBridge() {
  const revision = useContributorDemoSandboxStore((state) => state.revision);
  const initialized = useContributorDemoSandboxStore((state) => state.initialized);
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    if (!isContributorDemoModeEnabled() || !initialized) return;
    const snapshot = getContributorDemoSandboxSnapshot();
    const activeAnnouncements = snapshot.announcements
      .filter((item) => item.is_active !== false)
      .sort((left, right) => (Number(right.priority) || 0) - (Number(left.priority) || 0));
    useAppStore.getState().setAnnouncements(activeAnnouncements);
    useSiteConfigStore.setState({ config: snapshot.siteConfig, loaded: true, updateError: null });
    usePersonalDataStore.getState().setPublicPools(snapshot.pools);
    characterCache.applyCharacters(snapshot.characters);

    if (isContributorDemoUser(user)) {
      void reapplyContributorDemoSandboxSession();
    } else {
      usePoolStore.getState().setPools(snapshot.pools);
    }
  }, [initialized, revision, user]);
}

export default useContributorDemoSandboxBridge;
