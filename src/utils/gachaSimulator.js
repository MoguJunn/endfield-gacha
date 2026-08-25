/**
 * 抽卡模拟器核心
 *
 * 管理模拟器状态和抽卡逻辑
 */

import {
  simulateSinglePull,
  simulateTenPull,
  simulateWeaponTenClaim,
  simulateCharacterFreeTen,
  checkInfoBookAvailable,
  calculateExpectedPulls
} from './probabilityEngine.js';

import {
  EXTRA_POOL_RULES,
  LIMITED_POOL_RULES,
  WEAPON_POOL_RULES,
  STANDARD_POOL_RULES
} from '../constants/index.js';
import { EXTRA_RULE_PROFILES, resolvePoolCapabilities } from './poolCapabilities.js';

import {
  getCurrentUpCharacter
} from '../constants/characterPools.js';

import { characterCache } from './characterUtils.js';

function normalizeEntityName(value) {
  return String(value || '').trim();
}

function resolveRosterAvatarUrl(poolCharactersList, characterName) {
  const targetName = normalizeEntityName(characterName);
  if (!targetName || !poolCharactersList) {
    return null;
  }

  const buckets = ['items', 'up', 'offBanner', 'fiveStar', 'fourStar'];
  for (const bucket of buckets) {
    const entries = Array.isArray(poolCharactersList?.[bucket]) ? poolCharactersList[bucket] : [];
    const matchedEntry = entries.find((entry) => {
      if (!entry || typeof entry !== 'object') {
        return false;
      }
      return normalizeEntityName(entry.name) === targetName || normalizeEntityName(entry.id) === targetName;
    });
    const avatarUrl = matchedEntry?.avatarUrl || matchedEntry?.avatar_url || null;
    if (avatarUrl) {
      return avatarUrl;
    }
  }

  return null;
}

/**
 * 创建初始模拟器状态
 * @param {string} poolType - 卡池类型
 * @returns {Object} 初始状态
 */
export function createInitialState(poolType = 'limited_character', capabilities = resolvePoolCapabilities(poolType)) {
  return {
    // 卡池类型
    poolType,
    extraRuleProfile: capabilities.ruleProfile,
    extraSeriesKey: capabilities.seriesKey,

    // 保底计数
    sixStarPity: 0,
    fiveStarPity: 0,

    // 目标保底状态
    isGuaranteedUp: false,              // 兼容旧存档字段；当前规则下不使用“歪了下次必出”
    guaranteedLimitedPity: 0,           // 当前卡池的一次性目标保底进度（限定120 / 武器80）
    hasReceivedGuaranteedLimited: false, // 当前卡池的一次性目标保底是否已满足

    // 统计数据
    totalPulls: 0,
    sixStarCount: 0,
    fiveStarCount: 0,
    upSixStarCount: 0,                  // UP 6星数量

    // 赠送机制
    seriesRewardPulls: null,             // 系列奖励付费抽数；null 时兼容旧存档并回退当前池总抽数
    giftsReceived: 0,                   // 已领取的赠送次数（限定池：每240抽）
    freeTenPullsReceived: 0,            // 已领取的30抽赠送十连次数（限定池/附加寻访：仅1次）
    hasReceivedInfoBook: false,         // 是否已领取情报书（限定池：60抽，仅1次）
    hasUnactivatedInfoBook: false,      // 是否有未激活的情报书（下一个池激活）
    infoBookTenPullAvailable: false,    // 情报书十连是否可用（下一个限定池）
    hasUsedInfoBookTenPull: false,      // 是否已使用情报书十连
    hasReceivedSelectGift: false,       // 是否已领取自选赠送（常驻池：300抽，仅1次）

    // 资源
    syntheticJade: 0,                   // 嵌金玉
    pullTickets: 0,                     // 寻访凭证

    // 历史记录
    pullHistory: [],                    // 抽卡历史

    // UI状态
    isAnimating: false,
    lastPullResult: null
  };
}

