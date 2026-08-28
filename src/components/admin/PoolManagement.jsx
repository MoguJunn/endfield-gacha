import React, { useState } from 'react';
import {
  Search,
  Plus,
  Database,
  RotateCw,
  ArrowUpDown,
  Filter,
  CalendarDays,
  List,
  Send,
  X,
  CheckCircle,
  AlertTriangle,
} from 'lucide-react';
import { usePools } from '../../hooks/admin/usePools';
import * as poolPushService from '../../services/admin/poolPushService';
import { getPoolFeaturedNames } from '../../utils/poolFeaturedResolver.js';
import { PoolCard, PoolEditDialog } from './pools';
import VirtualizedList from './VirtualizedList';
import HomeVersionTimelineManager from './HomeVersionTimelineManager.jsx';
import { PanelSection, PanelToolbarButton } from './panels/shared/PanelUi.jsx';

const INPUT_CLASS =
  'border border-zinc-300 bg-white text-xs text-slate-700 outline-none transition-colors focus:border-amber-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:focus:border-endfield-yellow';

function normalizePoolPushType(value) {
  if (value === 'limited_character' || value === 'limited') return 'limited';
  if (value === 'limited_weapon' || value === 'weapon') return 'weapon';
  if (value === 'extra') return 'extra';
  if (value === 'beginner' || value === 'newbie') return 'newbie';
  if (value === 'standard') return 'standard';
  return 'unknown';
}

function uniqueTextValues(values) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function buildPoolPushPayload(pool, poolCharacters, characters) {
  if (!pool) return null;
  const id = String(pool.pool_id || pool.id || '').trim();
  const name = String(pool.name || '').trim();
  if (!id || !name) return null;

  const characterNameById = new Map(characters.map((character) => [character.id, character.name]));
  const poolRoster = Array.isArray(poolCharacters[id]) ? poolCharacters[id] : [];
  const rosterUpItems = poolRoster
    .filter((row) => row?.is_up)
    .map((row) => characterNameById.get(row.character_id))
    .filter(Boolean);
  const existingRosterUp = Array.isArray(pool.resolved_roster?.up) ? pool.resolved_roster.up : [];
  const upItems = uniqueTextValues(getPoolFeaturedNames({
    ...pool,
    resolved_roster: {
      ...pool.resolved_roster,
      up: [...existingRosterUp, ...rosterUpItems]
    }
  }, { entities: characters }));

  const payload = {
    id,
    name,
    type: normalizePoolPushType(pool.type),
    upItems,
  };
  if (pool.start_time) payload.startsAt = pool.start_time;
  if (pool.end_time) payload.endsAt = pool.end_time;
  if (pool.description) payload.note = pool.description;
  return payload;
}

