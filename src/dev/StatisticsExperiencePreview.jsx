import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, BookOpen, ChevronRight, FlaskConical, Gift, Languages, Layers, Moon, Sun, Ticket, Users } from 'lucide-react';
import { BarChart, Bar, CartesianGrid, Cell, LineChart, Line, PieChart, Pie, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { buildPoolObservations, observationRange } from '../utils/poolObservationStats.js';
import { targetProbabilityDistribution } from '../utils/targetProbabilityDistribution.js';
import { LIMITED_POOL_RULES, WEAPON_POOL_RULES } from '../constants/index.js';
import { PREVIEW_ACCOUNTS, PREVIEW_ITEMS, PREVIEW_POOLS, PREVIEW_RECORDS } from './statisticsPreviewData.js';

const pct = (value) => `${(value * 100).toFixed(1)}%`;
const axisPct = (value) => `${Math.round(value * 100)}%`;
const decimal = (value) => value === null ? '—' : Number(value).toFixed(1);
const tooltipStyle = { background: 'var(--ex-surface)', border: '1px solid var(--ex-border)', color: 'var(--ex-ink)', fontSize: 12 };
const axis = { fontSize: 11, fill: 'var(--ex-muted)' };

function ChartCard({ number, title, subtitle, caption, children }) {
  return <section className="ex-chart" aria-label={title} data-chart={number}>
    <header className="ex-chart-head"><div><h3>{title}</h3><p>{subtitle}</p></div><span className="ex-chart-number">{number}</span></header>
    <div className="ex-chart-frame">{children}</div>
    <div className="ex-chart-caption">{caption}</div>
  </section>;
}

function Bars({ data, valueKey, percent = false, t }) {
  return data.length ? <ResponsiveContainer width="100%" height="100%">
    <BarChart data={data} layout="vertical" margin={{ top: 5, right: 22, left: 0, bottom: 18 }} accessibilityLayer>
      <CartesianGrid horizontal={false} stroke="var(--ex-border)" strokeDasharray="3 4" />
      <XAxis type="number" tick={axis} tickFormatter={percent ? pct : undefined} axisLine={false} tickLine={false}
        label={{ value: percent ? t('单抽出率 (%)', 'Drop rate (%)') : t('有效抽数 (抽)', 'Effective pulls'), position: 'insideBottom', offset: -14, ...axis }} />
      <YAxis type="category" dataKey="name" width={94} tick={axis} tickLine={false} axisLine={false} />
      <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--ex-subtle)' }} formatter={(value) => percent ? pct(value) : `${decimal(value)} ${t('抽', 'pulls')}`} />
      <Bar dataKey={valueKey} name={percent ? t('出率', 'Rate') : t('平均花费', 'Mean cost')} isAnimationActive={false} barSize={14}>
        {data.map((item) => <Cell key={item.itemId} fill={item.color} />)}
      </Bar>
    </BarChart>
  </ResponsiveContainer> : <div className="ex-empty">{t('该口径没有已完成样本，可切换卡池。', 'No completed samples. Try another banner.')}</div>;
}

function Curves({ series, start, end, cumulative, t }) {
  const populated = series.filter((entry) => entry.summary.sampleCount > 0);
  const data = Array.from({ length: end - start + 1 }, (_, i) => ({ cost: i + start }));
  populated.forEach((entry) => observationRange(entry.summary, start, end).forEach((point, i) => {
    data[i][entry.itemId] = cumulative ? point.cumulativeRate : point.count;
  }));
  return populated.length ? <ResponsiveContainer width="100%" height="100%">
    <LineChart data={data} margin={{ top: 12, right: 18, left: 0, bottom: 20 }} accessibilityLayer>
      <CartesianGrid stroke="var(--ex-border)" strokeDasharray="3 4" />
      <XAxis type="number" dataKey="cost" domain={[start, end]} tick={axis} tickLine={false}
        label={{ value: t('有效抽数 (抽)', 'Effective pulls'), position: 'insideBottom', offset: -14, ...axis }} />
      <YAxis domain={cumulative ? [0, 1] : [0, 'auto']} ticks={cumulative ? [0, 0.25, 0.5, 0.75, 1] : undefined} tick={axis} tickFormatter={cumulative ? axisPct : undefined} allowDecimals={cumulative} width={56}
        label={cumulative ? undefined : { value: t('次', 'N'), position: 'insideTopLeft', offset: 6, ...axis }} />
      <Tooltip contentStyle={tooltipStyle} labelFormatter={(label) => `${label} ${t('抽', 'pulls')}`} formatter={(value) => cumulative ? pct(value) : value} />
      {populated.map((entry) => <Line key={entry.itemId} dataKey={entry.itemId} name={entry.name} stroke={entry.color}
        type={cumulative ? 'stepAfter' : 'linear'} strokeWidth={1.8} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />)}
    </LineChart>
  </ResponsiveContainer> : <div className="ex-empty">{t('没有可展示的已完成样本，或所有系列已隐藏。', 'No completed samples, or all series are hidden.')}</div>;
}

