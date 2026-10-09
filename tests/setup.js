import '@testing-library/jest-dom/vitest';

function createMemoryStorage() {
  const entries = new Map();

  return {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key) {
      const normalizedKey = String(key);
      return entries.has(normalizedKey) ? entries.get(normalizedKey) : null;
    },
    key(index) {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key) {
      entries.delete(String(key));
    },
    setItem(key, value) {
      entries.set(String(key), String(value));
    },
  };
}

function ensureStorage(target, name) {
  if (!target) return;

  const descriptor = Object.getOwnPropertyDescriptor(target, name);
  if (descriptor && !descriptor.get && typeof descriptor.value?.clear === 'function') {
    return;
  }

  Object.defineProperty(target, name, {
    value: createMemoryStorage(),
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

ensureStorage(globalThis, 'localStorage');
ensureStorage(globalThis.window, 'localStorage');
