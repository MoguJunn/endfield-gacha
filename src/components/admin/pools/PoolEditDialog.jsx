import React, { useState } from 'react';
import {
  X,
  Save,
  Send,
  Star,
  Users,
  UserPlus,
  CheckCircle,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronRight,
  Search,
} from 'lucide-react';
import DateTimePicker from '../../common/DateTimePicker';
import { PanelToolbarButton } from '../panels/shared/PanelUi.jsx';
import { getPoolFeaturedNames } from '../../../utils/poolFeaturedResolver.js';

const FIELD_INPUT_CLASS =
  'w-full border bg-white px-3 py-1.5 text-xs text-slate-700 outline-none transition-colors focus:border-amber-500 dark:bg-zinc-900 dark:text-zinc-300 dark:focus:border-endfield-yellow';
const FIELD_BORDER_CLASS = 'border-zinc-300 dark:border-zinc-700';
const FIELD_LABEL_CLASS = 'mb-1 block text-xs font-medium text-slate-700 dark:text-zinc-300';

function parseFeaturedCharactersInput(value) {
  return Array.from(
    new Set(
      String(value || '')
        .split(/[\n,，、；;|]+/u)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

/**
 * 角色标签组件
 */
const CharacterTag = ({ char, isInPool, isUp, onClick }) => {
  const addedDate = formatAddedDate(char);

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 border px-2 py-1 text-xs transition-all ${
        isInPool
          ? isUp
            ? 'border-orange-400 bg-orange-50 font-bold text-orange-600 dark:border-orange-600 dark:bg-orange-900/40 dark:text-orange-300'
            : 'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400'
          : 'border-zinc-200 bg-zinc-50 text-zinc-400 hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-600 dark:hover:border-zinc-700 dark:hover:bg-zinc-800'
      }`}
      title={`${char.name}${isInPool ? ' ✓ 在池中' : ' ✗ 不在池中'}${isUp ? ' [UP]' : ''} · 添加: ${addedDate}`}
    >
      {isInPool ? <CheckSquare size={12} /> : <Square size={12} />}
      {isUp && '★'}
      {char.name}
    </button>
  );
};

/**
 * 角色分组组件
 */
const CharacterGroup = ({
  items,
  colorClass,
  label,
  isInPool,
  onAddAll,
  onRemoveAll,
  renderCharTag,
  collapsed,
  onToggleCollapsed,
}) => {
  if (items.length === 0) return null;

  const inPoolCount = items.filter((c) => isInPool(c)).length;
  const allSelected = inPoolCount === items.length;

  return (
    <div className="border border-zinc-200 bg-zinc-50/50 p-2.5 dark:border-zinc-800 dark:bg-zinc-800/30">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={onToggleCollapsed} className="flex min-w-0 items-center gap-2 text-left">
          {collapsed ? (
            <ChevronRight size={14} className={colorClass} />
          ) : (
            <ChevronDown size={14} className={colorClass} />
          )}
          <Star size={14} className={colorClass} />
          <span className={`text-xs font-semibold uppercase tracking-wider ${colorClass}`}>{label}</span>
          <span className="font-mono text-[11px] text-slate-400 dark:text-zinc-500">
            {inPoolCount}/{items.length}
          </span>
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onAddAll(items)}
            disabled={allSelected}
            className="border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-600 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50"
          >
            全选
          </button>
          <button
            onClick={() => onRemoveAll(items)}
            disabled={inPoolCount === 0}
            className="border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-600 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-900/50"
          >
            清空
          </button>
        </div>
      </div>
      {!collapsed && <div className="flex flex-wrap gap-1.5">{items.map(renderCharTag)}</div>}
    </div>
  );
};

function getAddedTimestamp(character) {
  const value = character?.created_at || character?.updated_at;
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatAddedDate(character) {
  const timestamp = getAddedTimestamp(character);
  if (!timestamp) return '无记录';
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function sortByAddedDateThenName(left, right) {
  const addedDiff = getAddedTimestamp(right) - getAddedTimestamp(left);
  if (addedDiff !== 0) return addedDiff;

  const rarityDiff = (right.rarity || 0) - (left.rarity || 0);
  if (rarityDiff !== 0) return rarityDiff;

  return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN');
}

function matchesQuery(character, query) {
  if (!query) return true;

  const fields = [character?.name, character?.id, ...(Array.isArray(character?.aliases) ? character.aliases : [])];

  return fields.some((field) =>
    String(field || '')
      .toLowerCase()
      .includes(query)
  );
}

function formatDiffValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join('、') : '空';
  }

  if (value === true) return '是';
  if (value === false) return '否';
  if (value === null || value === undefined || value === '') return '空';

  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    }
  }

  return text;
}

function summarizeNames(items = [], limit = 4) {
  const names = items.map((item) => item?.name || item?.id).filter(Boolean);
  if (names.length === 0) return '';
  const visible = names.slice(0, limit).join('、');
  return names.length > limit ? `${visible} 等 ${names.length} 项` : visible;
}

const PoolDraftDiffPreview = ({ diff }) => {
  if (!diff) return null;

  const fieldChanges = diff.fieldChanges || [];
  const roster = diff.roster || {};
  const rosterChanges = [
    roster.added?.length ? `新增 ${roster.added.length}` : null,
    roster.removed?.length ? `移除 ${roster.removed.length}` : null,
    roster.upChanged?.length ? `UP 标记 ${roster.upChanged.length}` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-2 border border-zinc-200 bg-zinc-50 p-2.5 text-xs text-slate-600 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-400">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-semibold text-slate-700 dark:text-zinc-300">
          <span className="h-3 w-1 bg-amber-500 dark:bg-endfield-yellow" aria-hidden="true"></span>
          {diff.mode === 'create' ? '保存预览：将创建卡池' : '保存前差异预览'}
        </span>
        <span
          className={diff.hasChanges ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-400'}
        >
          {diff.hasChanges ? `${fieldChanges.length} 个字段变化` : '暂无差异'}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className="border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[11px] dark:border-zinc-800 dark:bg-zinc-900">
          阵容 {roster.originalCount || 0} → {roster.currentCount || 0}
        </span>
        {rosterChanges.map((item) => (
          <span
            key={item}
            className="border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
          >
            {item}
          </span>
        ))}
      </div>

      {fieldChanges.length > 0 && (
        <div className="space-y-1">
          {fieldChanges.slice(0, 5).map((change) => (
            <div key={change.key} className="grid grid-cols-[5rem_1fr] gap-2 text-[11px]">
              <span className="text-slate-500 dark:text-zinc-500">{change.label}</span>
              <span className="break-all">
                <span className="text-slate-400 dark:text-zinc-500">{formatDiffValue(change.before)}</span>
                <span className="mx-1 text-slate-400">→</span>
                <span className="text-slate-700 dark:text-zinc-300">{formatDiffValue(change.after)}</span>
              </span>
            </div>
          ))}
          {fieldChanges.length > 5 && (
            <div className="text-[11px] text-slate-400 dark:text-zinc-500">
              另有 {fieldChanges.length - 5} 个字段变化
            </div>
          )}
        </div>
      )}

      {(roster.added?.length || roster.removed?.length || roster.upChanged?.length) && (
        <div className="space-y-1 text-[11px] text-slate-500 dark:text-zinc-500">
          {roster.added?.length > 0 && <div>新增：{summarizeNames(roster.added)}</div>}
          {roster.removed?.length > 0 && <div>移除：{summarizeNames(roster.removed)}</div>}
          {roster.upChanged?.length > 0 && <div>UP 变化：{summarizeNames(roster.upChanged)}</div>}
        </div>
      )}
    </div>
  );
};

/**
 * 卡池编辑对话框
 */
const PoolEditDialog = ({
  show,
  editingPool,
  poolForm,
  setPoolForm,
  characters,
  editingPoolCharacters,
  poolDraftDiff,
  actionLoading,
  checkUpCharacterExists,
  onSave,
  onSaveAndPreviewPush,
  onClose,
  onToggleCharacter,
  onAddAllCharacters,
  onRemoveAllCharacters,
}) => {
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [candidateQuery, setCandidateQuery] = useState('');
  const [candidateFilter, setCandidateFilter] = useState('all');

  const resetCandidateControls = () => {
    setCollapsedGroups({});
    setCandidateQuery('');
    setCandidateFilter('all');
  };

  const handleClose = () => {
    resetCandidateControls();
    onClose();
  };

  const handleSave = () => {
    resetCandidateControls();
    onSave();
  };

  const handleSaveAndPreviewPush = () => {
    resetCandidateControls();
    onSaveAndPreviewPush?.();
  };

  const handlePoolTypeChange = (nextType) => {
    resetCandidateControls();
    setPoolForm((prev) => ({ ...prev, type: nextType }));
  };

  if (!show) return null;

  const poolType =
    poolForm.type === 'limited_character' || poolForm.type === 'limited'
      ? 'limited'
      : poolForm.type === 'weapon' || poolForm.type === 'limited_weapon'
        ? 'weapon'
        : poolForm.type;
  const isExtraPool = poolType === 'extra';
  const expectedCharacterType = poolType === 'weapon' ? 'weapon' : 'character';
  const allChars = characters
    .filter((c) => c.type === (poolType === 'weapon' ? 'weapon' : 'character'))
    .sort(sortByAddedDateThenName);
  const featuredCharacters = parseFeaturedCharactersInput(poolForm.featured_characters_text);
  const featuredCharacterSet = new Set(getPoolFeaturedNames({
    type: poolForm.type,
    up_character: poolForm.up_character,
    featured_characters: isExtraPool ? featuredCharacters : []
  }, { entities: allChars }));
  const normalizedCandidateQuery = candidateQuery.trim().toLowerCase();
  const isInPool = (char) => editingPoolCharacters.some((pc) => pc.character_id === char.id);
  const visibleChars = allChars.filter((char) => {
    if (!matchesQuery(char, normalizedCandidateQuery)) return false;

    if (candidateFilter === 'selected') return isInPool(char);
    if (candidateFilter === 'unselected') return !isInPool(char);
    if (candidateFilter === 'up') return featuredCharacterSet.has(char.name);
    if (candidateFilter === 'six') return char.rarity === 6;

    return true;
  });
  const groupedCharacters = [
    {
      key: 'six-limited',
      label: '6星限定',
      colorClass: 'text-orange-500',
      items: visibleChars.filter((c) => c.rarity === 6 && c.is_limited).sort(sortByAddedDateThenName),
    },
    {
      key: 'six-standard',
      label: '6星常驻',
      colorClass: 'text-amber-600 dark:text-endfield-yellow',
      items: visibleChars.filter((c) => c.rarity === 6 && !c.is_limited).sort(sortByAddedDateThenName),
    },
    {
      key: 'five',
      label: '5星',
      colorClass: 'text-purple-500',
      items: visibleChars.filter((c) => c.rarity === 5).sort(sortByAddedDateThenName),
    },
    {
      key: 'four',
      label: '4星',
      colorClass: 'text-blue-500',
      items: visibleChars.filter((c) => c.rarity === 4).sort(sortByAddedDateThenName),
    },
  ];
  const selectedCharacters = editingPoolCharacters
    .map((pc) => allChars.find((c) => c.id === pc.character_id))
    .filter(Boolean);
  const selectedSummary = {
    total: selectedCharacters.length,
    six: selectedCharacters.filter((c) => c.rarity === 6).length,
    five: selectedCharacters.filter((c) => c.rarity === 5).length,
    four: selectedCharacters.filter((c) => c.rarity === 4).length,
  };

  const toggleGroupCollapsed = (key) => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const renderCharTag = (char) => {
    const inPool = isInPool(char);
    const isUp = featuredCharacterSet.has(char.name);

    return (
      <CharacterTag
        key={char.id}
        char={char}
        isInPool={inPool}
        isUp={isUp}
        onClick={() => onToggleCharacter(char, inPool)}
      />
    );
  };

  return (
    <>
      {/* 背景遮罩 */}
      <div className="animate-fade-in-fast fixed inset-0 z-40 bg-black/50" onClick={handleClose}></div>

      {/* 对话框 */}
      <div className="fixed inset-4 z-50 md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[90vh] md:w-full md:max-w-4xl md:-translate-x-1/2 md:-translate-y-1/2">
        <div className="animate-scale-up flex h-full max-h-full flex-col overflow-hidden border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900 md:h-auto">
          {/* 对话框标题 */}
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-zinc-200">
              <span className="h-3.5 w-1 bg-amber-500 dark:bg-endfield-yellow" aria-hidden="true"></span>
              {editingPool ? '编辑卡池' : '新增卡池'}
            </h3>
            <button
              onClick={handleClose}
              className="p-1 text-slate-400 transition-colors hover:bg-zinc-100 hover:text-slate-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            >
              <X size={18} />
            </button>
          </div>

          {/* 表单内容 */}
          <div className="flex-1 overflow-y-auto p-3">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* 左栏：基本信息 */}
              <div className="space-y-3">
                <h4 className="flex items-center gap-2 border-b border-zinc-100 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:border-zinc-800 dark:text-zinc-300">
                  <span className="h-3 w-1 bg-amber-500 dark:bg-endfield-yellow" aria-hidden="true"></span>
                  基本信息
                </h4>

                {/* 卡池名称 */}
                <div>
                  <label className={FIELD_LABEL_CLASS}>卡池名称 *</label>
                  <input
                    type="text"
                    value={poolForm.name}
                    onChange={(e) => setPoolForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="例如：终末序曲 - 莱万汀UP"
                    className={`${FIELD_INPUT_CLASS} ${FIELD_BORDER_CLASS}`}
                  />
                </div>

                <div>
                  <label className={FIELD_LABEL_CLASS}>英文卡池名称</label>
                  <input
                    type="text"
                    value={poolForm.name_en || ''}
                    onChange={(e) => setPoolForm((prev) => ({ ...prev, name_en: e.target.value }))}
                    placeholder="e.g. Laevatain Featured Banner"
                    className={`${FIELD_INPUT_CLASS} ${FIELD_BORDER_CLASS}`}
                  />
                  <div className="mt-1 text-[11px] text-slate-400 dark:text-zinc-500">
                    英文站点优先使用此译名；留空则继续使用自动占位翻译。
                  </div>
                </div>

                {/* 卡池类型 */}
                <div>
                  <label className={FIELD_LABEL_CLASS}>卡池类型 *</label>
                  <select
                    value={poolForm.type}
                    onChange={(e) => handlePoolTypeChange(e.target.value)}
                    className={`${FIELD_INPUT_CLASS} ${FIELD_BORDER_CLASS}`}
                  >
                    <option value="limited">限定角色池</option>
                    <option value="extra">附加寻访</option>
                    <option value="weapon">限定武器池</option>
                    <option value="standard">常驻池</option>
                  </select>
                </div>

                {/* 武器池特殊选项 */}
                {(poolForm.type === 'weapon' || poolForm.type === 'limited_weapon') && (
                  <div>
                    <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-zinc-300">
                      <input
                        type="checkbox"
                        checked={poolForm.is_limited_weapon}
                        onChange={(e) => setPoolForm((prev) => ({ ...prev, is_limited_weapon: e.target.checked }))}
                        className="h-4 w-4 accent-amber-500"
                      />
                      是否为限定武器池（影响赠送规则）
                    </label>
                  </div>
                )}

                {isExtraPool ? (
                  <div>
                    <label className={FIELD_LABEL_CLASS}>附加寻访 6★ 名单 *</label>
                    <textarea
                      value={poolForm.featured_characters_text || ''}
                      onChange={(e) => setPoolForm((prev) => ({ ...prev, featured_characters_text: e.target.value }))}
                      placeholder={'每行一个，或用逗号分隔\n例如：\n莱万汀\n伊冯\n洁尔佩塔\n余烬'}
                      rows={5}
                      className={`${FIELD_INPUT_CLASS} ${FIELD_BORDER_CLASS} resize-none`}
                    />
                    <div className="mt-2 text-[11px] text-slate-500 dark:text-zinc-500">
                      需填写 4 个不重复的 6★ 角色；保存时会自动将这 4 位标记为本池 UP。
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-slate-400 dark:text-zinc-500">
                        当前已识别 <span className="font-mono">{featuredCharacters.length}/4</span>：
                      </span>
                      {featuredCharacters.map((name) => (
                        <span
                          key={name}
                          className={`border px-2 py-0.5 text-xs ${
                            checkUpCharacterExists(name, 'character')
                              ? 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950/30 dark:text-cyan-300'
                              : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'
                          }`}
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className={FIELD_LABEL_CLASS}>UP 角色/武器名称</label>
                    <input
                      type="text"
                      value={poolForm.up_character}
                      onChange={(e) => setPoolForm((prev) => ({ ...prev, up_character: e.target.value }))}
                      placeholder="例如：莱万汀"
                      className={`${FIELD_INPUT_CLASS} ${
                        poolForm.up_character.trim() &&
                        !checkUpCharacterExists(poolForm.up_character, expectedCharacterType)
                          ? 'border-amber-400 dark:border-amber-600'
                          : FIELD_BORDER_CLASS
                      }`}
                    />
                    {poolForm.up_character.trim() &&
                      !checkUpCharacterExists(poolForm.up_character, expectedCharacterType) && (
                        <div className="animate-fade-in-up-small mt-2 border border-amber-200 bg-amber-50 p-2 text-xs dark:border-amber-800 dark:bg-amber-900/20">
                          <div className="flex items-start gap-2">
                            <UserPlus size={14} className="mt-0.5 shrink-0 text-amber-500" />
                            <div className="text-amber-700 dark:text-amber-400">
                              <p className="font-medium">
                                将自动创建新{expectedCharacterType === 'weapon' ? '武器' : '角色'}「
                                {poolForm.up_character.trim()}」
                              </p>
                              <p className="mt-0.5 opacity-80">
                                6星 · {poolForm.type === 'weapon' ? '武器' : '角色'} · 保存时加入当前卡池草稿
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    {poolForm.up_character.trim() &&
                      checkUpCharacterExists(poolForm.up_character, expectedCharacterType) && (
                        <div className="animate-fade-in-up-small mt-1 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                          <CheckCircle size={12} />
                          {expectedCharacterType === 'weapon' ? '武器已存在' : '角色已存在'}
                        </div>
                      )}
                  </div>
                )}

                {/* 时间范围 */}
                <div className="grid grid-cols-2 gap-3">
                  <DateTimePicker
                    label="开始时间"
                    value={poolForm.start_time}
                    onChange={(val) => setPoolForm((prev) => ({ ...prev, start_time: val }))}
                    placeholder="选择开始时间"
                  />
                  <DateTimePicker
                    label="结束时间"
                    value={poolForm.end_time}
                    onChange={(val) => setPoolForm((prev) => ({ ...prev, end_time: val }))}
                    placeholder="选择结束时间"
                    minDate={poolForm.start_time}
                    durationPresets={[
                      { label: '17天', days: 17 },
                      { label: '21天', days: 21 },
                      { label: '51天', days: 51 },
                    ]}
                    durationBaseTime={poolForm.start_time}
                    onDurationApply={(endDate) => {
                      const y = endDate.getFullYear();
                      const m = String(endDate.getMonth() + 1).padStart(2, '0');
                      const d = String(endDate.getDate()).padStart(2, '0');
                      const h = String(endDate.getHours()).padStart(2, '0');
                      const min = String(endDate.getMinutes()).padStart(2, '0');
                      setPoolForm((prev) => ({ ...prev, end_time: `${y}-${m}-${d}T${h}:${min}` }));
                    }}
                  />
                </div>

                {/* Banner URL */}
                <div>
                  <label className={FIELD_LABEL_CLASS}>Banner 图片 URL</label>
                  <input
                    type="text"
                    value={poolForm.banner_url}
                    onChange={(e) => setPoolForm((prev) => ({ ...prev, banner_url: e.target.value }))}
                    placeholder="https://..."
                    className={`${FIELD_INPUT_CLASS} ${FIELD_BORDER_CLASS} font-mono`}
                  />
                </div>

                {/* 描述 */}
                <div>
                  <label className={FIELD_LABEL_CLASS}>描述</label>
                  <textarea
                    value={poolForm.description}
                    onChange={(e) => setPoolForm((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="卡池描述..."
                    rows={2}
                    className={`${FIELD_INPUT_CLASS} ${FIELD_BORDER_CLASS} resize-none`}
                  />
                </div>
              </div>

              {/* 右栏：卡池角色管理 */}
              <div className="space-y-3">
                <h4 className="flex items-center gap-2 border-b border-zinc-100 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:border-zinc-800 dark:text-zinc-300">
                  <span className="h-3 w-1 bg-amber-500 dark:bg-endfield-yellow" aria-hidden="true"></span>
                  <Users size={14} className="text-amber-500 dark:text-endfield-yellow" />
                  卡池角色管理
                </h4>

                <div className="space-y-3">
                  {/* 快捷操作 */}
                  {allChars.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-800/50">
                      <span className="text-xs text-slate-500 dark:text-zinc-400">当前筛选：</span>
                      <button
                        onClick={() => onAddAllCharacters(visibleChars)}
                        disabled={visibleChars.length === 0}
                        className="border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-600 transition-colors hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50"
                      >
                        全选
                      </button>
                      <button
                        onClick={() => onRemoveAllCharacters(visibleChars)}
                        disabled={visibleChars.length === 0}
                        className="border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-900/50"
                      >
                        清空
                      </button>
                      <span className="ml-auto text-[11px] text-slate-400 dark:text-zinc-500">
                        已选{' '}
                        <span className="font-mono">
                          {selectedSummary.total}/{allChars.length}
                        </span>{' '}
                        · 显示 <span className="font-mono">{visibleChars.length}</span>
                      </span>
                    </div>
                  )}

                  {allChars.length > 0 && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                      <div className="relative">
                        <Search
                          size={14}
                          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500"
                        />
                        <input
                          type="text"
                          value={candidateQuery}
                          onChange={(event) => setCandidateQuery(event.target.value)}
                          placeholder="搜索名称、ID、别名"
                          className={`${FIELD_INPUT_CLASS} ${FIELD_BORDER_CLASS} py-2 pl-8`}
                        />
                      </div>
                      <select
                        value={candidateFilter}
                        onChange={(event) => setCandidateFilter(event.target.value)}
                        className={`${FIELD_INPUT_CLASS} ${FIELD_BORDER_CLASS} w-auto py-2`}
                      >
                        <option value="all">全部候选</option>
                        <option value="selected">只看已选</option>
                        <option value="unselected">只看未选</option>
                        <option value="up">只看 UP</option>
                        <option value="six">只看 6星</option>
                      </select>
                    </div>
                  )}

                  {allChars.length > 0 && (
                    <div className="border border-blue-100 bg-blue-50 p-2 text-[11px] leading-4 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
                      当前为浏览器草稿：已选 {selectedSummary.total} 个，6★ {selectedSummary.six} 个，5★{' '}
                      {selectedSummary.five} 个，4★ {selectedSummary.four}{' '}
                      个；候选按添加日期新到旧排序，点击保存后才同步到数据库。
                    </div>
                  )}

                  <PoolDraftDiffPreview diff={poolDraftDiff} />

                  <div className="max-h-[48vh] space-y-2.5 overflow-y-auto pr-1">
                    {/* 按稀有度分组 */}
                    {groupedCharacters.map((group) => (
                      <CharacterGroup
                        key={group.key}
                        items={group.items}
                        colorClass={group.colorClass}
                        label={group.label}
                        isInPool={isInPool}
                        onAddAll={onAddAllCharacters}
                        onRemoveAll={onRemoveAllCharacters}
                        renderCharTag={renderCharTag}
                        collapsed={Boolean(collapsedGroups[group.key])}
                        onToggleCollapsed={() => toggleGroupCollapsed(group.key)}
                      />
                    ))}

                    {allChars.length > 0 && visibleChars.length === 0 && (
                      <p className="border border-dashed border-zinc-200 py-4 text-center text-xs italic text-slate-400 dark:border-zinc-800 dark:text-zinc-500">
                        当前筛选下没有匹配的{poolType === 'weapon' ? '武器' : '角色'}
                      </p>
                    )}
                  </div>

                  {allChars.length === 0 && (
                    <p className="border border-dashed border-zinc-200 py-4 text-center text-xs italic text-slate-400 dark:border-zinc-800 dark:text-zinc-500">
                      暂无{poolType === 'weapon' ? '武器' : '角色'}数据，请先在角色管理中添加
                    </p>
                  )}

                  {isExtraPool && allChars.length > 0 && (
                    <div className="border border-cyan-200 bg-cyan-50 p-2.5 text-xs text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950/30 dark:text-cyan-300">
                      <p className="font-medium">附加寻访配置说明</p>
                      <p className="mt-1 opacity-80">• 仅这 4 位 6★ 会按 UP 处理；5★ / 4★ 可在上方草稿中手动维护。</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 对话框操作按钮 */}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
            <PanelToolbarButton onClick={handleClose}>取消</PanelToolbarButton>
            {onSaveAndPreviewPush && (
              <PanelToolbarButton onClick={handleSaveAndPreviewPush} disabled={actionLoading === 'save'}>
                <Send size={14} />
                保存并预览推送
              </PanelToolbarButton>
            )}
            <PanelToolbarButton onClick={handleSave} disabled={actionLoading === 'save'} tone="primary">
              <Save size={14} />
              {actionLoading === 'save' ? '保存中...' : '保存'}
            </PanelToolbarButton>
          </div>
        </div>
      </div>
    </>
  );
};

export default PoolEditDialog;
