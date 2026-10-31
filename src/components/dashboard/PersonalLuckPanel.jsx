import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, BarChart3, CircleAlert, CircleHelp, Fingerprint,
  Layers, Pause, Play, RotateCcw, ShieldCheck, Sparkles, Star, Swords, Target, UserRound, X, Zap } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import { evaluateLuckTimeline, GRADE_LABELS, GRADE_THRESHOLDS } from '../../utils/personalLuckRating.js';
import './personalLuck.css';

const EN_LABELS = { S: 'Exceptional luck', 'A+': 'Very lucky', A: 'Good luck', B: 'About average', C: 'A rough stretch' };
const EN_TRENDS = { steady: 'Steady lately', insufficient: 'No recent rating yet', 'no-baseline': 'Start with this period',
  volatile: 'Luck comes and goes', comeback: 'Luck turned around', downturn: 'A rougher stretch',
  recovering: 'Luck is recovering', cooling: 'Back to average', rising: 'Better lately', falling: 'Less lucky lately' };

function Avatar({ item, weapon }) {
  const [failed, setFailed] = useState(null);
  return <span className={`pl-avatar ${weapon ? 'pl-weapon' : ''}`} data-rarity={item.rarity} aria-hidden="true">
    {item.avatarUrl && failed !== item.avatarUrl ? <img src={item.avatarUrl} alt="" width="96" height="96" loading="lazy"
      decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(item.avatarUrl)} />
      : weapon ? <Swords size={22} /> : <UserRound size={22} />}
  </span>;
}

