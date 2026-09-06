export const HOME_EXPERIENCE = Object.freeze({
  LATEST: 'latest',
  CLASSIC: 'classic',
});

export function resolveHomeExperience({ storedValue, search = '' } = {}) {
  const params = new URLSearchParams(search);

  // Keep previously shared preview URLs working after the latest home ships.
  if (params.get('home-demo') === 'unified') {
    return HOME_EXPERIENCE.LATEST;
  }

  return storedValue === HOME_EXPERIENCE.CLASSIC
    ? HOME_EXPERIENCE.CLASSIC
    : HOME_EXPERIENCE.LATEST;
}

export function clearLegacyHomeQuery(search = '') {
  const params = new URLSearchParams(search);
  ['home-demo', 'panel', 'notice-category', 'notice-id'].forEach((key) => params.delete(key));
  return params.toString();
}
