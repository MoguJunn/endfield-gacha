import React, { lazy, Suspense, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BarChart3, LayoutDashboard, LogIn, PanelLeftClose, PanelLeftOpen, PenLine } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import useAuthStore from '../../stores/useAuthStore.js';
import { readBooleanStorageValue, writeBooleanStorageValue } from '../../utils/storageUtils.js';
import PersonalDataBoundary from './PersonalDataBoundary.jsx';
import WorkbenchBetaBadge from '../../features/import/WorkbenchBetaBadge.jsx';
import './desktopPageLayout.css';

const SummaryView = lazy(() => import('../SummaryView.jsx'));
const SIDEBAR_COLLAPSED_KEY = 'desktop_personal_sidebar_collapsed';

export default function DesktopPersonalWorkspace({ children, user, onRetryPersonalData }) {
  const { isEnglish } = useI18n();
  const location = useLocation();
  const openAuthModal = useAuthStore((s) => s.openAuthModal);
  const [collapsed, setCollapsed] = useState(() => readBooleanStorageValue(SIDEBAR_COLLAPSED_KEY));
  const overview = new URLSearchParams(location.search).get('view') === 'overview';
  const workbench = location.pathname === '/data-workbench';
  const tt = (zh, en) => (isEnglish ? en : zh);
  const toggleLabel = collapsed ? tt('展开个人导航', 'Expand personal navigation') : tt('收起个人导航', 'Collapse personal navigation');
  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeBooleanStorageValue(SIDEBAR_COLLAPSED_KEY, next);
  };
  const sections = [
    { id: 'overview', label: tt('个人概览', 'Personal overview'), icon: LayoutDashboard },
    { id: 'banners', label: tt('卡池分析', 'Banner analysis'), icon: BarChart3 },
    { id: 'workbench', label: tt('导入／修改', 'Import / edit'), icon: PenLine },
  ];
  return (
    <div className="dp-personal-workspace">
      <div className={`dp-personal-navigation ${collapsed ? 'dp-personal-navigation--collapsed' : ''}`}>
        <aside className="dp-personal-sidebar" aria-label={tt('个人分析菜单', 'Personal analysis menu')}>
          <div className="dp-personal-sidebar-heading">
            <h2>{tt('个人卡池分析', 'Personal analysis')}</h2>
            <button
              type="button"
              className="dp-sidebar-toggle"
              aria-label={toggleLabel}
              title={toggleLabel}
              aria-expanded={!collapsed}
              aria-controls="dp-personal-nav"
              onClick={toggleSidebar}
            >
              {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
          </div>
          <nav id="dp-personal-nav" aria-label={tt('个人分析二级导航', 'Personal analysis navigation')}>
            {sections.map(({ id, label, icon }) => (
              <Link
                key={id}
                to={id === 'workbench' ? '/data-workbench' : `/dashboard${id === 'overview' ? '?view=overview' : ''}`}
                aria-current={(workbench ? id === 'workbench' : id !== 'workbench' && overview === (id === 'overview')) ? 'page' : undefined}
                aria-label={id === 'workbench' ? `${label} · ${tt('测试版', 'BETA')}` : label}
                title={id === 'workbench' ? `${label} · ${tt('测试版', 'BETA')}` : label}
              >
                {React.createElement(icon, { size: 16 })}<span className="inline-flex items-center gap-2">{label}{id === 'workbench' && <WorkbenchBetaBadge />}</span>
              </Link>
            ))}
          </nav>
        </aside>
      </div>
      <div className="dp-personal-content">
        {!workbench && <header className="dp-workspace-heading">
          <h1>{overview ? tt('个人概览', 'Personal overview') : tt('个人卡池分析', 'Personal banner analysis')}</h1>
          <p>{overview
            ? tt('查看手气走势、抽卡高光与个人统计。', 'Your luck trends, pull highlights and personal statistics.')
            : tt('选择游戏账号与卡池，查看保底进度和寻访记录。', 'Choose an account and banner to view pity progress and pull history.')}</p>
        </header>}
        {overview && !workbench ? user ? (
          <PersonalDataBoundary user={user} onRetry={onRetryPersonalData}>
            <Suspense fallback={<p className="p-8 text-center text-sm text-zinc-500">{tt('正在加载个人概览…', 'Loading personal overview…')}</p>}>
              <SummaryView lockedDataSource="local" />
            </Suspense>
          </PersonalDataBoundary>
        ) : (
          <div className="border border-zinc-200 bg-white p-10 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="mb-5 text-sm text-zinc-500">{tt('登录后查看你的个人寻访概览', 'Sign in to view your personal overview')}</p>
            <button type="button" onClick={openAuthModal} className="inline-flex items-center gap-2 bg-endfield-yellow px-5 py-3 text-sm font-bold text-black">
              <LogIn size={16} />{tt('登录 / 导入', 'Sign in / import')}
            </button>
          </div>
        ) : children}
      </div>
    </div>
  );
}
