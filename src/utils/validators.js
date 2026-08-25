// 数据校验工具函数
import { getRulesForPool, resolvePoolCapabilities } from './poolCapabilities.js';
import {
  buildOneTimeTargetGuaranteeState,
  buildScopedPaidHistoryTimeline,
} from './poolScopedHistory.js';
import {
  getPasswordCharacterGroups,
  validateAccountPassword,
} from './authSecurity.js';
import { getUsernameValidationCode } from './usernameValidation.js';

/**
 * 获取卡池规则
 * @param {string} poolType - 'limited' | 'standard' | 'weapon'
 * @returns {Object}
 */
export const getPoolRules = (pool) => getRulesForPool(pool);

const isGiftPull = (pull) => pull?.specialType === 'gift' || pull?.special_type === 'gift';

const isFreePull = (pull) => pull?.isFree === true || pull?.is_free === true || pull?.isFreePull === true;

const isPaidRulePull = (pull) => !isGiftPull(pull) && !isFreePull(pull);

const isTargetSixStar = (pull) => Number(pull?.rarity) === 6 && (
  pull?.isUp === true ||
  pull?.isLimited === true ||
  pull?.isStandard === false
);

const hasSixStar = (pulls) => pulls.some((pull) => Number(pull?.rarity) === 6);

const hasFiveStarOrAbove = (pulls) => pulls.some((pull) => Number(pull?.rarity) >= 5);

const hasTargetSixStar = (pulls) => pulls.some(isTargetSixStar);

function countPreviousWeaponMissClaims(pulls, claimStart, claimSize, matcher) {
  let misses = 0;

  for (let start = claimStart - claimSize; start >= 0; start -= claimSize) {
    const claim = pulls.slice(start, start + claimSize);
    if (claim.length < claimSize) {
      break;
    }
    if (matcher(claim)) {
      break;
    }
    misses += 1;
  }

  return misses;
}

function validateCompletedWeaponClaims({
  existingPulls,
  targetExistingPulls = existingPulls,
  batchData,
  rules,
  errors,
}) {
  const claimSize = Math.max(1, Math.floor(Number(rules.claimSize) || 10));
  const sixStarClaimPity = Number(rules.sixStarClaimPity || Math.ceil((rules.sixStarPity || 40) / claimSize));
  const targetClaimPity = Number(
    rules.guaranteedLimitedClaimPity || Math.ceil((rules.guaranteedLimitedPity || 80) / claimSize)
  );
  const combinedPulls = [...existingPulls, ...batchData];
  const firstNewIndex = existingPulls.length;

  for (let claimStart = Math.floor(firstNewIndex / claimSize) * claimSize;
    claimStart < combinedPulls.length;
    claimStart += claimSize) {
    const claimEnd = claimStart + claimSize;
    if (claimEnd <= firstNewIndex || claimEnd > combinedPulls.length) {
      continue;
    }

    const claim = combinedPulls.slice(claimStart, claimEnd);
    const claimNumber = Math.floor(claimStart / claimSize) + 1;

    if (!hasFiveStarOrAbove(claim)) {
      errors.push(`录入错误：武器池第 ${claimNumber} 次申领未包含5星或以上武器`);
    }

    const previousSixStarMissClaims = countPreviousWeaponMissClaims(
      combinedPulls,
      claimStart,
      claimSize,
      hasSixStar
    );
    if (previousSixStarMissClaims >= sixStarClaimPity - 1 && !hasSixStar(claim)) {
      errors.push(`录入错误：武器池连续 ${sixStarClaimPity} 次申领未获得6星武器，第 ${claimNumber} 次申领应至少包含1件6星武器`);
    }

  }

  const combinedTargetPulls = [...targetExistingPulls, ...batchData];
  const firstNewTargetIndex = targetExistingPulls.length;
  for (let claimStart = Math.floor(firstNewTargetIndex / claimSize) * claimSize;
    claimStart < combinedTargetPulls.length;
    claimStart += claimSize) {
    const claimEnd = claimStart + claimSize;
    if (claimEnd <= firstNewTargetIndex || claimEnd > combinedTargetPulls.length) {
      continue;
    }

    const claim = combinedTargetPulls.slice(claimStart, claimEnd);
    const claimNumber = Math.floor(claimStart / claimSize) + 1;
    const hasTargetBefore = combinedTargetPulls.slice(0, claimStart).some(isTargetSixStar);
    if (!hasTargetBefore) {
      const previousTargetMissClaims = countPreviousWeaponMissClaims(
        combinedTargetPulls,
        claimStart,
        claimSize,
        hasTargetSixStar
      );
      if (previousTargetMissClaims >= targetClaimPity - 1 && !hasTargetSixStar(claim)) {
        errors.push(`录入错误：武器池连续 ${targetClaimPity} 次申领未获得概率提升6星武器，第 ${claimNumber} 次申领应至少包含1件目标武器`);
      }
    }
  }
}

