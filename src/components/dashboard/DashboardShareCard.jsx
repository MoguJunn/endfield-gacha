import React, { forwardRef } from 'react';
import ShareBrandPanel from '../share/ShareBrandPanel';
import {
  SHARE_CARD_WIDTH,
  getResolvedShareFontVariables
} from '../../utils/shareBranding';
import { RESOURCE_ICON_URLS } from '../../utils/resourceEconomy.js';
import { useI18n } from '../../i18n/index.js';
import { getTimelineBarColor, getTimelineTextBadgeStyle } from '../../utils/timelineVisuals.js';

function getThemeTokens(theme = 'light') {
  if (theme === 'dark') {
    return {
      rootBackground: 'linear-gradient(145deg, #090b0f 0%, #131820 48%, #1a1f29 100%)',
      backgroundDecor: 'radial-gradient(circle at 12% 12%, rgba(250, 204, 21, 0.14) 0%, rgba(250, 204, 21, 0) 32%), radial-gradient(circle at 88% 10%, rgba(56, 189, 248, 0.11) 0%, rgba(56, 189, 248, 0) 28%), linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0) 34%), linear-gradient(320deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0) 38%)',
      border: '#3f3f46',
      subtleBorder: '#27272a',
      panelBackground: 'rgba(24,24,27,0.94)',
      panelMutedBackground: 'rgba(39,39,42,0.92)',
      textPrimary: '#fafafa',
      textSecondary: '#d4d4d8',
      textMuted: '#a1a1aa',
      textWeak: '#71717a',
      iconBackground: '#27272a',
      barTrack: '#18181b',
      chipBackground: 'rgba(39,39,42,0.92)',
      footerText: '#a1a1aa',
      rarityBadgeBackground: '#fafafa',
      rarityBadgeText: '#111827'
    };
  }

  return {
    rootBackground: 'linear-gradient(140deg, #fcfbf7 0%, #f6f2e9 52%, #eef3f8 100%)',
    backgroundDecor: 'radial-gradient(circle at 10% 14%, rgba(245, 158, 11, 0.16) 0%, rgba(245, 158, 11, 0) 34%), radial-gradient(circle at 88% 12%, rgba(59, 130, 246, 0.13) 0%, rgba(59, 130, 246, 0) 28%), linear-gradient(140deg, rgba(255, 255, 255, 0.55) 0%, rgba(255, 255, 255, 0) 42%), linear-gradient(325deg, rgba(255, 255, 255, 0.28) 0%, rgba(255, 255, 255, 0) 44%)',
    border: '#d4d4d8',
    subtleBorder: '#e4e4e7',
    panelBackground: '#ffffff',
    panelMutedBackground: '#fafafa',
    textPrimary: '#18181b',
    textSecondary: '#52525b',
    textMuted: '#71717a',
    textWeak: '#a1a1aa',
    iconBackground: '#e4e4e7',
    barTrack: '#f4f4f5',
    chipBackground: '#fafafa',
    footerText: '#71717a',
    rarityBadgeBackground: '#18181b',
    rarityBadgeText: '#fafafa'
  };
}

