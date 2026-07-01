import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AuthChainError,
  RiskControlError,
  ServerConnectionError,
  executeAuthChainForAccount,
  fetchAccountsList,
  fetchAllGachaRecords,
  fetchAllGachaRecordsConcurrent,
  fetchImportQueueStatus,
  importAllRecordsFullyOnBackend
} from '../../utils/endfieldAuthChain';
import { assignBatchIds, calculatePity, generateImportSummary } from '../../utils/endfieldImportAdapter';
import {
  buildGameAccountServerTag,
  normalizeGameAccountRegion,
  normalizeGameAccountServerId,
} from '../../utils/gameAccountMetadata';
import { getGlobalQueue } from '../../utils/requestQueue';
import { ImportStatus } from './importShared';
import {
  OFFICIAL_IMPORT_MODES,
  normalizeOfficialImportMode,
  parseOfficialImportTokenInput,
  validateOfficialImportToken,
} from './officialImportInput.js';
import { useI18n } from '../../i18n/index.js';
import appLogger from '../../utils/appLogger.js';

function getAuthDiagnosticMessage(reason) {
  switch (reason) {
    case 'compat_jwt_secret_missing':
      return '导入后端未配置站内会话校验密钥';
    case 'compat_jwt_signature_mismatch':
      return '导入后端与主站会话密钥不一致';
    case 'compat_jwt_expired':
      return '导入登录令牌已过期，或后端服务器时间不同步';
    case 'compat_jwt_user_not_found':
      return '导入后端连接的账号数据库与主站不一致，或账号记录缺失';
    case 'compat_jwt_not_site_session':
      return '导入后端收到的不是本站会话令牌';
    case 'access_token_malformed':
      return '导入后端收到的登录令牌格式不完整';
    default:
      return '';
  }
}

function appendAuthDiagnostic(errorMessage, err) {
  const reason = err?.data?.auth?.reason || err?.data?.data?.auth?.reason || '';
  if (!reason) {
    return errorMessage;
  }

  const readable = getAuthDiagnosticMessage(reason) || reason;
  return `${errorMessage}（诊断：${readable} / ${reason}）`;
}

function normalizeImportError(err, t) {
  let errorMessage = err.message || t('import.error.unknown');

  if (err instanceof ServerConnectionError) {
    errorMessage = t('import.error.serverConnection', { message: err.message });
  } else if (err instanceof RiskControlError) {
    errorMessage = t('import.error.riskControl');
  } else if (err instanceof AuthChainError) {
    errorMessage = t('import.error.authFailed', { message: err.message });
  }

  return appendAuthDiagnostic(errorMessage, err);
}

function looksLikeTokenInvalidError(message) {
  const normalized = String(message || '').toLowerCase();
  return (
    normalized.includes('token is invalid') ||
    normalized.includes('token无效') ||
    normalized.includes('请检查token是否有效') ||
    normalized.includes('未能获取 u8_token') ||
    normalized.includes('未能获取 app_token') ||
    normalized.includes('当前请求走的是') ||
    normalized.includes('请切换到')
  );
}

function getAlternateSource(source) {
  return source === 'intl' ? 'cn' : 'intl';
}

function getSourceDisplayName(source, t) {
  return source === 'intl' ? t('import.source.intl.label') : t('import.source.cn.label');
}

function getLocalizedUnknown(t) {
  return typeof t === 'function' ? t('common.unknown') : '未知';
}

function getServerRegionLabel(serverId, t) {
  return String(serverId || '1') === '1'
    ? getSourceDisplayName('cn', t)
    : getSourceDisplayName('intl', t);
}

