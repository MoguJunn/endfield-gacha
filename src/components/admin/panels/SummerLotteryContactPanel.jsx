import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, RefreshCw, ShieldAlert, Trash2, Trophy } from 'lucide-react';
import {
  loadSummerLotteryContactTargets,
  purgeSummerLotteryContact,
  readSummerLotteryContact,
} from '../../../services/admin/summerLotteryContactService.js';

const REVEAL_TTL_MS = 60_000;

function formatDate(value) {
  if (!value) return '未记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN');
}

export default function SummerLotteryContactPanel({ showToast }) {
  const [campaign, setCampaign] = useState(null);
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionEntryId, setActionEntryId] = useState('');
  const [revealedContact, setRevealedContact] = useState(null);
  const revealTimerRef = useRef(null);
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  const clearRevealedContact = useCallback(() => {
    if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current);
    revealTimerRef.current = null;
    setRevealedContact(null);
  }, []);

  const loadTargets = useCallback(async () => {
    setLoading(true);
    clearRevealedContact();
    try {
      const result = await loadSummerLotteryContactTargets();
      setCampaign(result.campaign);
      setTargets(result.targets);
    } catch (error) {
      setCampaign(null);
      setTargets([]);
      showToastRef.current?.(error.message || '中奖联系方式状态读取失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [clearRevealedContact]);

  useEffect(() => {
    loadTargets();
    return () => {
      if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    };
  }, [loadTargets]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) clearRevealedContact();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [clearRevealedContact]);

  const handleRead = async (target, reason) => {
    setActionEntryId(target.entryId);
    clearRevealedContact();
    try {
      const contact = await readSummerLotteryContact({ entryId: target.entryId, reason });
      setRevealedContact(contact);
      revealTimerRef.current = window.setTimeout(clearRevealedContact, REVEAL_TTL_MS);
      showToastRef.current?.('联系方式已读取并写入访问审计，60 秒后自动隐藏', 'success');
    } catch (error) {
      showToastRef.current?.(error.message || '中奖联系方式读取失败', 'error');
    } finally {
      setActionEntryId('');
    }
  };

  const handlePurge = async (target) => {
    const confirmed = window.confirm(
      `确定删除编号 #${target.entryNumber} 的联系方式密文吗？\n\n该操作不会删除中奖结果，但无法撤销。`,
    );
    if (!confirmed) return;
    setActionEntryId(target.entryId);
    clearRevealedContact();
    try {
      await purgeSummerLotteryContact(target.entryId);
      showToastRef.current?.('联系方式密文已删除，公开中奖记录保持不变', 'success');
      await loadTargets();
    } catch (error) {
      showToastRef.current?.(error.message || '中奖联系方式删除失败', 'error');
    } finally {
      setActionEntryId('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            仅按中奖记录单条读取联系方式。每次读取都会写入不可修改的审计记录，明文不会批量导出。
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            保留截止：{formatDate(campaign?.contactRetentionUntil)} · 清理完成：{formatDate(campaign?.contactsClearedAt)}
          </p>
        </div>
        <button type="button" onClick={loadTargets} disabled={loading} className="inline-flex items-center justify-center gap-2 border border-zinc-300 px-3 py-2 text-xs font-bold text-zinc-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 刷新
        </button>
      </div>

      <div className="border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
        <div className="flex items-start gap-2">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <span>不要截图、复制到聊天或写入工单。页面切到后台或读取满 60 秒后会自动隐藏明文。</span>
        </div>
      </div>

      {revealedContact && (
        <div className="border-2 border-red-400 bg-red-50 p-4 dark:bg-red-950/20">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-red-600 dark:text-red-300">
                当前单条联系方式 · {revealedContact.contactType}
              </div>
              <div className="mt-2 break-all font-mono text-lg font-bold text-zinc-900 dark:text-white">
                {revealedContact.contactValue}
              </div>
            </div>
            <button type="button" onClick={clearRevealedContact} className="inline-flex shrink-0 items-center gap-1 border border-red-400 px-3 py-2 text-xs font-bold text-red-700 dark:text-red-300">
              <EyeOff size={14} /> 立即隐藏
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500"><RefreshCw size={20} className="mr-2 animate-spin" /> 正在读取</div>
      ) : targets.length === 0 ? (
        <div className="border border-dashed border-zinc-300 py-16 text-center text-sm text-zinc-500 dark:border-zinc-700">当前活动没有可管理的中奖记录</div>
      ) : (
        <div className="space-y-3">
          {targets.map((target) => {
            const busy = actionEntryId === target.entryId;
            return (
              <article key={target.entryId} className="border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Trophy size={16} className="text-amber-500" />
                      <span className="font-bold text-zinc-800 dark:text-white">编号 #{target.entryNumber}</span>
                      <span className="border border-zinc-300 px-2 py-0.5 text-[10px] font-bold uppercase text-zinc-500 dark:border-zinc-700">
                        {target.prizeTier} / {target.winnerOrder}
                      </span>
                      <span className="text-xs text-zinc-500">兑奖状态：{target.claimStatus}</span>
                    </div>
                    <p className="mt-2 font-mono text-xs text-zinc-500">{target.publicId}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      类型：{target.contactType} · 密文：{target.contactAvailable ? '仍保留' : '已删除'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button type="button" disabled={busy || !target.contactAvailable} onClick={() => handleRead(target, 'winner_notification')} className="inline-flex items-center gap-1 border border-sky-400 px-3 py-1.5 text-xs font-bold text-sky-700 disabled:opacity-40 dark:text-sky-300">
                      <Eye size={13} /> 通知中奖
                    </button>
                    <button type="button" disabled={busy || !target.contactAvailable} onClick={() => handleRead(target, 'claim_follow_up')} className="inline-flex items-center gap-1 border border-emerald-400 px-3 py-1.5 text-xs font-bold text-emerald-700 disabled:opacity-40 dark:text-emerald-300">
                      <Eye size={13} /> 兑奖跟进
                    </button>
                    <button type="button" disabled={busy || !target.contactAvailable} onClick={() => handlePurge(target)} className="inline-flex items-center gap-1 border border-red-400 px-3 py-1.5 text-xs font-bold text-red-700 disabled:opacity-40 dark:text-red-300">
                      <Trash2 size={13} /> 隐私请求删除
                    </button>
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