/**
 * 根据卡池类型获取对应规则
 * @param {string} poolType - 卡池类型
 * @returns {Object} 卡池规则
 */
export function getRulesByPoolType(pool) {
  if (pool && typeof pool === 'object') {
    return resolvePoolCapabilities(pool).rules;
  }

  const poolType = pool;
  switch (poolType) {
    case 'extra':
      return EXTRA_POOL_RULES;
    case 'limited':
    case 'limited_character':
      return LIMITED_POOL_RULES;
    case 'weapon':
    case 'limited_weapon':
      return WEAPON_POOL_RULES;
    case 'standard':
    case 'standard_pool':
      return STANDARD_POOL_RULES;
    default:
      return LIMITED_POOL_RULES;
  }
}

function resolveSimulatorCapabilities(pool) {
  if (typeof pool === 'string' && pool === 'extra') {
    // 兼容旧调用方只传 poolType 的模拟器入口；真实卡池对象仍必须有 profile。
    return resolvePoolCapabilities({
      id: 'legacy-simulator-extra',
      type: 'extra',
      extra_rule_profile: EXTRA_RULE_PROFILES.BRILLIANCE_FESTIVAL,
    });
  }

  return resolvePoolCapabilities(pool);
}

function normalizeSimulatorPoolType(poolType) {
  if (poolType === 'limited_weapon' || poolType === 'weapon') {
    return 'weapon';
  }

  if (poolType === 'limited_character' || poolType === 'limited') {
    return 'limited';
  }

  if (poolType === 'standard_pool' || poolType === 'standard') {
    return 'standard';
  }

  return poolType;
}

/**
 * 抽卡模拟器类
 */
export class GachaSimulator {
  constructor(pool = 'limited_character', customRules = null, currentUpCharacter = null, poolCharactersList = null) {
    this.poolInfo = typeof pool === 'object' ? pool : { type: pool };
    this.capabilities = resolveSimulatorCapabilities(pool);
    this.rawPoolType = this.capabilities.rawPoolType;
    this.poolType = this.capabilities.basePoolType;
    this.state = createInitialState(this.poolType, this.capabilities);
    // 如果提供自定义规则则使用，否则根据 poolType 自动选择
    this.rules = customRules || getRulesByPoolType(pool);
    this.listeners = [];
    // 当前UP角色（限定池专用）
    this.currentUpCharacter = currentUpCharacter;
    // 卡池角色列表（从 pool_characters 表加载）
    this.poolCharactersList = poolCharactersList;

    // 确保角色数据已加载
    this.ensureCharacterDataLoaded();
  }

  assertResolved() {
    if (!this.capabilities.isResolved) {
      throw new Error('当前附加寻访规则尚未识别，模拟器已停止抽取');
    }
  }

  /**
   * 确保角色数据已加载
   * @private
   * @returns {Promise<void>}
   */
  async ensureCharacterDataLoaded() {
    if (!characterCache.isLoaded()) {
      await characterCache.load();
    }
  }

  /**
   * 设置当前UP角色
   * @param {string} characterName - UP角色名称
   */
  setCurrentUpCharacter(characterName) {
    this.currentUpCharacter = characterName;
  }

  /**
   * 设置卡池角色列表
   * @param {Object} list - 角色列表 {up: [], offBanner: [], fiveStar: [], fourStar: []}
   */
  setPoolCharactersList(list) {
    this.poolCharactersList = list;
  }

  resolvePullAvatarUrl(characterName) {
    return resolveRosterAvatarUrl(this.poolCharactersList, characterName)
      || characterCache.searchByName(characterName, false)?.avatar_url
      || characterCache.searchByName(characterName, true)?.avatar_url
      || null;
  }

