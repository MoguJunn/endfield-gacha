import React, { Suspense, lazy } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  ChevronRight,
  Database,
  Gift,
  Globe,
  KeyRound,
  Layers,
  Mail,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Settings,
  Shield,
  Star,
  Users,
} from 'lucide-react';
import {
  contributorDemoSandboxAdapters,
  refreshContributorDemoLiveCatalog,
  resetContributorDemoSandbox,
  useContributorDemoSandboxStore,
} from '../../dev/contributorDemoSandboxStore.js';
import { isReservedObjectKey } from '../../utils/publicResourceUrl.js';

const PoolManagement = lazy(() => import('./PoolManagement.jsx'));
const CharacterManagement = lazy(() => import('./CharacterManagement.jsx'));
const AnnouncementsPanel = lazy(() => import('./panels/AnnouncementsPanel.jsx'));
const SiteConfigPanel = lazy(() => import('./panels/SiteConfigPanel.jsx'));

const MENU_ITEMS = [
  { id: 'siteHealth', label: '站点健康', icon: Activity },
  { id: 'mailStatus', label: '邮件状态', icon: Mail },
  { id: 'users', label: '用户管理', icon: Users },
  { id: 'userData', label: '用户数据', icon: Database },
  { id: 'historyAnomalies', label: '异常日志审阅', icon: AlertTriangle },
  { id: 'summerLotteryContacts', label: '抽奖兑奖联系', icon: Gift },
  { id: 'pools', label: '卡池与版本', icon: Layers, editable: true },
  { id: 'characters', label: '角色与武器', icon: Star, editable: true },
  { id: 'announcements', label: '公告管理', icon: Bell, editable: true },
  { id: 'automation', label: '运营自动化', icon: Bot },
  { id: 'tickets', label: '工单处理', icon: MessageSquare },
  { id: 'developerApi', label: '开发者 API', icon: Globe },
  { id: 'accountRecovery', label: '账号恢复', icon: KeyRound },
  { id: 'siteConfig', label: '站点配置', icon: Settings, editable: true },
];

const SAMPLE_USERS = [
  { id: 'sandbox-user-1', username: '示例博士', email: 'do***@example.invalid', role: 'user', records: 168, status: 'active' },
  { id: 'sandbox-user-2', username: '内容维护员', email: 'ed***@example.invalid', role: 'admin', records: 84, status: 'active' },
  { id: 'sandbox-user-3', username: '待恢复账号', email: 're***@example.invalid', role: 'user', records: 12, status: 'review' },
];

const SAMPLE_ANOMALIES = [
  { id: 'anomaly-1', title: '未识别角色 ID', scope: 'UID ***001 / CN', status: 'pending', detail: '官方记录中的实体 ID 尚未映射到当前目录。' },
  { id: 'anomaly-2', title: '区服字段冲突', scope: 'UID ***002 / INTL', status: 'review', detail: '同一账号出现不同 server_scope。' },
  { id: 'anomaly-3', title: '重复序号候选', scope: 'UID ***003 / CN', status: 'resolved', detail: '同卡池同序号记录已保留较新项。' },
];

const SAMPLE_TICKETS = [
  { id: 'T-1042', title: '导入后缺少一个卡池', owner: '示例博士', status: 'open', updated: '12 分钟前' },
  { id: 'T-1039', title: '英文卡池名称显示问题', owner: 'Frontend Tester', status: 'in_progress', updated: '2 小时前' },
  { id: 'T-1028', title: '请求删除旧账号数据', owner: '匿名用户', status: 'resolved', updated: '1 天前' },
];

const SAMPLE_AUTOMATION = [
  { id: 'official-announcements', name: '官方公告同步', schedule: '每 30 分钟', status: 'success', detail: '发现 2 条候选，等待内容审核' },
  { id: 'pool-schedule', name: '卡池计划同步', schedule: '每小时', status: 'review', detail: '1 个临时 ID 等待提升' },
  { id: 'wiki-catalog', name: '图鉴完整性巡检', schedule: '每日', status: 'warning', detail: '3 个实体缺少头像' },
];

