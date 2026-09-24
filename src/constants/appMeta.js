import packageJson from '../../package.json' with { type: 'json' };

export const APP_VERSION = packageJson.version;
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
export const APP_BUILD_INFO = 'Build 2026.09.05';

const DEFAULT_FORCE_REFRESH_TOKEN = '2026-05-30-release-refresh-v1';

// Bump this token only for releases that need every browser to load the newest
// assets once. Vercel can override it with VITE_APP_FORCE_REFRESH_TOKEN.
export const APP_FORCE_REFRESH_TOKEN = String(
  import.meta.env?.VITE_APP_FORCE_REFRESH_TOKEN || DEFAULT_FORCE_REFRESH_TOKEN
).trim();
