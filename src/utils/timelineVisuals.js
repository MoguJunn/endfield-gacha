export function getTimelineVisualKind(entry) {
  if (entry?.stageKind === 'gift') {
    return entry?.highlightStageKind || (Number(entry?.highestRarity) >= 6 ? 'up' : Number(entry?.highestRarity) === 5 ? 'fiveStar' : 'gift');
  }

  return entry?.stageKind || 'generic';
}

export function getTimelineBarColor(sectionType, entry) {
  const visualKind = entry?.stageKind || 'generic';

  if (visualKind === 'gift') {
    return '#34d399';
  }

  if (visualKind === 'fiveStar') {
    return '#fbbf24';
  }

  if (visualKind === 'sixStar') {
    if (sectionType === 'weapon') {
      return '#f59e0b';
    }

    if (sectionType === 'standard') {
      return '#3b82f6';
    }

    return 'linear-gradient(90deg, #f59e0b 0%, #ec4899 35%, #8b5cf6 68%, #3b82f6 100%)';
  }

  if (visualKind === 'up') {
    if (sectionType === 'weapon') {
      return '#f59e0b';
    }

    return 'linear-gradient(90deg, #f59e0b 0%, #ec4899 35%, #8b5cf6 68%, #3b82f6 100%)';
  }

  if (visualKind === 'offStandard') {
    return '#94a3b8';
  }

  if (visualKind === 'offLimited') {
    return '#fb7185';
  }

  if (sectionType === 'weapon') {
    return '#f59e0b';
  }

  if (sectionType === 'standard') {
    return '#3b82f6';
  }

  return 'linear-gradient(90deg, #f59e0b 0%, #ec4899 35%, #8b5cf6 68%, #3b82f6 100%)';
}

export function getTimelineTextBadgeStyle(entry, rarity, theme = 'light') {
  const normalizedRarity = Number(rarity);
  const visualKind = getTimelineVisualKind(entry);
  if (normalizedRarity >= 6) {
    if (visualKind === 'up') {
      return theme === 'dark'
        ? {
            background: 'linear-gradient(90deg, rgba(245, 158, 11, 0.30) 0%, rgba(236, 72, 153, 0.30) 45%, rgba(59, 130, 246, 0.30) 100%)',
            color: '#fff7ed',
            borderColor: 'rgba(250, 204, 21, 0.52)',
          }
        : {
            background: 'linear-gradient(90deg, rgba(245, 158, 11, 0.18) 0%, rgba(236, 72, 153, 0.18) 45%, rgba(59, 130, 246, 0.18) 100%)',
            color: '#9a3412',
            borderColor: 'rgba(245, 158, 11, 0.38)',
          };
    }

    if (visualKind === 'offLimited') {
      return theme === 'dark'
        ? {
            background: 'rgba(251, 113, 133, 0.18)',
            color: '#fecdd3',
            borderColor: 'rgba(251, 113, 133, 0.40)',
          }
        : {
            background: 'rgba(251, 113, 133, 0.12)',
            color: '#be123c',
            borderColor: 'rgba(251, 113, 133, 0.30)',
          };
    }

    if (visualKind === 'offStandard') {
      return theme === 'dark'
        ? {
            background: 'rgba(148, 163, 184, 0.18)',
            color: '#e2e8f0',
            borderColor: 'rgba(148, 163, 184, 0.38)',
          }
        : {
            background: 'rgba(148, 163, 184, 0.14)',
            color: '#475569',
            borderColor: 'rgba(148, 163, 184, 0.30)',
          };
    }

    if (visualKind === 'gift') {
      return theme === 'dark'
        ? {
            background: 'rgba(52, 211, 153, 0.18)',
            color: '#d1fae5',
            borderColor: 'rgba(52, 211, 153, 0.42)',
          }
        : {
            background: 'rgba(52, 211, 153, 0.12)',
            color: '#047857',
            borderColor: 'rgba(52, 211, 153, 0.30)',
          };
    }

    return theme === 'dark'
      ? {
          background: 'rgba(245, 158, 11, 0.20)',
          color: '#fde68a',
          borderColor: 'rgba(245, 158, 11, 0.42)',
        }
      : {
          background: 'rgba(245, 158, 11, 0.14)',
          color: '#92400e',
          borderColor: 'rgba(245, 158, 11, 0.30)',
        };
  }

  if (normalizedRarity >= 5) {
    return theme === 'dark'
      ? {
          background: 'rgba(168, 85, 247, 0.22)',
          color: '#f3e8ff',
          borderColor: 'rgba(168, 85, 247, 0.42)',
        }
      : {
          background: 'rgba(168, 85, 247, 0.12)',
          color: '#7e22ce',
          borderColor: 'rgba(168, 85, 247, 0.30)',
        };
  }

  return null;
}
