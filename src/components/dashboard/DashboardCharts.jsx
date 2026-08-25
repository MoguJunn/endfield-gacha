import React from 'react';
import { PieChart as PieChartIcon, TrendingUp } from 'lucide-react';
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from 'recharts';
import { DistributionAreaChart, RainbowGradientDefs } from '../charts/index.js';
import { useI18n } from '../../i18n/index.js';

const PIE_LABEL_MIN_PERCENT = 0.05;
const PIE_LABEL_RADIAN = Math.PI / 180;

function resolvePieLabelColor(fill, isDark) {
  if (typeof fill !== 'string' || !fill.startsWith('#')) {
    return isDark ? '#fafafa' : '#ffffff';
  }
  const rawHex = fill.slice(1);
  const hex = rawHex.length === 3
    ? rawHex.split('').map((character) => character + character).join('')
    : rawHex;
  if (hex.length !== 6) {
    return isDark ? '#fafafa' : '#ffffff';
  }
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  return (0.299 * red) + (0.587 * green) + (0.114 * blue) > 170 ? '#111827' : '#ffffff';
}

function renderPiePercentLabel(isDark) {
  return ({ cx, cy, midAngle, innerRadius, outerRadius, percent, fill }) => {
    if (!Number.isFinite(percent) || percent < PIE_LABEL_MIN_PERCENT) {
      return null;
    }
    const radius = innerRadius + ((outerRadius - innerRadius) * 0.58);
    return (
      <text
        x={cx + (radius * Math.cos(-midAngle * PIE_LABEL_RADIAN))}
        y={cy + (radius * Math.sin(-midAngle * PIE_LABEL_RADIAN))}
        fill={resolvePieLabelColor(fill, isDark)}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={12}
        fontWeight={700}
      >
        {`${(percent * 100).toFixed(1)}%`}
      </text>
    );
  };
}

function ChartCard({ title, icon, children }) {
  return (
    <div className="border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-zinc-300">
        {React.createElement(icon, { size: 16, 'aria-hidden': true })}
        {title}
      </h3>
      <div className="h-64 min-w-0">{children}</div>
    </div>
  );
}

export default function DashboardCharts({ groups, isDark, tooltipStyle }) {
  const { t } = useI18n();

  return (Array.isArray(groups) ? groups : []).flatMap((group) => {
    const chartData = Array.isArray(group.chartData) ? group.chartData : [];
    const total = Number(group.total || 0);
    const distributionTitle = group.title
      ? t('dashboard.chart.distributionGroup', { name: group.title })
      : t('dashboard.chart.distribution');
    const trendTitle = group.title
      ? t('dashboard.chart.trendGroup', { name: group.title })
      : t('dashboard.chart.trend');

    return [
      <ChartCard key={`${group.key}-distribution`} title={distributionTitle} icon={PieChartIcon}>
        {total === 0 || chartData.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-300 dark:text-zinc-700">
            {t('dashboard.empty.noChartData')}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
            <PieChart>
              <RainbowGradientDefs />
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={44}
                outerRadius={82}
                paddingAngle={2}
                dataKey="displayValue"
                isAnimationActive={false}
                labelLine={false}
                label={renderPiePercentLabel(isDark)}
              >
                {chartData.map((entry, index) => (
                  <Cell key={`${group.key}-cell-${index}`} fill={entry.color} stroke="none" />
                ))}
              </Pie>
              <RechartsTooltip
                formatter={(_value, name, props) => [
                  `${props.payload.value} (${((props.payload.value / total) * 100).toFixed(1)}%)`,
                  name,
                ]}
                contentStyle={tooltipStyle}
                itemStyle={{ color: isDark ? '#e4e4e7' : '#27272a' }}
              />
              <Legend
                verticalAlign="bottom"
                iconSize={8}
                formatter={(value) => (
                  <span className="ml-1 text-xs text-slate-500 dark:text-zinc-400">{value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </ChartCard>,
      <ChartCard key={`${group.key}-trend`} title={trendTitle} icon={TrendingUp}>
        {!group.hasPityHistory ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-300 dark:text-zinc-700">
            {t('dashboard.empty.noSixStarHistory')}
          </div>
        ) : (
          <DistributionAreaChart
            data={group.distribution}
            isDark={isDark}
            tooltipStyle={tooltipStyle}
            variant={group.variant}
          />
        )}
      </ChartCard>,
    ];
  });
}
