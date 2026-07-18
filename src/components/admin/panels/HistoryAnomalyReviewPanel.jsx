import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import {
  loadAdminHistoryAnomalies,
  updateAdminHistoryAnomaly,
} from '../../../services/historyAnomalyService.js';

const STATUS_OPTIONS = [
  ['pending', '待处理'],
  ['confirmed', '用户确认无误'],
  ['resolved', '已处理'],
  ['dismissed', '无需处理'],
  ['all', '全部'],
];

export default function HistoryAnomalyReviewPanel({ showToast }) {
  const [status, setStatus] = useState('pending');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState(null);
  const loadRequestIdRef = useRef(0);
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  const loadItems = useCallback(async () => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    setLoading(true);
    try {
      const nextItems = await loadAdminHistoryAnomalies(status);
      if (loadRequestIdRef.current === requestId) {
        setItems(nextItems);
      }
    } catch (error) {
      if (loadRequestIdRef.current === requestId) {
        setItems([]);
        showToastRef.current?.(error.message || '异常记录读取失败', 'error');
      }
    } finally {
      if (loadRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [status]);

  useEffect(() => {
    loadItems();
    return () => {
      loadRequestIdRef.current += 1;
    };
  }, [loadItems]);

  const handleAction = async (item, action) => {
    setActionId(item.id);
    try {
      await updateAdminHistoryAnomaly({
        anomalyId: item.id,
        action,
        note: action === 'resolve'
          ? '管理员已核对并标记为已处理'
          : action === 'dismiss'
            ? '管理员判断无需继续提醒用户'
            : '管理员重新打开核对',
      });
      showToastRef.current?.('异常记录状态已更新', 'success');
      await loadItems();
    } catch (error) {
      showToastRef.current?.(error.message || '状态更新失败', 'error');
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">集中查看旧版官方导入产生的未知角色或武器记录。</p>
          <p className="mt-1 text-xs text-zinc-500">用户修改或删除记录后会自动结束对应提醒；管理员操作只改变审阅状态，不会直接改动抽卡内容。</p>
        </div>
        <button type="button" onClick={loadItems} disabled={loading} className="inline-flex items-center justify-center gap-2 border border-zinc-300 px-3 py-2 text-xs font-bold text-zinc-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 刷新
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map(([value, label]) => (
          <button key={value} type="button" onClick={() => setStatus(value)} className={`border px-3 py-1.5 text-xs font-bold ${status === value ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300' : 'border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-300'}`}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500"><RefreshCw size={20} className="mr-2 animate-spin" /> 正在读取</div>
      ) : items.length === 0 ? (
        <div className="border border-dashed border-zinc-300 py-16 text-center text-sm text-zinc-500 dark:border-zinc-700">当前筛选下没有异常记录</div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const details = item.details || {};
            const busy = actionId === item.id;
            return (
              <article key={item.id} className="border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <AlertTriangle size={16} className="text-amber-500" />
                      <span className="font-bold text-zinc-800 dark:text-white">{item.user?.username || item.user?.email || item.user_id}</span>
                      <span className="border border-zinc-300 px-2 py-0.5 text-[10px] font-bold uppercase text-zinc-500 dark:border-zinc-700">{item.status}</span>
                    </div>
                    <div className="mt-2 grid gap-1 font-mono text-xs text-zinc-500 sm:grid-cols-2">
                      <span>UID: {item.game_uid || '缺失'}</span>
                      <span>区服: {item.server_scope || '缺失'}</span>
                      <span>卡池: {item.pool_id || '缺失'}</span>
                      <span>序号: {item.seq_id || '缺失'}</span>
                    </div>
                    <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">{details.message || '该记录缺少可识别的物品字段。'}</p>
                    <p className="mt-1 text-xs text-zinc-500">记录内容：{details.itemName || '未知'} · {details.rarity ? `${details.rarity}★` : '品质未知'} · {details.timestamp || '时间未知'}</p>
                    {item.resolution_note && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">处理说明：{item.resolution_note}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {item.status === 'pending' ? (
                      <>
                        <button type="button" disabled={busy} onClick={() => handleAction(item, 'resolve')} className="inline-flex items-center gap-1 border border-emerald-400 px-3 py-1.5 text-xs font-bold text-emerald-700 disabled:opacity-40 dark:text-emerald-300"><CheckCircle size={13} /> 标记已处理</button>
                        <button type="button" disabled={busy} onClick={() => handleAction(item, 'dismiss')} className="inline-flex items-center gap-1 border border-zinc-400 px-3 py-1.5 text-xs font-bold text-zinc-600 disabled:opacity-40 dark:text-zinc-300"><XCircle size={13} /> 无需处理</button>
                      </>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => handleAction(item, 'reopen')} className="inline-flex items-center gap-1 border border-amber-400 px-3 py-1.5 text-xs font-bold text-amber-700 disabled:opacity-40 dark:text-amber-300"><RotateCcw size={13} /> 重新打开</button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
