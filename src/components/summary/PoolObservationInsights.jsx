import React, { useState } from 'react';
import { Crosshair, Users, Sparkles } from 'lucide-react';
import { getCharacterAvatarUrl } from '../../utils/characterUtils.js';
import { observationAccountCoverage, observationCostInterval, observationShareWithin } from '../../utils/observationInsights.js';
import ObservationTargetPicker from './ObservationTargetPicker.jsx';

const percent = (value) => value === null ? '—' : `${(value * 100).toFixed(1)}%`;
const valueOrDash = (value) => value === null || value === undefined ? '—' : value;

export function TargetOverview({ options, item, onSelect, accounts, featuredIds, directoryReady, unit, t }) {
  const coverage = observationAccountCoverage(item?.missing ? null : item, accounts);
  const interval = observationCostInterval(item?.first);
  const avatar = directoryReady && item && getCharacterAvatarUrl(item.canonicalName || item.name, { fuzzy: false });
  return <section className="ex-target-overview" aria-label={t('目标速览', 'Target overview')}>
    <div className="ex-target-heading"><div><Crosshair size={17} aria-hidden="true" /><h2>{t('目标速览', 'Target overview')}</h2></div>
      <ObservationTargetPicker options={options} item={item} onSelect={onSelect} t={t} /></div>
    <div className="ex-target-body"><div className="ex-target-identity">
      {avatar ? <img src={avatar} alt="" /> : <span className="ex-target-placeholder"><Sparkles size={24} aria-hidden="true" /></span>}
      <div><span className="ex-report-eyebrow">{featuredIds.includes(item?.itemId) ? t('本期目标', 'FEATURED TARGET') : t('当前关注', 'IN FOCUS')}</span><h3>{item?.name || t('等待记录', 'Awaiting records')}</h3><small>{t('本期卡池内首次获得', 'First copy in this banner')}</small></div>
    </div><dl className="ex-target-metrics">
      <div><dt>{t('记录内获得账号', 'Accounts with a recorded copy')}</dt><dd data-insight="obtained">{valueOrDash(coverage?.obtained)}<small> / {accounts}</small></dd><span>{t('获得覆盖', 'Recorded coverage')} {percent(coverage?.rate ?? null)}</span></div>
      <div><dt>{t('首获中位数', 'First-copy median')}</dt><dd data-insight="median">{valueOrDash(interval.median)}</dd><span>{unit}</span></div>
      <div><dt>{t('首获平均花费', 'First-copy mean')}</dt><dd data-insight="mean">{item?.first?.mean?.toFixed(1) ?? '—'}</dd><span>{unit}</span></div>
      <div><dt>{t('可用首获样本', 'Known first-copy costs')}</dt><dd data-insight="samples">{valueOrDash(item?.first?.sampleCount)}</dd><span>{t('可判定花费的已完成样本', 'Completed copies with a known cost')}</span></div>
    </dl></div>
    <p className="ex-insight-note">{item?.missing ? t('该对象暂无可用统计，暂不显示它的获得与花费指标。', 'Statistics for this item are not yet available; acquisition and cost metrics cannot be shown.') : t('中位数表示累计达到 50% 已完成样本的记录数；缺失历史可能低估花费，覆盖率不是抽取概率。', 'The median is the first cost reaching 50% of completed samples. Missing history may understate costs; coverage is not a pull probability.')}</p>
  </section>;
}

export function AccountCoverage({ items, accounts, focusId, onSelect, t }) {
  if (!accounts || !items.length) return <div className="ex-empty">{t('当前范围暂无可展示的账号样本。', 'No account samples in this scope.')}</div>;
  return <div className="ex-insight-list ex-coverage-list">
    <div className="ex-coverage-key"><span><i className="ex-dot" />{t('已记录获得', 'Recorded acquisition')}</span><span><i className="ex-dot ex-dot-unrecorded" />{t('未记录到获得', 'No recorded acquisition')}</span><small>{accounts} {t('个参与账号', 'contributing accounts')}</small></div>
    {items.map((item) => {
      const coverage = observationAccountCoverage(item, accounts);
      return <div key={item.itemId} className="ex-coverage-row" style={{ '--item-color': item.color }}>
        <button className="ex-insight-item" aria-pressed={focusId === item.itemId} onClick={() => onSelect(item.itemId)}>{item.name}</button>
        <div className="ex-coverage-track" aria-hidden="true"><span style={{ width: `${coverage.rate * 100}%` }} /></div>
        <div className="ex-coverage-value"><b>{percent(coverage.rate)}</b><span>{coverage.obtained} {t('已获得', 'recorded')} · {coverage.notRecorded} {t('未记录', 'unrecorded')}</span></div>
      </div>;
    })}
  </div>;
}

