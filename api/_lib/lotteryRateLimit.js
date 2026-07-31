import { createHmac } from 'node:crypto';

const ACTION_PATTERN = /^[a-z][a-z0-9_]{2,63}$/u;
const STRONG_SECRET_MIN_LENGTH = 43;

function rateLimitError(code) {
  return Object.assign(new Error(code), { code });
}

export function hashLotteryRateLimitIdentifier(identifiers, secret) {
  const normalizedSecret = String(secret || '').trim();
  const normalizedIdentifiers = Array.isArray(identifiers)
    ? identifiers
      .map((value) => String(value || '').trim().slice(0, 512))
      .filter(Boolean)
    : [];
  if (
    normalizedSecret.length < STRONG_SECRET_MIN_LENGTH
    || normalizedSecret.includes('replace-')
    || normalizedIdentifiers.length === 0
  ) {
    throw rateLimitError('lottery_rate_limit_not_configured');
  }
  return createHmac('sha256', normalizedSecret)
    .update('summer-lottery-rate-limit-v1\0', 'utf8')
    .update(normalizedIdentifiers.join('\0'), 'utf8')
    .digest('hex');
}

export async function consumeLotteryRateLimit(adminClient, {
  action,
  identifiers,
  secret = process.env.LOTTERY_BACKEND_SECRET,
}) {
  const normalizedAction = String(action || '').trim().toLowerCase();
  if (!ACTION_PATTERN.test(normalizedAction) || typeof adminClient?.rpc !== 'function') {
    throw rateLimitError('lottery_rate_limit_not_configured');
  }
  const identifierHash = hashLotteryRateLimitIdentifier(identifiers, secret);
  const { data, error } = await adminClient.rpc('consume_summer_lottery_rate_limit', {
    p_identifier_hash: identifierHash,
    p_action: normalizedAction,
  });
  if (error) throw rateLimitError('lottery_rate_limit_unavailable');

  const allowed = data?.allowed;
  const remaining = Number(data?.remaining);
  const retryAfter = Number(data?.retryAfter);
  if (
    typeof allowed !== 'boolean'
    || !Number.isSafeInteger(remaining)
    || remaining < 0
    || !Number.isSafeInteger(retryAfter)
    || retryAfter < 0
  ) {
    throw rateLimitError('lottery_rate_limit_unavailable');
  }
  return { allowed, remaining, retryAfter };
}