const PoolPushConfirmDialog = ({ preview, result, loading, onClose, onConfirm }) => {
  if (!preview) return null;

  const targets = Array.isArray(preview.targets) ? preview.targets : [];
  const allowedTargets = targets.filter((target) => target.status === 'allowed');
  const blockedTargets = targets.filter((target) => target.status !== 'allowed');
  const canConfirm =
    !loading &&
    !result &&
    Boolean(preview.confirmationToken) &&
    !preview.alreadyDelivered &&
    allowedTargets.length > 0;
  const resultNeedsAttention = Boolean(result && ((result.failedCount || 0) > 0 || (result.sentCount || 0) === 0));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/50" onClick={onClose} aria-label="关闭卡池推送确认" />
      <div className="relative flex max-h-[88vh] w-full max-w-2xl flex-col border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-zinc-100">
              <Send size={16} className="text-amber-500 dark:text-endfield-yellow" />
              卡池更新推送确认
            </div>
            <div
              className="mt-1 truncate font-mono text-[11px] text-slate-400 dark:text-zinc-500"
              title={preview.dedupeKey}
            >
              {preview.dedupeKey}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-transparent p-1.5 text-slate-400 transition-colors hover:border-zinc-200 hover:text-slate-700 dark:text-zinc-500 dark:hover:border-zinc-700 dark:hover:text-zinc-200"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/60">
              <div className="text-[11px] text-slate-500 dark:text-zinc-500">目标</div>
              <div className="mt-1 font-mono text-lg font-semibold text-slate-800 dark:text-zinc-100">
                {preview.targetCount || 0}
              </div>
            </div>
            <div className="border border-emerald-200 bg-emerald-50 p-2 dark:border-emerald-900 dark:bg-emerald-950/30">
              <div className="text-[11px] text-emerald-700 dark:text-emerald-300">允许</div>
              <div className="mt-1 font-mono text-lg font-semibold text-emerald-700 dark:text-emerald-300">
                {preview.allowedTargetCount || 0}
              </div>
            </div>
            <div className="border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/60">
              <div className="text-[11px] text-slate-500 dark:text-zinc-500">拦截</div>
              <div className="mt-1 font-mono text-lg font-semibold text-slate-700 dark:text-zinc-200">
                {preview.blockedTargetCount || 0}
              </div>
            </div>
            <div className="border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/60">
              <div className="text-[11px] text-slate-500 dark:text-zinc-500">状态</div>
              <div className="mt-1 text-xs font-semibold text-slate-700 dark:text-zinc-200">
                {preview.alreadyDelivered ? '已推送' : '待确认'}
              </div>
            </div>
          </div>

          {(preview.alreadyDelivered || preview.allowedTargetCount === 0) && (
            <div className="flex items-start gap-2 border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{preview.alreadyDelivered ? '这次卡池更新已记录为推送完成。' : '当前没有可发送的订阅目标。'}</span>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
              消息预览
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-slate-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
              {preview.messageText || preview.title || ''}
            </pre>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <TargetPreviewList title="允许发送" targets={allowedTargets} empty="暂无允许目标" />
            <TargetPreviewList title="已拦截" targets={blockedTargets} empty="暂无拦截目标" />
          </div>

          {result && (
            <div
              className={`border p-2 text-xs ${
                resultNeedsAttention
                  ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold">
                {resultNeedsAttention ? <AlertTriangle size={14} /> : <CheckCircle size={14} />}
                推送结果
              </div>
              <div className="mt-1 font-mono">
                sent {result.sentCount || 0} / skipped {result.skippedCount || 0} / failed {result.failedCount || 0}
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <PanelToolbarButton onClick={onClose}>关闭</PanelToolbarButton>
          <PanelToolbarButton onClick={onConfirm} disabled={!canConfirm} tone="primary">
            <Send size={14} />
            {loading ? '发送中...' : '确认发送'}
          </PanelToolbarButton>
        </div>
      </div>
    </div>
  );
};

const TargetPreviewList = ({ title, targets, empty }) => (
  <div className="border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950">
    <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-zinc-300">{title}</div>
    {targets.length === 0 ? (
      <div className="py-3 text-center text-[11px] text-slate-400 dark:text-zinc-500">{empty}</div>
    ) : (
      <div className="max-h-36 space-y-1 overflow-y-auto pr-1">
        {targets.slice(0, 12).map((target) => (
          <div
            key={`${target.scene}:${target.targetHash}:${target.status}`}
            className="flex items-center justify-between gap-2 border border-zinc-100 px-2 py-1 text-[11px] dark:border-zinc-800"
          >
            <span className="min-w-0 truncate font-mono text-slate-600 dark:text-zinc-300" title={target.targetHash}>
              {target.targetHash}
            </span>
            <span className="shrink-0 text-slate-400 dark:text-zinc-500">{target.reason || target.scene}</span>
          </div>
        ))}
        {targets.length > 12 && (
          <div className="text-center text-[11px] text-slate-400 dark:text-zinc-500">
            另有 {targets.length - 12} 个目标
          </div>
        )}
      </div>
    )}
  </div>
);

/**
 * 卡池管理界面
 * 超级管理员专用，用于管理所有卡池的 CRUD 操作
 */
const PoolManagement = ({ showToast, service = null, configAdapter = null, sandboxMode = false }) => {
  const [activeTab, setActiveTab] = useState('pools');
  const {
    // 数据
    pools,
    characters,
    poolCharacters,
    filteredPools,

    // 状态
    loading,
    actionLoading,

    // 搜索筛选排序
    searchQuery,
    setSearchQuery,
    typeFilter,
    setTypeFilter,
    sortField,
    setSortField,
    sortOrder,
    setSortOrder,

    // 编辑对话框
    showEditDialog,
    editingPool,
    poolForm,
    setPoolForm,
    editingPoolCharacters,
    poolDraftDiff,

    // 操作
    checkUpCharacterExists,
    resetForm,
    startCreate,
    startEdit,
    handleSavePool,
    handleDeletePool,
    handleRecalculateIsStandard,

    // 角色池子管理
    toggleCharacterInPool,
    addAllCharactersToPool,
    removeAllCharactersFromPool,
  } = usePools(showToast, service ? {
    service,
    invalidateCache: async () => true,
    refreshCharacterCatalog: async () => true,
  } : undefined);

  const [poolPushPreview, setPoolPushPreview] = useState(null);
  const [poolPushResult, setPoolPushResult] = useState(null);
  const [poolPushLoading, setPoolPushLoading] = useState(false);

  const closePoolPushDialog = () => {
    if (poolPushLoading) return;
    setPoolPushPreview(null);
    setPoolPushResult(null);
  };

  const openPoolPushPreview = async (pool, { saved = false } = {}) => {
    const pushPool = buildPoolPushPayload(pool, poolCharacters, characters);
    if (!pushPool) {
      showToast(saved ? '卡池已保存，但保存结果缺少有效卡池信息，无法生成推送预览' : '请选择一个有效卡池后再预览推送', 'error');
      return false;
    }

    setPoolPushLoading(true);
    setPoolPushPreview(null);
    setPoolPushResult(null);
    const result = await poolPushService.previewPoolPush({ pool: pushPool });
    setPoolPushLoading(false);

    if (!result.success) {
      showToast(`${saved ? '卡池已保存，但' : ''}生成卡池推送预览失败: ${result.error}`, 'error');
      return false;
    }

    setPoolPushPreview(result.data);
    showToast('已生成卡池更新推送预览', 'success');
    return true;
  };

  const handleSaveAndPreviewPush = async () => {
    const result = await handleSavePool();
    if (result?.success && result.pool) {
      await openPoolPushPreview(result.pool, { saved: true });
    } else if (result?.success) {
      showToast('卡池已保存，但保存结果缺少卡池信息，无法生成推送预览', 'error');
    }
  };

  const handleConfirmPoolPush = async () => {
    if (!poolPushPreview?.confirmationToken) {
      showToast('当前预览缺少确认凭证，请重新生成预览', 'error');
      return;
    }

    setPoolPushLoading(true);
    const result = await poolPushService.sendPoolPush({ confirmationToken: poolPushPreview.confirmationToken });
    setPoolPushLoading(false);

    if (!result.success) {
      const message = result.code === 'expired_confirmation_token'
        ? '卡池推送预览已过期，请关闭弹窗后重新生成预览'
        : `卡池推送失败: ${result.error}`;
      showToast(message, 'error');
      return;
    }

    setPoolPushResult(result.data);
    const failedCount = result.data?.failedCount || 0;
    const sentCount = result.data?.sentCount || 0;
    const skippedCount = result.data?.skippedCount || 0;
    const emergencyStopped = result.data?.records?.some((record) => record.reason === 'emergency_stop_enabled');
    const toastType = failedCount > 0 || sentCount === 0 ? 'warning' : 'success';
    const resultMessage = emergencyStopped
      ? '紧急停止开关已开启，本次卡池更新没有发送'
      : `卡池推送完成：发送 ${sentCount}，跳过 ${skippedCount}，失败 ${failedCount}`;
    showToast(
      resultMessage,
      toastType
    );
  };

  if (loading) {
    return (
      <div className="animate-fade-in-up flex flex-col items-center justify-center gap-3 border border-zinc-200 bg-white py-16 text-slate-400 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500">
        <RotateCw size={20} className="animate-spin" />
        <span className="text-xs uppercase tracking-widest">正在读取卡池数据</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="animate-fade-in-up flex border border-zinc-200 bg-white p-1 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <button
          type="button"
          onClick={() => setActiveTab('pools')}
          className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all ${
            activeTab === 'pools'
              ? 'bg-slate-900 text-white dark:bg-endfield-yellow dark:text-black'
              : 'text-slate-500 hover:bg-zinc-100 hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
          }`}
        >
          <List size={14} />
          卡池列表
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('versions')}
          className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all ${
            activeTab === 'versions'
              ? 'bg-slate-900 text-white dark:bg-endfield-yellow dark:text-black'
              : 'text-slate-500 hover:bg-zinc-100 hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
          }`}
        >
          <CalendarDays size={14} />
          版本管理
        </button>
      </div>

      {activeTab === 'versions' ? (
        <HomeVersionTimelineManager pools={pools} showToast={showToast} configAdapter={configAdapter} />
      ) : (
        <>
          <PanelSection
            title="卡池列表"
            icon={Database}
            delay={40}
            action={
              <span className="text-[11px] text-slate-500 dark:text-zinc-500">
                显示{' '}
                <span className="font-mono font-semibold text-slate-700 dark:text-zinc-300">
                  {filteredPools.length}
                </span>{' '}
                / <span className="font-mono">{pools.length}</span> 个卡池
              </span>
            }
          >
            {/* 工具栏 */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px] flex-1">
                <Search
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索卡池名称或UP角色..."
                  className={`w-full py-2 pl-8 pr-3 ${INPUT_CLASS}`}
                />
              </div>

              {/* 类型筛选 */}
              <div className="flex items-center gap-1">
                <Filter size={14} className="text-slate-400 dark:text-zinc-500" />
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className={`px-2 py-2 ${INPUT_CLASS}`}
                >
                  <option value="all">全部类型</option>
                  <option value="limited">限定角色</option>
                  <option value="extra">附加寻访</option>
                  <option value="weapon">限定武器</option>
                  <option value="standard">常驻</option>
                </select>
              </div>

              {/* 排序 */}
              <div className="flex items-center gap-1">
                <ArrowUpDown size={14} className="text-slate-400 dark:text-zinc-500" />
                <select
                  value={sortField}
                  onChange={(e) => setSortField(e.target.value)}
                  className={`px-2 py-2 ${INPUT_CLASS}`}
                >
                  <option value="created_at">创建时间</option>
                  <option value="start_time">开始时间</option>
                  <option value="end_time">结束时间</option>
                  <option value="name">名称</option>
                </select>
                <button
                  onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                  className="border border-zinc-300 bg-white px-2.5 py-2 font-mono text-xs text-slate-700 transition-all hover:border-amber-500 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-endfield-yellow dark:hover:bg-zinc-800"
                  title={sortOrder === 'asc' ? '升序' : '降序'}
                >
                  {sortOrder === 'asc' ? '↑' : '↓'}
                </button>
              </div>

              <PanelToolbarButton onClick={startCreate} tone="primary">
                <Plus size={14} />
                新增卡池
              </PanelToolbarButton>

              {/* 重新计算限定/常驻按钮 */}
              <button
                onClick={handleRecalculateIsStandard}
                disabled={actionLoading === 'recalculate'}
                className="inline-flex items-center gap-2 border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-all hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                title="根据各卡池的UP角色重新计算所有6星记录的限定/常驻状态"
              >
                <RotateCw size={14} className={actionLoading === 'recalculate' ? 'animate-spin' : ''} />
                {actionLoading === 'recalculate' ? '计算中...' : '重算限定/常驻'}
              </button>
            </div>

            {/* 卡池列表 */}
            <div className="mt-3">
              {filteredPools.length === 0 ? (
                <div className="border border-dashed border-zinc-200 p-10 text-center text-slate-400 dark:border-zinc-800 dark:text-zinc-500">
                  <Database size={40} className="mx-auto mb-3 opacity-50" />
                  <p className="text-xs uppercase tracking-widest">
                    {pools.length === 0 ? '暂无卡池' : '未找到匹配的卡池'}
                  </p>
                </div>
              ) : (
                <VirtualizedList
                  items={filteredPools}
                  getKey={(pool) => pool.pool_id}
                  itemHeight={250}
                  maxHeight={720}
                  className="space-y-3 pr-1"
                  renderItem={(pool, index) => (
                    <div
                      className="animate-fade-in-up-small pb-3"
                      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
                    >
                      <PoolCard
                        pool={pool}
                        poolCharacters={poolCharacters}
                        characters={characters}
                        actionLoading={actionLoading}
                        onEdit={startEdit}
                        onDelete={handleDeletePool}
                        onPreviewPush={sandboxMode ? null : openPoolPushPreview}
                      />
                    </div>
                  )}
                />
              )}
            </div>
          </PanelSection>

          {/* 编辑对话框 */}
          <PoolEditDialog
            show={showEditDialog}
            editingPool={editingPool}
            poolForm={poolForm}
            setPoolForm={setPoolForm}
            characters={characters}
            editingPoolCharacters={editingPoolCharacters}
            poolDraftDiff={poolDraftDiff}
            actionLoading={actionLoading}
            checkUpCharacterExists={checkUpCharacterExists}
            onSave={handleSavePool}
            onSaveAndPreviewPush={sandboxMode ? null : handleSaveAndPreviewPush}
            onClose={resetForm}
            onToggleCharacter={toggleCharacterInPool}
            onAddAllCharacters={addAllCharactersToPool}
            onRemoveAllCharacters={removeAllCharactersFromPool}
          />
          {!sandboxMode && (
            <PoolPushConfirmDialog
              preview={poolPushPreview}
              result={poolPushResult}
              loading={poolPushLoading}
              onClose={closePoolPushDialog}
              onConfirm={handleConfirmPoolPush}
            />
          )}
        </>
      )}
    </div>
  );
};

export default PoolManagement;
