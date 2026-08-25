import assert from 'node:assert/strict';
import {
  buildInheritedSimulatorSnapshot,
  buildInheritedSimulatorState
} from '../src/features/simulator/simulatorInheritance.js';
import { simulateSinglePull } from '../src/utils/probabilityEngine.js';
import { LIMITED_POOL_RULES, WEAPON_POOL_RULES } from '../src/constants/index.js';
import {
  buildSimulatorResourceLedger,
  DEFAULT_SIMULATOR_RESOURCE_SETTINGS,
  getSimulatorPullCost,
  normalizeResourceSettings
} from '../src/utils/resourceEconomy.js';
import { buildCurrentTargetProbabilityInfo } from '../src/features/simulator/simulatorProbability.js';
import {
  buildSimulatorStorageScope,
  clearInfoBookState,
  clearSharedPityState,
  clearSimulatorResourceSettings,
  clearSimulatorState,
  getSimulatorCurrentPoolStorageKey,
  loadInfoBookState,
  loadSharedPityState,
  loadSimulatorResourceSettings,
  loadSimulatorState,
  migrateLegacySimulatorStorageToScope,
  saveInfoBookState,
  saveSharedPityState,
  saveSimulatorResourceSettings,
  saveSimulatorState
} from '../src/utils/simulatorStorage.js';
import useHistoryStore from '../src/stores/useHistoryStore.js';

const localStorageMap = new Map();
global.localStorage = {
  getItem(key) {
    return localStorageMap.has(key) ? localStorageMap.get(key) : null;
  },
  setItem(key, value) {
    localStorageMap.set(key, String(value));
  },
  removeItem(key) {
    localStorageMap.delete(key);
  },
  clear() {
    localStorageMap.clear();
  }
};

function makePull(poolId, index, overrides = {}) {
  return {
    id: `${poolId}_${index}`,
    poolId,
    rarity: 4,
    timestamp: 1700000000000 + index,
    game_uid: 'uid-1',
    user_id: 'user-1',
    ...overrides
  };
}

const pools = [
  { id: 'limited_a', type: 'limited', up_character: 'A' },
  { id: 'limited_b', type: 'limited', up_character: 'B' },
  { id: 'weapon_a', type: 'weapon', up_character: 'WA', isLimitedWeapon: true },
  { id: 'weapon_b', type: 'weapon', up_character: 'WB', isLimitedWeapon: true },
  { id: 'recon_char_a', type: 'extra', up_character: 'RC-A', extra_rule_profile: 'reconstruction_character_v1', extra_series_key: 'recon-char-s1' },
  { id: 'recon_char_b', type: 'extra', up_character: 'RC-B', extra_rule_profile: 'reconstruction_character_v1', extra_series_key: 'recon-char-s1' },
  { id: 'recon_weapon_a', type: 'extra', up_character: 'RW-A', extra_rule_profile: 'reconstruction_weapon_v1', extra_series_key: 'recon-weapon-s1' },
  { id: 'recon_weapon_b', type: 'extra', up_character: 'RW-B', extra_rule_profile: 'reconstruction_weapon_v1', extra_series_key: 'recon-weapon-s1' },
  { id: 'brilliance', type: 'extra', extra_rule_profile: 'brilliance_festival_v1' },
  { id: 'joint_unknown', type: 'extra', extra_rule_profile: 'future_profile_v2' },
  { id: 'standard', type: 'standard' }
];

const limitedHistory = [
  ...Array.from({ length: 60 }, (_, index) => makePull('limited_a', index + 1)),
  ...Array.from({ length: 35 }, (_, index) => makePull('limited_b', 100 + index + 1)),
  makePull('limited_b', 200, { is_free: true, rarity: 6, isLimited: true, character_name: 'B' }),
  makePull('limited_b', 201, { special_type: 'gift', rarity: 6, character_name: 'B' })
];

const inheritedLimited = buildInheritedSimulatorState({
  history: limitedHistory,
  realPools: pools,
  currentSimPool: { id: 'sim_limited_b', type: 'limited', up_character: 'B' },
  currentGameUid: 'uid-1',
  currentUserId: 'user-1'
});

