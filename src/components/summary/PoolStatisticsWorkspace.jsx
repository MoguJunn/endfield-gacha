import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Cloud, ListFilter, RefreshCw, User, Clock3, Users, Gift, BookOpen, ArrowUpRight } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import { useTheme } from '../../contexts/ThemeContext';
import { useAppStore, useAuthStore, useHistoryStore, usePoolStore } from '../../stores/index.js';
import { loadPersonalStatistics } from '../../services/scheduledStatisticsService.js';
import { resolvePoolCapabilities } from '../../utils/poolCapabilities.js';
import { getStatisticsGroup, getStatisticsGroupPools, normalizeStatisticsPool } from '../../../shared/statisticsScopes.js';
import StatisticsPoolList from './StatisticsPoolList.jsx';
import ScopedLegacyStatisticsPanel from './ScopedLegacyStatisticsPanel.jsx';
import PoolObservationCharts from './PoolObservationCharts.jsx';
import PoolTargetPrediction from './PoolTargetPrediction.jsx';
import '../home/homeLandingDemo.css';
import '../ui/experienceFoundation.css';
import './poolStatisticsWorkspace.css';

const EMPTY_PRIVATE_DATA = { data: null, error: false, meta: null };

async function readStats(type, signal, scope = null) {
  const params = new URLSearchParams({ type });
  if (scope?.kind === 'pool') params.set('poolId', scope.poolId);
  if (scope?.kind === 'group') params.set('groupKey', scope.groupKey);
  const response = await fetch(`/api/stats?${params}`, { signal });
  const result = await response.json();
  if (!response.ok || result.success === false) throw new Error(result.error || 'statistics_unavailable');
  return result;
}

// Keying the owner/source session prevents previously loaded private rows from surviving a user switch.
export default function PoolStatisticsWorkspace({ lockedDataSource = null, mobile = false, overview = null }) {
  const user = useAuthStore((state) => state.user);
  const [sourceChoice, setSourceChoice] = useState('global');
  const source = lockedDataSource || sourceChoice;
  return <StatisticsSession key={`${user?.id || 'guest'}:${source}`} user={user} source={source} mobile={mobile}
    sourceLocked={Boolean(lockedDataSource)} onSourceChange={setSourceChoice} overview={overview} />;
}