const styles = {
  root: {
    width: `${SHARE_CARD_WIDTH}px`,
    minHeight: '0px',
    boxSizing: 'border-box',
    background: 'linear-gradient(140deg, #fcfbf7 0%, #f6f2e9 52%, #eef3f8 100%)',
    color: '#18181b',
    padding: '20px',
    fontFamily: 'var(--share-font-sans)',
    border: '2px solid #d4d4d8',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    position: 'relative'
  },
  grid: {
    position: 'absolute',
    inset: 0,
    background: 'none',
    pointerEvents: 'none'
  },
  header: {
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    justifyContent: 'space-between',
    gap: '14px',
    borderBottom: '1px solid #d4d4d8',
    paddingBottom: '12px'
  },
  titleWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minWidth: 0
  },
  eyebrow: {
    fontSize: '12px',
    fontWeight: 800,
    letterSpacing: '0.24em',
    color: '#71717a',
    textTransform: 'uppercase'
  },
  title: {
    fontSize: '30px',
    lineHeight: 1.08,
    fontWeight: 900,
    letterSpacing: '-0.04em',
    color: '#18181b'
  },
  subtitle: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    alignItems: 'center',
    fontSize: '13px',
    color: '#52525b',
    fontWeight: 600
  },
  tagColumn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: '8px',
    flexShrink: 0
  },
  badge: {
    border: '1px solid #d4d4d8',
    background: '#ffffff',
    padding: '8px 12px',
    fontSize: '12px',
    fontWeight: 800,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: '#27272a'
  },
  sectionTitle: {
    fontSize: '12px',
    fontWeight: 800,
    letterSpacing: '0.2em',
    color: '#71717a',
    textTransform: 'uppercase'
  },
  compactStatsGrid: {
    position: 'relative',
    zIndex: 1,
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '10px'
  },
  compactPanel: {
    border: '1px solid #d4d4d8',
    background: '#ffffff',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  compactGroupHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px'
  },
  metricRows: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  metricRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px'
  },
  metricPill: {
    flex: '1 1 120px',
    minWidth: '0',
    border: '1px solid #d4d4d8',
    background: '#fafafa',
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  metricPillHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minWidth: 0
  },
  metricPillIcon: {
    width: '16px',
    height: '16px',
    objectFit: 'contain',
    flexShrink: 0
  },
  metricPillLabel: {
    fontSize: '10px',
    fontWeight: 800,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: '#71717a'
  },
  metricPillValue: {
    fontSize: '18px',
    lineHeight: 1.1,
    fontWeight: 900,
    color: '#18181b',
    fontFamily: 'var(--share-font-mono)'
  },
  metricPillHint: {
    fontSize: '11px',
    lineHeight: 1.35,
    color: '#71717a',
    fontWeight: 600
  },
  compactNote: {
    position: 'relative',
    zIndex: 1,
    fontSize: '12px',
    lineHeight: 1.5,
    color: '#71717a',
    fontWeight: 600
  },
  methodologyBanner: {
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    border: '2px solid #06b6d4',
    background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.14), rgba(14, 165, 233, 0.06))',
    padding: '10px 12px'
  },
  methodologyBannerLabel: {
    fontSize: '11px',
    fontWeight: 900,
    letterSpacing: '0.18em',
    textTransform: 'uppercase'
  },
  methodologyBannerValue: {
    fontSize: '18px',
    lineHeight: 1.1,
    fontWeight: 900,
    fontFamily: 'var(--share-font-mono)'
  },
  methodologyBannerHint: {
    fontSize: '11px',
    lineHeight: 1.45,
    fontWeight: 700
  },
  summaryGrid: {
    position: 'relative',
    zIndex: 1,
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '10px'
  },
  statCard: {
    border: '1px solid #d4d4d8',
    background: '#ffffff',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    minHeight: '96px'
  },
  statLabel: {
    fontSize: '11px',
    fontWeight: 800,
    letterSpacing: '0.14em',
    color: '#71717a',
    textTransform: 'uppercase'
  },
  statValue: {
    fontSize: '28px',
    lineHeight: 1,
    fontWeight: 900,
    color: '#111827',
    fontFamily: 'var(--share-font-mono)'
  },
  statHint: {
    fontSize: '13px',
    color: '#52525b',
    fontWeight: 600
  },
  midGrid: {
    position: 'relative',
    zIndex: 1,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: '14px'
  },
  panel: {
    border: '1px solid #d4d4d8',
    background: '#ffffff',
    padding: '12px'
  },
  averageGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '10px',
    marginTop: '12px'
  },
  averageCard: {
    border: '1px solid #e4e4e7',
    background: '#fafafa',
    padding: '12px'
  },
  averageLabel: {
    fontSize: '10px',
    fontWeight: 800,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: '#71717a'
  },
  averageValue: {
    marginTop: '8px',
    fontSize: '21px',
    lineHeight: 1,
    fontWeight: 900,
    color: '#18181b',
    fontFamily: 'var(--share-font-mono)'
  },
  averageNote: {
    marginTop: '8px',
    fontSize: '12px',
    color: '#71717a',
    lineHeight: 1.5
  },
  pityGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '10px',
    marginTop: '12px'
  },
  pityCard: {
    border: '1px solid #e4e4e7',
    background: '#fafafa',
    padding: '12px'
  },
  pityValue: {
    marginTop: '8px',
    fontSize: '23px',
    lineHeight: 1,
    fontWeight: 900,
    color: '#111827',
    fontFamily: 'var(--share-font-mono)'
  },
  timelineWrap: {
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  timelineHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: '12px'
  },
  counts: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap'
  },
  countBox: {
    border: '1px solid #d4d4d8',
    background: '#ffffff',
    padding: '8px 10px',
    fontSize: '12px',
    color: '#52525b',
    fontWeight: 700,
    fontFamily: 'var(--share-font-mono)'
  },
  sectionCard: {
    border: '1px solid #d4d4d8',
    background: '#ffffff',
    overflow: 'hidden'
  },
  sectionInner: {
    padding: '16px'
  },
  sectionMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '12px'
  },
  metricCell: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
    whiteSpace: 'nowrap'
  },
  metricValue: {
    marginTop: 0,
    fontSize: '16px',
    fontWeight: 900,
    color: '#18181b',
    fontFamily: 'var(--share-font-mono)'
  },
  entryRow: {
    display: 'flex',
    gap: '14px',
    borderTop: '1px solid #f4f4f5',
    paddingTop: '14px',
    marginTop: '14px'
  },
  portrait: {
    width: '68px',
    height: '68px',
    border: '1px solid #d4d4d8',
    background: '#fafafa',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    flexShrink: 0
  },
  portraitRarity: {
    position: 'absolute',
    top: '0',
    right: '0',
    background: '#18181b',
    color: '#fafafa',
    fontSize: '8px',
    fontWeight: 900,
    padding: '2px 4px'
  },
  portraitLabel: {
    fontSize: '22px',
    fontWeight: 900,
    color: '#18181b'
  },
  dateLabel: {
    marginTop: '6px',
    fontSize: '10px',
    fontWeight: 800,
    color: '#71717a',
    textAlign: 'center'
  },
  entryBody: {
    flex: 1,
    minWidth: 0
  },
  stageTop: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap'
  },
  stageChip: {
    border: '1px solid #d4d4d8',
    background: '#fafafa',
    color: '#71717a',
    fontSize: '10px',
    fontWeight: 800,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    padding: '3px 6px'
  },
  resultText: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#27272a'
  },
  metaText: {
    marginTop: '6px',
    fontSize: '12px',
    color: '#71717a',
    fontWeight: 600
  },
  barRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginTop: '10px'
  },
  barTrack: {
    position: 'relative',
    flex: '0 1 360px',
    width: '100%',
    maxWidth: '360px',
    height: '34px',
    border: '1px solid #d4d4d8',
    background: '#f4f4f5',
    overflow: 'hidden'
  },
  barFill: {
    position: 'absolute',
    inset: 0,
    width: '0%'
  },
  barFillPattern: {
    position: 'absolute',
    inset: 0,
    backgroundImage: 'linear-gradient(45deg, rgba(255,255,255,0.15) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.15) 75%, transparent 75%, transparent 100%)',
    backgroundSize: '12px 12px'
  },
  barValue: {
    position: 'absolute',
    inset: '0 auto 0 12px',
    display: 'flex',
    alignItems: 'center',
    fontSize: '20px',
    fontWeight: 900,
    color: '#111827'
  },
  stamp: {
    width: '42px',
    height: '42px',
    borderRadius: '999px',
    transform: 'rotate(14deg)',
    border: '2px solid #d4d4d8',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '13px',
    fontWeight: 900,
    color: '#27272a',
    background: '#ffffff',
    flexShrink: 0
  },
  badgeList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginTop: '10px'
  },
  dropBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    border: '1px solid #d4d4d8',
    background: '#fafafa',
    padding: '4px 8px'
  },
  dropThumb: {
    width: '20px',
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#e4e4e7',
    color: '#27272a',
    fontSize: '10px',
    fontWeight: 900
  },
  footer: {
    position: 'relative',
    zIndex: 1,
    borderTop: '1px solid #d4d4d8',
    paddingTop: '12px',
    fontSize: '12px',
    color: '#71717a',
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: '12px'
  },
  footerTextWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: 1,
    minWidth: 0
  }
};