assert.ok(inheritedLimited, 'limited pool should be inheritable');
assert.equal(inheritedLimited.totalPulls, 35, 'limited pool total pulls should only include current pool paid pulls');
assert.equal(inheritedLimited.freeTenPullsReceived, 1, 'limited pool should mark already earned free ten-pull for current pool');
assert.equal(inheritedLimited.hasReceivedInfoBook, false, 'current limited pool should not fake info-book ownership from previous pool');
assert.equal(inheritedLimited.sixStarPity, 95, 'limited pool should inherit cross-pool six-star pity');
assert.equal(inheritedLimited.guaranteedLimitedPity, 35, 'limited pool current-banner hard target progress should stay on current pool only');
assert.equal(inheritedLimited.hasReceivedGuaranteedLimited, false, 'limited pool should preserve whether the current-banner hard target has been satisfied');
assert.equal(inheritedLimited.pullHistory.length, 35, 'limited pool history should exclude free pulls and gifts');
assert.equal(inheritedLimited.infoBookTenPullAvailable, true, 'current target limited pool should activate inherited info book');

const weaponHistory = [
  ...Array.from({ length: 20 }, (_, index) => makePull('weapon_b', 300 + index + 1)),
  ...Array.from({ length: 12 }, (_, index) => makePull('weapon_a', 400 + index + 1)),
  makePull('weapon_a', 500, { is_free: true, rarity: 5 })
];

const inheritedWeapon = buildInheritedSimulatorState({
  history: weaponHistory,
  realPools: pools,
  currentSimPool: { id: 'sim_weapon_a', type: 'weapon', up_character: 'WA', isLimitedWeapon: true },
  currentGameUid: 'uid-1',
  currentUserId: 'user-1'
});

assert.ok(inheritedWeapon, 'weapon pool should be inheritable');
assert.equal(inheritedWeapon.totalPulls, 12, 'weapon pool total pulls should only include current pool paid pulls');
assert.equal(inheritedWeapon.sixStarPity, 12, 'weapon pool should not inherit cross-pool six-star pity');
assert.equal(inheritedWeapon.guaranteedLimitedPity, 12, 'weapon pool hard pity counter should stay on current pool');
assert.equal(inheritedWeapon.hasReceivedGuaranteedLimited, false, 'weapon pool should preserve whether hard pity has been consumed');
assert.equal(inheritedWeapon.pullHistory.length, 12, 'weapon pool history should exclude free pulls');

const reconstructionHistory = [
  ...Array.from({ length: 220 }, (_, index) => makePull('recon_char_a', 1000 + index + 1, index === 199
    ? { rarity: 6, isLimited: true, character_name: 'RC-A' }
    : {})),
  ...Array.from({ length: 20 }, (_, index) => makePull('recon_char_b', 1300 + index + 1)),
  ...Array.from({ length: 160 }, (_, index) => makePull('recon_weapon_a', 1400 + index + 1)),
  ...Array.from({ length: 20 }, (_, index) => makePull('recon_weapon_b', 1600 + index + 1)),
  makePull('brilliance', 1701, { rarity: 6, character_name: 'Festival Target' }),
  makePull('joint_unknown', 1702, { rarity: 6, character_name: 'Unknown Target', isLimited: true })
];

const reconstructionSnapshot = buildInheritedSimulatorSnapshot({
  history: reconstructionHistory,
  realPools: pools,
  currentGameUid: 'uid-1',
  currentUserId: 'user-1',
  currentSimPoolId: 'sim_recon_char_b'
});

