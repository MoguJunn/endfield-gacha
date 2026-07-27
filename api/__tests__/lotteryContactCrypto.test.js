// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  decryptLotteryContact,
  encryptLotteryContact,
  isLotteryContactEnvelope,
} from '../_lib/lotteryContactCrypto.js';

const CURRENT_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64url');
const OLD_KEY = Buffer.from('abcdef0123456789abcdef0123456789').toString('base64url');
const CONTEXT = { campaignId: 'community-lottery', contactType: 'qq' };

function environment(activeKeyId = 'current', includeOldKey = true) {
  return {
    LOTTERY_CONTACT_ENCRYPTION_ACTIVE_KEY_ID: activeKeyId,
    LOTTERY_CONTACT_ENCRYPTION_KEYS_JSON: JSON.stringify({
      current: CURRENT_KEY,
      ...(includeOldKey ? { old: OLD_KEY } : {}),
    }),
  };
}

describe('lottery contact encryption', () => {
  it('encrypts with a fresh IV and decrypts with the matching context', () => {
    const first = encryptLotteryContact('123456789', { ...CONTEXT, env: environment() });
    const second = encryptLotteryContact('123456789', { ...CONTEXT, env: environment() });

    expect(first).not.toBe(second);
    expect(first).not.toContain('123456789');
    expect(isLotteryContactEnvelope(first)).toBe(true);
    expect(decryptLotteryContact(first, { ...CONTEXT, env: environment() })).toBe('123456789');
  });

  it('authenticates the campaign and contact type as additional data', () => {
    const encrypted = encryptLotteryContact('winner@example.test', {
      campaignId: 'community-lottery',
      contactType: 'email',
      env: environment(),
    });

    expect(() => decryptLotteryContact(encrypted, {
      campaignId: 'other-campaign',
      contactType: 'email',
      env: environment(),
    })).toThrowError('lottery_contact_decryption_failed');
    expect(() => decryptLotteryContact(encrypted, {
      campaignId: 'community-lottery',
      contactType: 'text',
      env: environment(),
    })).toThrowError('lottery_contact_decryption_failed');
  });

  it('supports old keys during rotation and fails after retirement', () => {
    const oldEnvelope = encryptLotteryContact('123456789', {
      ...CONTEXT,
      env: environment('old'),
    });

    expect(decryptLotteryContact(oldEnvelope, { ...CONTEXT, env: environment('current') })).toBe('123456789');
    expect(() => decryptLotteryContact(oldEnvelope, {
      ...CONTEXT,
      env: environment('current', false),
    })).toThrowError('lottery_contact_encryption_key_unavailable');
  });

  it('rejects tampered envelopes and invalid key configuration', () => {
    const encrypted = encryptLotteryContact('123456789', { ...CONTEXT, env: environment() });
    const tamperedParts = encrypted.split('.');
    tamperedParts[4] = `${tamperedParts[4][0] === 'A' ? 'B' : 'A'}${tamperedParts[4].slice(1)}`;
    const tampered = tamperedParts.join('.');

    expect(() => decryptLotteryContact(tampered, { ...CONTEXT, env: environment() }))
      .toThrowError('lottery_contact_decryption_failed');
    expect(() => encryptLotteryContact('123456789', {
      ...CONTEXT,
      env: {
        LOTTERY_CONTACT_ENCRYPTION_ACTIVE_KEY_ID: 'current',
        LOTTERY_CONTACT_ENCRYPTION_KEYS_JSON: '{"current":"short"}',
      },
    })).toThrowError('lottery_contact_encryption_not_configured');
  });
});
