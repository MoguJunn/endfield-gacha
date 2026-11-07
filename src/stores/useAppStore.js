import { create } from 'zustand';
import { createEmptyGlobalSummaryStats, getGlobalSummaryStats } from '../services/statsService';
import { executeSupabaseRead } from '../services/supabaseRequest';

/**
 * 应用全局状态管理
 * 管理公告、全局统计等应用级数据
 */
const useAppStore = create((set, get) => ({
  // ========== 全局统计数据 ==========
  globalStats: null,
  globalStatsLoading: false,

  setGlobalStats: (stats) => set({ globalStats: stats }),
  setGlobalStatsLoading: (loading) => set({ globalStatsLoading: loading }),

  fetchGlobalStats: async (forceRefresh = false) => {
    const hasExistingStats = Boolean(get().globalStats);

    if (!hasExistingStats || forceRefresh) {
      set({ globalStatsLoading: true });
    }

    try {
      const data = await getGlobalSummaryStats(forceRefresh);
      const stats = data || createEmptyGlobalSummaryStats();
      set({ globalStats: stats });
      return stats;
    } finally {
      set({ globalStatsLoading: false });
    }
  },

  // ========== 公告系统 ==========
  announcements: [],
  gameAnnouncements: [],
  gameAnnouncementDigest: null,
  showAnnouncement: true,

  setAnnouncements: (announcements) => set({ announcements }),
  setGameAnnouncements: (gameAnnouncements) => set({ gameAnnouncements }),
  setGameAnnouncementDigest: (gameAnnouncementDigest) => set({ gameAnnouncementDigest }),
  toggleAnnouncement: () => set((state) => ({ showAnnouncement: !state.showAnnouncement })),
  closeAnnouncement: () => set({ showAnnouncement: false }),
  openAnnouncement: () => set({ showAnnouncement: true }),

  loadAnnouncements: async (supabase) => {
    if (!supabase) return;

    try {
      const { data, error } = await executeSupabaseRead(
        () => supabase
          .from('announcements')
          .select('*')
          .eq('is_active', true)
          .order('priority', { ascending: false })
          .order('created_at', { ascending: false }),
        {
          label: 'load active announcements',
          retries: 1
        }
      );

      if (!error && data) {
        set({ announcements: data });
      }
    } catch {
      // 静默失败
    }
  },

}));

export default useAppStore;