function Counter({ value, motion }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (!motion || value == null) return;
    let frame;
    const start = performance.now();
    const tick = now => {
      const progress = Math.min((now - start) / 900, 1);
      setShown(Math.round(value * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, motion]);
  return <span aria-label={String(value ?? '—')}>{value == null ? '—' : motion ? shown : value}</span>;
}

function LuckDialog({ type, stats, assessment, analysis, weapon, tt, number, onClose }) {
  const ref = useRef(null), titleId = useId();
  useEffect(() => {
    const previous = document.activeElement, node = ref.current;
    node.showModal();
    return () => { node.close(); previous?.focus(); };
  }, []);
  const exclusions = { initial: tt('六星保底进度未知', 'Unknown pity'), target: tt('首次 UP 进度未知', 'Unknown first-UP progress'),
    batch: tt('批次不完整', 'Incomplete batch'), identity: tt('身份不明', 'Unidentified item'), manual: tt('补录影响', 'Manual supplements'), rule: tt('记录与规则不符', 'Rule mismatch') };
  return <dialog className="pl-dialog" ref={ref} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === ref.current) onClose(); }}>
    <header><span>{tt('统计说明', 'STATISTICS NOTES')}</span><button type="button" onClick={onClose} aria-label={tt('关闭详情', 'Close details')}><X size={20} /></button></header>
    <h2 id={titleId}>{type === 'method' ? tt('运气是怎么算的？', 'How is luck rated?') : type === 'pity' ? tt('保底记录', 'Pity records')
      : type === 'multi' ? tt('多彩记录', 'Multiple six-stars') : tt('本次统计说明', 'About this rating')}</h2>
    {type === 'method' ? <dl>
      <div><dt>{tt('统计范围', 'Scope')}</dt><dd>{tt('限定与复刻，角色、武器分开计算；不计免费抽和赠送，用情报书抽的算在内。', 'Limited and rerun banners, with operators and weapons rated separately. Free pulls and gifts are excluded; intel-ticket pulls count.')}</dd></div>
      <div><dt>{tt('与当时的概率比较', 'Compare with the probability at each pull')}</dt><dd>{tt('先连续还原保底，再累计每次六星和 UP 的概率，与实际出货比较。多彩和保底不额外加分。', 'Pity is reconstructed continuously. Six-star and UP probabilities are added and compared with actual results. Multiple six-stars and pity are not scored twice.')}</dd></div>
      <div><dt>{tt('试行分档', 'Rating thresholds')}</dt><dd>{tt('六星占 40%，UP 占 60%；各项按“实际减预期，除以预期加 4 的平方根”计算。', 'Six-stars weigh 40%, UP 60%. Each term is (actual − expected) / √(expected + 4).')}
        {` S ≥ ${GRADE_THRESHOLDS.S} · A+ ≥ ${GRADE_THRESHOLDS['A+']} · A ≥ ${GRADE_THRESHOLDS.A} · C ≤ ${GRADE_THRESHOLDS.C}`}
        <p>{tt('这是体验分档，不是概率或玩家排名。样本较少或包含推定进度时标为暂定评价。', 'These are feedback tiers, not probabilities or player ranks. Small samples and inferred progress receive provisional ratings.')}</p></dd></div>
      <div><dt>{tt('最近三个版本', 'Latest three versions')}</dt><dd>{tt('按网站版本开始时间归属，当前版本和前两个版本汇总后重新评分，与此前三个版本比较。空版本保留，跨版本不重置保底。', 'Pulls follow the site version dates. The current and previous two versions are combined and compared with the preceding three. Empty versions stay; pity continues across boundaries.')}</dd></div>
    </dl> : type === 'pity' || type === 'multi' ? <dl>
      {(type === 'pity' ? [[tt('六星硬保底', 'Hard six-star pity'), stats.hard, weapon ? tt('第 4 次申领', '4th claim') : tt('第 80 抽', '80th pull')],
        [tt('首次 UP 保底', 'First-UP guarantee'), stats.guarantee, weapon ? tt('第 8 次申领', '8th claim') : tt('第 120 抽', '120th pull')],
        ...(!weapon ? [[tt('软保底出金', 'Soft-pity six-stars'), stats.soft, tt('第 66–79 抽', 'Pulls 66–79')]] : [])]
        : [[tt('双彩', 'Double six-stars'), stats.double], [tt('三彩及以上', 'Three or more'), stats.triple], [tt('完整十连', 'Complete batches'), stats.batches]])
        .map(([label, count, note]) => <div key={label}><dt>{label} <b>{number(count)}</b></dt>{note && <dd>{note}</dd>}</div>)}
      {stats.inferredSample > 0 && <p>{tt('部分保底进度包含奖励节点推定。', 'Some pity progress depends on inferred reward events.')}</p>}
    </dl> : <dl>
      <div><dt>{tt('参与评分', 'Rated records')}</dt><dd>{number(assessment.sample)} / {number(assessment.observed)} {weapon ? tt('件武器', 'weapons') : tt('抽', 'pulls')}
        {assessment.smallSample && <p>{tt('样本较少，只代表这几次的表现。', 'Small sample: this only describes these results.')}</p>}
        {assessment.inferred && <p>{tt('其中包含推定进度的抽数', 'Pulls depending on inferred progress')}：{number(assessment.inferredSample)}</p>}</dd></div>
      {stats.continuity.inferredRewards.length > 0 && <div><dt>{tt('奖励跳号', 'Reward sequence gaps')}</dt><dd>{number(stats.continuity.inferredRewards.length)} {tt('处跳号符合 60 抽情报书奖励节点，已按奖励续算，仍待原始记录确认。', 'gaps match the 60-pull intel-book reward boundary and are provisionally treated as rewards, pending original records.')}</dd></div>}
      {Object.entries(exclusions).filter(([key]) => stats.excluded[key] > 0).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{number(stats.excluded[key])} · {tt('全部时间', 'All time')}</dd></div>)}
      {stats.unassignedVersion.observed > 0 && <div><dt>{tt('版本归属', 'Version assignment')}</dt><dd>{number(stats.unassignedVersion.observed)} {tt('条记录无法归入已配置版本，其中', 'records fall outside configured versions;')}
        {' '}{number(stats.unassignedVersion.sample)} {tt('条只计入整体评分。', 'count towards all-time ratings only.')}</dd></div>}
      <div><dt>{tt('统计范围', 'Scope')}</dt><dd>{tt('保底、多彩、最快出金和高光看全部时间。', 'Pity, multiple six-stars, fastest drops and highlights use all-time records.')}
        {analysis.trend.provisional && <p>{tt('趋势包含暂定评价，仅供参考。', 'The trend includes provisional ratings.')}</p>}</dd></div>
    </dl>}
    <button type="button" className="pl-done" onClick={onClose}>{tt('明白了', 'Got it')}<ArrowRight size={16} /></button>
  </dialog>;
}

