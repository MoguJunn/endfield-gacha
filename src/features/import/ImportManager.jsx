import { useState, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Save, RefreshCw, HelpCircle, X, AlertCircle, CheckCircle, User, Cloud, CloudOff, Layers, Clock } from 'lucide-react';
import { useAuthStore, useHistoryStore, usePoolStore } from '../../stores';
import {
  buildGameAccountKey,
  buildImportedGameAccountMetadataEntries,
  buildHistorySeqDedupeKeys,
  isGameAccountSelectionMatch,
  saveGameAccountMetadata
} from '../../utils/gameAccountMetadata.js';
import { applyCloudDataToStores } from '../../utils/cloudDataSync.js';
import { useCloudSync } from '../../hooks';
import {
  loadAccountGachaSeqKeys,
  resolveAccountGachaAliases,
  saveAccountGachaData,
} from '../../services/accountGachaDataService.js';
import {
  isOAuthAccountCompletionRequired,
  loadAccountSecurityState,
} from '../../services/accountSecurityService.js';
import {
  filterImportedHistoryRecords,
  prepareOfficialImportPersistenceData,
} from './importPersistence.js';
import { notifyOfficialBotImportUpdated } from '../../services/accountIntegrationsService.js';
import OfficialAPIImport from './OfficialAPIImport';
import { getPoolName } from './importShared.js';
import { useI18n } from '../../i18n/index.js';
import appLogger from '../../utils/appLogger.js';
import { buildImportResultSummary } from '../../utils/importResultSummary.js';

/**
 * 导入状态枚举
 */
const ImportStatus = {
  IDLE: 'idle',
  SAVING: 'saving',
  SUCCESS: 'success',
  ERROR: 'error'
};

/**
 * 导入进度条组件 (Technical Style)
 */
const ImportProgressBar = ({ progress, status, message, t }) => {
  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1 text-[10px] uppercase tracking-widest text-slate-500 dark:text-zinc-500 transition-colors">
        <span className="flex items-center gap-2">
          {status === ImportStatus.SAVING ? (
            <>
              <Save size={10} className="animate-pulse text-blue-600 dark:text-blue-500" />
              {t('import.progress.saving')}
            </>
          ) : (
            <>
              <RefreshCw size={10} className="animate-spin text-amber-500 dark:text-yellow-500" />
              {t('import.progress.processing')}
            </>
          )}
        </span>
        <span>{Math.round(progress)}%</span>
      </div>
      <div className="h-1.5 w-full bg-slate-200 dark:bg-zinc-800 relative overflow-hidden transition-colors">
        <div 
          className={`h-full transition-all duration-300 ${status === ImportStatus.SAVING ? 'bg-blue-600 dark:bg-blue-500' : 'bg-amber-500 dark:bg-yellow-500'}`}
          style={{ width: `${progress}%` }}
        ></div>
      </div>
      <div className="mt-1 text-xs text-slate-500 dark:text-zinc-400 text-center transition-colors">
        {message}
      </div>
    </div>
  );
};

function getImportModeLabel(importMode, t) {
  if (importMode === 'full') {
    return t('import.details.modeFull');
  }
  if (importMode === 'incremental') {
    return t('import.details.modeIncremental');
  }
  return t('common.unknown');
}

function getSyncStatusDetail(syncStatus, t) {
  if (syncStatus === 'synced') {
    return {
      icon: Cloud,
      label: t('import.details.syncCloud'),
      className: 'text-emerald-700 dark:text-emerald-400'
    };
  }
  if (syncStatus === 'failed' || syncStatus === 'partial') {
    return {
      icon: CloudOff,
      label: t('import.details.syncPartial'),
      className: 'text-amber-700 dark:text-amber-400'
    };
  }
  if (syncStatus === 'local') {
    return {
      icon: CloudOff,
      label: t('import.details.syncLocal'),
      className: 'text-amber-700 dark:text-amber-400'
    };
  }
  return {
    icon: Cloud,
    label: t('common.unknown'),
    className: 'text-slate-600 dark:text-zinc-400'
  };
}