function getSectionTone(type) {
  if (type === 'extra') {
    return {
      accent: '#06b6d4',
      soft: '#cffafe'
    };
  }

  if (type === 'weapon') {
    return {
      accent: '#f59e0b',
      soft: '#fef3c7'
    };
  }

  if (type === 'standard') {
    return {
      accent: '#3b82f6',
      soft: '#dbeafe'
    };
  }

  return {
    accent: '#d946ef',
    soft: '#fae8ff'
  };
}

function getSectionTypeLabel(type, tt) {
  if (type === 'extra') {
    return tt('dashboard.shareCard.sectionType.extra', 'Extra Banner');
  }

  if (type === 'weapon') {
    return tt('dashboard.shareCard.sectionType.weapon', 'Weapon Banner');
  }

  if (type === 'standard') {
    return tt('dashboard.shareCard.sectionType.standard', 'Standard Character Banner');
  }

  return tt('dashboard.shareCard.sectionType.limited', 'Limited Character Banner');
}

function getStamp(entry, sectionType, tt, isEnglish) {
  if (entry.unknownInheritedPity) return null;
  if (entry.guaranteePulls) {
    return { label: isEnglish ? 'Guaranteed' : '保底', color: '#b45309', bg: '#fef3c7' };
  }
  if (entry.stageKind === 'gift') {
    return { label: tt('dashboard.shareCard.stamp.free', 'FREE'), color: '#34d399', bg: '#ecfdf5' };
  }

  if (entry.stageKind === 'up') {
    return { label: 'UP', color: '#f59e0b', bg: '#fffbeb' };
  }

  if (entry.stageKind === 'offStandard' || entry.stageKind === 'offLimited') {
    if (sectionType === 'standard') {
      return null;
    }

    return { label: tt('dashboard.shareCard.stamp.offrate', 'OFF'), color: '#fb7185', bg: '#fff1f2' };
  }

  if (entry.isCurrentStage) {
    return { label: tt('dashboard.shareCard.stamp.progress', 'LIVE'), color: '#52525b', bg: '#fafafa' };
  }

  return null;
}

function formatAverage(value, tt) {
  if (!Number.isFinite(Number(value))) {
    return '--';
  }

  return tt('dashboard.shareCard.averageValue', '{value} pulls', { value: Number(value).toFixed(1) });
}

function buildCombinedPityItem(pitySummary, tt) {
  if (!pitySummary) {
    return null;
  }

  return {
    id: 'current-pity',
    label: tt('dashboard.shareCard.currentPity', 'Current 6★ Pity'),
    value: `${pitySummary.current6}/${pitySummary.max6}`,
    hint: pitySummary.probabilityHint || tt('dashboard.shareCard.pityHint', 'Toward the next 6★ milestone'),
    accent: true
  };
}

function getVisibleDropBadges(entry, showFiveStarDrops) {
  const badges = Array.isArray(entry?.dropBadges) ? entry.dropBadges : [];
  return showFiveStarDrops ? badges : badges.filter((badge) => Number(badge?.rarity) >= 6);
}

function getVisibleResultSummary(entry, showFiveStarDrops) {
  if (showFiveStarDrops) {
    return entry.resultSummary;
  }

  return entry.resultSummaryWithoutFiveStar || entry.resultSummary;
}

