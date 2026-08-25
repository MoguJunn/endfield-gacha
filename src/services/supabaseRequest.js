import {
  createContributorDemoReadonlyError,
  isContributorDemoModeEnabled,
} from '../dev/contributorDemoMode.js';

const DEV_READ_TIMEOUT_MS = 45000;
const DEV_RPC_TIMEOUT_MS = 60000;
const DEV_MUTATION_TIMEOUT_MS = 40000;
const PROD_READ_TIMEOUT_MS = 35000;
const PROD_RPC_TIMEOUT_MS = 45000;
const PROD_MUTATION_TIMEOUT_MS = 30000;
const IS_DEV = Boolean(import.meta.env?.DEV);

export const SUPABASE_READ_TIMEOUT_MS = IS_DEV ? DEV_READ_TIMEOUT_MS : PROD_READ_TIMEOUT_MS;
export const SUPABASE_RPC_TIMEOUT_MS = IS_DEV ? DEV_RPC_TIMEOUT_MS : PROD_RPC_TIMEOUT_MS;
export const SUPABASE_MUTATION_TIMEOUT_MS = IS_DEV ? DEV_MUTATION_TIMEOUT_MS : PROD_MUTATION_TIMEOUT_MS;

function wait(ms) {
  return new Promise(resolve => {
    globalThis.setTimeout(resolve, ms);
  });
}

function createClientTimeoutError(label, timeoutMs) {
  const error = new Error(`${label} timed out after ${timeoutMs}ms`);
  error.code = 'CLIENT_TIMEOUT';
  error.name = 'TimeoutError';
  return error;
}

export function isRetryableSupabaseError(error) {
  const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();

  return (
    error?.code === 'CLIENT_TIMEOUT' ||
    error?.code === '57014' ||
    error?.name === 'AbortError' ||
    error?.name === 'TimeoutError' ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('failed to fetch') ||
    message.includes('fetch failed') ||
    message.includes('networkerror')
  );
}

async function executeWithTimeout(buildRequest, {
  label,
  timeoutMs,
  retries = 0,
  retryDelayMs = 1500,
} = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const abortController = new AbortController();
    const timeoutId = globalThis.setTimeout(() => abortController.abort(), timeoutMs);

    try {
      // eslint-disable-next-line no-await-in-loop -- each retry must rebuild the request with the latest auth headers
      let request = await buildRequest();
      if (typeof request?.abortSignal === 'function') {
        request = request.abortSignal(abortController.signal);
      }

      // eslint-disable-next-line no-await-in-loop -- retry loop needs per-attempt timeout/abort handling
      return await request;
    } catch (error) {
      lastError = error?.name === 'AbortError'
        ? createClientTimeoutError(label || 'supabase request', timeoutMs)
        : error;

      if (attempt >= retries || !isRetryableSupabaseError(lastError)) {
        throw lastError;
      }

      // eslint-disable-next-line no-await-in-loop -- retry backoff is intentionally sequential
      await wait(retryDelayMs * (attempt + 1));
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  }

  throw lastError || createClientTimeoutError(label || 'supabase request', timeoutMs);
}

export async function executeSupabaseRead(buildRequest, options = {}) {
  if (isContributorDemoModeEnabled()) {
    throw createContributorDemoReadonlyError(options.label || 'supabase-read');
  }
  return executeWithTimeout(buildRequest, {
    timeoutMs: SUPABASE_READ_TIMEOUT_MS,
    retries: 1,
    ...options,
  });
}

export async function executeSupabaseRpc(buildRequest, options = {}) {
  if (isContributorDemoModeEnabled()) {
    throw createContributorDemoReadonlyError(options.label || 'supabase-rpc');
  }
  return executeWithTimeout(buildRequest, {
    timeoutMs: SUPABASE_RPC_TIMEOUT_MS,
    retries: 1,
    ...options,
  });
}

export async function executeSupabaseMutation(buildRequest, options = {}) {
  if (isContributorDemoModeEnabled()) {
    throw createContributorDemoReadonlyError(options.label || 'supabase-mutation');
  }
  return executeWithTimeout(buildRequest, {
    timeoutMs: SUPABASE_MUTATION_TIMEOUT_MS,
    retries: 0,
    ...options,
  });
}

export async function fetchWithTimeout(input, init = {}, {
  label = 'fetch request',
  timeoutMs = SUPABASE_READ_TIMEOUT_MS,
  retries = 0,
  retryDelayMs = 1500,
} = {}) {
  if (isContributorDemoModeEnabled()) {
    throw createContributorDemoReadonlyError(`${String(init?.method || 'GET').toUpperCase()} ${String(input || '')}`);
  }
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const abortController = new AbortController();
    const timeoutId = globalThis.setTimeout(() => abortController.abort(), timeoutMs);

    try {
      // eslint-disable-next-line no-await-in-loop -- retry loop needs per-attempt timeout/abort handling
      const response = await fetch(input, {
        ...init,
        signal: abortController.signal,
      });
      return response;
    } catch (error) {
      lastError = error?.name === 'AbortError'
        ? createClientTimeoutError(label, timeoutMs)
        : error;

      if (attempt >= retries || !isRetryableSupabaseError(lastError)) {
        throw lastError;
      }

      // eslint-disable-next-line no-await-in-loop -- retry backoff is intentionally sequential
      await wait(retryDelayMs * (attempt + 1));
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  }

  throw lastError || createClientTimeoutError(label, timeoutMs);
}

export async function fetchJsonWithTimeout(input, init = {}, options = {}) {
  const response = await fetchWithTimeout(input, init, options);
  const data = await response.json().catch(() => null);
  return { response, data };
}

export default {
  SUPABASE_READ_TIMEOUT_MS,
  SUPABASE_RPC_TIMEOUT_MS,
  SUPABASE_MUTATION_TIMEOUT_MS,
  executeSupabaseRead,
  executeSupabaseRpc,
  executeSupabaseMutation,
  fetchWithTimeout,
  fetchJsonWithTimeout,
  isRetryableSupabaseError,
};