assert.equal(reconstructionSnapshot.statesByPoolId.sim_recon_char_b.poolType, 'limited', 'reconstruction character should inherit limited base rules');
assert.equal(reconstructionSnapshot.statesByPoolId.sim_recon_char_b.sixStarPity, 40, 'reconstruction character pity should derive from matching series history');
assert.equal(reconstructionSnapshot.statesByPoolId.sim_recon_char_b.guaranteedLimitedPity, 120, 'reconstruction character target guarantee should derive from matching series history');
assert.equal(reconstructionSnapshot.statesByPoolId.sim_recon_char_b.hasReceivedGuaranteedLimited, true, 'reconstruction character target guarantee should not be issued twice after a prior-stage target');
assert.equal(reconstructionSnapshot.statesByPoolId.sim_recon_char_b.seriesRewardPulls, 240, 'reconstruction character reward progress should derive from matching series history');
assert.equal(reconstructionSnapshot.statesByPoolId.sim_recon_char_b.giftsReceived, 1, 'reconstruction character rewards should derive from matching series history');
assert.equal(reconstructionSnapshot.statesByPoolId.sim_recon_char_a.freeTenPullsReceived, 3, 'reconstruction character should recognize 30/60/90 free ten milestones');
assert.equal(reconstructionSnapshot.statesByPoolId.sim_recon_char_b.hasReceivedInfoBook, false, 'reconstruction character should not invent a limited info book');
assert.equal(reconstructionSnapshot.statesByPoolId.sim_recon_weapon_b.poolType, 'weapon', 'reconstruction weapon should inherit weapon base rules');
assert.equal(reconstructionSnapshot.statesByPoolId.sim_recon_weapon_b.sixStarPity, 20, 'reconstruction weapon six-star pity should remain pool-local');
assert.equal(reconstructionSnapshot.statesByPoolId.sim_recon_weapon_b.guaranteedLimitedPity, 80, 'reconstruction weapon target guarantee should share eight claims across the series');
assert.equal(reconstructionSnapshot.statesByPoolId.sim_recon_weapon_b.seriesRewardPulls, 180, 'reconstruction weapon reward progress should derive from matching series history');
assert.equal(reconstructionSnapshot.statesByPoolId.sim_recon_weapon_b.giftsReceived, 2, 'reconstruction weapon rewards should derive from matching series history');
assert.equal(reconstructionSnapshot.seriesStates['reconstruction_character_v1::recon-char-s1'].sixStarPity, 40, 'snapshot should expose profile-and-series keyed character state');
assert.equal(reconstructionSnapshot.seriesStates['reconstruction_weapon_v1::recon-weapon-s1'].guaranteedLimitedPity, 80, 'snapshot should expose profile-and-series keyed weapon target state');
assert.equal(reconstructionSnapshot.statesByPoolId.sim_brilliance.pullHistory[0].isUp, true, 'brilliance six stars should remain festival targets');
assert.equal(reconstructionSnapshot.statesByPoolId.sim_joint_unknown.pullHistory[0].isUp, false, 'unknown extra profiles should not masquerade as brilliance targets');

const conflictingFlagHistory = [
  ...Array.from({ length: 120 }, (_, index) => makePull('recon_char_a', 1800 + index, index === 119
    ? { rarity: 6, character_name: 'RC-A', isStandard: true, isUp: false, isLimited: false }
    : {})),
  makePull('recon_char_b', 2000, {
    rarity: 6,
    character_name: '角色歪出',
    isStandard: false,
    isUp: true,
    isLimited: true,
  }),
  ...Array.from({ length: 80 }, (_, index) => makePull('recon_weapon_a', 2100 + index, index === 79
    ? { rarity: 6, item_name: 'RW-A', isStandard: true, isUp: false, isLimited: false }
    : {})),
  makePull('recon_weapon_b', 2300, {
    rarity: 6,
    item_name: '武器歪出',
    isStandard: false,
    isUp: true,
    isLimited: true,
  }),
];
const conflictingFlagSnapshot = buildInheritedSimulatorSnapshot({
  history: conflictingFlagHistory,
  realPools: pools,
  currentGameUid: 'uid-1',
  currentUserId: 'user-1',
});