function StatusBadge({ value }) {
  const normalized = String(value || '').toLowerCase();
  const className = ['healthy', 'active', 'success', 'resolved', 'published'].includes(normalized)
    ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
    : ['paused', 'pending', 'review', 'warning', 'open', 'in_progress'].includes(normalized)
      ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
      : 'border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300';
  return <span className={`border px-2 py-0.5 text-[11px] font-bold uppercase ${className}`}>{value}</span>;
}

function SandboxButton({ children, onClick, disabled = false, tone = 'default' }) {
  const toneClass = tone === 'primary'
    ? 'border-cyan-500 bg-cyan-600 text-white hover:bg-cyan-700 dark:text-white'
    : tone === 'danger'
      ? 'border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30'
      : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800';
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`inline-flex min-h-9 items-center justify-center gap-2 border px-3 py-1.5 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}>
      {children}
    </button>
  );
}

function DataTable({ columns, rows }) {
  return (
    <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead className="bg-zinc-100 text-xs uppercase text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
          <tr>{columns.map((column, index) => <th key={`${column.key}:${index}`} className="px-4 py-3">{column.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {rows.map((row) => (
            <tr key={row.id} className="bg-white dark:bg-zinc-900">
              {columns.map((column, index) => (
                <td key={`${column.key}:${index}`} className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                  {column.render ? column.render(row[column.key], row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SiteHealthSandbox({ catalogSource, catalogFetchedAt, catalogError, counts }) {
  const cards = [
    { label: '正式目录', status: catalogSource === 'production-public-api' ? 'healthy' : 'warning', detail: catalogSource === 'production-public-api' ? `已缓存 ${counts.pools} 池 / ${counts.characters} 实体` : '当前使用仓库真实 fallback' },
    { label: '本地内容存储', status: 'healthy', detail: `${counts.announcements} 条公告 / ${counts.config} 项配置` },
    { label: '真实写入与敏感服务', status: 'paused', detail: 'Supabase 写入、邮件、自动化、密钥和开奖均被阻断' },
  ];
  return (
    <div className="space-y-4">
      {catalogError && <div className="border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">正式目录读取失败：{catalogError}。当前已安全回退到仓库真实目录。</div>}
      <div className="grid gap-3 lg:grid-cols-3">
        {cards.map((item) => (
          <article key={item.label} className="border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-start justify-between gap-3"><h4 className="font-bold">{item.label}</h4><StatusBadge value={item.status} /></div>
            <p className="mt-3 text-sm leading-6 text-zinc-500">{item.detail}</p>
          </article>
        ))}
      </div>
      <div className="border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        <div>目录来源：<code>{catalogSource}</code></div>
        <div className="mt-1">最近拉取：{catalogFetchedAt ? new Date(catalogFetchedAt).toLocaleString() : '仓库快照'}</div>
      </div>
    </div>
  );
}

function UsersSandbox({ mode }) {
  if (mode === 'userData') {
    return (
      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <div className="border border-zinc-200 p-3 dark:border-zinc-800">
          <h4 className="text-sm font-bold">选择脱敏用户</h4>
          <div className="mt-3 space-y-2">{SAMPLE_USERS.map((user) => <button key={user.id} type="button" className="w-full border border-zinc-200 p-3 text-left hover:border-cyan-400 dark:border-zinc-800"><div className="font-medium">{user.username}</div><div className="mt-1 text-xs text-zinc-500">{user.records} 条记录</div></button>)}</div>
        </div>
        <div className="border border-zinc-200 p-4 dark:border-zinc-800">
          <h4 className="font-bold">用户数据预览</h4>
          <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="bg-zinc-50 p-3 dark:bg-zinc-950"><div className="text-xs text-zinc-500">游戏账号</div><div className="mt-1 text-xl font-bold">2</div></div><div className="bg-zinc-50 p-3 dark:bg-zinc-950"><div className="text-xs text-zinc-500">卡池</div><div className="mt-1 text-xl font-bold">8</div></div><div className="bg-zinc-50 p-3 dark:bg-zinc-950"><div className="text-xs text-zinc-500">记录</div><div className="mt-1 text-xl font-bold">168</div></div></div>
          <p className="mt-4 text-sm text-zinc-500">删除用户数据、卡池和历史记录的真实动作不在本地沙盒中模拟。</p>
        </div>
      </div>
    );
  }
  return <DataTable columns={[
    { key: 'username', label: '用户' },
    { key: 'email', label: '邮箱（脱敏）' },
    { key: 'role', label: '角色', render: (value) => <StatusBadge value={value} /> },
    { key: 'records', label: '记录数' },
    { key: 'status', label: '状态', render: (value) => <StatusBadge value={value} /> },
    { key: 'id', label: '安全边界', render: () => <span className="text-xs text-zinc-400">密码/删除操作不可用</span> },
  ]} rows={SAMPLE_USERS} />;
}

function AnomaliesSandbox({ showToast }) {
  const [rows, setRows] = React.useState(SAMPLE_ANOMALIES);
  const update = (id, status) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, status } : row));
    showToast?.(`本地异常状态已改为 ${status}`, 'success');
  };
  return <DataTable columns={[
    { key: 'title', label: '异常' },
    { key: 'scope', label: '作用域' },
    { key: 'detail', label: '详情' },
    { key: 'status', label: '状态', render: (value) => <StatusBadge value={value} /> },
    { key: 'id', label: '本地审阅', render: (_, row) => <div className="flex gap-2"><SandboxButton onClick={() => update(row.id, 'resolved')}>解决</SandboxButton><SandboxButton onClick={() => update(row.id, 'dismissed')}>忽略</SandboxButton></div> },
  ]} rows={rows} />;
}

function AutomationSandbox({ showToast }) {
  const [runningId, setRunningId] = React.useState(null);
  const run = (job) => {
    setRunningId(job.id);
    window.setTimeout(() => {
      setRunningId(null);
      showToast?.(`已完成“${job.name}”本地 UI 演练；未请求真实自动化服务`, 'success');
    }, 500);
  };
  return <DataTable columns={[
    { key: 'name', label: '任务' },
    { key: 'schedule', label: '计划' },
    { key: 'detail', label: '最近结果' },
    { key: 'status', label: '状态', render: (value) => <StatusBadge value={value} /> },
    { key: 'id', label: '操作', render: (_, row) => <SandboxButton onClick={() => run(row)} disabled={runningId === row.id}>{runningId === row.id ? '演练中…' : '本地演练'}</SandboxButton> },
  ]} rows={SAMPLE_AUTOMATION} />;
}

function TicketsSandbox({ showToast }) {
  const [tickets, setTickets] = React.useState(SAMPLE_TICKETS);
  const cycle = (ticket) => {
    const status = ticket.status === 'open' ? 'in_progress' : ticket.status === 'in_progress' ? 'resolved' : 'open';
    setTickets((current) => current.map((row) => row.id === ticket.id ? { ...row, status, updated: '刚刚' } : row));
    showToast?.('工单状态已在本地更新', 'success');
  };
  return <DataTable columns={[
    { key: 'id', label: '编号' },
    { key: 'title', label: '主题' },
    { key: 'owner', label: '用户' },
    { key: 'updated', label: '更新' },
    { key: 'status', label: '状态', render: (value) => <StatusBadge value={value} /> },
    { key: 'id', label: '本地流程', render: (_, row) => <SandboxButton onClick={() => cycle(row)}>切换状态</SandboxButton> },
  ]} rows={tickets} />;
}

function SensitiveSandbox({ activeMenu }) {
  const content = {
    mailStatus: ['邮件状态', '队列 3 / 失败 1 / suppression 2', '测试邮件、队列 drain、预算保存和管理员告警均不会发送。'],
    summerLotteryContacts: ['抽奖兑奖联系', '有效参与 126 / 待联系 6 / 已确认 4', '联系方式始终脱敏；解密、删除、授权、冻结承诺和开奖入口不可执行。'],
    developerApi: ['开发者 API', '待审核 2 / 已批准 5 / 已吊销 1', '不会生成、轮换或显示任何可用 API 密钥或 verifier。'],
    accountRecovery: ['账号恢复', '待处理 1 / 已验证 2 / 已关闭 4', '可以查看完整布局，但不会设置临时密码或变更真实申请状态。'],
  };
  const [title, stats, detail] = content[activeMenu];
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="border border-zinc-200 p-5 dark:border-zinc-800"><h4 className="font-bold">{title}</h4><p className="mt-4 font-mono text-2xl font-bold">{stats}</p><p className="mt-4 text-sm leading-6 text-zinc-500">{detail}</p></div>
      <div className="border border-amber-300 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/20"><h4 className="font-bold text-amber-800 dark:text-amber-200">敏感功能已隔离</h4><p className="mt-3 text-sm leading-6 text-amber-700 dark:text-amber-300">该模块仅用于检查信息层级、状态颜色、密度与响应式布局。</p><div className="mt-4 flex gap-2"><SandboxButton disabled>执行真实操作</SandboxButton><SandboxButton disabled tone="danger">删除</SandboxButton></div></div>
    </div>
  );
}

function ConfigSandboxTools({ showToast }) {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ key: '', label: '', category: 'general', value: '' });
  const siteConfigItems = useContributorDemoSandboxStore((state) => state.siteConfigItems);
  const customItems = React.useMemo(
    () => siteConfigItems.filter((item) => item.updated_by === 'local-sandbox' && item.updated_at),
    [siteConfigItems]
  );
  const save = async () => {
    if (!/^[A-Za-z0-9_.:-]+$/u.test(form.key) || isReservedObjectKey(form.key)) {
      showToast?.('配置键只能包含字母、数字和 _ . : -', 'error');
      return;
    }
    const saved = await contributorDemoSandboxAdapters.siteConfig.updateConfig(form.key, form.value, { label: form.label || form.key, category: form.category });
    if (!saved) {
      showToast?.(useContributorDemoSandboxStore.getState().persistenceError || '配置项数据无效', 'error');
      return;
    }
    setForm({ key: '', label: '', category: 'general', value: '' });
    setOpen(false);
    showToast?.('本地配置项已新增', 'success');
  };
  return (
    <div className="mb-4 border border-cyan-300 bg-cyan-50 p-3 dark:border-cyan-800 dark:bg-cyan-950/20">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-cyan-800 dark:text-cyan-200">这里复用真实站点配置编辑器；还可以创建沙盒专用配置项。</p><SandboxButton onClick={() => setOpen((value) => !value)} tone="primary">{open ? '取消新增' : '新增配置项'}</SandboxButton></div>
      {open && <div className="mt-3 grid gap-2 md:grid-cols-4"><input value={form.key} onChange={(event) => setForm((value) => ({ ...value, key: event.target.value }))} placeholder="配置 key" className="border border-cyan-300 bg-white px-3 py-2 text-sm dark:bg-zinc-950"/><input value={form.label} onChange={(event) => setForm((value) => ({ ...value, label: event.target.value }))} placeholder="显示名称" className="border border-cyan-300 bg-white px-3 py-2 text-sm dark:bg-zinc-950"/><select value={form.category} onChange={(event) => setForm((value) => ({ ...value, category: event.target.value }))} className="border border-cyan-300 bg-white px-3 py-2 text-sm dark:bg-zinc-950"><option value="general">通用</option><option value="content">运营内容</option><option value="alert">系统提醒</option><option value="social">社交链接</option><option value="legal">法律合规</option></select><SandboxButton onClick={save}>创建</SandboxButton><textarea value={form.value} onChange={(event) => setForm((value) => ({ ...value, value: event.target.value }))} placeholder="配置值" className="min-h-20 border border-cyan-300 bg-white px-3 py-2 text-sm dark:bg-zinc-950 md:col-span-4"/></div>}
      {customItems.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{customItems.map((item) => <span key={item.key} className="inline-flex items-center gap-2 border border-cyan-200 bg-white px-2 py-1 text-xs text-cyan-800 dark:border-cyan-900 dark:bg-zinc-950 dark:text-cyan-200"><code>{item.key}</code><button type="button" onClick={() => { contributorDemoSandboxAdapters.siteConfig.deleteConfig(item.key); showToast?.('本地配置项已删除', 'success'); }} className="text-red-500" aria-label={`删除${item.label || item.key}`}>×</button></span>)}</div>}
    </div>
  );
}

function AdminContent({ activeMenu, showToast }) {
  const catalogSource = useContributorDemoSandboxStore((state) => state.catalogSource);
  const catalogFetchedAt = useContributorDemoSandboxStore((state) => state.catalogFetchedAt);
  const persistenceError = useContributorDemoSandboxStore((state) => state.persistenceError);
  const catalogError = useContributorDemoSandboxStore((state) => state.catalogError);
  const pools = useContributorDemoSandboxStore((state) => state.pools);
  const characters = useContributorDemoSandboxStore((state) => state.characters);
  const announcements = useContributorDemoSandboxStore((state) => state.announcements);
  const configItems = useContributorDemoSandboxStore((state) => state.siteConfigItems);
  const revision = useContributorDemoSandboxStore((state) => state.revision);

  if (activeMenu === 'siteHealth') return <SiteHealthSandbox catalogSource={catalogSource} catalogFetchedAt={catalogFetchedAt} catalogError={catalogError} counts={{ pools: pools.length, characters: characters.length, announcements: announcements.length, config: configItems.length }} />;
  if (activeMenu === 'users' || activeMenu === 'userData') return <UsersSandbox mode={activeMenu} />;
  if (activeMenu === 'historyAnomalies') return <AnomaliesSandbox showToast={showToast} />;
  if (activeMenu === 'automation') return <AutomationSandbox showToast={showToast} />;
  if (activeMenu === 'tickets') return <TicketsSandbox showToast={showToast} />;
  if (['mailStatus', 'summerLotteryContacts', 'developerApi', 'accountRecovery'].includes(activeMenu)) return <SensitiveSandbox activeMenu={activeMenu} />;
  if (activeMenu === 'pools') return <PoolManagement showToast={showToast} service={contributorDemoSandboxAdapters.pools} configAdapter={contributorDemoSandboxAdapters.siteConfig} sandboxMode />;
  if (activeMenu === 'characters') return <CharacterManagement showToast={showToast} service={contributorDemoSandboxAdapters.characters} configAdapter={contributorDemoSandboxAdapters.siteConfig} sandboxMode />;
  if (activeMenu === 'announcements') {
    return <AnnouncementsPanel announcements={announcements} actionLoading={null} onSaveAnnouncement={(form, editing, done) => { const saved = contributorDemoSandboxAdapters.announcements.save(form, editing); const error = useContributorDemoSandboxStore.getState().persistenceError; if (!saved || error) { showToast?.(error || '公告数据无效', 'error'); return; } showToast?.(editing ? '公告已在本地更新' : '公告已在本地创建', 'success'); done?.(); }} onToggleActive={(announcement) => { contributorDemoSandboxAdapters.announcements.toggle(announcement.id); const error = useContributorDemoSandboxStore.getState().persistenceError; showToast?.(error || '公告状态已在本地切换', error ? 'error' : 'success'); }} onDeleteAnnouncement={(announcementId) => { contributorDemoSandboxAdapters.announcements.delete(announcementId); const error = useContributorDemoSandboxStore.getState().persistenceError; showToast?.(error || '公告已从本地沙盒删除', error ? 'error' : 'success'); }} />;
  }
  if (activeMenu === 'siteConfig') return <><ConfigSandboxTools showToast={showToast} /><SiteConfigPanel key={`sandbox-config-${revision}`} showToast={showToast} configAdapter={contributorDemoSandboxAdapters.siteConfig} /></>;
  return persistenceError ? <div className="border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">{persistenceError}</div> : null;
}

function ModuleFallback() {
  return <div className="flex items-center justify-center py-16 text-zinc-400"><RefreshCw size={20} className="animate-spin" /></div>;
}

export default function ContributorDemoAdminPanel({ showToast }) {
  const [activeMenu, setActiveMenu] = React.useState('siteHealth');
  const [catalogLoading, setCatalogLoading] = React.useState(false);
  const catalogSource = useContributorDemoSandboxStore((state) => state.catalogSource);
  const catalogFetchedAt = useContributorDemoSandboxStore((state) => state.catalogFetchedAt);
  const persistenceError = useContributorDemoSandboxStore((state) => state.persistenceError);

  const refreshCatalog = async () => {
    setCatalogLoading(true);
    try {
      await refreshContributorDemoLiveCatalog({ preserveContent: true });
      showToast?.('已从正式站刷新真实卡池、角色和阵容；本地公告与配置修改已保留', 'success');
    } catch (error) {
      showToast?.(`正式目录刷新失败：${error.message}`, 'error');
    } finally {
      setCatalogLoading(false);
    }
  };

  const resetAll = async () => {
    if (!window.confirm('确定重置整个本地内容沙盒吗？本地新增和修改会被清除，但不会影响真实数据。')) return;
    setCatalogLoading(true);
    try {
      await resetContributorDemoSandbox();
      showToast?.('本地内容沙盒已重置，并重新读取真实目录', 'success');
    } finally {
      setCatalogLoading(false);
    }
  };

  const activeItem = MENU_ITEMS.find((item) => item.id === activeMenu);
  return (
    <div className="animate-fade-in" data-testid="contributor-demo-admin-panel">
      <div className="mb-6 border border-cyan-300 bg-cyan-50 p-5 text-cyan-950 dark:border-cyan-800 dark:bg-cyan-950/30 dark:text-cyan-100">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="flex items-center gap-3 text-2xl font-bold"><Shield size={28} />贡献者本地内容沙盒</h2><p className="mt-2 max-w-3xl text-sm leading-6">卡池、角色、武器和阵容优先来自正式站公共目录；公告、版本和站点内容可在本地完整编辑。所有更改只保存在当前浏览器。</p><div className="mt-2 flex flex-wrap gap-2 text-xs"><StatusBadge value={catalogSource === 'production-public-api' ? 'LIVE CATALOG' : 'REPOSITORY FALLBACK'} />{catalogFetchedAt && <span className="text-cyan-700 dark:text-cyan-300">同步于 {new Date(catalogFetchedAt).toLocaleString()}</span>}</div></div>
          <div className="flex flex-wrap gap-2"><SandboxButton onClick={refreshCatalog} disabled={catalogLoading}><RefreshCw size={14} className={catalogLoading ? 'animate-spin' : ''}/>{catalogLoading ? '刷新中…' : '刷新正式目录'}</SandboxButton><SandboxButton onClick={resetAll} tone="danger"><RotateCcw size={14}/>重置本地沙盒</SandboxButton></div>
        </div>
      </div>
      {persistenceError && <div className="mb-4 border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">{persistenceError}</div>}
      <div className="flex flex-col gap-6 md:flex-row">
        <nav className="w-full shrink-0 overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 md:w-60">
          {MENU_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = item.id === activeMenu;
            return <button key={item.id} type="button" onClick={() => setActiveMenu(item.id)} className={`flex w-full items-center justify-between border-l-4 px-4 py-3 text-left ${active ? 'border-cyan-500 bg-cyan-50 text-cyan-800 dark:bg-cyan-950/30 dark:text-cyan-200' : 'border-transparent text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800'}`}><span className="flex items-center gap-3"><Icon size={18}/><span className="font-medium">{item.label}</span>{item.editable && <span className="border border-cyan-300 px-1 py-0.5 text-[9px] font-bold text-cyan-700 dark:border-cyan-800 dark:text-cyan-300">LOCAL CRUD</span>}</span><ChevronRight size={16} className={active ? 'rotate-90' : ''}/></button>;
          })}
        </nav>
        <section className="min-w-0 flex-1 border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800"><h3 className="text-lg font-bold">{activeItem?.label}</h3><StatusBadge value={activeItem?.editable ? 'local editable' : 'safe simulation'} /></div>
          <Suspense fallback={<ModuleFallback/>}><AdminContent activeMenu={activeMenu} showToast={showToast}/></Suspense>
        </section>
      </div>
    </div>
  );
}
