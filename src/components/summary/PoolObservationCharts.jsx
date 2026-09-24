import React, { useEffect, useRef, useState } from 'react';
import { ChartNoAxesCombined, ChartPie, ChartBar, ScanLine, Repeat2, Sparkles, Users, BetweenHorizontalStart } from 'lucide-react';
import { BarChart, Bar, CartesianGrid, Cell, LabelList, LineChart, Line, PieChart, Pie, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { observationRange } from '../../utils/poolObservationStats.js';
import { observationFrequencyBins } from '../../utils/observationInsights.js';
import { characterCache, resolveCharacterRecordByName } from '../../utils/characterUtils.js';
import { getPoolFeaturedNames } from '../../utils/poolFeaturedResolver.js';
import { resolvePoolCapabilities } from '../../utils/poolCapabilities.js';
import { buildObservationItemOptions, isObservationSeriesSelected } from '../../utils/observationItemDisplay.js';
import { TargetOverview, AccountCoverage, CostIntervals, DistributionReadout } from './PoolObservationInsights.jsx';

const percent = (value) => `${(value * 100).toFixed(1)}%`;
const axis = { fontSize: 11, fill: 'var(--ex-muted)' };
const tooltipStyle = { background: 'var(--ex-surface)', border: '1px solid var(--ex-border)', color: 'var(--ex-ink)', fontSize: 12 };

function Card({ id, title, subtitle, children, caption, tone = 'neutral', icon = ChartBar }) {
  const element = useRef(null);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setEntered(true); observer.disconnect(); }
    }, { threshold: 0.08 });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  return <section ref={element} className="ex-chart" data-chart={id} data-tone={tone} data-entered={entered} aria-label={title}>
    <header className="ex-chart-head"><span className="ex-chart-symbol" aria-hidden="true">{React.createElement(icon, { size: 17 })}</span><div><h3>{title}</h3><p>{subtitle}</p></div><span className="ex-chart-number" aria-hidden="true">{id}</span></header>
    {children}<div className="ex-chart-caption">{caption}</div>
  </section>;
}

function SectionHeading({ title, description, icon }) {
  return <div className="ex-section-heading"><span aria-hidden="true">{React.createElement(icon, { size: 18 })}</span><div><h2>{title}</h2><p>{description}</p></div></div>;
}

function Bars({ data, rate = false, unit, t }) {
  const formatValue = (value) => rate ? `${(Number(value) * 100).toFixed(2)}%` : Number(value).toFixed(1);
  return <div className="ex-chart-scroll"><div className="ex-chart-frame" style={{ height: Math.max(218, data.length * 30 + 48) }}>
    {!data.length ? <div className="ex-empty">{t('没有可确定花费的已完成样本。', 'No completed samples with a known cost.')}</div> :
      <ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ top: 8, right: 64, bottom: 20 }} accessibilityLayer>
        <CartesianGrid horizontal={false} stroke="var(--ex-border)" strokeDasharray="3 4" />
        <XAxis type="number" tick={axis} tickFormatter={rate ? percent : undefined} axisLine={false} tickLine={false}
          label={{ value: rate ? t('单个结果出率', 'Rate per result') : unit, position: 'insideBottom', offset: -14, ...axis }} />
        <YAxis type="category" dataKey="name" width={100} tick={axis} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--ex-subtle)' }} formatter={(value) => rate ? formatValue(value) : `${formatValue(value)} ${unit}`} />
        <Bar dataKey={rate ? 'rate' : 'mean'} name={rate ? t('出率', 'Rate') : t('平均花费', 'Mean cost')} barSize={10} radius={[0, 3, 3, 0]} isAnimationActive={false}>
          {data.map((item) => <Cell key={item.itemId} fill={item.color} />)}
          <LabelList dataKey={rate ? 'rate' : 'mean'} position="right" offset={8} formatter={formatValue}
            fill="var(--ex-ink)" fontSize={11} fontWeight={600} />
        </Bar>
      </BarChart></ResponsiveContainer>}
  </div></div>;
}

