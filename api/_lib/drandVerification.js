import { fetchBeacon } from 'drand-client';

export const QUICKNET_CHAIN_INFO = Object.freeze({
  public_key: '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a',
  period: 3,
  genesis_time: 1692803367,
  hash: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
  groupHash: 'f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e',
  schemeID: 'bls-unchained-g1-rfc9380',
  metadata: Object.freeze({ beaconID: 'quicknet' }),
});

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const QUICKNET_SIGNATURE_PATTERN = /^[0-9a-f]{96}$/u;

function hexToBytes(value) {
  return Uint8Array.from(value.match(/.{2}/gu).map((item) => Number.parseInt(item, 16)));
}

function bytesToHex(value) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function signatureMatchesRandomness(signature, randomness) {
  if (!globalThis.crypto?.subtle) return false;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', hexToBytes(signature));
  return bytesToHex(new Uint8Array(digest)) === randomness;
}

export async function verifyQuicknetBeacon({ chainHash, round, randomness, signature }) {
  const normalizedChainHash = String(chainHash || '').trim().toLowerCase();
  const normalizedRandomness = String(randomness || '').trim().toLowerCase();
  const normalizedSignature = String(signature || '').trim().toLowerCase();
  const normalizedRound = Number(round);
  if (
    normalizedChainHash !== QUICKNET_CHAIN_INFO.hash
    || !Number.isSafeInteger(normalizedRound)
    || normalizedRound <= 0
    || !HASH_PATTERN.test(normalizedRandomness)
    || !QUICKNET_SIGNATURE_PATTERN.test(normalizedSignature)
  ) return false;

  if (!await signatureMatchesRandomness(normalizedSignature, normalizedRandomness)) return false;

  const beacon = {
    round: normalizedRound,
    randomness: normalizedRandomness,
    signature: normalizedSignature,
  };
  const client = {
    options: {
      disableBeaconVerification: false,
      noCache: true,
      chainVerificationParams: {
        chainHash: QUICKNET_CHAIN_INFO.hash,
        publicKey: QUICKNET_CHAIN_INFO.public_key,
      },
    },
    chain() {
      return { info: async () => QUICKNET_CHAIN_INFO };
    },
    async get(requestedRound) {
      if (requestedRound !== normalizedRound) throw new Error('drand_round_mismatch');
      return beacon;
    },
  };

  try {
    await fetchBeacon(client, normalizedRound);
    return true;
  } catch {
    return false;
  }
}