function Theory({ weapon, t }) {
  const [currentPity, setCurrentPity] = useState(0);
  const [guaranteeProgress, setGuaranteeProgress] = useState(0);
  const [used, setUsed] = useState(false);
  const rules = weapon ? WEAPON_POOL_RULES : LIMITED_POOL_RULES;
  const unitLabel = weapon ? t('次申领', 'claims') : t('抽', 'pulls');
  const [horizon, setHorizon] = useState(weapon ? 24 : 180);
  const result = useMemo(() => targetProbabilityDistribution({
    rules, unit: weapon ? 'claim' : 'pull', currentPity, guaranteeProgress, guaranteeUsed: used, horizon,
  }), [rules, weapon, currentPity, guaranteeProgress, used, horizon]);
  const maxPity = weapon ? 3 : 79;
  const maxGuarantee = weapon ? 7 : 119;
  return <section className="ex-theory">
    <div className="ex-filters">
      <label className="ex-field">{t('距上次六星', 'Since last six-star')}<input aria-label={t('当前保底', 'Current pity')} type="number" value={currentPity} min="0" max={maxPity} onChange={(e) => setCurrentPity(Math.max(0, Math.min(maxPity, Math.trunc(Number(e.target.value)))))} /></label>
      <label className="ex-field">{t('本期保障已累计', 'Banner guarantee progress')}<input aria-label={t('保障累计', 'Guarantee progress')} type="number" value={guaranteeProgress} min="0" max={maxGuarantee} disabled={used} onChange={(e) => setGuaranteeProgress(Math.max(0, Math.min(maxGuarantee, Math.trunc(Number(e.target.value)))))} /></label>
      <label className="ex-field">{t('一次性保障状态', 'One-time guarantee')}<select aria-label={t('一次性保障状态', 'One-time guarantee')} value={used ? 'used' : 'available'} onChange={(e) => setUsed(e.target.value === 'used')}><option value="available">{t('尚未获得本期目标', 'Featured target not yet obtained')}</option><option value="used">{t('已获得，预测再次获得', 'Already obtained; predict another')}</option></select></label>
      <label className="ex-field">{t('预测范围', 'Prediction horizon')}<input aria-label={t('预测范围', 'Prediction horizon')} type="number" value={horizon} min="1" max={weapon ? 60 : 400} onChange={(e) => setHorizon(Math.max(1, Math.min(weapon ? 60 : 400, Math.trunc(Number(e.target.value)))))} /></label>
    </div>
    <p className="ex-intro">{t('目标为本期 UP 六星，计数单位：', 'Target: featured six-star. Counting unit: ')}{unitLabel}{t('。从上述状态继续抽取；不计免费十连和额外赠送。首次均指本期卡池内首次获得。', '. Continues from the selected state; excludes free batches and gifts. First acquisition is scoped to this banner period.')}</p>
    <div className="ex-meta">
      <div><b>{pct(result.points.at(-1).cumulativeRate)}</b><span>{t('范围内获得概率', 'Probability within horizon')}</span></div>
      <div><b>{decimal(result.expectedCapped)} {unitLabel}</b><span>{result.expectationIsComplete ? t('期望花费', 'Expected cost') : t('截断期望下界，非完整期望', 'Capped expectation; a lower bound')}</span></div>
      <div><b>{pct(result.tailProbability)}</b><span>{t('范围外剩余概率', 'Probability beyond horizon')}</span></div>
    </div>
    <div className="ex-curves">
      {[true, false].map((cdf) => <ChartCard key={String(cdf)} number={cdf ? 'T1' : 'T2'} title={cdf ? t('目标获得 · 理论累计概率', 'Target acquisition · Theoretical CDF') : t('目标获得 · 理论花费分布', 'Target acquisition · Probability by cost')}
        subtitle={weapon ? t('武器申领 · 预留六星槽模型估计', 'Weapon claims · Reserved-slot model estimate') : t('角色寻访 · 保底状态逐步递推', 'Character pulls · Pity-state recurrence')}
        caption={t('根据规则模型计算，不是玩家样本统计。', 'Calculated from a rule model, not player observations.')}>
        <ResponsiveContainer width="100%" height="100%"><LineChart data={result.points} margin={{ top: 12, right: 20, left: 0, bottom: 20 }} accessibilityLayer>
          <CartesianGrid stroke="var(--ex-border)" strokeDasharray="3 4" /><XAxis dataKey="cost" type="number" domain={[0, horizon]} tick={axis} label={{ value: unitLabel, position: 'insideBottom', offset: -14, ...axis }} />
          <YAxis tickFormatter={cdf ? axisPct : pct} tick={axis} domain={cdf ? [0, 1] : [0, 'auto']} ticks={cdf ? [0, 0.25, 0.5, 0.75, 1] : undefined} width={64} />
          <Tooltip contentStyle={tooltipStyle} formatter={pct} labelFormatter={(value) => `${value} ${unitLabel}`} />
          <Line dataKey={cdf ? 'cumulativeRate' : 'probability'} name={t('目标获得概率', 'Target probability')} type="stepAfter" stroke="var(--ex-chart-accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart></ResponsiveContainer>
      </ChartCard>)}
    </div>
    {weapon && <p className="ex-intro">{t('模型边界：规则原文保证第 4 次申领出六星，但未公开十连内部生成过程。此处沿用现有模拟器的预留六星槽假设，不将模型估计标为官方精确概率。', 'Model limit: the rules guarantee a six-star on claim four, but do not publish the internal generation process. This uses the simulator’s reserved-slot assumption, not an official exact probability.')}</p>}
  </section>;
}

