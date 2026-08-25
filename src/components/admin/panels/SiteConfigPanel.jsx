import React, { useState, useEffect, useMemo } from 'react';
import { Save, X, Edit2, Settings, Globe, Scale, Link, FileText, AlertTriangle, Plus, Trash2 } from 'lucide-react';
import useSiteConfigStore, {
  DEFAULT_HOME_NEXT_VERSION_TARGET_DATE,
  DEFAULT_HOME_VERSION_TIMELINE,
  HOME_NEXT_VERSION_TARGET_CONFIG_KEY,
  HOME_VERSION_TIMELINE_CONFIG_KEY,
} from '../../../stores/useSiteConfigStore';
import { loadAdminSiteConfigItems } from '../../../services/admin/siteConfigService.js';
import { ENTITY_LOCALIZATION_CONFIG_KEY, POOL_LOCALIZATION_CONFIG_KEY } from '../../../utils/gameDataI18n.js';
import { DOMAIN_LEGAL_CONFIG_KEY } from '../../../utils/siteLegalConfig.js';
import {
  buildHomeVersionTimelineEditorPreview,
  createHomeVersionTimelineRows,
  serializeHomeVersionTimelineRows,
  validateHomeVersionTimelineRows,
} from '../../../utils/homeVersionTimelineEditor.js';
import VirtualizedList from '../VirtualizedList';
import { PanelSection, PanelToolbarButton } from './shared/PanelUi.jsx';

const CATEGORY_META = {
  legal: { label: '法律合规', icon: Scale, color: 'text-red-600 dark:text-red-400' },
  social: { label: '社交链接', icon: Link, color: 'text-blue-600 dark:text-blue-400' },
  content: { label: '运营内容', icon: FileText, color: 'text-amber-600 dark:text-amber-400' },
  alert: { label: '系统提醒', icon: AlertTriangle, color: 'text-orange-600 dark:text-orange-400' },
  general: { label: '通用配置', icon: Globe, color: 'text-zinc-600 dark:text-zinc-400' },
};

const FIELD_INPUT_CLASS = 'w-full rounded-none border border-zinc-300 bg-white px-2 py-1.5 text-xs text-slate-700 transition-colors focus:border-amber-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200';
const FIELD_INPUT_MONO_CLASS = `${FIELD_INPUT_CLASS} font-mono`;

const VIRTUAL_CONFIG_ITEMS = [
  {
    key: DOMAIN_LEGAL_CONFIG_KEY,
    label: '按域名备案信息',
    category: 'legal',
    value: JSON.stringify({
      'ef.nepst.cn': {
        icp_number: '',
        icp_url: 'https://beian.miit.gov.cn/',
        police_number: '',
        police_url: 'https://www.beian.gov.cn/'
      }
    }, null, 2),
    format: 'json',
    description: '按当前访问域名选择 ICP 和公安备案号。备用网址未配置独立备案号时保持空白，不会复用主域名备案号。'
  },
  {
    key: POOL_LOCALIZATION_CONFIG_KEY,
    label: '卡池名称本地化',
    category: 'content',
    value: JSON.stringify({
      'pool-id-or-name': {
        'en-US': 'Banner Name',
      }
    }, null, 2),
    format: 'json',
    description: '按卡池 ID 或原始中文名维护手动本地化名称。角色名和武器名不在这里维护。'
  },
  {
    key: ENTITY_LOCALIZATION_CONFIG_KEY,
    label: '角色/武器名称本地化',
    category: 'content',
    value: JSON.stringify({
      'char_or_weapon_id': {
        type: 'character',
        name: '洛茜',
        'zh-CN': '洛茜',
        'en-US': 'Rossi'
      }
    }, null, 2),
    format: 'json',
    description: '用于覆盖 Warfarin 默认词条映射，优先按角色/武器 ID 生效。'
  },
  {
    key: HOME_VERSION_TIMELINE_CONFIG_KEY,
    label: '首页版本时间线',
    category: 'content',
    value: JSON.stringify(DEFAULT_HOME_VERSION_TIMELINE, null, 2),
    format: 'json',
    description: '维护首页下版本倒计时、版本名和后续版本节点。旧的单时间配置会作为兼容兜底。'
  },
  {
    key: HOME_NEXT_VERSION_TARGET_CONFIG_KEY,
    label: '首页下版本倒计时',
    category: 'content',
    value: DEFAULT_HOME_NEXT_VERSION_TARGET_DATE,
    format: 'text',
    description: '控制首页下版本倒计时目标时间，推荐使用带时区的 ISO 8601 时间字符串。'
  }
];

