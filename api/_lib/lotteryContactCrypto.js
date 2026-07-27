import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ENVELOPE_PREFIX = 'olc1';
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/u;
const BASE64URL_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const ENVELOPE_PATTERN = /^olc1\.([A-Za-z0-9_-]{1,32})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{3,1800})\.([A-Za-z0-9_-]{22})$/u;

function contactCryptoError(code) {
  return Object.assign(new Error(code), { code });
}

function normalizeContext(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function decodeEncryptionKey(rawKey) {
  const normalized = String(rawKey || '').trim();
  if (!BASE64URL_KEY_PATTERN.test(normalized)) return null;
  const key = Buffer.from(normalized, 'base64url');
  return key.length === 32 && key.toString('base64url') === normalized ? key : null;
}

function decodeEnvelopePart(value, expectedLength = null) {
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value || (expectedLength !== null && decoded.length !== expectedLength)) {
    throw contactCryptoError('lottery_contact_envelope_invalid');
  }
  return decoded;
}

function parseEnvelope(envelope) {
  const matched = ENVELOPE_PATTERN.exec(String(envelope || '').trim());
  if (!matched) throw contactCryptoError('lottery_contact_envelope_invalid');
  const [, keyId, ivPart, ciphertextPart, tagPart] = matched;
  return {
    keyId,
    iv: decodeEnvelopePart(ivPart, 12),
    ciphertext: decodeEnvelopePart(ciphertextPart),
    tag: decodeEnvelopePart(tagPart, 16),
  };
}

function getContactKeyring(env) {
  const activeKeyId = normalizeContext(env.LOTTERY_CONTACT_ENCRYPTION_ACTIVE_KEY_ID, 32);
  let configuredKeys;
  try {
    configuredKeys = JSON.parse(String(env.LOTTERY_CONTACT_ENCRYPTION_KEYS_JSON || ''));
  } catch {
    throw contactCryptoError('lottery_contact_encryption_not_configured');
  }
  if (!KEY_ID_PATTERN.test(activeKeyId) || !configuredKeys || Array.isArray(configuredKeys) || typeof configuredKeys !== 'object') {
    throw contactCryptoError('lottery_contact_encryption_not_configured');
  }
  const keys = new Map();
  for (const [keyId, rawKey] of Object.entries(configuredKeys)) {
    const key = decodeEncryptionKey(rawKey);
    if (!KEY_ID_PATTERN.test(keyId) || !key) {
      throw contactCryptoError('lottery_contact_encryption_not_configured');
    }
    keys.set(keyId, key);
  }
  if (!keys.has(activeKeyId)) {
    throw contactCryptoError('lottery_contact_encryption_not_configured');
  }
  return { activeKeyId, keys };
}

function buildAdditionalData(campaignId, contactType) {
  const normalizedCampaignId = normalizeContext(campaignId, 100);
  const normalizedContactType = normalizeContext(contactType, 32).toLowerCase();
  if (!normalizedCampaignId || !KEY_ID_PATTERN.test(normalizedContactType)) {
    throw contactCryptoError('lottery_contact_encryption_context_invalid');
  }
  return Buffer.from(JSON.stringify({
    purpose: 'open-lottery-contact',
    version: 1,
    campaignId: normalizedCampaignId,
    contactType: normalizedContactType,
  }), 'utf8');
}

export function encryptLotteryContact(value, {
  campaignId,
  contactType,
  env = process.env,
} = {}) {
  const plaintext = String(value || '');
  if (!plaintext) throw contactCryptoError('invalid_contact_value');
  const { activeKeyId, keys } = getContactKeyring(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keys.get(activeKeyId), iv);
  cipher.setAAD(buildAdditionalData(campaignId, contactType));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENVELOPE_PREFIX,
    activeKeyId,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join('.');
}

export function decryptLotteryContact(envelope, {
  campaignId,
  contactType,
  env = process.env,
} = {}) {
  const { keyId, iv, ciphertext, tag } = parseEnvelope(envelope);
  const { keys } = getContactKeyring(env);
  const key = keys.get(keyId);
  if (!key) throw contactCryptoError('lottery_contact_encryption_key_unavailable');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(buildAdditionalData(campaignId, contactType));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw contactCryptoError('lottery_contact_decryption_failed');
  }
}

export function isLotteryContactEnvelope(value) {
  try {
    parseEnvelope(value);
    return true;
  } catch {
    return false;
  }
}