assert.equal(conflictingFlagSnapshot.statesByPoolId.sim_recon_char_a.guaranteedLimitedPity, 120, '重构角色系列应在第120抽继承目标保障状态');
assert.equal(conflictingFlagSnapshot.statesByPoolId.sim_recon_char_a.hasReceivedGuaranteedLimited, true, '重构角色目标名应覆盖陈旧常驻标记');
assert.equal(conflictingFlagSnapshot.statesByPoolId.sim_recon_char_a.pullHistory.at(-1).isUp, true, '重构角色目标名明确时应按名称认定正向目标');
assert.equal(conflictingFlagSnapshot.statesByPoolId.sim_recon_char_b.pullHistory[0].isUp, false, '重构角色名称不匹配时应覆盖陈旧目标标记');
assert.equal(
  conflictingFlagSnapshot.statesByPoolId.sim_recon_weapon_a.guaranteedLimitedPity / WEAPON_POOL_RULES.claimSize,
  8,
  '重构武器系列应继承第8次申领的目标保障状态'
);
assert.equal(conflictingFlagSnapshot.statesByPoolId.sim_recon_weapon_a.hasReceivedGuaranteedLimited, true, '重构武器目标名应覆盖陈旧常驻标记');
assert.equal(conflictingFlagSnapshot.statesByPoolId.sim_recon_weapon_a.pullHistory.at(-1).isUp, true, '重构武器目标名明确时应按名称认定正向目标');
assert.equal(conflictingFlagSnapshot.statesByPoolId.sim_recon_weapon_b.pullHistory[0].isUp, false, '重构武器名称不匹配时应覆盖陈旧目标标记');

const inheritedWeaponTargetProbability = buildCurrentTargetProbabilityInfo({
  guaranteedLimitedPity: inheritedWeapon.guaranteedLimitedPity,
  hasReceivedGuaranteedLimited: inheritedWeapon.hasReceivedGuaranteedLimited,
  currentPity: inheritedWeapon.sixStarPity,
  poolType: 'weapon'
});
assert.ok(inheritedWeaponTargetProbability, 'weapon simulator should expose a dynamic current target probability');
assert.equal(inheritedWeaponTargetProbability.targetRate, 0.25, 'weapon current target probability should use weapon target rate');
assert.equal(inheritedWeaponTargetProbability.isHardGuaranteeNextPull, false, 'weapon current target probability should remain dynamic before hard pity');
assert.ok(
  inheritedWeaponTargetProbability.probability > 0
    && inheritedWeaponTargetProbability.probability < inheritedWeaponTargetProbability.sixStarProbability,
  'weapon current target probability should be lower than the raw 6★ probability when no hard pity is ready'
);

const inheritedSnapshot = buildInheritedSimulatorSnapshot({
  history: [...limitedHistory, ...weaponHistory],
  realPools: pools,
  currentGameUid: 'uid-1',
  currentUserId: 'user-1',
  currentSimPoolId: 'sim_limited_b'
});

assert.equal(inheritedSnapshot.hasAnyData, true, 'snapshot should mark inheritable data');
assert.ok(inheritedSnapshot.statesByPoolId.sim_limited_a, 'snapshot should include source limited pool');
assert.ok(inheritedSnapshot.statesByPoolId.sim_limited_b, 'snapshot should include current limited pool');
assert.ok(inheritedSnapshot.statesByPoolId.sim_weapon_a, 'snapshot should include current weapon pool');
assert.deepEqual(inheritedSnapshot.sharedPityState, {
  sixStarPity: 95,
  fiveStarPity: 95
}, 'snapshot should expose shared limited pity state');
assert.deepEqual(inheritedSnapshot.infoBooks.sim_limited_a, {
  activated: true,
  used: false,
  targetPoolId: 'sim_limited_b',
  obtainedAt: 0
}, 'snapshot should rebuild the inherited info book mapping');

const resourceLedger = buildSimulatorResourceLedger(
  Object.values(inheritedSnapshot.statesByPoolId),
  {
    baseJade: 100000,
    baseOriginite: 100,
    baseArsenalQuota: 200000,
    characterPullJadeCost: 500,
    weaponPullQuotaCost: 1980,
    originiteToJadeRate: 75,
    arsenalReward4: 20,
    arsenalReward5: 200,
    arsenalReward6: 2000
  }
);

assert.equal(resourceLedger.jadeSpent, (60 + 35) * 500, 'resource ledger should charge paid character pulls in jade');
assert.equal(resourceLedger.arsenalSpent, (20 + 12) * 198, 'resource ledger should charge paid weapon pulls in single-pull quota equivalents');
assert.equal(resourceLedger.arsenalGained, 95 * 20, 'resource ledger should only reward arsenal quota from recorded character pulls');