async function resolveImportAliasMaps(records) {
  const poolIds = [...new Set((Array.isArray(records) ? records : [])
    .map(record => record?.pool_id || record?.poolId)
    .filter(Boolean))];
  const characterIds = [...new Set((Array.isArray(records) ? records : [])
    .map(record => record?.character_id || record?.item_id || record?.charId || record?.weaponId)
    .filter(Boolean))];

  if (poolIds.length === 0 && characterIds.length === 0) {
    return {
      poolAliases: {},
      characterAliases: {},
    };
  }

  return resolveAccountGachaAliases({
    poolIds,
    characterIds,
  });
}

/**
 * ImportManager 组件 V3
 */
export default function ImportManager({ isOpen, onClose, onImportComplete, onOpenFileImport }) {
  const { t, locale, formatNumber, formatDateTime } = useI18n();
  const navigate = useNavigate();
  const [importStatus, setImportStatus] = useState(ImportStatus.IDLE);
  const [importResult, setImportResult] = useState(null);
  const [showGuide, setShowGuide] = useState(false);
  const [saveProgress, setSaveProgress] = useState({ current: 0, total: 0 });
  const [errorMessage, setErrorMessage] = useState('');
  const [fetchStatus, setFetchStatus] = useState('idle'); // 追踪子组件的获取状态
  const [accountSecuritySnapshot, setAccountSecuritySnapshot] = useState(null);

  // 从 stores 获取数据
  const user = useAuthStore(state => state.user);
  const pools = usePoolStore(state => state.pools);
  const currentPoolId = usePoolStore(state => state.currentPoolId);
  const setPools = usePoolStore(state => state.setPools);
  const switchPool = usePoolStore(state => state.switchPool);
  const switchGameAccount = usePoolStore(state => state.switchGameAccount);
  const setHistory = useHistoryStore(state => state.setHistory);
  const { loadCloudData } = useCloudSync({ showToast: () => {} });
  const accountSecurityState = accountSecuritySnapshot?.userId === user?.id
    ? accountSecuritySnapshot.state
    : null;
  const officialImportBlocked = Boolean(
    isOpen
    && user
    && isOAuthAccountCompletionRequired(accountSecurityState)
  );

  useEffect(() => {
    if (!isOpen || !user?.id) {
      return undefined;
    }

    let cancelled = false;
    const targetUserId = user.id;
    loadAccountSecurityState()
      .then((state) => {
        if (!cancelled) {
          setAccountSecuritySnapshot({
            userId: targetUserId,
            state: state || null,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAccountSecuritySnapshot({
            userId: targetUserId,
            state: null,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, user?.id]);

  // 处理子组件的获取状态变化
  const handleFetchStatusChange = useCallback((status) => {
    setFetchStatus(status);
  }, []);

  const persistImportedAccountMetadata = useCallback(({
    accounts,
    historyRecords,
    importedAt,
    importSource
  }) => {
    const metadataEntries = buildImportedGameAccountMetadataEntries({
      accounts,
      historyRecords,
      importedAt,
      importSource
    });

    metadataEntries.forEach((entry) => {
      saveGameAccountMetadata(entry);
    });
  }, []);

  const notifyBotImportUpdated = useCallback(async ({ summary, userInfo }) => {
    try {
      await notifyOfficialBotImportUpdated({ summary, userInfo });
    } catch (notifyError) {
      appLogger.warn('[ImportManager] 官方 BOT 导入通知失败:', notifyError);
    }
  }, []);

  /**
   * 直接保存卡池到 Supabase
   * 修改为：首次创建，后续不更新（避免多账号导入时覆盖）
   */
  const savePoolsToServer = useCallback(async (poolEntries) => {
    if (!user || poolEntries.length === 0) return;
    await saveAccountGachaData({ pools: poolEntries });
  }, [user]);

  /**
   * 直接保存历史记录到 Supabase
   */
  const saveHistoryToServer = useCallback(async (records) => {
    if (!user || records.length === 0) {
      return { savedHistory: 0, skippedHistory: 0 };
    }

    const batchSize = 100;
    let processedCount = 0;
    let savedHistory = 0;
    let skippedHistory = 0;

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      // eslint-disable-next-line no-await-in-loop -- history batches must be persisted in order so progress and retry boundaries stay deterministic
      const result = await saveAccountGachaData({ history: batch });
      savedHistory += Number(result?.saved?.history || 0);
      skippedHistory += Number(result?.skipped?.history || 0);
      processedCount += batch.length;
      setSaveProgress({ current: processedCount, total: records.length });
    }

    return { savedHistory, skippedHistory };
  }, [user]);

  /**
   * 从服务器查询已存在的记录（用于去重）
   * 使用 game_uid + pool_id + seq_id 组合作为唯一标识
   * 注意：seqId 是每个卡池独立的序列号，不同卡池可能有相同的 seqId
   */
  const getExistingSeqIds = useCallback(async ({ gameUid, accountKey, serverId, region } = {}) => {
    if (!user) return new Set();

    try {
      const { keys } = await loadAccountGachaSeqKeys({ gameUid, accountKey, serverId, region });
      const dedupeKeys = new Set();
      keys.forEach((row) => {
        buildHistorySeqDedupeKeys(row).forEach(key => dedupeKeys.add(key));
      });
      return dedupeKeys;
    } catch (error) {
      appLogger.error('[ImportManager] 查询已有记录失败:', error);
      return new Set();
    }
  }, [user]);

  /**
   * 处理 API 导入完成
   */
  const handleAPIImportComplete = useCallback(async (result) => {
    if (!result?.success) {
      setImportStatus(ImportStatus.ERROR);
      setErrorMessage(result?.error || t('import.errorTitle'));
      return;
    }

    if (result.backendImported) {
      const importedAt = new Date().toISOString();
      const importedGameUid = result.userInfo?.gameUid || result.userInfo?.hgUid || null;
      const importedAccountKey = buildGameAccountKey(result.userInfo) || importedGameUid;
      const anomalyPoolIds = Array.isArray(result.summary?.anomalyPoolIds)
        ? result.summary.anomalyPoolIds
        : [];

      if (result.userInfo) {
        saveGameAccountMetadata(result.userInfo);
      }

      try {
        const refreshedCloudData = await loadCloudData(user);
        applyCloudDataToStores(refreshedCloudData, {
          setPools,
          switchPool,
          setHistory,
          preferredPoolId: anomalyPoolIds[0] || currentPoolId,
          preferredGameUid: importedAccountKey || importedGameUid
        });

        if (importedAccountKey || importedGameUid) {
          switchGameAccount(importedAccountKey || importedGameUid);
        }

        const refreshedHistory = Array.isArray(refreshedCloudData?.history)
          ? refreshedCloudData.history
          : [];
        const importedHistoryRecords = importedAccountKey || importedGameUid
          ? refreshedHistory.filter((record) => isGameAccountSelectionMatch(record, importedAccountKey || importedGameUid))
          : refreshedHistory;

        persistImportedAccountMetadata({
          accounts: result.userInfo ? [result.userInfo] : [],
          historyRecords: importedHistoryRecords,
          importedAt,
          importSource: 'official_api'
        });
      } catch (refreshError) {
        appLogger.error('[ImportManager] 刷新导入后的云端数据失败:', refreshError);
        persistImportedAccountMetadata({
          accounts: result.userInfo ? [result.userInfo] : [],
          historyRecords: [],
          importedAt,
          importSource: 'official_api'
        });
      }

      setImportResult(result);
      setImportStatus(ImportStatus.SUCCESS);
      setSaveProgress({
        current: result.summary?.newRecords || 0,
        total: result.summary?.total || 0
      });
      void notifyBotImportUpdated({
        summary: result.summary,
        userInfo: result.userInfo,
      });
      return;
    }

    if (!result.records || result.records.length === 0) {
      setImportStatus(ImportStatus.ERROR);
      setErrorMessage(t('import.noRecords'));
      return;
    }

    if (!user) {
      setImportStatus(ImportStatus.ERROR);
      setErrorMessage(t('import.loginFirst'));
      return;
    }

    try {
      const importedAt = new Date().toISOString();
      setImportStatus(ImportStatus.SAVING);
      setSaveProgress({ current: 0, total: result.records.length });
      if (result.userInfo) {
        saveGameAccountMetadata(result.userInfo);
      }

      const {
        currentGameUid,
        currentAccountKey,
        poolEntries,
        historyRecords,
      } = await prepareOfficialImportPersistenceData({
        records: result.records,
        userInfo: result.userInfo,
        pools,
        ...await resolveImportAliasMaps(result.records).catch((aliasError) => {
          appLogger.warn('[ImportManager] 解析导入 ID 映射失败，将使用原始 ID 继续保存:', aliasError);
          return {
            poolAliases: {},
            characterAliases: {},
          };
        }),
      });

      // 1. 保存卡池到服务器
      await savePoolsToServer(poolEntries);

      // 2. 从服务器获取已存在的记录进行去重（基于 game_uid + pool_id + seq_id）
      const firstHistoryRecord = historyRecords[0] || null;
      const existingSeqIds = await getExistingSeqIds({
        gameUid: currentGameUid,
        accountKey: currentAccountKey,
        serverId: firstHistoryRecord?.serverId || firstHistoryRecord?.server_id || null,
        region: firstHistoryRecord?.region || null,
      });
      const { newRecords, duplicateCount } = filterImportedHistoryRecords(historyRecords, existingSeqIds);

      // 3. 保存新记录到服务器
      let serverSkippedHistory = 0;
      let savedHistoryCount = 0;
      if (newRecords.length > 0) {
        const saveResult = await saveHistoryToServer(newRecords);
        serverSkippedHistory = saveResult.skippedHistory;
        savedHistoryCount = saveResult.savedHistory;
      } else {
        // 即使没有新记录，也展示短暂的保存状态，提升体验
        setSaveProgress({ current: historyRecords.length, total: historyRecords.length });
        await new Promise(resolve => setTimeout(resolve, 800));
      }

      // 4. 设置导入结果
      const finalResult = {
        success: true,
        records: newRecords,
        summary: {
          ...result.summary,
          total: historyRecords.length,
          newRecords: savedHistoryCount,
          duplicates: duplicateCount + serverSkippedHistory
        },
        userInfo: result.userInfo
      };

      const refreshedCloudData = await loadCloudData(user);
      applyCloudDataToStores(refreshedCloudData, {
        setPools,
        switchPool,
        setHistory,
        preferredPoolId: currentPoolId,
        preferredGameUid: currentAccountKey || currentGameUid
      });

      if (currentAccountKey || currentGameUid) {
        switchGameAccount(currentAccountKey || currentGameUid);
      }

      persistImportedAccountMetadata({
        accounts: result.userInfo ? [result.userInfo] : [],
        historyRecords,
        importedAt,
        importSource: 'official_api'
      });

      setImportResult(finalResult);
      setImportStatus(ImportStatus.SUCCESS);
      void notifyBotImportUpdated({
        summary: finalResult.summary,
        userInfo: finalResult.userInfo,
      });

    } catch (error) {
      appLogger.error('[ImportManager] 保存数据失败:', error);
      setImportStatus(ImportStatus.ERROR);
      setErrorMessage(error.message || t('import.errorTitle'));
    }
  }, [currentPoolId, getExistingSeqIds, loadCloudData, notifyBotImportUpdated, persistImportedAccountMetadata, pools, saveHistoryToServer, savePoolsToServer, setHistory, setPools, switchGameAccount, switchPool, t, user]);

  const handleReset = useCallback(() => {
    setImportStatus(ImportStatus.IDLE);
    setImportResult(null);
    setErrorMessage('');
    setSaveProgress({ current: 0, total: 0 });
    setFetchStatus('idle');
  }, []);

  const handleClose = useCallback(() => {
    handleReset();
    onClose();
  }, [handleReset, onClose]);

  const handleOpenSettings = useCallback(() => {
    handleClose();
    navigate('/settings');
  }, [handleClose, navigate]);

  const handleViewImportedData = useCallback(() => {
    const anomalyPoolId = Array.isArray(importResult?.summary?.anomalyPoolIds)
      ? importResult.summary.anomalyPoolIds[0]
      : null;
    if (anomalyPoolId) {
      switchPool(anomalyPoolId);
    }
    if (importResult?.userInfo?.gameUid || importResult?.userInfo?.hgUid) {
      switchGameAccount(buildGameAccountKey(importResult.userInfo) || importResult.userInfo.gameUid || importResult.userInfo.hgUid);
    }

    if (typeof onImportComplete === 'function') {
      onImportComplete(importResult);
    }

    handleClose();
  }, [handleClose, importResult, onImportComplete, switchGameAccount, switchPool]);

  const importResultDetails = useMemo(() => {
    if (!importResult) {
      return null;
    }

    return buildImportResultSummary({
      ...importResult,
      source: 'official_api',
      syncedToCloud: true,
    }, { locale });
  }, [importResult, locale]);
  const importAnomalyCount = Number(importResult?.summary?.anomalyRecords || 0);

  if (!isOpen) return null;

  const modal = (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 py-6 backdrop-blur-md transition-colors dark:bg-black/80">
      <div 
        className="relative my-auto w-full max-w-2xl bg-white shadow-[0_0_40px_rgba(0,0,0,0.7)] transition-colors dark:bg-[#111113] border border-zinc-300 dark:border-zinc-800"
        style={{ clipPath: 'polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px))' }}
      >
        {/* Decorator Lines */}
        <div className="absolute top-0 left-0 w-full h-1 bg-yellow-500 z-20" />
        <div className="absolute bottom-0 right-0 w-32 h-1 bg-yellow-500 z-20" />
        <div className="absolute top-0 left-0 h-full w-1 bg-yellow-500 z-20" />

        {/* Header */}
        <div className="sticky top-0 z-10 flex flex-col gap-4 border-b border-zinc-200 bg-slate-50/95 p-6 backdrop-blur transition-colors dark:border-zinc-800 dark:bg-[#151518]/95 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
            <h2 className="text-2xl font-black text-slate-800 dark:text-white uppercase tracking-widest pl-2">
              {t('import.title')}
            </h2>
            <div 
              className="flex min-w-0 items-start gap-2 border border-amber-500/50 bg-amber-500/10 px-4 py-2.5 text-[11px] leading-5 text-amber-900 transition-colors dark:border-yellow-500/30 dark:bg-yellow-500/10 dark:text-yellow-500"
              style={{ clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)' }}
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="min-w-0 tracking-tight">{t('import.retentionNotice')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 self-end sm:self-auto">
            <button
              onClick={() => setShowGuide(!showGuide)}
              className="p-2 border border-transparent hover:border-yellow-500 hover:bg-yellow-500/10 text-slate-400 dark:text-zinc-500 hover:text-yellow-600 dark:hover:text-yellow-500 transition-all duration-200 rounded-full"
              title={t('header.helpTitle')}
            >
              <HelpCircle className="w-5 h-5" />
            </button>
            <button
              onClick={handleClose}
              className="p-2 border border-transparent hover:border-red-500 hover:bg-red-500/10 text-slate-400 dark:text-zinc-500 hover:text-red-600 dark:hover:text-red-500 transition-all duration-200"
              style={{ clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' }}
              disabled={importStatus === ImportStatus.SAVING}
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Steps Indicator (Always Visible) */}
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] transition-colors">
           <div className="flex items-center justify-between text-xs uppercase tracking-widest pl-2">
              {/* 步骤1 */}
              <div className={`flex items-center gap-3 transition-colors ${
                importStatus === ImportStatus.IDLE && fetchStatus === 'idle'
                  ? 'text-yellow-600 dark:text-yellow-500 font-bold'
                  : 'text-slate-400 dark:text-zinc-500'
              }`}>
                 <span className={`w-6 h-6 flex items-center justify-center border transition-colors ${importStatus === ImportStatus.IDLE && fetchStatus === 'idle' ? 'border-yellow-500 bg-yellow-500/10' : 'border-current'}`} style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)' }}>1</span>
                 <span>{t('import.step.token')}</span>
              </div>
              <div className="h-px flex-1 mx-6 border-b border-solid border-zinc-300 dark:border-zinc-800"></div>
              {/* 步骤2 */}
              <div className={`flex items-center gap-3 transition-colors ${
                ['authenticating', 'fetching', 'processing', 'success'].includes(fetchStatus) && importStatus === ImportStatus.IDLE
                  ? 'text-yellow-600 dark:text-yellow-500 font-bold'
                  : 'text-slate-400 dark:text-zinc-500'
              }`}>
                 <span className={`w-6 h-6 flex items-center justify-center border transition-colors ${['authenticating', 'fetching', 'processing', 'success'].includes(fetchStatus) && importStatus === ImportStatus.IDLE ? 'border-yellow-500 bg-yellow-500/10' : 'border-current'}`} style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)' }}>2</span>
                 <span>{t('import.step.fetch')}</span>
              </div>
              <div className="h-px flex-1 mx-6 border-b border-solid border-zinc-300 dark:border-zinc-800"></div>
              {/* 步骤3 */}
              <div className={`flex items-center gap-3 transition-colors ${
                importStatus === ImportStatus.SAVING || importStatus === ImportStatus.SUCCESS
                  ? 'text-yellow-600 dark:text-yellow-500 font-bold'
                  : 'text-slate-400 dark:text-zinc-500'
              }`}>
                 <span className={`w-6 h-6 flex items-center justify-center border transition-colors ${importStatus === ImportStatus.SAVING || importStatus === ImportStatus.SUCCESS ? 'border-yellow-500 bg-yellow-500/10' : 'border-current'}`} style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)' }}>3</span>
                 <span>{t('import.step.save')}</span>
              </div>
           </div>
        </div>

        <div className="p-6 relative">
          {/* 未登录提示 */}
          {!user && (
            <div className="mb-6 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 p-4 transition-colors" style={{ clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)' }}>
              <div className="flex items-center gap-2 text-red-600 dark:text-red-500 mb-2">
                <AlertCircle className="w-5 h-5" />
                <span className="font-bold tracking-widest uppercase">{t('import.needLogin')}</span>
              </div>
              <p className="text-slate-600 dark:text-zinc-400 text-xs">
                {t('import.needLoginDesc')}
              </p>
            </div>
          )}

          {/* 导入说明 */}
          {officialImportBlocked && (
            <div className="mb-6 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 p-4 transition-colors" style={{ clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)' }}>
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 mb-2">
                <AlertCircle className="w-5 h-5" />
                <span className="font-bold tracking-widest uppercase">{t('import.accountCompletionRequiredTitle')}</span>
              </div>
              <p className="text-slate-600 dark:text-zinc-400 text-xs leading-5">
                {t('import.accountCompletionRequiredDesc')}
              </p>
            </div>
          )}

          {/* 导入说明 */}
          {showGuide && (
            <div className="mb-6 bg-slate-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-4 text-sm text-slate-600 dark:text-zinc-400 space-y-2 transition-colors" style={{ clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)' }}>
              <h3 className="text-slate-800 dark:text-zinc-300 font-bold mb-2 flex items-center gap-2 uppercase tracking-widest">
                <HelpCircle size={14}/> {t('import.guideTitle')}
              </h3>
              <p>{t('import.guideStep1')}</p>
              <p>{t('import.guideStep2')}</p>
              <p>{t('import.guideStep3')}</p>
            </div>
          )}

          {/* 保存阶段进度 */}
          {importStatus === ImportStatus.SAVING && (
            <div className="space-y-4 py-8">
              <ImportProgressBar 
                progress={saveProgress.total > 0 ? (saveProgress.current / saveProgress.total) * 100 : 0}
                status={ImportStatus.SAVING}
                message={t('import.progress.saveMessage', { current: saveProgress.current, total: saveProgress.total })}
                t={t}
              />
            </div>
          )}

          {/* 导入成功 */}
          {importStatus === ImportStatus.SUCCESS && importResult && (
            <div className="space-y-6">
              <div className="bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-900/30 p-6 text-center transition-colors">
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 bg-green-100 dark:bg-green-500/20 rounded-full flex items-center justify-center text-green-600 dark:text-green-500">
                    <CheckCircle className="w-8 h-8" />
                  </div>
                </div>
                <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-1">{t('import.complete')}</h3>
                <p className="text-slate-500 dark:text-zinc-500 text-xs uppercase tracking-widest">{t('import.completeDesc')}</p>
              </div>

              {/* 统计网格 */}
              <div className="grid grid-cols-3 gap-1">
                <div className="bg-slate-100 dark:bg-zinc-800 p-4 text-center transition-colors">
                  <p className="text-xs text-slate-500 dark:text-zinc-500 uppercase tracking-widest">{t('import.summary.total')}</p>
                  <p className="text-xl font-bold text-slate-800 dark:text-white mt-1">{formatNumber(importResult.summary?.total || 0)}</p>
                </div>
                <div className="bg-slate-100 dark:bg-zinc-800 p-4 text-center transition-colors">
                  <p className="text-xs text-slate-500 dark:text-zinc-500 uppercase tracking-widest">{t('import.summary.new')}</p>
                  <p className="text-xl font-bold text-green-600 dark:text-green-500 mt-1">{formatNumber(importResult.summary?.newRecords || 0)}</p>
                </div>
                <div className="bg-slate-100 dark:bg-zinc-800 p-4 text-center transition-colors">
                  <p className="text-xs text-slate-500 dark:text-zinc-500 uppercase tracking-widest">{t('import.summary.skipped')}</p>
                  <p className="text-xl font-bold text-slate-500 dark:text-zinc-500 mt-1">{formatNumber(importResult.summary?.duplicates || 0)}</p>
                </div>
              </div>

              {importResultDetails && (
                <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 transition-colors">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h4 className="text-sm font-black uppercase tracking-widest text-slate-800 dark:text-zinc-100">
                      {t('import.details.title')}
                    </h4>
                    <span className="border border-zinc-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:border-zinc-700 dark:text-zinc-400">
                      {importResultDetails.sourceLabel}
                    </span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="flex min-w-0 items-start gap-3 bg-slate-50 p-3 dark:bg-zinc-900/70">
                      <User className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-zinc-500" />
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">{t('import.details.account')}</div>
                        <div className="truncate text-sm font-bold text-slate-900 dark:text-zinc-100">{importResultDetails.accountLabel}</div>
                      </div>
                    </div>
                    <div className="flex min-w-0 items-start gap-3 bg-slate-50 p-3 dark:bg-zinc-900/70">
                      {(() => {
                        const syncDetail = getSyncStatusDetail(importResultDetails.syncStatus, t);
                        const SyncIcon = syncDetail.icon;
                        return (
                          <>
                            <SyncIcon className={`mt-0.5 h-4 w-4 shrink-0 ${syncDetail.className}`} />
                            <div className="min-w-0">
                              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">{t('import.details.sync')}</div>
                              <div className={`text-sm font-bold ${syncDetail.className}`}>{syncDetail.label}</div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                    <div className="flex min-w-0 items-start gap-3 bg-slate-50 p-3 dark:bg-zinc-900/70">
                      <Layers className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">{t('import.details.poolChange')}</div>
                        <div className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                          {t('import.details.poolChangeValue', {
                            added: formatNumber(importResultDetails.addedPools),
                            total: formatNumber(importResultDetails.poolCount)
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="flex min-w-0 items-start gap-3 bg-slate-50 p-3 dark:bg-zinc-900/70">
                      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-zinc-500" />
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">{t('import.details.latestRecord')}</div>
                        <div className="truncate text-sm font-bold text-slate-900 dark:text-zinc-100">
                          {importResultDetails.latestRecordAt
                            ? formatDateTime(importResultDetails.latestRecordAt, { includeYear: true })
                            : t('common.unknown')}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">
                    <span>{t('import.details.mode')}: {getImportModeLabel(importResultDetails.importMode, t)}</span>
                    <span>{t('import.details.partialPools')}: {formatNumber(importResultDetails.partialPoolCount)}</span>
                    <span>{t('import.details.failedPools')}: {formatNumber(importResultDetails.failedPoolCount)}</span>
                  </div>
                </div>
              )}

              {((importResult.summary?.partialPools?.length || 0) > 0 || (importResult.summary?.failedPools?.length || 0) > 0) && (
                <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 p-4 space-y-2 transition-colors" style={{ clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)' }}>
                  <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
                      <div>
                      <p className="text-amber-700 dark:text-amber-400 text-sm font-bold uppercase tracking-widest">{t('import.partialTitle')}</p>
                      <p className="text-slate-600 dark:text-zinc-500 text-xs mt-1">
                        {t('import.partialDesc')}
                      </p>
                    </div>
                  </div>

                  {(importResult.summary?.partialPools || []).map(pool => (
                    <div key={`partial-${pool.poolType || pool.type}`} className="text-xs text-slate-600 dark:text-zinc-400">
                      {t('import.partialSuccess')}: {getPoolName(pool.poolType || pool.type, t)} · {pool.records || 0} · {pool.error || t('import.partialFallback')}
                    </div>
                  ))}

                  {(importResult.summary?.failedPools || []).map(pool => (
                    <div key={`failed-${pool.poolType || pool.type}`} className="text-xs text-red-600 dark:text-red-400">
                      {t('import.partialFailed')}: {getPoolName(pool.poolType || pool.type, t)} · {pool.error || t('import.failedFallback')}
                    </div>
                  ))}
                </div>
              )}

              {importAnomalyCount > 0 && (
                <div className="border border-amber-400 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/35">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                    <div>
                      <p className="text-sm font-bold text-amber-800 dark:text-amber-200">
                        {t('import.anomaly.title', { count: formatNumber(importAnomalyCount) })}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-amber-700 dark:text-amber-300/80">
                        {t('import.anomaly.desc')}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* 结果提示 */}
              {importResult.summary?.newRecords > 0 && (
                <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 p-4 flex items-start gap-3 transition-colors" style={{ clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)' }}>
                  <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-amber-700 dark:text-amber-400 text-sm font-bold uppercase tracking-widest">{t('import.newDataSynced')}</p>
                    <p className="text-slate-600 dark:text-zinc-500 text-xs mt-1">{t('import.newDataSyncedDesc')}</p>
                  </div>
                </div>
              )}

              {/* 按钮组 */}
              <div className="flex gap-4">
                {importAnomalyCount > 0 ? (
                  <button
                    onClick={handleClose}
                    className="flex-1 border border-zinc-300 bg-white py-3 text-sm font-bold tracking-wider text-slate-700 transition-colors hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:hover:bg-zinc-700"
                  >
                    {t('import.anomaly.later')}
                  </button>
                ) : (
                  <button
                    onClick={handleReset}
                    className="flex-1 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-transparent hover:bg-slate-50 dark:hover:bg-zinc-700 text-slate-700 dark:text-white font-bold py-3 text-sm tracking-wider transition-colors"
                  >
                    {t('import.continue')}
                  </button>
                )}
                {importResult.summary?.newRecords > 0 ? (
                  <button
                    onClick={handleViewImportedData}
                    className="flex-1 bg-amber-500 hover:bg-amber-600 dark:bg-yellow-500 dark:hover:bg-yellow-400 text-white dark:text-black font-bold py-3 text-sm tracking-wider transition-colors flex items-center justify-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    {importAnomalyCount > 0 ? t('import.anomaly.now') : t('import.viewData')}
                  </button>
                ) : (
                  <button
                    onClick={handleClose}
                    className="flex-1 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-transparent hover:bg-slate-50 dark:hover:bg-zinc-600 text-slate-700 dark:text-white font-bold py-3 text-sm tracking-wider transition-colors"
                  >
                    {t('common.close')}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 导入错误 */}
          {importStatus === ImportStatus.ERROR && (
            <div className="space-y-4 py-6">
              <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 p-4 flex items-start gap-3 transition-colors" style={{ clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)' }}>
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-500 mt-0.5 shrink-0" />
                <div>
                  <h4 className="text-red-600 dark:text-red-500 font-bold mb-1 uppercase tracking-widest text-sm">{t('import.errorTitle')}</h4>
                  <p className="text-slate-600 dark:text-zinc-400 text-xs break-all leading-relaxed">{errorMessage}</p>
                </div>
              </div>
              <button
                onClick={handleReset}
                className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-800 hover:border-red-500 dark:hover:border-red-500 text-slate-700 dark:text-zinc-300 font-bold py-3 text-xs tracking-widest uppercase transition-all duration-200 relative group overflow-hidden"
                style={{ clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)' }}
              >
                <div className="absolute inset-y-0 left-0 w-1 bg-red-500 scale-y-0 group-hover:scale-y-100 transition-transform duration-300 origin-bottom" />
                <span className="relative z-10 group-hover:text-red-600 dark:group-hover:text-red-500 transition-colors">{t('common.retry')}</span>
              </button>
            </div>
          )}

          {/* 官网 API 导入子组件 */}
          {importStatus === ImportStatus.IDLE && user && (
            <OfficialAPIImport
              onImportComplete={handleAPIImportComplete}
              onBack={handleClose}
              onOpenFileImport={onOpenFileImport}
              onFetchStatusChange={handleFetchStatusChange}
              userId={user.id}
              accountCompletionRequired={officialImportBlocked}
              onOpenSettings={handleOpenSettings}
            />
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(modal, document.body);
  }

  return modal;
}
