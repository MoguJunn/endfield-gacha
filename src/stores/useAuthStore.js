import { create } from 'zustand';
import { supabase } from '../supabaseClient.js';
import { logoutSiteSession } from '../services/siteSessionService.js';
import { clearPrivateFeatureCaches } from '../services/privateFeatureCacheRegistry.js';
import usePersonalAnalysisStore from './usePersonalAnalysisStore.js';
import usePersonalDataStore from './usePersonalDataStore.js';
import {
  clearContributorDemoAndSupabaseBrowserState,
  isContributorDemoUser,
} from '../dev/contributorDemoMode.js';
import { getGlobalQueue } from '../utils/requestQueue.js';

/**
 * 认证状态管理
 * 管理用户登录、角色权限、同步状态等
 */
const useAuthStore = create((set) => ({
  // ========== 用户认证状态 ==========
  user: null,
  userRole: null, // 'user' | 'admin' | 'super_admin'
  authResolved: false,

  setUser: (user) => set((state) => {
    if (state.user?.id && state.user.id !== user?.id) {
      clearPrivateFeatureCaches();
    }
    return {
      user,
      lastSyncAt: user ? state.lastSyncAt : null
    };
  }),
  setUserRole: (role) => set({ userRole: role }),
  setAuthResolved: (value) => set({ authResolved: Boolean(value) }),

  login: (user, role) => set((state) => {
    if (state.user?.id && state.user.id !== user?.id) {
      clearPrivateFeatureCaches();
    }
    return { user, userRole: role, authResolved: true };
  }),
  logout: () => {
    const currentUser = useAuthStore.getState().user;
    clearPrivateFeatureCaches();
    usePersonalDataStore.getState().clearOwner('auth_store_logout');
    usePersonalAnalysisStore.getState().clearAnalysis('auth_store_logout');
    if (isContributorDemoUser(currentUser)) {
      clearContributorDemoAndSupabaseBrowserState();
      getGlobalQueue().clear();
      void logoutSiteSession();
    }
    set({ user: null, userRole: null, authResolved: true, syncing: false, syncError: null, lastSyncAt: null });
  },

  /** 完整登出：清除 Supabase 会话 + Zustand 状态 */
  signOut: async () => {
    const currentUser = useAuthStore.getState().user;
    clearPrivateFeatureCaches();
    usePersonalDataStore.getState().clearOwner('auth_store_sign_out');
    usePersonalAnalysisStore.getState().clearAnalysis('auth_store_sign_out');
    if (isContributorDemoUser(currentUser)) {
      clearContributorDemoAndSupabaseBrowserState();
      getGlobalQueue().clear();
      await logoutSiteSession();
      set({ user: null, userRole: null, authResolved: true, syncing: false, syncError: null, lastSyncAt: null });
      return;
    }
    await logoutSiteSession();
    if (supabase) {
      await supabase.auth.signOut();
    }
    set({ user: null, userRole: null, authResolved: true, syncing: false, syncError: null, lastSyncAt: null });
  },

  // ========== 权限判断 ==========
  canEdit: () => {
    const { user, userRole } = useAuthStore.getState();
    return !isContributorDemoUser(user)
      && (userRole === 'admin' || userRole === 'super_admin');
  },
  isSuperAdmin: () => {
    const { userRole } = useAuthStore.getState();
    return userRole === 'super_admin';
  },

  // ========== 认证弹窗 ==========
  showAuthModal: false,
  toggleAuthModal: () => set((state) => ({ showAuthModal: !state.showAuthModal })),
  closeAuthModal: () => set({ showAuthModal: false }),
  openAuthModal: () => set({ showAuthModal: true }),

  // ========== 云端同步状态 ==========
  syncing: false,
  syncError: null,
  lastSyncAt: null,

  setSyncing: (value) => set({ syncing: value }),
  setSyncError: (error) => set({ syncError: error }),
  setLastSyncAt: (value) => set({ lastSyncAt: value }),
  clearSyncError: () => set({ syncError: null }),
}));

export default useAuthStore;
