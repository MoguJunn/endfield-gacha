import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../services/admin/poolService.js', () => ({}));
vi.mock('../../../services/admin/publicCacheService.js', () => ({ invalidatePublicCache: vi.fn() }));
vi.mock('../../../stores/index.js', () => ({ useAuthStore: () => 'super_admin' }));
vi.mock('../../../utils/characterUtils.js', () => ({ characterCache: { refresh: vi.fn() } }));
import { usePools } from '../usePools.js';

function service() {
  return { loadPools: vi.fn().mockResolvedValue({ success: true, data: [{ pool_id: 'pool' }] }),
    loadCharacters: vi.fn().mockResolvedValue({ success: true, data: [] }),
    loadAllPoolCharacters: vi.fn().mockResolvedValue({ success: true, data: {} }),
    loadPoolCharactersForEdit: vi.fn().mockResolvedValue({ success: false, error: 'offline' }) };
}
describe('admin roster read state', () => {
  it('reports a failed roster and clears it only after retry succeeds', async () => {
    const api = service();
    api.loadAllPoolCharacters.mockResolvedValueOnce({ success: false, error: 'offline' });
    const toast = vi.fn();
    const { result } = renderHook(() => usePools(toast, { service: api }));
    await waitFor(() => expect(result.current.rosterLoading).toBe(false));
    expect(result.current.rosterError).toBe('offline');
    await act(() => result.current.reloadRoster());
    expect(result.current.rosterError).toBe('');
    expect(api.loadCharacters).toHaveBeenCalledTimes(2);
    expect(api.loadAllPoolCharacters).toHaveBeenCalledTimes(2);
  });

  it('does not open an empty edit draft after a scoped read failure', async () => {
    const api = service();
    const toast = vi.fn();
    const { result } = renderHook(() => usePools(toast, { service: api }));
    await waitFor(() => expect(result.current.rosterLoading).toBe(false));
    await act(() => result.current.startEdit({ pool_id: 'pool', name: '卡池' }));
    expect(result.current.showEditDialog).toBe(false);
    expect(result.current.editingPool).toBeNull();
    expect(toast).toHaveBeenCalledWith('读取卡池名单失败，未打开编辑: offline', 'error');
  });
});