assert.deepEqual(getSimulatorPullCost({
  poolType: 'weapon',
  pullType: 'single'
}), {
  resource: 'arsenalQuota',
  amount: 198
}, 'weapon single pull should cost one tenth of a ten-pull quota pack');

assert.deepEqual(getSimulatorPullCost({
  poolType: 'weapon',
  pullType: 'ten'
}), {
  resource: 'arsenalQuota',
  amount: 1980
}, 'weapon ten-pull should cost 1980 arsenal quota');

const signedResourceSettings = normalizeResourceSettings({
  baseJade: -75,
  baseArsenalQuota: -20
});
assert.equal(signedResourceSettings.baseJade, -75, 'jade base should preserve signed values for direct balance setting');
assert.equal(signedResourceSettings.baseArsenalQuota, -20, 'arsenal base should preserve signed values for direct balance setting');

const zeroedArsenalLedger = buildSimulatorResourceLedger([
  {
    poolType: 'limited',
    pullHistory: [
      {
        rarity: 4,
        isFreePull: false,
        isInfoBookPull: false
      }
    ]
  }
], {
  ...DEFAULT_SIMULATOR_RESOURCE_SETTINGS,
  baseArsenalQuota: -20
});
assert.equal(zeroedArsenalLedger.arsenalGained, 20, 'ledger should still count arsenal gains after a manual reset');
assert.equal(zeroedArsenalLedger.arsenalBalance, 0, 'signed arsenal base should allow setting displayed arsenal balance to zero after gains');

const infoBookLedger = buildSimulatorResourceLedger([
  {
    poolType: 'limited',
    pullHistory: Array.from({ length: 10 }, (_, index) => ({
      pullNumber: index + 1,
      rarity: index === 0 ? 6 : 4,
      isInfoBookPull: true,
      isTenPull: true,
      batchIndex: index
    }))
  }
], {
  ...DEFAULT_SIMULATOR_RESOURCE_SETTINGS,
  baseJade: 0,
  baseOriginite: 0,
  baseArsenalQuota: 0
});
assert.equal(infoBookLedger.jadeSpent, 0, 'info-book ten-pull should not consume jade in the simulator resource ledger');

const noHistory = buildInheritedSimulatorState({
  history: [],
  realPools: pools,
  currentSimPool: { id: 'sim_standard', type: 'standard' },
  currentGameUid: 'uid-1',
  currentUserId: 'user-1'
});

assert.equal(noHistory, null, 'empty history should not produce inherited state');

const guaranteedLimitedHistory = [
  ...Array.from({ length: 119 }, (_, index) => makePull('limited_b', 600 + index + 1)),
  makePull('limited_b', 800, { rarity: 6, isLimited: true, character_name: 'B' })
];

const guaranteedLimitedState = buildInheritedSimulatorState({
  history: guaranteedLimitedHistory,
  realPools: pools,
  currentSimPool: { id: 'sim_limited_b', type: 'limited', up_character: 'B' },
  currentGameUid: 'uid-1',
  currentUserId: 'user-1'
});

assert.equal(guaranteedLimitedState.guaranteedLimitedPity, 120, 'hard target progress should stop at 120 after the current-banner guarantee is fulfilled');
assert.equal(guaranteedLimitedState.hasReceivedGuaranteedLimited, true, 'hard target should be marked as fulfilled after the current-banner UP is obtained');

const restartedGuaranteedLimitedState = buildInheritedSimulatorState({
  history: [
    ...guaranteedLimitedHistory,
    makePull('limited_b', 801, { rarity: 4 })
  ],
  realPools: pools,
  currentSimPool: { id: 'sim_limited_b', type: 'limited', up_character: 'B' },
  currentGameUid: 'uid-1',
  currentUserId: 'user-1'
});

assert.equal(restartedGuaranteedLimitedState.guaranteedLimitedPity, 120, 'after the current-banner guarantee is fulfilled, later pulls should not restart a new hard-target cycle');
assert.equal(restartedGuaranteedLimitedState.hasReceivedGuaranteedLimited, true, 'the fulfilled current-banner hard target should stay consumed for the rest of that banner');