function StatisticsSession({ user, source, mobile, sourceLocked, onSourceChange, overview }) {
  const { isEnglish, locale } = useI18n();
  const { isDark } = useTheme();
  const t = (zh, en) => isEnglish ? en : zh;
  const openAuthModal = useAuthStore((state) => state.openAuthModal);
  const storedPools = usePoolStore((state) => state.pools);
  const currentPoolId = usePoolStore((state) => state.currentPoolId);
  const historyRevision = useHistoryStore((state) => state.history);
  const overviewMeta = useAppStore((state) => state.globalStats?.meta);
  const fetchGlobalStats = useAppStore((state) => state.fetchGlobalStats);
  const [catalog, setCatalog] = useState({ pools: [], error: false });
  const [scopeChoice, setScopeChoice] = useState(null);
  const [accountKey, setAccountKey] = useState('');
  const [globalCounts, setGlobalCounts] = useState({});
  const [tab, setTab] = useState('observed');
  const [refresh, setRefresh] = useState(0);
  const [privateResponse, setPrivateData] = useState(EMPTY_PRIVATE_DATA);
  const [globalData, setGlobalData] = useState({ scopeKey: null, data: null, error: false });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const privateData = privateResponse;
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([readStats('pools', controller.signal), source === 'global' ? readStats('pool_counts', controller.signal) : null]).then(([result, counts]) => {
      if (controller.signal.aborted) return;
      const pools = result.data?.pools;
      setCatalog({ pools: Array.isArray(pools) ? pools : [], error: !Array.isArray(pools) });
      if (source === 'global') setGlobalCounts(counts.data?.counts || {});
    }).catch(() => { if (!controller.signal.aborted) setCatalog((old) => ({ ...old, error: true })); });
    return () => controller.abort();
  }, [refresh, source]);
  useEffect(() => {
    if (source !== 'local' || !user?.id) return undefined;
    const controller = new AbortController();
    loadPersonalStatistics(controller.signal).then((result) => {
      if (result.meta?.ownerId !== user.id || result.meta?.truncated) {
        throw new Error('Incomplete or mismatched account history');
      }
      if (!controller.signal.aborted) setPrivateData({ data: result.data, meta: result.meta, error: false });
    }).catch(() => { if (!controller.signal.aborted) setPrivateData((old) => ({ ...old, error: true })); });
    return () => controller.abort();
  }, [source, user?.id, refresh, historyRevision]);
  const pools = useMemo(() => {
    const map = new Map(catalog.pools.map((pool) => [pool.id, pool]));
    if (source === 'local') for (const pool of [...storedPools, ...(privateData.data?.pools || [])]) if (!map.has(pool.id)) map.set(pool.id, pool);
    return [...map.values()].map(normalizeStatisticsPool).filter((pool) => !/^(?:__)?group_/.test(String(pool.id)));
  }, [catalog.pools, storedPools, source, privateData.data?.pools]);
  const accounts = privateData.data?.accounts || [];
  const selectedAccountKey = accounts.some((account) => account.key === accountKey) ? accountKey : '';
  const personalScope = privateData.data?.scopes?.[selectedAccountKey];
  const availablePools = useMemo(() => source === 'local' && personalScope ? pools.filter((pool) => personalScope[pool.id]?.total > 0) : pools,
    [source, pools, personalScope]);
  const defaultPool = availablePools.find((pool) => pool.id === currentPoolId)
    || availablePools.find((pool) => pool.type === 'limited' && new Date(pool.start_time || 0).getTime() <= openedAt) || availablePools[0];
  const pool = pools.find((item) => scopeChoice?.kind === 'pool' && item.id === scopeChoice.poolId) || defaultPool;
  const group = scopeChoice?.kind === 'group' ? getStatisticsGroup(scopeChoice.groupKey) : null;
  const scope = group ? scopeChoice : { kind: 'pool', poolId: pool?.id || '' };
  const poolId = scope.kind === 'pool' ? scope.poolId : '';
  const groupKey = group?.key || '';
  const scopeKey = group ? `group:${groupKey}` : `pool:${poolId}`;
  const selectScope = (nextScope) => {
    setScopeChoice(nextScope);
    if (tab === 'theory' && nextScope.kind === 'group') setTab('observed');
  };
  useEffect(() => {
    if (source !== 'global' || (!poolId && !groupKey)) return undefined;
    const controller = new AbortController();
    const requestScope = groupKey ? { kind: 'group', groupKey } : { kind: 'pool', poolId };
    readStats(groupKey ? 'group_statistics' : 'pool_observations', controller.signal, requestScope).then((result) => {
      if (!controller.signal.aborted) setGlobalData({ scopeKey, data: result.data, error: !result.data, refresh });
    }).catch(() => { if (!controller.signal.aborted) setGlobalData({ scopeKey, data: null, error: true, refresh }); });
    return () => controller.abort();
  }, [source, poolId, groupKey, scopeKey, refresh]);
  useEffect(() => {
    if (source !== 'global' || tab !== 'overview') return undefined;
    fetchGlobalStats(true);
  }, [source, tab, refresh, fetchGlobalStats]);
  const localGroup = privateData.data?.groupScopes?.[selectedAccountKey]?.[groupKey];
  const localStats = group ? localGroup?.observations : personalScope?.[poolId];
  const hasGlobalResponse = globalData.scopeKey === scopeKey;
  const stats = source === 'local' ? localStats : hasGlobalResponse ? globalData.data?.observations : null;
  const legacy = source === 'local' ? group ? localGroup?.legacy : privateData.data?.legacyScopes?.[selectedAccountKey]?.[poolId]
    : hasGlobalResponse ? globalData.data?.legacy : null;
  const poolPullCounts = Object.fromEntries(Object.entries(personalScope || {}).map(([id, value]) => [id, value.total]));
  const freshness = source === 'global' ? tab === 'overview' ? overviewMeta : hasGlobalResponse ? globalData.data?.meta : null : privateData.meta;
  useEffect(() => {
    if (source === 'local' && !user?.id) return undefined;
    const delay = Math.max(60000, Math.min(3600000, Date.parse(freshness?.nextRefreshAt || '') - Date.now() || 60000));
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== 'hidden') setRefresh((value) => value + 1);
    }, delay);
    const onVisible = () => { if (document.visibilityState === 'visible') setRefresh((value) => value + 1); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [source, user?.id, freshness?.nextRefreshAt, refresh]);
  const capabilities = resolvePoolCapabilities(pool);
  const weapon = group ? group.entityType === 'weapon' : capabilities.entityType === 'weapon';
  const canPredict = !group && pool?.up_character && ['limited', 'limited_character', 'weapon', 'limited_weapon'].includes(pool.type);
  const error = catalog.error || (source === 'local' ? privateData.error : hasGlobalResponse && globalData.error);
  const updatedAt = freshness?.updatedAt;
  const poolName = (item) => isEnglish ? item.name_en || item.name || item.id : item.name || item.id;
  const date = (value) => value ? new Date(value).toLocaleString(locale) : '—';
  const scopeName = group ? t(group.name, group.nameEn) : pool ? poolName(pool) : '—';
  const memberPools = group ? getStatisticsGroupPools(pools, group.key) : pool ? [pool] : [];
  const members = group ? stats?.members || [] : pool ? [{ id: pool.id, name: pool.name, nameEn: pool.name_en, total: stats?.total }] : [];
  const guest = source === 'local' && !user;
  return <div className="experience-ui hl-theme ex-integrated" data-theme={isDark ? 'dark' : 'light'} data-variant={mobile ? 'mobile' : 'desktop'} data-source={source}>
    <div className="ex-main ex-workspace-grid">
      <aside className="ex-sidebar" aria-label={t('统计筛选', 'Statistics filters')}>
        <div className="ex-sidebar-heading"><h2><ListFilter size={16} />{t('统计范围', 'Statistics scope')}</h2>
          <button className="ex-sidebar-toggle" aria-expanded={filtersOpen} aria-controls="statistics-filter-fields" onClick={() => setFiltersOpen(!filtersOpen)}>{filtersOpen ? t('收起', 'Hide') : t('展开', 'Show')}</button></div>
        <div id="statistics-filter-fields" className={`ex-sidebar-fields ${filtersOpen ? 'is-open' : ''}`}>
          <section className="ex-sidebar-section"><h3>{source === 'global' ? <Cloud size={15} /> : <User size={15} />}{t('数据来源', 'Data source')}</h3>
            {sourceLocked ? <p className="ex-source-label">{source === 'global' ? t('全服真实记录', 'Community records') : t('我的真实记录', 'My records')}</p> : <div className="ex-sidebar-options">
              <button aria-pressed={source === 'global'} onClick={() => onSourceChange('global')}>{t('全服数据', 'Community')}</button><button aria-pressed={source === 'local'} onClick={() => onSourceChange('local')}>{t('我的数据', 'My records')}</button></div>}
          </section>
          <section className="ex-sidebar-section"><label className="ex-field">{t('游戏账号', 'Game account')}<select aria-label={t('游戏账号', 'Game account')} disabled={source === 'global' || guest} value={selectedAccountKey} onChange={(e) => { setAccountKey(e.target.value); if (scopeChoice?.kind !== 'group') setScopeChoice(null); }}>
            <option value="">{source === 'global' ? t('全部贡献账号（匿名聚合）', 'All contributing accounts') : t('我的全部游戏账号', 'All my game accounts')}</option>
            {source === 'local' && accounts.map((account) => <option key={account.key} value={account.key}>{account.name} · {account.gameUid} · {account.serverScope}</option>)}
          </select></label></section>
          <p className="ex-sidebar-hint">{t('首次均指同一对象在本期卡池内首次获得。', 'First acquisition always means the first copy of an item within this banner period.')}</p>
          <button className="ex-refresh" onClick={() => setRefresh((value) => value + 1)}><RefreshCw key={refresh} className={refresh ? 'ex-refresh-feedback' : ''} size={14} />{t('获取最新结果', 'Get latest results')}</button>
          <StatisticsPoolList pools={pools} counts={source === 'local' ? poolPullCounts : { ...globalCounts, ...(stats && !group ? { [poolId]: stats.total } : {}) }}
            scope={scope} onSelect={selectScope} locale={locale} t={t} />
        </div>
      </aside>
      <div className="ex-workspace-content">
        <header className="ex-heading ex-report-heading"><div className="ex-heading-icon"><BarChart3 size={22} /></div><div><span className="ex-report-eyebrow">{t('寻访数据档案', 'RECRUITMENT ARCHIVE')}</span><h1>{t('分卡池详细统计', 'Banner detail statistics')}</h1></div><span className="ex-report-source">{source === 'global' ? <Cloud size={14} /> : <User size={14} />}{source === 'global' ? t('全服数据', 'Community') : t('我的数据', 'My records')}</span></header>
        <nav className="ex-tabs" aria-label={t('统计内容', 'Statistics content')}>
          <button aria-pressed={tab === 'observed'} onClick={() => setTab('observed')}>{t('真实记录图表', 'Record statistics')}</button><button aria-pressed={tab === 'theory'} disabled={Boolean(group)} title={group ? t('请选择具体卡池查看理论预测', 'Select a banner for theoretical prediction') : undefined} onClick={() => setTab('theory')}>{t('理论预测', 'Theoretical prediction')}</button>
          {overview && <button aria-pressed={tab === 'overview'} onClick={() => setTab('overview')}>{t('综合概览与图鉴', 'Overview and catalog')}</button>}
        </nav>
        {!guest && <div className="ex-freshness" role="status">
          <span><Clock3 size={12} aria-hidden="true" />{t('更新于', 'Updated')} {date(freshness?.updatedAt)}</span>
          <span>{freshness?.source === 'local-snapshot' ? t('本地计算预览', 'Local snapshot preview') : freshness?.refreshMinutes ? `${t('自动刷新', 'Refresh interval')} · ${freshness.refreshMinutes} ${t('分钟', 'min')}` : t('等待首次计算', 'Awaiting initial calculation')}</span>
          {freshness?.nextRefreshAt && <span>{t('下次检查', 'Next check')} {date(freshness.nextRefreshAt)}</span>}
          {freshness?.stale && <span>{t('正在等待后台更新，当前展示上次结果', 'Awaiting background update; showing the previous result')}</span>}
        </div>}
        {tab === 'overview' ? <React.Fragment key={refresh}>{overview(source, privateData.data)}</React.Fragment> : tab === 'theory' ? canPredict ? <PoolTargetPrediction key={poolId} weapon={weapon} targetName={pool.up_character} t={t} /> : <p className="ex-state">{t('该卡池的目标预测规则尚未接入，真实记录图表仍可查看。', 'Target prediction is not available for this banner; recorded statistics remain available.')}</p> : guest ?
          <div className="ex-state"><p>{t('登录后读取你已保存的账号与抽卡记录。', 'Sign in to read your saved accounts and pull history.')}</p><button className="ex-primary" onClick={openAuthModal}>{t('登录', 'Sign in')}</button></div> : error ?
          <div className="ex-state" role="alert"><p>{t('统计读取失败，请稍后重试。', 'Statistics could not be loaded. Please retry.')}</p><button onClick={() => setRefresh((value) => value + 1)}>{t('重试', 'Retry')}</button></div> : !stats ?
          <p className="ex-state" role="status">{source === 'local' && privateData.data && accounts.length === 0 ? t('尚未导入记录。请先从个人卡池分析导入。', 'No saved records. Import history from personal banner analysis first.') : source === 'local' && personalScope && !availablePools.length ? t('此账号暂无有效抽取记录，直接赠送不计入抽取统计。', 'No valid pull records for this account. Direct gifts are excluded from pull statistics.') : freshness?.availability === 'building' ? t('此卡池正在等待后台首次计算，完成后自动显示。', 'This banner is queued for its first calculation. Results will appear automatically.') : t('正在读取统计结果…', 'Loading statistics…')}</p> : <>
            <section key={`summary:${scopeKey}:${selectedAccountKey}`} className="ex-banner-summary" aria-label={t('本期样本概览', 'Banner sample overview')}>
              <div className="ex-banner-title"><div><span className="ex-report-eyebrow">{group ? t('当前观测分组', 'SELECTED GROUP') : t('当前观测卡池', 'SELECTED BANNER')}</span><h2>{scopeName}</h2></div><span className="ex-period-tag"><ArrowUpRight size={14} aria-hidden="true" />{group ? t('各期分别计算后汇总', 'Calculated per banner, then combined') : t('本期卡池内首次', 'First copy in this banner')}</span></div>
              <div className="ex-meta ex-stat-metrics"><div className="ex-metric-primary"><span>{t('有效结果数', 'Valid results')}</span><b data-testid="observation-total">{stats.total.toLocaleString(locale)}</b><small>{t('普通 · 免费十连 · 情报书', 'Regular · Free batches · Intel tickets')}</small></div><div><span><Users size={14} aria-hidden="true" />{t('参与账号', 'Contributing accounts')}</span><b>{stats.participatingAccounts.toLocaleString(locale)}</b></div><div><span><Gift size={14} aria-hidden="true" />{t('免费十连结果', 'Free-batch results')}</span><b>{stats.free.toLocaleString(locale)}</b></div><div><span><BookOpen size={14} aria-hidden="true" />{t('情报书结果', 'Intel-ticket results')}</span><b>{stats.infoBook.toLocaleString(locale)}</b></div></div>
            </section>
            <div className="ex-data-context"><span>{t('记录范围', 'Record range')}：{date(stats.meta.firstRecordAt)} — {date(stats.meta.lastRecordAt)}</span><span>{t('计算时间', 'Calculated')}：{date(updatedAt)}</span></div>
            <p className="ex-coverage-note">{group ? t('分组按每个账号、每期卡池分别统计首次与后续获得后汇总，同名对象跨期重新计算首次。首次花费从该账号当期第一条已存记录起计算，缺失记录可能使结果偏低。', 'Group first/repeat acquisitions are calculated per account and banner period, then combined. The same item starts a new first acquisition in each period. First cost starts at the stored prefix; missing history may understate costs.') : t('按本期已导入记录统计首次与后续获得；首次花费从该账号本期第一条记录起计算，缺失记录可能使结果偏低。', 'First and repeat acquisitions use imported records in this banner. First cost starts at the account’s first imported result; missing history may understate costs.')}
              {weapon && t(' 武器十连内部顺序不等同于申领成本，理论预测另按整次申领计算。', ' Weapon order within a batch is not claim cost; predictions use whole claims.')}</p>
            <details className="ex-record-details"><summary>{t('记录完整性与匹配详情', 'Record coverage and matching')}</summary>
            {stats.meta.matchedByName > 0 && <p className="ex-coverage-note">{t('已按名称与星级精确匹配角色／武器目录并纳入统计', 'Included after exact name and rarity matching against the item catalog')}：{stats.meta.matchedByName}</p>}
            {stats.meta.unidentifiedRecords > 0 && <p className="ex-coverage-note" data-testid="unidentified-records">{t('对象不明但星级已知', 'Item unknown, rarity known')}：{stats.meta.unidentifiedRecords}（{Object.entries(stats.meta.unidentifiedByRarity).filter(([, count]) => count > 0).map(([rarity, count]) => `${rarity}★ ${count}`).join(' / ')}）。{t('已计入总数、星级分布及抽取间隔，不归入具体对象；同星级对象的受影响间隔列为未知。', 'Included in totals, rarity distribution and result positions. No item is assigned; affected intervals of the same rarity remain unknown.')}</p>}
            {stats.meta.excludedRecords > 0 && <details className="ex-coverage-note"><summary>{t('无法用于统计的记录', 'Records unavailable for statistics')}：{stats.meta.excludedRecords}</summary>
              {Object.entries(stats.meta.exclusions).filter(([, count]) => count > 0).map(([reason, count]) => <p key={reason}>{({ missingIdentity: t('账号或记录标识缺失', 'Missing account or record identity'), invalidTime: t('时间无效', 'Invalid time'), invalidRarity: t('星级无效', 'Invalid rarity'), duplicate: t('重复记录', 'Duplicate records') })[reason]}：{count}</p>)}
            </details>}
            </details>
            {legacy && <ScopedLegacyStatisticsPanel section="metrics" legacy={legacy} weapon={weapon} locale={locale} t={t} mobile={mobile} />}
            <PoolObservationCharts key={`${scopeKey}:${selectedAccountKey}`} stats={stats} pool={group ? null : pool} english={isEnglish} weapon={weapon} t={t} />
            {legacy && <ScopedLegacyStatisticsPanel section="resources" legacy={legacy} weapon={weapon} locale={locale} t={t} mobile={mobile} />}
            <section className="ex-scope-members" aria-label={t('范围与成员期数', 'Scope and member periods')}>
              <h2>{t('范围与成员期数', 'Scope and member periods')} · {members.length}</h2>
              <p>{t('记录起止', 'Record range')}：{date(stats.meta.firstRecordAt)} — {date(stats.meta.lastRecordAt)}</p>
              <details className="ex-record-details"><summary>{t('查看成员卡池', 'Show member banners')}</summary>
              <ul>{members.map((member) => {
                const definition = memberPools.find((item) => item.id === member.id);
                return <li key={member.id}><div><strong>{isEnglish ? member.nameEn || member.name || member.id : member.name || member.id}</strong>
                  <span>{t('开放范围', 'Banner dates')}：{date(definition?.start_time)} — {date(definition?.end_time)}</span></div>
                  <span>{Number.isFinite(member.total) ? member.total.toLocaleString(locale) : '—'} {t('条记录', 'records')}</span></li>;
              })}</ul>
              </details>
            </section>
          </>}
      </div>
    </div>
  </div>;
}