function buildPreviewRecords(records, serverId, t) {
  const resolvedServerId = String(serverId || '1');
  const unknownLabel = getLocalizedUnknown(t);
  const convertedRecords = records.map((record) => {
    const poolType = record._poolType || 'unknown';
    return {
      name: record.charName || record.weaponName || unknownLabel,
      character_name: record.charName || record.weaponName || unknownLabel,
      item_id: record.charId || record.weaponId || '',
      rarity: record.rarity,
      timestamp: parseInt(record.gachaTs, 10),
      pool: poolType,
      pool_id: record.poolId,
      pool_name: record.poolName,
      isNew: record.isNew || false,
      isFree: record.isFree || false,
      isLimited: poolType === 'extra' || poolType === 'limited_character' || poolType === 'limited_weapon',
      seqId: record.seqId,
      recordType: record.charId ? 'character' : 'weapon',
      serverId: resolvedServerId,
      serverRegion: getServerRegionLabel(resolvedServerId, t),
    };
  });

  const recordsByPool = {};
  convertedRecords.forEach((record) => {
    if (!recordsByPool[record.pool]) recordsByPool[record.pool] = [];
    recordsByPool[record.pool].push(record);
  });

  let processedRecords = [];
  Object.entries(recordsByPool).forEach(([poolType, recs]) => {
    const withPity = calculatePity(recs, poolType);
    processedRecords.push(...withPity);
  });

  processedRecords = assignBatchIds(processedRecords);
  processedRecords.sort((a, b) => b.timestamp - a.timestamp);
  return processedRecords;
}