function annotateHistoryWithPoolFallback(history, pool, pools) {
  if (Array.isArray(pools) && pools.length > 0) {
    return history;
  }

  return history.map((record) => ({
    ...record,
    type: record?.type || record?.poolType || record?.pool_type || pool?.type,
    extra_rule_profile: record?.extra_rule_profile
      ?? record?.extraRuleProfile
      ?? pool?.extra_rule_profile
      ?? pool?.extraRuleProfile,
    extra_series_key: record?.extra_series_key
      ?? record?.extraSeriesKey
      ?? pool?.extra_series_key
      ?? pool?.extraSeriesKey,
  }));
}

function buildValidationRuleState({ existingPulls, allPoolPulls, pools, pool }) {
  const capabilities = resolvePoolCapabilities(pool);
  const sourceHistory = Array.isArray(allPoolPulls) && allPoolPulls.length > 0
    ? allPoolPulls
    : existingPulls;
  const contextualHistory = annotateHistoryWithPoolFallback(sourceHistory, pool, pools);
  const scopePools = [...(Array.isArray(pools) ? pools : []), pool].filter(Boolean);
  const pityPulls = capabilities.pityScope === 'pool'
    ? existingPulls.filter(isPaidRulePull)
    : buildScopedPaidHistoryTimeline({
        history: contextualHistory,
        pools: scopePools,
        pool,
        scopeType: 'pity',
      });
  const targetPulls = capabilities.targetScope === 'pool'
    ? existingPulls.filter(isPaidRulePull)
    : buildScopedPaidHistoryTimeline({
        history: contextualHistory,
        pools: scopePools,
        pool,
        scopeType: 'target',
      });
  const targetGuarantee = buildOneTimeTargetGuaranteeState({
    history: contextualHistory,
    pools: scopePools,
    pool,
  });

  return {
    pityPulls,
    targetPulls,
    targetGuarantee,
  };
}

/**
 * 计算当前概率（考虑软保底）
 * @param {number} currentPity - 当前垫刀数
 * @param {string|Object} pool - 卡池类型或卡池记录
 * @returns {{probability: number, isInSoftPity: boolean, pullsUntilSoftPity: number, hasSoftPity: boolean}}
 */
export const calculateCurrentProbability = (currentPity, pool) => {
  const rules = getPoolRules(pool);
  const baseProbability = rules.sixStarBaseProbability;
  const normalizedCurrentPity = Math.max(0, Math.floor(Number(currentPity) || 0));
  const nextPity = normalizedCurrentPity + 1;

  // 武器池没有软保底机制
  if (!rules.hasSoftPity) {
    return {
      probability: nextPity >= rules.sixStarPity ? 1 : baseProbability,
      isInSoftPity: false,
      pullsUntilSoftPity: 0,
      hasSoftPity: false
    };
  }

  const softPityStart = rules.sixStarSoftPityStart;
  const softPityIncrease = rules.sixStarSoftPityIncrease;

  if (nextPity >= rules.sixStarPity) {
    return {
      probability: 1,
      isInSoftPity: true,
      pullsUntilSoftPity: 0,
      hasSoftPity: true
    };
  }

  if (nextPity < softPityStart) {
    return {
      probability: baseProbability,
      isInSoftPity: false,
      pullsUntilSoftPity: softPityStart - nextPity,
      hasSoftPity: true
    };
  }

  // 当前垫刀数表示已经连续未出 6 星的次数；展示的是下一抽概率。
  const extraPulls = nextPity - softPityStart + 1;
  const probability = Math.min(baseProbability + extraPulls * softPityIncrease, 1);

  return {
    probability,
    isInSoftPity: true,
    pullsUntilSoftPity: 0,
    hasSoftPity: true
  };
};

