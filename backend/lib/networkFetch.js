const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 350;
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMER_MS = 2147483647;

// These failures establish that no connection was made. A reset, socket error,
// or generic timeout does not establish whether a write reached the server.
const PRE_CONNECTION_CODES = new Set([
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNREFUSED',
  'UND_ERR_CONNECT_TIMEOUT',
]);

const RETRYABLE_NETWORK_CODES = new Set([
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNRESET',
  'EPIPE',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

export function boundedInteger(value, name, min, max = MAX_TIMER_MS) {
  if ((typeof value !== 'number' && typeof value !== 'string')
      || (typeof value === 'string' && !/^\d+$/.test(value.trim()))) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

export function abortError(reason) {
  if (reason instanceof Error || reason?.name === 'AbortError') return reason;
  const error = new Error(reason == null ? 'Operation cancelled' : String(reason));
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

export function timeoutError(message, code = 'ETIMEDOUT') {
  const error = new Error(message);
  error.name = 'TimeoutError';
  error.code = code;
  return error;
}

/** Combine cancellation sources and an absolute deadline without leaking timers. */
export function createDeadlineScope({ signals = [], timeoutMs, deadline } = {}) {
  if (timeoutMs !== undefined) boundedInteger(timeoutMs, 'timeoutMs', 1);
  if (deadline !== undefined && (typeof deadline !== 'number' || !Number.isFinite(deadline))) {
    throw new RangeError('deadline must be a finite epoch timestamp in milliseconds');
  }
  const controller = new AbortController();
  const listeners = [];
  let timer = null;
  const cleanup = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    for (const [signal, listener] of listeners) signal.removeEventListener('abort', listener);
    listeners.length = 0;
  };
  controller.signal.addEventListener('abort', cleanup, { once: true });

  for (const signal of new Set(signals.filter(Boolean))) {
    if (signal.aborted) {
      controller.abort(abortError(signal.reason));
      break;
    }
    const listener = () => controller.abort(abortError(signal.reason));
    listeners.push([signal, listener]);
    signal.addEventListener('abort', listener, { once: true });
  }

  const expiresAt = Math.min(
    timeoutMs === undefined ? Infinity : Date.now() + Number(timeoutMs),
    deadline ?? Infinity
  );
  if (!controller.signal.aborted && Number.isFinite(expiresAt)) {
    const expire = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        controller.abort(timeoutError('Total request deadline exceeded'));
      } else {
        timer = setTimeout(expire, Math.min(remaining, MAX_TIMER_MS));
      }
    };
    expire();
  }
  return {
    controller,
    signal: controller.signal,
    throwIfAborted: () => {
      // Check the clock as well: a busy event loop can delay the timer callback.
      if (!controller.signal.aborted && Date.now() >= expiresAt) {
        controller.abort(timeoutError('Total request deadline exceeded'));
      }
      controller.signal.throwIfAborted();
    },
    cleanup: () => {
      cleanup();
      controller.signal.removeEventListener('abort', cleanup);
    },
  };
}

export function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal.reason));
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(abortError(signal.reason));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function waitWithSignal(promise, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError(signal.reason));
    signal.addEventListener('abort', onAbort, { once: true });
    // Keep handlers on the underlying promise even if cancellation wins.
    Promise.resolve(promise).then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
    if (signal.aborted) onAbort();
  });
}

function preserveResponseMetadata(response, metadata) {
  // Constructing a Response from a stream does not copy fetch-only metadata.
  // Use native Response body methods and cloning, and retain that metadata on
  // every clone without buffering or re-reading the body.
  for (const name of ['url', 'redirected', 'type']) {
    Object.defineProperty(response, name, { value: metadata[name], configurable: true });
  }
  const clone = response.clone.bind(response);
  Object.defineProperty(response, 'clone', {
    configurable: true,
    value: () => preserveResponseMetadata(clone(), metadata),
  });
  return response;
}

