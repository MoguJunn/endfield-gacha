import React from 'react';

export default function WorkbenchMetricsPanel({ metrics }) {
  if (!metrics) return null;
  if (metrics.status !== 'ready') return <p className="text-sm text-amber-600" role="status">补录统计暂不可用，已有明细统计仍可查看。</p>;
  const coverage = metrics.coverage || {};
  if (!coverage.includedDetails && !coverage.includedRanges && !coverage.includedLedgers && !coverage.issueCount) return null;
  const format = value => Number(value || 0).toLocaleString('zh-CN');
  const rate = key => metrics.rates?.[`${key}Rate`] == null ? '未知' : `${(metrics.rates[`${key}Rate`] * 100).toFixed(2)}%（${format(metrics.rates[`${key}Numerator`])}/${format(metrics.rates[`${key}Denominator`])}）`;
  const rows = [
    ['补充抽数（已去重）', metrics.supplemental?.totalPulls],
    ['补充六星', metrics.supplemental?.sixStarCount],
    ['补充五星', metrics.supplemental?.fiveStarCount],
    ['已知补充四星', metrics.supplemental?.fourStarCount],
    ['可确认补充武库配额', metrics.resource?.arsenalQuota],
    ['可确认补充集成配额', metrics.resource?.aicSupplemental],
    ['可确认补充羁绊配额', metrics.resource?.knownBondQuota],
    ['可确认补充终点配额', metrics.resource?.knownEndpointQuota],
  ];
  return (
    <section className="space-y-3 border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900" aria-label="补录覆盖统计">
      <h3 className="font-bold">补录覆盖统计</h3>
      <p className="text-xs text-zinc-500">{metrics.scope === 'supplemented-accounts' ? '已补录账号的明细与可信摘要' : '当前范围的明细与可信摘要'}按指标合并计算；以下补充数量已扣除明细覆盖，不重复加到出率样本。随机四星角色仅供存档展示，不进入精确角色、时间和順序分析。</p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {rows.map(([label, value]) => <div key={label}><dt className="text-xs text-zinc-500">{label}</dt><dd className="font-mono font-bold">{format(value)}</dd></div>)}
      </dl>
      <p className="text-sm">同范围六星出率：{rate('sixStar')}；五星出率：{rate('fiveStar')}。明确普通出货间隔：{metrics.intervals?.averagePulls == null ? '未知' : `${metrics.intervals.averagePulls.toFixed(1)} 抽（${format(metrics.intervals.count)} 个）`}。</p>
      <p className="text-xs text-zinc-500">{format(coverage.unknownFourStar)} 个范围四星数量未知；{format(coverage.issueCount)} 项覆盖信息待核对；{format(coverage.resourceUnknownCount)} 项资源证据不足。满潜兑换仅计算已证明生效边界后的获取。</p>
      {!!metrics.inferred?.records && <p className="text-xs text-zinc-500">{format(metrics.inferred.records)} 条四星仍为推算记录，真实明细补入后按覆盖扣减替代。</p>}
    </section>
  );
}