function GuidePreview({ t }) {
  const [state, setState] = useState('guest');
  const [skipped, setSkipped] = useState(false);
  const [feedback, setFeedback] = useState('');
  const states = [
    ['guest', t('游客', 'Guest')], ['empty', t('已登录，无记录', 'Signed in, no records')],
    ['ready', t('已有数据', 'Has records')], ['partial', t('导入待核对', 'Import needs review')],
  ];
  const copy = {
    guest: [t('从你的第一份记录开始', 'Start with your first import'), t('登录后选择游戏账号与区服，再导入抽卡记录。也可以先浏览全服统计。', 'Sign in, select your game account and region, then import history. You can also browse global statistics first.'), t('登录并导入', 'Sign in and import')],
    empty: [t('下一步：导入抽卡记录', 'Next: import your history'), t('选择账号与区服后开始导入。完成后会自动为这个账号准备个人分析。', 'Select an account and region before importing. Personal analysis will be prepared for this account.'), t('选择账号并导入', 'Choose account and import')],
    ready: [t('记录已就绪，开始了解你的寻访', 'Your history is ready to explore'), t('从个人分析选择具体卡池，查看获得记录、花费和分布。建议保留一份导出备份。', 'Choose a banner in personal analysis to explore acquisitions, costs and distributions. Keep an exported backup.'), t('查看我的分析', 'Open personal analysis')],
    partial: [t('部分记录已保存，还有内容待核对', 'Some records are saved; review is needed'), t('先查看本次导入结果。已保存记录会保留，失败的卡池可重试，不必重复全部步骤。', 'Review the import result. Saved records remain available; retry failed banners without restarting the entire flow.'), t('查看导入结果', 'Review import result')],
  }[state];
  const steps = [
    [t('登录与选择账号', 'Sign in and choose an account'), t('确认游戏账号、区服，避免将不同账号记录混在一起。', 'Confirm the game account and region to keep histories separate.')],
    [t('导入你的记录', 'Import your history'), t('按照导入窗口的说明操作，遇到错误可继续或重试。', 'Follow the import window. Errors include a resume or retry action.')],
    [t('查看个人分析', 'Explore personal analysis'), t('选一个卡池，从获得记录逐步查看详细图表。', 'Pick a banner and explore its records and detailed charts.')],
    [t('导出一份备份', 'Export a backup'), t('随时保存记录，便于迁移和离线留存。', 'Save a copy for migration and offline storage.')],
  ];
  return <>
    <div className="ex-heading dp-workspace-heading"><div className="ex-heading-icon"><BookOpen size={22} aria-hidden="true" /></div><div><h1>{t('使用指南', 'Getting started')}</h1><p>{t('从导入记录到查看分析与导出备份，随时可以跳过或重新查看。', 'Import your history, explore analysis and export a backup. Skip or return at any time.')}</p></div></div>
    <div className="ex-controls"><span className="ex-muted">{t('预览用户状态', 'Preview user state')}</span>{states.map(([id, label]) => <button key={id} aria-pressed={state === id} onClick={() => { setState(id); setFeedback(''); }}>{label}</button>)}</div>
    {skipped ? <div className="ex-guide-next" style={{ marginTop: 24 }}><h2>{t('指南已收起', 'Guide dismissed')}</h2><p>{t('正式版本会保留正常导航，可从首页或帮助入口重新查看。', 'Normal navigation stays available. Reopen the guide from home or help.')}</p><button onClick={() => setSkipped(false)}>{t('重新查看指南', 'Reopen guide')}</button></div> : <div className="ex-guide-layout">
      <div><section className="ex-guide-next"><p className="ex-eyebrow">YOUR NEXT STEP</p><h2>{copy[0]}</h2><p>{copy[1]}</p>
        <div className="ex-controls"><button className="ex-primary" onClick={() => setFeedback(t('布局预览：此动作将在接入阶段连接现有业务入口。没有进行登录、导入或数据写入。', 'Layout preview: this action will connect to the existing app flow. No sign-in, import or data write occurred.'))}>{copy[2]} →</button><button onClick={() => setSkipped(true)}>{t('暂时跳过', 'Skip for now')}</button></div>
        {feedback && <p role="status" className="ex-feedback">{feedback}</p>}
      </section><ol className="ex-steps">{steps.map(([title, desc], index) => <li key={title}><span className="ex-step-index">0{index + 1}</span><div><h3>{title}</h3><p>{desc}</p></div></li>)}</ol></div>
      <aside className="ex-guide-aside"><h2>{t('需要时再了解', 'Read when you need it')}</h2>
        {[
          [t('个人分析与全服统计有什么区别？', 'Personal vs global statistics?'), t('个人分析只展示当前游戏账号的记录；全服统计展示参与样本的汇总，不等于全部玩家。', 'Personal analysis uses the selected game account. Global statistics summarize participating samples, not all players.')],
          [t('导入失败会丢失记录吗？', 'Does a failed import lose records?'), t('查看导入结果中的已保存与失败部分，再针对失败部分重试。不要将关闭提示当作导入完成。', 'Review the saved and failed portions, then retry the failed portion. Closing a message does not complete an import.')],
          [t('为什么部分图表没有曲线？', 'Why can a chart be empty?'), t('没有可判定的样本时会说明原因。不会把缺失记录当成零，也不会用理论预测代替真实记录。', 'When samples are unavailable, the chart explains why. Missing records are not zeros, and theoretical predictions never replace observations.')],
        ].map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}
      </aside>
    </div>}
  </>;
}