const hardGuaranteeTargetProbability = buildCurrentTargetProbabilityInfo({
  guaranteedLimitedPity: 119,
  hasReceivedGuaranteedLimited: false,
  currentPity: 10,
  poolType: 'limited'
});
assert.equal(hardGuaranteeTargetProbability.isHardGuaranteeNextPull, true, 'limited simulator should recognize when the next pull triggers the hard target guarantee');
assert.equal(hardGuaranteeTargetProbability.probability, 1, 'hard target guarantee should make the next-pull target probability 100%');

const offBannerHistory = [
  ...Array.from({ length: 20 }, (_, index) => makePull('limited_b', 900 + index + 1)),
  makePull('limited_b', 980, { rarity: 6, isLimited: false, character_name: '余烬' }),
  ...Array.from({ length: 6 }, (_, index) => makePull('limited_b', 990 + index + 1))
];

const inheritedOffBannerState = buildInheritedSimulatorState({
  history: offBannerHistory,
  realPools: pools,
  currentSimPool: { id: 'sim_limited_b', type: 'limited', up_character: 'B' },
  currentGameUid: 'uid-1',
  currentUserId: 'user-1'
});

assert.equal(inheritedOffBannerState.isGuaranteedUp, false, 'limited simulator should not invent a next-6★ UP guarantee after an off-banner 6★');
assert.equal(inheritedOffBannerState.guaranteedLimitedPity, 27, 'current-banner hard target progress should continue accumulating on the current pool after an off-banner 6★');
assert.equal(inheritedOffBannerState.hasReceivedGuaranteedLimited, false, 'an off-banner 6★ should not satisfy the current-banner hard target');

const offBannerProbability = buildCurrentTargetProbabilityInfo({
  guaranteedLimitedPity: inheritedOffBannerState.guaranteedLimitedPity,
  hasReceivedGuaranteedLimited: inheritedOffBannerState.hasReceivedGuaranteedLimited,
  currentPity: inheritedOffBannerState.sixStarPity,
  poolType: 'limited'
});

assert.equal(offBannerProbability.targetRate, 0.5, 'after an off-banner 6★, the next limited 6★ should still be a normal 50/50 target rate');

const originalRandom = Math.random;
let randomCallCount = 0;
Math.random = () => {
  randomCallCount += 1;
  return randomCallCount === 1 ? 0 : 0.9;
};

const forcedOffBannerPull = simulateSinglePull({
  ...inheritedOffBannerState,
  sixStarPity: LIMITED_POOL_RULES.sixStarPity - 1
}, LIMITED_POOL_RULES, 'limited', 'B', null);

Math.random = originalRandom;

assert.equal(forcedOffBannerPull.rarity, 6, 'forcing hard six-star pity should still produce a 6★ result');
assert.equal(forcedOffBannerPull.isUp, false, 'an off-banner 6★ should not make the next forced 6★ automatically become UP');
assert.equal(forcedOffBannerPull.isGuaranteedUp, false, 'limited simulator should not persist a fabricated next-6★ UP guarantee state');

const scopeA = buildSimulatorStorageScope({ currentUserId: 'user-1', currentGameUid: 'uid-1' });
const scopeB = buildSimulatorStorageScope({ currentUserId: 'user-1', currentGameUid: 'uid-2' });

saveSimulatorState('sim_limited_a', { totalPulls: 10 }, scopeA);
saveSimulatorState('sim_limited_a', { totalPulls: 25 }, scopeB);
assert.equal(loadSimulatorState('sim_limited_a', scopeA).totalPulls, 10, 'scoped simulator state should remain isolated for uid-1');
assert.equal(loadSimulatorState('sim_limited_a', scopeB).totalPulls, 25, 'scoped simulator state should remain isolated for uid-2');
clearSimulatorState('sim_limited_a', scopeA);
assert.equal(loadSimulatorState('sim_limited_a', scopeA), null, 'clearing scoped simulator state should not affect other scopes');
assert.equal(loadSimulatorState('sim_limited_a', scopeB).totalPulls, 25, 'clearing one scope must not remove other scoped state');

