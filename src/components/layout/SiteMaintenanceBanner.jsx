import React, { useEffect, useId, useState } from 'react';
import { ChevronDown, ChevronUp, Wrench } from 'lucide-react';
import useMaintenanceStore from '../../stores/useMaintenanceStore.js';
import { useI18n } from '../../i18n/index.js';
import { MAINTENANCE_SERVICES } from '../../../shared/siteMaintenance.js';

export function MaintenanceNotice({ notice, english = false, compact = false }) {
  const [collapsed, setCollapsed] = useState(false);
  const id = useId();
  if (!notice.enabled) return null;
  const title = english ? notice.titleEn : notice.title;
  const expanded = !notice.allowCollapse || !collapsed;
  return <section aria-label={english ? 'Service maintenance' : '服务维护通知'}
    className="relative z-20 w-full shrink-0 border-y border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
    <div className={`mx-auto max-w-screen-2xl px-4 ${compact ? 'py-2' : 'py-3 sm:px-6'}`}>
      <div className="flex items-start gap-2">
        <Wrench size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 text-sm leading-relaxed" role="status">
          <strong>{title}</strong>
          <span className="ml-2 inline-block text-xs opacity-80">{english ? notice.periodEn : notice.period}</span>
        </div>
        {notice.allowCollapse && <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setCollapsed(!collapsed)}
          className="inline-flex min-h-8 shrink-0 items-center gap-1 border border-amber-400 px-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-amber-700">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {english ? expanded ? 'Collapse' : 'Details' : expanded ? '收起' : '查看详情'}
        </button>}
      </div>
      {expanded && <div id={id} className="mt-2 max-h-[30dvh] overflow-y-auto break-words text-xs leading-relaxed sm:text-sm">
        <p className="whitespace-pre-line">{english ? notice.messageEn : notice.message}</p>
        {notice.showAffectedServices && notice.affectedServices.length > 0 && <details className="mt-2">
          <summary className="cursor-pointer font-semibold">{english ? 'Services that may be affected' : '可能受影响的服务'}</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{MAINTENANCE_SERVICES.filter(service => notice.affectedServices.includes(service.id))
            .map(service => <li key={service.id}>{english ? service.labelEn : service.label}</li>)}</ul>
        </details>}
      </div>}
    </div>
  </section>;
}

export default function SiteMaintenanceBanner() {
  const notice = useMaintenanceStore(state => state.notice);
  const refresh = useMaintenanceStore(state => state.refresh);
  const { isEnglish } = useI18n();
  useEffect(() => {
    const check = () => { if (!document.hidden) void refresh(); };
    check();
    const timer = window.setInterval(check, 60000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check); };
  }, [refresh]);
  return <MaintenanceNotice notice={notice} english={isEnglish} />;
}
