import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Eye,
  EyeOff,
  KeyRound,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Trophy,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import {
  loadSummerLotteryContactTargets,
  loadSummerLotteryOperatorGrants,
  loadSummerLotteryOperationStatus,
  purgeSummerLotteryContact,
  readSummerLotteryContact,
  runSummerLotteryOperation,
  setSummerLotteryOperatorCapability,
} from '../../../services/admin/summerLotteryContactService.js';

const REVEAL_TTL_MS = 60_000;

function formatDate(value) {
  if (!value) return '未记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN');
}

export default function SummerLotteryContactPanel({
  showToast,
  showOperationControls = true,
  showPermissionManager = false,
}) {
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [campaignIdDraft, setCampaignIdDraft] = useState('');
  const [campaign, setCampaign] = useState(null);
  const [operationStatus, setOperationStatus] = useState(null);
  const [operationConfirmation, setOperationConfirmation] = useState('');
  const [operationAction, setOperationAction] = useState('');
  const [operatorGrants, setOperatorGrants] = useState([]);
  const [operatorUserId, setOperatorUserId] = useState('');
  const [permissionAction, setPermissionAction] = useState('');
  const [targets, setTargets] = useState([]);
  const [contactPermissions, setContactPermissions] = useState({
    canRead: false,
    canPurge: false,
  });
  const [loading, setLoading] = useState(true);
  const [contactAccessDenied, setContactAccessDenied] = useState(false);
  const [actionEntryId, setActionEntryId] = useState('');
  const [revealedContact, setRevealedContact] = useState(null);
  const revealTimerRef = useRef(null);
  const showToastRef = useRef(showToast);

  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  const clearRevealedContact = useCallback(() => {
    if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current);
    revealTimerRef.current = null;
    setRevealedContact(null);
  }, []);

  const loadTargets = useCallback(async () => {
    setLoading(true);
    clearRevealedContact();
    const [contactResult, statusResult, grantsResult] = await Promise.allSettled([
      loadSummerLotteryContactTargets(selectedCampaignId),
      showOperationControls
        ? loadSummerLotteryOperationStatus(selectedCampaignId)
        : Promise.resolve(null),
      showPermissionManager
        ? loadSummerLotteryOperatorGrants(selectedCampaignId)
        : Promise.resolve(null),
    ]);

    if (contactResult.status === 'fulfilled') {
      setCampaign(contactResult.value.campaign);
      setTargets(contactResult.value.targets);
      setContactPermissions(contactResult.value.permissions || {
        canRead: false,
        canPurge: false,
      });
      setContactAccessDenied(false);
    } else {
      setCampaign(null);
      setTargets([]);
      setContactPermissions({ canRead: false, canPurge: false });
      setContactAccessDenied(contactResult.reason?.status === 403);
      if (contactResult.reason?.status !== 403) {
        showToastRef.current?.(
          contactResult.reason?.message || '中奖联系方式状态读取失败',
          'error',
        );
      }
    }

    if (statusResult.status === 'fulfilled') {
      setOperationStatus(statusResult.value);
    } else {
      setOperationStatus(null);
      showToastRef.current?.(
        statusResult.reason?.message || '抽奖操作状态读取失败',
        'error',
      );
    }

    if (grantsResult.status === 'fulfilled') {
      setOperatorGrants(grantsResult.value || []);
    } else {
      setOperatorGrants([]);
      showToastRef.current?.(
        grantsResult.reason?.message || '兑奖授权读取失败',
        'error',
      );
    }
    setLoading(false);
  }, [clearRevealedContact, selectedCampaignId, showOperationControls, showPermissionManager]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void loadTargets(), 0);
    return () => {
      window.clearTimeout(loadTimer);
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

  const handleCampaignSelection = () => {
    const normalizedCampaignId = campaignIdDraft.trim();
    if (normalizedCampaignId && !/^[a-z0-9][a-z0-9_-]{2,79}$/u.test(normalizedCampaignId)) {
      showToastRef.current?.('活动 ID 只允许小写字母、数字、下划线和连字符', 'error');
      return;
    }
    if (normalizedCampaignId === selectedCampaignId) {
      void loadTargets();
      return;
    }
    setSelectedCampaignId(normalizedCampaignId);
  };

  const handleRead = async (target, reason) => {
    setActionEntryId(target.entryId);
    clearRevealedContact();
    try {
      const contact = await readSummerLotteryContact({
        entryId: target.entryId,
        reason,
        campaignId: campaign?.campaignId || selectedCampaignId,
      });
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
      await purgeSummerLotteryContact(
        target.entryId,
        campaign?.campaignId || selectedCampaignId,
      );
      showToastRef.current?.('联系方式密文已删除，公开中奖记录保持不变', 'success');
      await loadTargets();
    } catch (error) {
      showToastRef.current?.(error.message || '中奖联系方式删除失败', 'error');
    } finally {
      setActionEntryId('');
    }
  };

  const handlePermission = async ({ targetUserId, capability, enabled }) => {
    const campaignId = operationStatus?.campaignId
      || campaign?.campaignId
      || selectedCampaignId;
    if (!campaignId) {
      showToastRef.current?.('尚未读取到可操作的活动 ID', 'error');
      return;
    }
    const actionLabel = enabled ? '授予' : '撤销';
    const capabilityLabel = capability === 'contact_read'
      ? '查看与单条读取'
      : '隐私删除';
    const confirmed = window.confirm(
      `${actionLabel}用户 ${targetUserId} 的“${capabilityLabel}”权限吗？\n\n权限只作用于活动 ${campaignId}，变更会写入不可修改审计。`,
    );
    if (!confirmed) return;

    setPermissionAction(`${targetUserId}:${capability}`);
    clearRevealedContact();
    try {
      const result = await setSummerLotteryOperatorCapability({
        campaignId,
        targetUserId,
        capability,
        enabled,
      });
      if (Array.isArray(result.grants)) {
        setOperatorGrants(result.grants);
      } else {
        setOperatorGrants(await loadSummerLotteryOperatorGrants(campaignId));
      }
      if (enabled) setOperatorUserId('');
      showToastRef.current?.(
        result.result?.changed
          ? `已${actionLabel}兑奖最小权限并写入审计`
          : `兑奖权限已是目标状态，无需重复修改`,
        'success',
      );
      await loadTargets();
    } catch (error) {
      showToastRef.current?.(error.message || '兑奖授权未修改', 'error');
    } finally {
      setPermissionAction('');
    }
  };

  const handleOperation = async (action) => {
    const campaignId = operationStatus?.campaignId || campaign?.campaignId || selectedCampaignId;
    if (!campaignId) {
      showToastRef.current?.('尚未读取到可操作的活动 ID', 'error');
      return;
    }
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
      <section className="border border-sky-300 p-4 dark:border-sky-800">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="lottery-campaign-id" className="text-xs font-bold text-zinc-700 dark:text-zinc-200">
              当前操作活动
            </label>
            <p className="mt-1 text-[11px] text-zinc-500">
              留空时跟随服务端 LOTTERY_CAMPAIGN_ID；填写历史活动 ID 可切换查看，但所有操作均按活动隔离。
            </p>
            <input
              id="lottery-campaign-id"
              value={campaignIdDraft}
              onChange={(event) => setCampaignIdDraft(event.target.value.toLowerCase())}
              placeholder="留空跟随当前部署活动"
              autoComplete="off"
              spellCheck={false}
              className="mt-2 w-full border border-zinc-300 bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-sky-500 dark:border-zinc-700"
            />
          </div>
          <button
            type="button"
            onClick={handleCampaignSelection}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 border border-sky-400 px-4 py-2 text-xs font-bold text-sky-700 disabled:opacity-40 dark:text-sky-300"
          >
            <RefreshCw size={13} /> 切换并读取
          </button>
        </div>
        <p className="mt-2 break-all font-mono text-[11px] text-zinc-500">
          已加载：{operationStatus?.campaignId || campaign?.campaignId || '等待服务端响应'}
        </p>
      </section>

      {showOperationControls && (
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
                placeholder={`输入 PREPARE 或 DRAW + 空格 + ${operationStatus?.campaignId || campaign?.campaignId || '当前活动 ID'}`}
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
      )}

      {showPermissionManager && (
        <section className="border border-indigo-300 p-4 dark:border-indigo-800">
          <div className="flex items-start gap-3">
            <KeyRound size={18} className="mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-300" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-white">兑奖最小权限</h3>
              <p className="mt-1 text-xs text-zinc-500">
                全局管理员角色不会自动获得联系方式权限。按活动分别授予“单条读取”和“隐私删除”，每次变更都会写入不可修改审计。
              </p>
              <div className="mt-3 flex flex-col gap-2 xl:flex-row">
                <input
                  value={operatorUserId}
                  onChange={(event) => setOperatorUserId(event.target.value.trim())}
                  placeholder="目标用户 UUID"
                  autoComplete="off"
                  spellCheck={false}
                  className="min-w-0 flex-1 border border-zinc-300 bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500 dark:border-zinc-700"
                />
                <button
                  type="button"
                  disabled={!operatorUserId || Boolean(permissionAction)}
                  onClick={() => handlePermission({
                    targetUserId: operatorUserId,
                    capability: 'contact_read',
                    enabled: true,
                  })}
                  className="inline-flex items-center justify-center gap-1 border border-indigo-400 px-3 py-2 text-xs font-bold text-indigo-700 disabled:opacity-40 dark:text-indigo-300"
                >
                  <UserPlus size={13} /> 授予单条读取
                </button>
                <button
                  type="button"
                  disabled={!operatorUserId || Boolean(permissionAction)}
                  onClick={() => handlePermission({
                    targetUserId: operatorUserId,
                    capability: 'contact_purge',
                    enabled: true,
                  })}
                  className="inline-flex items-center justify-center gap-1 border border-rose-400 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-40 dark:text-rose-300"
                >
                  <UserPlus size={13} /> 授予隐私删除
                </button>
              </div>
              <div className="mt-4 space-y-2">
                {operatorGrants.length === 0 ? (
                  <p className="text-xs text-zinc-500">当前活动尚未授予兑奖权限。</p>
                ) : operatorGrants.map((operatorGrant) => {
                  const grantKey = `${operatorGrant.userId}:${operatorGrant.capability}`;
                  const capabilityLabel = operatorGrant.capability === 'contact_read'
                    ? '单条读取'
                    : '隐私删除';
                  return (
                    <div
                      key={grantKey}
                      className="flex flex-col gap-2 border border-zinc-200 p-3 text-xs sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-zinc-800 dark:text-zinc-200">
                          {operatorGrant.username || '未命名用户'} · {capabilityLabel}
                        </div>
                        <div className="mt-1 break-all font-mono text-[11px] text-zinc-500">
                          {operatorGrant.userId}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(permissionAction)}
                        onClick={() => handlePermission({
                          targetUserId: operatorGrant.userId,
                          capability: operatorGrant.capability,
                          enabled: false,
                        })}
                        className="inline-flex shrink-0 items-center justify-center gap-1 border border-zinc-300 px-3 py-1.5 font-bold text-zinc-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
                      >
                        <UserMinus size={13} /> 撤销
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      )}

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
      ) : contactAccessDenied ? (
        <div className="border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-200">
          当前账号没有此活动的兑奖读取权限。请由超级管理员在抽奖后台按用户 UUID 显式授权。
        </div>
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
                    <button type="button" disabled={busy || !contactPermissions.canRead || !target.contactAvailable} onClick={() => handleRead(target, 'winner_notification')} className="inline-flex items-center gap-1 border border-sky-400 px-3 py-1.5 text-xs font-bold text-sky-700 disabled:opacity-40 dark:text-sky-300">
                      <Eye size={13} /> 通知中奖
                    </button>
                    <button type="button" disabled={busy || !contactPermissions.canRead || !target.contactAvailable} onClick={() => handleRead(target, 'claim_follow_up')} className="inline-flex items-center gap-1 border border-emerald-400 px-3 py-1.5 text-xs font-bold text-emerald-700 disabled:opacity-40 dark:text-emerald-300">
                      <Eye size={13} /> 兑奖跟进
                    </button>
                    <button type="button" disabled={busy || !contactPermissions.canPurge || !target.contactAvailable} onClick={() => handlePurge(target)} className="inline-flex items-center gap-1 border border-red-400 px-3 py-1.5 text-xs font-bold text-red-700 disabled:opacity-40 dark:text-red-300">
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
