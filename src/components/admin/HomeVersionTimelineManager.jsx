import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Clock, GripVertical, LayoutTemplate, ListTree, Plus, Save, Trash2, X } from 'lucide-react';
import useSiteConfigStore, {
  DEFAULT_HOME_NEXT_VERSION_TARGET_DATE,
  DEFAULT_HOME_VERSION_TIMELINE,
  HOME_VERSION_TIMELINE_CONFIG_KEY,
} from '../../stores/useSiteConfigStore.js';
import { loadAdminSiteConfigItems } from '../../services/admin/siteConfigService.js';
import {
  applyHomeVersionDurationToEndAt,
  buildHomeVersionTimelinePoolPreview,
  buildHomeVersionTimelineEditorPreview,
  createHomeVersionTimelineRows,
  inferHomeVersionTimeRangeFromPools,
  parseHomeVersionPoolIdsText,
  serializeHomeVersionTimelineRows,
  validateHomeVersionTimelineRows,
} from '../../utils/homeVersionTimelineEditor.js';
import { resolvePoolCapabilities } from '../../utils/poolCapabilities.js';
import { PanelSection, PanelToolbarButton, StatusDot } from './panels/shared/PanelUi.jsx';

const FIELD_CLASS = 'w-full border border-zinc-300 bg-white px-2 py-1.5 text-xs text-slate-700 transition-colors focus:border-amber-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:focus:border-endfield-yellow';
const FIELD_MONO_CLASS = `${FIELD_CLASS} font-mono`;

function normalizeText(value) {
  return String(value || '').trim();
}

function getPoolId(pool) {
  return normalizeText(pool?.pool_id || pool?.id || pool?.poolId);
}

function getPoolTypeLabel(pool) {
  const source = typeof pool === 'object' && pool !== null ? pool : { type: pool };
  const type = source.type || source.pool_type || source.poolType;

  if (type === 'extra') {
    const capabilities = resolvePoolCapabilities(source);
    if (capabilities.extraSubtype === 'reconstruction') {
      return '重构寻访';
    }
    if (capabilities.extraSubtype === 'reconstruction_claim') {
      return '重构申领';
    }
    if (capabilities.extraSubtype === 'special') {
      return '特殊寻访';
    }
    return '附加寻访';
  }

  if (type === 'weapon' || type === 'limited_weapon') return '武器池';
  if (type === 'standard') return '常驻池';
  return '角色池';
}

function getPoolGroup(pool) {
  const poolId = getPoolId(pool).toLowerCase();
  const type = normalizeText(pool?.type || pool?.pool_type).toLowerCase();

  if (
    type === 'limited'
    || type === 'limited_character'
    || poolId.startsWith('special_')
    || poolId.includes('limited_pool')
  ) {
    return 'limited';
  }

  if (
    type === 'extra'
    || type === 'weapon'
    || type === 'limited_weapon'
    || poolId.startsWith('extra_')
    || poolId.startsWith('joint_')
    || poolId.startsWith('weapon')
    || poolId.startsWith('wepon')
  ) {
    return 'special';
  }

  return 'other';
}

function getPoolGroupLabel(group) {
  if (group === 'limited') return '限定池';
  if (group === 'special') return '特殊池 / 武器池';
  return '其他卡池';
}

function formatAdminDateTime(value) {
  if (!value) return '未设置';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return value;

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  }).format(new Date(time));
}

function formatAdminShortDateTime(value) {
  if (!value) return '未设置';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return value;

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  }).format(new Date(time));
}

function createEmptyVersionRow(index) {
  return {
    id: `version-${index + 1}`,
    name: '',
    nameEn: '',
    startsAt: DEFAULT_HOME_NEXT_VERSION_TARGET_DATE,
    endsAt: '',
    enabled: true,
    order: String((index + 1) * 10),
    poolIdsText: '',
  };
}