function responseWithDeadline(response, scope) {
  // Existing callers also inject small fake responses in tests. A null body
  // (HEAD/204) or an object without the Response body API has nothing to track.
  if (typeof response?.body?.getReader !== 'function' || typeof response?.arrayBuffer !== 'function') {
    scope.cleanup();
    return response;
  }

  const reader = response.body.getReader();
  let finished = false;
  let streamController;
  const cleanup = () => {
    scope.signal.removeEventListener('abort', onAbort);
    scope.cleanup();
  };
  const releaseReader = () => reader.releaseLock();
  const onAbort = () => {
    if (finished) return;
    finished = true;
    const error = abortError(scope.signal.reason);
    streamController.error(error);
    cleanup();
    // The fetch signal aborts the actual transport. Cancel the source as well,
    // but a non-cooperative source must not keep deadline resources alive.
    reader.cancel(error).then(releaseReader, releaseReader).catch(() => {});
  };

  const body = new ReadableStream({
    start(controller) {
      streamController = controller;
      scope.signal.addEventListener('abort', onAbort, { once: true });
      if (scope.signal.aborted) onAbort();
    },
    async pull(controller) {
      try {
        scope.throwIfAborted();
        const { done, value } = await reader.read();
        if (finished) return;
        scope.throwIfAborted();
        if (done) {
          finished = true;
          controller.close();
          cleanup();
          releaseReader();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        if (!finished) scope.controller.abort(abortError(error));
      }
    },
    cancel(reason) {
      if (!finished) scope.controller.abort(abortError(reason));
    },
  }, { highWaterMark: 0 });

  // Observe failures even when the caller has not started reading the body.
  reader.closed.catch(error => {
    if (!finished) scope.controller.abort(abortError(error));
  });

  try {
    return preserveResponseMetadata(new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }), { url: response.url, redirected: response.redirected, type: response.type });
  } catch (error) {
    scope.controller.abort(abortError(error));
    throw error;
  }
}

export function getNetworkErrorCode(error) {
  return error?.cause?.code
    || error?.code
    || error?.cause?.cause?.code
    || '';
}

export function isRetryableNetworkError(error, method = 'GET') {
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError' || error?.code === 'ABORT_ERR') {
    return false;
  }
  const code = getNetworkErrorCode(error);
  if (!RETRYABLE_NETWORK_CODES.has(code)) return false;
  if (['GET', 'HEAD'].includes(String(method).toUpperCase())) return true;
  return PRE_CONNECTION_CODES.has(code)
    || (code === 'ETIMEDOUT'
      && [error, error?.cause, error?.cause?.cause].some((cause) => cause?.syscall === 'connect'));
}

export function describeNetworkError(error) {
  const code = getNetworkErrorCode(error) || 'UNKNOWN';
  const hostname = error?.cause?.hostname || error?.hostname || '';
  const message = error?.message || String(error);
  return hostname ? `${message} (${code}, host=${hostname})` : `${message} (${code})`;
}

export async function fetchWithNetworkRetry(input, init = {}, options = {}) {
  const {
    label = 'fetch',
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    deadline,
    signal,
    fetchFn = globalThis.fetch,
  } = options;
  boundedInteger(maxAttempts, 'maxAttempts', 1, 11);
  boundedInteger(baseDelayMs, 'baseDelayMs', 0, 300000);
  const method = init?.method || input?.method || 'GET';
  const scope = createDeadlineScope({
    signals: [signal, init?.signal, input?.signal],
    timeoutMs,
    deadline,
  });
  // Keep caller cancellation connected for fake/null-body responses too, for
  // which our deadline scope can be cleaned up immediately after headers.
  const requestSignal = AbortSignal.any([scope.signal, signal, init?.signal, input?.signal].filter(Boolean));
  let responseOwnsScope = false;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      scope.throwIfAborted();
      let response;
      try {
        response = await waitWithSignal(fetchFn(input, { ...init, signal: requestSignal }), scope.signal);
        scope.throwIfAborted();
      } catch (error) {
        scope.throwIfAborted();
        if (!isRetryableNetworkError(error, method) || attempt >= maxAttempts) throw error;

        const delayMs = baseDelayMs * attempt;
        console.warn(
          `[NetworkFetch] ${label} failed (${describeNetworkError(error)}), retrying ${attempt + 1}/${maxAttempts} in ${delayMs}ms`
        );
        await abortableSleep(delayMs, scope.signal);
        continue;
      }
      // After receiving headers, body failures belong to this Response. They
      // must never replay an already issued request, including a write.
      const wrapped = responseWithDeadline(response, scope);
      responseOwnsScope = true;
      return wrapped;
    }
  } finally {
    if (!responseOwnsScope) scope.cleanup();
  }
}
