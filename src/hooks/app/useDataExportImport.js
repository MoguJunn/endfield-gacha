import { useState, useCallback, useEffect } from 'react';
import { useHistoryStore, usePoolStore, useAuthStore } from '../../stores';
import { supabase } from '../../supabaseClient';
import { applyCloudDataToStores } from '../../utils/cloudDataSync.js';
import {
  buildImportedGameAccountMetadataEntries,
  saveGameAccountMetadata
} from '../../utils/gameAccountMetadata.js';
import {
  clearPendingImportDraft,
  loadPendingImportDraft,
  savePendingImportDraft
} from '../../utils/importPendingDraft.js';
import { buildImportResultNotification } from '../../utils/notificationModel.js';
import { resolveImportResultActionHref } from '../../utils/importResultSummary.js';
import { characterCache } from '../../utils/characterUtils.js';
import { useI18n } from '../../i18n/index.js';

function normalizeImportAccountOverride(accountOverride = null) {
  if (!accountOverride || typeof accountOverride !== 'object') {
    return null;
  }

  const gameUid = String(accountOverride.gameUid || accountOverride.game_uid || '').trim();
  const nickName = String(accountOverride.nickName || accountOverride.nick_name || '').trim();

  if (!gameUid || !nickName) {
    return null;
  }

  return { gameUid, nickName };
}

function applyImportAccountOverride(importedData, accountOverride = null) {
  const normalizedAccount = normalizeImportAccountOverride(accountOverride);
  if (!normalizedAccount) {
    return importedData;
  }

  return {
    ...importedData,
    accounts: [{
      ...(Array.isArray(importedData.accounts) ? importedData.accounts[0] : {}),
      gameUid: normalizedAccount.gameUid,
      nickName: normalizedAccount.nickName
    }],
    history: (importedData.history || []).map((record) => ({
      ...record,
      gameUid: normalizedAccount.gameUid,
      game_uid: normalizedAccount.gameUid,
      nickName: normalizedAccount.nickName,
      nick_name: normalizedAccount.nickName
    }))
  };
}

/**
 * 数据导入导出 Hook
 */
