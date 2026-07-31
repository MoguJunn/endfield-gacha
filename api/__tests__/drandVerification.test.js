// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { QUICKNET_CHAIN_INFO, verifyQuicknetBeacon } from '../_lib/drandVerification.js';

const BEACON = {
  chainHash: QUICKNET_CHAIN_INFO.hash,
  round: 1000,
  randomness: 'fe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd',
  signature: 'b44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39',
};

describe('drand Quicknet verification', () => {
  it('verifies an official Quicknet beacon against the pinned G2 public key', async () => {
    await expect(verifyQuicknetBeacon(BEACON)).resolves.toBe(true);
  });

  it('rejects beacon material not signed for the pinned round and chain', async () => {
    await expect(verifyQuicknetBeacon({ ...BEACON, round: 1001 })).resolves.toBe(false);
    await expect(verifyQuicknetBeacon({
      ...BEACON,
      chainHash: 'a'.repeat(64),
    })).resolves.toBe(false);
  });
});
