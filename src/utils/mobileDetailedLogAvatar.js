import { getCharacterAvatarUrl } from './characterUtils.js';

export function resolveMobileDetailedLogAvatarUrl(item = {}) {
  const directUrl = item.avatarUrl || item.avatar_url;
  if (directUrl) return directUrl;

  const candidates = [
    item.character_id,
    item.characterId,
    item.character_name,
    item.characterName,
    item.item_name,
    item.name,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const avatarUrl = getCharacterAvatarUrl(candidate);
    if (avatarUrl) return avatarUrl;
  }
  return null;
}

export default resolveMobileDetailedLogAvatarUrl;