export default function StatisticsExperiencePreview() {
  const [english, setEnglish] = useState(false);
  const [dark, setDark] = useState(false);
  const [page, setPage] = useState('stats');
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 700px)').matches);
  const [poolId, setPoolId] = useState(PREVIEW_POOLS[0].id);
  const [source, setSource] = useState('all');
  const [tab, setTab] = useState('observed');
  const [range, setRange] = useState([0, 210]);
  const [hidden, setHidden] = useState([]);
  const t = (zh, en) => english ? en : zh;
  const nameOf = (id) => PREVIEW_ITEMS[id].name[english ? 1 : 0];
  const pool = PREVIEW_POOLS.find((item) => item.id === poolId);
  const stats = useMemo(() => buildPoolObservations({
    records: PREVIEW_RECORDS, poolId, accountKey: source === 'all' ? null : PREVIEW_ACCOUNTS[0],
    completeAccounts: PREVIEW_ACCOUNTS,
  }), [poolId, source]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 700px)');
    const update = () => setMobile(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    // 独立预览沿用主站的 class 深色主题与字体规则，不写入用户的显示偏好。
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.dataset.locale = english ? 'en-US' : 'zh-CN';
    document.documentElement.lang = english ? 'en' : 'zh-CN';
  }, [dark, english]);
  const series = stats.items.filter((item) => item.rarity === 6).map((item) => ({ ...item, name: nameOf(item.itemId), color: PREVIEW_ITEMS[item.itemId].color }));
  const shown = series.filter((item) => !hidden.includes(item.itemId));
  const rarityData = stats.rarities.map((item) => ({ ...item, name: `${item.rarity}★`, color: { 6: '#f59e0b', 5: '#a855f7', 4: '#60a5fa' }[item.rarity] }));
  const legend = <div className="ex-legend">{shown.map((item) => <span key={item.itemId}><i className="ex-dot" style={{ background: item.color }} />{item.name}</span>)}</div>;
  return <div className="experience-ui hl-theme dp-shell" data-theme={dark ? 'dark' : 'light'} data-variant={mobile ? 'mobile' : 'desktop'} lang={english ? 'en' : 'zh-CN'}>
    <header className="hl-header ex-site-header"><div className="hl-header-inner">
      <div className="hl-brand"><span><BarChart3 size={23} strokeWidth={2.5} aria-hidden="true" /></span><div><strong>ENDFIELD <em>GACHA</em></strong><small>{t('终末地抽卡观测站', 'GACHA OBSERVATORY')}</small></div></div>
      <nav className="ex-preview-nav" aria-label={t('预览导航', 'Preview navigation')}>
        <button className="hl-nav-trigger" aria-current={page === 'stats' ? 'page' : undefined} onClick={() => setPage('stats')}><BarChart3 size={16} aria-hidden="true" />{t('分池统计', 'Banner statistics')}</button>
        <button className="hl-nav-trigger" aria-current={page === 'guide' ? 'page' : undefined} onClick={() => setPage('guide')}><BookOpen size={16} aria-hidden="true" />{t('使用指南', 'Getting started')}</button>
      </nav>
      <div className="ex-display-options"><button className="hl-nav-trigger" aria-label={dark ? t('浅色', 'Light') : t('深色', 'Dark')} title={dark ? t('浅色', 'Light') : t('深色', 'Dark')} onClick={() => setDark(!dark)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button><button className="hl-nav-trigger" onClick={() => setEnglish(!english)}><Languages size={16} aria-hidden="true" />{english ? '中文' : 'English'}</button></div>
    </div></header>
    <main className="ex-main dp-main"><div className="ex-workspace-context"><span>{t('分析工作区', 'Analysis workspace')}</span><ChevronRight size={13} aria-hidden="true" /><span>{page === 'stats' ? t('分卡池详细统计', 'Banner detail statistics') : t('使用指南', 'Getting started')}</span><span className="ex-preview-badge">{t('布局预览', 'Layout preview')}</span></div>
      <p className="ex-preview-note"><FlaskConical size={15} aria-hidden="true" />{t('本地布局预览 · 全部记录均为构造样本，不代表真实玩家或全服结果', 'LOCAL PREVIEW · All records are constructed samples, not real player or global results')}</p>
      {page === 'guide' ? <GuidePreview t={t} /> : <>
        <div className="ex-heading dp-workspace-heading"><div className="ex-heading-icon"><BarChart3 size={22} aria-hidden="true" /></div><div><h1>{t('分卡池详细统计', 'Banner detail statistics')}</h1><p>{t('查看每期卡池的出率与获得花费，分别阅读记录分布和理论预测。', 'Explore drop rates and acquisition costs by banner, with separate observations and predictions.')}</p></div></div>
        <div className="ex-filters">
          <label className="ex-field">{t('具体卡池', 'Banner')}<select aria-label={t('具体卡池', 'Banner')} value={poolId} onChange={(e) => { setPoolId(e.target.value); setHidden([]); }}>{PREVIEW_POOLS.map((item) => <option key={item.id} value={item.id}>{item.name[english ? 1 : 0]}</option>)}</select></label>
          <label className="ex-field">{t('样例范围', 'Sample scope')}<select aria-label={t('样例范围', 'Sample scope')} value={source} onChange={(e) => setSource(e.target.value)}><option value="all">{t('36 个样例账号汇总', '36 sample accounts')}</option><option value="one">{t('单个样例账号', 'One sample account')}</option></select></label>
          <p className="ex-sidebar-hint">{t('首次均指同一对象在本期卡池内首次获得。', 'First acquisition always means the first copy of an item within this banner period.')}</p>
        </div>
        <div className="ex-meta"><div><Layers className="ex-metric-icon" aria-hidden="true" /><span>{t('有效抽取结果', 'Effective pull results')}</span><b>{stats.total.toLocaleString()}</b></div><div><Users className="ex-metric-icon" aria-hidden="true" /><span>{t('样例账号', 'Sample accounts')}</span><b>{stats.participatingAccounts}</b></div><div><Gift className="ex-metric-icon" aria-hidden="true" /><span>{t('其中免费十连结果', 'Free-batch results')}</span><b>{stats.free}</b></div><div><Ticket className="ex-metric-icon" aria-hidden="true" /><span>{t('其中情报书结果', 'Intel-ticket results')}</span><b>{stats.infoBook}</b></div></div>
        <nav className="ex-tabs" aria-label={t('统计模式', 'Analysis mode')}><button aria-pressed={tab === 'observed'} onClick={() => setTab('observed')}>{t('真实记录图表 · 构造样例', 'Observation charts · Sample')}</button><button aria-pressed={tab === 'theory'} onClick={() => setTab('theory')}>{t('理论预测', 'Theoretical prediction')}</button></nav>
        {tab === 'theory' ? <Theory key={poolId} weapon={pool.weapon} t={t} /> : <>
          <div className="ex-chart-grid" style={{ marginTop: 22 }}>
            <ChartCard number="01" title={t('各星级单抽出率', 'Drop rate by rarity')} subtitle={t('分母为全部有效抽取结果', 'Denominator: all effective pulls')} caption={<div className="ex-legend">{rarityData.map((item) => <span key={item.rarity}><i className="ex-dot" style={{ background: item.color }} />{item.name} {pct(item.rate)}</span>)}</div>}>
              <ResponsiveContainer width="100%" height="100%"><PieChart accessibilityLayer><Pie data={rarityData} dataKey="count" nameKey="name" outerRadius="82%" stroke="var(--ex-surface)" isAnimationActive={false}>{rarityData.map((item) => <Cell key={item.rarity} fill={item.color} />)}</Pie><Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [`${value} · ${pct(value / stats.total)}`, name]} /></PieChart></ResponsiveContainer>
            </ChartCard>
            <ChartCard number="02" title={pool.weapon ? t('各武器单抽出率', 'Drop rate by weapon') : t('各干员单抽出率', 'Drop rate by operator')} subtitle={t('包含各星级对象', 'All rarities included')} caption={t('按稳定对象 ID 计数；名称仅作标签。', 'Counted by stable item identity.')}>
              <Bars t={t} percent valueKey="rate" data={stats.items.map((item) => ({ ...item, name: nameOf(item.itemId), color: PREVIEW_ITEMS[item.itemId].color }))} />
            </ChartCard>
            {['first', 'repeat'].map((kind, index) => <ChartCard key={kind} number={`0${index + 3}`} title={kind === 'first' ? t('首次获得 · 平均花费', 'First acquisition · Mean cost') : t('非首次获得 · 平均花费', 'Repeat acquisition · Mean cost')} subtitle={t('六星对象 · 可判定的已完成样本', 'Six-star items · Known completed samples')} caption={t('平均值不包含未完成或起点未知的区间。', 'Unfinished or unknown-start intervals are excluded.')}>
              <Bars t={t} valueKey="mean" data={series.filter((item) => item[kind].sampleCount > 0).map((item) => ({ ...item, mean: item[kind].mean }))} />
            </ChartCard>)}
          </div>
          <div className="ex-curve-tools"><div><h2>{t('获得花费的完整分布', 'Acquisition costs, in detail')}</h2><div className="ex-controls ex-series" style={{ marginTop: 12 }}>{series.map((item) => <label key={item.itemId}><input type="checkbox" checked={!hidden.includes(item.itemId)} onChange={() => setHidden(hidden.includes(item.itemId) ? hidden.filter((id) => id !== item.itemId) : [...hidden, item.itemId])} /><i className="ex-dot" style={{ background: item.color }} />{item.name}</label>)}</div></div>
            <div className="ex-range"><span>{t('抽数范围', 'Pull range')}</span><input aria-label={t('起始抽数', 'Range start')} type="number" min="0" max={range[1] - 1} value={range[0]} onChange={(e) => setRange([Math.max(0, Math.min(range[1] - 1, Math.trunc(Number(e.target.value)))), range[1]])} /><span>—</span><input aria-label={t('结束抽数', 'Range end')} type="number" min={range[0] + 1} max="250" value={range[1]} onChange={(e) => setRange([range[0], Math.min(250, Math.max(range[0] + 1, Math.trunc(Number(e.target.value))))])} /><input type="range" aria-label={t('缩放结束抽数', 'Zoom range end')} min={range[0] + 1} max="250" value={range[1]} onChange={(e) => setRange([range[0], Number(e.target.value)])} /><button onClick={() => setRange([0, 210])}>{t('重置', 'Reset')}</button></div>
          </div>
          <div className="ex-curves">{[['first', true], ['first', false], ['repeat', true], ['repeat', false]].map(([kind, cumulative], index) => <ChartCard key={index} number={`0${index + 5}`} title={`${kind === 'first' ? t('首次获得', 'First acquisition') : t('非首次获得', 'Repeat acquisition')} · ${cumulative ? t('累计达成率', 'Cumulative share') : t('花费抽数分布', 'Cost distribution')}`}
            subtitle={`${t('已完成样本', 'Completed samples')}: ${shown.reduce((sum, item) => sum + item[kind].sampleCount, 0)} · ${cumulative ? t('各对象分别计算分母', 'Separate denominator per item') : t('纵轴为获得次数', 'Y axis: acquisition count')}`} caption={legend}>
            <Curves series={shown.map((item) => ({ ...item, summary: item[kind] }))} start={range[0]} end={range[1]} cumulative={cumulative} t={t} />
          </ChartCard>)}</div>
          <details className="ex-details"><summary>{t('这些图表如何计算？', 'How are these charts calculated?')}</summary>
            <p>{t('有效抽数包含普通抽取、免费十连与情报书结果；赠送不影响本期卡池内首次。资源消耗和保底推进是不同口径。', 'Effective pulls include normal, free-batch and intel-ticket results. Gifts do not affect first acquisition within the banner. Resource cost and pity progression are separate measures.')}</p>
            <p>{t('累计图仅表示已完成样本中的达成比例，不是全体玩家的成功概率。切换范围不重算分母。', 'The cumulative chart is conditional on completed samples, not the probability of success for all players. Changing the range does not change denominators.')}</p>
            <p>{t('样例记录完整；正式数据接入仍需证明覆盖范围。未完成的重复区间数：', 'Samples have complete history; real imports still need coverage evidence. Unfinished repeat intervals: ')}{series.reduce((sum, item) => sum + item.repeatUnfinished, 0)}</p>
          </details>
        </>}
      </>}
      <footer className="ex-footer"><span>ENDFIELD GACHA <span> / {t('终末地抽卡分析器', 'Gacha Analyzer')}</span></span><span>{t('构造样例 · 不连接账号或生产数据 · 2026-09-19', 'Constructed samples · No account or production data · 2026-09-19')}</span></footer>
    </main>
  </div>;
}
