import React, { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { LIMITED_POOL_RULES, WEAPON_POOL_RULES } from '../../constants/index.js';
import { targetProbabilityDistribution } from '../../utils/targetProbabilityDistribution.js';

const percent = (value) => `${(value * 100).toFixed(1)}%`;
const axis = { fontSize: 11, fill: 'var(--ex-muted)' };
const tooltipStyle = { background: 'var(--ex-surface)', border: '1px solid var(--ex-border)', color: 'var(--ex-ink)', fontSize: 12 };

export default function PoolTargetPrediction({ weapon, targetName, t }) {
  const [pity, setPity] = useState(0);
  const [progress, setProgress] = useState(0);
  const [used, setUsed] = useState(false);
  const [horizon, setHorizon] = useState(weapon ? 24 : 180);
  const unit = weapon ? t('次申领', 'claims') : t('抽', 'pulls');
  const maxPity = weapon ? 3 : 79;
  const maxProgress = weapon ? 7 : 119;
  const result = useMemo(() => targetProbabilityDistribution({ rules: weapon ? WEAPON_POOL_RULES : LIMITED_POOL_RULES,
    unit: weapon ? 'claim' : 'pull', currentPity: pity, guaranteeProgress: progress, guaranteeUsed: used, horizon }), [weapon, pity, progress, used, horizon]);
  const numberValue = (event, maximum, minimum = 0) => Math.max(minimum, Math.min(maximum, Math.trunc(Number(event.target.value))));
  return <section className="ex-theory">
    <p className="ex-intro">{t('目标', 'Target')}：{targetName} · {t('手动设定起始状态，不自动推断账号保底。免费十连、赠送与跨池策略未纳入。', 'Set the initial state manually; account pity is not inferred. Free batches, gifts and cross-banner strategies are excluded.')}</p>
    <div className="ex-filters">
      <label className="ex-field">{t('距上次六星', 'Since last six-star')}<input type="number" aria-label={t('当前保底', 'Current pity')} value={pity} min="0" max={maxPity} onChange={(e) => setPity(numberValue(e, maxPity))} /></label>
      <label className="ex-field">{t('本期保障已累计', 'Banner guarantee progress')}<input type="number" aria-label={t('保障累计', 'Guarantee progress')} value={progress} min="0" max={maxProgress} disabled={used} onChange={(e) => setProgress(numberValue(e, maxProgress))} /></label>
      <label className="ex-field">{t('一次性保障状态', 'One-time guarantee')}<select aria-label={t('一次性保障状态', 'One-time guarantee')} value={used ? 'used' : 'available'} onChange={(e) => setUsed(e.target.value === 'used')}>
        <option value="available">{t('尚未获得本期目标', 'Featured target not yet obtained')}</option><option value="used">{t('已获得，预测再次获得', 'Already obtained; predict another')}</option></select></label>
      <label className="ex-field">{t('预测范围', 'Prediction horizon')}<input type="number" aria-label={t('预测范围', 'Prediction horizon')} value={horizon} min="1" max={weapon ? 60 : 400} onChange={(e) => setHorizon(numberValue(e, weapon ? 60 : 400, 1))} /></label>
    </div>
    <div className="ex-meta"><div><span>{t('范围内获得概率', 'Probability within horizon')}</span><b>{percent(result.points.at(-1).cumulativeRate)}</b></div>
      <div><span>{result.expectationIsComplete ? t('期望花费', 'Expected cost') : t('截断期望下界', 'Capped expectation; lower bound')}</span><b>{result.expectedCapped.toFixed(1)} {unit}</b></div>
      <div><span>{t('范围外剩余概率', 'Probability beyond horizon')}</span><b>{percent(result.tailProbability)}</b></div></div>
    <div className="ex-curves">{[true, false].map((cdf) => <section className="ex-chart" data-chart={cdf ? 'T1' : 'T2'} key={String(cdf)}>
      <header className="ex-chart-head"><div><h3>{cdf ? t('目标获得 · 理论累计概率', 'Target acquisition · Theoretical CDF') : t('目标获得 · 理论花费分布', 'Target acquisition · Probability by cost')}</h3>
        <p>{weapon ? t('武器申领 · 预留六星槽模型估计', 'Weapon claims · Reserved-slot model estimate') : t('角色寻访 · 保底状态递推', 'Character pulls · Pity-state recurrence')}</p></div></header>
      <div className="ex-chart-frame"><ResponsiveContainer width="100%" height="100%"><LineChart data={result.points} margin={{ top: 12, right: 20, bottom: 20 }} accessibilityLayer>
        <CartesianGrid stroke="var(--ex-border)" strokeDasharray="3 4" /><XAxis dataKey="cost" type="number" domain={[0, horizon]} tick={axis} label={{ value: unit, position: 'insideBottom', offset: -14, ...axis }} />
        <YAxis tickFormatter={cdf ? (value) => `${Math.round(value * 100)}%` : percent} domain={cdf ? [0, 1] : [0, 'auto']} ticks={cdf ? [0, .25, .5, .75, 1] : undefined} tick={axis} width={64} />
        <Tooltip contentStyle={tooltipStyle} formatter={percent} /><Line dataKey={cdf ? 'cumulativeRate' : 'probability'} name={t('目标获得概率', 'Target probability')} type="stepAfter" stroke="var(--ex-chart-accent)" dot={false} strokeWidth={2} isAnimationActive={false} />
      </LineChart></ResponsiveContainer></div><div className="ex-chart-caption">{t('规则模型计算，与真实记录统计分开。', 'Calculated from a rule model, separate from observed records.')}</div>
    </section>)}</div>
    {weapon && <p className="ex-intro">{t('规则未公开十连内部生成过程；此处采用预留六星槽假设，结果为模型估计。', 'The rules do not publish the internal batch generation process. This is a reserved-slot model estimate.')}</p>}
  </section>;
}
