import { useState, useCallback, useEffect, useRef } from 'react';
import {
  useHistoryStore,
  usePoolStore,
  useAuthStore,
  usePersonalAnalysisStore,
} from '../../stores';
import { supabase } from '../../supabaseClient';
import { loadAccountGachaData, loadAllAccountGachaHistoryForAccounts } from '../../services/accountGachaDataService.js';
import { applyCloudDataToStores } from '../../utils/cloudDataSync.js';
import {
  buildImportedGameAccountMetadataEntries,
  isGameAccountSelectionMatch,
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
import { validateWorkbenchPoolOperations } from '../../../shared/workbenchPoolAvailability.js';
import { filterImportedHistory } from '../../utils/importHistoryMerge.js';

function normalizeImportAccountOverride(accountOverride = null) {
  if (!accountOverride || typeof accountOverride !== 'object') {
    return null;
  }

  const gameUid = String(accountOverride.gameUid || accountOverride.game_uid || '').trim();
  const nickName = String(accountOverride.nickName || accountOverride.nick_name || '').trim();

  if (!gameUid || !nickName) {
    return null;
  }

  const serverId = String(accountOverride.serverId || '').trim();
  return { gameUid, nickName, ...(['1', '2', '3', 'bilibili'].includes(serverId) ? { serverId, serverScope: serverId, region: ['1', 'bilibili'].includes(serverId) ? 'cn' : 'intl' } : {}) };
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
      ...normalizedAccount,
    }],
    history: (importedData.history || []).map((record) => ({
      ...record,
      gameUid: normalizedAccount.gameUid,
      game_uid: normalizedAccount.gameUid,
      nickName: normalizedAccount.nickName,
      nick_name: normalizedAccount.nickName,
      ...(normalizedAccount.serverId ? { serverId: normalizedAccount.serverId, server_id: normalizedAccount.serverId,
        serverScope: normalizedAccount.serverId, server_scope: normalizedAccount.serverId, region: normalizedAccount.region } : {})
    })),
    workbenchEntries: (importedData.workbenchEntries || []).map(entry => ({ ...entry, gameUid: normalizedAccount.gameUid,
      ...(normalizedAccount.serverId ? { serverScope: normalizedAccount.serverId } : {}) }))
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
  const analysisAvailability = usePersonalAnalysisStore(state => state.availability);
  const analysisAccounts = usePersonalAnalysisStore(state => state.owner?.accounts ?? null);

  const { savePoolToCloud, saveHistoryToCloud, refreshPersonalData } = cloudSync;

  const [restoredDraftInfo] = useState(() => loadPendingImportDraft());
  const [pendingImport, setPendingImportState] = useState(() => restoredDraftInfo.pendingImport);
  const [importWizardOpen, setImportWizardOpen] = useState(false);
  const [hasShownDraftRestoreToast, setHasShownDraftRestoreToast] = useState(false);
  const importInFlight = useRef(false);

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
      ...new Set([...(Array.isArray(historyRecords) ? historyRecords : []).map(getRecordGameUid),
        ...importedAccounts.map(account => account.gameUid || account.game_uid)].filter(Boolean))
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
      const {
        buildExportContent,
        buildExportPayload,
        normalizeExportOptions,
      } = await import('../../utils/dataExport.js');
      const normalizedOptions = normalizeExportOptions(scopeOrOptions, {
        currentGameUid,
        defaultFormat: formatId,
      });
      const hasAnalysisSnapshot = Boolean(user) && ['ready', 'stale', 'empty'].includes(analysisAvailability);
      let exportHistory = history;

      if (hasAnalysisSnapshot) {
        if (analysisAvailability === 'empty') {
          exportHistory = [];
        } else {
          const availableAccounts = Array.isArray(analysisAccounts) ? analysisAccounts : [];
          const selectedAccountValue = normalizedOptions.gameUid || currentGameUid;
          const selectedAccounts = normalizedOptions.accountFilter === 'all'
            ? availableAccounts
            : availableAccounts.filter((account) => (
                isGameAccountSelectionMatch(account, selectedAccountValue)
              ));

          setSyncing(true);
          try {
            const result = await loadAllAccountGachaHistoryForAccounts({
              accounts: selectedAccounts,
              expectedOwnerId: user.id,
            });
            exportHistory = result.history;
          } finally {
            setSyncing(false);
          }
        }
      }

      let workbenchEntries = [];
      if (user && formatId === 'internal_json_v3') {
        const { loadWorkbenchEntriesForExport } = await import('../../services/workbenchTransferService.js');
        workbenchEntries = await loadWorkbenchEntriesForExport([...(analysisAccounts || []), ...exportHistory]);
      }
      await characterCache.load();
      const payload = buildExportPayload({
        history: exportHistory,
        pools: Array.isArray(pools) ? pools : [],
        currentPoolId,
        currentGameUid,
        currentUserId: user?.id || null,
        characterCatalog: characterCache.getAll(),
        workbenchEntries,
        options: normalizedOptions
      });
      if (payload.history.length === 0 && !payload.supplements?.workbenchEntries?.length) {
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
  }, [analysisAccounts, analysisAvailability, currentGameUid, currentPoolId, history, pools, setSyncing, showToast, triggerFileDownload, user]);

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
        if (file.name.toLowerCase().endsWith('.xlsx')) await characterCache.load();
        const importOptions = { fileName: file.name, existingPools: pools, characters: characterCache.getAll() };
        const importedData = await parseImportFileContent(e.target.result, importOptions);
        if (importedData?.code === 0 && Array.isArray(importedData.data?.list)) await characterCache.load();

        const validation = validateAndNormalizeImportData(importedData, {
          existingPools: pools,
          currentUserId: user?.id || null,
          sourceFileName: file.name,
          characters: characterCache.getAll(),
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
          message: `已解析 ${validation.stats.historyCount} 条明细、${validation.stats.supplementCount || 0} 条补录、${validation.stats.poolCount} 个卡池。请在预览中核对后保存。`,
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
    if (!pendingImport || importInFlight.current) return;
    importInFlight.current = true;
    try {

    const { willSyncToCloud } = pendingImport;
    const importedData = applyImportAccountOverride(pendingImport.data, options.accountOverride);
    const authoritativePools = [...(pools || []), ...(importedData.pools || []).filter(pool => !(pools || []).some(existing => existing.id === pool.id))];
    const availability = validateWorkbenchPoolOperations({
      entries: [...(importedData.history || []), ...(importedData.workbenchEntries || [])], pools: authoritativePools,
    });
    if (availability.length) {
      showToast(`${availability.map(item => item.message).join('；')}导入预览已保留。`, 'warning');
      return;
    }
    const supplementCount = importedData.workbenchEntries?.length || 0;
    if (importedData.accountServerMissing && !['1', '2', '3'].includes(importedData.accounts?.[0]?.serverId)) {
      showToast('请先选择这份 Excel 对应的游戏区服，导入预览已保留。', 'warning');
      return;
    }
    if (supplementCount && (!willSyncToCloud || !user)) {
      showToast('补录数据需要登录后由服务器校验保存，导入预览已保留。', 'warning');
      return;
    }
    let savedHistory = history;
    let savedCount = 0;
    const updateProgress = (phase, completed, total) => setPendingImportState(current => current
      ? { ...current, data: importedData, progress: { phase, completed, total } } : current);
    if (willSyncToCloud && user) {
      setSyncing(true);
      updateProgress('checking', 0, importedData.history.length);
      try {
        const saved = await loadAccountGachaData();
        if (saved.meta?.truncated || saved.meta?.ownerId !== user.id) throw new Error('未能确认完整的账号已有记录');
        savedHistory = saved.history;
      } catch (error) {
        updateProgress('failed', 0, importedData.history.length);
        showToast(`读取已有记录失败：${error.message}。导入预览已保留，请重试。`, 'warning');
        return;
      }
    }

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

    const addedHistory = filterImportedHistory(importedData.history, savedHistory, newPools);
    const newHistory = [...history, ...filterImportedHistory(importedData.history, history, newPools)];

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

    const applyImportedData = () => {
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
    };

    if (willSyncToCloud && user) {
      setSyncing(true);
      updateProgress('saving', 0, addedHistory.length);
      try {
        for (const pool of addedPools) {
          // eslint-disable-next-line no-await-in-loop -- imported pools are synced sequentially so partial failures stay attributable
          const saved = await savePoolToCloud(pool);
          if (!saved) throw new Error(`卡池“${pool.name}”保存失败，请重试`);
        }
        const batchSize = 100;
        for (let i = 0; i < addedHistory.length; i += batchSize) {
          const batch = addedHistory.slice(i, i + batchSize);
          // eslint-disable-next-line no-await-in-loop -- imported history batches are intentionally serialized
          const receipt = await saveHistoryToCloud(batch);
          if (Number(receipt?.saved?.history) + Number(receipt?.skipped?.history) !== batch.length) {
            throw new Error('服务器未确认这一批记录全部保存，请重试继续导入');
          }
          savedCount += batch.length;
          updateProgress('saving', savedCount, addedHistory.length);
        }
        if (supplementCount) {
          if (['endfield_helper_summary_xlsx', 'lcx_wiki_json'].includes(importedData.sourceFormatId)) {
            const { importRescueSupplements } = await import('../../services/rescueImportService.js');
            await importRescueSupplements(importedData);
          } else {
            const { importWorkbenchEntries } = await import('../../services/workbenchTransferService.js');
            await importWorkbenchEntries(importedData.workbenchEntries);
          }
        }

        applyImportedData();
        if (typeof refreshPersonalData === 'function' && user) {
          updateProgress('refreshing', savedCount, addedHistory.length);
          const refreshResult = await refreshPersonalData(user, {
            kind: 'mutation',
            reason: 'file_import_complete',
            preferredPoolId: currentPoolId,
            preferredGameUid: preferredImportedGameUid,
          });
          if (!refreshResult?.ok && !refreshResult?.stale) {
            throw refreshResult?.error || new Error('导入成功，但云端数据校验失败');
          }
          if (preferredImportedGameUid) {
            switchGameAccount(preferredImportedGameUid);
          }
        }

        setPendingImport(null);
        const duplicateHistory = Math.max((importedData.history?.length || 0) - addedHistory.length, 0);
        const completedAt = new Date().toISOString();
        showToast({
          type: 'success',
          title: '导入成功',
          message: `导入完成：新增 ${addedHistory.length} 条记录，跳过 ${duplicateHistory} 条重复记录${supplementCount ? `，${supplementCount} 条补录已校验保存` : ''}，已同步到云端。`,
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
        updateProgress('failed', savedCount, addedHistory.length);
        const completedAt = new Date().toISOString();
        showToast({
          type: 'warning',
          title: '部分成功',
          message: `服务器已确认 ${savedCount}/${addedHistory.length} 条待保存明细。${syncError.message}。导入预览已保留，重试会核对服务端记录并继续。`,
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
      applyImportedData();
      setPendingImport(null);
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
    } finally {
      importInFlight.current = false;
      setSyncing(false);
    }
  }, [addDurableNotification, pendingImport, pools, history, currentPoolId, locale, refreshPersonalData, resolvePreferredImportedGameUid, savePoolToCloud, saveHistoryToCloud, setHistory, setPendingImport, setPools, setSyncing, showToast, switchGameAccount, switchPool, user]);

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