function getResourceIcon(itemId) {
  if (itemId === 'jade-spent') {
    return RESOURCE_ICON_URLS.jade;
  }

  if (itemId === 'originite-equivalent') {
    return RESOURCE_ICON_URLS.originite;
  }

  if (itemId === 'arsenal-gained' || itemId === 'arsenal-spent') {
    return RESOURCE_ICON_URLS.arsenalQuota;
  }

  return null;
}

function indexItems(items = []) {
  return new Map((items || []).map((item) => [item.id, item]));
}

function pickItems(itemMap, ids = []) {
  return ids
    .map((id) => itemMap.get(id))
    .filter(Boolean);
}

function withResourceIcons(items = []) {
  return items.map((item) => ({
    ...item,
    icon: getResourceIcon(item.id)
  }));
}

function buildCompactRows({ poolType, summaryItems = [], averageItems = [], resourceItems = [], pitySummary = null, tt }) {
  const summaryMap = indexItems(summaryItems);
  const averageMap = indexItems(averageItems);
  const pityItem = buildCombinedPityItem(pitySummary, tt);

  if (poolType === 'standard') {
    return [
      pickItems(summaryMap, ['total-pulls', 'six-star-total', 'five-star-count', 'four-star-count']),
      [
        ...pickItems(averageMap, ['avg-5', 'avg-6-all']),
        ...(pityItem ? [pityItem] : [])
      ],
      withResourceIcons(resourceItems)
    ];
  }

  const metricTail = summaryMap.get('win-rate') || summaryMap.get('five-star-count');
  return [
    [
      ...pickItems(summaryMap, ['total-pulls', 'target-six', 'off-six']),
      ...(metricTail ? [metricTail] : [])
    ],
    [
      ...pickItems(averageMap, ['avg-5', 'avg-6-all', 'avg-6-target']),
      ...(pityItem ? [pityItem] : pickItems(averageMap, ['avg-6-limited']))
    ].slice(0, 4),
    withResourceIcons(resourceItems)
  ];
}

function MethodologyBanner({ includeFreePullsInStats, methodology, tokens, tt }) {
  const accent = includeFreePullsInStats ? '#06b6d4' : '#f59e0b';
  const soft = includeFreePullsInStats
    ? 'linear-gradient(135deg, rgba(6, 182, 212, 0.18), rgba(14, 165, 233, 0.07))'
    : 'linear-gradient(135deg, rgba(245, 158, 11, 0.18), rgba(250, 204, 21, 0.07))';
  const value = includeFreePullsInStats
    ? tt('dashboard.shareCard.freeTenIncludedBadge', 'Free ten-pulls included')
    : tt('dashboard.shareCard.freeTenExcludedBadge', 'Free ten-pulls excluded');

  return (
    <div style={{ ...styles.methodologyBanner, borderColor: accent, background: soft }}>
      <div>
        <div style={{ ...styles.methodologyBannerLabel, color: tokens.textMuted }}>
          {tt('dashboard.shareCard.methodologyBadgeTitle', 'Statistic Method')}
        </div>
        <div style={{ ...styles.methodologyBannerValue, color: accent }}>
          {value}
        </div>
      </div>
      <div style={{ ...styles.methodologyBannerHint, color: tokens.textSecondary }}>
        {methodology}
      </div>
    </div>
  );
}

function getStatusText(status, tt) {
  if (!status?.isTimed) {
    return tt('dashboard.shareCard.status.permanent', 'Always available');
  }

  if (status.isActive) {
    return status.remainingLabel || tt('dashboard.shareCard.status.active', 'Live');
  }

  if (status.isUpcoming) {
    return status.remainingLabel || tt('dashboard.shareCard.status.upcoming', 'Upcoming');
  }

  return tt('dashboard.shareCard.status.ended', 'Ended');
}

function CompactMetricPill({ item, tokens, accentColor }) {
  return (
    <div
      style={{
        ...styles.metricPill,
        borderColor: item.accent ? accentColor : tokens.border,
        background: tokens.panelMutedBackground
      }}
    >
      <div style={styles.metricPillHeader}>
        {item.icon ? (
          <img src={item.icon} alt={item.label} style={styles.metricPillIcon} />
        ) : null}
        <div style={{ ...styles.metricPillLabel, color: tokens.textMuted }}>{item.label}</div>
      </div>
      <div style={{ ...styles.metricPillValue, color: item.accent ? accentColor : tokens.textPrimary }}>{item.value}</div>
      {item.hint ? (
        <div style={{ ...styles.metricPillHint, color: tokens.textSecondary }}>{item.hint}</div>
      ) : null}
    </div>
  );
}

