import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Eye,
  EyeOff,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Trophy,
} from 'lucide-react';
import {
  loadSummerLotteryContactTargets,
  loadSummerLotteryOperationStatus,
  purgeSummerLotteryContact,
  readSummerLotteryContact,
  runSummerLotteryOperation,
} from '../../../services/admin/summerLotteryContactService.js';

const REVEAL_TTL_MS = 60_000;

function formatDate(value) {
  if (!value) return '未记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN');
}

export default function SummerLotteryContactPanel({ showToast }) {
  const [campaign, setCampaign] = useState(null);
  const [operationStatus, setOperationStatus] = useState(null);
  const [operationConfirmation, setOperationConfirmation] = useState('');
  const [operationAction, setOperationAction] = useState('');
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
      const [contactResult, statusResult] = await Promise.all([
        loadSummerLotteryContactTargets(),
        loadSummerLotteryOperationStatus(),
      ]);
      setCampaign(contactResult.campaign);
      setTargets(contactResult.targets);
      setOperationStatus(statusResult);
    } catch (error) {
      setCampaign(null);
      setTargets([]);
      setOperationStatus(null);
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

  const handleOperation = async (action) => {
    const campaignId = operationStatus?.campaignId || 'community-lottery';
    const expected = `${action.toUpperCase()} ${campaignId}`;
    if (operationConfirmation.trim() !== expected) {
      showToastRef.current?.(`请输入完整确认词：${expected}`, 'error');
      return;
    }
    const confirmed = window.confirm(
      action === 'draw'
        ? '确定立即执行真实开奖吗？候选清单和中奖结果将被事务化固定。'
        : '确定固定当前主站私有种子的承诺吗？产生参与记录后将不能更换。',
    );
    if (!confirmed) return;
    setOperationAction(action);
    clearRevealedContact();
    try {
      const status = await runSummerLotteryOperation({
        action,
        campaignId,
        confirmation: expected,
      });
      setOperationStatus(status);
      setOperationConfirmation('');
      showToastRef.current?.(
        action === 'draw' ? '开奖完成并写入管理员操作审计' : '开奖承诺已固定并写入管理员操作审计',
        'success',
      );
      await loadTargets();
    } catch (error) {
      showToastRef.current?.(error.message || '抽奖操作未执行', 'error');
    } finally {
      setOperationAction('');
    }
  };

  return (
    <div className="space-y-4">
      <section className="border border-zinc-300 p-4 dark:border-zinc-700">
        <div className="flex items-start gap-3">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-300" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-white">短期管理员会话操作</h3>
            <p className="mt-1 text-xs text-zinc-500">
              准备和开奖只在当前主站管理员会话中执行；活动站不再接受长期 Bearer 凭据。成功操作会在数据库事务内追加审计。
            </p>
            <div className="mt-3 grid gap-2 text-xs text-zinc-600 sm:grid-cols-2 dark:text-zinc-300">
              <span>阶段：<strong>{operationStatus?.phase || '未知'}</strong></span>
              <span>私有种子：<strong>{operationStatus?.seedConfigured ? '主站已配置' : '未配置'}</strong></span>
              <span>开奖时间：{formatDate(operationStatus?.drawsAt)}</span>
              <span>公共随机轮次：{operationStatus?.publicRandomnessRound || '未配置'}</span>
            </div>
            <p className="mt-2 break-all font-mono text-[11px] text-zinc-500">
              承诺：{operationStatus?.seedCommitment || '尚未固定'}
            </p>
            <div className="mt-4 flex flex-col gap-2 lg:flex-row">
              <input
                value={operationConfirmation}
                onChange={(event) => setOperationConfirmation(event.target.value)}
                placeholder={`输入 PREPARE 或 DRAW + 空格 + ${operationStatus?.campaignId || 'community-lottery'}`}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 border border-zinc-300 bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-sky-500 dark:border-zinc-700"
              />
              <button
                type="button"
                disabled={Boolean(operationAction) || !operationStatus?.seedConfigured || operationStatus?.phase === 'drawn'}
                onClick={() => handleOperation('prepare')}
                className="inline-flex items-center justify-center gap-1 border border-sky-400 px-3 py-2 text-xs font-bold text-sky-700 disabled:opacity-40 dark:text-sky-300"
              >
                <ShieldCheck size={13} /> {operationAction === 'prepare' ? '正在固定…' : '固定开奖承诺'}
              </button>
              <button
                type="button"
                disabled={Boolean(operationAction) || !operationStatus?.seedConfigured || operationStatus?.phase !== 'ready_to_draw'}
                onClick={() => handleOperation('draw')}
                className="inline-flex items-center justify-center gap-1 border border-red-400 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-40 dark:text-red-300"
              >
                <Play size={13} /> {operationAction === 'draw' ? '正在开奖…' : '执行真实开奖'}
              </button>
            </div>
          </div>
        </div>
      </section>

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
