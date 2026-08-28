import {
  checkMemoryRateLimit,
  getRequesterKey,
  rejectDisallowedBrowserOrigin,
} from '../../_lib/http.js';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 180;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const UPSTREAM_TIMEOUT_MS = 15000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_IMAGE_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const ALLOWED_HOSTS = new Set([
  'web.hycdn.cn',
  'bbs.hycdn.cn',
  'endfield.hypergryph.com',
  'web-news.hypergryph.com',
]);

function normalizeTargetUrl(rawValue) {
  const normalizedValue = String(rawValue || '').trim();
  if (!normalizedValue) {
    return null;
  }

  try {
    const parsedUrl = new URL(normalizedValue);
    if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password || (parsedUrl.port && parsedUrl.port !== '443')) {
      return null;
    }

    if (!ALLOWED_HOSTS.has(parsedUrl.hostname)) {
      return null;
    }

    return parsedUrl;
  } catch {
    return null;
  }
}

function hasValidImageSignature(arrayBuffer, contentType) {
  const bytes = new Uint8Array(arrayBuffer);
  const ascii = (start, length) => String.fromCharCode(...bytes.slice(start, start + length));
  if (contentType === 'image/png') {
    return bytes.length >= 8
      && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  }
  if (contentType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === 'image/gif') return bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
  if (contentType === 'image/webp') return bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
  if (contentType === 'image/avif') {
    if (bytes.length < 16 || ascii(4, 4) !== 'ftyp') return false;
    const brands = ascii(8, Math.min(bytes.length - 8, 32));
    return brands.includes('avif') || brands.includes('avis');
  }
  return false;
}

async function fetchValidatedImage(targetUrl) {
  let currentUrl = targetUrl;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await fetch(currentUrl.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/gif',
          'Referer': 'https://endfield.hypergryph.com/',
          'Origin': 'https://endfield.hypergryph.com',
        },
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        await response.body?.cancel?.('redirect').catch(() => null);
        if (redirectCount >= MAX_REDIRECTS) throw new Error('too_many_redirects');
        const location = response.headers.get('location');
        const redirectedUrl = normalizeTargetUrl(location ? new URL(location, currentUrl).toString() : '');
        if (!redirectedUrl) throw new Error('unsafe_redirect');
        currentUrl = redirectedUrl;
        continue;
      }

      if (!response.ok) {
        const error = new Error('upstream_error');
        error.status = response.status;
        throw error;
      }

      const contentType = String(response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
      if (!ALLOWED_IMAGE_TYPES.has(contentType)) throw new Error('unsupported_image_type');

      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) throw new Error('image_too_large');

      const chunks = [];
      let totalBytes = 0;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || []);
          totalBytes += chunk.byteLength;
          if (totalBytes > MAX_IMAGE_BYTES) {
            controller.abort();
            await reader.cancel('image_too_large').catch(() => null);
            throw new Error('image_too_large');
          }
          chunks.push(chunk);
        }
      } else {
        const fallbackBuffer = await response.arrayBuffer();
        totalBytes = fallbackBuffer.byteLength;
        if (totalBytes > MAX_IMAGE_BYTES) throw new Error('image_too_large');
        chunks.push(new Uint8Array(fallbackBuffer));
      }

      const merged = new Uint8Array(totalBytes);
      let offset = 0;
      chunks.forEach((chunk) => {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      });
      if (!hasValidImageSignature(merged.buffer, contentType)) throw new Error('invalid_image_signature');
      return { arrayBuffer: merged.buffer, contentType };
    }

    throw new Error('too_many_redirects');
  } finally {
    clearTimeout(timeoutId);
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800');

  if (rejectDisallowedBrowserOrigin(req, res, { methods: 'GET, OPTIONS' })) {
    return;
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  }

  const rateLimit = checkMemoryRateLimit(getRequesterKey(req), {
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX,
  });

  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX);
  res.setHeader('X-RateLimit-Remaining', rateLimit.remaining);

  if (!rateLimit.allowed) {
    res.setHeader('Retry-After', rateLimit.retryAfter);
    return res.status(429).json({
      success: false,
      error: '请求过于频繁，请稍后再试',
    });
  }

  const targetUrl = normalizeTargetUrl(req.query?.url);
  if (!targetUrl) {
    return res.status(400).json({
      success: false,
      error: '参数错误: 需要合法的公告图片 URL',
    });
  }

  try {
    const { arrayBuffer, contentType } = await fetchValidatedImage(targetUrl);

    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    return res.status(200).end(Buffer.from(arrayBuffer));
  } catch (error) {
    const status = error?.status && error.status >= 400 && error.status < 500
      ? error.status
      : ['unsafe_redirect', 'too_many_redirects', 'unsupported_image_type', 'image_too_large', 'invalid_image_signature'].includes(error?.message)
        ? 400
        : 502;
    return res.status(status).json({
      success: false,
      error: '代理公告图片失败',
    });
  }
}

export const __internal = {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_REDIRECTS,
  fetchValidatedImage,
  hasValidImageSignature,
  normalizeTargetUrl,
};
