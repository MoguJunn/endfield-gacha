const privateFeatureCacheClearers = new Map();

export function registerPrivateFeatureCacheClearer(key, clearer) {
  if (!key || typeof clearer !== 'function') return;
  privateFeatureCacheClearers.set(String(key), clearer);
}

export function clearPrivateFeatureCaches() {
  privateFeatureCacheClearers.forEach((clearer) => {
    try {
      clearer();
    } catch {
      // Cache cleanup must never block logout or account switching.
    }
  });
}

export default {
  clearPrivateFeatureCaches,
  registerPrivateFeatureCacheClearer,
};
