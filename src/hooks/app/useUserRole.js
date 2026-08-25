import { useEffect } from 'react';
import { loadCurrentAccountProfile } from '../../services/accountProfileService.js';
import { useAuthStore } from '../../stores';
import { isContributorDemoUser } from '../../dev/contributorDemoMode.js';

/**
 * 用户角色 Hook
 * 获取当前用户的角色
 */
export function useUserRole() {
  const user = useAuthStore(state => state.user);
  const setUserRole = useAuthStore(state => state.setUserRole);

  useEffect(() => {
    if (!user) {
      setUserRole(null);
      return;
    }

    if (isContributorDemoUser(user)) {
      setUserRole('super_admin');
      return;
    }

    let cancelled = false;
    const fetchUserRole = async () => {
      try {
        const { profile } = await loadCurrentAccountProfile();
        if (!cancelled) {
          setUserRole(profile?.role || 'user');
        }
      } catch {
        if (!cancelled) {
          setUserRole('user');
        }
      }
    };

    fetchUserRole();

    return () => {
      cancelled = true;
    };
  }, [user, setUserRole]);
}

export default useUserRole;