  /**
   * 获取当前UP角色
   * @returns {string} UP角色名称
   */
  getCurrentUpCharacter() {
    // 如果手动设置了UP角色，使用手动设置的
    if (this.currentUpCharacter) {
      return this.currentUpCharacter;
    }
    // 否则根据时间自动判断
    return getCurrentUpCharacter();
  }

  /**
   * 添加状态监听器
   * @param {Function} listener - 监听回调函数
   */
  addListener(listener) {
    this.listeners.push(listener);
  }

  /**
   * 移除监听器
   * @param {Function} listener - 监听回调函数
   */
  removeListener(listener) {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  /**
   * 通知所有监听器
   */
  notifyListeners() {
    this.listeners.forEach(listener => listener(this.state));
  }

  /**
   * 更新状态
   * @param {Object} updates - 状态更新
   */
  updateState(updates) {
    this.state = {
      ...this.state,
      ...updates
    };
    this.notifyListeners();
  }

  /**
   * 单抽
   * @returns {Object} 抽卡结果
   */
  pullSingle() {
    this.assertResolved();
    if (normalizeSimulatorPoolType(this.poolType) === 'weapon') {
      throw new Error('武器池按申领进行，每次申领固定获得10件武器');
    }

    // 获取当前UP角色（如果是限定池）
    const currentUpChar = this.capabilities.targetMode === 'single-up' && this.capabilities.entityType === 'character'
      ? this.getCurrentUpCharacter()
      : null;

    const result = simulateSinglePull(this.state, this.rules, this.poolType, currentUpChar, this.poolCharactersList);

    // 更新历史记录
    const pullRecord = {
      pullNumber: this.state.totalPulls + 1,
      rarity: result.rarity,
      isUp: result.isUp,
      isLimited: result.isLimited,
      characterName: result.characterName,
      avatarUrl: result.avatarUrl || this.resolvePullAvatarUrl(result.characterName),
      timestamp: Date.now()
    };

    // 检查特殊机制
    const rewardPulls = this.getRewardPullCount(result.totalPulls);
    const gifts = this.checkGifts(rewardPulls);
    const infoBook = this.checkInfoBook(result);

    // 更新状态
    this.updateState({
      ...result,
      seriesRewardPulls: this.capabilities.rewardScope === 'series'
        ? rewardPulls
        : this.state.seriesRewardPulls,
      pullHistory: [...this.state.pullHistory, pullRecord],
      giftsReceived: gifts.count,
      hasReceivedInfoBook: infoBook || this.state.hasReceivedInfoBook,
      // 如果获得情报书，标记为未激活（需要切换到下一个池才能使用）
      hasUnactivatedInfoBook: infoBook ? true : this.state.hasUnactivatedInfoBook,
      lastPullResult: pullRecord,
      upSixStarCount: result.rarity === 6 && result.isUp
        ? this.state.upSixStarCount + 1
        : this.state.upSixStarCount
    });

    return pullRecord;
  }

  /**
   * 十连
   * @returns {Array} 十连结果数组
   */
  pullTen() {
    this.assertResolved();
    if (normalizeSimulatorPoolType(this.poolType) === 'weapon') {
      return this.pullWeaponClaim();
    }

    // 获取当前UP角色（如果是限定池）
    const currentUpChar = this.capabilities.targetMode === 'single-up' && this.capabilities.entityType === 'character'
      ? this.getCurrentUpCharacter()
      : null;

    const results = simulateTenPull(this.state, this.rules, this.poolType, currentUpChar, this.poolCharactersList);
    const pullRecords = [];

    // 处理每一抽的结果
    results.forEach((result, index) => {
      const pullNumber = this.state.totalPulls + index + 1;

      const pullRecord = {
        pullNumber,
        rarity: result.rarity,
        isUp: result.isUp,
        isLimited: result.isLimited,
        characterName: result.characterName,
        avatarUrl: result.avatarUrl || this.resolvePullAvatarUrl(result.characterName),
        timestamp: Date.now() + index, // 加上微小偏移区分
        batchIndex: index,
        isTenPull: true
      };

      pullRecords.push(pullRecord);
    });

    // 使用最后一抽的结果更新状态
    const finalResult = results[results.length - 1];

    // 检查特殊机制
    const rewardPulls = this.getRewardPullCount(finalResult.totalPulls);
    const gifts = this.checkGifts(rewardPulls);
    const infoBook = this.checkInfoBook(finalResult);

    // 统计UP 6星数量
    const upSixStars = results.filter(r => r.rarity === 6 && r.isUp).length;

    this.updateState({
      ...finalResult,
      seriesRewardPulls: this.capabilities.rewardScope === 'series'
        ? rewardPulls
        : this.state.seriesRewardPulls,
      pullHistory: [...this.state.pullHistory, ...pullRecords],
      giftsReceived: gifts.count,
      hasReceivedInfoBook: infoBook || this.state.hasReceivedInfoBook,
      // 如果获得情报书，标记为未激活（需要切换到下一个池才能使用）
      hasUnactivatedInfoBook: infoBook ? true : this.state.hasUnactivatedInfoBook,
      lastPullResult: pullRecords,
      upSixStarCount: this.state.upSixStarCount + upSixStars
    });

    return pullRecords;
  }

  /**
   * 武库申领（每次固定获得10件武器）
   * @returns {Array} 申领结果数组
   */
  pullWeaponClaim() {
    this.assertResolved();
    const currentUpChar = this.currentUpCharacter || null;
    const { results, nextState } = simulateWeaponTenClaim(
      this.state,
      this.rules,
      currentUpChar,
      this.poolCharactersList
    );
    const pullRecords = [];

    let sixStars = 0;
    let fiveStars = 0;
    let upSixStars = 0;

    results.forEach((result, index) => {
      const pullNumber = this.state.totalPulls + index + 1;

      if (result.rarity === 6) {
        sixStars += 1;
        if (result.isUp) upSixStars += 1;
      }
      if (result.rarity === 5) {
        fiveStars += 1;
      }

      pullRecords.push({
        pullNumber,
        rarity: result.rarity,
        isUp: result.isUp,
        isLimited: result.isLimited,
        characterName: result.characterName,
        avatarUrl: result.avatarUrl || this.resolvePullAvatarUrl(result.characterName),
        timestamp: Date.now() + index,
        batchIndex: index,
        isTenPull: true
      });
    });

    const totalPulls = this.state.totalPulls + pullRecords.length;
    const rewardPulls = this.getRewardPullCount(totalPulls);
    const gifts = this.checkGifts(rewardPulls);

    this.updateState({
      ...nextState,
      totalPulls,
      seriesRewardPulls: this.capabilities.rewardScope === 'series'
        ? rewardPulls
        : this.state.seriesRewardPulls,
      sixStarCount: this.state.sixStarCount + sixStars,
      fiveStarCount: this.state.fiveStarCount + fiveStars,
      pullHistory: [...this.state.pullHistory, ...pullRecords],
      giftsReceived: Number(gifts.standardCount || 0) + Number(gifts.limitedCount || 0),
      lastPullResult: pullRecords,
      upSixStarCount: this.state.upSixStarCount + upSixStars
    });

    return pullRecords;
  }

  /**
   * 免费十连（不计入保底和总抽数）
   * @returns {Array} 免费十连结果数组
   */
  pullFreeTen() {
    this.assertResolved();
    // 获取当前UP角色（如果是限定池）
    const currentUpChar = this.capabilities.targetMode === 'single-up' && this.capabilities.entityType === 'character'
      ? this.getCurrentUpCharacter()
      : null;

    const results = simulateCharacterFreeTen(this.rules, this.poolType, currentUpChar, this.poolCharactersList);
    const pullRecords = [];

    // 处理每一抽的结果
    results.forEach((result, index) => {
      const pullNumber = this.state.totalPulls + index + 1; // 显示的抽数（但不真正计入）

      const pullRecord = {
        pullNumber,
        rarity: result.rarity,
        isUp: result.isUp,
        isLimited: result.isLimited,
        characterName: result.characterName,
        avatarUrl: result.avatarUrl || this.resolvePullAvatarUrl(result.characterName),
        timestamp: Date.now() + index,
        batchIndex: index,
        isTenPull: true,
        isFree: result.isFree === true,
        isFreePull: true  // 标记为免费
      };

      pullRecords.push(pullRecord);
    });

    // 免费十连不推进保底、总抽数、目标保底或奖励进度。
    this.updateState({
      pullHistory: [...this.state.pullHistory, ...pullRecords],
      freeTenPullsReceived: Math.min(
        (this.state.freeTenPullsReceived || 0) + 1,
        this.capabilities.freeTenPullLimit
      ),
      lastPullResult: pullRecords
    });

    return pullRecords;
  }

  /**
   * 情报书十连（计入保底，不消耗资源）
   * @returns {Array} 情报书十连结果数组
   */
  pullInfoBookTen() {
    this.assertResolved();
    if (!this.state.infoBookTenPullAvailable || this.state.hasUsedInfoBookTenPull) {
      throw new Error('情报书十连不可用');
    }

    // 获取当前UP角色（如果是限定池）
    const currentUpChar = (this.poolType === 'limited' || this.poolType === 'limited_character')
      ? this.getCurrentUpCharacter()
      : null;

    // 正常执行十连模拟（计入保底）
    const results = simulateTenPull(this.state, this.rules, this.poolType, currentUpChar, this.poolCharactersList);
    const pullRecords = [];

    // 统计6星和5星数量
    let sixStars = 0;
    let fiveStars = 0;
    let upSixStars = 0;

    // 处理每一抽的结果
    results.forEach((result, index) => {
      const pullNumber = this.state.totalPulls + index + 1;

      if (result.rarity === 6) {
        sixStars++;
        if (result.isUp) upSixStars++;
      }
      if (result.rarity === 5) fiveStars++;

      const pullRecord = {
        pullNumber,
        rarity: result.rarity,
        isUp: result.isUp,
        isLimited: result.isLimited,
        characterName: result.characterName,
        avatarUrl: result.avatarUrl || this.resolvePullAvatarUrl(result.characterName),
        timestamp: Date.now() + index,
        batchIndex: index,
        isTenPull: true,
        isInfoBookPull: true  // 标记为情报书十连
      };

      pullRecords.push(pullRecord);
    });

    // 获取最后一抽的状态
    const finalResult = results[results.length - 1];

    // 更新状态（计入保底和总抽数）
    this.updateState({
      sixStarPity: finalResult.sixStarPity,
      fiveStarPity: finalResult.fiveStarPity,
      totalPulls: this.state.totalPulls + 10,
      sixStarCount: this.state.sixStarCount + sixStars,
      fiveStarCount: this.state.fiveStarCount + fiveStars,
      guaranteedLimitedPity: finalResult.guaranteedLimitedPity,
      hasReceivedGuaranteedLimited: finalResult.hasReceivedGuaranteedLimited,
      pullHistory: [...this.state.pullHistory, ...pullRecords],
      lastPullResult: pullRecords,
      upSixStarCount: this.state.upSixStarCount + upSixStars,
      hasUsedInfoBookTenPull: true,  // 标记已使用
      infoBookTenPullAvailable: false  // 使用后不再可用
    });

    return pullRecords;
  }

  /**
   * 获取奖励作用域的付费抽数。系列重构池跨阶段累积，普通池保持单池计数。
   */
  getRewardPullCount(nextPoolTotalPulls = this.state.totalPulls) {
    if (this.capabilities.rewardScope !== 'series') {
      return Number(nextPoolTotalPulls || 0);
    }

    const currentPoolTotal = Number(this.state.totalPulls || 0);
    const delta = Math.max(Number(nextPoolTotalPulls || 0) - currentPoolTotal, 0);
    const storedSeriesPulls = this.state.seriesRewardPulls;
    const baseline = storedSeriesPulls == null
      ? currentPoolTotal
      : Number(storedSeriesPulls || 0);
    return baseline + delta;
  }

  /**
   * 检查30抽赠送十连
   * @param {number} totalPulls - 总抽数（支付的抽数，不包括赠送）
   * @returns {Object} 赠送信息
   */
  checkFreeTenPulls(totalPulls) {
    const milestones = this.capabilities.freeTenPullMilestones;
    if (!this.capabilities.isResolved || milestones.length === 0) {
      return {
        count: 0,
        isNewGift: false,
        nextGiftAt: null,
        remainingPulls: 0
      };
    }

    const rewardPulls = this.getRewardPullCount(totalPulls);
    const freeTenPullCount = milestones.filter((threshold) => rewardPulls >= threshold).length;
    const isNewGift = freeTenPullCount > this.state.freeTenPullsReceived;

    return {
      count: freeTenPullCount,
      isNewGift,
      nextGiftAt: milestones[freeTenPullCount] || null,
      remainingPulls: milestones[freeTenPullCount]
        ? Math.max(milestones[freeTenPullCount] - rewardPulls, 0)
        : 0,
      giftType: 'free_ten_pull'
    };
  }

  /**
   * 检查赠送机制
   * @param {number} totalPulls - 总抽数
   * @returns {Object} 赠送信息
   */
  checkGifts(totalPulls) {
    // 限定池：每240抽送限定角色信物
    if (this.capabilities.basePoolType === 'limited') {
      const giftCount = Math.floor(totalPulls / this.rules.giftInterval);
      const isNewGift = giftCount > this.state.giftsReceived;

      return {
        count: giftCount,
        isNewGift,
        nextGiftAt: (giftCount + 1) * this.rules.giftInterval,
        remainingPulls: (giftCount + 1) * this.rules.giftInterval - totalPulls,
        giftType: 'limited_character'
      };
    }

    if (this.capabilities.basePoolType === 'extra') {
      return {
        count: 0,
        isNewGift: false,
        nextGiftAt: 0,
        remainingPulls: 0
      };
    }

    // 武器池：100(常驻) -> 180(限定) -> 每80抽交替
    if (this.poolType === 'weapon' || this.poolType === 'limited_weapon') {
      let standardGifts = 0;
      let limitedGifts = 0;
      let nextGiftAt = 0;
      let nextGiftType = '';

      if (totalPulls >= 100) {
        standardGifts++; // 100抽送常驻武库箱

        if (totalPulls >= 180) {
          limitedGifts++; // 180抽送限定武器

          // 超过180后，每80抽交替
          const remaining = totalPulls - 180;
          const cycleGifts = Math.floor(remaining / 80);

          // 奇数次是常驻，偶数次是限定
          standardGifts += Math.ceil(cycleGifts / 2);
          limitedGifts += Math.floor(cycleGifts / 2);

          // 计算下一个赠送
          const nextCycleNumber = cycleGifts + 1;
          nextGiftAt = 180 + nextCycleNumber * 80;
          nextGiftType = (nextCycleNumber % 2 === 1) ? 'standard_weapon' : 'limited_weapon';
        } else {
          nextGiftAt = 180;
          nextGiftType = 'limited_weapon';
        }
      } else {
        nextGiftAt = 100;
        nextGiftType = 'standard_weapon';
      }

      return {
        standardCount: standardGifts,
        limitedCount: limitedGifts,
        isNewGift: standardGifts + limitedGifts > (this.state.giftsReceived || 0),
        nextGiftAt,
        nextGiftType,
        remainingPulls: nextGiftAt - totalPulls
      };
    }

    // 常驻池：300抽送自选6星（仅1次）
    if (this.poolType === 'standard' || this.poolType === 'standard_pool') {
      const hasSelectGift = totalPulls >= this.rules.selectGiftThreshold;

      return {
        count: hasSelectGift ? 1 : 0,
        isNewGift: hasSelectGift && !this.state.hasReceivedSelectGift,
        nextGiftAt: hasSelectGift ? null : this.rules.selectGiftThreshold,
        remainingPulls: hasSelectGift ? 0 : this.rules.selectGiftThreshold - totalPulls,
        giftType: 'select_six_star'
      };
    }

    // 默认返回（不应该到达这里）
    return {
      count: 0,
      isNewGift: false,
      nextGiftAt: 0,
      remainingPulls: 0
    };
  }

  /**
   * 检查情报书
   * @param {Object} state - 当前状态
   * @returns {boolean} 是否领取情报书
   */
  checkInfoBook(state) {
    return this.capabilities.infoBookEnabled && checkInfoBookAvailable(state, this.rules);
  }

  /**
   * 激活未激活的情报书（切换到新限定池时调用）
   */
  activateInfoBook() {
    if (this.state.hasUnactivatedInfoBook && !this.state.hasUsedInfoBookTenPull) {
      this.updateState({
        infoBookTenPullAvailable: true,
        hasUnactivatedInfoBook: false
      });
      return true;
    }
    return false;
  }

  /**
   * 重置模拟器
   */
  reset() {
    this.state = createInitialState(this.poolType, this.capabilities);
    this.notifyListeners();
  }

  /**
   * 导入状态（从保存的数据恢复）
   * @param {Object} savedState - 保存的状态
   */
  importState(savedState) {
    const {
      poolType: _storedPoolType,
      extraRuleProfile: _storedRuleProfile,
      extraSeriesKey: _storedSeriesKey,
      ...stateWithoutPoolType
    } = savedState || {};
    this.state = {
      ...createInitialState(this.poolType, this.capabilities),
      ...stateWithoutPoolType,
      poolType: this.poolType,
      extraRuleProfile: this.capabilities.ruleProfile,
      extraSeriesKey: this.capabilities.seriesKey,
    };
    this.notifyListeners();
  }

  /**
   * 导出状态（用于保存）
   * @returns {Object} 当前状态
   */
  exportState() {
    return {
      ...this.state,
      poolType: this.poolType,
      // 移除UI状态
      isAnimating: undefined,
      lastPullResult: undefined,
      // 移除全局状态（情报书相关字段应该从全局状态读取，不保存在每个卡池）
      hasUnactivatedInfoBook: undefined,
      infoBookTenPullAvailable: undefined,
      hasUsedInfoBookTenPull: undefined
    };
  }

  /**
   * 获取统计摘要
   * @returns {Object} 统计信息
   */
  getStatistics() {
    const {
      totalPulls,
      sixStarCount,
      fiveStarCount,
      upSixStarCount,
      pullHistory,
      sixStarPity,
      hasReceivedInfoBook,
      hasReceivedSelectGift
    } = this.state;

    // 计算出货率
    const sixStarRate = totalPulls > 0
      ? ((sixStarCount / totalPulls) * 100).toFixed(2)
      : '0.00';

    const fiveStarRate = totalPulls > 0
      ? ((fiveStarCount / totalPulls) * 100).toFixed(2)
      : '0.00';

    // 计算不歪率（UP 6星 / 总6星）- 保留1位小数
    const upRate = sixStarCount > 0
      ? ((upSixStarCount / sixStarCount) * 100).toFixed(1)
      : '0.0';

    // BUG-035: 统一 UP 平均出货为 totalPulls / upCount
    const nonFreePulls = pullHistory.filter(p => !p.isFreePull).length;
    const nonFreeUpSixStars = pullHistory.filter(p => p.rarity === 6 && p.isUp && !p.isFreePull).length;

    const avgPullsPerSixStar = nonFreeUpSixStars > 0
      ? (nonFreePulls / nonFreeUpSixStars).toFixed(1)
      : '-';

    // 期望抽数
    const expectedPulls = calculateExpectedPulls(sixStarPity, this.rules);

    // 六星历史
    const sixStarHistory = pullHistory
      .filter(p => p.rarity === 6)
      .map((p, index, arr) => {
        const prevSixStar = arr[index - 1];
        const pityWhenPulled = prevSixStar
          ? p.pullNumber - prevSixStar.pullNumber
          : p.pullNumber;

        return {
          ...p,
          pityWhenPulled
        };
      });

    // 获取赠送信息（根据卡池类型）
    const giftInfo = this.checkGifts(this.getRewardPullCount(totalPulls));
    const freeTenPullInfo = this.checkFreeTenPulls(totalPulls);

    return {
      totalPulls,
      sixStarCount,
      fiveStarCount,
      upSixStarCount,
      sixStarRate,
      fiveStarRate,
      upRate,
      avgPullsPerSixStar,
      currentPity: sixStarPity,
      expectedPulls,

      // 赠送机制统计（根据卡池类型返回不同信息）
      gifts: giftInfo,
      freeTenPulls: freeTenPullInfo,  // 新增：30抽赠送十连信息
      hasReceivedInfoBook,
      hasReceivedSelectGift,

      sixStarHistory,
      poolType: this.poolType
    };
  }

  /**
   * 获取保底进度信息
   * @returns {Object} 保底信息
   */
  getPityInfo() {
    const {
      sixStarPity,
      fiveStarPity,
      isGuaranteedUp,
      guaranteedLimitedPity,
      hasReceivedGuaranteedLimited
    } = this.state;

    const {
      sixStarPity: maxSixStarPity,
      fiveStarPity: maxFiveStarPity,
      guaranteedLimitedPity: maxGuaranteedPity
    } = this.rules;

    const safePercentage = (current, max) => {
      const numericMax = Number(max || 0);
      if (numericMax <= 0) {
        return '0.0';
      }
      return (Number(current || 0) / numericMax * 100).toFixed(1);
    };
    const safeRemaining = (current, max) => Math.max(Number(max || 0) - Number(current || 0), 0);

    return {
      sixStar: {
        current: sixStarPity,
        max: maxSixStarPity,
        percentage: safePercentage(sixStarPity, maxSixStarPity),
        remaining: safeRemaining(sixStarPity, maxSixStarPity)
      },
      fiveStar: {
        current: fiveStarPity,
        max: maxFiveStarPity,
        percentage: safePercentage(fiveStarPity, maxFiveStarPity),
        remaining: safeRemaining(fiveStarPity, maxFiveStarPity)
      },
      guaranteedUp: {
        isActive: isGuaranteedUp,
        current: guaranteedLimitedPity,
        max: maxGuaranteedPity,
        percentage: safePercentage(guaranteedLimitedPity, maxGuaranteedPity),
        remaining: safeRemaining(guaranteedLimitedPity, maxGuaranteedPity),
        hasReceived: hasReceivedGuaranteedLimited
      }
    };
  }

  /**
   * 获取当前状态快照
   * @returns {Object} 状态快照
   */
  getState() {
    return { ...this.state };
  }
}

/**
 * 创建模拟器实例
 * @param {string} poolType - 卡池类型 ('limited', 'weapon', 'standard')
 * @param {Object} customRules - 自定义规则（可选）
 * @param {string} currentUpCharacter - 当前UP角色（可选）
 * @param {Object} poolCharactersList - 可选：卡池角色列表
 * @returns {GachaSimulator} 模拟器实例
 */
export function createSimulator(pool, customRules = null, currentUpCharacter = null, poolCharactersList = null) {
  return new GachaSimulator(pool, customRules, currentUpCharacter, poolCharactersList);
}

export default {
  GachaSimulator,
  createSimulator,
  createInitialState
};
