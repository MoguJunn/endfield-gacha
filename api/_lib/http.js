const DEFAULT_ALLOWED_ORIGINS = [
  'https://ef-gacha.mogujun.icu',
  'https://endfield.15963574.xyz',
  'https://endfield-gacha.vercel.app',
  'https://endfield-version-calendar.vercel.app',
  'https://endfield-status-page.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

const LOCALHOST_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
const rateLimitBuckets = new Map();

function splitOrigins(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/\/$/, ''));
}

export function getAllowedOrigins() {
  const envOrigins = splitOrigins(
    process.env.API_ALLOWED_ORIGINS ||
    process.env.ALLOWED_ORIGINS ||
    process.env.VITE_APP_URL
  );

  return new Set([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...envOrigins
  ]);
}

export function isAllowedOrigin(origin) {
  if (!origin) return true;

  const normalizedOrigin = origin.replace(/\/$/, '');
  if (LOCALHOST_ORIGIN_PATTERN.test(normalizedOrigin)) {
    return true;
  }

  return getAllowedOrigins().has(normalizedOrigin);
}

function appendVaryHeader(res, value) {
  const current = res.getHeader('Vary');
  if (!current) {
    res.setHeader('Vary', value);
    return;
  }

  const currentValues = String(current)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (!currentValues.includes(value)) {
    currentValues.push(value);
    res.setHeader('Vary', currentValues.join(', '));
  }
}

export function applyCors(req, res, {
  methods = 'GET, OPTIONS',
  headers = 'Content-Type'
} = {}) {
  const origin = req.headers.origin || '';
  const allowed = isAllowedOrigin(origin);

  appendVaryHeader(res, 'Origin');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', headers);

  if (origin && allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  return { allowed, origin };
}

export function rejectDisallowedBrowserOrigin(req, res, options) {
  const { allowed, origin } = applyCors(req, res, options);

  if (origin && !allowed) {
    res.status(403).json({
      success: false,
      error: 'Origin not allowed'
    });
    return true;
  }

  return false;
}

export function getRequesterKey(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const realIp = req.headers['x-real-ip'];
  const ip = typeof forwardedFor === 'string'
    ? forwardedFor.split(',')[0].trim()
    : realIp || req.socket?.remoteAddress || 'unknown';
  const origin = req.headers.origin || 'no-origin';
  return `${ip}:${origin}`;
}

export function checkMemoryRateLimit(key, {
  windowMs,
  max
}) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    const freshBucket = {
      count: 1,
      resetAt: now + windowMs
    };
    rateLimitBuckets.set(key, freshBucket);
    return {
      allowed: true,
      remaining: max - freshBucket.count,
      retryAfter: 0
    };
  }

  if (bucket.count >= max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    };
  }

  bucket.count += 1;

  return {
    allowed: true,
    remaining: Math.max(0, max - bucket.count),
    retryAfter: 0
  };
}