/**
 * 校验抽卡记录数据
 * @param {Object} data - 抽卡数据
 * @returns {{isValid: boolean, errors: string[]}}
 */
export const validatePullData = (data) => {
  const errors = [];

  // 校验 rarity
  if (![4, 5, 6].includes(data.rarity)) {
    errors.push(`无效的星级: ${data.rarity}`);
  }

  // 校验 poolId
  if (!data.poolId || typeof data.poolId !== 'string') {
    errors.push('缺少卡池ID');
  }

  // 校验 isStandard (仅6星需要)
  if (data.rarity === 6 && typeof data.isStandard !== 'boolean') {
    errors.push('6星记录需要指定是否为常驻');
  }

  // 校验 specialType
  const validSpecialTypes = [null, 'gift', 'guaranteed'];
  if (!validSpecialTypes.includes(data.specialType)) {
    errors.push(`无效的特殊类型: ${data.specialType}`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * 校验录入数据是否符合卡池规则
 * @param {Object} params
 * @param {Object} params.newPull - 新录入的抽卡数据
 * @param {Array} params.existingPulls - 当前卡池已有的抽卡记录
 * @param {Array} params.allLimitedPoolPulls - 所有限定池的抽卡记录（用于跨池保底继承）
 * @param {Object} params.pool - 当前卡池信息 {type: 'limited'|'standard'|'weapon'}
 * @returns {{isValid: boolean, errors: string[], warnings: string[]}}
 */
export const validatePullAgainstRules = ({
  newPull,
  existingPulls,
  allLimitedPoolPulls = [],
  pools = [],
  pool,
}) => {
  const errors = [];
  const warnings = [];
  const capabilities = resolvePoolCapabilities(pool);
  const poolType = capabilities.basePoolType;
  const rules = getPoolRules(pool);

  // 过滤掉赠送的记录
  const validPulls = existingPulls.filter(isPaidRulePull);
  const validationState = buildValidationRuleState({
    existingPulls,
    allPoolPulls: allLimitedPoolPulls,
    pools,
    pool,
  });
  const currentPity = calculatePityFromHistory(validationState.pityPulls);
  const currentPity5 = calculatePity5FromHistory(validationState.pityPulls);

  if (poolType === 'weapon') {
    validateCompletedWeaponClaims({
      existingPulls: validPulls,
      targetExistingPulls: validationState.targetPulls,
      batchData: isPaidRulePull(newPull) ? [newPull] : [],
      rules,
      errors
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  // 1. 检查6星保底规则
  if (newPull.rarity === 6) {
    // 出6星时垫刀数 +1
    const pullsForThisSixStar = currentPity + 1;

    // 检查是否超过硬保底
    if (pullsForThisSixStar > rules.sixStarPity) {
      errors.push(`录入错误：在第 ${pullsForThisSixStar} 抽出6星，但${poolType === 'weapon' ? '武器池' : '角色池'}最多 ${rules.sixStarPity} 抽保底`);
    }
  }

  // 2. 检查4星连续抽数（不应连续超过10抽没有5星+）
  if (newPull.rarity === 4) {
    const consecutive4Stars = currentPity5 + 1;
    if (consecutive4Stars > rules.fiveStarPity) {
      errors.push(`录入错误：已连续 ${consecutive4Stars} 抽没有5星或以上，但规则是 ${rules.fiveStarPity} 抽保底5星+`);
    }
  }

  // 3. 检查硬保底逻辑（限定池120抽、武器池80抽）
  if (capabilities.targetMode === 'single-up') {
    const guaranteedPity = Number(rules.guaranteedLimitedPity || 0);
    const totalPulls = validationState.targetGuarantee.pity + 1;
    const hasLimitedAlready = validationState.targetGuarantee.hasReceivedGuaranteedLimited;

    // 如果已经到了硬保底抽数，且之前没出过限定，这抽必须是限定6星
    if (totalPulls === guaranteedPity && !hasLimitedAlready) {
      if (newPull.rarity !== 6) {
        warnings.push(`提示：第 ${guaranteedPity} 抽应为硬保底，必出6星`);
      } else if (newPull.isStandard) {
        errors.push(`录入错误：第 ${guaranteedPity} 抽为硬保底，必出限定UP，不可能是常驻`);
      }
    }

    // 如果超过硬保底抽数还没出过限定（且没有标记guaranteed），给出警告
    if (totalPulls > guaranteedPity && !hasLimitedAlready && newPull.specialType !== 'guaranteed') {
      warnings.push(`警告：已超过 ${guaranteedPity} 抽硬保底，请检查是否有遗漏的限定角色`);
    }
  }

  // 4. 检查常驻池特殊规则（不区分限定/歪）
  if (poolType === 'standard' && newPull.rarity === 6 && !newPull.isStandard) {
    warnings.push('提示：常驻池没有限定角色，建议将此6星标记为常驻');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
};

/**
 * 验证十连数据
 * @param {Array} batchData - 十连数据数组
 * @param {Array} existingPulls - 已有记录
 * @param {Object} pool - 卡池信息
 * @returns {{isValid: boolean, errors: string[], warnings: string[]}}
 */
export const validateBatchAgainstRules = ({
  batchData,
  existingPulls,
  allLimitedPoolPulls = [],
  pools = [],
  pool,
}) => {
  const errors = [];
  const warnings = [];
  const capabilities = resolvePoolCapabilities(pool);
  const poolType = capabilities.basePoolType;
  const rules = getPoolRules(pool);

  const validExistingPulls = existingPulls.filter(isPaidRulePull);
  const validBatchPulls = batchData.filter(isPaidRulePull);
  const validationState = buildValidationRuleState({
    existingPulls,
    allPoolPulls: allLimitedPoolPulls,
    pools,
    pool,
  });

  // 1. 检查十连中5星保底
  const has5StarOrAbove = (poolType === 'weapon' ? validBatchPulls : batchData)
    .some(p => p.rarity >= 5);
  if (!has5StarOrAbove && poolType !== 'weapon') {
    // 角色池：检查是否有累积的5星保底
    const currentPity5 = calculatePity5FromHistory(validationState.pityPulls);
    if (currentPity5 + 10 > rules.fiveStarPity) {
      errors.push(`录入错误：此十连无5星+，但加上之前的 ${currentPity5} 抽，已超过 ${rules.fiveStarPity} 抽5星保底`);
    }
  }

  // 武器池：每十连必出5星+
  if (poolType === 'weapon' && !has5StarOrAbove) {
    errors.push('录入错误：武器池每次申领（十连）必定有5星或以上武器');
  }

  if (poolType === 'weapon') {
    validateCompletedWeaponClaims({
      existingPulls: validExistingPulls,
      targetExistingPulls: validationState.targetPulls,
      batchData: validBatchPulls,
      rules,
      errors
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  // 2. 模拟录入，检查每一抽
  const simulatedPulls = [...validationState.pityPulls];
  let pity = calculatePityFromHistory(simulatedPulls);
  let pity5 = calculatePity5FromHistory(simulatedPulls);

  for (let i = 0; i < batchData.length; i++) {
    const pull = batchData[i];
    pity++;
    pity5++;

    // 检查6星保底
    if (pull.rarity === 6) {
      if (pity > rules.sixStarPity) {
        errors.push(`录入错误：第 ${simulatedPulls.length + i + 1} 抽出6星（垫刀 ${pity}），超过 ${rules.sixStarPity} 抽保底`);
      }
      pity = 0;
    }

    // 检查5星保底
    if (pull.rarity >= 5) {
      if (pity5 > rules.fiveStarPity) {
        errors.push(`录入错误：第 ${simulatedPulls.length + i + 1} 抽出${pull.rarity}星，但之前已连续 ${pity5} 抽无5星+`);
      }
      pity5 = 0;
    }

    // 检查超过5星保底
    if (pity5 > rules.fiveStarPity) {
      errors.push(`录入错误：第 ${simulatedPulls.length + i + 1} 抽（十连中第 ${i + 1} 个）后，连续 ${pity5} 抽无5星+，超过保底`);
    }
  }

  // 3. 检查硬保底逻辑
  if (capabilities.targetMode === 'single-up') {
    const guaranteedPity = Number(rules.guaranteedLimitedPity || 0);
    const startIndex = validationState.targetGuarantee.pity;
    const hasLimitedBefore = validationState.targetGuarantee.hasReceivedGuaranteedLimited;

    if (!hasLimitedBefore) {
      // 检查这个十连是否跨越了硬保底点
      for (let i = 0; i < batchData.length; i++) {
        const globalIndex = startIndex + i + 1;
        if (globalIndex === guaranteedPity) {
          const pull = batchData[i];
          if (pull.rarity !== 6) {
            warnings.push(`提示：第 ${guaranteedPity} 抽是硬保底，应为6星`);
          } else if (pull.isStandard) {
            errors.push(`录入错误：第 ${guaranteedPity} 抽为硬保底，必出限定UP`);
          }
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
};

/**
 * 从历史记录计算当前6星垫刀数
 * @param {Array} pulls - 抽卡记录（已过滤gift）
 * @returns {number}
 */
export const calculatePityFromHistory = (pulls) => {
  let pity = 0;
  for (let i = pulls.length - 1; i >= 0; i--) {
    if (pulls[i].rarity === 6) break;
    pity++;
  }
  return pity;
};

/**
 * 从历史记录计算当前5星垫刀数
 * @param {Array} pulls - 抽卡记录（已过滤gift）
 * @returns {number}
 */
export const calculatePity5FromHistory = (pulls) => {
  let pity = 0;
  for (let i = pulls.length - 1; i >= 0; i--) {
    if (pulls[i].rarity >= 5) break;
    pity++;
  }
  return pity;
};

/**
 * 计算跨池继承的保底数
 * 将所有限定池的抽卡记录按时间合并为一条时间线，从末尾往前计算垫刀数
 * 这样保底自然跨池继承
 * @param {Array} allLimitedPools - 所有限定池
 * @param {Array} allHistory - 所有抽卡记录
 * @param {string} currentPoolId - 当前卡池ID
 * @returns {{inheritedPity: number, inheritedPity5: number, isInherited: boolean}}
 */
export const calculateInheritedPity = (allLimitedPools, allHistory, currentPoolId) => {
  // 获取所有限定池ID
  const allLimitedPoolIds = allLimitedPools
    .filter(p => p.type === 'limited')
    .map(p => p.id);

  // 合并所有限定池的记录，按时间顺序排序
  // 注意：不能用 record_id 排序，因为不同池的 record_id 前缀不同（如 192xxx vs 194xxx），跨池时大小不代表时间顺序
  const allLimitedPulls = allHistory
    .filter(p => allLimitedPoolIds.includes(p.poolId) && p.specialType !== 'gift' && p.isFree !== true)
    .sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      if (timeA !== timeB) return timeA - timeB;
      // 同一时间戳内（十连），按 seqId 排序
      return (parseInt(a.seqId || a.seq_id || '0', 10)) - (parseInt(b.seqId || b.seq_id || '0', 10));
    });

  if (allLimitedPulls.length === 0) {
    return { inheritedPity: 0, inheritedPity5: 0, isInherited: false };
  }

  // 从末尾往前计算6星垫刀数（跨池）
  const inheritedPity = calculatePityFromHistory(allLimitedPulls);
  // 从末尾往前计算5星垫刀数（跨池）
  const inheritedPity5 = calculatePity5FromHistory(allLimitedPulls);

  // 判断是否有来自其他池的继承（最后一抽不在当前池中）
  // 找到最后一个6星的位置
  let lastSixStarPoolId = null;
  for (let i = allLimitedPulls.length - 1; i >= 0; i--) {
    if (allLimitedPulls[i].rarity === 6) {
      lastSixStarPoolId = allLimitedPulls[i].poolId;
      break;
    }
  }
  // 如果从未出过6星，或最后一个6星不在当前池，则存在继承
  const isInherited = inheritedPity > 0 && lastSixStarPoolId !== currentPoolId;

  return { inheritedPity, inheritedPity5, isInherited };
};

/**
 * 校验卡池数据
 * @param {Object} data - 卡池数据
 * @returns {{isValid: boolean, errors: string[]}}
 */
export const validatePoolData = (data) => {
  const errors = [];

  if (!data.id || typeof data.id !== 'string') {
    errors.push('缺少卡池ID');
  }

  if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
    errors.push('卡池名称不能为空');
  }

  if (!['limited', 'standard', 'weapon'].includes(data.type)) {
    errors.push(`无效的卡池类型: ${data.type}`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * 校验用户数据 (用于AdminPanel)
 * @param {Object} data - 用户数据
 * @param {boolean} isCreating - 是否为创建新用户(true) 还是编辑(false)
 * @returns {{isValid: boolean, errors: string[]}}
 */
export const validateUserData = (data, isCreating = true) => {
  const errors = [];

  // 1. 邮箱验证 (仅创建时需要)
  if (isCreating) {
    if (!data.email || typeof data.email !== 'string') {
      errors.push('邮箱不能为空');
    } else {
      // 邮箱格式验证
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.email.trim())) {
        errors.push('邮箱格式不正确');
      }
    }
  }

  // 2. 密码验证 (仅创建时需要)
  if (isCreating) {
    if (!data.password || typeof data.password !== 'string') {
      errors.push('密码不能为空');
    } else {
      const passwordValidation = validateAccountPassword(data.password);
      if (passwordValidation.errors.includes('too_short')) {
        errors.push('密码至少需要8位字符');
      }
      if (passwordValidation.errors.includes('too_long')) {
        errors.push('密码长度不能超过100位');
      }
      if (passwordValidation.errors.includes('too_simple')) {
        errors.push('密码需要至少包含两类字符，例如字母和数字');
      }
    }
  }

  // 3. 用户名验证
  if (data.username && typeof data.username === 'string') {
    const validationCode = getUsernameValidationCode(data.username);
    if (validationCode === 'too_short') {
      errors.push('用户名至少需要2个字符');
    } else if (validationCode === 'too_long') {
      errors.push('用户名长度不能超过50个字符');
    } else if (validationCode === 'invalid_characters') {
      errors.push('用户名只能包含中文、字母、数字、日文等文字、数字，以及 . _ - +');
    }
  }

  // 4. 角色验证 (关键安全检查)
  if (!data.role || typeof data.role !== 'string') {
    errors.push('角色不能为空');
  } else {
    // 严格限制角色枚举值
    const allowedRoles = ['user', 'admin'];
    if (!allowedRoles.includes(data.role)) {
      errors.push(`无效的角色类型: ${data.role}，只允许 user 或 admin`);
    }
    // 明确禁止创建超级管理员
    if (data.role === 'super_admin') {
      errors.push('禁止通过此接口创建超级管理员');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * 校验邮箱格式
 * @param {string} email - 邮箱地址
 * @returns {boolean}
 */
export const validateEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
};

/**
 * 校验密码强度
 * @param {string} password - 密码
 * @returns {{isValid: boolean, strength: 'weak'|'medium'|'strong', errors: string[]}}
 */
export const validatePasswordStrength = (password) => {
  const errors = [];
  let strength = 'weak';

  if (!password || typeof password !== 'string') {
    errors.push('密码不能为空');
    return { isValid: false, strength, errors };
  }

  const validation = validateAccountPassword(password);

  if (validation.errors.includes('too_short')) {
    errors.push('密码至少需要8位字符');
  }

  if (validation.errors.includes('too_long')) {
    errors.push('密码长度不能超过100位');
  }

  if (password.length >= 8) strength = 'medium';
  if (password.length >= 12) strength = 'strong';

  const complexityCount = getPasswordCharacterGroups(password);
  if (complexityCount < 2) {
    errors.push('密码需要至少包含两类字符，例如字母和数字');
    strength = 'weak';
  } else if (complexityCount >= 3 && password.length >= 12) {
    strength = 'strong';
  }

  return {
    isValid: errors.length === 0,
    strength,
    errors
  };
};
