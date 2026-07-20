import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, Clock3, Pencil, Trash2 } from 'lucide-react';

import { useI18n } from '../../i18n/index.js';
import { getImportAnomalyDisplayName } from '../../features/import/importCompletionPolicy.js';
import { loadHistoryAnomalies, updateHistoryAnomaly } from '../../services/historyAnomalyService.js';

function getRecordServerScope(record = {}) {
  return record.serverScope
    || record.server_scope
    || record.serverId
    || record.server_id
    || '';
}

function findHistoryRecord(history, anomaly) {
  return (Array.isArray(history) ? history : []).find((record) => (
    String(record?.seqId || record?.seq_id || '') === String(anomaly?.seq_id || '')
    && String(record?.poolId || record?.pool_id || '') === String(anomaly?.pool_id || '')
    && String(record?.gameUid || record?.game_uid || '') === String(anomaly?.game_uid || '')
    && String(getRecordServerScope(record)) === String(anomaly?.server_scope || '')
    && String(record?.id ?? record?.recordId ?? record?.record_id ?? '') === String(anomaly?.record_id || '')
  )) || null;
}

function getAnomalyMessage(anomaly, t) {
  if (anomaly?.issue_code === 'OFFICIAL_IMPORT_UNKNOWN_ITEM') {
    return t('records.anomaly.missingIdentity');
  }
  return anomaly?.details?.message || t('records.anomaly.missingIdentity');
}

export default function HistoryAnomalyReview({
  history = [],
  currentPool = null,
  user = null,
  onEdit,
  onDeleteItem,
  className = '',
}) {
  const { t } = useI18n();
  const [anomalies, setAnomalies] = useState([]);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState(null);
  const requestIdRef = useRef(0);
  const actionInFlightRef = useRef(false);
  const panelRef = useRef(null);
  const translationRef = useRef(t);
  translationRef.current = t;
  const historyRecords = Array.isArray(history) ? history : [];
  const sample = historyRecords[0] || {};
  const poolId = currentPool?.id || currentPool?.pool_id || sample.poolId || sample.pool_id || '';
  const gameUid = sample.gameUid || sample.game_uid || '';
  const serverScope = getRecordServerScope(sample) || (gameUid ? 'legacy' : '');
  const historyRevision = historyRecords.reduce(
    (total, record) => total + Number(record?.editVersion || record?.edit_version || 1),
    historyRecords.length
  );
  const scope = useMemo(() => {
    if (
      !user
      || currentPool?.isAllPoolsOverview
      || currentPool?.isGroupMode
      || !poolId
      || !gameUid
      || !serverScope
    ) {
      return null;
    }
    return {
      poolId: String(poolId),
      gameUid,
      serverScope,
      historyRevision,
    };
  }, [currentPool?.isAllPoolsOverview, currentPool?.isGroupMode, gameUid, historyRevision, poolId, serverScope, user]);

  const reload = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!scope) {
      setAnomalies([]);
      setError('');
      return;
    }

    setAnomalies([]);
    setError('');
    try {
      const nextAnomalies = await loadHistoryAnomalies({
        poolId: scope.poolId,
        gameUid: scope.gameUid,
        serverScope: scope.serverScope,
      });
      if (requestIdRef.current === requestId) {
        setAnomalies(nextAnomalies);
      }
    } catch {
      if (requestIdRef.current === requestId) {
        setError(translationRef.current('records.anomaly.loadFailed'));
      }
    }
  }, [scope]);

  useEffect(() => {
    reload();
    return () => {
      requestIdRef.current += 1;
    };
  }, [reload]);

  const handleStatus = useCallback(async (anomaly, action) => {
    if (actionInFlightRef.current) {
      return;
    }
    actionInFlightRef.current = true;
    setActionId(anomaly.id);
    setError('');
    try {
      await updateHistoryAnomaly({ anomalyId: anomaly.id, action });
      setAnomalies((current) => current.filter((item) => item.id !== anomaly.id));
      setTimeout(() => panelRef.current?.focus(), 0);
    } catch {
      setError(translationRef.current('records.anomaly.updateFailed'));
    } finally {
      actionInFlightRef.current = false;
      setActionId(null);
    }
  }, []);

  if (error && anomalies.length === 0) {
    return (
      <div role="alert" className={`border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/70 dark:bg-red-950/25 dark:text-red-300 ${className}`}>
        {error}
      </div>
    );
  }

  if (anomalies.length === 0) {
    return null;
  }

  return (
    <div ref={panelRef} tabIndex={-1} className={`border border-amber-300 bg-amber-50 p-4 outline-none dark:border-amber-800 dark:bg-amber-950/25 ${className}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-amber-800 dark:text-amber-200">
            {t('records.anomaly.title', { count: anomalies.length })}
          </h3>
          <p className="mt-1 text-xs leading-5 text-amber-800/75 dark:text-amber-200/70">
            {t('records.anomaly.desc')}
          </p>
          <div className="mt-3 space-y-2">
            {anomalies.map((anomaly) => {
              const record = findHistoryRecord(historyRecords, anomaly);
              const busy = Boolean(actionId);
              return (
                <div key={anomaly.id} className="border border-amber-200 bg-white p-3 dark:border-amber-900/70 dark:bg-zinc-950">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 text-xs text-zinc-600 dark:text-zinc-300">
                      <span className="font-bold text-zinc-800 dark:text-white">
                        {getImportAnomalyDisplayName(anomaly, t, 'records.anomaly.unknownItem')
                          || record?.name
                          || record?.character_name
                          || t('records.anomaly.unknownItem')}
                      </span>
                      <span className="ml-2 font-mono text-zinc-500">
                        {t('records.anomaly.seq', { seq: anomaly.seq_id })}
                      </span>
                      <p className="mt-1 text-zinc-500">
                        {getAnomalyMessage(anomaly, t)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={busy} onClick={() => handleStatus(anomaly, 'confirm')} className="inline-flex items-center gap-1 border border-emerald-400 px-2.5 py-1.5 text-xs font-bold text-emerald-700 disabled:opacity-40 dark:text-emerald-300">
                        <CheckCircle size={13} /> {t('records.anomaly.keep')}
                      </button>
                      <button type="button" disabled={busy || !record} onClick={() => onEdit?.(record)} className="inline-flex items-center gap-1 border border-yellow-500 px-2.5 py-1.5 text-xs font-bold text-yellow-700 disabled:opacity-40 dark:text-yellow-300">
                        <Pencil size={13} /> {t('records.anomaly.edit')}
                      </button>
                      <button type="button" disabled={busy || !record} onClick={() => onDeleteItem?.(record)} className="inline-flex items-center gap-1 border border-red-400 px-2.5 py-1.5 text-xs font-bold text-red-600 disabled:opacity-40 dark:text-red-300">
                        <Trash2 size={13} /> {t('records.anomaly.delete')}
                      </button>
                      <button type="button" disabled={busy} onClick={() => handleStatus(anomaly, 'postpone')} className="inline-flex items-center gap-1 border border-zinc-300 px-2.5 py-1.5 text-xs font-bold text-zinc-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300">
                        <Clock3 size={13} /> {t('records.anomaly.postpone')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {error && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}
