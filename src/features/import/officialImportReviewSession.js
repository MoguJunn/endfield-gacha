const REVIEW_SESSION_PREFIX = 'endfield:official-import-review:v1';
const TERMINAL_REVIEW_ERROR_CODES = new Set([
  'REVIEW_TASK_NOT_FOUND',
  'REVIEW_TASK_EXPIRED',
  'REVIEW_TASK_REJECTED',
  'REVIEW_TASK_ALREADY_COMMITTED',
  'REVIEW_ACCESS_DENIED',
  'REVIEW_USER_MISMATCH',
]);

function normalizeText(value, maxLength) {
  const text = String(value ?? '').trim();
  return text && text.length <= maxLength ? text : '';
}

function normalizeSource(source) {
  return source === 'intl' ? 'intl' : 'cn';
}

function getSessionStorage(storage) {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage || null;
  } catch {
    return null;
  }
}

function buildSessionKey(userId, source) {
  const owner = normalizeText(userId, 128);
  return owner ? `${REVIEW_SESSION_PREFIX}:${owner}:${normalizeSource(source)}` : '';
}

function removeSessionItem(target, key) {
  try {
    target.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function saveOfficialImportReviewSession({
  userId,
  source,
  taskId,
  accessKey,
}, storage) {
  const target = getSessionStorage(storage);
  const key = buildSessionKey(userId, source);
  const normalizedTaskId = normalizeText(taskId, 128);
  const normalizedAccessKey = normalizeText(accessKey, 512);
  if (!target || !key || !normalizedTaskId || !normalizedAccessKey) return false;

  try {
    target.setItem(key, JSON.stringify({
      taskId: normalizedTaskId,
      accessKey: normalizedAccessKey,
      source: normalizeSource(source),
      savedAt: new Date().toISOString(),
    }));
    return true;
  } catch {
    return false;
  }
}

export function loadOfficialImportReviewSession({ userId, source }, storage) {
  const target = getSessionStorage(storage);
  const key = buildSessionKey(userId, source);
  if (!target || !key) return null;

  try {
    const parsed = JSON.parse(target.getItem(key) || 'null');
    const taskId = normalizeText(parsed?.taskId, 128);
    const accessKey = normalizeText(parsed?.accessKey, 512);
    const savedSource = parsed?.source === 'cn' || parsed?.source === 'intl' ? parsed.source : '';
    if (!taskId || !accessKey || savedSource !== normalizeSource(source)) {
      removeSessionItem(target, key);
      return null;
    }
    return {
      taskId,
      accessKey,
      source: normalizeSource(source),
      savedAt: normalizeText(parsed?.savedAt, 80) || null,
    };
  } catch {
    removeSessionItem(target, key);
    return null;
  }
}

export function clearOfficialImportReviewSession({ userId, source }, storage) {
  const target = getSessionStorage(storage);
  const key = buildSessionKey(userId, source);
  if (!target || !key) return false;
  return removeSessionItem(target, key);
}

export function shouldClearOfficialImportReviewSessionForError(error) {
  const code = String(error?.data?.code || error?.code || '').trim();
  return TERMINAL_REVIEW_ERROR_CODES.has(code);
}

export default {
  clearOfficialImportReviewSession,
  loadOfficialImportReviewSession,
  saveOfficialImportReviewSession,
  shouldClearOfficialImportReviewSessionForError,
};