export function useDataExportImport({
  showToast,
  cloudSync,
  addDurableNotification = null,
}) {
  const { locale } = useI18n();
  const user = useAuthStore(state => state.user);
  const pools = usePoolStore(state => state.pools);
  const currentPoolId = usePoolStore(state => state.currentPoolId);
  const currentGameUid = usePoolStore(state => state.currentGameUid);
  const setPools = usePoolStore(state => state.setPools);
  const switchPool = usePoolStore(state => state.switchPool);
  const switchGameAccount = usePoolStore(state => state.switchGameAccount);
  const history = useHistoryStore(state => state.history);
  const setHistory = useHistoryStore(state => state.setHistory);
  const setSyncing = useAuthStore(state => state.setSyncing);

  const { savePoolToCloud, saveHistoryToCloud, loadCloudData } = cloudSync;

  const [restoredDraftInfo] = useState(() => loadPendingImportDraft());
  const [pendingImport, setPendingImportState] = useState(() => restoredDraftInfo.pendingImport);
  const [importWizardOpen, setImportWizardOpen] = useState(false);
  const [hasShownDraftRestoreToast, setHasShownDraftRestoreToast] = useState(false);

  const openImportWizard = useCallback(() => {
    setImportWizardOpen(true);
  }, []);

  const closeImportWizard = useCallback(() => {
    setImportWizardOpen(false);
  }, []);

  const setPendingImport = useCallback((nextValue) => {
    setPendingImportState(nextValue);
  }, []);

  useEffect(() => {
    if (pendingImport) {
      if (pendingImport.restoredFromDraft) {
        return;
      }
      savePendingImportDraft(pendingImport);
    } else {
      clearPendingImportDraft();
    }
  }, [pendingImport]);

  useEffect(() => {
    if (!restoredDraftInfo.pendingImport || hasShownDraftRestoreToast) {
      return;
    }

    setHasShownDraftRestoreToast(true);
    showToast({
      type: 'info',
      title: '已恢复待确认导入',
      message: '检测到本标签页还有未确认的文件导入预览，可以继续确认保存，或关闭预览后重新选择文件。',
      source: 'import.pendingDraft',
      actions: [
        {
          label: '重新选择文件',
          onClick: () => {
            setPendingImport(null);
            openImportWizard();
          },
          variant: 'secondary',
        },
      ],
    });
  }, [hasShownDraftRestoreToast, openImportWizard, restoredDraftInfo.pendingImport, setPendingImport, showToast]);

  const getRecordGameUid = useCallback((record) => (
    record?.gameUid || record?.game_uid || null
  ), []);

  const resolvePreferredImportedGameUid = useCallback((historyRecords, importedAccounts = []) => {
    const availableGameUids = [
      ...new Set(
        (Array.isArray(historyRecords) ? historyRecords : [])
          .map(getRecordGameUid)
          .filter(Boolean)
      )
    ];

    if (currentGameUid && availableGameUids.includes(currentGameUid)) {
      return currentGameUid;
    }

    const importedAccountUid = importedAccounts
      .map((account) => account?.gameUid || account?.hgUid || null)
      .find((value) => value && availableGameUids.includes(value));

    return importedAccountUid || availableGameUids[0] || null;
  }, [currentGameUid, getRecordGameUid]);

  const triggerFileDownload = useCallback((content, mimeType, extension, fileName = '') => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const now = new Date();
    const pad = n => n.toString().padStart(2, '0');
    const timeStr = `${now.getFullYear().toString().slice(-2)}-${pad(now.getMonth()+1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    link.download = fileName || `endfield-gacha-export-${timeStr}.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  const exportByFormat = useCallback(async (scopeOrOptions, formatId) => {
    try {
      const { buildExportContent, buildExportPayload } = await import('../../utils/dataExport.js');
      await characterCache.load();
      const payload = buildExportPayload({
        history,
        pools: Array.isArray(pools) ? pools : [],
        currentPoolId,
        currentGameUid,
        currentUserId: user?.id || null,
        characterCatalog: characterCache.getAll(),
        options: scopeOrOptions
      });
      if (payload.history.length === 0) {
        showToast('所选条件下无数据可导出', 'warning');
        return false;
      }

      const file = await buildExportContent(formatId, payload);
      triggerFileDownload(file.content, file.mimeType, file.extension, file.fileName);
      return true;
    } catch (error) {
      showToast(`导出失败：${error?.message || '导出模块加载失败'}`, 'error');
      return false;
    }
  }, [currentGameUid, currentPoolId, history, pools, showToast, triggerFileDownload, user?.id]);

  // 通用导出函数 - JSON
  const handleExportJSON = useCallback((scopeOrOptions) => {
    return exportByFormat(scopeOrOptions, 'internal_json_v3');
  }, [exportByFormat]);

  // 通用导出函数 - CSV
  const handleExportCSV = useCallback((scopeOrOptions) => {
    return exportByFormat(scopeOrOptions, 'internal_csv_flat');
  }, [exportByFormat]);

  const handleExportEndfieldGachaUserDataZip = useCallback((scopeOrOptions) => {
    return exportByFormat(scopeOrOptions, 'bhaoo_endfield_gacha_userdata_zip');
  }, [exportByFormat]);

  const handleExportEndfieldGachaHelperJSON = useCallback((scopeOrOptions) => {
    return exportByFormat(scopeOrOptions, 'endfield_gacha_helper_json');
  }, [exportByFormat]);

  const handleExportEndfieldGachaHelperCSV = useCallback((scopeOrOptions) => {
    return exportByFormat(scopeOrOptions, 'endfield_gacha_helper_csv');
  }, [exportByFormat]);

  const handleExportEndfieldGachaHelperUserDataZip = useCallback((scopeOrOptions) => {
    return exportByFormat(scopeOrOptions, 'endfield_gacha_helper_userdata_zip');
  }, [exportByFormat]);

  const handleExportEndgachaKwerTopPlainJSON = useCallback((scopeOrOptions) => {
    return exportByFormat(scopeOrOptions, 'endgacha_kwer_top_plain_json');
  }, [exportByFormat]);

  const handleExportEndgachaKwerTopPlainTXT = useCallback((scopeOrOptions) => {
    return exportByFormat(scopeOrOptions, 'endgacha_kwer_top_plain_txt');
  }, [exportByFormat]);

  // 导入文件处理
  const handleImportFile = useCallback((event) => {
    const file = event.target.files[0];
    if (!file) return;

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      showToast("文件过大，最大支持 10MB", 'error');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const [
          { parseImportFileContent },
          { validateAndNormalizeImportData }
        ] = await Promise.all([
          import('../../utils/dataImportFileParser.js'),
          import('../../utils/dataImport.js')
        ]);
        const importedData = await parseImportFileContent(e.target.result, {
          fileName: file.name
        });

        const validation = validateAndNormalizeImportData(importedData, {
          existingPools: pools,
          currentUserId: user?.id || null,
          sourceFileName: file.name
        });
        if (!validation.valid) {
          showToast({
            type: 'error',
            title: '数据验证失败',
            message: validation.errors.slice(0, 3).join('\n'),
            source: 'import.fileValidation',
            diagnostic: {
              phase: 'file_import_validation',
              fileName: file.name,
              fileSize: file.size,
              errors: validation.errors,
            },
          });
          event.target.value = '';
          return;
        }

        const willSyncToCloud = !!(user && supabase);
        const nextPendingImport = {
          data: validation.normalizedData,
          willSyncToCloud,
          stats: validation.stats,
          sourceFile: {
            name: file.name,
            size: file.size,
            type: file.type || null,
            lastModified: file.lastModified || null
          },
          createdAt: new Date().toISOString()
        };

        setPendingImport(nextPendingImport);
        closeImportWizard();
        showToast({
          type: 'info',
          title: '导入预览已生成',
          message: `已解析 ${validation.stats.historyCount} 条记录、${validation.stats.poolCount} 个卡池。确认前会保留在本标签页，刷新后也可恢复。`,
          source: 'import.filePreview'
        });

      } catch (error) {
        showToast({
          type: 'error',
          title: '导入失败',
          message: error?.message || '文件解析错误，请确认导入文件格式。',
          source: 'import.fileParse',
          diagnostic: {
            phase: 'file_import_parse',
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type || null,
            error
          }
        });
      }
      event.target.value = '';
    };
    if (file.name.toLowerCase().endsWith('.xlsx')) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  }, [closeImportWizard, pools, setPendingImport, showToast, user]);

  // 确认导入
  const confirmImport = useCallback(async (options = {}) => {
    if (!pendingImport) return;

    const { getHistoryImportDedupKey } = await import('../../utils/dataImport.js');
    const { willSyncToCloud } = pendingImport;
    const importedData = applyImportAccountOverride(pendingImport.data, options.accountOverride);

    const newPools = [...(pools || [])];
    const existingPoolIds = new Set(newPools.map(pool => pool?.id).filter(Boolean));
    const addedPools = [];
    importedData.pools.forEach((impPool) => {
      if (!existingPoolIds.has(impPool.id)) {
        newPools.push(impPool);
        addedPools.push(impPool);
        existingPoolIds.add(impPool.id);
      }
    });

    const newHistory = [...history];
    const existingHistoryKeys = new Set(
      newHistory
        .map(getHistoryImportDedupKey)
        .filter(Boolean)
    );
    const addedHistory = [];

    importedData.history.forEach((impItem) => {
      const dedupKey = getHistoryImportDedupKey(impItem);
      if (!dedupKey || !existingHistoryKeys.has(dedupKey)) {
        newHistory.push(impItem);
        addedHistory.push(impItem);
        if (dedupKey) {
          existingHistoryKeys.add(dedupKey);
        }
      }
    });

    const importedAccounts = buildImportedGameAccountMetadataEntries({
      accounts: importedData.accounts || [],
      historyRecords: importedData.history || [],
      importedAt: importedData.importedAt,
      importSource: importedData.sourceFormatId || 'file_import'
    });

    importedAccounts.forEach((account) => {
      saveGameAccountMetadata(account);
    });

    const preferredImportedGameUid = resolvePreferredImportedGameUid(newHistory, importedAccounts);
    const actionHref = resolveImportResultActionHref();
    const viewImportedDataAction = {
      label: locale === 'en-US' ? 'View imported data' : '查看已导入数据',
      href: actionHref,
      variant: 'primary',
    };
    const buildImportNotificationPayload = ({
      status,
      partial = false,
      source,
      syncedToCloud,
      completedAt,
      error = null,
    }) => ({
      status,
      partial,
      source,
      sourceFormatId: importedData.sourceFormatId,
      sourceFormatLabel: importedData.sourceFormatLabel,
      data: importedData,
      addedPools: addedPools.length,
      addedHistory: addedHistory.length,
      duplicateHistory: Math.max((importedData.history?.length || 0) - addedHistory.length, 0),
      poolCount: importedData.pools?.length || 0,
      syncedToCloud,
      completedAt,
      actionHref,
      error,
    });

    applyCloudDataToStores(
      { pools: newPools, history: newHistory },
      {
        setPools,
        switchPool,
        setHistory,
        preferredPoolId: currentPoolId,
        preferredGameUid: preferredImportedGameUid
      }
    );
    if (preferredImportedGameUid) {
      switchGameAccount(preferredImportedGameUid);
    }
    setPendingImport(null);

    if (willSyncToCloud && (addedPools.length > 0 || addedHistory.length > 0)) {
      setSyncing(true);
      try {
        for (const pool of addedPools) {
          // eslint-disable-next-line no-await-in-loop -- imported pools are synced sequentially so partial failures stay attributable
          await savePoolToCloud(pool);
        }
        const batchSize = 100;
        for (let i = 0; i < addedHistory.length; i += batchSize) {
          const batch = addedHistory.slice(i, i + batchSize);
          // eslint-disable-next-line no-await-in-loop -- imported history batches are intentionally serialized
          await saveHistoryToCloud(batch);
        }

        if (typeof loadCloudData === 'function' && user) {
          const refreshedCloudData = await loadCloudData(user);
          if (refreshedCloudData) {
            applyCloudDataToStores(refreshedCloudData, {
              setPools,
              switchPool,
              setHistory,
              preferredPoolId: currentPoolId,
              preferredGameUid: preferredImportedGameUid
            });
            if (preferredImportedGameUid) {
              switchGameAccount(preferredImportedGameUid);
            }
          }
        }

        const duplicateHistory = Math.max((importedData.history?.length || 0) - addedHistory.length, 0);
        const completedAt = new Date().toISOString();
        showToast({
          type: 'success',
          title: '导入成功',
          message: `导入完成：新增 ${addedHistory.length} 条记录，跳过 ${duplicateHistory} 条重复记录，已同步到云端。`,
          source: 'import.confirm',
          actions: [viewImportedDataAction]
        });
        addDurableNotification?.(buildImportResultNotification(buildImportNotificationPayload({
          status: 'success',
          source: 'import.confirm',
          syncedToCloud: true,
          completedAt,
        }), { locale }));
      } catch (syncError) {
        const completedAt = new Date().toISOString();
        showToast({
          type: 'warning',
          title: '部分成功',
          message: `已在本机新增 ${addedHistory.length} 条记录，但云端同步失败。稍后刷新或重新登录后可再尝试同步。`,
          source: 'import.cloudSync',
          diagnostic: {
            phase: 'file_import_cloud_sync',
            sourceFormatId: importedData.sourceFormatId,
            addedPools: addedPools.length,
            addedHistory: addedHistory.length,
            duplicateHistory: Math.max((importedData.history?.length || 0) - addedHistory.length, 0),
            error: syncError
          },
          actions: [viewImportedDataAction]
        });
        addDurableNotification?.(buildImportResultNotification(buildImportNotificationPayload({
          status: 'partial',
          partial: true,
          source: 'import.cloudSync',
          syncedToCloud: false,
          completedAt,
          error: syncError,
        }), { locale }));
      } finally {
        setSyncing(false);
      }
    } else {
      const duplicateHistory = Math.max((importedData.history?.length || 0) - addedHistory.length, 0);
      const completedAt = new Date().toISOString();
      showToast({
        type: 'success',
        title: '导入成功',
        message: `导入完成：新增 ${addedHistory.length} 条记录，跳过 ${duplicateHistory} 条重复记录。`,
        source: 'import.confirm',
        actions: [viewImportedDataAction]
      });
      addDurableNotification?.(buildImportResultNotification(buildImportNotificationPayload({
        status: 'success',
        source: 'import.confirm',
        syncedToCloud: false,
        completedAt,
      }), { locale }));
    }
  }, [addDurableNotification, pendingImport, pools, history, currentPoolId, loadCloudData, locale, resolvePreferredImportedGameUid, savePoolToCloud, saveHistoryToCloud, setHistory, setPendingImport, setPools, setSyncing, showToast, switchGameAccount, switchPool, user]);

  return {
    pendingImport,
    setPendingImport,
    importWizardOpen,
    openImportWizard,
    closeImportWizard,
    handleExportJSON,
    handleExportCSV,
    handleExportEndfieldGachaUserDataZip,
    handleImportFile,
    handleExportEndfieldGachaHelperJSON,
    handleExportEndfieldGachaHelperCSV,
    handleExportEndfieldGachaHelperUserDataZip,
    handleExportEndgachaKwerTopPlainJSON,
    handleExportEndgachaKwerTopPlainTXT,
    confirmImport
  };
}

export default useDataExportImport;