function Highlights({ stats, weapon, tt, number, date, english }) {
  const [selected, setSelected] = useState('multi');
  const records = stats.highlightRecords, gold = records.multi?.items.filter(item => item.rarity === 6).length || 0;
  const options = [gold >= 2 && { ...records.multi, id: 'multi', title: gold === 2 ? tt('一发双彩', 'Double six-stars') : tt(`一发${gold}彩`, `${gold} six-stars`), stamp: `${gold} × 6★` },
    records.fastest && { ...records.fastest, id: 'fastest', title: `${number(records.fastest.position)} ${weapon ? tt('次申领出金', 'claims to six-star') : tt('抽出金', 'pulls to six-star')}`, stamp: tt('最快出金', 'FASTEST') },
    records.streak && { ...records.streak, id: 'streak', title: tt(`连续 ${records.streak.count} 次不歪`, `${records.streak.count} UP wins in a row`), stamp: `${records.streak.count} × UP` }].filter(Boolean);
  const active = options.find(option => option.id === selected) || options[0];
  const name = item => english ? item.nameEn || item.name : item.name;
  const pool = item => english ? item.poolNameEn || item.poolName : item.poolName;
  return <section className="pl-highlights" aria-label={tt('抽卡高光', 'Pull highlights')}><div className="pl-heading"><h2><span>02</span>{tt('抽卡高光', 'Pull highlights')}</h2><small>HIGHLIGHTS</small></div>
    <div className="pl-highlight-card">{!active ? <p className="pl-empty">{tt('暂时没有可展示的高光。', 'No highlights to show yet.')}</p> : <>
      <div className="pl-highlight-tabs" role="group" aria-label={tt('高光类型', 'Highlight type')}>{options.map(option => <button type="button" key={option.id}
        aria-pressed={active.id === option.id} onClick={() => setSelected(option.id)}>{option.title}</button>)}</div>
      <div className="pl-highlight-heading"><h3>{active.title}</h3><span>{active.stamp}</span></div>
      {active.id === 'multi' ? <><div className="pl-ten-pull">{active.items.map((item, index) => <div className="pl-pull-tile" data-rarity={item.rarity} key={index} style={{ '--tile-index': index }} title={name(item)}>
        <span className="pl-tile-number">{String(index + 1).padStart(2, '0')}</span>{item.up && <b className="pl-tile-up">UP</b>}
        <Avatar item={item} weapon={weapon} /><strong>{name(item)}</strong><small>{item.rarity}★</small></div>)}</div>
        <p className="pl-gold-names">{active.items.filter(item => item.rarity === 6).map((item, i) => <span key={i}>{name(item)}{item.up && <b>UP</b>}</span>)}</p></>
        : <ol className={`pl-results ${active.id === 'streak' ? 'pl-streak' : ''}`} tabIndex={active.id === 'streak' ? 0 : undefined}>
          {active.items.map((item, index) => <li key={index}><small>{String(index + 1).padStart(2, '0')}</small><Avatar item={item} weapon={weapon} />
            <div><strong>{name(item)}</strong><small>{date(item.at || active.at)} · {pool(item) || pool(active)}</small></div><b>{item.up === true ? 'UP' : item.up === false ? '6★' : '?'}</b></li>)}</ol>}
      <div className="pl-moment-caption"><span>{active.id === 'streak' ? `${date(active.startAt)} — ${date(active.endAt)}` : `${date(active.at)} · ${pool(active)}`}</span>
        <span>{active.id === 'streak' ? tt('不含必出 UP 保底', 'Excludes guaranteed UP') : active.inferred ? tt('出金间隔含推定', 'Interval includes inference') : ''}</span></div>
    </>}</div></section>;
}

