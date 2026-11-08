export const REGULATION_CAMPAIGN_ID = 'arknights-regulation-202611';

export const REGULATION_LOTTERY = Object.freeze({
  id: REGULATION_CAMPAIGN_ID,
  title: '卫戍协议 · 规程特别抽奖',
  // The production opening time is set when the new campaign is activated.
  previewStartsAt: '2026-11-08T00:00:00+08:00',
  closesAt: '2026-11-22T00:00:00+08:00',
  drawsAt: '2026-11-22T00:00:03+08:00',
  prizePlan: { first: 1, second: 0 },
  prizeImage: '/lottery/local-activity/regulation-developer-pack.jpg',
  prizeSource: 'https://i0.hdslb.com/bfs/new_dyn/7ee15fe5dea2e2c491c0dbbc221b1fb8161775300.jpg',
  sponsor: 'Neptune',
});

export function createRegulationSiteConfig(previousSite) {
  return {
    ...previousSite,
    brand: {
      ...previousSite.brand,
      tagline: 'REGULATION / COMMUNITY EVENT',
      footer: '本活动由终末地抽卡分析器社区发起，感谢 Neptune（备用网址提供者）赞助本期奖品；具体领取方式以中奖通知为准。',
    },
    hero: {
      kicker: 'ARKNIGHTS / REGULATION',
      titleLineOne: '卫戍协议',
      titleLineTwo: '规程',
      yearBadge: '26',
      title: REGULATION_LOTTERY.title,
      description: '一次参与，一份期待。登录主站账号，参与抽取「全能开发者主题包」，让可露希尔为你的终端焕新。',
      sponsor: '感谢 Neptune（备用网址提供者）再次赞助本期奖品',
    },
    archive: {
      url: '/lottery/archive/arknights-p3r-collab-2026',
      label: '上期结果公示',
    },
    prizes: [{
      tier: 'first',
      rank: '01',
      title: '全能开发者主题包',
      description: '共 1 名，获得价值 ¥45 的主题包 1 份，可按奖品采购价折现。含合成玉 ×2000、终端主题「全能的」可露希尔、收藏贴「终端」「开发者」「配乐」各 1 份、龙门币 ×100000、特级材料提货券 ×4。终端主题包含卫戍协议专属语音。',
      icon: 'gift',
      imageUrl: REGULATION_LOTTERY.prizeImage,
      imageUrls: [REGULATION_LOTTERY.prizeImage],
    }],
    rules: {
      version: '卫戍协议 · 规程特别抽奖规则',
      notice: '本期抽取 1 位中奖者，奖品由 Neptune 赞助。参与及领奖要求沿用上期；须实际加入活动群，领奖 QQ 不公开展示。',
      items: [
        { title: '参与资格与次数', description: '使用主站账号登录抽奖站即可参与。每个主站账号在本期只能取得一个有效参与编号；上期参与记录不计入本期。' },
        { title: '有效报名与入群要求', description: '须在截止前填写领奖 QQ、实际加入页面指定的活动群、完成机器人验证并收到“已参与”确认。勾选已进群但实际未加入的，核验后可取消参与或中奖资格。' },
        { title: '活动时间', description: '即日起报名，至北京时间 2026 年 11 月 21 日 23:59:59 截止；实际开奖由活动方在截止后人工执行，以本页公布的状态为准。' },
        { title: '奖品与名额', description: '共 1 名中奖者，获得明日方舟「全能开发者主题包」1 份，价值 ¥45；沿用上期规则，可按奖品采购价折现。' },
        { title: '公平开奖与独立复查', description: '报名开放前固定种子承诺，截止后冻结有效参与名单；结合固定轮次的 drand 公共随机数开奖。开奖后公开中奖编号、脱敏昵称及复算信息，供参与者核对。' },
        { title: '中奖联系与领取', description: '活动方通过报名时加密保存的 QQ 联系中奖者。中奖者须在首次通知后 7 日内回复并确认奖品或折现选择；无法联系、逾期未回复或资格取消时按公开流程处理。' },
        { title: '联系方式与隐私', description: '领奖 QQ 只用于核对及发奖，不公开展示。公开候选清单使用随机公开 ID，不包含联系方式、账号身份或会话信息。' },
        { title: '违规及异常处理', description: '禁止利用漏洞、脚本、批量账号、虚假信息或虚假入群确认影响活动。发现异常可取消资格；任何调整均保留审计并公开说明。' },
      ],
    },
    entryPrefix: 'REG',
  };
}

export function getRegulationPublicEnvironment(site) {
  return {
    LOTTERY_CAMPAIGN_ID: REGULATION_CAMPAIGN_ID,
    LOTTERY_BRAND_TAGLINE: site.brand.tagline,
    LOTTERY_FOOTER_NOTICE: site.brand.footer,
    LOTTERY_HERO_KICKER: site.hero.kicker,
    LOTTERY_HERO_TITLE_LINE_ONE: site.hero.titleLineOne,
    LOTTERY_HERO_TITLE_LINE_TWO: site.hero.titleLineTwo,
    LOTTERY_HERO_YEAR_BADGE: site.hero.yearBadge,
    LOTTERY_HERO_TITLE: site.hero.title,
    LOTTERY_HERO_DESCRIPTION: site.hero.description,
    LOTTERY_SPONSOR_CREDIT: site.hero.sponsor,
    LOTTERY_ARCHIVE_URL: site.archive.url,
    LOTTERY_ARCHIVE_LABEL: site.archive.label,
    LOTTERY_PRIZES_JSON: JSON.stringify(site.prizes),
    LOTTERY_RULES_JSON: JSON.stringify(site.rules),
    LOTTERY_ENTRY_PREFIX: site.entryPrefix,
  };
}