function sortPoolsForPicker(pools = []) {
  return [...pools]
    .filter((pool) => getPoolId(pool))
    .sort((left, right) => {
      const leftTime = new Date(left?.start_time || left?.startDate || 0).getTime();
      const rightTime = new Date(right?.start_time || right?.startDate || 0).getTime();
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return normalizeText(left?.name).localeCompare(normalizeText(right?.name), 'zh-CN');
    });
}

function buildPoolSummary(row, poolById) {
  const ids = parseHomeVersionPoolIdsText(row.poolIdsText);
  const known = ids.map((id) => poolById.get(id)).filter(Boolean);
  const missing = ids.filter((id) => !poolById.has(id));
  return { ids, known, missing };
}

function getRowStartTimestamp(row) {
  const time = new Date(row?.startsAt || '').getTime();
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

// 时间轴顺序直接由版本开始时间决定，不再手动维护排序值
function sortRowEntriesByStartsAt(rows) {
  return rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .sort((left, right) => {
      const timeDiff = getRowStartTimestamp(left.row) - getRowStartTimestamp(right.row);
      if (timeDiff !== 0) return timeDiff;
      return left.originalIndex - right.originalIndex;
    });
}

export default function HomeVersionTimelineManager({ pools = [], showToast }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState(() => createHomeVersionTimelineRows(DEFAULT_HOME_VERSION_TIMELINE).rows);
  const [activeRowIndex, setActiveRowIndex] = useState(0);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [parseError, setParseError] = useState(null);

  useEffect(() => {
    let mounted = true;
    async function loadTimeline() {
      setLoading(true);
      try {
        const items = await loadAdminSiteConfigItems();
        const item = items.find((entry) => entry.key === HOME_VERSION_TIMELINE_CONFIG_KEY);
        const parsed = createHomeVersionTimelineRows(item?.value || JSON.stringify({ versions: DEFAULT_HOME_VERSION_TIMELINE }));
        if (!mounted) return;
        setRows(parsed.rows);
        setParseError(parsed.parseError);
      } catch (error) {
        if (!mounted) return;
        showToast?.(`版本时间线加载失败: ${error.message}`, 'error');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadTimeline();
    return () => {
      mounted = false;
    };
  }, [showToast]);

  const poolById = useMemo(() => new Map(sortPoolsForPicker(pools).map((pool) => [getPoolId(pool), pool])), [pools]);
  const sortedPools = useMemo(() => sortPoolsForPicker(pools), [pools]);
  const assignedPoolIds = useMemo(() => new Set(
    rows.flatMap((row) => parseHomeVersionPoolIdsText(row.poolIdsText))
  ), [rows]);
  const activeIndex = Math.min(Math.max(activeRowIndex, 0), Math.max(rows.length - 1, 0));
  const activeRow = rows[activeIndex] || null;
  const sortedRowEntries = useMemo(() => sortRowEntriesByStartsAt(rows), [rows]);
  const versionNumberByIndex = useMemo(() => new Map(
    sortedRowEntries.map((entry, sortedIndex) => [entry.originalIndex, sortedIndex + 1])
  ), [sortedRowEntries]);
  const activeSummary = activeRow ? buildPoolSummary(activeRow, poolById) : { ids: [], known: [], missing: [] };
  const validation = useMemo(() => validateHomeVersionTimelineRows(rows), [rows]);
  const preview = useMemo(() => (
    validation.valid
      ? buildHomeVersionTimelineEditorPreview(rows, { now: new Date(), locale: 'zh-CN' })
      : null
  ), [rows, validation.valid]);
  const poolPreviewSections = useMemo(() => (
    validation.valid
      ? buildHomeVersionTimelinePoolPreview(rows, pools, { now: new Date(), locale: 'zh-CN' })
      : []
  ), [pools, rows, validation.valid]);
  const poolGroups = useMemo(() => {
    const groups = new Map([
      ['limited', []],
      ['special', []],
      ['other', []],
    ]);

    sortedPools.forEach((pool) => {
      groups.get(getPoolGroup(pool))?.push(pool);
    });

    return Array.from(groups.entries())
      .map(([group, groupPools]) => ({
        group,
        label: getPoolGroupLabel(group),
        pools: groupPools,
      }))
      .filter((section) => section.pools.length > 0);
  }, [sortedPools]);

  useEffect(() => {
    if (activeRowIndex > rows.length - 1) {
      setActiveRowIndex(Math.max(rows.length - 1, 0));
    }
  }, [activeRowIndex, rows.length]);

  const updateRow = (index, patch) => {
    setRows((prev) => prev.map((row, rowIndex) => (
      rowIndex === index ? { ...row, ...patch } : row
    )));
  };

  const addRow = () => {
    setRows((prev) => [...prev, createEmptyVersionRow(prev.length)]);
    setActiveRowIndex(rows.length);
  };

  const removeRow = (index) => {
    setRows((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
    setActiveRowIndex((prev) => Math.max(0, Math.min(prev, rows.length - 2)));
  };

  const setRowPoolIds = (index, poolIds) => {
    updateRow(index, { poolIdsText: [...new Set(poolIds.map(normalizeText).filter(Boolean))].join('\n') });
  };

  const addPoolToRow = (index, poolId) => {
    const row = rows[index];
    const normalizedPoolId = normalizeText(poolId);
    if (!row || !normalizedPoolId) return;

    const nextPoolIds = parseHomeVersionPoolIdsText(row.poolIdsText);
    if (!nextPoolIds.includes(normalizedPoolId)) {
      setRowPoolIds(index, [...nextPoolIds, normalizedPoolId]);
    }
    setActiveRowIndex(index);
  };

  const removePoolFromRow = (index, poolId) => {
    const row = rows[index];
    if (!row) return;
    setRowPoolIds(index, parseHomeVersionPoolIdsText(row.poolIdsText).filter((id) => id !== poolId));
  };

  const handlePoolDragStart = (event, poolId) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('text/plain', poolId);
    event.dataTransfer.setData('application/x-endfield-pool-id', poolId);
  };

  const handleVersionDrop = (event, index) => {
    event.preventDefault();
    setDragOverIndex(null);
    const poolId = event.dataTransfer.getData('application/x-endfield-pool-id')
      || event.dataTransfer.getData('text/plain');
    addPoolToRow(index, poolId);
  };

  const handleVersionDragOver = (event, index) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleVersionDragLeave = (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setDragOverIndex(null);
    }
  };

  const applySelectedPoolTimeRange = (index) => {
    const inferred = inferHomeVersionTimeRangeFromPools(rows[index], pools);
    if (!inferred) {
      showToast?.('未能从已选择卡池中读取有效时间', 'warning');
      return;
    }

    updateRow(index, {
      startsAt: inferred.startsAt,
      endsAt: inferred.endsAt,
      durationDays: inferred.durationDays,
    });
    showToast?.(`已根据 ${inferred.matchedCount} 个卡池更新时间范围`, 'success');
  };

  const applyDurationEndAt = (index) => {
    const endsAt = applyHomeVersionDurationToEndAt(rows[index]);
    if (!endsAt) {
      showToast?.('请先填写有效开始时间和持续天数', 'warning');
      return;
    }

    updateRow(index, { endsAt });
    showToast?.('已按持续天数填入结束时间', 'success');
  };

  const save = async () => {
    if (!validation.valid) return;

    setSaving(true);
    try {
      // 持久化顺序与时间轴一致：按开始时间排序并按序重写排序值
      const orderedRows = sortRowEntriesByStartsAt(rows).map((entry, index) => ({
        ...entry.row,
        order: String((index + 1) * 10),
      }));
      const serialized = serializeHomeVersionTimelineRows(orderedRows);
      const success = await useSiteConfigStore.getState().updateConfig(HOME_VERSION_TIMELINE_CONFIG_KEY, serialized, {
        label: '首页版本时间线',
        category: 'content',
      });
      if (!success) {
        const updateError = useSiteConfigStore.getState().updateError;
        showToast?.(`版本时间线保存失败: ${updateError?.message || '请检查登录状态和超级管理员权限'}`, 'error');
        return;
      }
      showToast?.('版本时间线已保存', 'success');
    } catch (error) {
      showToast?.(`版本时间线保存失败: ${error.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-400 dark:text-zinc-500">
        <CalendarDays size={18} className="animate-spin" />
        <span className="text-[11px] uppercase tracking-widest">加载版本时间线</span>
      </div>
    );
  }

  const renderVersionFlag = (row, index) => {
    const rowErrors = validation.rowErrors[index] || [];
    const selected = index === activeIndex;
    const summary = buildPoolSummary(row, poolById);
    const versionNumber = versionNumberByIndex.get(index) || 1;
    const flagTone = selected
      ? 'bg-amber-400 text-zinc-950 dark:bg-endfield-yellow'
      : 'bg-zinc-200 text-slate-600 hover:bg-amber-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700';
    const stripeTone = selected
      ? 'bg-[repeating-linear-gradient(135deg,#fbbf24_0,#fbbf24_3px,transparent_3px,transparent_7px)] dark:bg-[repeating-linear-gradient(135deg,#fffa00_0,#fffa00_3px,transparent_3px,transparent_7px)]'
      : 'bg-[repeating-linear-gradient(135deg,#d4d4d8_0,#d4d4d8_3px,transparent_3px,transparent_7px)] dark:bg-[repeating-linear-gradient(135deg,#3f3f46_0,#3f3f46_3px,transparent_3px,transparent_7px)]';

    return (
      <button
        type="button"
        onClick={() => setActiveRowIndex(index)}
        className="flex items-stretch text-left"
        aria-label={`版本节点 ${versionNumber}`}
      >
        <div className={`flex items-center gap-2 whitespace-nowrap py-1.5 pl-2.5 pr-3 transition-colors ${flagTone} ${row.enabled ? '' : 'opacity-55'}`}>
          <span className={`text-[9px] font-black uppercase tracking-[0.2em] ${selected ? 'text-zinc-950/60' : 'opacity-60'}`}>
            VER.{String(versionNumber).padStart(2, '0')}
          </span>
          <span className="text-xs font-black tracking-wide">{row.name || '未命名版本'}</span>
          <span className={`border-l pl-2 font-mono text-[9px] font-bold ${selected ? 'border-zinc-950/30 text-zinc-950/70' : 'border-current/30 opacity-70'}`}>
            {summary.ids.length} 池
          </span>
          {rowErrors.length > 0 ? (
            <span className="border border-red-400 bg-red-50 px-1 py-px text-[9px] font-bold text-red-600 dark:bg-red-950/40 dark:text-red-300">
              待修正
            </span>
          ) : null}
          {!row.enabled ? (
            <span className="border border-current/30 px-1 py-px text-[9px] font-bold opacity-70">停用</span>
          ) : null}
        </div>
        <div className={`w-3 ${stripeTone}`}></div>
      </button>
    );
  };

  const renderVersionPoolCard = (pool, index) => {
    const poolId = getPoolId(pool);
    return (
      <div
        key={poolId}
        className="animate-fade-in-up-small flex min-w-[150px] max-w-[190px] shrink-0 flex-col justify-between gap-1.5 border border-zinc-200 bg-white p-2 transition-colors hover:border-amber-300 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-endfield-yellow/50"
      >
        <div className="flex items-start justify-between gap-1.5">
          <span className="min-w-0 truncate text-xs font-medium text-slate-700 dark:text-zinc-200">
            {pool.name || poolId}
          </span>
          <button
            type="button"
            onClick={() => removePoolFromRow(index, poolId)}
            className="shrink-0 text-zinc-400 transition-colors hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400"
            aria-label={`从版本移除 ${pool.name || poolId}`}
          >
            <X size={12} />
          </button>
        </div>
        <div className="truncate font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
          {getPoolTypeLabel(pool)} · {formatAdminShortDateTime(pool.start_time || pool.startDate)}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {parseError ? (
        <div className="animate-fade-in-up-small border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
          原始版本时间线 JSON 解析失败，当前已载入默认节点。保存前请重新检查内容。
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {[
          { label: '当前版本', value: preview?.currentVersion?.displayName || '无' },
          { label: '下个版本', value: preview?.nextVersion?.displayName || '无' },
          { label: '倒计时目标', value: formatAdminDateTime(preview?.targetAt) },
        ].map((item, index) => (
          <div
            key={item.label}
            className="animate-fade-in-up-small relative overflow-hidden border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-900"
            style={{ animationDelay: `${index * 40}ms` }}
          >
            <span className="absolute left-0 top-0 h-0.5 w-6 bg-amber-500 dark:bg-endfield-yellow" aria-hidden="true"></span>
            <div className="text-[11px] text-slate-500 opacity-80 dark:text-zinc-500">{item.label}</div>
            <div className="mt-1.5 truncate font-mono text-sm font-semibold text-slate-900 dark:text-zinc-100">{item.value}</div>
          </div>
        ))}
      </div>

      <PanelSection
        title="版本时间轴"
        icon={CalendarDays}
        delay={40}
        action={(
          <PanelToolbarButton onClick={addRow}>
            <Plus size={13} />
            添加版本
          </PanelToolbarButton>
        )}
      >
        <div className="pool-card-rail-scrollbar flex items-stretch gap-6 overflow-x-auto overflow-y-hidden px-1 pb-2 pt-1">
          {sortedRowEntries.map(({ row, originalIndex }) => {
            const summary = buildPoolSummary(row, poolById);
            const selected = originalIndex === activeIndex;
            const isDragOver = dragOverIndex === originalIndex;
            return (
              <div key={`version-timeline-${row.id || originalIndex}`} className="flex shrink-0 flex-col">
                {renderVersionFlag(row, originalIndex)}
                <div
                  onDragOver={(event) => handleVersionDragOver(event, originalIndex)}
                  onDragLeave={handleVersionDragLeave}
                  onDrop={(event) => handleVersionDrop(event, originalIndex)}
                  className={`flex min-h-[88px] flex-1 items-stretch gap-2 border-l-[3px] pl-3 pt-2 transition-colors ${
                    isDragOver
                      ? 'border-amber-500 bg-amber-50/70 dark:border-endfield-yellow dark:bg-endfield-yellow/10'
                      : selected
                        ? 'border-amber-400/70 dark:border-endfield-yellow/50'
                        : 'border-zinc-200 dark:border-zinc-800'
                  }`}
                >
                  {summary.known.map((pool) => renderVersionPoolCard(pool, originalIndex))}
                  {summary.missing.map((poolId) => (
                    <div
                      key={poolId}
                      className="flex min-w-[120px] shrink-0 flex-col justify-between gap-1.5 border border-dashed border-amber-300 bg-amber-50/60 p-2 dark:border-amber-800 dark:bg-amber-950/20"
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <span className="min-w-0 truncate font-mono text-[10px] text-amber-700 dark:text-amber-300">{poolId}</span>
                        <button
                          type="button"
                          onClick={() => removePoolFromRow(originalIndex, poolId)}
                          className="shrink-0 text-amber-400 transition-colors hover:text-red-500"
                          aria-label={`从版本移除 ${poolId}`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                      <div className="text-[10px] text-amber-600 dark:text-amber-400">暂未匹配</div>
                    </div>
                  ))}
                  {summary.ids.length === 0 ? (
                    <div className={`flex min-w-[150px] items-center justify-center border border-dashed px-3 text-xs transition-colors ${
                      isDragOver
                        ? 'border-amber-500 text-amber-600 dark:border-endfield-yellow dark:text-endfield-yellow'
                        : 'border-zinc-300 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500'
                    }`}
                    >
                      拖入卡池
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </PanelSection>

      {activeRow ? (
        <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
          <PanelSection
            title={`版本节点 ${versionNumberByIndex.get(activeIndex) || activeIndex + 1}`}
            icon={LayoutTemplate}
            delay={80}
            action={(
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-zinc-400">
                  <input
                    type="checkbox"
                    checked={activeRow.enabled}
                    onChange={(event) => updateRow(activeIndex, { enabled: event.target.checked })}
                    className="accent-amber-500"
                  />
                  启用
                </label>
                <button
                  type="button"
                  onClick={() => removeRow(activeIndex)}
                  disabled={rows.length <= 1}
                  className="p-1.5 text-red-500 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-red-950/30"
                  title="删除版本节点"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          >
            <div className="grid gap-2.5 md:grid-cols-2">
              <label className="space-y-1 text-[11px] font-medium text-slate-500 dark:text-zinc-500">
                中文版本名
                <input
                  value={activeRow.name}
                  onChange={(event) => updateRow(activeIndex, { name: event.target.value })}
                  className={FIELD_CLASS}
                />
              </label>
              <label className="space-y-1 text-[11px] font-medium text-slate-500 dark:text-zinc-500">
                英文版本名
                <input
                  value={activeRow.nameEn}
                  onChange={(event) => updateRow(activeIndex, { nameEn: event.target.value })}
                  className={FIELD_CLASS}
                />
              </label>
              <label className="space-y-1 text-[11px] font-medium text-slate-500 dark:text-zinc-500">
                开始时间
                <input
                  value={activeRow.startsAt}
                  onChange={(event) => updateRow(activeIndex, { startsAt: event.target.value })}
                  className={FIELD_MONO_CLASS}
                />
              </label>
              <label className="space-y-1 text-[11px] font-medium text-slate-500 dark:text-zinc-500">
                <span className="flex items-center justify-between gap-2">
                  结束时间
                  <button
                    type="button"
                    aria-label="按已选卡池时间填入"
                    onClick={() => applySelectedPoolTimeRange(activeIndex)}
                    className="text-[10px] font-semibold text-amber-600 transition-colors hover:text-amber-700 dark:text-endfield-yellow dark:hover:text-yellow-200"
                  >
                    按已选卡池时间填入
                  </button>
                </span>
                <input
                  value={activeRow.endsAt}
                  onChange={(event) => updateRow(activeIndex, { endsAt: event.target.value })}
                  className={FIELD_MONO_CLASS}
                  placeholder="可留空"
                />
              </label>
              <label className="space-y-1 text-[11px] font-medium text-slate-500 dark:text-zinc-500">
                <span className="flex items-center justify-between gap-2">
                  持续天数
                  <button
                    type="button"
                    aria-label="按持续天数填入结束时间"
                    onClick={() => applyDurationEndAt(activeIndex)}
                    className="text-[10px] font-semibold text-amber-600 transition-colors hover:text-amber-700 dark:text-endfield-yellow dark:hover:text-yellow-200"
                  >
                    填入结束时间
                  </button>
                </span>
                <input
                  value={activeRow.durationDays || ''}
                  onChange={(event) => updateRow(activeIndex, { durationDays: event.target.value })}
                  className={FIELD_MONO_CLASS}
                  placeholder="例如 21"
                />
              </label>
              <label className="space-y-1 text-[11px] font-medium text-slate-500 dark:text-zinc-500 md:col-span-2">
                版本 ID
                <input
                  value={activeRow.id}
                  onChange={(event) => updateRow(activeIndex, { id: event.target.value })}
                  className={FIELD_MONO_CLASS}
                />
              </label>
            </div>

            {activeSummary.missing.length > 0 ? (
              <div className="mt-3 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                暂未匹配：{activeSummary.missing.join('、')}
              </div>
            ) : null}

            {(validation.rowErrors[activeIndex] || []).length > 0 ? (
              <div className="mt-3 border border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
                {validation.rowErrors[activeIndex].join('；')}
              </div>
            ) : null}
          </PanelSection>

          <PanelSection title="可分配卡池" icon={ListTree} delay={120} bodyClassName="p-0">
            {poolGroups.length > 0 ? (
              <div className="max-h-[480px] space-y-3 overflow-auto p-3">
                {poolGroups.map((section) => (
                  <div key={section.group} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">{section.label}</div>
                      <div className="font-mono text-[10px] text-slate-400 dark:text-zinc-600">{section.pools.length}</div>
                    </div>
                    <div className="space-y-1">
                      {section.pools.map((pool, poolIndex) => {
                        const poolId = getPoolId(pool);
                        const assigned = assignedPoolIds.has(poolId);
                        return (
                          <button
                            type="button"
                            key={poolId}
                            draggable
                            onDragStart={(event) => handlePoolDragStart(event, poolId)}
                            onClick={() => addPoolToRow(activeIndex, poolId)}
                            className={`animate-fade-in-up-small flex w-full cursor-grab items-center gap-2 border px-2.5 py-1.5 text-left text-xs transition-colors active:cursor-grabbing ${
                              assigned
                                ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-endfield-yellow/40 dark:bg-endfield-yellow/10 dark:text-endfield-yellow'
                                : 'border-zinc-200 bg-zinc-50 text-slate-600 hover:border-amber-300 hover:bg-amber-50/60 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300 dark:hover:border-endfield-yellow/40 dark:hover:bg-endfield-yellow/5'
                            }`}
                            style={{ animationDelay: `${Math.min(poolIndex, 8) * 30}ms` }}
                          >
                            <GripVertical size={13} className="shrink-0 text-slate-300 dark:text-zinc-600" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{pool.name || poolId}</span>
                              <span className="mt-0.5 block truncate font-mono text-[10px] text-slate-400 dark:text-zinc-500">
                                {poolId} · {getPoolTypeLabel(pool)} · {formatAdminShortDateTime(pool.start_time || pool.startDate)}
                              </span>
                            </span>
                            {assigned ? <Check size={13} className="shrink-0 text-amber-500 dark:text-endfield-yellow" /> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-xs text-slate-500 dark:text-zinc-500">
                当前没有可选择的卡池。请先同步或新增卡池。
              </div>
            )}
          </PanelSection>
        </section>
      ) : null}

      <PanelSection title="首页轮换预览" icon={Clock} delay={160}>
        {poolPreviewSections.length > 0 ? (
          <div className="grid gap-2 lg:grid-cols-2">
            {poolPreviewSections.map((section) => (
              <div key={section.id} className="border border-zinc-200 bg-zinc-50 p-2.5 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/40 dark:hover:border-zinc-700">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-bold text-slate-800 dark:text-zinc-100">{section.name}</div>
                    <div className="mt-0.5 text-[10px] text-slate-400 dark:text-zinc-500">
                      {section.pools.length} 个展示卡池{section.hiddenExtraCount > 0 ? `，折叠 ${section.hiddenExtraCount} 个过期附加池` : ''}
                    </div>
                  </div>
                </div>
                <div className="mt-2 space-y-1">
                  {section.pools.map((pool) => (
                    <div key={`${section.id}-${pool.id || pool.name}`} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="min-w-0 truncate font-medium text-slate-600 dark:text-zinc-300">{pool.displayName || pool.name || pool.id}</span>
                      <span className="shrink-0 text-slate-400 dark:text-zinc-500">{getPoolTypeLabel(pool.poolData || pool)}</span>
                      {Array.isArray(pool.foldedExtraPools) && pool.foldedExtraPools.length > 0 ? (
                        <span className="shrink-0 text-cyan-600 dark:text-cyan-300">
                          合并 {pool.foldedExtraPools.length}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-slate-500 dark:text-zinc-500">
            暂无可预览卡池。请在版本节点中选择卡池，或先同步 / 新增卡池。
          </div>
        )}
      </PanelSection>

      {!validation.valid ? (
        <div className="flex items-center gap-2 border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
          <StatusDot tone="danger" pulse />
          {validation.errors.join('；')}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <PanelToolbarButton onClick={addRow}>
          <Plus size={13} />
          添加版本
        </PanelToolbarButton>
        <div className="flex-1" />
        <PanelToolbarButton tone="primary" onClick={save} disabled={saving || !validation.valid}>
          <Save size={13} />
          {saving ? '保存中...' : '保存版本时间线'}
        </PanelToolbarButton>
      </div>
    </div>
  );
}