function CompactMetricBlock({ title, rows = [], tokens, accentColor }) {
  const normalizedRows = rows.filter((row) => Array.isArray(row) && row.length > 0);

  if (normalizedRows.length === 0) {
    return null;
  }

  return (
    <div style={{ ...styles.compactPanel, borderColor: tokens.border, background: tokens.panelBackground }}>
      {title ? (
        <div style={styles.compactGroupHeader}>
          <div style={{ ...styles.sectionTitle, color: tokens.textMuted }}>{title}</div>
        </div>
      ) : null}
      <div style={styles.metricRows}>
        {normalizedRows.map((row, rowIndex) => (
          <div key={`${title || 'overall'}-${rowIndex}`} style={styles.metricRow}>
            {row.map((item) => (
              <CompactMetricPill key={`${title || 'overall'}-${rowIndex}-${item.id}`} item={item} tokens={tokens} accentColor={accentColor} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function renderShareSummary(entry, summary, theme = 'light') {
  if (!summary) {
    return '--';
  }

  const parts = String(summary).split(/(6★|5★)/u);
  return parts.map((part, index) => {
    if (part !== '6★' && part !== '5★') {
      return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
    }

    const badgeStyle = getTimelineTextBadgeStyle(entry, part === '6★' ? 6 : 5, theme);
    return (
      <span
        key={`${part}-${index}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '1px 6px',
          margin: '0 2px',
          border: `1px solid ${badgeStyle?.borderColor || 'transparent'}`,
          background: badgeStyle?.background,
          color: badgeStyle?.color,
          fontSize: '12px',
          fontWeight: 900,
          lineHeight: 1.2,
        }}
      >
        {part}
      </span>
    );
  });
}

function TimelineEntry({ entry, section, tokens, tt, theme, showFiveStarDrops = true }) {
  const { isEnglish } = useI18n();
  const text = (zh, en) => isEnglish ? en : zh;
  const scaleBase = Math.max(Number(entry.targetPulls || section.scaleMax) || 1, 1);
  const widthPercent = entry.stageKind === 'gift'
    ? 100
    : Math.max(12, Math.min(100, ((entry.pulls || 0) / scaleBase) * 100));
  const fillColor = entry.guaranteePulls ? 'linear-gradient(90deg, #fbbf24, #f59e0b, #d97706)' : getTimelineBarColor(section.type, entry);
  const stamp = getStamp(entry, section.type, tt, isEnglish);
  const inheritedPulls = Number(entry.inheritedPulls) || 0;
  const stageLabel = entry.guaranteePulls ? text(`${entry.guaranteePulls} 抽保底出货`, `${entry.guaranteePulls}-pull guarantee`) : entry.stageLabel;
  const leadBadge = entry.leadBadge || entry.dropBadges?.[0] || { label: '?', rarity: 0 };
  const visibleBadges = getVisibleDropBadges(entry, showFiveStarDrops);
  const resultSummary = getVisibleResultSummary(entry, showFiveStarDrops);

  return (
    <div style={{ ...styles.entryRow, borderTopColor: tokens.subtleBorder }}>
      <div style={{ width: '80px', flexShrink: 0 }}>
          <div style={{ ...styles.portrait, borderColor: tokens.border, background: tokens.panelMutedBackground, overflow: 'hidden' }}>
            <div style={{ ...styles.portraitRarity, background: tokens.rarityBadgeBackground, color: tokens.rarityBadgeText }}>
              {leadBadge.rarity > 0 ? `${leadBadge.rarity}★` : tt('dashboard.shareCard.stage', 'Stage')}
            </div>
          {leadBadge.avatarUrl ? (
            <img
              src={leadBadge.avatarUrl}
              alt={leadBadge.label}
              style={{ width: '68px', height: '68px', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <div style={{ ...styles.portraitLabel, color: tokens.textPrimary }}>{String(leadBadge.label || '?').slice(0, 1)}</div>
          )}
        </div>
        <div style={{ ...styles.dateLabel, color: tokens.textMuted }}>{entry.dateLabel}</div>
      </div>

      <div style={styles.entryBody}>
        <div style={styles.stageTop}>
          <div style={{ ...styles.stageChip, borderColor: tokens.border, background: tokens.chipBackground, color: tokens.textMuted }}>{stageLabel}</div>
          <div style={{ ...styles.resultText, color: tokens.textPrimary }}>{renderShareSummary(entry, resultSummary, theme)}</div>
        </div>

        <div style={styles.barRow}>
          <div style={{ ...styles.barTrack, borderColor: tokens.border, background: tokens.barTrack }}>
            <div
              style={{
                ...styles.barFill,
                width: `${widthPercent}%`,
                background: fillColor
              }}
            >
              <div style={styles.barFillPattern} />
              {inheritedPulls > 0 ? <div style={{ position: 'absolute', bottom: 2, left: 0, height: 6,
                width: `${Math.min(100, inheritedPulls / entry.pulls * 100)}%`, background: '#818cf8' }} /> : null}
            </div>
            <div style={{ ...styles.barValue, color: tokens.textPrimary }}>
              {entry.unknownInheritedPity ? text('继承未知', 'Unknown') : entry.pulls}
              <span style={{ marginLeft: '4px', fontSize: '12px', fontWeight: 700 }}>{tt('dashboard.shareCard.pullUnit', 'pulls')}</span>
            </div>
          </div>

          {stamp && (
            <div
              style={{
                ...styles.stamp,
                borderColor: stamp.color,
                color: stamp.color,
                background: stamp.bg
              }}
            >
              {stamp.label}
            </div>
          )}
        </div>

        {entry.unknownInheritedPity ? <p style={{ marginTop: 8, fontSize: 12, color: tokens.textMuted }}>{text(
          `本段记录包含本池 ${entry.localPulls} 抽，继承间隔无法核实，不参与保底间隔统计。`,
          `This banner has ${entry.localPulls} stored pulls in this segment; the inherited interval cannot be verified.`)}</p> : null}
        {inheritedPulls > 0 ? <p style={{ marginTop: 8, fontSize: 12, color: tokens.textSecondary }}>{text(
          `上池垫抽 ${inheritedPulls} 抽 + 本池 ${entry.localPulls} 抽`,
          `Previous banner: ${inheritedPulls} pulls + This banner: ${entry.localPulls} pulls`)}</p> : null}
        {entry.weaponBatch ? <div style={{ marginTop: 10, padding: 8, border: `1px solid ${tokens.border}`, fontSize: 12 }}>
          <div>{entry.weaponBatch.isCompleteTenPull ? text('本次十连', 'This 10-pull')
            : text(`该批已知 ${entry.weaponBatch.size} 抽`, `Known batch: ${entry.weaponBatch.size} pulls`)}
            {' · '}6★ ×{entry.weaponBatch.sixStarCount}{showFiveStarDrops ? ` · 5★ ×${entry.weaponBatch.fiveStarCount}` : ''}</div>
          {entry.weaponBatch.isCompleteTenPull ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 4, marginTop: 6 }}>
            {entry.weaponBatch.slots.map((slot, index) => <span key={index} style={{ textAlign: 'center', padding: 4,
              border: `1px solid ${tokens.border}`, background: slot.rarity >= 6 ? '#fbbf24' : tokens.panelMutedBackground,
              color: slot.rarity >= 6 ? '#451a03' : tokens.textMuted }}>
              {!showFiveStarDrops && slot.rarity === 5 ? '·' : `${slot.rarity}★`}</span>)}
          </div> : null}
        </div> : null}

        {visibleBadges.length > 0 && (
          <div style={styles.badgeList}>
            {visibleBadges.map((badge) => (
              <div key={`${entry.id}-${badge.label}`} style={{ ...styles.dropBadge, borderColor: tokens.border, background: tokens.panelMutedBackground }}>
                <div style={{ ...styles.dropThumb, background: tokens.iconBackground, color: tokens.textPrimary, overflow: 'hidden' }}>
                  {badge.avatarUrl ? (
                    <img
                      src={badge.avatarUrl}
                      alt={badge.label}
                      style={{ width: '20px', height: '20px', objectFit: 'cover', display: 'block' }}
                    />
                  ) : (
                    String(badge.label || '?').slice(0, 1)
                  )}
                </div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: tokens.textPrimary }}>
                  {badge.label}
                  <span style={{ marginLeft: '6px', color: tokens.textMuted }}>x{badge.count}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ShareAcquisitions({ section, tokens, showFiveStarDrops }) {
  const { locale, isEnglish } = useI18n();
  const text = (zh, en) => isEnglish ? en : zh;
  const rows = section.acquisitions?.filter(row => showFiveStarDrops || row.rarity >= 6);
  return <div style={{ marginTop: 16 }}>
    {!rows ? <p style={{ color: tokens.textMuted }}>{text('逐条出货详情尚未更新。', 'Drop details are not available yet.')}</p>
      : !rows.length ? <p style={{ color: tokens.textMuted }}>{text('暂无符合筛选的高星结果。', 'No matching high-rarity drops.')}</p>
      : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
        {rows.map((row, index) => {
          const special = row.drawMethod === 'gift' ? text('额外赠送', 'Gift')
            : row.drawMethod === 'free' ? text('免费十连', 'Free ten-pull')
              : row.drawMethod === 'info_book' ? text('情报书', 'Intel ticket') : null;
          const timestamp = row.timestamp ? new Date(row.timestamp) : null;
          const date = timestamp && Number.isFinite(timestamp.getTime())
            ? timestamp.toLocaleString(locale, { year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
            : text('时间未知', 'Time unknown');
          return <article key={row.id || index} style={{ position: 'relative', overflow: 'hidden', padding: 14,
            border: `1px solid ${tokens.border}`, background: tokens.panelMutedBackground }}>
            <span style={{ position: 'absolute', inset: '0 auto 0 0', width: 4, background: getTimelineBarColor(section.type, row) }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              {row.avatarUrl ? <img src={row.avatarUrl} alt="" style={{ width: 48, height: 48, objectFit: 'cover' }} /> : null}
              <div style={{ minWidth: 0 }}><strong style={{ fontSize: 16, overflowWrap: 'anywhere' }}>{row.name}</strong>
                <div style={{ marginTop: 4, color: tokens.textMuted, fontSize: 12 }}>{row.rarity}★{special ? ` · ${special}`
                  : row.stageKind === 'up' ? ' · UP' : row.stageKind === 'offLimited' ? text(' · 歪其他限定', ' · Other limited')
                    : row.stageKind === 'offStandard' ? text(' · 常驻', ' · Standard') : ''}</div></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11 }}>
              <div><div style={{ color: tokens.textMuted }}>{text('本次出货间隔', 'Drop interval')}</div>
                <strong style={{ display: 'block', marginTop: 5 }}>{special || (row.intervalPulls == null ? text('未知', 'Unknown') : text(`${row.intervalPulls} 抽`, `${row.intervalPulls} pulls`))}</strong></div>
              <div><div style={{ color: tokens.textMuted }}>{text('本池已存位置', 'Saved position')}</div>
                <strong style={{ display: 'block', marginTop: 5 }}>{row.pullIndex == null ? '—' : text(`第 ${row.pullIndex} 抽`, `Pull #${row.pullIndex}`)}</strong></div>
            </div>
            <time style={{ display: 'block', marginTop: 12, paddingTop: 8, borderTop: `1px solid ${tokens.border}`, fontSize: 11, color: tokens.textMuted }}>{date}</time>
          </article>;
        })}
      </div>}
    {section.type === 'weapon' ? <p style={{ marginTop: 12, fontSize: 11, color: tokens.textMuted }}>{text('位置按已存武器结果计数；十连内序号不等同于申领次数。额外赠送不计入抽数。', 'Positions count saved weapon results; order within a ten-pull is not claim cost. Gifts do not count as pulls.')}</p> : null}
  </div>;
}

function TimelineSection({ section, tokens, tt, theme, displayMode, showFiveStarDrops = true }) {
  const tone = getSectionTone(section.type);
  const secondaryLabel = section.type === 'standard'
    ? tt('dashboard.shareCard.averageFive', 'Average 5★')
    : tt('dashboard.shareCard.averageUp', 'Average UP');
  const secondaryValue = section.type === 'standard'
    ? formatAverage(section.avgFiveStarPulls, tt)
    : formatAverage(section.avgUpPulls, tt);

  return (
    <div style={{ ...styles.sectionCard, borderColor: tokens.border, background: tokens.panelBackground }}>
      <div style={{ height: '4px', width: '100%', background: tone.accent }} />
      <div style={styles.sectionInner}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 900, color: tokens.textPrimary }}>{section.title}</div>
              <div
                style={{
                  ...styles.badge,
                  padding: '4px 8px',
                  fontSize: '10px',
                  color: tone.accent,
                  borderColor: tone.accent,
                  background: tone.soft
                }}
              >
                {getSectionTypeLabel(section.type, tt)}
              </div>
              {section.featured && (
                <div
                  style={{
                    ...styles.badge,
                    padding: '4px 8px',
                    fontSize: '10px',
                    color: tone.accent,
                    borderColor: tone.accent,
                    background: tone.soft
                  }}
                >
                  {section.featured}
                </div>
              )}
            </div>
            <div style={{ ...styles.subtitle, marginTop: '6px', color: tokens.textSecondary }}>
              <span>{section.period}</span>
              <span>|</span>
              <span style={{ color: tone.accent }}>{getStatusText(section.status, tt)}</span>
            </div>
          </div>

          <div style={styles.sectionMeta}>
            <div style={styles.metricCell}>
              <div style={{ ...styles.statLabel, color: tokens.textMuted }}>{tt('dashboard.shareCard.totalPulls', 'Total')}</div>
              <div style={{ ...styles.metricValue, color: tokens.textPrimary }}>{tt('dashboard.shareCard.totalPullsValue', '{value} pulls', { value: section.totalPulls })}</div>
            </div>
            <div style={styles.metricCell}>
              <div style={{ ...styles.statLabel, color: tokens.textMuted }}>{tt('dashboard.shareCard.currentPityShort', 'Pity')}</div>
              <div style={{ ...styles.metricValue, color: tokens.textPrimary }}>
                {section.hidePityState ? tt('dashboard.shareCard.multiAccount', 'Merged') : `${section.currentPity}`}
              </div>
            </div>
            <div style={styles.metricCell}>
              <div style={{ ...styles.statLabel, color: tokens.textMuted }}>{tt('dashboard.shareCard.averageSix', 'Average 6★')}</div>
              <div style={{ ...styles.metricValue, color: tokens.textPrimary }}>{formatAverage(section.avgSixStarPulls, tt)}</div>
            </div>
            <div style={styles.metricCell}>
              <div style={{ ...styles.statLabel, color: tokens.textMuted }}>{secondaryLabel}</div>
              <div style={{ ...styles.metricValue, color: tokens.textPrimary }}>{secondaryValue}</div>
            </div>
          </div>
        </div>

        {displayMode === 'card' ? <ShareAcquisitions section={section} tokens={tokens} showFiveStarDrops={showFiveStarDrops} />
          : (section.entries || []).map((entry) => (
            <TimelineEntry key={entry.id} entry={entry} section={section} tokens={tokens} tt={tt} theme={theme} showFiveStarDrops={showFiveStarDrops} />
          ))}
      </div>
    </div>
  );
}

const DashboardShareCard = forwardRef(function DashboardShareCard({ payload, sections = [], theme = 'light', displayMode = 'waterfall', showFiveStarDrops = true }, ref) {
  const { t, isEnglish } = useI18n();
  const cardMode = displayMode === 'card';
  const tt = (key, fallback, params = {}) => t(key, params, fallback);
  const tokens = getThemeTokens(theme);
  const accentColor = getSectionTone(payload?.poolType).accent;
  const averageGroupMap = new Map((payload?.averageGroups || []).map((group) => [group.id, group.items]));
  const resourceGroupMap = new Map((payload?.resourceGroups || []).map((group) => [group.id, group.items]));
  const compactBlocks = Array.isArray(payload?.summaryGroups) && payload.summaryGroups.length > 0
    ? payload.summaryGroups.map((group) => ({
        id: group.id,
        title: group.label,
        rows: buildCompactRows({
          poolType: group.id === 'weapon' ? 'weapon' : 'limited',
          summaryItems: group.items,
          averageItems: averageGroupMap.get(group.id) || [],
          resourceItems: resourceGroupMap.get(group.id) || [],
          tt
        })
      }))
    : [
        {
          id: 'overall',
          title: payload?.scopeLabel || tt('dashboard.shareCard.defaultScope', 'Core Stats'),
          rows: buildCompactRows({
            poolType: payload?.poolType,
            summaryItems: payload?.summaryItems || [],
            averageItems: payload?.averageItems || [],
            resourceItems: payload?.resourceItems || [],
            pitySummary: payload?.pitySummary,
            tt
          })
        }
      ];

  return (
    <div ref={ref} style={{ ...styles.root, ...getResolvedShareFontVariables(), background: tokens.rootBackground, borderColor: tokens.border, color: tokens.textPrimary }}>
      <div
        style={{
          ...styles.grid,
          background: tokens.backgroundDecor
        }}
      />

      <div style={{ ...styles.header, borderBottomColor: tokens.border }}>
        <div style={styles.titleWrap}>
          <div style={{ ...styles.eyebrow, color: tokens.textMuted }}>ENDFIELD GACHA ANALYZER</div>
          <div style={{ ...styles.title, color: tokens.textPrimary }}>{payload?.poolName || tt('dashboard.shareCard.defaultTitle', 'Banner Detail Share')}</div>
          <div style={{ ...styles.subtitle, color: tokens.textSecondary }}>
            <span>{payload?.scopeLabel || tt('dashboard.shareCard.defaultView', 'Banner Details')}</span>
            <span>|</span>
            <span>{payload?.poolTypeLabel || tt('dashboard.shareCard.defaultPoolType', 'Banner')}</span>
            <span>|</span>
            <span>{payload?.periodLabel || tt('dashboard.shareCard.status.permanent', 'Always available')}</span>
          </div>
        </div>

        <ShareBrandPanel
          theme={theme}
          accentColor={accentColor}
          compact
          showChips={false}
          showHeader={false}
          qrSize={88}
          style={{ width: '236px', marginLeft: 'auto', flexShrink: 0 }}
        />
      </div>

      <MethodologyBanner
        includeFreePullsInStats={Boolean(payload?.includeFreePullsInStats)}
        methodology={payload?.methodology || tt('dashboard.shareCard.methodology', 'Method: excludes gift nodes and free ten-pulls; intel books still count as valid pulls.')}
        tokens={tokens}
        tt={tt}
      />

      <div>
        <div style={{ ...styles.sectionTitle, color: tokens.textMuted }}>{tt('dashboard.shareCard.coreStats', 'Core Stats')}</div>
        <div style={{ ...(compactBlocks.length > 1 ? styles.compactStatsGrid : {}), marginTop: '10px' }}>
          {compactBlocks.map((block) => (
            <CompactMetricBlock
              key={block.id}
              title={block.title}
              rows={block.rows}
              tokens={tokens}
              accentColor={accentColor}
            />
          ))}
        </div>
        <div style={{ ...styles.compactNote, marginTop: '10px', color: tokens.textMuted }}>
          {payload?.methodology || tt('dashboard.shareCard.methodology', 'Method: excludes gift nodes and free ten-pulls; intel books still count as valid pulls.')}
        </div>
      </div>

      <div style={styles.timelineWrap}>
        <div style={styles.timelineHeader}>
          <div>
            <div style={{ ...styles.sectionTitle, color: tokens.textMuted }}>{cardMode ? isEnglish ? 'Drops by banner' : '各池出货明细' : tt('dashboard.shareCard.timelineTitle', 'Timeline View')}</div>
            <div style={{ marginTop: '6px', fontSize: '14px', color: tokens.textSecondary, fontWeight: 600 }}>
              {cardMode ? isEnglish ? 'Individual drops, saved pull positions and local acquisition times.' : '逐条出货结果、本池已存位置与本地获取时间。' : tt('dashboard.shareCard.timelineSubtitle', 'A complete stage-by-stage recap of the current timeline view.')}
            </div>
          </div>
          <div style={styles.counts}>
            <div style={{ ...styles.countBox, borderColor: tokens.border, background: tokens.panelBackground, color: tokens.textSecondary }}>
              {tt('dashboard.shareCard.stagePools', '{count} stages', { count: payload?.totalSections || 0 })}
            </div>
            <div style={{ ...styles.countBox, borderColor: tokens.border, background: tokens.panelBackground, color: tokens.textSecondary }}>
              {tt('dashboard.shareCard.timelineNodes', '{count} nodes', { count: payload?.totalNodes || 0 })}
            </div>
          </div>
        </div>

        {sections.map((section) => (
          <TimelineSection key={section.id} section={section} tokens={tokens} tt={tt} theme={theme} displayMode={displayMode} showFiveStarDrops={showFiveStarDrops} />
        ))}
      </div>

      <div style={{ ...styles.footer, borderTopColor: tokens.border, color: tokens.footerText }}>
        <div style={styles.footerTextWrap}>
          <span>{payload?.notes || tt('share.dashboard.noteDesensitized', 'Desensitized share card. No account, UID, timestamp, or raw pull details included.')}</span>
          <span>{tt('dashboard.shareCard.localOnly', 'Scan or open the site to continue the full analysis. This card is generated locally only and does not create a public link.')}</span>
        </div>
      </div>
    </div>
  );
});

export default DashboardShareCard;
