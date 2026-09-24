import { calculateSixStarProbability } from './probabilityEngine.js';
import { calculateWeaponSixStarPityTargetProbability } from './weaponPoolProbability.js';

/**
 * 固定一期卡池目标 6★ 的首达分布；返回范围内 PMF/CDF 与截断期望下界。
 * 不读取历史、不使用随机数。武器保底申领沿用现有模拟器的预留 6★ 槽模型，
 * 标为模型估计，规则原文未给出内部重采样过程，不能声称官方精确概率。
 */
export function targetProbabilityDistribution({
  rules, unit = 'pull', currentPity = 0, guaranteeProgress = 0,
  guaranteeUsed = false, horizon = 160,
}) {
  const weapon = unit === 'claim';
  const pityLimit = weapon ? rules?.sixStarClaimPity : rules?.sixStarPity;
  const guaranteeLimit = weapon ? rules?.guaranteedLimitedClaimPity : rules?.guaranteedLimitedPity;
  const targetSixRate = rules?.upProbability; // 仅预测本期 UP，不把保障套用到任意非 UP 对象。
  if (!['pull', 'claim'].includes(unit) || !Number.isInteger(horizon) || horizon < 1 || horizon > 1000
    || !Number.isInteger(pityLimit) || pityLimit < 1
    || !(rules?.sixStarBaseProbability >= 0 && rules?.sixStarBaseProbability <= 1)
    || (guaranteeLimit !== undefined && (!Number.isInteger(guaranteeLimit) || guaranteeLimit < 0))
    || (weapon && (!Number.isInteger(rules.claimSize) || rules.claimSize < 1))
    || (!weapon && rules.hasSoftPity !== false && (!Number.isInteger(rules.sixStarSoftPityStart)
      || rules.sixStarSoftPityStart < 1 || !(rules.sixStarSoftPityIncrease >= 0 && rules.sixStarSoftPityIncrease <= 1)))
    || typeof guaranteeUsed !== 'boolean'
    || !Number.isInteger(currentPity) || currentPity < 0 || currentPity >= pityLimit
    || !Number.isInteger(guaranteeProgress) || guaranteeProgress < 0
    || (!guaranteeUsed && guaranteeLimit && guaranteeProgress >= guaranteeLimit)
    || !(targetSixRate > 0 && targetSixRate <= 1)) throw new Error('Invalid target distribution state');

  let states = new Map([[currentPity, 1]]);
  let cumulative = 0;
  let expectedCapped = 0;
  const points = [{ cost: 0, probability: 0, cumulativeRate: 0 }];
  for (let step = 1; step <= horizon; step++) {
    const next = new Map();
    let probability = 0;
    const add = (pity, mass) => next.set(pity, (next.get(pity) || 0) + mass);
    const forcedTarget = !guaranteeUsed && guaranteeLimit > 0 && guaranteeProgress + step >= guaranteeLimit;
    for (const [pity, mass] of states) {
      expectedCapped += mass; // E[min(T, horizon)] = sum P(T > n), n=0..horizon-1
      if (forcedTarget) { probability += mass; continue; }
      if (weapon) {
        const sixGuaranteed = pity + 1 >= pityLimit;
        const noSix = sixGuaranteed ? 0 : (1 - rules.sixStarBaseProbability) ** rules.claimSize;
        const target = sixGuaranteed
          ? calculateWeaponSixStarPityTargetProbability({ ...rules, upProbability: targetSixRate })
          : 1 - (1 - rules.sixStarBaseProbability * targetSixRate) ** rules.claimSize;
        probability += mass * target;
        add(0, mass * Math.max(0, 1 - target - noSix));
        if (noSix) add(pity + 1, mass * noSix);
      } else {
        const six = calculateSixStarProbability(pity + 1, rules);
        probability += mass * six * targetSixRate;
        add(0, mass * six * (1 - targetSixRate));
        if (six < 1) add(pity + 1, mass * (1 - six));
      }
    }
    cumulative = Math.min(1, cumulative + probability);
    points.push({ cost: step, probability, cumulativeRate: cumulative });
    states = next;
  }
  const tailProbability = [...states.values()].reduce((sum, mass) => sum + mass, 0);
  return {
    unit, points, tailProbability, expectedCapped,
    expectationIsComplete: tailProbability === 0,
    model: weapon ? 'reserved-six-star-slot' : 'state-transition',
  };
}