export function useOfficialImportController({ onImportComplete, onFetchStatusChange, onSourceSwitch, userId, source = 'cn' }) {
  const { t } = useI18n();
  const [tokenInput, setTokenInput] = useState('');
  const [status, setStatus] = useState(ImportStatus.IDLE);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [fetchedRecords, setFetchedRecords] = useState([]);
  const [importSummary, setImportSummary] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [error, setError] = useState(null);
  const [autoDetected, setAutoDetected] = useState(false);
  const [availableAccounts, setAvailableAccounts] = useState([]);
  const [appToken, setAppToken] = useState(null);
  const [queueStatus, setQueueStatus] = useState(null);
  const [retryInfo, setRetryInfo] = useState(null);
  const [sourceSwitchInfo, setSourceSwitchInfo] = useState(null);
  const [inputDetection, setInputDetection] = useState(null);
  const [clipboardState, setClipboardState] = useState({ status: 'idle' });
  const [importMode, setImportModeState] = useState(OFFICIAL_IMPORT_MODES.INCREMENTAL);
  const cancelRef = useRef(false);
  const switchTimerRef = useRef(null);

  useEffect(() => {
    onFetchStatusChange?.(status);
  }, [onFetchStatusChange, status]);

  useEffect(() => {
    return () => {
      if (switchTimerRef.current) {
        clearTimeout(switchTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (status !== ImportStatus.AUTHENTICATING && status !== ImportStatus.FETCHING) {
      queueMicrotask(() => {
        setQueueStatus(null);
        setRetryInfo(null);
      });
      return undefined;
    }

    const updateQueueStatus = async () => {
      try {
        const backendStatus = await fetchImportQueueStatus(source);
        setQueueStatus({
          queueLength: backendStatus.queueLength,
          activeRequests: backendStatus.isProcessing ? 1 : 0,
          isProcessing: backendStatus.isProcessing,
          oldestTaskAge: backendStatus.oldestTaskAge || 0,
          currentTaskMeta: backendStatus.currentTaskMeta
        });
      } catch (queueError) {
        appLogger.warn('[OfficialAPIImport] 获取队列状态失败:', queueError);
      }
    };

    updateQueueStatus();
    const interval = setInterval(updateQueueStatus, 2000);

    const queue = getGlobalQueue();
    const handleQueueEvent = (event, data) => {
      if (event === 'request:retry') {
        setRetryInfo({
          currentRetry: data.currentRetry,
          maxRetries: data.maxRetries,
          nextRetryIn: data.nextRetryIn,
          reason: data.reason
        });
        setStatusMessage(t('import.official.networkRetry', {
          current: data.currentRetry,
          total: data.maxRetries,
        }));
        return;
      }

      if (event === 'request:success' || event === 'request:error') {
        setRetryInfo(null);
      }
    };

    queue.addListener(handleQueueEvent);
    return () => {
      clearInterval(interval);
      queue.removeListener(handleQueueEvent);
    };
  }, [source, status, t]);

  const applyTokenInput = useCallback((rawInput) => {
    const parsed = parseOfficialImportTokenInput(rawInput);
    const shouldSwitchSource = Boolean(
      parsed.detectedSource &&
      parsed.sourceConfidence === 'high' &&
      parsed.detectedSource !== source
    );

    setTokenInput(parsed.autoDetected ? parsed.token : String(rawInput || ''));
    setAutoDetected(Boolean(parsed.autoDetected));
    setInputDetection({
      ...parsed,
      sourceAutoSwitched: shouldSwitchSource,
      previousSource: shouldSwitchSource ? source : null,
    });

    if (shouldSwitchSource) {
      onSourceSwitch?.(parsed.detectedSource);
    }

    return parsed;
  }, [onSourceSwitch, source]);

  const handleInputChange = useCallback((eventOrValue) => {
    const rawInput = typeof eventOrValue === 'string'
      ? eventOrValue
      : eventOrValue?.target?.value || '';
    setClipboardState({ status: 'idle' });
    applyTokenInput(rawInput);
  }, [applyTokenInput]);

  const handleClipboardRead = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
      setClipboardState({ status: 'unsupported' });
      return;
    }

    setClipboardState({ status: 'reading' });
    try {
      const text = await navigator.clipboard.readText();
      if (!String(text || '').trim()) {
        setClipboardState({ status: 'empty' });
        return;
      }
      const parsed = applyTokenInput(text);
      const validation = validateOfficialImportToken(parsed.token);
      setClipboardState({
        status: validation.valid ? 'success' : 'no_token',
        inputKind: parsed.inputKind,
        detectedSource: parsed.detectedSource,
      });
    } catch (clipboardError) {
      appLogger.warn('[OfficialAPIImport] 剪贴板读取失败:', clipboardError);
      setClipboardState({ status: 'denied' });
    }
  }, [applyTokenInput]);

  const setImportMode = useCallback((nextMode) => {
    setImportModeState(normalizeOfficialImportMode(nextMode));
  }, []);

  const handleReset = useCallback(() => {
    setTokenInput('');
    setStatus(ImportStatus.IDLE);
    setProgress(0);
    setStatusMessage('');
    setFetchedRecords([]);
    setImportSummary(null);
    setUserInfo(null);
    setError(null);
    setAutoDetected(false);
    setAvailableAccounts([]);
    setAppToken(null);
    setSourceSwitchInfo(null);
    setInputDetection(null);
    setClipboardState({ status: 'idle' });
    setImportModeState(OFFICIAL_IMPORT_MODES.INCREMENTAL);
    if (switchTimerRef.current) {
      clearTimeout(switchTimerRef.current);
      switchTimerRef.current = null;
    }
  }, []);

  const handleCancel = useCallback(() => {
    cancelRef.current = true;
    setStatus(ImportStatus.IDLE);
    setProgress(0);
    setStatusMessage('');
  }, []);

  const handleConfirmImport = useCallback(() => {
    if (fetchedRecords.length === 0 || !onImportComplete) return;

    onImportComplete({
      success: true,
      records: fetchedRecords,
      summary: importSummary,
      userInfo
    });
  }, [fetchedRecords, importSummary, onImportComplete, userInfo]);

  const continueImportWithAccount = useCallback(async (token, account, targetSource = source) => {
    try {
      setStatus(ImportStatus.FETCHING);
      setProgress(30);
      cancelRef.current = false;

      const accountServerId = normalizeGameAccountServerId({ ...account, source: targetSource }) || null;
      const accountRegion = normalizeGameAccountRegion({
        ...account,
        serverId: accountServerId,
        source: targetSource,
      }) || null;
      const requestServerId = accountServerId || (targetSource === 'intl' ? '2' : '1');

      const resolvedUserInfo = {
        hgUid: account.uid,
        gameUid: account.gameUid,
        nickName: account.nickName,
        channelName: account.channelName,
        channelMasterId: account.channelMasterId,
        serverId: accountServerId,
        serverName: account.serverName || account.server_name || null,
        region: accountRegion,
        isOfficial: account.isOfficial,
        source: targetSource,
        serverTag: account.serverTag || buildGameAccountServerTag({ ...account, serverId: accountServerId, region: accountRegion })
      };

      setUserInfo(resolvedUserInfo);

      if (userId) {
        const accountIndex = availableAccounts.findIndex((candidate) =>
          candidate.uid === account.uid &&
          candidate.gameUid === account.gameUid &&
          candidate.channelMasterId === account.channelMasterId &&
          String(candidate.serverId || '') === String(account.serverId || '')
        );

        const backendResult = await importAllRecordsFullyOnBackend(
          tokenInput.trim(),
          accountIndex >= 0 ? accountIndex : 0,
          userId,
          (update) => {
            if (cancelRef.current) return;
            setStatus(update.progress >= 80 ? ImportStatus.PROCESSING : ImportStatus.FETCHING);
            setProgress(update.progress || 0);
            setStatusMessage(update.message || t('import.official.importingData'));
          },
          targetSource,
          { importMode }
        );

        if (cancelRef.current) return;

        const backendAccount = backendResult?.account || {};
        const hasBackendServerId = Object.prototype.hasOwnProperty.call(backendAccount, 'serverId');
        const finalServerId = hasBackendServerId ? backendAccount.serverId : resolvedUserInfo.serverId;
        const finalRegion = backendAccount.region || resolvedUserInfo.region || null;
        const finalUserInfo = {
          ...resolvedUserInfo,
          gameUid: backendAccount.gameUid || resolvedUserInfo.gameUid,
          nickName: backendAccount.nickName || resolvedUserInfo.nickName,
          serverId: finalServerId,
          region: finalRegion,
          serverTag: buildGameAccountServerTag({
            ...resolvedUserInfo,
            gameUid: backendAccount.gameUid || resolvedUserInfo.gameUid,
            nickName: backendAccount.nickName || resolvedUserInfo.nickName,
            serverId: finalServerId,
            region: finalRegion,
          }) || resolvedUserInfo.serverTag
        };

        if (onImportComplete) {
          onImportComplete({
            success: true,
            backendImported: true,
            summary: {
              total: backendResult?.totalRecords || 0,
              newRecords: backendResult?.newRecords || 0,
              duplicates: backendResult?.duplicates || 0,
              byPool: backendResult?.byPool || {},
              byPoolType: backendResult?.byPoolType || {},
              partialPools: backendResult?.partialPools || [],
              failedPools: backendResult?.failedPools || [],
              importMode: backendResult?.importMode || importMode,
              savedRecords: backendResult?.savedRecords ?? backendResult?.newRecords ?? 0
            },
            userInfo: finalUserInfo,
            result: backendResult
          });
          return;
        }

        setImportSummary({
          total: backendResult?.totalRecords || 0,
          byRarity: { 4: 0, 5: 0, 6: 0 },
          byPool: backendResult?.byPool || {},
          byPoolType: backendResult?.byPoolType || {},
          sixStars: [],
          fiveStars: [],
          partialPools: backendResult?.partialPools || [],
          failedPools: backendResult?.failedPools || []
        });
        setProgress(100);
        setStatus(ImportStatus.SUCCESS);
        setStatusMessage(t('import.official.backendDone'));
        return;
      }

      setStatusMessage(t('import.official.fetchingToken', { channel: account.channelName }));
      const authResult = await executeAuthChainForAccount(token, account, (message) => {
        if (!cancelRef.current) {
          setStatusMessage(message);
        }
      }, targetSource);

      if (cancelRef.current) return;

      const { u8Token } = authResult;
      setStatusMessage(t('import.official.fetchingRecords', { channel: account.channelName }));
      setProgress(40);

      let records;
      try {
        records = await fetchAllGachaRecordsConcurrent(
          u8Token,
          requestServerId,
          (message) => {
            if (cancelRef.current) return;
            setStatusMessage(message);
            if (message.includes('限定角色')) setProgress(50);
            else if (message.includes('附加')) setProgress(55);
            else if (message.includes('常驻角色')) setProgress(60);
            else if (message.includes('新手')) setProgress(70);
            else if (message.includes('武器')) setProgress(80);
            else if (message.includes('失败')) setProgress(85);
            else if (message.includes('完成')) setProgress(90);
            else if (message.includes('排队')) setProgress(35);
          },
          {
            gameUid: account.gameUid,
            nickName: account.nickName
          },
          targetSource
        );
      } catch {
        setStatusMessage(t('import.official.concurrentFallback'));
        records = await fetchAllGachaRecords(u8Token, (message) => {
          if (!cancelRef.current) {
            setStatusMessage(message);
          }
        }, targetSource, requestServerId);
      }

      if (cancelRef.current) return;

      setStatus(ImportStatus.PROCESSING);
      setProgress(95);
      setStatusMessage(t('import.official.processingData'));

      const processedRecords = buildPreviewRecords(records, accountServerId || requestServerId, t);
      const summary = generateImportSummary(processedRecords);

      setFetchedRecords(processedRecords);
      setImportSummary(summary);
      setProgress(100);
      setStatus(ImportStatus.SUCCESS);
      setStatusMessage(t('import.official.ready'));
    } catch (err) {
      appLogger.error('[OfficialAPIImport] 导入失败:', err);
      if (cancelRef.current) return;
      setError(normalizeImportError(err, t));
      setStatus(ImportStatus.ERROR);
    }
  }, [availableAccounts, importMode, onImportComplete, source, t, tokenInput, userId]);

  const tryFetchAccountsWithSource = useCallback(async (token, targetSource) => {
    return fetchAccountsList(token, (message) => {
      if (cancelRef.current) return;
      setStatusMessage(message);
      if (message.includes('验证')) setProgress(10);
      else if (message.includes('账号')) setProgress(20);
    }, targetSource);
  }, []);

  const handleImport = useCallback(async () => {
    const parsedInput = parseOfficialImportTokenInput(tokenInput);
    const validation = validateOfficialImportToken(parsedInput.token || tokenInput);
    if (!validation.valid) {
      setError(validation.error ? t(validation.error.key, validation.error.params) : t('import.error.emptyToken'));
      setStatus(ImportStatus.ERROR);
      return;
    }

    setStatus(ImportStatus.AUTHENTICATING);
    setProgress(0);
    setError(null);
    setFetchedRecords([]);
    setImportSummary(null);
    setUserInfo(null);
    setAvailableAccounts([]);
    setAppToken(null);
    setSourceSwitchInfo(null);
    cancelRef.current = false;

    const detectedSource = inputDetection?.sourceConfidence === 'high' ? inputDetection.detectedSource : null;
    let effectiveSource = detectedSource || source;
    let accountsResult;

    try {
      setStatusMessage(t('import.official.validatingToken'));
      setProgress(10);

      if (effectiveSource !== source) {
        onSourceSwitch?.(effectiveSource);
      }
      accountsResult = await tryFetchAccountsWithSource(validation.token, effectiveSource);
    } catch (firstErr) {
      if (cancelRef.current) return;

      const shouldTryAlternate = looksLikeTokenInvalidError(firstErr.message);
      if (!shouldTryAlternate) {
        appLogger.error('[OfficialAPIImport] 导入失败:', firstErr);
        setError(normalizeImportError(firstErr, t));
        setStatus(ImportStatus.ERROR);
        return;
      }

      const altSource = getAlternateSource(effectiveSource);
      const altName = getSourceDisplayName(altSource, t);
      const curName = getSourceDisplayName(effectiveSource, t);

      setSourceSwitchInfo({ from: effectiveSource, to: altSource, countdown: 3 });
      setStatusMessage(t('import.official.switchSuggestion', {
        current: curName,
        target: altName,
        seconds: 3,
      }));
      setProgress(5);

      try {
        await new Promise((resolve, reject) => {
          let remaining = 3;
          const tick = () => {
            remaining--;
            if (cancelRef.current) {
              reject(new Error('cancelled'));
              return;
            }
            setSourceSwitchInfo(prev => prev ? { ...prev, countdown: remaining } : null);
            setStatusMessage(t('import.official.switchSuggestion', {
              current: curName,
              target: altName,
              seconds: remaining,
            }));
            if (remaining <= 0) {
              resolve();
            } else {
              switchTimerRef.current = setTimeout(tick, 1000);
            }
          };
          switchTimerRef.current = setTimeout(tick, 1000);
        });
      } catch {
        return;
      }

      if (cancelRef.current) return;

      setStatusMessage(t('import.official.switchConfirmed', { target: altName }));
      setProgress(10);
      effectiveSource = altSource;

      try {
        accountsResult = await tryFetchAccountsWithSource(validation.token, altSource);
        onSourceSwitch?.(altSource);
        setSourceSwitchInfo(null);
      } catch (secondErr) {
        appLogger.error('[OfficialAPIImport] 双服验证均失败:', secondErr);
        if (cancelRef.current) return;
        setSourceSwitchInfo(null);
        setError(t('import.error.doubleSourceFailed', {
          current: curName,
          target: altName,
          currentError: normalizeImportError(firstErr, t),
          targetError: normalizeImportError(secondErr, t),
        }));
        setStatus(ImportStatus.ERROR);
        return;
      }
    }

    if (cancelRef.current || !accountsResult) return;

    try {
      const { appToken: nextAppToken, accounts } = accountsResult;
      const normalizedAccounts = accounts.map((account) => ({
        ...account,
        source: effectiveSource,
        serverTag: buildGameAccountServerTag(account)
      }));
      setAppToken(nextAppToken);
      setAvailableAccounts(normalizedAccounts);

      if (normalizedAccounts.length > 1) {
        setStatus(ImportStatus.ACCOUNT_SELECTION);
        setProgress(25);
        setStatusMessage(t('import.official.selectedAccount'));
        return;
      }

      await continueImportWithAccount(nextAppToken, normalizedAccounts[0], effectiveSource);
    } catch (err) {
      appLogger.error('[OfficialAPIImport] 导入失败:', err);
      if (cancelRef.current) return;
      setError(normalizeImportError(err, t));
      setStatus(ImportStatus.ERROR);
    }
  }, [continueImportWithAccount, inputDetection, onSourceSwitch, source, t, tokenInput, tryFetchAccountsWithSource]);

  const handleAccountSelect = useCallback(async (account) => {
    await continueImportWithAccount(appToken, account, account?.source || source);
  }, [appToken, continueImportWithAccount, source]);

  return {
    tokenInput,
    status,
    progress,
    statusMessage,
    importSummary,
    userInfo,
    error,
    autoDetected,
    availableAccounts,
    queueStatus,
    retryInfo,
    sourceSwitchInfo,
    inputDetection,
    clipboardState,
    importMode,
    setImportMode,
    handleInputChange,
    handleClipboardRead,
    handleImport,
    handleAccountSelect,
    handleCancel,
    handleConfirmImport,
    handleReset,
  };
}