saveSharedPityState({ sixStarPity: 12, fiveStarPity: 3 }, scopeA);
saveSharedPityState({ sixStarPity: 55, fiveStarPity: 8 }, scopeB);
assert.deepEqual(loadSharedPityState(scopeA), { sixStarPity: 12, fiveStarPity: 3 }, 'shared pity should be isolated by scoped account');
assert.deepEqual(loadSharedPityState(scopeB), { sixStarPity: 55, fiveStarPity: 8 }, 'shared pity should be isolated by scoped account');
clearSharedPityState(scopeA);
assert.equal(loadSharedPityState(scopeA), null, 'clearing scoped shared pity should only affect that scope');

saveInfoBookState({ sim_limited_a: { activated: true, used: false, targetPoolId: 'sim_limited_b', obtainedAt: 1 } }, scopeA);
saveInfoBookState({ sim_limited_b: { activated: false, used: false, targetPoolId: 'sim_limited_c', obtainedAt: 2 } }, scopeB);
assert.ok(loadInfoBookState(scopeA).sim_limited_a, 'info-book state should be isolated by scope');
assert.ok(loadInfoBookState(scopeB).sim_limited_b, 'info-book state should be isolated by scope');
clearInfoBookState(scopeB);
assert.deepEqual(loadInfoBookState(scopeB), {}, 'clearing scoped info-book state should only affect that scope');

saveSimulatorResourceSettings({ baseJade: 12345, baseOriginite: 6, baseArsenalQuota: 7 }, scopeA);
saveSimulatorResourceSettings({ baseJade: 54321, baseOriginite: 8, baseArsenalQuota: 9 }, scopeB);
assert.equal(loadSimulatorResourceSettings(scopeA).baseJade, 12345, 'scoped resource settings should be isolated by account');
assert.equal(loadSimulatorResourceSettings(scopeB).baseJade, 54321, 'scoped resource settings should be isolated by account');
clearSimulatorResourceSettings(scopeA);
assert.equal(
  loadSimulatorResourceSettings(scopeA).baseJade,
  DEFAULT_SIMULATOR_RESOURCE_SETTINGS.baseJade,
  'clearing scoped resource settings should reset only the cleared scope to defaults'
);

localStorage.setItem('gacha_simulator_state_sim_limited_b', JSON.stringify({
  version: '1.0',
  timestamp: Date.now(),
  poolType: 'sim_limited_b',
  state: { totalPulls: 77 }
}));
localStorage.setItem('simulator_currentPoolId', 'sim_limited_b');
migrateLegacySimulatorStorageToScope({
  scope: scopeA,
  poolIds: ['sim_limited_b']
});
assert.equal(loadSimulatorState('sim_limited_b', scopeA).totalPulls, 77, 'legacy simulator state should migrate into the first scoped account');
assert.equal(localStorage.getItem(getSimulatorCurrentPoolStorageKey(scopeA)), 'sim_limited_b', 'legacy current simulator pool should migrate into scoped key');

useHistoryStore.getState().setHistory([
  { id: 'snake-1', poolId: 'limited_a', game_uid: 'uid-snake', nick_name: 'SnakeName', rarity: 4, timestamp: 1 },
  { id: 'camel-1', poolId: 'limited_a', gameUid: 'uid-camel', nickName: 'CamelName', rarity: 5, timestamp: 2 }
]);
const accounts = useHistoryStore.getState().getGameAccountsFromHistory();
assert.deepEqual(
  accounts.map(({ gameUid, nickName }) => ({ gameUid, nickName })),
  [
    { gameUid: 'uid-snake', nickName: 'SnakeName' },
    { gameUid: 'uid-camel', nickName: 'CamelName' }
  ],
  'account extraction should support both snake_case and camelCase history fields'
);
assert.equal(
  useHistoryStore.getState().getHistoryByGameAccount('uid-camel').length,
  1,
  'history filtering should support camelCase account fields'
);

console.log('SIM-001 inheritance, resource, and scoped storage verification passed');
