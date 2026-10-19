import { create } from 'zustand';
import { readStorageValue, writeStorageValue } from '../utils/storageUtils.js';
import { DEFAULT_MAINTENANCE_NOTICE, normalizeMaintenanceNotice } from '../../shared/siteMaintenance.js';

const SNAPSHOT_KEY = 'site_maintenance_notice_v1';
const readSnapshot = () => {
  try {
    const value = readStorageValue(SNAPSHOT_KEY, null, { raw: true });
    return value ? normalizeMaintenanceNotice(JSON.parse(value)) : null;
  } catch { return null; }
};
const snapshot = readSnapshot();
let inFlight = null;
let checkedAt = 0;

const useMaintenanceStore = create((set, get) => ({
  notice: snapshot || { ...DEFAULT_MAINTENANCE_NOTICE },
  hasSnapshot: Boolean(snapshot),
  applyNotice: value => {
    const notice = normalizeMaintenanceNotice(value);
    try { writeStorageValue(SNAPSHOT_KEY, JSON.stringify(notice), { raw: true }); } catch { /* Storage may be disabled. */ }
    checkedAt = Date.now();
    set({ notice, hasSnapshot: true });
  },
  refresh: async () => {
    if (Date.now() - checkedAt < 60000) return;
    if (inFlight) return inFlight;
    checkedAt = Date.now();
    inFlight = (async () => {
      try {
        const response = await fetch('/api/maintenance', { signal: AbortSignal.timeout(6000) });
        if (!response.ok) return;
        const result = await response.json();
        if (result.success !== true || !result.data || typeof result.data.enabled !== 'boolean') return;
        // A cold server's deployment notice cannot overwrite a visitor's last
        // confirmed administrator state while the database is unavailable.
        if (result.meta?.source === 'deployment') {
          if (!get().hasSnapshot) set({ notice: normalizeMaintenanceNotice(result.data) });
        } else get().applyNotice(result.data);
      } catch { /* Keep the last notice during the upgrade. No automatic retry burst. */ }
    })();
    try { await inFlight; } finally { inFlight = null; }
  },
}));

export default useMaintenanceStore;