export default function PersonalLuckPanel({ account }) {
  const { isEnglish, locale } = useI18n(), { isDark } = useTheme();
  const tt = (zh, en) => isEnglish ? en : zh;
  const number = value => value == null ? '—' : Number(value).toLocaleString(locale);
  const date = value => value ? new Date(value).toLocaleDateString(locale) : '—';
  const [entity, setEntity] = useState('character'), [range, setRange] = useState('overall');
  const [paused, setPaused] = useState(false), [replay, setReplay] = useState(0), [modal, setModal] = useState(null);
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const chartRef = useRef(null), trendId = useId().replace(/:/g, '');
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-reduced-motion: reduce)'), listener = () => setReduced(query.matches);
    query.addEventListener('change', listener); return () => query.removeEventListener('change', listener);
  }, []);
  const stats = account[entity], weapon = entity === 'weapon', motion = !paused && !reduced;
  const analysis = useMemo(() => evaluateLuckTimeline(stats.timeline, entity, stats.unassignedVersion), [stats, entity]);
  const assessment = analysis[range], { periods, recentPeriods, previous, recent, trend } = analysis;
  useEffect(() => { if (chartRef.current) chartRef.current.scrollLeft = chartRef.current.scrollWidth; }, [account.key, entity]);
  const label = value => isEnglish ? EN_LABELS[value.grade] || (value.valid ? 'No usable records' : 'Records need review') : value.label;
  const unit = weapon ? tt('件武器', 'weapons') : tt('抽', 'pulls');
  const bins = weapon ? ['1', '2', '3', '4'] : ['1–20', '21–40', '41–65', '66–79', '80'];
  const maxBin = Math.max(...stats.distribution, 1), width = Math.max(periods.length, 1) * 112;
  const point = score => 85 - Math.max(-2, Math.min(4, score)) * 15;
  const detail = isEnglish ? assessment.eligible ? EN_LABELS[assessment.grade] : 'There are no usable records in this range.' : assessment.detail;
  return <div className={`personal-luck ${isDark ? 'pl-dark' : 'pl-light'} ${motion ? '' : 'pl-motion-off'}`}>
    <p className="pl-summary-caption">{weapon ? tt('武器', 'Weapons') : tt('角色', 'Operators')} · {tt('限定与复刻 · 全部时间', 'Limited and rerun · all time')}</p>
    <div className="pl-summary-strip">{[[Layers, tt('一共抽了', 'Total pulls'), stats.total], [Star, tt('抽到六星', 'Six-stars'), stats.six],
      [Target, tt('抽到当期 UP', 'Featured UP'), stats.up], [BarChart3, tt('平均多少抽出六星', 'Pulls per six-star'), stats.six ? (stats.total / stats.six).toFixed(1) : null]]
      .map(([Icon, title, value]) => <div key={title}>{React.createElement(Icon, { size: 36 })}<span>{title}</span><strong>{number(value)}</strong></div>)}</div>
    <section aria-label={tt('寻访运气', 'Pull luck')}><div className="pl-heading"><h2><span>01</span>{tt('寻访运气', 'Pull luck')}</h2>
      <button type="button" onClick={() => setModal('method')}>{tt('怎么算的', 'How it works')}<CircleHelp size={15} /></button></div>
      <div className="pl-scope-bar"><div role="group" aria-label={tt('评价对象', 'Entity')} className="pl-entity-toggle">
        <button type="button" aria-pressed={!weapon} onClick={() => setEntity('character')}><UserRound size={15} />{tt('角色', 'Operators')}</button>
        <button type="button" aria-pressed={weapon} onClick={() => setEntity('weapon')}><Swords size={15} />{tt('武器', 'Weapons')}</button></div>
        <small>{tt('限定 + 复刻', 'Limited + rerun')}</small><button type="button" className="pl-motion-control" onClick={() => setPaused(!paused)} aria-label={paused ? tt('播放动画', 'Play animations') : tt('暂停动画', 'Pause animations')}>{paused ? <Play size={16} /> : <Pause size={16} />}</button></div>
      <div className="pl-range-toggle" role="group" aria-label={tt('评价范围', 'Rating range')}>{[['overall', tt('整体手气', 'All time')], ['recent', tt('最近三个版本', 'Latest three versions')]].map(([id, title]) =>
        <button type="button" key={id} aria-pressed={range === id} onClick={() => setRange(id)}>{title}</button>)}</div>
      <div key={`${entity}-${range}-${replay}`} className="pl-hero" data-grade={assessment.grade || 'unrated'} data-provisional={assessment.provisional}>
        <div className="pl-hero-copy"><div className="pl-reading-badge"><i />{range === 'overall' ? tt('整体手气', 'ALL TIME') : tt('最近三个版本', 'RECENT THREE VERSIONS')}<span>//</span>{isEnglish ? label(assessment) : assessment.tag}</div>
          <div className="pl-signal-mark" role="img" aria-label={`${assessment.provisional ? tt('暂定评价', 'Provisional') : tt('运气等级', 'Luck grade')} ${assessment.grade || '—'}: ${label(assessment)}`}>
            <div className="pl-signal-corners" /><div className="pl-signal-scan" /><div className="pl-signal-grade"><b>{assessment.grade?.[0] || '—'}</b>{assessment.grade === 'A+' && <sup>+</sup>}</div>
            <div className="pl-signal-segments">{Array.from({ length: 8 }, (_, i) => <i key={i} style={{ '--segment': i }} />)}</div><small>{assessment.provisional ? tt('暂定评价', 'PROVISIONAL') : tt('运气等级', 'LUCK GRADE')}</small></div>
          <h3>{label(assessment)}<span> /</span></h3><p>{detail}<small>{assessment.provisional ? assessment.inferred ? tt('暂定评价 · 含推定进度', 'Provisional · inferred progress') : tt('暂定评价 · 样本较少', 'Provisional · small sample') : ''}</small></p>
          <div className="pl-hero-footer"><Fingerprint size={17} /><span>{tt('这次算了', 'Rated')} <b>{number(assessment.sample)}</b> {unit}</span>
            <button type="button" className="pl-info" onClick={() => setModal('coverage')} aria-label={tt('查看本次统计说明', 'About this rating')} aria-haspopup="dialog">{assessment.provisional ? <CircleAlert size={17} /> : <CircleHelp size={17} />}</button>
            <button type="button" className="pl-replay" onClick={() => setReplay(replay + 1)} aria-label={tt('重播入场动画', 'Replay animation')}><RotateCcw size={15} /></button></div>
        </div><div className="pl-readings"><header>{tt('实际抽到 / 按概率估算（含保底）', 'Actual / expected (including pity)')}<ArrowUpRight size={15} /></header>
          {[[tt('抽到六星', 'Six-stars'), assessment.actual, assessment.expected, 0], [tt('抽到 UP', 'Featured UP'), assessment.upActual, assessment.upExpected, 1]].map(([title, actual, expected, i]) =>
            <div className="pl-reading" key={title}><h4>{title}<small>{isEnglish ? assessment.review[i] === '比预期多' ? 'Above expected' : assessment.review[i] === '比预期少' ? 'Below expected' : 'Near expected' : assessment.review[i]}</small></h4>
              <div><strong>{number(actual)}</strong><span>{tt('预期', 'Expected')} {number(expected.toFixed(1))}</span></div><div className="pl-reading-track"><b style={{ width: `${actual / (Math.max(actual, expected, 1) * 1.15) * 100}%` }} /><i style={{ left: `${expected / (Math.max(actual, expected, 1) * 1.15) * 100}%` }} /></div></div>)}</div>
      </div>
      <div className="pl-grade-legend">{Object.entries(isEnglish ? EN_LABELS : GRADE_LABELS).map(([grade, title]) => <span key={grade}><b data-grade={grade}>{grade}</b>{title}</span>)}</div>
      <section className="pl-trend" aria-label={tt('手气变化', 'Luck trend')} data-trend={trend.id}><div className="pl-trend-summary"><small>{tt('按版本看手气', 'LUCK BY VERSION')}{trend.provisional ? ` · ${tt('暂定趋势', 'PROVISIONAL')}` : ''}</small>
        <h3>{isEnglish ? EN_TRENDS[trend.id] : trend.title}</h3><p>{isEnglish ? 'Compare the latest three versions with the preceding three.' : trend.note}</p>
        <div className="pl-trend-comparison"><span>{tt('此前三个版本', 'Previous three')} <b data-grade={previous.grade || 'unrated'}>{previous.grade || '—'}</b></span><ArrowRight size={15} /><span>{tt('最近三个版本', 'Latest three')} <b data-grade={recent.grade || 'unrated'}>{recent.grade || '—'}</b></span></div></div>
        <div className="pl-trend-chart"><header>{tt('每个版本单独评价', 'Each version rated separately')}<small>{tt('浅色底：最近三个版本', 'Shaded: latest three')}</small></header>
          <div ref={chartRef} className="pl-version-scroll" tabIndex={0} role="region" aria-label={tt('版本走势，可左右滚动', 'Version trend, scroll horizontally')}><div style={{ width, minWidth: '100%' }}>
            <svg viewBox={`0 0 ${width} 132`} role="img" aria-label={periods.map(p => `${p.versionName}: ${p.grade || '—'}, ${number(p.sample)}`).join('; ')}>
              <defs><linearGradient id={trendId}><stop stopColor="#8aebff" /><stop offset=".5" stopColor="#c6a3ff" /><stop offset="1" stopColor="#ff9dc5" /></linearGradient></defs>
              <rect x={Math.max(0, periods.length - 3) * 112} width={recentPeriods.length * 112} height="132" className="pl-version-shade" />
              <line x1="0" x2={width} y1="85" y2="85" className="pl-baseline" />
              {periods.slice(1).map((p, i) => periods[i].eligible && p.eligible && <line key={p.versionId} x1={56 + i * 112} y1={point(periods[i].score)} x2={168 + i * 112} y2={point(p.score)} className="pl-trend-line" />)}
              {periods.map((p, i) => <g key={p.versionId} data-grade={p.grade || 'unrated'}><circle cx={56 + i * 112} cy={p.eligible ? point(p.score) : 85} r="5" style={p.grade === 'S' ? { fill: `url(#${trendId})` } : undefined} /><text x={56 + i * 112} y={(p.eligible ? point(p.score) : 85) - 14} textAnchor="middle">{p.grade || '—'}</text></g>)}
            </svg><div className="pl-version-axis">{periods.map((p, i) => <span key={p.versionId} className={i >= periods.length - 3 ? 'pl-recent-version' : ''}><b>{p.versionName}</b><small>{number(p.sample)} {unit}</small>
              {p.provisional && <small>{tt('暂定', 'Provisional')}{p.inferred ? ` · ${tt('含推定', 'inferred')}` : ''}</small>}{!p.eligible && <small>{tt('暂无评分', 'Unrated')}</small>}</span>)}</div>
          </div></div></div></section>
      <div className="pl-achievements">{[[ShieldCheck, tt('保底次数', 'Pity triggers'), 'pity'], [Sparkles, tt('多彩次数', 'Multiple six-stars'), 'multi'], [Zap, tt('最快出金', 'Fastest six-star'), 'best'], [Target, tt('出金不歪率', 'UP win rate'), 'wins']].map(([Icon, title, key]) =>
        <div className="pl-achievement" key={key}>{['pity', 'multi'].includes(key) ? <button type="button" onClick={() => setModal(key)}>{React.createElement(Icon, { size: 18 })}{title}<ArrowUpRight size={14} /></button> : <header>{React.createElement(Icon, { size: 18 })}{title}</header>}
          {key === 'pity' ? <div className="pl-metric-pair"><span><strong><Counter value={stats.hard} motion={motion} /></strong><small>{tt('六星硬保底', 'Six-star pity')}</small></span><span><strong><Counter value={stats.guarantee} motion={motion} /></strong><small>{tt('首次 UP 保底', 'First-UP guarantee')}</small></span></div>
            : <strong className="pl-metric-value">{key === 'multi' ? <Counter value={stats.double + stats.triple} motion={motion} /> : key === 'best' ? number(stats.best) : stats.chances ? `${Math.round(stats.wins / stats.chances * 100)}%` : '—'}</strong>}
          <footer>{key === 'pity' ? weapon ? tt('第 4 次 / 第 8 次申领', '4th / 8th claim') : tt('80 抽 / 120 抽', '80 / 120 pulls') : key === 'multi' ? `${tt('双彩', 'Double')} ${stats.double} · ${tt('三彩及以上', '3+')} ${stats.triple}` : key === 'best' ? weapon ? tt('次申领', 'claims') : tt('抽', 'pulls') : `${stats.wins} / ${stats.chances}`}</footer></div>)}</div>
    </section>
    <div className="pl-detail-grid"><Highlights key={entity} stats={stats} weapon={weapon} tt={tt} number={number} date={date} english={isEnglish} />
      <section className="pl-distribution"><div className="pl-heading"><h2><span>03</span>{tt('六星出货分布', 'Six-star intervals')}</h2></div><div className="pl-distribution-card"><small>{weapon ? tt('几次申领出六星', 'Claims between six-stars') : tt('多少抽出六星', 'Pulls between six-stars')}</small>
        <div className="pl-bars">{stats.distribution.map((value, i) => <div key={bins[i]}><b>{value}</b><span><i style={{ height: `${value / maxBin * 100}%` }} /></span><small>{bins[i]}</small></div>)}</div>
        <p>{tt('全部时间 · 只看可还原的出金间隔', 'All time · reconstructable intervals only')}{stats.inferredSample > 0 ? ` · ${tt('部分含推定', 'some inferred')}` : ''}</p></div></section></div>
    {modal && <LuckDialog type={modal} stats={stats} assessment={assessment} analysis={analysis} weapon={weapon} tt={tt} number={number} onClose={() => setModal(null)} />}
  </div>;
}