function isJsonConfigItem(item) {
  if (item?.format === 'json') {
    return true;
  }

  if (item?.format === 'text') {
    return false;
  }

  if (item?.key === HOME_NEXT_VERSION_TARGET_CONFIG_KEY) {
    return false;
  }

  return item?.category === 'content' || item?.category === 'alert';
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

function formatAdminDateTime(value) {
  if (!value) {
    return '未设置';
  }

  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    return value;
  }

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

function ConfigKeyTag({ configKey }) {
  return (
    <code className="rounded-none border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
      {configKey}
    </code>
  );
}

function HomeVersionTimelineEditor({ editValue, setEditValue, onSave, onCancel, saving }) {
  const initial = useMemo(() => createHomeVersionTimelineRows(editValue), [editValue]);
  const [rows, setRows] = useState(() => initial.rows);
  const parseError = initial.parseError;

  useEffect(() => {
    setEditValue(serializeHomeVersionTimelineRows(rows));
  }, [rows, setEditValue]);

  const validation = useMemo(() => validateHomeVersionTimelineRows(rows), [rows]);
  const preview = useMemo(() => {
    if (!validation.valid) {
      return null;
    }

    return buildHomeVersionTimelineEditorPreview(rows, {
      now: new Date(),
      locale: 'zh-CN',
    });
  }, [rows, validation.valid]);

  const updateRow = (index, patch) => {
    setRows(prev => prev.map((row, rowIndex) => (
      rowIndex === index ? { ...row, ...patch } : row
    )));
  };

  const addRow = () => {
    setRows(prev => [...prev, createEmptyVersionRow(prev.length)]);
  };

  const removeRow = (index) => {
    setRows(prev => prev.filter((_, rowIndex) => rowIndex !== index));
  };

  return (
    <div className="space-y-3">
      <div className="animate-fade-in-up-small rounded-none border border-amber-200 border-l-2 border-l-amber-500 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-900/60 dark:border-l-amber-400 dark:bg-amber-950/20 dark:text-amber-200">
        这里维护首页版本倒计时和版本节点。旧的“首页下版本倒计时”仍作为兼容兜底；保存本时间线后，首页会优先使用这里的版本数据。
      </div>

      {parseError ? (
        <div className="animate-fade-in-up-small rounded-none border border-red-200 border-l-2 border-l-red-500 bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-700 dark:border-red-900/60 dark:border-l-red-400 dark:bg-red-950/20 dark:text-red-300">
          原始 JSON 解析失败，已载入默认版本节点。保存前请确认下方内容正确。
        </div>
      ) : null}

      <div className="space-y-3">
        {rows.map((row, index) => {
          const rowErrors = validation.rowErrors[index] || [];
          return (
            <div
              key={`version-row-${index}`}
              className="animate-fade-in-up-small border border-zinc-200 bg-white transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
              style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
            >
              <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
                <span className="h-2.5 w-1 bg-amber-500 dark:bg-endfield-yellow" aria-hidden="true"></span>
                <span className="text-xs font-semibold text-slate-700 dark:text-zinc-200">版本节点 {index + 1}</span>
                <label className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-zinc-400">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={event => updateRow(index, { enabled: event.target.checked })}
                    className="h-3.5 w-3.5 rounded-none border-zinc-300 accent-amber-500 focus:ring-amber-500"
                  />
                  启用
                </label>
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  disabled={rows.length <= 1}
                  className="rounded-none p-1 text-red-500 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-red-950/30"
                  title="删除版本节点"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="grid gap-3 p-3 lg:grid-cols-2">
                <label className="space-y-1 text-[11px] font-medium tracking-wider text-slate-500 dark:text-zinc-500">
                  版本 ID
                  <input
                    value={row.id}
                    onChange={event => updateRow(index, { id: event.target.value })}
                    className={FIELD_INPUT_MONO_CLASS}
                    placeholder="pre-summer-2026"
                  />
                </label>

                <label className="space-y-1 text-[11px] font-medium tracking-wider text-slate-500 dark:text-zinc-500">
                  排序
                  <input
                    value={row.order}
                    onChange={event => updateRow(index, { order: event.target.value })}
                    className={FIELD_INPUT_MONO_CLASS}
                    placeholder="10"
                  />
                </label>

                <label className="space-y-1 text-[11px] font-medium tracking-wider text-slate-500 dark:text-zinc-500">
                  中文版本名
                  <input
                    value={row.name}
                    onChange={event => updateRow(index, { name: event.target.value })}
                    className={FIELD_INPUT_CLASS}
                    placeholder="寻遗散记"
                  />
                </label>

                <label className="space-y-1 text-[11px] font-medium tracking-wider text-slate-500 dark:text-zinc-500">
                  英文版本名
                  <input
                    value={row.nameEn}
                    onChange={event => updateRow(index, { nameEn: event.target.value })}
                    className={FIELD_INPUT_CLASS}
                    placeholder="Lost Heirlooms"
                  />
                </label>

                <label className="space-y-1 text-[11px] font-medium tracking-wider text-slate-500 dark:text-zinc-500">
                  开始时间
                  <input
                    value={row.startsAt}
                    onChange={event => updateRow(index, { startsAt: event.target.value })}
                    className={FIELD_INPUT_MONO_CLASS}
                    placeholder="2026-06-05T12:00:00+08:00"
                  />
                </label>

                <label className="space-y-1 text-[11px] font-medium tracking-wider text-slate-500 dark:text-zinc-500">
                  结束时间
                  <input
                    value={row.endsAt}
                    onChange={event => updateRow(index, { endsAt: event.target.value })}
                    className={FIELD_INPUT_MONO_CLASS}
                    placeholder="可留空"
                  />
                </label>

                <label className="space-y-1 text-[11px] font-medium tracking-wider text-slate-500 dark:text-zinc-500 lg:col-span-2">
                  包含卡池 ID
                  <textarea
                    value={row.poolIdsText}
                    onChange={event => updateRow(index, { poolIdsText: event.target.value })}
                    rows={2}
                    className={`${FIELD_INPUT_MONO_CLASS} resize-y`}
                    placeholder="每行一个，或用逗号分隔"
                  />
                </label>
              </div>

              {rowErrors.length > 0 ? (
                <div className="border-t border-red-100 bg-red-50 px-3 py-1.5 text-[11px] text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
                  {rowErrors.join('；')}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addRow}
        className="inline-flex items-center gap-1.5 rounded-none border border-dashed border-zinc-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-amber-500 hover:text-amber-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-endfield-yellow dark:hover:text-endfield-yellow"
      >
        <Plus size={14} />
        添加版本节点
      </button>

      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div className="animate-fade-in-up-small border border-zinc-200 bg-zinc-50 px-3 py-2 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:border-zinc-700">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
            <span className="h-2.5 w-1 bg-amber-500 dark:bg-endfield-yellow" aria-hidden="true"></span>
            首页预览
          </div>
          {preview ? (
            <div className="mt-2 space-y-1 text-xs text-slate-700 dark:text-zinc-300">
              <div>当前版本：{preview.currentVersion?.displayName || '无'}</div>
              <div>下个版本：{preview.nextVersion?.displayName || '无'}</div>
              <div>倒计时目标：{preview.countdownVersion?.displayName || '无'} / {formatAdminDateTime(preview.targetAt)}</div>
              <div>版本节点：{preview.versions.length} 个</div>
            </div>
          ) : (
            <div className="mt-2 text-xs text-red-500">修复校验错误后才能生成预览。</div>
          )}
        </div>

        <div className="animate-fade-in-up-small border border-zinc-200 bg-zinc-50 px-3 py-2 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:border-zinc-700" style={{ animationDelay: '40ms' }}>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
            <span className="h-2.5 w-1 bg-amber-500 dark:bg-endfield-yellow" aria-hidden="true"></span>
            JSON 预览
          </div>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-slate-500 dark:text-zinc-500">
            {serializeHomeVersionTimelineRows(rows)}
          </pre>
        </div>
      </div>

      {!validation.valid ? (
        <div className="animate-fade-in-up-small rounded-none border border-red-200 border-l-2 border-l-red-500 bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-700 dark:border-red-900/60 dark:border-l-red-400 dark:bg-red-950/20 dark:text-red-300">
          {validation.errors.join('；')}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <div className="flex-1" />
        <PanelToolbarButton
          tone="primary"
          onClick={onSave}
          disabled={saving || !validation.valid}
        >
          <Save size={14} />
          {saving ? '...' : '保存'}
        </PanelToolbarButton>
        <button
          onClick={onCancel}
          className="rounded-none px-2 py-1.5 text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

function EditableConfigItem({ item, isJsonField, editValue, setEditValue, onSave, onCancel, saving }) {
  const jsonError = useMemo(() => {
    if (!isJsonField) return null;
    try {
      JSON.parse(editValue);
      return null;
    } catch (e) {
      return e.message;
    }
  }, [isJsonField, editValue]);

  const formatJson = () => {
    try {
      setEditValue(JSON.stringify(JSON.parse(editValue), null, 2));
    } catch { /* ignore */ }
  };

  if (item.key === HOME_VERSION_TIMELINE_CONFIG_KEY) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <ConfigKeyTag configKey={item.key} />
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{item.label}</span>
        </div>
        <HomeVersionTimelineEditor
          editValue={editValue}
          setEditValue={setEditValue}
          onSave={onSave}
          onCancel={onCancel}
          saving={saving}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <ConfigKeyTag configKey={item.key} />
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{item.label}</span>
      </div>
      {isJsonField ? (
        <>
          <textarea
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            rows={Math.min(Math.max(editValue.split('\n').length, 4), 16)}
            className={`${FIELD_INPUT_MONO_CLASS} resize-y px-3 py-2`}
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Escape') onCancel();
            }}
          />
          {jsonError && (
            <p className="text-[11px] text-red-500 dark:text-red-400">JSON 格式错误：{jsonError}</p>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={formatJson}
              disabled={!!jsonError}
              className="rounded-none px-2 py-1 text-[11px] text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            >
              格式化 JSON
            </button>
            <div className="flex-1" />
            <PanelToolbarButton
              tone="primary"
              onClick={onSave}
              disabled={saving || !!jsonError}
            >
              <Save size={14} />
              {saving ? '...' : '保存'}
            </PanelToolbarButton>
            <button
              onClick={onCancel}
              className="rounded-none px-2 py-1.5 text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <X size={14} />
            </button>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            className={`${FIELD_INPUT_MONO_CLASS} flex-1 px-3 py-2`}
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') onSave();
              if (e.key === 'Escape') onCancel();
            }}
          />
          <PanelToolbarButton
            tone="primary"
            onClick={onSave}
            disabled={saving}
            className="py-2"
          >
            <Save size={14} />
            {saving ? '...' : '保存'}
          </PanelToolbarButton>
          <button
            onClick={onCancel}
            className="rounded-none px-2 py-2 text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 站点配置管理面板
 * 编辑备案号、作者信息、版本号等从数据库读取的站点配置
 */
const SiteConfigPanel = ({ showToast, configAdapter = null }) => {
  const [configItems, setConfigItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  // 从数据库加载完整配置（含 label, category）
  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const data = configAdapter
          ? await configAdapter.loadItems()
          : await loadAdminSiteConfigItems();
        const mergedItems = [...data];
        VIRTUAL_CONFIG_ITEMS.forEach((virtualItem) => {
          if (!mergedItems.some((item) => item.key === virtualItem.key)) {
            mergedItems.push({
              ...virtualItem,
              updated_at: null,
            });
          }
        });
        setConfigItems(mergedItems);
      } catch (error) {
        showToast?.(`站点配置加载失败: ${error.message}`, 'error');
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [configAdapter, showToast]);

  const startEdit = (item) => {
    setEditingKey(item.key);
    setEditValue(item.value);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditValue('');
  };

  const handleSave = async () => {
    if (!editingKey) return;
    setSaving(true);
    try {
      const currentItem = configItems.find((item) => item.key === editingKey);
      const metadata = { label: currentItem?.label, category: currentItem?.category };
      const success = configAdapter
        ? await configAdapter.updateConfig(editingKey, editValue, metadata)
        : await useSiteConfigStore.getState().updateConfig(editingKey, editValue, metadata);
      if (success) {
        setConfigItems(prev => prev.map(item =>
          item.key === editingKey ? { ...item, value: editValue, updated_at: new Date().toISOString() } : item
        ));
        showToast?.('配置已更新', 'success');
        cancelEdit();
      } else {
        const updateError = configAdapter?.getError?.() || useSiteConfigStore.getState().updateError;
        showToast?.(`保存失败: ${updateError?.message || '请检查登录状态和超级管理员权限'}`, 'error');
      }
    } catch (error) {
      showToast?.(`保存失败: ${error.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-fade-in-up flex flex-col items-center justify-center gap-3 border border-zinc-200 bg-white py-16 text-slate-400 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500">
        <Settings size={20} className="animate-spin" />
        <span className="text-xs uppercase tracking-widest">加载站点配置...</span>
      </div>
    );
  }

  // 按 category 分组
  const grouped = Object.create(null);
  configItems.forEach(item => {
    const cat = item.category || 'general';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  });

  const categoryOrder = ['alert', 'content', 'legal', 'social', 'general'];

  const renderConfigItem = (item, index = 0) => {
    const isJsonField = isJsonConfigItem(item);
    const isEditing = editingKey === item.key;

    return (
      <div
        key={item.key}
        className={`animate-fade-in-up-small px-3 transition-colors ${isEditing ? 'bg-zinc-50/80 py-3 dark:bg-zinc-800/40' : 'py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/30'}`}
        style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
      >
        {isEditing ? (
          <EditableConfigItem
            item={item}
            isJsonField={isJsonField}
            editValue={editValue}
            setEditValue={setEditValue}
            onSave={handleSave}
            onCancel={cancelEdit}
            saving={saving}
          />
        ) : (
          <div className="group flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{item.label}</span>
                <ConfigKeyTag configKey={item.key} />
              </div>
              {isJsonField ? (
                <>
                  <p className="max-w-full truncate font-mono text-xs text-slate-500 dark:text-zinc-500">
                    {item.value ? `JSON (${item.value.length} 字符)` : '(空)'}
                  </p>
                  {item.description ? (
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-400 dark:text-zinc-500">
                      {item.description}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="truncate font-mono text-xs text-slate-600 dark:text-zinc-400">{item.value || '(空)'}</p>
              )}
            </div>
            <button
              onClick={() => startEdit(item)}
              className="shrink-0 rounded-none border border-transparent p-1.5 text-amber-600 transition-all hover:border-amber-200 hover:bg-amber-50 dark:text-endfield-yellow dark:hover:border-amber-900/70 dark:hover:bg-amber-950/30"
              title="编辑"
              aria-label={`编辑${item.label}`}
            >
              <Edit2 size={14} />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="animate-fade-in-up flex flex-wrap items-center justify-between gap-3 border border-l-4 border-zinc-200 border-l-amber-500 bg-white px-3 py-2.5 shadow-sm dark:border-zinc-800 dark:border-l-endfield-yellow dark:bg-zinc-900">
        <div className="flex min-w-0 items-center gap-3">
          <Settings size={18} className="shrink-0 text-amber-500 dark:text-endfield-yellow" />
          <p className="min-w-0 text-xs text-slate-500 dark:text-zinc-400">
            管理站点显示的备案号、作者信息、版本号等配置。修改后即时生效。
          </p>
        </div>
        <span className="shrink-0 font-mono text-[11px] text-slate-400 dark:text-zinc-500">{configItems.length} 项配置</span>
      </div>

      {categoryOrder.map((cat, catIndex) => {
        const items = grouped[cat];
        if (!items || items.length === 0) return null;
        const meta = CATEGORY_META[cat] || CATEGORY_META.general;

        return (
          <PanelSection
            key={cat}
            title={meta.label}
            icon={meta.icon}
            delay={60 + catIndex * 60}
            bodyClassName="p-0"
            action={(
              <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">{items.length} 项</span>
            )}
          >
            {items.some(item => item.key === editingKey) ? (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {items.map(renderConfigItem)}
              </div>
            ) : (
              <VirtualizedList
                items={items}
                getKey={(item) => item.key}
                itemHeight={118}
                maxHeight={520}
                className="divide-y divide-zinc-100 dark:divide-zinc-800"
                renderItem={renderConfigItem}
              />
            )}
          </PanelSection>
        );
      })}
    </div>
  );
};

export default SiteConfigPanel;
