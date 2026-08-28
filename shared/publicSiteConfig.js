export const PUBLIC_SITE_CONFIG_KEYS = Object.freeze([
  'site_version',
  'build_info',
  'author_name',
  'author_bilibili',
  'github_url',
  'icp_number',
  'icp_url',
  'police_number',
  'police_url',
  'legal_registration_by_domain',
  'about_disclaimer',
  'home_hero_slogan',
  'qq_group_number',
  'home_next_version_target_at',
  'home_version_timeline',
  'home_roadmap_items',
  'home_friendly_links',
  'about_features',
  'pool_localizations',
  'entity_localizations',
]);

const PUBLIC_SITE_CONFIG_KEY_SET = new Set(PUBLIC_SITE_CONFIG_KEYS);

export function isPublicSiteConfigKey(key) {
  return PUBLIC_SITE_CONFIG_KEY_SET.has(String(key || ''));
}

export function pickPublicSiteConfig(config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  return Object.fromEntries(
    Object.entries(config).filter(([key]) => isPublicSiteConfigKey(key))
  );
}
