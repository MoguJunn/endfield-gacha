import React from 'react';
import { Coins, ChartColumnIncreasing, Gauge } from 'lucide-react';
import ResourceSummaryPanel from '../resources/ResourceSummaryPanel.jsx';

export default function ScopedLegacyStatisticsPanel({ legacy, weapon, locale, t, mobile = false, section = 'all' }) {
  const number = (value) => Number.isFinite(value) ? value.toLocaleString(locale, { maximumFractionDigits: 2 }) : '—';
  const percent = (value) => Number.isFinite(value) ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(value) : '—';
  const metrics = [
    ['regularTotal', t('常规结果数', 'Regular results'), number(legacy.regularTotal)],
    ['sixStarCount', t('六星数量', 'Six-star count'), number(legacy.sixStarCount)],
    ['sixStarRate', t('六星出率', 'Six-star rate'), percent(legacy.sixStarRate)],
    ['avgSixStarInterval', t('平均六星间隔', 'Average six-star interval'), number(legacy.avgSixStarInterval)],
    ['targetCount', t('目标六星数量', 'Target six-stars'), number(legacy.targetCount)],
    ['offTargetCount', t('非目标六星数量', 'Off-target six-stars'), number(legacy.offTargetCount)],
    ['unknownTargetCount', t('目标待定六星数量', 'Six-stars with undetermined target'), number(legacy.unknownTargetCount)],
    ['targetRate', t('目标占可分类六星比例', 'Target share of classified six-stars'), percent(legacy.targetRate)],
    ['resultsPerTarget', t('每个目标平均结果数', 'Results per target'), number(legacy.resultsPerTarget)],
    ['giftCount', t('直接赠送数量', 'Direct gifts'), number(legacy.giftCount)],
  ];
  const bins = legacy.intervalDistribution || [];
  const maxCount = Math.max(1, ...bins.map((bin) => bin.count));
  const classifiedTotal = (bin) => (bin.target || 0) + (bin.offTarget || 0) + (bin.unknown || 0);
  const resources = legacy.resources;
  const commonResources = weapon ? [
    [t('武库配额消耗', 'Arsenal quota spent'), resources?.arsenalSpent],
    [t('集成配额（直得）', 'Direct AIC quota'), resources?.aicQuotaDirect],
  ] : [
    [t('嵌晶玉消耗', 'Oroberyl spent'), resources?.jadeSpent],
    [t('折合源石', 'Originite equivalent'), resources?.originiteEquivalent],
    [t('武库配额获得', 'Arsenal quota gained'), resources?.arsenalGained],
  ];
  return <section className="ex-scoped-legacy" aria-label={t('范围内常规统计', 'Regular statistics in scope')}>
    {section !== 'resources' && <><div className="ex-section-heading"><span><Gauge size={18} aria-hidden="true" /></span><div>
      <h2>{t('常规抽取与六星', 'Regular results and six-stars')}</h2>
      <p>{t('随当前卡池／分组及账号范围变化', 'Follows the selected banner or group and game account')}</p>
    </div></div>
    <p className="ex-coverage-note">{t('常规结果、六星出率、目标比例与六星间隔包含情报书结果，排除免费十连和直接赠送。赠送数量单独列示。目标比例以可精确判定的目标／非目标六星为分母，不含目标待定六星；不分目标的卡池只统计总数。', 'Regular results, six-star rates, target shares and intervals include intel tickets and exclude free batches and direct gifts. Gifts are shown separately. Target share uses precisely classified target and off-target six-stars; undetermined targets are excluded. Banners without target distinction report totals only.')}</p>
    <dl className="ex-legacy-metrics">{metrics.map(([key, label, value]) => <div key={key}><dt>{label}</dt><dd data-testid={`legacy-${key}`}>{value}</dd></div>)}</dl>
    <section className="ex-legacy-distribution" aria-label={t('六星间隔分布', 'Six-star interval distribution')}>
      <h3><ChartColumnIncreasing size={17} aria-hidden="true" />{t('六星间隔分布', 'Six-star interval distribution')}</h3>
      <p>{t('沿账号对应保底范围计算相邻六星间隔，与下方具体对象的首次／后续获得分布独立。单位为常规结果数；柱长与总数按该区间全部六星，目标／非目标／待定只是其中明细，不分目标的卡池仅显示总数。', 'Intervals follow each account’s pity scope. They are separate from the first/repeat acquisition distributions below. Units are regular results. Bars and totals use every six-star in the interval; target, off-target and undetermined are a breakdown within that total, and banners without target distinction show totals only.')}</p>
      {bins.length ? <ul>{bins.map((bin) => <li key={bin.from}>
        <span className="ex-interval-label">{bin.from}–{bin.to}</span>
        <span className="ex-legacy-interval-track" aria-hidden="true"><span style={{ width: `${bin.count / maxCount * 100}%` }} /></span>
        <span className="ex-interval-value">{number(bin.count)} {t('次', 'intervals')}{classifiedTotal(bin) > 0 && <small>{t('目标', 'Target')} {number(bin.target)} · {t('非目标', 'Off-target')} {number(bin.offTarget)}{bin.unknown > 0 && <> · {t('待定', 'Undetermined')} {number(bin.unknown)}</>}</small>}</span>
      </li>)}</ul> : <p className="ex-legacy-empty">{t('当前范围暂无可计算的六星间隔。', 'No six-star intervals are available for this scope.')}</p>}
    </section></>}
    {section !== 'metrics' && resources && <section className="ex-legacy-resources" aria-label={t('范围内资源换算', 'Resources in scope')}>
      <h3><Coins size={17} aria-hidden="true" />{t('资源换算', 'Resource equivalents')}</h3>
      <p>{t('按已存记录与账号持有顺序换算；免费抽取产出的配额按规则纳入，直接赠送不产出资源。', 'Calculated from stored records and account copy order. Eligible quota from free pulls is included; direct gifts yield no resources.')}</p>
      <dl className="ex-legacy-resource-values">{commonResources.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{number(value)}</dd></div>)}</dl>
      <details className="ex-record-details"><summary>{t('展开资源明细', 'Show resource details')}</summary>
        <ResourceSummaryPanel title={t('资源明细', 'Resource details')} resources={resources} variant={weapon ? 'weapon' : 'character'} mobile={mobile} />
      </details>
    </section>}
    {section !== 'metrics' && legacy.meta && <details className="ex-record-details"><summary>{t('常规统计口径与记录边界', 'Regular statistics methodology and record boundaries')}</summary>
      <p>{t('基于已存记录，未验证历史前缀完整；起始间隔从已存记录起点计算，缺失记录可能使结果偏低。', 'Based on stored history; the preceding history has not been verified. Initial intervals start at the stored prefix, so missing records may understate intervals.')}</p>
      <p>{t('有效间隔', 'Valid intervals')}：{number(legacy.meta.intervalCount)} · {t('起始边界间隔', 'Initial boundary intervals')}：{number(legacy.meta.boundaryIntervalCount)}</p>
      <p>{t('系列信息不足的间隔', 'Intervals missing series information')}：{number(legacy.meta.missingSeriesIntervalCount)} · {t('排除记录', 'Excluded records')}：{number(legacy.meta.excludedRecords)}</p>
    </details>}
  </section>;
}
