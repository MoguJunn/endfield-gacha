export const DESKTOP_MESSAGE_CATEGORIES = [
  { id: 'system', zh: '网站通知', en: 'Notifications' },
  { id: 'site', zh: '网站公告', en: 'Site notices' },
  { id: 'game', zh: '游戏内公告', en: 'In-game notices' },
  { id: 'official', zh: '官网公告', en: 'Official website' },
];

export function getDesktopAnnouncementGroup(item) {
  if (!item?.source_id) return 'site';
  return item.source_group === 'game' ||
    item.source_kind === 'game-bulletin' ||
    String(item.source_id).startsWith('game-bulletin:') ||
    String(item.source_url || '').includes('game_bulletin')
    ? 'game'
    : 'official';
}

export function buildDesktopMessageGroups(notifications = [], siteAnnouncements = [], gameAnnouncements = []) {
  const groups = { system: notifications, site: [], game: [], official: [] };
  const seen = new Set();
  for (const item of [...siteAnnouncements, ...gameAnnouncements]) {
    if (item?.is_active === false) continue;
    const group = getDesktopAnnouncementGroup(item);
    const key = `${group}:${item.source_id || item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    groups[group].push(item);
  }
  return groups;
}

export function getAccountAutoNotification(notifications = []) {
  return (
    notifications.find(
      (item) => !item.readAt && item.category === 'account' && (item.type === 'error' || item.type === 'warning')
    ) || null
  );
}

export function getDesktopMessageId(item) {
  return String(item?.source_id || item?.id || '');
}
