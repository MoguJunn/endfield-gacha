import React, { useState } from 'react';
import { Save, Wrench } from 'lucide-react';
import { MAINTENANCE_CONFIG_KEY, MAINTENANCE_SERVICES, normalizeMaintenanceNotice } from '../../../../shared/siteMaintenance.js';
import { MaintenanceNotice } from '../../layout/SiteMaintenanceBanner.jsx';
import useMaintenanceStore from '../../../stores/useMaintenanceStore.js';
import useSiteConfigStore from '../../../stores/useSiteConfigStore.js';
import { PanelSection, PanelToolbarButton } from './shared/PanelUi.jsx';

const FIELD = 'w-full border border-zinc-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-amber-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100';

export default function SiteMaintenanceSettings({ value, configAdapter, onSaved, showToast }) {
  const [draft, setDraft] = useState(() => normalizeMaintenanceNotice(value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const patch = change => { setDraft(previous => ({ ...previous, ...change })); setMessage(''); setError(''); };
  const save = async () => {
    setSaving(true); setError(''); setMessage('');
    try {
      const notice = normalizeMaintenanceNotice(draft);
      const serialized = JSON.stringify(notice);
      const meta = { label: '维护模式与横幅', category: 'alert' };
      const ok = configAdapter ? await configAdapter.updateConfig(MAINTENANCE_CONFIG_KEY, serialized, meta)
        : await useSiteConfigStore.getState().updateConfig(MAINTENANCE_CONFIG_KEY, serialized, meta);
      if (!ok) throw new Error(configAdapter?.getError?.()?.message || useSiteConfigStore.getState().updateError?.message || '请检查超级管理员权限和数据库连接');
      if (!configAdapter) useMaintenanceStore.getState().applyNotice(notice);
      setDraft(notice);
      onSaved?.(serialized);
      setMessage(notice.enabled ? '维护通知已开启，其他页面将在约1～2分钟内更新。' : '维护模式已关闭，其他页面将在约1～2分钟内更新。');
      showToast?.('维护配置已保存', 'success');
    } catch (e) { setError(`维护配置保存失败：${e.message}`); }
    finally { setSaving(false); }
  };
  return <PanelSection title="维护模式与横幅" icon={Wrench} bodyClassName="p-3">
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-slate-500 dark:text-zinc-400">开启后在桌面、手机及访问验证页展示维护提示。该模式用于说明服务状态，保留可用页面和本地功能。请在数据库暂停前开启，恢复后关闭。</p>
      <fieldset disabled={saving} className="space-y-4 disabled:opacity-60">
        <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-800 dark:text-zinc-200">
          {[['enabled', '开启维护模式'], ['showAffectedServices', '展示受影响服务'], ['allowCollapse', '允许用户收起横幅']].map(([key, label]) =>
            <label key={key} className="inline-flex items-center gap-2"><input type="checkbox" checked={draft[key]} onChange={e => patch({ [key]: e.target.checked })} className="accent-amber-500" />{label}</label>)}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {[['title', '维护标题'], ['titleEn', '维护标题（英文）'], ['period', '维护时间说明'], ['periodEn', '维护时间说明（英文）']].map(([key, label]) =>
            <label key={key} className="space-y-1 text-xs text-slate-600 dark:text-zinc-300"><span>{label}</span><input maxLength={200} className={FIELD} value={draft[key]} onChange={e => patch({ [key]: e.target.value })} /></label>)}
          {[['message', '维护说明'], ['messageEn', '维护说明（英文）']].map(([key, label]) =>
            <label key={key} className="space-y-1 text-xs text-slate-600 dark:text-zinc-300"><span>{label}</span><textarea maxLength={3000} rows={4} className={FIELD} value={draft[key]} onChange={e => patch({ [key]: e.target.value })} /></label>)}
        </div>
        <fieldset className="space-y-2"><legend className="mb-2 text-xs font-semibold text-slate-600 dark:text-zinc-300">受影响服务（按本次维护选择）</legend>
          <div className="grid gap-2 text-xs text-slate-700 dark:text-zinc-300 md:grid-cols-2">{MAINTENANCE_SERVICES.map(service =>
            <label key={service.id} className="inline-flex items-start gap-2"><input type="checkbox" className="mt-0.5 accent-amber-500" checked={draft.affectedServices.includes(service.id)}
              onChange={e => patch({ affectedServices: e.target.checked ? [...draft.affectedServices, service.id] : draft.affectedServices.filter(id => id !== service.id) })} />{service.label}</label>)}</div>
        </fieldset>
      </fieldset>
      <div><p className="mb-2 text-xs text-slate-500">横幅预览{!draft.enabled ? '（当前维护模式关闭，访客看不到横幅）' : ''}</p><MaintenanceNotice key={JSON.stringify(draft)} notice={{ ...draft, enabled: true }} compact /></div>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {message && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}
      <PanelToolbarButton tone="primary" onClick={save} disabled={saving}><Save size={14} />{saving ? '保存中…' : '保存维护配置'}</PanelToolbarButton>
    </div>
  </PanelSection>;
}
