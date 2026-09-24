import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as stored from '../src/utils/storedPoolObservations.js';
import { buildGroupPoolObservations } from '../src/utils/groupPoolObservations.js';

// Deterministic, synthetic records only. Run each mode in a fresh Node process.
const size = Number(process.argv[2] || 240000);
const mode = process.argv[3] || 'group';
if (!['group', 'prepared', 'repeated', 'legacy-single', 'legacy-repeated', 'legacy-prepared'].includes(mode)) throw new Error('Unknown benchmark mode');
const legacy = mode.startsWith('legacy-') ? await import(process.argv[4]
  ? pathToFileURL(resolve(process.argv[4])).href : '../src/utils/scopedLegacyStatistics.js') : null;
const directory = Array.from({ length: 40 }, (_, id) => ({ id: `item-${id}`, name: `Item ${id}`,
  rarity: id < 8 ? 6 : id < 20 ? 5 : 4, type: 'character', is_limited: id < 4, aliases: [`Alias ${id}`] }));
const pools = Array.from({ length: 12 }, (_, id) => ({ id: `pool-${id}`, type: 'limited', up_character: `Item ${id % 4}` }));
const history = Array.from({ length: size }, (_, id) => {
  const item = directory[id % 67 === 0 ? id % 8 : id % 7 === 0 ? 8 + id % 12 : 20 + id % 20];
  return { id: id + 1, record_id: String(id + 1), user_id: `owner-${id % 40}`, game_uid: `uid-${id % 100}`, server_scope: id % 3 ? 'cn' : 'global',
    pool_id: `pool-${Math.floor(id / 600) % 12}`, timestamp: 1700000000000 + id * 1000, seq_id: id,
    character_id: id % 101 === 0 ? '' : id % 139 === 0 ? 'missing' : item.id, character_name: item.name, rarity: item.rarity,
    special_type: id % 401 === 0 ? 'gift' : null, is_free: id % 31 === 0, is_info_book: id % 53 === 0 };
});
// Mix the input order without randomness.
history.reverse();
global.gc?.();
const started = performance.now();
const hash = createHash('sha256');
if (legacy) {
  const args = { history, pools, characters: directory };
  const prepared = mode === 'legacy-prepared' ? legacy.prepareScopedLegacyStatistics(args) : null;
  const scopeAccounts = mode === 'legacy-single' ? [null]
    : [null, ...stored.getStoredObservationAccounts(history).slice(0, 5).map((account) => account.key)];
  const memberSets = mode === 'legacy-single' ? [pools.map((pool) => pool.id)] : pools.map((pool) => [pool.id]);
  for (const accountKey of scopeAccounts) for (const memberPoolIds of memberSets) {
    hash.update(JSON.stringify(prepared ? prepared.build({ memberPoolIds, accountKey })
      : legacy.buildScopedLegacyStatistics({ ...args, memberPoolIds, accountKey })));
  }
} else if (mode === 'group') {
  hash.update(JSON.stringify(buildGroupPoolObservations({ history, pools, directory, groupKey: 'limited' })));
} else {
  const prepared = mode === 'prepared' && stored.prepareStoredPoolObservations
    ? stored.prepareStoredPoolObservations({ history, directory, entityType: 'character' }) : null;
  for (const accountKey of [null, ...stored.getStoredObservationAccounts(history).slice(0, 5).map((account) => account.key)]) {
    for (const pool of pools) hash.update(JSON.stringify(prepared ? prepared(pool.id, accountKey)
      : stored.buildStoredPoolObservations({ history, poolId: pool.id, accountKey, directory, entityType: 'character' })));
  }
}
console.log(JSON.stringify({ size, mode, elapsedMs: Math.round(performance.now() - started),
  peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024), heapMiB: Math.round(process.memoryUsage().heapUsed / 1048576), digest: hash.digest('hex') }));