function Curves({ series, start, end, cumulative, binSize, unit, t }) {
  const populated = series.filter((item) => item.summary.sampleCount > 0);
  const data = cumulative ? Array.from({ length: end - start + 1 }, (_, i) => ({ cost: start + i }))
    : observationFrequencyBins(null, start, end, binSize);
  populated.forEach((item, index) => (cumulative ? observationRange(item.summary, start, end) : observationFrequencyBins(item.summary, start, end, binSize)).forEach((point, i) => {
    data[i][`s${index}`] = cumulative ? point.cumulativeRate : point.count;
  }));
  return <div className="ex-chart-frame">{!populated.length ? <div className="ex-empty">{t('没有可展示的已完成样本，或所有对象已隐藏。', 'No completed samples, or all items are hidden.')}</div> :
    <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 12, right: 18, bottom: 20 }} accessibilityLayer>
      <CartesianGrid stroke="var(--ex-border)" strokeDasharray="3 4" />
      <XAxis dataKey="cost" type="number" domain={[start, end]} tick={axis} label={{ value: unit, position: 'insideBottom', offset: -14, ...axis }} />
      <YAxis domain={cumulative ? [0, 1] : [0, 'auto']} ticks={cumulative ? [0, 0.25, 0.5, 0.75, 1] : undefined}
        tickFormatter={cumulative ? (value) => `${Math.round(value * 100)}%` : undefined} allowDecimals={cumulative} tick={axis} width={56} />
      <Tooltip contentStyle={tooltipStyle} labelFormatter={(value, payload) => {
        const point = payload?.[0]?.payload;
        return `${!cumulative && point && point.from !== point.to ? `${point.from}–${point.to}` : value} ${unit}`;
      }} formatter={(value) => cumulative ? percent(value) : value} />
      {populated.map((item, index) => <Line key={item.itemId} dataKey={`s${index}`} name={item.name} stroke={item.color} type={cumulative ? 'stepAfter' : 'linear'}
        strokeWidth={1.8} dot={data.length === 1 ? { r: 3 } : false} activeDot={{ r: 4 }} isAnimationActive={false} />)}
    </LineChart></ResponsiveContainer>}</div>;
}

