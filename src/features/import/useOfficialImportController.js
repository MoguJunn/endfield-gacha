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
  importAllRecordsFullyOnBackend,
  confirmFullImportReviewOnBackend,
  rejectFullImportReviewOnBackend
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
import {
  filterOfficialImportPullRecords,
  normalizeOfficialImportRecord,
  summarizeOfficialImportIssues,
} from '../../../shared/officialImportRecordNormalizer.js';
import {
  clearOfficialImportReviewSession,
  loadOfficialImportReviewSession,
  saveOfficialImportReviewSession,
} from './officialImportReviewSession.js';

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

function getServerRegionLabel(serverId, t) {
  return String(serverId || '1') === '1'
    ? getSourceDisplayName('cn', t)
    : getSourceDisplayName('intl', t);
}

function buildPreviewRecords(records, userInfo, t) {
  const resolvedServerId = String(userInfo?.serverId || '1');
  const convertedRecords = filterOfficialImportPullRecords(records).map((record) => {
    const poolType = record._poolType || 'unknown';
    const normalized = normalizeOfficialImportRecord(record, {
      gameUid: userInfo?.gameUid || userInfo?.hgUid,
      serverId: resolvedServerId,
      region: userInfo?.region,
      poolType,
    });
    return {
      name: normalized.itemName,
      character_name: normalized.itemName,
      item_name: normalized.itemName,
      item_id: normalized.itemId,
      rarity: normalized.quality,
      timestamp: normalized.timestamp ? new Date(normalized.timestamp).getTime() : null,
      pool: poolType,
      pool_id: normalized.poolId,
      pool_name: normalized.poolName,
      isNew: normalized.isNew,
      isFree: normalized.isFree,
      isInfoBook: normalized.isInfoBook,
      isLimited: poolType === 'extra' || poolType === 'limited_character' || poolType === 'limited_weapon',
      seqId: normalized.seqId,
      recordType: normalized.itemType,
      serverId: resolvedServerId,
      serverRegion: getServerRegionLabel(resolvedServerId, t),
      importIssues: normalized.issues,
      importBlocked: normalized.blocked,
      sourceRawMin: normalized.rawMin,
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
  return {
    records: processedRecords,
    reviewSummary: summarizeOfficialImportIssues(convertedRecords.map((record) => ({
      issues: record.importIssues,
    }))),
  };
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
  const [backendReview, setBackendReview] = useState(null);
  const [reviewDecisions, setReviewDecisions] = useState({});
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
    if (!userId) return;
    const savedReview = loadOfficialImportReviewSession({ userId, source });
    if (savedReview) {
      clearOfficialImportReviewSession({ userId, source: savedReview.source || source });
    }
  }, [source, userId]);

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
    clearOfficialImportReviewSession({ userId, source });
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
    setBackendReview(null);
    setReviewDecisions({});
    if (switchTimerRef.current) {
      clearTimeout(switchTimerRef.current);
      switchTimerRef.current = null;
    }
  }, [source, userId]);

  const handleCancel = useCallback(async () => {
    cancelRef.current = true;
    if (backendReview?.task?.id && backendReview?.task?.accessKey) {
      try {
        await rejectFullImportReviewOnBackend({
          taskId: backendReview.task.id,
          accessKey: backendReview.task.accessKey,
        }, backendReview.source || source);
      } catch (rejectError) {
        appLogger.warn('[OfficialAPIImport] 取消暂存导入失败，将由任务自动过期:', rejectError.message);
      }
    }
    setStatus(ImportStatus.IDLE);
    setProgress(0);
    setStatusMessage('');
    setBackendReview(null);
    setReviewDecisions({});
    clearOfficialImportReviewSession({ userId, source: backendReview?.source || source });
  }, [backendReview, source, userId]);

  const handleReviewDecision = useCallback((ordinal, action) => {
    if (!['keep', 'skip'].includes(action)) return;
    setReviewDecisions((current) => ({
      ...current,
      [String(ordinal)]: action,
    }));
  }, []);

  const handleConfirmImport = useCallback(async () => {
    if (backendReview?.task?.id && backendReview?.task?.accessKey) {
      try {
        setStatus(ImportStatus.CONFIRMING);
        setStatusMessage('正在按你的选择写入记录...');
        const decisions = backendReview.records.map((record) => ({
          ordinal: record.ordinal,
          action: reviewDecisions[String(record.ordinal)] || record.selectedAction || 'keep',
        }));
        const confirmed = await confirmFullImportReviewOnBackend({
          taskId: backendReview.task.id,
          accessKey: backendReview.task.accessKey,
          decisions,
        }, backendReview.source || source);
        const savedRecords = Number(confirmed?.result?.savedRecords || 0);
        const nextSummary = {
          ...(importSummary || {}),
          savedRecords,
          skippedRecords: Number(confirmed?.result?.skippedRecords || 0),
        };
        setImportSummary(nextSummary);
        setProgress(100);
        setStatus(ImportStatus.SUCCESS);
        setStatusMessage(t('import.official.backendDone'));
        clearOfficialImportReviewSession({ userId, source: backendReview.source || source });
        setBackendReview(null);
        setReviewDecisions({});
        onImportComplete?.({
          success: true,
          backendImported: true,
          summary: nextSummary,
          userInfo,
          result: confirmed?.result || {},
        });
      } catch (confirmError) {
        setError(normalizeImportError(confirmError, t));
        setStatus(ImportStatus.REVIEW_REQUIRED);
        setStatusMessage('写入失败，请检查选择后重试');
      }
      return;
    }

    if (fetchedRecords.length === 0 || !onImportComplete) return;

    const recordsToImport = fetchedRecords.filter((record, ordinal) => (
      (reviewDecisions[String(ordinal)] || (record.importBlocked ? 'skip' : 'keep')) === 'keep'
    ));

    onImportComplete({
      success: true,
      records: recordsToImport,
      summary: importSummary,
      userInfo
    });
  }, [backendReview, fetchedRecords, importSummary, onImportComplete, reviewDecisions, source, t, userId, userInfo]);

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

        setUserInfo(finalUserInfo);

        if (backendResult?.reviewRequired && backendResult?.reviewTask?.id) {
          const records = Array.isArray(backendResult.reviewRecords)
            ? backendResult.reviewRecords
            : [];
          setBackendReview({
            task: backendResult.reviewTask,
            records,
            source: targetSource,
          });
          saveOfficialImportReviewSession({
            userId,
            source: targetSource,
            taskId: backendResult.reviewTask.id,
            accessKey: backendResult.reviewTask.accessKey,
          });
          setReviewDecisions(Object.fromEntries(
            records.map((record) => [
              String(record.ordinal),
              record.selectedAction || ((record.issues || []).some((issue) => issue?.severity === 'blocking') ? 'skip' : 'keep'),
            ])
          ));
          setImportSummary({
            total: backendResult?.totalRecords || 0,
            newRecords: backendResult?.newRecords || 0,
            duplicates: backendResult?.duplicates || 0,
            byRarity: { 4: 0, 5: 0, 6: 0 },
            byPool: backendResult?.byPool || {},
            byPoolType: backendResult?.byPoolType || {},
            sixStars: [],
            fiveStars: [],
            partialPools: backendResult?.partialPools || [],
            failedPools: backendResult?.failedPools || [],
            review: backendResult?.review || backendResult?.reviewTask?.summary?.review || {},
            savedRecords: 0,
          });
          setProgress(100);
          setStatus(ImportStatus.REVIEW_REQUIRED);
          setStatusMessage(
            Number(backendResult?.review?.issueRecords || 0) > 0
              ? `已暂存 ${records.length} 条记录，其中 ${backendResult.review.issueRecords} 条需要重点确认`
              : `已暂存 ${records.length} 条记录，请确认后写入`
          );
          return;
        }

        if (onImportComplete) {
          const savedRecords = Number(backendResult?.savedRecords ?? backendResult?.newRecords ?? 0);
          const skippedRecords = Number(backendResult?.skippedRecords || 0);
          const duplicateRecords = Number(backendResult?.duplicates || 0);
          onImportComplete({
            success: true,
            backendImported: true,
            summary: {
              total: backendResult?.totalRecords || 0,
              newRecords: savedRecords,
              discoveredRecords: backendResult?.newRecords || 0,
              duplicates: duplicateRecords + skippedRecords,
              duplicateRecords,
              byPool: backendResult?.byPool || {},
              byPoolType: backendResult?.byPoolType || {},
              partialPools: backendResult?.partialPools || [],
              failedPools: backendResult?.failedPools || [],
              importMode: backendResult?.importMode || importMode,
              savedRecords,
              skippedRecords,
              anomalyRecords: Number(backendResult?.anomalyRecords || 0),
              anomalyPoolIds: Array.isArray(backendResult?.anomalyPoolIds)
                ? backendResult.anomalyPoolIds
                : [],
              anomalyItems: Array.isArray(backendResult?.anomalyItems)
                ? backendResult.anomalyItems
                : [],
              ignoredNonPullRecords: Number(backendResult?.ignoredNonPullRecords || 0),
              repairedNonPullArtifacts: Number(backendResult?.repairedNonPullArtifacts || 0),
              warnings: Array.isArray(backendResult?.warnings) ? backendResult.warnings : [],
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

      const preview = buildPreviewRecords(records, {
        ...resolvedUserInfo,
        serverId: accountServerId || requestServerId,
      }, t);
      const processedRecords = preview.records;
      const summary = generateImportSummary(processedRecords);

      setFetchedRecords(processedRecords);
      setImportSummary({ ...summary, review: preview.reviewSummary });
      setReviewDecisions(Object.fromEntries(
        processedRecords.map((record, ordinal) => [
          String(ordinal),
          record.importBlocked ? 'skip' : 'keep',
        ])
      ));
      setProgress(100);
      setStatus(preview.reviewSummary.issueRecords > 0
        ? ImportStatus.REVIEW_REQUIRED
        : ImportStatus.SUCCESS);
      setStatusMessage(preview.reviewSummary.issueRecords > 0
        ? `发现 ${preview.reviewSummary.issueRecords} 条需要确认的记录`
        : t('import.official.ready'));
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
    reviewRecords: backendReview?.records || fetchedRecords.map((record, ordinal) => ({
      ordinal,
      poolId: record.pool_id || record.pool,
      itemId: record.item_id || record.character_id || null,
      itemName: record.item_name || record.character_name || record.name || null,
      itemType: record.recordType || 'unknown',
      quality: record.rarity ?? null,
      timestamp: record.timestamp || null,
      seqId: record.seqId || record.seq_id || null,
      issues: record.importIssues || [],
      selectedAction: record.importBlocked ? 'skip' : 'keep',
    })),
    reviewDecisions,
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
    handleReviewDecision,
    handleReset,
  };
}
