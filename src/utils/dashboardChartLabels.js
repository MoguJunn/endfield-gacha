import { resolveCharacterRecordByName } from './characterUtils.js';

function normalizeChartName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function getDashboardChartItemKind(item = {}) {
  const explicitKind = normalizeChartName(item?.kind);
  if (explicitKind) {
    return explicitKind;
  }

  const name = normalizeChartName(item?.name);
  if (name === '6星(限定)' || name === '6星(目标)') {
    return 'target-six';
  }

  if (name === '6星(常驻)' || name === '6星(常驻/偏移)') {
    return 'offrate-six';
  }

  if (name === '5星') {
    return 'five-star';
  }

  if (name === '4星') {
    return 'four-star';
  }

  return '';
}

export function localizeDashboardChartItems(items = [], {
  primarySixStarLabel,
  secondarySixStarLabel,
  fiveStarLabel = '5★',
  fourStarLabel = '4★',
} = {}) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const kind = getDashboardChartItemKind(item);
    if (kind === 'target-six') {
      return { ...item, name: primarySixStarLabel || item?.name };
    }

    if (kind === 'offrate-six') {
      return { ...item, name: secondarySixStarLabel || item?.name };
    }

    if (kind === 'five-star') {
      return { ...item, name: fiveStarLabel };
    }

    if (kind === 'four-star') {
      return { ...item, name: fourStarLabel };
    }

    return item;
  });
}

// counts['6_std'] 表示非当期UP，并不代表角色本身属于常驻。
// characterStats 已按当前免费抽开关汇总，快照页面无需重新读取原始历史。
export function buildDashboardSixStarBreakdown({
  stats,
  characterStats = [],
  isEnglish = false,
  resolveCharacter = resolveCharacterRecordByName,
}) {
  const total = Number(stats.counts['6_std'] || 0);
  let limited = 0;
  let standard = 0;
  for (const item of characterStats) {
    if (Number(item.rarity) !== 6 || item.isStandard !== true) continue;
    const character = resolveCharacter(item.name, { fuzzy: false });
    if (character?.is_limited === true) limited += Number(item.count || 0);
    if (character?.is_limited === false) standard += Number(item.count || 0);
  }

  const categories = [
    { kind: 'off-limited-six', name: isEnglish ? 'Off-banner limited 6★' : '歪限定6★', value: limited, color: '#f97316' },
    { kind: 'off-standard-six', name: isEnglish ? 'Off-banner standard 6★' : '歪常驻6★', value: standard, color: '#ef4444' },
  ];
  const unknown = total - limited - standard;
  if (unknown > 0) {
    categories.push({ kind: 'off-unknown-six', name: isEnglish ? 'Unclassified non-UP 6★' : '未分类非UP6★', value: unknown, color: '#71717a' });
  }

  const chartData = (stats.chartData || []).flatMap((item) => {
    if (getDashboardChartItemKind(item) !== 'offrate-six') return [item];
    return categories.filter(category => category.value > 0).map(category => ({
      ...category,
      originalValue: category.value,
      // 保留原非UP扇区的总显示面积，只在内部按实际数量拆分。
      displayValue: total > 0 ? (item.displayValue ?? item.value) * category.value / total : 0,
    }));
  });
  return { categories, chartData };
}
