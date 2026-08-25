const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 4000;

export function isSupabaseConnectionPoolTimeout(error) {
  const code = String(error?.code || '');
  return code
    ? code === 'PGRST003'
    : String(error?.message || error || '').includes(
      'Timed out acquiring connection from connection pool'
    );
}

export async function retrySupabaseConnectionPoolOperation(operation, {
  label = 'Supabase operation',
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  logger = console,
} = {}) {
  const attempts = Math.max(1, Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS);
  let lastResult = null;
  let lastThrownError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastThrownError = null;
    try {
      lastResult = await operation();
    } catch (error) {
      if (!isSupabaseConnectionPoolTimeout(error) || attempt >= attempts) {
        throw error;
      }
      lastThrownError = error;
    }

    const operationError = lastThrownError || lastResult?.error;
    if (!isSupabaseConnectionPoolTimeout(operationError) || attempt >= attempts) {
      if (lastThrownError) throw lastThrownError;
      return lastResult;
    }

    const delayMs = Math.min(
      baseDelayMs * (2 ** Math.max(0, attempt - 1)),
      maxDelayMs
    );
    logger?.warn?.(
      `[SupabaseRetry] ${label} 遇到连接池繁忙（PGRST003），将在 ${delayMs}ms 后重试 ${attempt + 1}/${attempts}`
    );
    await sleep(delayMs);
  }

  if (lastThrownError) throw lastThrownError;
  return lastResult;
}
