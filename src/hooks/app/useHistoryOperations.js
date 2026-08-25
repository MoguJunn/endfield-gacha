import { useCallback } from 'react';
import { useHistoryPageStore, useHistoryStore, useUIStore, useAuthStore } from '../../stores';
import {
  deleteAccountGachaRecord,
  updateAccountGachaRecord,
} from '../../services/accountGachaDataService.js';

/**
 * 历史记录操作 Hook
 * 处理历史记录的编辑、删除操作
 */
export function useHistoryOperations({
  showToast,
  cloudSync,
  clearEditItemState
}) {
  const user = useAuthStore(state => state.user);
  const history = useHistoryStore(state => state.history);
  const setHistory = useHistoryStore(state => state.setHistory);

  const modalState = useUIStore(state => state.modalState);
  const setModalState = useUIStore(state => state.setModalState);
  const closeModal = useUIStore(state => state.closeModal);

  const { refreshPersonalData, saveHistoryToCloud } = cloudSync;

  const buildRecordLocator = useCallback((item) => ({
    recordId: item?.id ?? item?.record_id,
    gameUid: item?.gameUid || item?.game_uid,
    serverScope: item?.serverScope || item?.server_scope || item?.serverId || item?.server_id || 'legacy',
    currentPoolId: item?.poolId || item?.pool_id,
    seqId: item?.seqId || item?.seq_id,
  }), []);

  const reloadHistory = useCallback(async () => {
    const result = await refreshPersonalData?.(user, {
      kind: 'mutation',
      reason: 'history_record_mutation',
    });
    if (!result?.ok) {
      throw result?.error || new Error('个人抽卡数据刷新失败');
    }
    return result;
  }, [refreshPersonalData, user]);

  const invalidateLoadedHistory = useCallback(() => {
    useHistoryPageStore.getState().invalidate('history_mutation');
    setHistory([]);
  }, [setHistory]);

  // 关闭弹窗并清理编辑状态的辅助函数
  const closeModalAndClear = useCallback(() => {
    closeModal();
    clearEditItemState?.();
  }, [closeModal, clearEditItemState]);

  // 编辑记录
  const handleUpdateItem = useCallback(async (itemOrId, newConfig, reason = '') => {
    const itemToUpdate = typeof itemOrId === 'object'
      ? itemOrId
      : history.find(item => item.id === itemOrId);
    if (!itemToUpdate) return false;

    const updatedItem = { ...itemToUpdate, ...newConfig };

    if (user) {
      try {
        await updateAccountGachaRecord({
          ...buildRecordLocator(itemToUpdate),
          editVersion: Number(itemToUpdate.editVersion || itemToUpdate.edit_version || 1),
          changes: newConfig,
          reason,
        });
        invalidateLoadedHistory();
        await reloadHistory();
        clearEditItemState?.();
        showToast('记录已更新，保底与批次已重新计算', 'success');
        return true;
      } catch (error) {
        showToast(error.message || '记录更新失败', 'error', '保存失败');
        return false;
      }
    }

    await saveHistoryToCloud([updatedItem]);
    setHistory(prev => prev.map(item => item.id === itemToUpdate.id ? updatedItem : item));
    clearEditItemState?.();
    return true;
  }, [buildRecordLocator, clearEditItemState, history, invalidateLoadedHistory, reloadHistory, saveHistoryToCloud, setHistory, showToast, user]);

  // 删除单条记录 (触发弹窗)
  const handleDeleteItem = useCallback((itemOrId) => {
    const item = typeof itemOrId === 'object'
      ? itemOrId
      : history.find(record => record.id === itemOrId);
    if (!item) return;
    setModalState({ type: 'deleteItem', data: item });
  }, [history, setModalState]);

  // 确认删除单条记录
  const confirmRealDeleteItem = useCallback(async () => {
    const itemToDelete = typeof modalState.data === 'object'
      ? modalState.data
      : history.find(item => item.id === modalState.data);
    if (!itemToDelete) return;

    if (user) {
      try {
        await deleteAccountGachaRecord({
          ...buildRecordLocator(itemToDelete),
          reason: '用户确认该记录异常或不属于自己',
        });
        invalidateLoadedHistory();
        await reloadHistory();
        clearEditItemState?.();
        setModalState({ type: null, data: null });
        showToast('记录已删除并同步到云端', 'success');
      } catch (error) {
        showToast(error.message || '记录删除失败', 'error', '删除失败');
      }
      return;
    }

    setHistory(prev => prev.filter(item => item.id !== itemToDelete.id));
    clearEditItemState?.();
    setModalState({ type: null, data: null });
  }, [buildRecordLocator, clearEditItemState, history, invalidateLoadedHistory, modalState.data, reloadHistory, setHistory, setModalState, showToast, user]);

  // 删除整组记录 (触发弹窗)
  const handleDeleteGroup = useCallback((items) => {
    setModalState({ type: 'deleteGroup', data: items });
  }, [setModalState]);

  // 确认删除整组记录
  const confirmRealDeleteGroup = useCallback(async () => {
    const itemsToDelete = Array.isArray(modalState.data) ? modalState.data : [];
    const idsToDelete = new Set(itemsToDelete.map(item => item.id));

    if (user) {
      const results = await Promise.allSettled(itemsToDelete.map((item) => (
        deleteAccountGachaRecord({
          ...buildRecordLocator(item),
          reason: '用户删除所选批次记录',
        })
      )));
      const failed = results.filter((result) => result.status === 'rejected').length;
      const succeeded = results.length - failed;
      if (succeeded > 0) {
        invalidateLoadedHistory();
        await reloadHistory();
        setModalState({ type: null, data: null });
      }
      if (failed === 0) {
        showToast(`已删除 ${itemsToDelete.length} 条记录并同步到云端`, 'success');
      } else if (succeeded === 0) {
        showToast(`${failed} 条记录删除失败`, 'error', '删除失败');
      } else {
        showToast(`${succeeded} 条已删除，${failed} 条删除失败，列表已刷新`, 'warning');
      }
      return;
    }

    setHistory(prev => prev.filter(item => !idsToDelete.has(item.id)));
    setModalState({ type: null, data: null });
  }, [buildRecordLocator, invalidateLoadedHistory, modalState.data, reloadHistory, setHistory, setModalState, showToast, user]);

  return {
    closeModalAndClear,
    handleUpdateItem,
    handleDeleteItem,
    confirmRealDeleteItem,
    handleDeleteGroup,
    confirmRealDeleteGroup
  };
}

export default useHistoryOperations;