export default function PoolObservationCharts({ stats, pool = null, english = false, weapon = false, t }) {
  const grouped = stats.scopeKind === 'group';
  const [rarity, setRarity] = useState('6');
  const [seriesMode, setSeriesMode] = useState(grouped ? 'all' : 'recommended');
  const [seriesOverrides, setSeriesOverrides] = useState({});
  const [range, setRange] = useState([0, weapon ? 300 : 240]);
  const [focusId, setFocusId] = useState('');
  const [binSize, setBinSize] = useState(10);
  const [threshold, setThreshold] = useState(80);
  const [directoryReady, setDirectoryReady] = useState(() => characterCache.loaded);
  useEffect(() => {
    if (grouped) return undefined;
    let active = true;
    characterCache.load().then(() => { if (active) setDirectoryReady(true); });
    return () => { active = false; };
  }, [grouped]);
  const unit = stats.costUnit === 'stored-results' ? t('已记录结果数', 'Recorded results') : t('有效抽数', 'Effective pulls');
  const featuredNames = resolvePoolCapabilities(pool).targetMode === 'none' ? [] : getPoolFeaturedNames(pool, { entities: stats.items.map((item) => ({ ...item, id: item.itemId })) });
  const options = grouped ? stats.items.map((item) => ({ ...item, name: english ? item.nameEn : item.name, group: item.itemId })) : buildObservationItemOptions({ items: stats.items, featuredNames, english,
    resolveRecord: (value) => directoryReady ? resolveCharacterRecordByName(value, { fuzzy: false }) : null });
  const all = options.filter((item) => !item.missing);
  const featured = options.filter((item) => item.group === 'featured');
  const featuredIds = featured.map((item) => item.itemId);
  const focus = options.find((item) => item.itemId === focusId) || options[0];
  const selected = all.filter((item) => rarity === 'all' || item.rarity === Number(rarity));
  const shown = selected.filter((item) => isObservationSeriesSelected(item, { mode: seriesMode, overrides: seriesOverrides, hasTargets: featured.length > 0 }));
  const onlyFeatured = seriesMode === 'featured' && Object.keys(seriesOverrides).length === 0;
  const reading = shown.find((item) => item.itemId === focus?.itemId) || shown[0];
  const selectFocus = (id) => {
    setFocusId(id);
    const item = options.find((entry) => entry.itemId === id);
    if (item && rarity !== 'all' && item.rarity !== Number(rarity)) setRarity(String(item.rarity));
    setSeriesOverrides((old) => ({ ...old, [id]: true }));
  };
  const changeRarity = (value) => {
    if (seriesMode === 'featured') {
      // Preserve the current six-star choices while lower rarities use their own defaults.
      setSeriesOverrides((old) => ({ ...old, ...Object.fromEntries(selected.map((item) => [item.itemId, shown.some((entry) => entry.itemId === item.itemId)])) }));
      setSeriesMode('recommended');
    }
    setRarity(value);
  };
  const sixTotal = stats.rarities.find((item) => item.rarity === 6)?.count || 0;
  const compositionTotal = grouped ? sixTotal : stats.total;
  const rarities = grouped ? all.map((item) => ({ ...item, rarity: item.itemId, rate: sixTotal ? item.count / sixTotal : 0 })) : stats.rarities.map((item) => ({ ...item, name: `${item.rarity}★`, color: { 6: '#d99a16', 5: '#8074bc', 4: '#5485c5' }[item.rarity] }));
  const legend = <div className="ex-legend">{shown.map((item) => <span key={item.itemId}><i className="ex-dot" style={{ background: item.color }} />{item.name}</span>)}</div>;
  const completedCaption = t('首次从本期第一条已导入记录计数，后续从上次获得计数；均值只含已获得样本。', 'First cost starts at the first imported result in this banner; repeats start at the previous copy. Means include acquired samples only.');
  return <div className="ex-observation-report">
    {!grouped && <TargetOverview options={options} item={focus} onSelect={selectFocus} accounts={stats.participatingAccounts} featuredIds={featuredIds} directoryReady={directoryReady} unit={unit} t={t} />}
    {grouped && <p className="ex-group-explanation">{t('各期分别按账号与具体对象计算首次、后续花费，再按六星身份合并。一个账号可贡献多个对象、多个期次的样本；样本数不等于账号数。', 'First and repeat costs are calculated for each account, banner period and item, then combined by six-star role. One account can contribute multiple samples across items and periods.')}</p>}
    <div className="ex-report-toolbar"><div><ScanLine size={16} aria-hidden="true" /><span>{t('本期记录分析', 'Banner record analysis')}</span><small>{t('首次与后续获得分开统计', 'First and repeat copies counted separately')}</small></div>
      {!grouped && <label className="ex-field">{t('图表对象星级', 'Item rarity')}<select aria-label={t('图表对象星级', 'Item rarity')} value={rarity} onChange={(event) => changeRarity(event.target.value)}>
      <option value="all">{t('全部星级', 'All rarities')}</option>{[6, 5, 4].map((value) => <option key={value} value={value}>{value}★</option>)}</select></label>}
    </div>
    <SectionHeading icon={ChartPie} title={t('出货构成', 'What was pulled')} description={grouped ? t('只展示六星身份类别；出率仍以全部有效结果为分母。', 'Six-star roles only; drop rates still use all valid results as the denominator.') : t('从整体星级到具体对象，查看本期出货比例。', 'Explore the share of each rarity and item in this banner.')} />
    <div className="ex-chart-grid ex-composition-grid">
      <Card id="01" icon={ChartPie} title={grouped ? t('六星身份构成', 'Six-star role mix') : t('星级占比', 'Rarity mix')} subtitle={grouped ? t('分母仅为六星结果', 'Denominator: six-star results only') : t('覆盖全部有效结果', 'All valid results')}
        caption={<div className="ex-rarity-breakdown">{rarities.map((item) => <span key={item.rarity}><i className="ex-dot" style={{ background: item.color }} /><span>{item.name}</span><b>{percent(item.rate)}</b><small>{item.count.toLocaleString(english ? 'en-US' : 'zh-CN')} {t('次', 'results')}</small></span>)}</div>}>
        <div className="ex-chart-frame ex-donut-frame">{compositionTotal ? <><ResponsiveContainer width="100%" height="100%"><PieChart accessibilityLayer>
          <Pie data={rarities} dataKey="count" nameKey="name" innerRadius="63%" outerRadius="82%" startAngle={90} endAngle={-270} paddingAngle={2} isAnimationActive={false} stroke="var(--ex-surface)">{rarities.map((item) => <Cell key={item.rarity} fill={item.color} />)}</Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(value) => `${value} · ${percent(value / compositionTotal)}`} />
        </PieChart></ResponsiveContainer><div className="ex-donut-center"><span>{t('六星占比', '6★ share')}</span><b>{percent(stats.total ? sixTotal / stats.total : 0)}</b><small>{t('占全部有效结果', 'of all valid results')}</small></div></> : <div className="ex-empty">{t('这个范围没有记录。', 'No records in this scope.')}</div>}</div>
      </Card>
      <Card id="02" title={grouped ? t('六星类别出率', 'Six-star role drop rates') : weapon ? t('武器出货对比', 'Weapon drop rates') : t('干员出货对比', 'Operator drop rates')} subtitle={t('占全部有效结果的比例', 'Share of all valid results')} caption={grouped ? t('条末显示出率，含普通、免费十连与情报书结果。', 'Rates include regular results, free batches and intel tickets.') : t('条末显示出率；切换星级不会改变分母。', 'Values at bar ends show drop rates; rarity filters keep the same denominator.')}>
        <Bars data={selected} rate unit={unit} t={t} />
      </Card>
    </div>
    <Card id="09" icon={Users} title={t('账号获得覆盖', 'Recorded account coverage')} subtitle={grouped ? t('每个类别内跨期去重，同一账号只计一次', 'Distinct accounts across periods, separately for each role') : t('每个对象在同一账号中只计一次', 'Each account counts once per item')}
      caption={t('未记录到获得不等于游戏内尚未获得；每行独立计算，不能相加。点击名称可切换关注对象。', 'No recorded acquisition does not prove in-game absence. Rows are independent and cannot be added together. Select a name to focus on it.')}>
      <AccountCoverage items={selected} accounts={stats.participatingAccounts} focusId={focus?.itemId} onSelect={selectFocus} t={t} />
    </Card>
    <SectionHeading icon={Sparkles} title={t('获得成本', 'Acquisition costs')} description={t('把本期第一份与后续重复获得分开比较。', 'Compare the first copy in this banner with subsequent copies.')} />
    <Card id="10" icon={BetweenHorizontalStart} title={t('通常在哪个区间获得', 'Typical acquisition range')} subtitle={t('结合中位数与分位区间，观察均值之外的差异', 'See variation beyond the mean with medians and percentile bands')}
      caption={t('仅含可判定花费的已完成样本；小样本下区间可能重合，请结合样本数阅读。', 'Only completed samples with known costs. Percentiles may coincide with small samples; read them alongside sample counts.')}>
      <CostIntervals items={selected} focusId={focus?.itemId} onSelect={selectFocus} unit={unit} t={t} />
    </Card>
    <div className="ex-chart-grid ex-cost-grid">
      {['first', 'repeat'].map((kind, index) => <Card key={kind} id={`0${index + 3}`} tone={kind} icon={kind === 'first' ? Sparkles : Repeat2} title={kind === 'first' ? t('本期首获均值', 'First-copy mean') : t('后续获得均值', 'Repeat-copy mean')}
        subtitle={`${t('计数单位', 'Counting unit')}: ${unit}`} caption={completedCaption}>
        <Bars data={selected.filter((item) => item[kind].sampleCount).map((item) => ({ ...item, mean: item[kind].mean }))} unit={unit} t={t} />
      </Card>)}
    </div>
    <SectionHeading icon={ChartNoAxesCombined} title={t('分布详情', 'Beyond the average')} description={t('累计曲线看进度，频数曲线看获得集中在哪些抽数。', 'Cumulative curves show progress; frequencies show where acquisitions cluster.')} />
    <div className="ex-curve-tools"><div className="ex-series-control"><div className="ex-series-heading"><span className="ex-control-label">{t('显示对象', 'Visible items')}</span><div className="ex-controls">
      {featured.length > 0 && <button aria-pressed={onlyFeatured} onClick={() => { setSeriesMode('featured'); setSeriesOverrides({}); setRarity('6'); }}>{t('只看本期目标', 'Featured only')}</button>}
      <button onClick={() => { setSeriesMode('all'); setSeriesOverrides({}); }}>{t('显示全部', 'Show all')}</button>
    </div></div><div className="ex-controls ex-series">{selected.map((item) => <label key={item.itemId} data-muted={!shown.some((entry) => entry.itemId === item.itemId)} style={{ '--series-color': item.color }}>
      <input type="checkbox" checked={shown.some((entry) => entry.itemId === item.itemId)} onChange={() => {
        setSeriesOverrides((old) => ({ ...old, [item.itemId]: !shown.some((entry) => entry.itemId === item.itemId) }));
      }} />
      <i className="ex-dot" style={{ background: item.color }} />{item.name}</label>)}</div></div>
      <div className="ex-distribution-options"><label className="ex-field">{t('解读对象', 'Readout item')}<select aria-label={t('解读对象', 'Readout item')} value={reading?.itemId || ''} disabled={!shown.length} onChange={(event) => setFocusId(event.target.value)}>
        {!shown.length && <option value="">{t('无显示对象', 'No visible items')}</option>}{shown.map((item) => <option key={item.itemId} value={item.itemId}>{item.name}</option>)}</select></label>
        <label className="ex-field">{t('频数合并区间', 'Frequency grouping')}<select aria-label={t('频数合并区间', 'Frequency grouping')} value={binSize} onChange={(event) => setBinSize(Number(event.target.value))}>{[1, 10, 20].map((size) => <option key={size} value={size}>{size === 1 ? t('逐条记录', 'Each result') : `${size} ${t('条记录一组', 'results per group')}`}</option>)}</select></label><span>{t('仅影响频数图，累计曲线保持逐条精度。', 'Only frequency charts are grouped; cumulative curves retain per-result precision.')}</span></div>
      <div className="ex-range"><span>{t('结果数范围', 'Result range')}</span>
        <input type="number" aria-label={t('起始抽数', 'Range start')} min="0" max={range[1] - 1} value={range[0]} onChange={(e) => setRange([Math.max(0, Math.min(range[1] - 1, Math.trunc(Number(e.target.value)))), range[1]])} /><span>—</span>
        <input type="number" aria-label={t('结束抽数', 'Range end')} min={range[0] + 1} max={range[0] + 2000} value={range[1]} onChange={(e) => setRange([range[0], Math.min(range[0] + 2000, Math.max(range[0] + 1, Math.trunc(Number(e.target.value))))])} />
        <input type="range" aria-label={t('缩放结束抽数', 'Zoom range end')} min={range[0] + 1} max={Math.max(500, range[1])} value={range[1]} onChange={(e) => setRange([range[0], Math.min(range[0] + 2000, Number(e.target.value))])} />
        <button onClick={() => setRange([0, weapon ? 300 : 240])}>{t('重置', 'Reset')}</button>
      </div>
    </div>
    <DistributionReadout item={reading} threshold={threshold} onThresholdChange={setThreshold} unit={unit} t={t} />
    <div className="ex-curves">{[['first', true], ['first', false], ['repeat', true], ['repeat', false]].map(([kind, cumulative], index) => <Card key={index} id={`0${index + 5}`} tone={kind} icon={kind === 'first' ? Sparkles : Repeat2}
      title={`${kind === 'first' ? t('本期首获', 'First copy') : t('后续获得', 'Repeat copies')} · ${cumulative ? t('累计分布', 'Cumulative share') : t('抽数频数', 'Pull frequencies')}`}
      subtitle={`${t('已完成样本', 'Completed samples')}: ${shown.reduce((sum, item) => sum + item[kind].sampleCount, 0)} · ${cumulative ? t('每个对象单独计算分母', 'Separate denominator per item') : `${binSize} ${t('条一组 · 获得次数', 'results / group · acquisition count')}`}`} caption={legend}>
      <Curves series={shown.map((item) => ({ ...item, summary: item[kind] }))} start={range[0]} end={range[1]} cumulative={cumulative} binSize={binSize} unit={unit} t={t} />
    </Card>)}</div>
    <details className="ex-details"><summary>{t('统计口径与未知样本', 'Definitions and unknown samples')}</summary>
      <p>{t('累计图表示可判定的已完成样本比例，不是所有玩家的成功概率；裁切范围不改变分母。', 'CDFs are conditional on known completed samples, not all-player success probabilities. Cropping does not change denominators.')}</p>
      <p>{t('首次仅指本期卡池内首次获得同一对象。有效结果包含免费十连与情报书；直接赠送不计入抽取，也不改变本期首次。', 'First acquisition is the first copy of an item within this banner period. Valid results include free batches and intel tickets; gifts are excluded and do not change banner-first status.')}</p>
      <p>{grouped ? t('逐账号、逐期、逐对象累计：分类未知 / 花费区间未知 / 未完成对象区间（非去重人数）', 'Account-period-item counts: unknown classification / unknown cost / unfinished item intervals (not distinct accounts)') : t('当前筛选对象：分类未知 / 花费区间未知 / 未完成重复区间', 'Selected items: unknown classification / unknown cost interval / unfinished repeat intervals')}：
        {selected.reduce((sum, item) => sum + item.unknownClassification, 0)} / {selected.reduce((sum, item) => sum + item.unknownCost, 0)} / {selected.reduce((sum, item) => sum + item.repeatUnfinished, 0)}</p>
    </details>
  </div>;
}
