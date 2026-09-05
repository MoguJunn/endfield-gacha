import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Code2,
  Gamepad2,
  Home,
  Info,
  Layers,
  Link2,
  LogIn,
  LogOut,
  Menu,
  MessageSquare,
  Monitor,
  Moon,
  PanelsTopLeft,
  Settings,
  Shield,
  Sun,
  User,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import { useTheme } from '../../contexts/ThemeContext';
import useAuthStore from '../../stores/useAuthStore.js';
import { buildUsernameHandle } from '../../utils/usernameValidation.js';
import { STORAGE_KEYS, markAsViewed } from '../../utils/storageUtils.js';
import LocaleSwitcher from '../common/LocaleSwitcher.jsx';
import './homeLandingDemo.css';
import '../app/desktopPageLayout.css';

// A navigation disclosure contains normal links, so Tab follows the browser's
// standard link order. It is deliberately not an ARIA application menu.
export default function HomeLandingHeader({
  mobile = false,
  hasNewAnnouncement = false,
  unreadTicketsCount = 0,
  setUnreadTicketsCount,
  onOpenMessages,
}) {
  const { isEnglish } = useI18n();
  const { themeMode, setThemeMode } = useTheme();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore((s) => s.userRole);
  const openAuthModal = useAuthStore((s) => s.openAuthModal);
  const signOut = useAuthStore((s) => s.signOut);
  const [expanded, setExpanded] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const root = useRef(null);
  const tt = (zh, en) => (isEnglish ? en : zh);
  const home = mobile ? '/m' : '/';
  const page = (desktop, phone = desktop) => `${mobile ? `/m/${phone}` : `/${desktop}`}?home-demo=unified`;
  const panel = (id) => `${home}?home-demo=unified&panel=${id}`;
  const username = buildUsernameHandle(user, user?.email?.split('@')[0]);
  const identity = role === 'super_admin' ? 'SUPER-ENDMIN' : role === 'admin' ? 'ENDMIN' : 'GUEST';
  const themeOptions = [
    { value: 'system', label: tt('跟随系统', 'Follow system'), icon: Monitor },
    { value: 'light', label: tt('浅色', 'Light'), icon: Sun },
    { value: 'dark', label: tt('深色', 'Dark'), icon: Moon },
  ];
  const currentTheme = themeOptions.find((option) => option.value === themeMode) || themeOptions[0];
  const close = () => {
    setExpanded(null);
    setMobileOpen(false);
  };
  const groups = [
    {
      id: 'analysis',
      icon: BarChart3,
      title: tt('分析', 'Analysis'),
      items: [
        [
          BarChart3,
          mobile ? tt('卡池分析', 'Banner analysis') : tt('个人卡池分析', 'Personal banner analysis'),
          mobile ? tt('保底进度与寻访明细', 'Pity and pull history') : tt('个人概览、保底进度与寻访明细', 'Your overview, pity and pull history'),
          page('dashboard', 'details'),
        ],
        [
          Layers,
          mobile ? tt('统计汇总', 'Statistics') : tt('全服统计', 'Global statistics'),
          mobile ? tt('个人生涯与全服数据', 'Career and community data') : tt('全服样本、出货分布与角色图鉴', 'Community samples, drop rates and character catalog'),
          page('summary', 'overview'),
        ],
        ...(mobile
          ? [
              [
                Activity,
                tt('全服统计', 'Global statistics'),
                tt('查看全服样本', 'Explore the community'),
                page('summary', 'stats'),
              ],
            ]
          : []),
      ],
    },
    {
      id: 'tools',
      icon: Wrench,
      title: tt('工具', 'Tools'),
      items: [
        [Gamepad2, tt('抽卡模拟器', 'Simulator'), tt('试试下一次寻访', 'Try your next pull'), page('simulator')],
        [
          CalendarDays,
          tt('完整日程', 'Banner schedule'),
          tt('卡池轮换与版本节点', 'Banners and version dates'),
          panel('schedule'),
          'dialog',
        ],
        [
          Layers,
          tt('卡池机制', 'Pool rules'),
          tt('概率、保底与继承', 'Rates, pity and carry-over'),
          panel('mechanics'),
          'dialog',
        ],
        [
          Link2,
          tt('友情链接', 'Useful links'),
          tt('地图、规划与实用工具', 'Maps, planners and utilities'),
          panel('tools'),
          'dialog',
        ],
      ],
    },
    {
      id: 'help',
      icon: CircleHelp,
      title: tt('帮助', 'Help'),
      items: [
        [Bell, tt('公告中心', 'Announcements'), tt('站点通知与官方消息', 'Site and official news'), panel('bulletin'), 'dialog'],
        [BookOpen, tt('使用指南', 'Getting started'), tt('从导入到备份', 'From import to backup'), panel('guide'), 'dialog'],
        [
          Users,
          tt('社区与支持', 'Community & support'),
          tt('安全说明、交流群与捐赠', 'Safety, community and donations'),
          panel('support'),
          'dialog',
        ],
        ...(mobile ? [[
          MessageSquare,
          tt('工单反馈', 'Support tickets'),
          tt('使用问题与建议', 'Questions and suggestions'),
          page('tickets'),
        ]] : []),
        [Code2, tt('开发者 API', 'Developer API'), tt('集成文档', 'Integration documentation'), page('developer-api')],
        [Info, tt('关于本站', 'About'), tt('项目与贡献者', 'Project and contributors'), page('about')],
        ...(!user ? [[Settings, tt('网站设置', 'Site settings'), tt('数据与显示偏好', 'Data and display preferences'), page('settings')]] : []),
        [
          Activity,
          tt('服务状态', 'Service status'),
          tt('查看站点可用性', 'Check service availability'),
          'https://endfield-status-page.vercel.app/',
        ],
      ],
    },
  ];

  useEffect(() => {
    const outside = (event) => {
      if (!root.current?.contains(event.target)) {
        setExpanded(null);
        setMobileOpen(false);
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);

  const disclosure = (group) => (
    <div className="hl-disclosure" key={group.id}>
      <button
        type="button"
        className={`hl-nav-trigger ${!mobile && group.id === 'account' ? 'hl-account-trigger' : ''}`}
        aria-expanded={expanded === group.id}
        aria-controls={`hl-menu-${group.id}`}
        aria-label={!mobile && group.id === 'account' ? `${group.title}: ${username}, ${identity}` : undefined}
        title={!mobile && group.id === 'account' ? username : undefined}
        onClick={() => setExpanded(expanded === group.id ? null : group.id)}
      >
        {React.createElement(group.icon, { size: 16 })}
        {!mobile && group.id === 'account' ? (
          <span className="hl-account-identity">
            <strong>{username}</strong>
            <small>{identity}</small>
          </span>
        ) : group.title}
        <ChevronDown size={12} />
        {group.id === 'help' && (hasNewAnnouncement || (mobile && unreadTicketsCount > 0)) ? <i className="hl-unread" /> : null}
      </button>
      {expanded === group.id ? (
        <div id={`hl-menu-${group.id}`} className="hl-dropdown">
          <div className="hl-menu-label">{group.title}</div>
          {group.items.map(([icon, label, hint, href, kind]) => {
            const opensDialog = !mobile && kind === 'dialog';
            const content = (
              <>
                {React.createElement(icon, { size: 17 })}
                <span className="hl-menu-item-copy">
                  <span className="hl-menu-item-title">
                    <strong>{label}</strong>
                    {opensDialog ? (
                      <span className="hl-dialog-tag">
                        <PanelsTopLeft size={11} aria-hidden="true" />
                        {tt('弹窗', 'Dialog')}
                      </span>
                    ) : null}
                  </span>
                  <small>{hint}</small>
                </span>
              </>
            );
            return href.startsWith('https:') ? (
              <a key={label} href={href} target="_blank" rel="noreferrer" onClick={close}>
                {content}
              </a>
            ) : (
              <Link key={label} to={href} aria-haspopup={opensDialog ? 'dialog' : undefined} onClick={(event) => {
                close();
                if (!mobile && onOpenMessages && href === panel('bulletin')) {
                  event.preventDefault();
                  onOpenMessages('site');
                }
              }}>
                {content}
              </Link>
            );
          })}
          {group.id === 'account' ? (
            <button
              type="button"
              onClick={() => {
                close();
                void signOut();
              }}
            >
              <LogOut size={17} />
              <span>
                <strong>{tt('退出登录', 'Sign out')}</strong>
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return (
    <header
      ref={root}
      className={`hl-header hl-theme ${!mobile ? 'hl-header--desktop' : ''} ${mobileOpen ? 'hl-header--open' : ''}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        const trigger = root.current?.querySelector(
          expanded ? `[aria-controls="hl-menu-${expanded}"]` : '[aria-controls="hl-nav"]'
        );
        close();
        trigger?.focus();
      }}
    >
      <div className="hl-header-inner">
        <Link to={`${home}?home-demo=unified`} className="hl-brand" onClick={close} aria-label={tt('返回首页', 'Home')}>
          <span>
            <BarChart3 size={23} strokeWidth={2.5} />
          </span>
          <div>
            <strong>
              ENDFIELD <em>GACHA</em>
            </strong>
            <small>{tt('终末地抽卡观测站', 'GACHA OBSERVATORY')}</small>
          </div>
        </Link>
        <button
          type="button"
          className="hl-mobile-toggle hl-nav-trigger"
          aria-expanded={mobileOpen}
          aria-controls="hl-nav"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X size={17} /> : <Menu size={17} />}
          {tt('菜单', 'Menu')}
        </button>
        <nav id="hl-nav" className="hl-nav" aria-label={tt('主导航', 'Main navigation')}>
          <Link
            className="hl-nav-trigger"
            aria-current={location.pathname === home ? 'page' : undefined}
            to={`${home}?home-demo=unified`}
            onClick={close}
          >
            <Home size={16} />
            {tt('首页', 'Home')}
          </Link>
          {groups.map(disclosure)}
          {!mobile ? (
            <Link
              className="hl-nav-trigger hl-tickets-trigger"
              to={page('tickets')}
              aria-current={location.pathname === '/tickets' ? 'page' : undefined}
              aria-label={unreadTicketsCount > 0
                ? tt(`工单反馈，${unreadTicketsCount} 条未读`, `Support tickets, ${unreadTicketsCount} unread`)
                : tt('工单反馈', 'Support tickets')}
              onClick={() => {
                close();
                markAsViewed(STORAGE_KEYS.TICKETS_LAST_VIEWED);
                setUnreadTicketsCount?.(0);
              }}
            >
              <MessageSquare size={16} />
              {tt('工单', 'Tickets')}
              {unreadTicketsCount > 0 ? (
                <span className="hl-ticket-count" aria-hidden="true">
                  {unreadTicketsCount > 99 ? '99+' : unreadTicketsCount}
                </span>
              ) : null}
            </Link>
          ) : null}
          {!mobile && user && role === 'super_admin' ? (
            <Link
              className="hl-nav-trigger hl-admin-trigger"
              to={page('admin')}
              aria-current={location.pathname === '/admin' ? 'page' : undefined}
              aria-label={tt('管理后台', 'Administration')}
              onClick={() => {
                close();
                markAsViewed(STORAGE_KEYS.ADMIN_LAST_VIEWED);
              }}
            >
              <Shield size={16} />
              {tt('管理', 'Admin')}
            </Link>
          ) : null}
          <div className="hl-display-options">
            <LocaleSwitcher compact />
            {mobile ? <button
              type="button"
              className="hl-nav-trigger"
              onClick={() => setThemeMode(document.documentElement.classList.contains('dark') ? 'light' : 'dark')}
            >
              <Sun size={15} className="hl-sun" />
              <Moon size={15} className="hl-moon" />
              {tt('主题', 'Theme')}
            </button> : (
              <div className="hl-disclosure hl-theme-disclosure">
                <button
                  type="button"
                  className="hl-nav-trigger"
                  aria-expanded={expanded === 'theme'}
                  aria-controls="hl-menu-theme"
                  title={`${tt('主题', 'Theme')}: ${currentTheme.label}`}
                  onClick={() => setExpanded(expanded === 'theme' ? null : 'theme')}
                >
                  {React.createElement(currentTheme.icon, { size: 16 })}
                  {tt('主题', 'Theme')}
                  <ChevronDown size={12} />
                </button>
                {expanded === 'theme' ? (
                  <div id="hl-menu-theme" className="hl-dropdown hl-theme-menu" role="group" aria-label={tt('主题模式', 'Theme mode')}>
                    <div className="hl-menu-label">{tt('主题模式', 'Theme mode')}</div>
                    {themeOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={themeMode === option.value}
                        onClick={() => {
                          setThemeMode(option.value);
                          close();
                          root.current?.querySelector('[aria-controls="hl-menu-theme"]')?.focus();
                        }}
                      >
                        {React.createElement(option.icon, { size: 16 })}
                        <span>{option.label}</span>
                        {themeMode === option.value ? <Check size={15} aria-hidden="true" /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </nav>
        {user ? (
          disclosure({
            id: 'account',
            title: tt('账号', 'Account'),
            icon: User,
            items: [
              [
                Settings,
                tt('账号设置', 'Account settings'),
                tt('账号、数据与偏好', 'Account, data and preferences'),
                page('settings'),
              ],
              ...(mobile && role === 'super_admin'
                ? [
                    [
                      Shield,
                      tt('管理后台', 'Administration'),
                      tt('内容与站点管理', 'Content and site management'),
                      page('admin'),
                    ],
                  ]
                : []),
            ],
          })
        ) : (
          <button
            type="button"
            className="hl-login"
            onClick={() => {
              close();
              openAuthModal();
            }}
          >
            <LogIn size={15} />
            {tt('登录', 'Sign in')}
          </button>
        )}
      </div>
    </header>
  );
}