export function CostIntervals({ items, focusId, onSelect, unit, t }) {
  const [kind, setKind] = useState('first');
  const rows = items.map((item) => ({ ...item, interval: observationCostInterval(item[kind]) }));
  const maximum = Math.max(1, ...rows.map((item) => item.interval.p90 || 0));
  return <div className="ex-cost-intervals">
    <div className="ex-interval-tools"><div className="ex-controls" role="group" aria-label={t('花费区间类型', 'Cost interval type')}>
      <button aria-pressed={kind === 'first'} onClick={() => setKind('first')}>{t('本期首次', 'First copy')}</button><button aria-pressed={kind === 'repeat'} onClick={() => setKind('repeat')}>{t('后续获得', 'Repeat copies')}</button>
    </div><span>{t('统一刻度', 'Shared scale')} · 0–{maximum} {unit}</span></div>
    <div className="ex-interval-key"><span><i className="ex-interval-swatch" />{t('中间 50% 区间', 'Middle 50%')}</span><span>● {t('中位数', 'Median')}</span><span>◆ {t('90% 位置', '90th percentile')}</span></div>
    <div className="ex-insight-list">
      {!rows.length && <div className="ex-empty">{t('当前筛选没有对象。', 'No items in this filter.')}</div>}
      {rows.map((item) => {
        const { q25, median, q75, p90 } = item.interval;
        return <div className="ex-interval-row" key={item.itemId} style={{ '--item-color': item.color }}>
          <button className="ex-insight-item" aria-pressed={focusId === item.itemId} onClick={() => onSelect(item.itemId)}>{item.name}</button>
          {median === null ? <span className="ex-interval-unavailable">{t('暂无可判定花费的样本', 'No samples with a known cost')}</span> : <>
            <div className="ex-interval-track" aria-hidden="true"><span className="ex-interval-whisker" style={{ left: `${q25 / maximum * 100}%`, width: `${(p90 - q25) / maximum * 100}%` }} /><span className="ex-interval-band" style={{ left: `${q25 / maximum * 100}%`, width: `${(q75 - q25) / maximum * 100}%` }} /><i className="ex-interval-median" style={{ left: `${median / maximum * 100}%` }} /><i className="ex-interval-p90" style={{ left: `${p90 / maximum * 100}%` }} /></div>
            <div className="ex-interval-values"><b>{q25}–{q75}</b><span>{t('中位', 'Median')} {median} · P90 {p90} · {t('样本', 'Samples')} {item[kind].sampleCount}</span></div>
          </>}
        </div>;
      })}
    </div>
    <p className="ex-insight-note">{t('各行使用相同刻度，起点为 0。区间为第 25–75 百分位，P90 为累计覆盖至少 90% 已完成样本的位置；不代表未来获得保证。', 'All rows share a scale starting at 0. Bands show the 25th–75th percentiles; P90 reaches at least 90% of completed samples. These are not guarantees for future pulls.')}</p>
  </div>;
}

export function DistributionReadout({ item, threshold, onThresholdChange, unit, t }) {
  return <section className="ex-distribution-readout" aria-label={t('分布读数', 'Distribution readout')}>
    <div className="ex-readout-heading"><span><Users size={15} aria-hidden="true" />{item ? `${t('正在解读', 'Reading')} · ${item.name}` : t('选择显示对象后查看读数', 'Select a visible item to read its distribution')}</span>
      <label className="ex-field">{t('观察阈值', 'Cost threshold')}<input aria-label={t('观察阈值', 'Cost threshold')} type="number" min="1" max="10000" value={threshold} onChange={(event) => onThresholdChange(Math.max(1, Math.min(10000, Math.trunc(Number(event.target.value)))))} /><span>{unit}</span></label></div>
    <div className="ex-readout-grid">{['first', 'repeat'].map((kind) => {
      const summary = item?.[kind];
      const { median, p90 } = observationCostInterval(summary);
      return <div key={kind} data-readout={kind}><strong>{kind === 'first' ? t('本期首次', 'First copy') : t('后续获得', 'Repeat copies')}</strong>
        <dl><div><dt>{t('中位数', 'Median')}</dt><dd>{valueOrDash(median)}</dd></div><div><dt>{t('90% 位置', '90th percentile')}</dt><dd>{valueOrDash(p90)}</dd></div><div><dt>≤ {threshold} {t('的样本占比', 'sample share')}</dt><dd>{percent(observationShareWithin(summary, threshold))}</dd></div></dl>
        <small>{summary?.sampleCount || 0} {t('个已完成样本', 'completed samples')}</small>
      </div>;
    })}</div><p className="ex-insight-note">{t('读数始终基于该对象的全部可用已完成样本；缩放图表、合并频数区间均不改变分母。', 'Readouts use all known completed samples for this item. Zooming and frequency grouping do not change the denominator.')}</p>
  </section>;
}
